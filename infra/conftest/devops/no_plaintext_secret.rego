# infra/conftest/devops/no_plaintext_secret.rego
# Conftest policy — deny workloads that inline a secret in env, args, or
# volume data. Enforces artifact-generator v0.2 §4.5 (no secrets in code).
#
# Tested with `conftest test --policy infra/conftest/devops <file>`.

package main

import future.keywords.if
import future.keywords.in
import future.keywords.contains

# 1. env[].value must be empty or come from a Secret/ConfigMap reference
#    (valueFrom) — never a literal.
deny[msg] {
    input.kind == "Deployment"
    container := input.spec.template.spec.containers[_]
    env := container.env[_]
    env.value
    not env.valueFrom
    _looks_like_secret(env.name)
    msg := sprintf(
        "container %q in Deployment %q sets env %q to a literal value; secrets must come from valueFrom (Secret/ConfigMap) (artifact-generator v0.2 §4.5)",
        [container.name, input.metadata.name, env.name],
    )
}

# 2. args / command must not contain a high-entropy literal that looks
#    like an API key or token. This is a coarse heuristic; the secrets
#    detector at stage 5 (security) is the authoritative one.
deny[msg] {
    input.kind == "Deployment"
    container := input.spec.template.spec.containers[_]
    arg := container.args[_]
    contains(arg, "AKIA")  # AWS access-key prefix
    msg := sprintf(
        "container %q in Deployment %q has args containing what looks like an AWS access key (artifact-generator v0.2 §4.5)",
        [container.name, input.metadata.name],
    )
}

# 3. envFrom with secretRef pointing at a hard-coded key is fine. envFrom
#    with configMapRef is OK. Inline data in volumes is not.
deny[msg] {
    input.kind == "Deployment"
    volume := input.spec.template.spec.volumes[_]
    volume.configMap.items[_].key == "secret"
    msg := sprintf(
        "Deployment %q mounts a ConfigMap volume that contains a key named 'secret'; use a Secret-backed volume instead (artifact-generator v0.2 §4.5)",
        [input.metadata.name],
    )
}

# Heuristic: env name suggests secret.
_looks_like_secret(name) {
    lower := lower(name)
    contains(lower, "secret")
}

_looks_like_secret(name) {
    lower := lower(name)
    contains(lower, "password")
}

_looks_like_secret(name) {
    lower := lower(name)
    contains(lower, "token")
}

_looks_like_secret(name) {
    lower := lower(name)
    contains(lower, "api_key")
}

_looks_like_secret(name) {
    lower := lower(name)
    contains(lower, "apikey")
}
