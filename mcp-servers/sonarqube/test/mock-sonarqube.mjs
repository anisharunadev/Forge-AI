// test/mock-sonarqube.mjs
// Lightweight in-memory SonarQube REST v1 mock for the smoke test.
//
// Implements the minimum surface the FORA SonarQube MCP server touches:
//   GET  /api/projects/search
//   GET  /api/projects/show?project=...
//   GET  /api/components/search
//   GET  /api/measures/component
//   GET  /api/issues/search              (list + single-issue lookup via `issues=`)
//   POST /api/issues/do_transition       (write path)
//   GET  /api/qualitygates/project_status
//   GET  /api/webhooks/deliveries
//
// The mock records every call (method, path, body) so the smoke test can
// assert that the MCP server actually issued the right requests and that
// the do_transition payload round-trips.

import http from "node:http";
import { URL } from "node:url";

/**
 * @typedef {Object} MockState
 * @property {Array<Record<string, unknown>>} projects
 * @property {Array<Record<string, unknown>>} components
 * @property {Array<Record<string, unknown>>} issues
 * @property {Record<string, { status: string, conditions: Array<Record<string, unknown>> }>} qualityGates  projectKey -> gate
 * @property {Array<Record<string, unknown>>} webhookDeliveries
 * @property {Array<{ method: string, path: string, body: unknown }>} callLog
 */

/** @returns {MockState} */
export function initialState() {
  return {
    projects: [
      {
        key: "forge",
        name: "Forge",
        qualifier: "TRK",
        visibility: "public",
        organization: "acme",
        lastAnalysisDate: "2026-06-15T10:00:00Z",
        description: "Forge monorepo",
        tags: ["sdlc", "orchestrator"],
        revision: "abc123",
      },
      {
        key: "atlas",
        name: "Atlas",
        qualifier: "TRK",
        visibility: "private",
        organization: "acme",
        lastAnalysisDate: "2026-06-14T09:00:00Z",
        description: "Atlas product",
        tags: [],
      },
    ],
    components: [
      {
        key: "forge:src/orchestrator.ts",
        name: "orchestrator.ts",
        qualifier: "FIL",
        path: "src/orchestrator.ts",
        language: "ts",
      },
      {
        key: "forge:src/runtime.ts",
        name: "runtime.ts",
        qualifier: "FIL",
        path: "src/runtime.ts",
        language: "ts",
      },
      {
        key: "forge:src",
        name: "src",
        qualifier: "DIR",
        path: "src",
      },
    ],
    issues: [
      {
        key: "AYforge-001",
        rule: "javascript:S3776",
        severity: "CRITICAL",
        type: "BUG",
        component: "forge:src/orchestrator.ts",
        project: "forge",
        line: 42,
        message: "Refactor this function to reduce its Cognitive Complexity from 28 to the 15 allowed.",
        status: "OPEN",
        creationDate: "2026-06-15T10:00:00Z",
        updateDate: "2026-06-15T10:00:00Z",
      },
      {
        key: "AYforge-002",
        rule: "javascript:S1481",
        severity: "MINOR",
        type: "CODE_SMELL",
        component: "forge:src/runtime.ts",
        project: "forge",
        line: 17,
        message: "Remove this unused variable 'ctx'.",
        status: "OPEN",
        creationDate: "2026-06-15T10:00:00Z",
        updateDate: "2026-06-15T10:00:00Z",
      },
    ],
    qualityGates: {
      forge: {
        status: "WARN",
        conditions: [
          { metric: "coverage", operator: "LT", value: "80", actualValue: "76.5", status: "WARN" },
          { metric: "duplicated_lines_density", operator: "GT", value: "3", actualValue: "1.2", status: "OK" },
        ],
        gateName: "FORA Default",
      },
    },
    webhookDeliveries: [
      {
        id: "WD-001",
        name: "forge-ci",
        url: "https://ci.example.com/sonar-webhook",
        projectKey: "forge",
        success: true,
        httpStatus: 200,
        at: "2026-06-15T10:00:01Z",
        durationMs: 120,
      },
      {
        id: "WD-002",
        name: "forge-slack",
        url: "https://hooks.slack.example/sonar",
        projectKey: "forge",
        success: false,
        httpStatus: 500,
        at: "2026-06-15T10:00:02Z",
        durationMs: 5000,
      },
    ],
    callLog: [],
  };
}

/**
 * Start the mock server. Returns the base URL and a shutdown function.
 *
 * @param {MockState} state
 * @param {number} port
 * @returns {Promise<{ baseUrl: string, shutdown: () => Promise<void> }>}
 */
export function startMockServer(state, port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const path = u.pathname;
      state.callLog.push({ method: req.method ?? "?", path, body: null });

      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const contentType = (req.headers["content-type"] ?? "").toLowerCase();
        let body = null;
        if (raw) {
          if (contentType.includes("application/x-www-form-urlencoded")) {
            body = Object.fromEntries(new URLSearchParams(raw).entries());
          } else {
            body = safeJson(raw);
          }
        }
        if (body !== null) {
          state.callLog[state.callLog.length - 1].body = body;
        }

        try {
          handle(state, req.method ?? "GET", path, u, body, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              errors: [{ msg: "mock server error: " + (err instanceof Error ? err.message : String(err)) }],
            }),
          );
        }
      });
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("mock server did not bind to a TCP port"));
        return;
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        shutdown: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.statusCode = 204;
  res.end();
}

function handle(state, method, path, url, body, res) {
  // GET /api/projects/search
  if (path === "/api/projects/search" && method === "GET") {
    const org = url.searchParams.get("organization");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const filtered = state.projects.filter((p) => {
      if (org && p.organization !== org) return false;
      if (q && !((p.key + " " + p.name).toLowerCase().includes(q))) return false;
      return true;
    });
    return sendJson(res, 200, {
      paging: { pageIndex: 1, pageSize: 30, total: filtered.length },
      components: filtered,
    });
  }

  // GET /api/projects/show?project=...
  if (path === "/api/projects/show" && method === "GET") {
    const key = url.searchParams.get("project");
    const project = state.projects.find((p) => p.key === key);
    if (!project) {
      return sendJson(res, 404, { errors: [{ msg: `Project ${key} not found` }] });
    }
    // SonarQube v1 returns the Component fields at the top level (NOT
    // nested under a `component` key). The client reads them off the
    // response root.
    return sendJson(res, 200, project);
  }

  // GET /api/components/search
  if (path === "/api/components/search" && method === "GET") {
    const component = url.searchParams.get("component");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    if (!component) {
      return sendJson(res, 400, { errors: [{ msg: "component is required" }] });
    }
    const filtered = state.components.filter((c) => {
      if (!c.key.startsWith(component + ":") && c.key !== component) return false;
      if (q && !((c.name + " " + (c.path ?? "")).toLowerCase().includes(q))) return false;
      return true;
    });
    return sendJson(res, 200, {
      paging: { pageIndex: 1, pageSize: 30, total: filtered.length },
      components: filtered,
    });
  }

  // GET /api/measures/component
  if (path === "/api/measures/component" && method === "GET") {
    const component = url.searchParams.get("component");
    const metricKeys = (url.searchParams.get("metricKeys") ?? "").split(",").filter(Boolean);
    if (!component || metricKeys.length === 0) {
      return sendJson(res, 400, { errors: [{ msg: "component and metricKeys are required" }] });
    }
    const c = state.components.find((x) => x.key === component) ?? {
      key: component,
      name: component.split(":").pop() ?? component,
      qualifier: "FIL",
    };
    const measures = metricKeys.map((m) => ({
      metric: m,
      value: m === "coverage" ? "76.5" : m === "ncloc" ? "1240" : "0",
      bestValue: false,
    }));
    return sendJson(res, 200, { component: c, measures });
  }

  // GET /api/issues/search (list and single-issue lookup)
  if (path === "/api/issues/search" && method === "GET") {
    const componentKeys = url.searchParams.get("componentKeys");
    const issuesParam = url.searchParams.get("issues"); // single-issue lookup form
    if (issuesParam) {
      const issue = state.issues.find((i) => i.key === issuesParam);
      return sendJson(res, 200, {
        issues: issue ? [issue] : [],
        paging: { pageIndex: 1, pageSize: 1, total: issue ? 1 : 0 },
      });
    }
    if (!componentKeys) {
      return sendJson(res, 400, { errors: [{ msg: "componentKeys or issues is required" }] });
    }
    const allowed = new Set(componentKeys.split(","));
    const severities = (url.searchParams.get("severities") ?? "").split(",").filter(Boolean);
    const types = (url.searchParams.get("types") ?? "").split(",").filter(Boolean);
    const statuses = (url.searchParams.get("statuses") ?? "").split(",").filter(Boolean);
    const filtered = state.issues.filter((i) => {
      if (!allowed.has(i.project)) return false;
      if (severities.length > 0 && !severities.includes(i.severity)) return false;
      if (types.length > 0 && !types.includes(i.type)) return false;
      if (statuses.length > 0 && !statuses.includes(i.status)) return false;
      return true;
    });
    return sendJson(res, 200, {
      issues: filtered,
      paging: { pageIndex: 1, pageSize: 30, total: filtered.length },
    });
  }

  // POST /api/issues/do_transition
  if (path === "/api/issues/do_transition" && method === "POST") {
    const issueKey = body?.issue;
    const transition = body?.transition;
    if (!issueKey || !transition) {
      return sendJson(res, 400, { errors: [{ msg: "issue and transition are required" }] });
    }
    const issue = state.issues.find((i) => i.key === issueKey);
    if (!issue) {
      return sendJson(res, 404, { errors: [{ msg: `Issue ${issueKey} not found` }] });
    }
    // Apply the transition (simplified — just flip status/resolution to a
    // plausible next state for the smoke test).
    if (transition === "wontfix") {
      issue.status = "RESOLVED";
      issue.resolution = "WONTFIX";
    } else if (transition === "falsepositive") {
      issue.status = "RESOLVED";
      issue.resolution = "FALSE-POSITIVE";
    } else if (transition === "resolve" || transition === "accept" || transition === "close") {
      issue.status = "CLOSED";
      issue.resolution = issue.resolution ?? "FIXED";
    } else if (transition === "reopen") {
      issue.status = "REOPENED";
      issue.resolution = undefined;
    } else if (transition === "confirm") {
      issue.status = "CONFIRMED";
    } else if (transition === "unconfirm") {
      issue.status = "OPEN";
    }
    issue.updateDate = new Date().toISOString();
    return sendNoContent(res);
  }

  // GET /api/qualitygates/project_status
  if (path === "/api/qualitygates/project_status" && method === "GET") {
    const projectKey = url.searchParams.get("projectKey");
    const gate = state.qualityGates[projectKey];
    if (!gate) {
      return sendJson(res, 404, { errors: [{ msg: `No quality gate for project ${projectKey}` }] });
    }
    return sendJson(res, 200, {
      projectStatus: {
        status: gate.status,
        conditions: gate.conditions,
        gated: true,
      },
      qualityGate: { name: gate.gateName ?? "Default" },
    });
  }

  // GET /api/webhooks/deliveries
  if (path === "/api/webhooks/deliveries" && method === "GET") {
    return sendJson(res, 200, {
      deliveries: state.webhookDeliveries,
      paging: { pageIndex: 1, pageSize: 30, total: state.webhookDeliveries.length },
    });
  }

  return sendJson(res, 404, { errors: [{ msg: `mock: no route for ${method} ${path}` }] });
}
