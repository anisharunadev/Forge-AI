/**
 * FORA-578 acceptance smoke — exercises the typed mock data source +
 * the persona gate logic. Runs under node without vitest setup so it
 * works in any CI that has the workspace checked out.
 *
 * Acceptance criteria covered:
 *   AC1 — Tier-1 connectors listed.
 *   AC2 — Status values are the closed `ToolCallStatus` enum.
 *   AC3 — Credentials NEVER raw: every credential envelope has
 *          `redacted: true` and no string contains the forbidden
 *          raw-credential patterns.
 *   AC4 — Persona gate: PM sees a Tier-1 subset, eng-lead/cto see all.
 *   AC5 — Per-tenant seam: a wrong tenant returns zero rows.
 *   AC6 — Sort order: Tier-1 first, then displayName asc.
 */

import { listConnectors, pmPersonaSubset, getConnector, TIER_1_CONNECTORS } from "../lib/connectors/mock-data.ts";

const FORBIDDEN_RAW_FIELDS = [
  "secret_value",
  "secretValue",
  "apiKey",
  "api_key",
  "token=",
  "password=",
  "bearer ",
];

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  -", msg);
}

const tenant = "acme-corp";

(async () => {
  // AC1: list returns Tier-1 connectors.
  const rows = await listConnectors(tenant);
  assert(rows.length >= TIER_1_CONNECTORS.length, "AC1 — list has at least one row per Tier-1 connector");
  for (const id of TIER_1_CONNECTORS) {
    assert(rows.some((r) => r.id === id), `AC1 — connector '${id}' listed`);
  }

  // AC2: status enum closed.
  for (const r of rows) {
    assert(
      r.status === "success" || r.status === "degraded" || r.status === "error",
      `AC2 — connector '${r.id}' status in enum`,
    );
  }

  // AC3: no raw credential anywhere.
  for (const r of rows) {
    assert(r.credential.redacted === true, `AC3 — connector '${r.id}' credential.redacted === true`);
    const flat = JSON.stringify(r);
    for (const bad of FORBIDDEN_RAW_FIELDS) {
      assert(!flat.includes(bad), `AC3 — connector '${r.id}' has no forbidden substring '${bad}'`);
    }
  }

  // AC4: persona gate.
  const pm = pmPersonaSubset(rows);
  assert(pm.every((r) => r.tier === 1), "AC4 — PM subset is Tier-1 only");
  assert(pm.length < rows.length, "AC4 — PM sees fewer rows than eng-lead");
  assert(!pm.some((r) => r.id === "aws"), "AC4 — PM does not see AWS");
  assert(!pm.some((r) => r.id === "sonarqube"), "AC4 — PM does not see SonarQube");
  assert(pm.some((r) => r.id === "jira"), "AC4 — PM sees Jira");
  assert(pm.some((r) => r.id === "slack"), "AC4 — PM sees Slack");

  // AC5: wrong tenant returns zero rows.
  const wrong = await listConnectors("nonexistent-tenant");
  assert(wrong.length === 0, "AC5 — wrong tenant returns zero rows");

  // AC6: sort order — Tier-1 first, then displayName asc.
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const ok = prev.tier < cur.tier || (prev.tier === cur.tier && prev.displayName <= cur.displayName);
    assert(ok, `AC6 — row ${i - 1} (${prev.id}) ≤ row ${i} (${cur.id})`);
  }

  // getConnector miss returns null.
  const miss = await getConnector(tenant, "does-not-exist");
  assert(miss === null, "getConnector — unknown id returns null");

  // getConnector hit returns a connector.
  const hit = await getConnector(tenant, "jira");
  assert(hit !== null && hit.id === "jira", "getConnector — known id returns the connector");

  console.log(`\n${rows.length} connectors verified across ${TIER_1_CONNECTORS.length} Tier-1 ids.`);
})();