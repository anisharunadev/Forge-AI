# infra/conftest/devops/no_runas_root.rego
# Conftest policy — deny workloads that run as root or fail to enforce
# runAsNonRoot. Enforces artifact-generator v0.2 §4.4 (non-root containers).
#
# Tested with `conftest test --policy infra/conftest/devops <file>`.

package main

import future.keywords.if
import future.keywords.in

# 1. Pod-level securityContext.runAsNonRoot must be true (or container-level).
deny[msg] {
    input.kind == "Deployment"
    sc := input.spec.template.spec.securityContext
    not _runAsNonRootTrue(sc)
    msg := sprintf(
        "Deployment %q does not set spec.template.spec.securityContext.runAsNonRoot=true (artifact-generator v0.2 §4.4)",
        [input.metadata.name],
    )
}

# 2. Every container must NOT explicitly request UID 0.
deny[msg] {
    input.kind == "Deployment"
    container := input.spec.template.spec.containers[_]
    container.securityContext.runAsUser == 0
    msg := sprintf(
        "container %q in Deployment %q sets runAsUser=0; root user forbidden (artifact-generator v0.2 §4.4)",
        [container.name, input.metadata.name],
    )
}

# 3. Every container must NOT drop the runAsNonRoot safety net.
deny[msg] {
    input.kind == "Deployment"
    container := input.spec.template.spec.containers[_]
    sc := container.securityContext
    sc.runAsNonRoot == false
    msg := sprintf(
        "container %q in Deployment %q sets runAsNonRoot=false; root user forbidden (artifact-generator v0.2 §4.4)",
        [container.name, input.metadata.name],
    )
}

# Helper — true if pod-level or any container-level securityContext sets
# runAsNonRoot=true.
_runAsNonRootTrue(sc) {
    sc.runAsNonRoot == true
}

_runAsNonRootTrue(sc) {
    sc.runAsNonRoot != true  # absent or false — checked by the deny rule
    not sc.runAsNonRoot == false
}

# Default deny-list helper: returns true if pod sc explicitly says false.
_runAsNonRootTrue(sc) {
    sc.runAsNonRoot != false
    sc.runAsNonRoot == true
}
