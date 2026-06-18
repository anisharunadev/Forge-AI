# infra/conftest/devops/no_latest_image.rego
# Conftest policy — deny IaC manifests that pin an image to ":latest" or
# leave the tag empty. Enforces artifact-generator v0.2 §4.3 (pinned versions).
#
# Tested with `conftest test --policy infra/conftest/devops <file>`.

package main

import future.keywords.if
import future.keywords.in
import future.keywords.contains

# Deny list — rendered into a single string with the offending resource.
deny[msg] {
    input.kind == "Deployment"
    container := input.spec.template.spec.containers[_]
    tag := _image_tag(container.image)
    tag == "latest"
    msg := sprintf(
        "container %q in Deployment %q uses :latest image tag; pin a digest or specific version (artifact-generator v0.2 §4.3)",
        [container.name, input.metadata.name],
    )
}

deny[msg] {
    input.kind == "Deployment"
    container := input.spec.template.spec.containers[_]
    tag := _image_tag(container.image)
    tag == ""
    msg := sprintf(
        "container %q in Deployment %q has no image tag; pin a digest or specific version (artifact-generator v0.2 §4.3)",
        [container.name, input.metadata.name],
    )
}

# Helper: pull the tag out of "repo[:tag][@digest]". Returns "" if no tag.
_image_tag(image) = tag {
    parts := split(image, ":")
    count(parts) >= 2
    not contains(image, "@sha256:")  # digest-pinned images have no tag
    last := parts[count(parts) - 1]
    not startswith(last, "sha256:")
    tag := last
}

_image_tag(image) = "" {
    not _image_has_tag(image)
}

_image_has_tag(image) {
    parts := split(image, ":")
    count(parts) >= 2
    not contains(image, "@sha256:")
    last := parts[count(parts) - 1]
    not startswith(last, "sha256:")
}
