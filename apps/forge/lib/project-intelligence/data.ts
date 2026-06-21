/**
 * Async data loaders for the Project Intelligence (M2+) surface.
 *
 * Replaces `lib/project-intelligence/mock-data.ts` with async fetchers
 * that hit the orchestrator stub. Type declarations are copied verbatim
 * from mock-data.ts so component imports (`type APIEndpoint`, etc.)
 * keep working until mock-data is removed in a later pass.
 *
 * Endpoints (see `bin/orchestrator-stub.py`):
 *   GET /v1/project-intel/repos
 *   GET /v1/project-intel/architecture       (single object)
 *   GET /v1/project-intel/api-endpoints
 *   GET /v1/project-intel/services
 *   GET /v1/project-intel/db-schema          (single object)
 *   GET /v1/project-intel/qa-examples
 *
 * `architecture` and `db-schema` return single objects, so the
 * corresponding helpers wrap them so the consumer code that expects an
 * array can still iterate safely.
 */

export type RepoStatus = 'healthy' | 'stale' | 'failed' | 'ingesting';

export interface Repo {
  id: string;
  name: string;
  url: string;
  status: RepoStatus;
  lastIngestionAt: string;
  bytesIngested: number;
  files: number;
  errors: ReadonlyArray<string>;
}

export interface ServiceNode {
  id: string;
  label: string;
  kind: 'service' | 'component' | 'datastore';
  repoId: string;
  language: string;
  x: number;
  y: number;
}

export interface DependencyEdge {
  id: string;
  source: string;
  target: string;
  /** True if this edge is part of a known cycle (highlight). */
  cycle?: boolean;
}

export interface DependencyGraph {
  services: ReadonlyArray<ServiceNode>;
  edges: ReadonlyArray<DependencyEdge>;
}

export interface APIEndpoint {
  id: string;
  service: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  auth: 'none' | 'api_key' | 'oauth2' | 'jwt';
  description: string;
}

export interface DBColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey?: boolean;
}

export interface DBTable {
  name: string;
  schema: string;
  columns: ReadonlyArray<DBColumn>;
}

export interface DBSchema {
  id: string;
  name: string;
  engine: 'postgres';
  tables: ReadonlyArray<DBTable>;
}

export interface QAExample {
  id: string;
  question: string;
  answer: string;
  sources: ReadonlyArray<{ kind: string; ref: string }>;
}

export interface ServiceSummary {
  id: string;
  name: string;
  repo: string;
  language: string;
  loc: number;
}

const API_BASE =
  process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getList<T>(path: string): Promise<ReadonlyArray<T>> {
  const data = await getJson<ReadonlyArray<T>>(path);
  return data ?? [];
}

export async function listRepos(): Promise<ReadonlyArray<Repo>> {
  return getList<Repo>('/v1/project-intel/repos');
}

export async function getRepo(id: string): Promise<Repo | undefined> {
  const all = await listRepos();
  return all.find((r) => r.id === id);
}

/**
 * `architecture` returns a single `DependencyGraph` object. Most
 * consumers in `components/project-intelligence/` already iterate
 * `services` / `edges` directly, so we return the graph unchanged and
 * expose a list-of-one shape via `listDependencyGraphs` for any caller
 * that wants to mirror the mock `ARCH` array shape.
 */
export async function getArchitecture(): Promise<DependencyGraph> {
  const data = await getJson<DependencyGraph>('/v1/project-intel/architecture');
  return (
    data ?? {
      services: [],
      edges: [],
    }
  );
}

export async function listDependencyGraphs(): Promise<
  ReadonlyArray<DependencyGraph>
> {
  const graph = await getArchitecture();
  return graph.services.length === 0 && graph.edges.length === 0
    ? []
    : [graph];
}

export async function listAPIEndpoints(): Promise<ReadonlyArray<APIEndpoint>> {
  return getList<APIEndpoint>('/v1/project-intel/api-endpoints');
}

export async function listServices(): Promise<ReadonlyArray<ServiceSummary>> {
  return getList<ServiceSummary>('/v1/project-intel/services');
}

export async function getDBSchema(): Promise<DBSchema> {
  const data = await getJson<DBSchema>('/v1/project-intel/db-schema');
  return (
    data ?? {
      id: 'db-empty',
      name: 'empty',
      engine: 'postgres',
      tables: [],
    }
  );
}

export async function listDBSchemas(): Promise<ReadonlyArray<DBSchema>> {
  const schema = await getDBSchema();
  return schema.tables.length === 0 ? [] : [schema];
}

export async function listQAExamples(): Promise<ReadonlyArray<QAExample>> {
  return getList<QAExample>('/v1/project-intel/qa-examples');
}
