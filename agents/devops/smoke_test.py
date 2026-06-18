"""
Smoke test for the DevOps Agent.
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents.devops.agent import ArtifactGenerator, DeployAgent
from agents.devops.schemas import DeployPlan, SCHEMA_VERSION

def test_artifact_generator():
    print("Testing ArtifactGenerator...")
    gen = ArtifactGenerator()
    result = gen.run(run_id="run-123", tenant_id="acme", service="web")
    assert result.status == "success"
    assert result.artifact_set is not None
    assert result.artifact_set["service"] == "web"
    print("ArtifactGenerator smoke test PASSED")

def test_deploy_agent():
    print("Testing DeployAgent...")
    agent = DeployAgent()
    plan = DeployPlan(
        schema_version=SCHEMA_VERSION,
        run_id="run-123",
        tenant_id="acme",
        env="staging",
        service="web",
        image_tag="v1.0.0"
    )
    result = agent.run(plan)
    assert result.status == "success"
    assert result.deploy_run is not None
    assert result.deploy_run["status"] == "success"
    print("DeployAgent smoke test PASSED")

if __name__ == "__main__":
    test_artifact_generator()
    test_deploy_agent()
    print("All smoke tests PASSED")
