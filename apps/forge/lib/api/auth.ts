/**
 * Auth store (Zustand) — Zone 2 (step-52).
 *
 * Holds the four pieces of state every authenticated page depends on:
 *
 *   - `user`     — current principal
 *   - `tenant`   — active workspace (Rule 2: never optional)
 *   - `token`    — short-lived bearer token (localStorage)
 *   - `refreshToken` — long-lived refresh token (localStorage)
 *
 * Why localStorage and not httpOnly cookies?
 *   The goal file's CONSTRAINTS section is explicit: "Tokens stored in
 *   localStorage (for now) — consider httpOnly cookies in production."
 *   Production migration is tracked as a follow-up; we keep the surface
 *   here so the swap is mechanical (replace the four reads/writes with
 *   cookie reads).
 *
 * Why a Zustand store instead of a React Context?
 *   - Non-React callers (the API client, vitest, scripts) need access
 *     to the token without going through React's render cycle. Zustand's
 *     `getState()` / `setState()` outside React is one line.
 *   - SSR-safe initial state: we read from localStorage on first render
 *     only. Server renders see `null` and rehydrate after mount.
 *
 * The `bindAuthAccessor` registration on import is what wires the
 * `client.ts` request loop to this store (Zone 7 — refresh + 401
 * intercept) without introducing an import cycle.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { api, ApiError, bindAuthAccessor, FORGE_API_BASE_URL } from './client';

// ---------------------------------------------------------------------------
// Types — mirror the planned backend schemas in
// `backend/app/schemas/auth.py`. Fields are kept permissive until those
// schemas land; consumers should treat `role` as a coarse RBAC hint, not
// the source of truth (the backend enforces).
// ---------------------------------------------------------------------------

export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role: UserRole;
}

export type TenantPlan = 'free' | 'pro' | 'enterprise';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: TenantPlan;
  region: string;
  logo_url?: string;
}

export interface Project {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description?: string | null;
  default_branch: string;
  visibility: 'private' | 'internal' | 'public';
  status: string;
  created_at: string;
  updated_at: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  /** step-65: RS256 proxy_token returned alongside the access/refresh pair. */
  proxy_token?: string | null;
  token_type?: string;
  expires_in?: number;
}

export interface OAuthProvider {
  provider: 'google' | 'github' | 'microsoft';
  /** Return URL the provider should bounce back to. */
  return_url: string;
}

export interface SwitchTenantResponse {
  tenant: Tenant;
  access_token: string;
}

// ---------------------------------------------------------------------------
// Storage keys — kept in one place so the production migration to
// httpOnly cookies can find them.
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'forge_token';
const REFRESH_KEY = 'forge_refresh';
const PROXY_TOKEN_KEY = 'forge_proxy_token';
const USER_KEY = 'forge_user';
const TENANT_KEY = 'forge_tenant';
const PROJECT_KEY = 'forge_project';

// Safe localStorage access for SSR (Next.js renders on the server first;
// reading localStorage there throws).
function safeRead<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeReadString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota exceeded — silent */
  }
}

function safeRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// AuthState + actions
// ---------------------------------------------------------------------------

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  project: Project | null;
  token: string | null;
  refreshToken: string | null;
  /** step-65: RS256 proxy_token for the LiteLLM Proxy.  Persisted to
   * localStorage alongside the access token; rotated by
   * ``refreshSession``. */
  proxyToken: string | null;
  isLoading: boolean;
  /** Hydration flag — true once Zustand has rehydrated from storage. */
  _hasHydrated: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  loginWithOAuth: (provider: OAuthProvider['provider']) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
  fetchCurrentUser: () => Promise<void>;
  /** Called by the `persist` middleware once storage has rehydrated. */
  _setHasHydrated: (hasHydrated: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers exported for non-React callers (Zone 1 wiring).
// ---------------------------------------------------------------------------

export const auth = {
  getToken: (): string | null => useAuth.getState().token,
  getTenantId: (): string | null => useAuth.getState().tenant?.id ?? null,
  getProjectId: (): string | null => useAuth.getState().project?.id ?? null,
  getUser: (): User | null => useAuth.getState().user,
  getTenant: (): Tenant | null => useAuth.getState().tenant,
  getProject: (): Project | null => useAuth.getState().project,
  logout: (): void => useAuth.getState().logout(),
};

/**
 * Lists the tenants the current user belongs to — thin wrapper around
 * `GET /auth/me/tenants` for non-React callers (e.g. TanStack Query
 * queryFn in client components). step-61 Zone 10 wired this through
 * WorkspaceSelector; see also `fetchCurrentUser` for the store-side path.
 */
export const listMyTenants = (): Promise<Tenant[]> =>
  api.get<Tenant[]>('/auth/me/tenants');

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: safeRead<User>(USER_KEY),
      tenant: safeRead<Tenant>(TENANT_KEY),
      project: safeRead<Project>(PROJECT_KEY),
      token: safeReadString(TOKEN_KEY),
      refreshToken: safeReadString(REFRESH_KEY),
      proxyToken: safeReadString(PROXY_TOKEN_KEY),
      isLoading: false,
      _hasHydrated: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          // The login endpoint intentionally does NOT send an Authorization
          // header — `suppressAuthRedirect` also tells the client not to
          // bounce to /login on a 401 (we're already on it).
          const res = await api.post<LoginResponse>(
            '/auth/login',
            { email, password },
            { suppressAuthRedirect: true },
          );
          safeWrite(TOKEN_KEY, res.access_token);
          safeWrite(REFRESH_KEY, res.refresh_token);
          if (res.proxy_token) {
            safeWrite(PROXY_TOKEN_KEY, res.proxy_token);
          }
          set({
            token: res.access_token,
            refreshToken: res.refresh_token,
            proxyToken: res.proxy_token ?? null,
          });
          await get().fetchCurrentUser();
        } finally {
          set({ isLoading: false });
        }
      },

      loginWithOAuth: async (provider) => {
        // Redirect to OAuth provider. The provider bounces back to
        // `/auth/callback?token=…&refresh=…` where Zone 4 stores them.
        const returnUrl =
          typeof window !== 'undefined'
            ? `${window.location.origin}/auth/callback`
            : '/auth/callback';
        const url = `${FORGE_API_BASE_URL}/auth/oauth/${provider}?return_url=${encodeURIComponent(
          returnUrl,
        )}`;
        if (typeof window !== 'undefined') {
          window.location.href = url;
        }
      },

      logout: () => {
        safeRemove(TOKEN_KEY);
        safeRemove(REFRESH_KEY);
        safeRemove(PROXY_TOKEN_KEY);
        safeRemove(USER_KEY);
        safeRemove(TENANT_KEY);
        safeRemove(PROJECT_KEY);
        set({
          user: null,
          tenant: null,
          project: null,
          token: null,
          refreshToken: null,
          proxyToken: null,
        });
      },

      refreshSession: async () => {
        const refresh = get().refreshToken;
        if (!refresh) {
          throw new ApiError(401, 'No refresh token', null, 'no_refresh_token');
        }
        // Avoid recursive 401 handling on the refresh endpoint itself.
        const res = await api.post<{ access_token: string; proxy_token?: string | null }>(
          '/auth/refresh',
          { refresh_token: refresh },
          { suppressAuthRedirect: true },
        );
        safeWrite(TOKEN_KEY, res.access_token);
        if (res.proxy_token) {
          safeWrite(PROXY_TOKEN_KEY, res.proxy_token);
        }
        set({
          token: res.access_token,
          proxyToken: res.proxy_token ?? null,
        });
      },

      switchTenant: async (tenantId) => {
        const res = await api.post<SwitchTenantResponse>(
          `/tenants/${encodeURIComponent(tenantId)}/switch`,
        );
        safeWrite(TOKEN_KEY, res.access_token);
        safeWrite(TENANT_KEY, JSON.stringify(res.tenant));
        set({ tenant: res.tenant, token: res.access_token });
        // Reload to force every TanStack Query + Zustand store that
        // depends on tenant-id keys to refetch with the new header.
        // This is the documented behaviour in the goal file.
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      },

      switchProject: async (projectId) => {
        const res = await api.get<Project>(
          `/projects/${encodeURIComponent(projectId)}`,
        );
        safeWrite(PROJECT_KEY, JSON.stringify(res));
        set({ project: res });
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      },

      fetchCurrentUser: async () => {
        const user = await api.get<User>('/auth/me');
        let tenant: Tenant | null = get().tenant;
        try {
          const tenants = await api.get<Tenant[]>('/auth/me/tenants');
          // Prefer the persisted active tenant when still valid; else
          // fall back to the first tenant in the user's list.
          const activeId = get().tenant?.id;
          const matched = tenants.find((t) => t.id === activeId);
          tenant = matched ?? tenants[0] ?? null;
        } catch {
          /* tenants endpoint may be unavailable in dev — keep current */
        }
        safeWrite(USER_KEY, JSON.stringify(user));
        if (tenant) {
          safeWrite(TENANT_KEY, JSON.stringify(tenant));
        }

        // step-62 — load the persisted project, or pick the first
        // project in the tenant if none is pinned yet.
        let project: Project | null = get().project;
        try {
          const projects = await api.get<Project[]>('/projects');
          const persistedId = get().project?.id;
          const matched = projects.find((p) => p.id === persistedId);
          project = matched ?? projects[0] ?? null;
        } catch {
          /* projects endpoint may be unavailable in dev */
        }
        if (project) {
          safeWrite(PROJECT_KEY, JSON.stringify(project));
        }

        set({ user, tenant, project });
      },

      _setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),
    }),
    {
      name: 'forge-auth',
      storage: createJSONStorage(() =>
        // SSR-safe storage adapter. Falls back to an in-memory shim on
        // the server so the `persist` middleware doesn't throw during
        // the first server render.
        typeof window !== 'undefined'
          ? window.localStorage
          : {
              getItem: () => null,
              setItem: () => undefined,
              removeItem: () => undefined,
            },
      ),
      // Persist ONLY the user/tenant/token/refreshToken/proxyToken
      // fields. Action functions and ephemeral flags (`isLoading`,
      // `_hasHydrated`) are recomputed on each mount.
      partialize: (state) => ({
        user: state.user,
        tenant: state.tenant,
        project: state.project,
        token: state.token,
        refreshToken: state.refreshToken,
        proxyToken: state.proxyToken,
      }),
      onRehydrateStorage: () => (state) => {
        state?._setHasHydrated(true);
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Bind the auth accessor into the API client (Zone 1 ↔ Zone 2 wiring).
// Done at module-load time so the client never has to import this file
// directly (which would create a cycle).
// ---------------------------------------------------------------------------

bindAuthAccessor({
  getToken: () => useAuth.getState().token,
  getTenantId: () => useAuth.getState().tenant?.id ?? null,
  refreshSession: async () => {
    await useAuth.getState().refreshSession();
  },
  logout: () => useAuth.getState().logout(),
});