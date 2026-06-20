"""
Mock fixtures — representative `RepoScope` instances for the smoke test.

The fixtures are self-contained: they construct a `RepoScope` in
memory without reading any file from disk. This keeps the smoke
test deterministic and zero-network (a contract the FORA-29 detector
also honors).

`sample_legacy_monolith()` returns a fixture that covers every
category, every transform unit the v0.1 supports, and every risk
level. It is the canonical input for the smoke test.
"""

from __future__ import annotations

from typing import List

from .schemas import FileRecord, RepoScope


def sample_legacy_monolith() -> RepoScope:
    """A representative legacy Java monolith being migrated to AWS.

    The fixture is hand-crafted to exercise every code path in the
    categorizer, risk scorer, and transform mapper. v0.2 will
    replace this with a real GitHub-MCP projection; the analyzer
    itself is decoupled from how the input is sourced.
    """
    files: List[FileRecord] = [
        # --- Hot service (god-module: high fan-in, large LoC) → rewrite
        FileRecord(
            path="src/main/java/com/billingcorp/monolith/BillingService.java",
            language="java",
            loc=480,
            role="service",
            service="billing",
            imports=[
                "src/main/java/com/billingcorp/monolith/Invoice.java",
                "src/main/java/com/billingcorp/monolith/Customer.java",
                "src/main/java/com/billingcorp/util/LegacyDb.java",
            ],
            imported_by=[
                "src/main/java/com/billingcorp/api/BillingController.java",
                "src/main/java/com/billingcorp/jobs/MonthlyRollup.java",
                "src/main/java/com/billingcorp/monolith/ReportsService.java",
            ],
            has_tests=False,
            is_entrypoint=False,
        ),
        # --- Controller for the hot service → API Gateway / T3
        FileRecord(
            path="src/main/java/com/billingcorp/api/BillingController.java",
            language="java",
            loc=120,
            role="controller",
            service="billing",
            imports=[
                "src/main/java/com/billingcorp/monolith/BillingService.java",
            ],
            imported_by=[],
            has_tests=True,
            is_entrypoint=True,
        ),
        # --- Domain model → Aurora / T2
        FileRecord(
            path="src/main/java/com/billingcorp/monolith/Invoice.java",
            language="java",
            loc=80,
            role="model",
            service="billing",
            imports=[],
            imported_by=[
                "src/main/java/com/billingcorp/monolith/BillingService.java",
            ],
            has_tests=True,
        ),
        FileRecord(
            path="src/main/java/com/billingcorp/monolith/Customer.java",
            language="java",
            loc=60,
            role="model",
            service="billing",
            imports=[],
            imported_by=[
                "src/main/java/com/billingcorp/monolith/BillingService.java",
            ],
            has_tests=True,
        ),
        # --- Internal utility (plain service, has callers) → refactor_in_place
        FileRecord(
            path="src/main/java/com/billingcorp/util/LegacyDb.java",
            language="java",
            loc=200,
            role="service",
            service="shared",
            imports=[],
            imported_by=[
                "src/main/java/com/billingcorp/monolith/BillingService.java",
            ],
            has_tests=False,
        ),
        # --- WebLogic runtime hint (path contains "weblogic/") → replace
        FileRecord(
            path="src/main/java/com/billingcorp/util/weblogic/BillingBridge.java",
            language="java",
            loc=180,
            role="service",
            service="billing",
            imports=[],
            imported_by=[],
            has_tests=False,
            is_entrypoint=True,
        ),
        # --- Pipeline / workflow role → step_functions / T3
        FileRecord(
            path="src/main/java/com/billingcorp/pipeline/InvoicePipeline.java",
            language="java",
            loc=160,
            role="pipeline",
            service="billing",
            imports=[
                "src/main/java/com/billingcorp/monolith/BillingService.java",
            ],
            imported_by=[],
            has_tests=True,
        ),
        # --- Legacy RDS-shaped model (path contains "/rds/") → rds / T2
        FileRecord(
            path="src/main/java/com/billingcorp/models/rds/LegacyInvoiceRow.java",
            language="java",
            loc=70,
            role="model",
            service="billing",
            imports=[],
            imported_by=[
                "src/main/java/com/billingcorp/monolith/BillingService.java",
            ],
            has_tests=False,
        ),
        # --- Batch job entrypoint → EC2 / T1 (heavy JVM)
        FileRecord(
            path="src/main/java/com/billingcorp/jobs/MonthlyRollup.java",
            language="java",
            loc=180,
            role="service",
            service="jobs",
            imports=[
                "src/main/java/com/billingcorp/monolith/BillingService.java",
            ],
            imported_by=[],
            has_tests=False,
            is_entrypoint=True,
        ),
        # --- Reports service (medium risk, has tests) → container / T3
        FileRecord(
            path="src/main/java/com/billingcorp/monolith/ReportsService.java",
            language="java",
            loc=140,
            role="service",
            service="reports",
            imports=[
                "src/main/java/com/billingcorp/monolith/BillingService.java",
            ],
            imported_by=[],
            has_tests=True,
        ),
        # --- Python lambda entrypoint → Lambda / T2
        FileRecord(
            path="lambdas/notify_customer.py",
            language="python",
            loc=40,
            role="service",
            service="notifications",
            imports=[],
            imported_by=[],
            has_tests=True,
            is_entrypoint=True,
        ),
        # --- UI assets → S3 + CloudFront / T1
        FileRecord(
            path="web/index.html",
            language="html",
            loc=20,
            role="ui",
            service="web",
            imports=[],
            imported_by=[],
            has_tests=False,
        ),
        FileRecord(
            path="web/app.js",
            language="javascript",
            loc=60,
            role="ui",
            service="web",
            imports=[],
            imported_by=[],
            has_tests=False,
        ),
        # --- Config + docs + infra → skip / keep_as_is
        FileRecord(
            path="config/application.yml",
            language="yaml",
            loc=30,
            role="config",
        ),
        FileRecord(
            path="README.md",
            language="markdown",
            loc=50,
            role="doc",
        ),
        FileRecord(
            path="Dockerfile",
            language="dockerfile",
            loc=15,
            role="infra",
        ),
        FileRecord(
            path="helm/Chart.yaml",
            language="yaml",
            loc=10,
            role="infra",
        ),
        # --- Tests → skip / keep_as_is
        FileRecord(
            path="src/test/java/com/billingcorp/monolith/BillingServiceTest.java",
            language="java",
            loc=120,
            role="test",
            service="billing",
        ),
        FileRecord(
            path="src/test/java/com/billingcorp/monolith/InvoiceTest.java",
            language="java",
            loc=40,
            role="test",
            service="billing",
        ),
        # --- Dead code (no importers) → remove
        FileRecord(
            path="src/main/java/com/billingcorp/util/UnusedHelper.java",
            language="java",
            loc=50,
            role="service",
            service="shared",
            imports=[],
            imported_by=[],
        ),
        # --- Deprecated path → remove
        FileRecord(
            path="zzz_legacy/old_reporting/ReportAggregator.java",
            language="java",
            loc=300,
            role="service",
            service="reporting",
            imports=[],
            imported_by=[],
            in_deprecated_path=True,
        ),
        # --- Generated path → remove
        FileRecord(
            path="target/classes/com/billingcorp/monolith/BillingService.class",
            language="java",
            loc=20,
            role="service",
            service="billing",
            imports=[],
            imported_by=[],
            in_generated_path=True,
        ),
    ]

    return RepoScope(
        schema_version=1,
        generated_at="2026-06-18T00:00:00Z",
        source="github:legacy-corp/billing-monolith@main",
        target_root="/repo",
        default_branch="main",
        total_loc_estimate=sum(f.loc for f in files),
        files=files,
        notes=[
            "Hand-crafted fixture exercising every code path of the v0.1 analyzer.",
            "Replaces a real GitHub MCP projection in v0.1; v0.2 wires the projection.",
        ],
    )
