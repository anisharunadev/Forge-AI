> **Status:** completed
import { start } from "repl"

/goal

Wire the Forge frontend to the real backend auth + tenant system. Currently all data is mocked — start with the foundation that unblocks every other API call. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "JWT auth login token refresh interceptor secure storage" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "multi-tenant data scoping context provider React" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "API client error handling retry network failure UX" --domain ux-guideline -f markdown

Adopt every rule. Then implement:

==========================================================
ZONE 1 — API CLIENT SETUP
==========================================================

Create src/lib/api/client.ts — the foundation of all API calls:

```typescript
// src/lib/api/client.ts
import { auth } from './auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_BASE_URL || 'ws://localhost:8000/ws';

class ApiError extends Error {
  constructor(public status: number, public detail: string, public code?: string) {
    super(`${status}: ${detail}`);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = auth.getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    
    // Auto-logout on 401
    if (res.status === 401) {
      auth.logout();
      window.location.href = '/login';
    }
    
    throw new ApiError(res.status, body.detail || res.statusText, body.code);
  }
  
  // Handle 204 No Content
  if (res.status === 204) return undefined as T;
  
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: any) => 
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: any) => 
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: any) => 
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  
  // WebSocket helper
  ws: (path: string) => {
    const token = auth.getToken();
    const ws = new WebSocket(`${WS_BASE_URL}${path}?token=${token}`);
    return ws;
  },
};

export { ApiError, API_BASE_URL };

========================================================== ZONE 2 — AUTH STORE
Create src/lib/api/auth.ts — manages tokens + current user + tenant:

typescript

Copy
// src/lib/api/auth.ts

import { create } from 'zustand';

import { api, ApiError } from './client';


export interface User {

  id: string;

  email: string;

  name: string;

  avatar_url?: string;

  role: 'owner' | 'admin' | 'editor' | 'viewer';

}


export interface Tenant {

  id: string;

  slug: string;

  name: string;

  plan: 'free' | 'pro' | 'enterprise';

  region: string;

  logo_url?: string;

}


interface AuthState {

  user: User | null;

  tenant: Tenant | null;

  token: string | null;

  refreshToken: string | null;

  isLoading: boolean;

  

  // Actions

  login: (email: string, password: string) => Promise<void>;

  loginWithOAuth: (provider: 'google' | 'github' | 'microsoft') => Promise<void>;

  logout: () => void;

  refreshSession: () => Promise<void>;

  switchTenant: (tenantId: string) => Promise<void>;

  fetchCurrentUser: () => Promise<void>;

}


const TOKEN_KEY = 'forge_token';

const REFRESH_KEY = 'forge_refresh';

const USER_KEY = 'forge_user';

const TENANT_KEY = 'forge_tenant';


export const useAuth = create<AuthState>((set, get) => ({

  user: JSON.parse(localStorage.getItem(USER_KEY) || 'null'),

  tenant: JSON.parse(localStorage.getItem(TENANT_KEY) || 'null'),

  token: localStorage.getItem(TOKEN_KEY),

  refreshToken: localStorage.getItem(REFRESH_KEY),

  isLoading: false,


  login: async (email, password) => {

    set({ isLoading: true });

    try {

      const res = await api.post<{ access_token: string; refresh_token: string }>('/auth/login', {

        email,

        password,

      });

      localStorage.setItem(TOKEN_KEY, res.access_token);

      localStorage.setItem(REFRESH_KEY, res.refresh_token);

      set({ token: res.access_token, refreshToken: res.refresh_token });

      await get().fetchCurrentUser();

    } finally {

      set({ isLoading: false });

    }

  },


  loginWithOAuth: async (provider) => {

    // Redirect to OAuth provider

    window.location.href = `${API_BASE_URL}/auth/oauth/${provider}?return_url=${window.location.origin}/auth/callback`;

  },


  logout: () => {

    localStorage.removeItem(TOKEN_KEY);

    localStorage.removeItem(REFRESH_KEY);

    localStorage.removeItem(USER_KEY);

    localStorage.removeItem(TENANT_KEY);

    set({ user: null, tenant: null, token: null, refreshToken: null });

  },


  refreshSession: async () => {

    const refresh = get().refreshToken;

    if (!refresh) throw new Error('No refresh token');

    const res = await api.post<{ access_token: string }>('/auth/refresh', {

      refresh_token: refresh,

    });

    localStorage.setItem(TOKEN_KEY, res.access_token);

    set({ token: res.access_token });

  },


  switchTenant: async (tenantId) => {

    const res = await api.post<{ tenant: Tenant; access_token: string }>(`/tenants/${tenantId}/switch`);

    localStorage.setItem(TOKEN_KEY, res.access_token);

    localStorage.setItem(TENANT_KEY, JSON.stringify(res.tenant));

    set({ tenant: res.tenant, token: res.access_token });

    // Force refetch of tenant-scoped data

    window.location.reload();

  },


  fetchCurrentUser: async () => {

    const user = await api.get<User>('/auth/me');

    const tenants = await api.get<Tenant[]>('/auth/me/tenants');

    const tenant = tenants[0]; // Active tenant

    localStorage.setItem(USER_KEY, JSON.stringify(user));

    localStorage.setItem(TENANT_KEY, JSON.stringify(tenant));

    set({ user, tenant });

  },

}));


// Helper functions for non-React contexts

export const auth = {

  getToken: () => useAuth.getState().token,

  logout: () => useAuth.getState().logout(),

};
========================================================== ZONE 3 — LOGIN PAGE
Create src/app/(auth)/login/page.tsx:

LAYOUT (--bg-base, full screen, centered):

Logo + "Forge AI" branding (top)
"Welcome back" h1 --text-2xl font-700
Sub: "Sign in to your workspace"
FORM (--bg-elevated, --radius-xl, p-32px, max-w-440px):
Email (Input, focus state)
Password (Input with eye icon to show/hide)
"Forgot password?" link
"Sign in" primary button (full width, h-48px, --accent-primary)
Divider "or"
3 OAuth buttons: "Continue with Google" / "Continue with GitHub" / "Continue with Microsoft"
"Don't have an account? Sign up" link
Footer: "By signing in, you agree to Terms and Privacy Policy"
ERROR STATES:

Invalid credentials: rose alert above form
Account locked: "Account locked. Contact support."
2FA required: redirect to /auth/2fa
Email not verified: "Please verify your email first. [Resend verification]"
========================================================== ZONE 4 — AUTH CALLBACK (OAuth)
Create src/app/(auth)/auth/callback/page.tsx:

Receives ?token=... from OAuth provider
Stores token via auth store
Redirects to /dashboard (or original requested URL)
========================================================== ZONE 5 — AUTH ROUTE PROTECTION
Create src/components/auth-guard.tsx:

typescript

Copy
// HOC that wraps protected pages

'use client';

import { useEffect } from 'react';

import { useRouter, usePathname } from 'next/navigation';

import { useAuth } from '@/lib/api/auth';


export function AuthGuard({ children }: { children: React.ReactNode }) {

  const router = useRouter();

  const pathname = usePathname();

  const { user, token } = useAuth();


  useEffect(() => {

    if (!token) {

      // Save intended URL for after login

      sessionStorage.setItem('return_url', pathname);

      router.push('/login');

    }

  }, [token, pathname, router]);


  if (!user) {

    return <FullPageSpinner />;

  }


  return <>{children}</>;

}
WRAP the root layout (or specific page groups):

typescript

Copy
// src/app/(workspace)/layout.tsx

import { AuthGuard } from '@/components/auth-guard';


export default function WorkspaceLayout({ children }) {

  return <AuthGuard>{children}</AuthGuard>;

}
========================================================== ZONE 6 — TENANT SWITCHER (in top nav)
The current "tenant selector" Command-style button in the top bar is mocked. Wire it up:

typescript

Copy
// src/components/tenant-switcher.tsx

'use client';

import { useState } from 'react';

import { useAuth } from '@/lib/api/auth';

import { api } from '@/lib/api/client';


export function TenantSwitcher() {

  const { tenant, switchTenant } = useAuth();

  const [open, setOpen] = useState(false);

  const [tenants, setTenants] = useState<Tenant[]>([]);

  

  // Fetch user's tenants when opened

  const loadTenants = async () => {

    const list = await api.get<Tenant[]>('/auth/me/tenants');

    setTenants(list);

  };

  

  return (

    <Popover open={open} onOpenChange={setOpen}>

      <PopoverTrigger asChild>

        <Button onClick={loadTenants}>

          <Avatar src={tenant?.logo_url} />

          <span>{tenant?.name}</span>

          <ChevronDown />

        </Button>

      </PopoverTrigger>

      <PopoverContent>

        {tenants.map(t => (

          <button key={t.id} onClick={() => switchTenant(t.id)}>

            <Avatar src={t.logo_url} />

            <span>{t.name}</span>

            <span>{t.plan}</span>

            {t.id === tenant?.id && <Check />}

          </button>

        ))}

        <Separator />

        <button>+ Create new workspace</button>

      </PopoverContent>

    </Popover>

  );

}
========================================================== ZONE 7 — SESSION MANAGEMENT
In src/lib/api/client.ts, add automatic token refresh:

typescript

Copy
let isRefreshing = false;

let refreshPromise: Promise<string> | null = null;


async function refreshAccessToken(): Promise<string> {

  if (isRefreshing && refreshPromise) return refreshPromise;

  

  isRefreshing = true;

  refreshPromise = useAuth.getState().refreshSession()

    .then(() => useAuth.getState().token!)

    .finally(() => {

      isRefreshing = false;

      refreshPromise = null;

    });

  

  return refreshPromise;

}


// In request():

if (res.status === 401 && !options._isRetry) {

  // Try to refresh

  try {

    await refreshAccessToken();

    return request(path, { ...options, _isRetry: true });

  } catch {

    auth.logout();

    window.location.href = '/login';

  }

}
========================================================== ZONE 8 — UPDATE TOP BAR USER MENU
The current "Arun" avatar in the top bar is mocked. Wire it up:

typescript

Copy
// src/components/user-menu.tsx

export function UserMenu() {

  const { user, tenant, logout, switchTenant } = useAuth();

  

  return (

    <DropdownMenu>

      <DropdownMenuTrigger>

        <Avatar src={user?.avatar_url} fallback={user?.name?.[0]} />

        <span>{user?.name}</span>

      </DropdownMenuTrigger>

      <DropdownMenuContent>

        <DropdownMenuLabel>

          {user?.name}

          <span>{user?.email}</span>

        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem>Profile settings</DropdownMenuItem>

        <DropdownMenuItem>Switch workspace</DropdownMenuItem>

        <DropdownMenuItem>Keyboard shortcuts</DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={logout} className="text-rose-400">

          Sign out

        </DropdownMenuItem>

      </DropdownMenuContent>

    </DropdownMenu>

  );

}
========================================================== ZONE 9 — ERROR BOUNDARY + TOAST
Create src/components/api-error-boundary.tsx + src/components/api-toast.tsx:

Catch API errors globally
Show toast on transient errors: "Network error — retrying..."
Show full error page on auth failures
Error reporting: Sentry or similar (optional)
========================================================== ZONE 10 — BACKEND DEPENDENCY CHECK
Verify the backend has these endpoints (check the FastAPI app):

Required endpoints:

POST /api/v1/auth/login
POST /api/v1/auth/refresh
GET /api/v1/auth/me
GET /api/v1/auth/me/tenants
POST /api/v1/auth/logout
POST /api/v1/auth/oauth/{provider}
POST /api/v1/tenants/{id}/switch
If any are missing, add them to the FastAPI router.

========================================================== CONSTRAINTS
Tokens stored in localStorage (for now) — consider httpOnly cookies in production
No real password validation client-side (server is source of truth)
All API calls go through the typed client (no direct fetch in components)
WebSocket auth uses token in query param (server validates)
Don't break existing mock data display (during the transition)
Logout clears ALL state (user, tenant, tokens)
========================================================== DELIVERABLE
files modified, new files in src/lib/api/ + src/app/(auth)/
API client with auth interceptor
Auth store (zustand)
Login page
OAuth callback page
Auth guard HOC
Tenant switcher (in top bar)
User menu (in top bar)
Session refresh logic
Error handling
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the page designs, keep the visual hierarchy, keep the mock data fallback for offline dev
Test: login with real credentials → redirect to dashboard
Test: switch tenant → data refreshes
Test: token expires → auto-refresh works
Test: logout → all state cleared
