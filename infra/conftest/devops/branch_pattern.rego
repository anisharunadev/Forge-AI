# infra/conftest/devops/branch_pattern.rego
# Conftest policy — enforce the forge/6.1/<tenant>/<service>/art-… branch
# pattern for any branch that is wired into an ArgoCD Application.
# Enforces artifact-generator v0.2 §5.2 BranchProtectionPolicy.
#
# Tested with `conftest test --policy infra/conftest/devops <file>`.

package main

import future.keywords.if

# ArgoCD Application must track a forge/6.1/.../art-… branch, not main
# or release/*.
deny[msg] {
    input.kind == "Application"
    input.apiVersion == "argoproj.io/v1alpha1"
    rev := input.spec.source.targetRevision
    not _matches_art_branch(rev)
    msg := sprintf(
        "ArgoCD Application %q tracks targetRevision %q; must be a forge/6.1/<tenant>/<service>/art-… branch (artifact-generator v0.2 §5.2)",
        [input.metadata.name, rev],
    )
}

# ApplicationSet generators must use the same constraint.
deny[msg] {
    input.kind == "ApplicationSet"
    input.apiVersion == "argoproj.io/v1alpha1"
    gen := input.spec.generators[_]
    selector := gen.selector.matchExpressions[_]
    # No-op placeholder; real rule below.
    not _matches_art_branch(selector.values[_])
    msg := sprintf(
        "ApplicationSet %q has a generator that does not match forge/6.1/.../art-… (artifact-generator v0.2 §5.2)",
        [input.metadata.name],
    )
}

_matches_art_branch(rev) {
    startswith(rev, "forge/6.1/")
    contains(rev, "/art-")
}
