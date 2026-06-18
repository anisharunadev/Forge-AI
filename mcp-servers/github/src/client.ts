/**
 * Typed GitHub API client, scoped to a single org.
 *
 * The MCP server only ever calls these methods. Every method takes an `org`
 * arg that the caller is expected to fill from the pinned config — not from
 * agent input. If a tool ever accepts an `owner` arg from the model, it is
 * asserted against the pinned org before any call lands.
 */

import { Octokit } from "@octokit/rest";
import type { Config } from "./config.js";

export class OrgScopeError extends Error {
  constructor(requestedOrg: string, allowedOrg: string) {
    super(
      `Refusing to act on org '${requestedOrg}' — this server is pinned to '${allowedOrg}'.`,
    );
    this.name = "OrgScopeError";
  }
}

export class LabelNotFoundError extends Error {
  constructor(owner: string, repo: string, labels: string[]) {
    super(
      `Labels not found in ${owner}/${repo}: ${labels.join(", ")}. ` +
        `GraphQL createIssue requires labels to exist in the repo first.`,
    );
    this.name = "LabelNotFoundError";
  }
}

export interface Client {
  listRepos(args?: { per_page?: number; page?: number; type?: "all" | "public" | "private" }): Promise<RepoSummary[]>;
  getPr(args: { owner: string; repo: string; pull_number: number }): Promise<PullRequestDetail>;
  listPrs(args: { owner: string; repo: string; state?: "open" | "closed" | "all"; per_page?: number; page?: number }): Promise<PullRequestSummary[]>;
  createPrComment(args: { owner: string; repo: string; pull_number: number; body: string }): Promise<{ id: number; html_url: string }>;
  listIssues(args: { owner: string; repo: string; state?: "open" | "closed" | "all"; per_page?: number; page?: number }): Promise<IssueSummary[]>;
  createIssue(args: { owner: string; repo: string; title: string; body?: string; labels?: string[] }): Promise<IssueCreated>;
  searchCode(args: { q: string; per_page?: number; page?: number }): Promise<CodeSearchHit[]>;
}

export interface RepoSummary {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  user: { login: string };
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface PullRequestDetail extends PullRequestSummary {
  body: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable: boolean | null;
}

export interface IssueSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  user: { login: string };
  html_url: string;
  created_at: string;
  labels: { name: string }[];
}

export interface IssueCreated {
  number: number;
  title: string;
  html_url: string;
  state: "open";
}

export interface CodeSearchHit {
  name: string;
  path: string;
  repository: { full_name: string };
  html_url: string;
  score: number;
}

/**
 * Octokit emits `[@octokit/request] "GET …/search/code…" is deprecated. It is
 * scheduled to be removed on Sun, 27 Sep 2026` on every `/search/code` call
 * because GitHub returns a `Deprecation` / `Sunset` header for that endpoint
 * (see FORA-13 and `fetch-wrapper.js` in @octokit/request 9.x).
 *
 * The header is GitHub's signal that specific response fields and query
 * parameters are closing down — `repository.description`,
 * `repository.owner.type`, `repository.owner.node_id`, the `sort` parameter,
 * and the `order` parameter — none of which we consume. `toCodeSearchHit`
 * only reads `name`, `path`, `repository.full_name`, `html_url`, and `score`,
 * all of which remain supported. The endpoint itself is not scheduled for
 * removal in GitHub's published REST breaking-change list.
 *
 * Until GitHub publishes a true endpoint replacement (the public GraphQL API
 * does not currently expose `type: CODE` outside of preview, and the new Code
 * Search API is not GA), we suppress this specific warning at source so the
 * live smoke is clean and so customer log streams aren't spammed every call.
 * Every other Octokit warning still flows through to stderr unchanged.
 *
 * The decision and the re-evaluation milestone are tracked in FORA-13.
 */
export const SEARCH_CODE_DEPRECATION_PATTERN =
  /\[@octokit\/request\][^\n]*\/search\/code[^\n]*deprecated/i;

function buildOctokitLog() {
  // Match Octokit's defaults: debug/info are no-ops, warn/error go to stderr
  // via console. The only override is `warn`, which drops the `/search/code`
  // deprecation line and passes everything else through.
  return {
    debug: (_msg: string, _info?: unknown) => {},
    info: (_msg: string, _info?: unknown) => {},
    warn: (msg: string, info?: unknown) => {
      if (typeof msg === "string" && SEARCH_CODE_DEPRECATION_PATTERN.test(msg)) {
        return; // intentionally swallowed — see comment above
      }
      if (info !== undefined) console.warn(msg, info);
      else console.warn(msg);
    },
    error: (msg: string, info?: unknown) => {
      if (info !== undefined) console.error(msg, info);
      else console.error(msg);
    },
  };
}

export function createClient(config: Config): { client: Client; org: string } {
  const octokitLog = buildOctokitLog();
  const octokit = new Octokit({
    auth: config.token,
    userAgent: config.userAgent,
    baseUrl: config.apiBaseUrl ?? "https://api.github.com",
    // Pin the REST API version so the deprecation timelines we read against
    // GitHub's docs match the version we're actually requesting. 2022-11-28
    // is the latest stable; bump when we're ready to opt into a newer one.
    request: {
      headers: { "x-github-api-version": "2022-11-28" },
      // @octokit/request's fetch-wrapper reads `log` from this per-request
      // slot, NOT from the Octokit constructor's `log` option. Without
      // threading it through here, the suppression in buildOctokitLog is
      // silently bypassed and every deprecation header (FORA-13, FORA-14)
      // reaches stderr.
      log: octokitLog,
    },
    log: octokitLog,
  });

  const assertOrg = (owner: string) => {
    if (owner.toLowerCase() !== config.org.toLowerCase()) {
      throw new OrgScopeError(owner, config.org);
    }
  };

  // Cache `repositoryId` per `owner/repo`. Node IDs are immutable for the
  // lifetime of the repo, so caching for the process lifetime is safe and
  // saves one GraphQL query per create_issue after the first call.
  const repoIdCache = new Map<string, string>();

  const client: Client = {
    async listRepos({ per_page = 30, page = 1, type = "all" } = {}) {
      const res = await octokit.request("GET /orgs/{org}/repos", {
        org: config.org,
        per_page,
        page,
        type,
      });
      return (res.data as Array<Record<string, unknown>>).map(toRepoSummary);
    },

    async getPr({ owner, repo, pull_number }) {
      assertOrg(owner);
      const res = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner,
        repo,
        pull_number,
      });
      return toPrDetail(res.data as Record<string, unknown>);
    },

    async listPrs({ owner, repo, state = "open", per_page = 30, page = 1 }) {
      assertOrg(owner);
      const res = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
        owner,
        repo,
        state,
        per_page,
        page,
      });
      return (res.data as Array<Record<string, unknown>>).map(toPrSummary);
    },

    async createPrComment({ owner, repo, pull_number, body }) {
      assertOrg(owner);
      const res = await octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        { owner, repo, issue_number: pull_number, body },
      );
      return { id: res.data.id as number, html_url: res.data.html_url as string };
    },

    async listIssues({ owner, repo, state = "open", per_page = 30, page = 1 }) {
      assertOrg(owner);
      const res = await octokit.request("GET /repos/{owner}/{repo}/issues", {
        owner,
        repo,
        state,
        per_page,
        page,
      });
      return (res.data as Array<Record<string, unknown>>).map(toIssueSummary);
    },

    async createIssue({ owner, repo, title, body, labels }) {
      assertOrg(owner);
      // Migrated off REST `POST /repos/{owner}/{repo}/issues` (deprecated by
      // GitHub, sunset 10 Mar 2028) to the GraphQL `createIssue` mutation.
      // Octokit reuses the same authed request stack for `octokit.graphql`,
      // so no extra dep or token plumbing is needed.
      //
      // GraphQL requires the repository's Node ID (and label Node IDs).
      // We look both up in a single query, then call the mutation.
      const labelNames = labels ?? [];
      const { repositoryId, labelIds } = await resolveRepoAndLabels(
        octokit,
        repoIdCache,
        owner,
        repo,
        labelNames,
      );

      const mutation = `mutation CreateIssue($input: CreateIssueInput!) {
        createIssue(input: $input) {
          issue {
            number
            title
            url
            state
          }
        }
      }`;
      const input: Record<string, unknown> = { repositoryId, title };
      if (body !== undefined) input.body = body;
      if (labelIds.length > 0) input.labelIds = labelIds;

      const res = await octokit.graphql<{
        createIssue: {
          issue: {
            number: number;
            title: string;
            url: string;
            state: "OPEN" | "CLOSED";
          };
        };
      }>(mutation, { input });
      const issue = res.createIssue.issue;
      return {
        number: issue.number,
        title: issue.title,
        html_url: issue.url,
        // GraphQL returns IssueState (OPEN/CLOSED); a freshly created issue is
        // always OPEN, but we normalise just in case GitHub ever extends this.
        state: "open" as const,
      };
    },

    async searchCode({ q, per_page = 30, page = 1 }) {
      // GitHub's code search requires a `user:` or `org:` qualifier; we append
      // the pinned org automatically so the model can't escape scope.
      const scopedQ = q.includes(`org:${config.org}`)
        ? q
        : `${q} org:${config.org}`;
      const res = await octokit.request("GET /search/code", {
        q: scopedQ,
        per_page,
        page,
      });
      return ((res.data as { items?: Array<Record<string, unknown>> }).items ?? []).map(
        toCodeSearchHit,
      );
    },
  };

  return { client, org: config.org };
}

function toRepoSummary(r: Record<string, unknown>): RepoSummary {
  return {
    id: r.id as number,
    name: r.name as string,
    full_name: r.full_name as string,
    private: Boolean(r.private),
    default_branch: (r.default_branch as string) ?? "main",
    html_url: r.html_url as string,
  };
}

function toPrSummary(pr: Record<string, unknown>): PullRequestSummary {
  return {
    number: pr.number as number,
    title: pr.title as string,
    state: pr.state as "open" | "closed",
    user: { login: (pr.user as { login: string }).login },
    head: {
      ref: (pr.head as { ref: string }).ref,
      sha: (pr.head as { sha: string }).sha,
    },
    base: { ref: (pr.base as { ref: string }).ref },
    html_url: pr.html_url as string,
    created_at: pr.created_at as string,
    updated_at: pr.updated_at as string,
  };
}

function toPrDetail(pr: Record<string, unknown>): PullRequestDetail {
  return {
    ...toPrSummary(pr),
    body: (pr.body as string | null) ?? null,
    additions: (pr.additions as number) ?? 0,
    deletions: (pr.deletions as number) ?? 0,
    changed_files: (pr.changed_files as number) ?? 0,
    mergeable: (pr.mergeable as boolean | null) ?? null,
  };
}

function toIssueSummary(i: Record<string, unknown>): IssueSummary {
  return {
    number: i.number as number,
    title: i.title as string,
    state: i.state as "open" | "closed",
    user: { login: (i.user as { login: string }).login },
    html_url: i.html_url as string,
    created_at: i.created_at as string,
    labels: ((i.labels as Array<{ name: string }>) ?? []).map((l) => ({
      name: l.name,
    })),
  };
}

function toCodeSearchHit(h: Record<string, unknown>): CodeSearchHit {
  return {
    name: h.name as string,
    path: h.path as string,
    repository: {
      full_name: (h.repository as { full_name: string }).full_name,
    },
    html_url: h.html_url as string,
    score: (h.score as number) ?? 0,
  };
}

/**
 * One-shot GraphQL lookup that returns the repo's Node ID and the Node IDs
 * for every requested label name. Repo IDs are immutable and worth caching
 * for the process lifetime; label IDs are looked up fresh because labels can
 * be renamed/recreated and we want createIssue to fail fast when a label
 * name no longer exists (matching the prior REST 422 behavior).
 *
 * Labels are aliased into the same query so we still make at most ONE round
 * trip per create_issue call after the repo ID is cached.
 *
 * @param octokit - Authenticated Octokit; `octokit.graphql` is inherited from
 *   @octokit/core and reuses the same auth as REST calls.
 */
async function resolveRepoAndLabels(
  octokit: Octokit,
  cache: Map<string, string>,
  owner: string,
  repo: string,
  labelNames: string[],
): Promise<{ repositoryId: string; labelIds: string[] }> {
  const cacheKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  const cachedId = cache.get(cacheKey);

  // Alias every requested label as `label0`, `label1`, … so we get back a
  // map of fields we can correlate by index. Label names are passed as
  // GraphQL variables (string-typed) so a malicious name can't inject query
  // syntax — the GraphQL parser handles escaping.
  const labelAliases = labelNames.map((_, i) => `label${i}`);
  const labelVarDecls = labelNames.map((_, i) => `$labelName${i}: String!`);
  const labelSelections = labelNames
    .map((_, i) => `${labelAliases[i]}: label(name: $labelName${i}) { id }`)
    .join("\n          ");

  const needRepoLookup = cachedId === undefined;
  const needLabelLookup = labelNames.length > 0;

  // Nothing to ask GitHub if the repo is cached and no labels are requested.
  if (!needRepoLookup && !needLabelLookup) {
    return { repositoryId: cachedId, labelIds: [] };
  }

  const query = `query ResolveRepoAndLabels(
    $owner: String!
    $repo: String!
    ${labelVarDecls.join("\n    ")}
  ) {
    repository(owner: $owner, name: $repo) {
      id
      ${labelSelections}
    }
  }`;

  const variables: Record<string, unknown> = { owner, repo };
  labelNames.forEach((name, i) => {
    variables[`labelName${i}`] = name;
  });

  const res = await octokit.graphql<{
    repository: { id: string } & Record<string, { id: string } | null>;
  }>(query, variables);

  if (!res.repository) {
    throw new Error(`Repository not found: ${owner}/${repo}`);
  }
  const repositoryId = res.repository.id;
  cache.set(cacheKey, repositoryId);

  const labelIds: string[] = [];
  const missing: string[] = [];
  labelNames.forEach((name, i) => {
    const lookup = res.repository[labelAliases[i]];
    if (lookup && typeof lookup === "object" && "id" in lookup) {
      labelIds.push(lookup.id);
    } else {
      missing.push(name);
    }
  });
  if (missing.length > 0) {
    throw new LabelNotFoundError(owner, repo, missing);
  }
  return { repositoryId, labelIds };
}
