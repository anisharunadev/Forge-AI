User clicks "Sign in" 
  → Frontend redirects to Keycloak (http://localhost:8080/realms/forge/protocol/openid-connect/auth)
  → User logs in on Keycloak
  → Keycloak redirects back to frontend with ?code=...
  → Frontend sends code to backend (POST /api/v1/auth/oidc/callback)
  → Backend exchanges code with Keycloak for tokens
  → Backend issues its own JWTs (signed with JWT_SECRET)
  → Frontend stores access_token + refresh_token
  → Frontend uses access_token in Authorization: Bearer header for API calls
  → Backend validates JWT, extracts user_id + tenant_id from claims


  /goal

Implement Phase 1 of the backend integration: OIDC login via Keycloak. The user has no login screen yet — this is the foundation that unblocks every other API wiring step. Tied to the actual docker-compose stack: Keycloak 26 on :8080, FastAPI on :8000, Next.js on :3000. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "OIDC Keycloak authorization code flow PKCE SPA login" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "JWT access refresh token storage rotation secure" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "FastAPI JWT validation dependency injection security" --domain ux-guideline -f markdown

Adopt every rule. Then build in this exact order:

==========================================================
ZONE 1 — KEYCLOAK REALM + CLIENT BOOTSTRAP
==========================================================

In scripts/keycloak-init/ (new dir), create the realm import:

File: scripts/keycloak-init/forge-realm.json

```json
{
  "realm": "forge",
  "enabled": true,
  "registrationAllowed": false,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "resetPasswordAllowed": true,
  "editUsernameAllowed": false,
  "bruteForceProtected": true,
  "accessTokenLifespan": 3600,
  "refreshTokenLifespan": 604800,
  "ssoSessionIdleTimeout": 1800,
  "clients": [
    {
      "clientId": "forge-ui",
      "enabled": true,
      "publicClient": true,
      "redirectUris": [
        "http://localhost:3000/*",
        "http://localhost:3000/auth/callback"
      ],
      "webOrigins": ["+"],
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "attributes": {
        "pkce.code.challenge.method": "S256"
      }
    },
    {
      "clientId": "forge-backend",
      "enabled": true,
      "publicClient": false,
      "secret": "${KEYCLOAK_BACKEND_SECRET}",
      "serviceAccountsEnabled": true
    }
  ],
  "users": [
    {
      "username": "arun@acme-corp.com",
      "email": "arun@acme-corp.com",
      "firstName": "Arun",
      "lastName": "Achalam",
      "enabled": true,
      "emailVerified": true,
      "credentials": [{
        "type": "password",
        "value": "dev-password-change-in-prod",
        "temporary": false
      }],
      "realmRoles": ["forge-admin"],
      "attributes": {
        "tenant_id": ["acme-corp"],
        "tenant_slug": ["acme-corp"],
        "tenant_name": ["Acme Corp (Dev Demo)"],
        "role": ["owner"]
      }
    }
  ],
  "roles": {
    "realm": [
      { "name": "forge-admin" },
      { "name": "forge-user" },
      { "name": "forge-viewer" }
    ]
  }
}

Mount this into keycloak via the docker-compose volumes:

yaml

Copy
keycloak:

  # ... existing config

  volumes:

    - ./scripts/keycloak-init:/opt/keycloak/data/import:ro

  command: ["start-dev", "--import-realm"]
After docker compose up -d keycloak, the forge realm is auto-created with the test user.

========================================================== ZONE 2 — BACKEND: OIDC CALLBACK ENDPOINT
In backend/app/api/v1/auth.py (or create if not exists):

python

Copy
from fastapi import APIRouter, HTTPException, Depends

from pydantic import BaseModel

import httpx

from jose import jwt, JWTError

from datetime import datetime, timedelta

import os


router = APIRouter(prefix="/auth", tags=["auth"])


KEYCLOAK_URL = os.environ["KEYCLOAK_URL"]  # http://keycloak:8080

KEYCLOAK_REALM = os.environ["KEYCLOAK_REALM"]  # forge

JWT_SECRET = os.environ["JWT_SECRET"]

JWT_ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE = timedelta(hours=1)

REFRESH_TOKEN_EXPIRE = timedelta(days=7)


# Token endpoint discovery

KEYCLOAK_TOKEN_URL = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token"

KEYCLOAK_USERINFO_URL = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/userinfo"


class OIDCCallbackRequest(BaseModel):

    code: str

    redirect_uri: str


class TokenResponse(BaseModel):

    access_token: str

    refresh_token: str

    user: dict

    tenant: dict


@router.post("/oidc/callback")

async def oidc_callback(req: OIDCCallbackRequest) -> TokenResponse:

    """Exchange Keycloak auth code for tokens + user info."""

    

    # Exchange code for Keycloak tokens

    async with httpx.AsyncClient() as client:

        token_response = await client.post(

            KEYCLOAK_TOKEN_URL,

            data={

                "grant_type": "authorization_code",

                "code": req.code,

                "redirect_uri": req.redirect_uri,

                "client_id": "forge-ui",

                # PKCE: code_verifier (for public client)

                # Frontend includes this

            },

        )

        if token_response.status_code != 200:

            raise HTTPException(401, "Failed to exchange code with Keycloak")

        

        kc_tokens = token_response.json()

        kc_access_token = kc_tokens["access_token"]

        

        # Fetch user info

        userinfo_response = await client.get(

            KEYCLOAK_USERINFO_URL,

            headers={"Authorization": f"Bearer {kc_access_token}"},

        )

        userinfo = userinfo_response.json()

    

    # Extract tenant info from Keycloak user attributes

    tenant_id = userinfo.get("tenant_id", "default")

    tenant_slug = userinfo.get("tenant_slug", "default")

    tenant_name = userinfo.get("tenant_name", "Default Tenant")

    

    # Find or create tenant in our database

    # (assumes you have a tenants service — see Zone 4)

    from app.services.tenants import get_or_create_tenant

    tenant = await get_or_create_tenant(

        id=tenant_id,

        slug=tenant_slug,

        name=tenant_name,

    )

    

    # Find or create user in our database

    from app.services.users import get_or_create_user

    user = await get_or_create_user(

        keycloak_id=userinfo["sub"],

        email=userinfo["email"],

        name=f"{userinfo.get('given_name', '')} {userinfo.get('family_name', '')}".strip(),

        tenant_id=tenant_id,

        role=userinfo.get("role", "viewer"),

    )

    

    # Issue our own internal JWTs (frontend uses these for API auth)

    forge_access = create_access_token({

        "sub": user["id"],

        "email": user["email"],

        "tenant_id": tenant_id,

        "role": user["role"],

    })

    forge_refresh = create_refresh_token({

        "sub": user["id"],

        "tenant_id": tenant_id,

    })

    

    return TokenResponse(

        access_token=forge_access,

        refresh_token=forge_refresh,

        user=user,

        tenant=tenant,

    )



def create_access_token(payload: dict) -> str:

    expire = datetime.utcnow() + ACCESS_TOKEN_EXPIRE

    payload["exp"] = expire

    payload["type"] = "access"

    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)



def create_refresh_token(payload: dict) -> str:

    expire = datetime.utcnow() + REFRESH_TOKEN_EXPIRE

    payload["exp"] = expire

    payload["type"] = "refresh"

    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)



class RefreshRequest(BaseModel):

    refresh_token: str


@router.post("/refresh")

async def refresh_token(req: RefreshRequest) -> dict:

    try:

        payload = jwt.decode(req.refresh_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

    except JWTError:

        raise HTTPException(401, "Invalid refresh token")

    

    if payload.get("type") != "refresh":

        raise HTTPException(401, "Not a refresh token")

    

    new_access = create_access_token({

        "sub": payload["sub"],

        "tenant_id": payload["tenant_id"],

    })

    return {"access_token": new_access}



@router.get("/me")

async def get_me(current_user = Depends(get_current_user)):

    return current_user
========================================================== ZONE 3 — BACKEND: AUTH MIDDLEWARE
In backend/app/core/auth.py:

python

Copy
from fastapi import Depends, HTTPException, Request

from jose import jwt, JWTError

import os


JWT_SECRET = os.environ["JWT_SECRET"]


async def get_current_user(request: Request) -> dict:

    """Extract user from Authorization header."""

    auth_header = request.headers.get("Authorization", "")

    if not auth_header.startswith("Bearer "):

        raise HTTPException(401, "Missing or invalid Authorization header")

    

    token = auth_header[7:]

    try:

        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])

    except JWTError:

        raise HTTPException(401, "Invalid or expired token")

    

    if payload.get("type") != "access":

        raise HTTPException(401, "Not an access token")

    

    # Fetch user from DB (or use payload if you want stateless)

    from app.services.users import get_user_by_id

    user = await get_user_by_id(payload["sub"], tenant_id=payload["tenant_id"])

    if not user:

        raise HTTPException(401, "User not found")

    

    return user



async def get_current_tenant(request: Request) -> str:

    """Extract tenant_id from JWT — use this in services for tenant scoping."""

    auth_header = request.headers.get("Authorization", "")

    token = auth_header[7:]

    payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])

    return payload["tenant_id"]
========================================================== ZONE 4 — BACKEND: TENANTS + USERS SERVICES (minimal)
In backend/app/services/tenants.py:

python

Copy
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.db.models import Tenant


async def get_or_create_tenant(db: AsyncSession, id: str, slug: str, name: str) -> dict:

    result = await db.execute(select(Tenant).where(Tenant.id == id))

    tenant = result.scalar_one_or_none()

    

    if not tenant:

        tenant = Tenant(id=id, slug=slug, name=name, plan="pro", region="us-east-1")

        db.add(tenant)

        await db.commit()

        await db.refresh(tenant)

    

    return {

        "id": tenant.id,

        "slug": tenant.slug,

        "name": tenant.name,

        "plan": tenant.plan,

        "region": tenant.region,

    }
In backend/app/services/users.py:

python

Copy
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.db.models import User


async def get_or_create_user(db: AsyncSession, keycloak_id: str, email: str, name: str, tenant_id: str, role: str) -> dict:

    result = await db.execute(

        select(User).where(User.keycloak_id == keycloak_id)

    )

    user = result.scalar_one_or_none()

    

    if not user:

        user = User(

            keycloak_id=keycloak_id,

            email=email,

            name=name,

            tenant_id=tenant_id,

            role=role,

        )

        db.add(user)

        await db.commit()

        await db.refresh(user)

    

    return {

        "id": user.id,

        "keycloak_id": user.keycloak_id,

        "email": user.email,

        "name": user.name,

        "tenant_id": user.tenant_id,

        "role": user.role,

        "avatar_url": user.avatar_url,

    }



async def get_user_by_id(db: AsyncSession, user_id: str, tenant_id: str) -> dict | None:

    result = await db.execute(

        select(User).where(User.id == user_id, User.tenant_id == tenant_id)

    )

    user = result.scalar_one_or_none()

    if not user:

        return None

    return {

        "id": user.id,

        "email": user.email,

        "name": user.name,

        "tenant_id": user.tenant_id,

        "role": user.role,

    }
ALSO add the SQLAlchemy models (in backend/app/db/models.py):

python

Copy
from sqlalchemy import Column, String, DateTime, ForeignKey

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.sql import func

import uuid

from app.db.base import Base


class Tenant(Base):

    __tablename__ = "tenants"

    id = Column(String, primary_key=True)  # or UUID

    slug = Column(String, unique=True, nullable=False)

    name = Column(String, nullable=False)

    plan = Column(String, default="free")

    region = Column(String, default="us-east-1")

    logo_url = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())



class User(Base):

    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))

    keycloak_id = Column(String, unique=True, nullable=False, index=True)

    email = Column(String, nullable=False, index=True)

    name = Column(String, nullable=True)

    tenant_id = Column(String, ForeignKey("tenants.id"), nullable=False, index=True)

    role = Column(String, default="viewer")

    avatar_url = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
Run the alembic migration to create the tables:

bash

Copy
docker compose exec backend alembic revision --autogenerate -m "Add tenants and users tables"

docker compose exec backend alembic upgrade head
========================================================== ZONE 5 — FRONTEND: OIDC LOGIN FLOW
In apps/forge/lib/auth/oidc.ts:

typescript

Copy
const KEYCLOAK_URL = process.env.NEXT_PUBLIC_KEYCLOAK_URL || 'http://localhost:8080';

const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'forge';

const CLIENT_ID = 'forge-ui';

const REDIRECT_URI = typeof window !== 'undefined' 

  ? `${window.location.origin}/auth/callback`

  : '';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';


// Generate PKCE code verifier + challenge

function generateCodeVerifier() {

  const array = new Uint8Array(32);

  crypto.getRandomValues(array);

  return base64UrlEncode(array);

}


async function generateCodeChallenge(verifier: string) {

  const data = new TextEncoder().encode(verifier);

  const hash = await crypto.subtle.digest('SHA-256', data);

  return base64UrlEncode(new Uint8Array(hash));

}


function base64UrlEncode(bytes: Uint8Array) {

  return btoa(String.fromCharCode(...bytes))

    .replace(/\+/g, '-')

    .replace(/\//g, '_')

    .replace(/=+$/, '');

}


export async function startLogin() {

  // Generate PKCE verifier

  const verifier = generateCodeVerifier();

  const challenge = await generateCodeChallenge(verifier);

  

  // Store verifier in sessionStorage

  sessionStorage.setItem('pkce_verifier', verifier);

  

  // Store intended return URL

  const returnUrl = sessionStorage.getItem('return_url') || '/dashboard';

  sessionStorage.setItem('return_url', returnUrl);

  

  // Build Keycloak auth URL

  const params = new URLSearchParams({

    client_id: CLIENT_ID,

    redirect_uri: REDIRECT_URI,

    response_type: 'code',

    scope: 'openid profile email',

    code_challenge: challenge,

    code_challenge_method: 'S256',

  });

  

  window.location.href = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?${params}`;

}
In apps/forge/app/auth/callback/page.tsx:

typescript

Copy
'use client';

import { useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';


export default function AuthCallbackPage() {

  const router = useRouter();

  const [error, setError] = useState<string | null>(null);

  

  useEffect(() => {

    handleCallback();

  }, []);

  

  async function handleCallback() {

    const params = new URLSearchParams(window.location.search);

    const code = params.get('code');

    

    if (!code) {

      setError('No authorization code received');

      return;

    }

    

    const verifier = sessionStorage.getItem('pkce_verifier');

    if (!verifier) {

      setError('PKCE verifier missing — restart login');

      return;

    }

    

    try {

      // Exchange code with our backend (which talks to Keycloak)

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/auth/oidc/callback`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          code,

          redirect_uri: `${window.location.origin}/auth/callback`,

          code_verifier: verifier,

        }),

      });

      

      if (!res.ok) {

        const body = await res.json().catch(() => ({}));

        throw new Error(body.detail || 'Login failed');

      }

      

      const { access_token, refresh_token, user, tenant } = await res.json();

      

      // Store tokens

      localStorage.setItem('forge_access_token', access_token);

      localStorage.setItem('forge_refresh_token', refresh_token);

      localStorage.setItem('forge_user', JSON.stringify(user));

      localStorage.setItem('forge_tenant', JSON.stringify(tenant));

      

      // Cleanup

      sessionStorage.removeItem('pkce_verifier');

      

      // Redirect to intended page

      const returnUrl = sessionStorage.getItem('return_url') || '/dashboard';

      sessionStorage.removeItem('return_url');

      router.push(returnUrl);

    } catch (err: any) {

      setError(err.message);

    }

  }

  

  if (error) {

    return (

      <div className="min-h-screen flex items-center justify-center">

        <div className="bg-elevated rounded-xl p-8 max-w-md">

          <h1 className="text-xl font-semibold text-rose-400">Login failed</h1>

          <p className="text-sm text-fg-secondary mt-2">{error}</p>

          <a href="/login" className="...">Try again</a>

        </div>

      </div>

    );

  }

  

  return (

    <div className="min-h-screen flex items-center justify-center">

      <div className="flex flex-col items-center gap-4">

        <div className="w-12 h-12 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />

        <p>Signing you in...</p>

      </div>

    </div>

  );

}
========================================================== ZONE 6 — FRONTEND: API CLIENT WITH AUTO-REFRESH
In apps/forge/lib/api/client.ts:

typescript

Copy
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';


let isRefreshing = false;

let refreshPromise: Promise<string> | null = null;


async function refreshAccessToken(): Promise<string> {

  if (isRefreshing && refreshPromise) return refreshPromise;

  

  isRefreshing = true;

  refreshPromise = (async () => {

    const refresh = localStorage.getItem('forge_refresh_token');

    if (!refresh) throw new Error('No refresh token');

    

    const res = await fetch(`${API_BASE}/auth/refresh`, {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ refresh_token: refresh }),

    });

    

    if (!res.ok) {

      // Refresh failed — log out

      localStorage.clear();

      window.location.href = '/login';

      throw new Error('Refresh failed');

    }

    

    const { access_token } = await res.json();

    localStorage.setItem('forge_access_token', access_token);

    return access_token;

  })();

  

  try {

    return await refreshPromise;

  } finally {

    isRefreshing = false;

    refreshPromise = null;

  }

}


async function request<T>(path: string, options: RequestInit = {}): Promise<T> {

  const token = localStorage.getItem('forge_access_token');

  

  const res = await fetch(`${API_BASE}${path}`, {

    ...options,

    headers: {

      'Content-Type': 'application/json',

      ...(token ? { Authorization: `Bearer ${token}` } : {}),

      ...options.headers,

    },

  });

  

  // Auto-refresh on 401

  if (res.status === 401) {

    try {

      const newToken = await refreshAccessToken();

      return request<T>(path, {

        ...options,

        headers: { ...options.headers, Authorization: `Bearer ${newToken}` },

      });

    } catch {

      // Refresh failed — already redirected to login

      throw new Error('Unauthorized');

    }

  }

  

  if (!res.ok) {

    const body = await res.json().catch(() => ({}));

    throw new Error(body.detail || `API error: ${res.status}`);

  }

  

  if (res.status === 204) return undefined as T;

  return res.json();

}


export const api = {

  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: any) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  put: <T>(path: string, body?: any) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),

  patch: <T>(path: string, body?: any) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

};
========================================================== ZONE 7 — FRONTEND: LOGIN PAGE
In apps/forge/app/(auth)/login/page.tsx:

typescript

Copy
'use client';

import { useState } from 'react';

import { startLogin } from '@/lib/auth/oidc';


export default function LoginPage() {

  const [loading, setLoading] = useState(false);

  

  async function handleSignIn() {

    setLoading(true);

    await startLogin();

    // Browser will navigate to Keycloak — no setLoading(false) needed

  }

  

  return (

    <div className="min-h-screen flex items-center justify-center bg-base p-8">

      <div className="bg-elevated rounded-2xl shadow-lg p-12 max-w-md w-full">

        <div className="flex flex-col items-center text-center">

          {/* Logo */}

          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center mb-6">

            <span className="text-white text-2xl font-bold">F</span>

          </div>

          

          <h1 className="text-2xl font-700 text-fg-primary">Welcome to Forge AI</h1>

          <p className="text-sm text-fg-secondary mt-2">

            Sign in to your workspace

          </p>

          

          <button

            onClick={handleSignIn}

            disabled={loading}

            className="mt-8 w-full h-12 bg-accent-primary hover:bg-accent-primary/90 text-white font-500 rounded-lg flex items-center justify-center gap-3 transition-colors"

          >

            {loading ? (

              <>

                <Spinner />

                Redirecting...

              </>

            ) : (

              <>

                <KeyIcon />

                Sign in with Keycloak

              </>

            )}

          </button>

          

          <p className="text-xs text-fg-tertiary mt-6">

            By signing in, you agree to our Terms of Service and Privacy Policy.

          </p>

        </div>

      </div>

    </div>

  );

}
========================================================== ZONE 8 — FRONTEND: AUTH GUARD
In apps/forge/components/auth-guard.tsx:

typescript

Copy
'use client';

import { useEffect } from 'react';

import { useRouter, usePathname } from 'next/navigation';


export function AuthGuard({ children }: { children: React.ReactNode }) {

  const router = useRouter();

  const pathname = usePathname();

  

  useEffect(() => {

    const token = localStorage.getItem('forge_access_token');

    if (!token) {

      sessionStorage.setItem('return_url', pathname);

      router.push('/login');

    }

  }, [pathname, router]);

  

  const hasToken = typeof window !== 'undefined' && localStorage.getItem('forge_access_token');

  if (!hasToken) return null;  // Will redirect via useEffect

  

  return <>{children}</>;

}
Wrap the workspace layout in apps/forge/app/(workspace)/layout.tsx:

typescript

Copy
import { AuthGuard } from '@/components/auth-guard';


export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {

  return <AuthGuard>{children}</AuthGuard>;

}
========================================================== ZONE 9 — FRONTEND: UPDATE USER MENU + TENANT SWITCHER
Replace mocked "Arun" avatar with real data from localStorage:

typescript

Copy
// In your top nav user menu

const user = JSON.parse(localStorage.getItem('forge_user') || 'null');

const tenant = JSON.parse(localStorage.getItem('forge_tenant') || 'null');


<Avatar src={user?.avatar_url} fallback={user?.name?.[0]} />

<span>{user?.name || 'Guest'}</span>
For logout:

typescript

Copy
function logout() {

  localStorage.removeItem('forge_access_token');

  localStorage.removeItem('forge_refresh_token');

  localStorage.removeItem('forge_user');

  localStorage.removeItem('forge_tenant');

  // Optional: redirect to Keycloak logout endpoint to end SSO session

  window.location.href = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/logout?redirect_uri=${window.location.origin}/login`;

}
========================================================== ZONE 10 — ENVIRONMENT VARIABLES
In apps/forge/.env.local:

text

Copy
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1

NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8000/ws

NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080

NEXT_PUBLIC_KEYCLOAK_REALM=forge
========================================================== CONSTRAINTS
This phase ONLY handles auth — no other API endpoints yet
Don't break existing mock data display (until other phases wire real data)
Tokens stored in localStorage (acceptable for dev; use httpOnly cookies in prod)
PKCE flow is required (public client, no client secret)
All auth-related requests go through /api/v1/auth/* endpoints
Don't expose the backend's JWT_SECRET to the frontend
========================================================== DELIVERABLE
files modified across backend + frontend
Keycloak realm auto-imported on docker compose up
Backend OIDC callback endpoint working
Frontend login page redirects to Keycloak
Frontend callback handler stores tokens
Auth guard protects all workspace pages
First login → can access /dashboard with real user data
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep page designs, keep the top nav layout, keep the Co-pilot FAB
Test: docker compose up -d → wait for keycloak healthy → visit localhost:3000 → redirected to Keycloak login → sign in as arun@acme-corp.com → redirected back to dashboard with user info
Test: token expires after 1h → auto-refresh works
Test: logout → returns to login page + Keycloak SSO session ends

text

Copy

---


The **Keycloak realm import** (Zone 1) is the critical first step — without it, you have no identity provider. The forge-realm.json bootstraps everything.


The **backend OIDC callback** (Zone 2) is the bridge — frontend gets a code, backend exchanges it with Keycloak, issues its own JWTs. This pattern is more secure than letting the frontend talk to Keycloak directly.


The **PKCE flow** (Zone 5) is the modern OIDC standard for SPAs — public client + code challenge, no client secret exposed.


After Phase 1 ships:

- You can log in

- You have a real user + tenant

- The API client works with auth

- Other phases can now wire real data (agents, workflows, etc.)