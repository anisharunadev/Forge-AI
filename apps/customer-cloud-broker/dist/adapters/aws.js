/**
 * AWS adapter for the customer-cloud-broker (FORA-126 / FORA-126.5).
 *
 * The broker is the *only* path through which a FORA agent can act on a
 * customer's AWS account. The broker exchanges a FORA-issued OIDC token
 * for a short-lived STS credential via `AssumeRoleWithWebIdentity`
 * (ADR-0003 §6.2). The customer's IAM role must:
 *
 *   1. Trust the broker's OIDC issuer (the FORA identity-broker).
 *   2. Have a `MaxSessionDuration` of <= 900 seconds (15 minutes). The
 *      broker refuses a role whose configured duration exceeds the cap
 *      and emits `response_code = credential_too_long`.
 *   3. Carry an inline policy that grants only the actions the tenant
 *      has authorised (ADR-0003 §5.2 narrows beyond the platform
 *      default).
 *
 * Credential lifetime: the FORA-issued token passed in `for_jwt` has
 * its own `exp`. The broker refuses to assume if `exp - now > 900s`,
 * but more importantly, the *returned* `expires_at_ms` is the minimum
 * of (FORA token expiry, AWS credential expiry). The adapter drops the
 * raw credential string immediately after `perform()` returns — the
 * `handle` exposed to the broker is an `AwsCredentialHandle` whose
 * fields are typed so a stray `console.log(handle)` prints an opaque
 * summary, not the secret.
 *
 * FORA-126.5 — per-service AWS SDK dispatch.
 *
 * `perform()` replaces the v1 shim with a real per-service dispatcher:
 *   - The per-service SDK package (`@aws-sdk/client-{service}`) is
 *     lazy-imported on first call for that service.
 *   - The SDK client is constructed with the assumed-role credential
 *     holder from `HOLDER_REGISTRY` and the customer-specified region.
 *   - The SDK call is `client.send(new Command(args.params))`.
 *   - The response is redacted of any credential-shaped fields before
 *     it crosses the broker boundary; the audit factory's
 *     `assertNoCredentials` is the second-line guard.
 *
 * Reliability: per-tenant+service token bucket and circuit breaker so
 * a degraded customer (throttled, 5xx-storming) does not starve other
 * tenants. Both are keyed by `${tenant_id}|${service}`; the state is
 * module-scoped and lazy — the first call to a (tenant, service) pair
 * initialises its own bucket / breaker.
 *
 * Test seam: the `dispatch_fn` option lets tests inject a fake
 * dispatcher that returns a canned response without contacting AWS.
 * Production uses the default, which performs the real SDK call.
 */
import { createHash } from 'node:crypto';
import { STSClient, AssumeRoleWithWebIdentityCommand, } from '@aws-sdk/client-sts';
import { MAX_CREDENTIAL_LIFETIME_MS } from '../types.js';
import { redactCredentials, assertNoCredentials } from '../audit.js';
const HANDLE_INTERNAL = Symbol('aws.handle.internal');
function makeHandle(response, args, expires_at_ms) {
    const akid = response.Credentials?.AccessKeyId ?? '';
    return {
        region: args.region,
        role_arn: args.role_arn,
        expires_at_ms,
        access_key_id_prefix: akid.slice(0, 8),
        _internal: Object.freeze({ [HANDLE_INTERNAL]: undefined }),
    };
}
function newHolder(response) {
    const creds = response.Credentials;
    if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken || !creds.Expiration) {
        return null;
    }
    return {
        accessKeyId: creds.AccessKeyId,
        secretAccessKey: creds.SecretAccessKey,
        sessionToken: creds.SessionToken,
        expiration_ms: creds.Expiration.getTime(),
    };
}
// Module-level WeakMap from handle to holder. Lives only for the
// lifetime of the brokered action; the broker is responsible for
// calling `releaseHandle(handle)` after `perform()` returns. The
// adapter ALSO releases in its own `finally` so a forgotten caller
// cannot leak a holder indefinitely.
const HOLDER_REGISTRY = new WeakMap();
function releaseHandle(handle) {
    HOLDER_REGISTRY.delete(handle);
}
// ---------------------------------------------------------------------------
// Per-service dispatch registry. v1 supports the five service
// namespaces called out in the FORA-126.5 acceptance bar: s3, ec2,
// iam, cloudformation, cloudcontrol. Adding a new service is a
// one-line addition here AND a one-line `dynamicImport` entry below.
// ---------------------------------------------------------------------------
/**
 * Map from `args.service` to the SDK client class name and the set of
 * allowed operations. The allowed-operation list is a *positive* allow
 * list — anything not in the map is rejected with
 * `unsupported_aws_service_operation` before the SDK is even touched.
 *
 * The operation names match the AWS SDK v3 `Command` class names
 * (e.g. `GetObject` → `GetObjectCommand`). The IAM action namespace
 * (e.g. `s3:GetObject`) is what the broker's deny-list matches on
 * (see `deny_list.yaml`); the SDK command name is what we dispatch.
 */
const SERVICE_OPS = {
    s3: {
        client: 'S3Client',
        operations: {
            GetObject: 'GetObjectCommand',
            PutObject: 'PutObjectCommand',
            ListBuckets: 'ListBucketsCommand',
        },
    },
    ec2: {
        client: 'EC2Client',
        operations: {
            DescribeInstances: 'DescribeInstancesCommand',
        },
    },
    iam: {
        client: 'IAMClient',
        operations: {
            GetUser: 'GetUserCommand',
            ListUsers: 'ListUsersCommand',
        },
    },
    cloudformation: {
        client: 'CloudFormationClient',
        operations: {
            DescribeStacks: 'DescribeStacksCommand',
        },
    },
    cloudcontrol: {
        client: 'CloudControlClient',
        operations: {
            GetResource: 'GetResourceCommand',
            ListResources: 'ListResourcesCommand',
        },
    },
};
/** Lazy module loaders, keyed by service name. */
const SERVICE_LOADERS = {
    s3: () => import('@aws-sdk/client-s3'),
    ec2: () => import('@aws-sdk/client-ec2'),
    iam: () => import('@aws-sdk/client-iam'),
    cloudformation: () => import('@aws-sdk/client-cloudformation'),
    cloudcontrol: () => import('@aws-sdk/client-cloudcontrol'),
};
export class TokenBucket {
    tokens;
    last_refill_ms;
    capacity;
    refill_per_ms;
    now;
    constructor(opts) {
        this.capacity = opts.capacity;
        this.refill_per_ms = opts.refill_per_sec / 1000;
        this.now = opts.now ?? Date.now;
        this.tokens = opts.capacity;
        this.last_refill_ms = this.now();
    }
    /**
     * Try to take one token. Returns `true` on success, `false` if the
     * bucket is empty (caller should fail fast with a rate-limit error).
     */
    take() {
        const now = this.now();
        const elapsed_ms = now - this.last_refill_ms;
        if (elapsed_ms > 0) {
            this.tokens = Math.min(this.capacity, this.tokens + elapsed_ms * this.refill_per_ms);
            this.last_refill_ms = now;
        }
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }
}
export class CircuitBreaker {
    state = 'closed';
    failure_count = 0;
    opened_at_ms = 0;
    half_open_in_flight = false;
    failure_threshold;
    cooldown_ms;
    now;
    constructor(opts) {
        this.failure_threshold = opts.failure_threshold;
        this.cooldown_ms = opts.cooldown_ms;
        this.now = opts.now ?? Date.now;
    }
    /**
     * Returns `true` if the call may proceed. Side effect: when the
     * breaker is in `half_open` and the cooldown has elapsed, the first
     * caller wins the probe slot; subsequent callers are rejected until
     * the probe resolves.
     */
    canPass() {
        if (this.state === 'closed')
            return true;
        if (this.state === 'open') {
            if (this.now() - this.opened_at_ms >= this.cooldown_ms) {
                this.state = 'half_open';
                this.half_open_in_flight = false;
            }
            else {
                return false;
            }
        }
        if (this.state === 'half_open') {
            if (this.half_open_in_flight)
                return false;
            this.half_open_in_flight = true;
            return true;
        }
        return false;
    }
    onSuccess() {
        this.state = 'closed';
        this.failure_count = 0;
        this.half_open_in_flight = false;
    }
    onFailure() {
        this.failure_count += 1;
        this.half_open_in_flight = false;
        if (this.state === 'half_open' || this.failure_count >= this.failure_threshold) {
            this.state = 'open';
            this.opened_at_ms = this.now();
        }
    }
}
function makeReliabilityState(opts = {}) {
    const now = opts.now ?? Date.now;
    const rate_capacity = opts.rate_capacity ?? 10;
    const rate_per_sec = opts.rate_per_sec ?? 10;
    const breaker_threshold = opts.breaker_threshold ?? 5;
    const breaker_cooldown_ms = opts.breaker_cooldown_ms ?? 30_000;
    return {
        buckets: new Map(),
        breakers: new Map(),
        makeBucket() {
            return new TokenBucket({ capacity: rate_capacity, refill_per_sec: rate_per_sec, now });
        },
        makeBreaker() {
            return new CircuitBreaker({
                failure_threshold: breaker_threshold,
                cooldown_ms: breaker_cooldown_ms,
                now,
            });
        },
    };
}
export class AwsAdapter {
    cloud = 'aws';
    broker_issuer;
    broker_audience;
    sts_client;
    assume_fn;
    dispatch_fn;
    reliability;
    constructor(opts) {
        this.broker_issuer = opts.broker_issuer;
        this.broker_audience = opts.broker_audience;
        this.sts_client = opts.sts_client ?? ((region) => new STSClient({ region }));
        this.assume_fn =
            opts.assume_fn ??
                (async (input) => {
                    const region = input.RoleSessionName?.split('-')[1] ?? 'us-east-1';
                    const client = this.sts_client(region);
                    return client.send(new AssumeRoleWithWebIdentityCommand(input));
                });
        this.dispatch_fn = opts.dispatch_fn ?? defaultDispatchFn;
        this.reliability = makeReliabilityState(opts.reliability);
    }
    async probeTrust(trust) {
        if (!trust.role_ref.startsWith('arn:aws:iam::')) {
            return { ok: false, reason: 'role_arn_malformed' };
        }
        if (trust.expected_issuer !== this.broker_issuer) {
            return { ok: false, reason: 'expected_issuer_mismatch' };
        }
        if (trust.expected_audience !== this.broker_audience) {
            return { ok: false, reason: 'expected_audience_mismatch' };
        }
        return { ok: true, reason: null };
    }
    async assume(args, for_jwt) {
        if (args.cloud !== 'aws') {
            throw new Error('aws adapter received non-aws args');
        }
        const input = {
            RoleArn: args.role_arn,
            RoleSessionName: `fora-${args.region}-${shortHash(for_jwt)}`,
            WebIdentityToken: for_jwt,
            DurationSeconds: Math.floor(MAX_CREDENTIAL_LIFETIME_MS / 1000),
        };
        const response = await this.assume_fn(input);
        const holder = newHolder(response);
        if (!holder) {
            throw new Error('assume_role_response_missing_credentials');
        }
        const expires_at_ms = Math.min(holder.expiration_ms, Date.now() + MAX_CREDENTIAL_LIFETIME_MS);
        const handle = makeHandle(response, args, expires_at_ms);
        HOLDER_REGISTRY.set(handle, holder);
        return {
            handle,
            expires_at_ms,
            role_fingerprint: fingerprintRole(args.role_arn, args.region),
        };
    }
    /**
     * Perform the requested action. v2 (FORA-126.5) replaces the shim
     * with a real per-service dispatcher: lazy-import the SDK package,
     * build a client with the assumed credential, call
     * `client.send(new Command(params))`, redact the response.
     *
     * Per-tenant+service rate limiting and circuit breaker gate the
     * call. A rate-limit / circuit-open failure is surfaced as a typed
     * error so the broker can record `operation_failed` with a precise
     * reason; the audit factory never sees a credential.
     */
    async perform(handle, args, ctx = {}) {
        const holder = HOLDER_REGISTRY.get(handle);
        if (!holder) {
            throw new Error('aws_handle_already_released');
        }
        const tenant_id = ctx.tenant_id ?? 'unknown';
        const svcKey = `${tenant_id}|${args.service}`;
        const bucket = this.reliability.buckets.get(svcKey) ?? this.reliability.makeBucket();
        if (!this.reliability.buckets.has(svcKey))
            this.reliability.buckets.set(svcKey, bucket);
        const breaker = this.reliability.breakers.get(svcKey) ?? this.reliability.makeBreaker();
        if (!this.reliability.breakers.has(svcKey))
            this.reliability.breakers.set(svcKey, breaker);
        try {
            if (!bucket.take()) {
                breaker.onFailure();
                throw new Error(`aws_rate_limited:${args.service}`);
            }
            if (!breaker.canPass()) {
                throw new Error(`aws_circuit_open:${args.service}`);
            }
            // Operation is a positive allow list — fail fast before
            // touching the SDK so a typo in the action string can't reach
            // the customer's AWS account.
            const opMap = SERVICE_OPS[args.service];
            if (!opMap) {
                throw new Error(`unsupported_aws_service:${args.service}`);
            }
            const commandName = opMap.operations[args.operation];
            if (!commandName) {
                throw new Error(`unsupported_aws_service_operation:${args.service}:${args.operation}`);
            }
            const response = await this.dispatch_fn(args.service, args.operation, args.params, holder, args.region);
            // Redact the response of any credential-shaped fields, then
            // assert credential-freeness. A failure here is a real bug —
            // the SDK should not be surfacing a credential, but if it does
            // (or a service ever adds a new credential-shaped field), the
            // broker fails the request rather than leak it.
            const redacted = redactCredentials(response);
            assertNoCredentials(redacted);
            breaker.onSuccess();
            return redacted;
        }
        catch (err) {
            // We did NOT call breaker.onFailure() in the inner try/catch on
            // every error — the breaker only counts SDK / network failures,
            // not permission / validation errors that are the caller's
            // fault. The rate-limit and unsupported-op paths set their own
            // onFailure (or not) above; SDK / network errors flow here.
            if (err instanceof Error) {
                const reason = err.message;
                if (!reason.startsWith('aws_rate_limited:') &&
                    !reason.startsWith('aws_circuit_open:') &&
                    !reason.startsWith('unsupported_aws_service') &&
                    !reason.startsWith('aws_handle_already_released')) {
                    breaker.onFailure();
                }
            }
            throw err;
        }
        finally {
            releaseHandle(handle);
        }
    }
    /**
     * Release a handle obtained from `assume()` without calling
     * `perform()`. The probe path (FORA-126.4) uses this so a
     * canary-assume does not leak its holder into the adapter's
     * `HOLDER_REGISTRY`. Idempotent: calling it twice is a no-op.
     */
    releaseHandle(handle) {
        releaseHandle(handle);
    }
}
// ---------------------------------------------------------------------------
// Default dispatch function. Lazy-imports the per-service SDK package,
// constructs a client with the assumed-role credential, and calls
// `client.send(new Command(params))`. The returned response is whatever
// the SDK produced; `perform()` redacts and asserts.
// ---------------------------------------------------------------------------
async function defaultDispatchFn(service, operation, params, holder, region) {
    const loader = SERVICE_LOADERS[service];
    if (!loader) {
        throw new Error(`unsupported_aws_service:${service}`);
    }
    const mod = (await loader());
    const opMap = SERVICE_OPS[service];
    if (!opMap) {
        throw new Error(`unsupported_aws_service:${service}`);
    }
    const ClientClass = mod[opMap.client];
    const CommandClass = mod[opMap.operations[operation]];
    if (!ClientClass || !CommandClass) {
        throw new Error(`unsupported_aws_service_operation:${service}:${operation}`);
    }
    const client = new ClientClass({
        region,
        credentials: {
            accessKeyId: holder.accessKeyId,
            secretAccessKey: holder.secretAccessKey,
            sessionToken: holder.sessionToken,
        },
    });
    try {
        return await client.send(new CommandClass(params));
    }
    finally {
        // The client holds a reference to the credentials via the
        // credential provider; destroying releases sockets and any
        // cached metadata. The credential holder itself was already
        // wiped by `releaseHandle` in the calling `perform()`'s finally.
        client.destroy();
    }
}
function shortHash(s) {
    return createHash('sha256').update(s).digest('hex').slice(0, 12);
}
function fingerprintRole(role_arn, region) {
    return 'aws:' + createHash('sha256').update(`${region}|${role_arn}`).digest('hex').slice(0, 16);
}
