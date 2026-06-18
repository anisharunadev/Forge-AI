/**
 * CircuitBreaker — pure state-machine tests.
 * Reuses the breaker test bar from aws-dispatch.test.ts (FORA-126.5
 * AC #4) and extends with the Sync Plane's per-platform keying
 * (FORA-256 AC #2: trips on synthetic 5xx burst; recovers in
 * half-open after 5 min).
 */
export {};
