/**
 * Sync Plane nightly cron worker (FORA-438 / FORA-406).
 *
 * Thin TypeScript wrapper around the Python cron entry
 * point (`agents.sync_plane_service.nightly_cron`). The
 * Python module owns the scan logic; this file is the
 * k8s CronJob / orchestrator registration surface so the
 * deployment system can discover the schedule + command
 * without parsing shell strings.
 *
 * The two runtime paths are:
 *
 *   pnpm --filter @fora/sync-plane-job scan
 *
 *     → runs the scan once. The orchestrator invokes this
 *       on the cron schedule (`0 2 * * *` by default —
 *       low-traffic window; see the Python
 *       `register_cron()` default).
 *
 *   pnpm --filter @fora/sync-plane-job register
 *
 *     → prints the cron registration descriptor (schedule
 *       + command) as JSON. The orchestrator reads this
 *       to install the k8s CronJob. The output is
 *       deterministic and idempotent — running it twice
 *       yields the same descriptor.
 *
 * The Python module is the source of truth; this file
 * exists so the `@fora/sync-plane-job` package shows up
 * in `pnpm list` and the orchestrator can install the
 * cron via the workspace app index.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const EVIDENCE_DIR = join(__dirname, "..", "evidence");

function ensureEvidenceDir(): void {
  if (!existsSync(EVIDENCE_DIR)) {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
}

export interface CronDescriptor {
  name: string;
  schedule: string;
  command: string[];
  shared_with: string[];
  idempotent: boolean;
  audit_event_type: string;
  registered_at: string;
}

/**
 * Read the cron registration descriptor from the Python
 * module. The Python module is the source of truth; this
 * is a thin shell-out. Falls back to a hard-coded copy
 * if the Python runtime is missing (the orchestrator
 * should refuse to install the cron in that case).
 */
export function readCronDescriptor(): CronDescriptor {
  const proc = spawnSync(
    "python3",
    [
      "-c",
      "from agents.sync_plane_service.nightly_cron import register_cron; import json; print(json.dumps(register_cron()))",
    ],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  if (proc.status !== 0) {
    throw new Error(
      `nightly_cron: python entry point failed: ${proc.stderr}`,
    );
  }
  return JSON.parse(proc.stdout) as CronDescriptor;
}

/**
 * Run the scan once. The Python module writes the
 * per-run summary to stdout; this wrapper persists the
 * same output to `evidence/nightly_cron_<utc>.json` so
 * the close-gate reviewer has a stable file path.
 */
export function runScan(): CronDescriptor {
  ensureEvidenceDir();
  const proc = spawnSync(
    "python3",
    ["-m", "agents.sync_plane_service.nightly_cron"],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  if (proc.status !== 0) {
    throw new Error(
      `nightly_cron: scan failed: ${proc.stderr}`,
    );
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 15);
  const outPath = join(EVIDENCE_DIR, `nightly_cron_${stamp}.json`);
  writeFileSync(outPath, proc.stdout, "utf-8");
  return readCronDescriptor();
}

// CLI entry point. `pnpm run scan` → runScan().
// `pnpm run register` → readCronDescriptor().
if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2] ?? "scan";
  if (action === "register") {
    console.log(JSON.stringify(readCronDescriptor(), null, 2));
  } else {
    const descriptor = runScan();
    console.log(JSON.stringify(descriptor, null, 2));
  }
}
