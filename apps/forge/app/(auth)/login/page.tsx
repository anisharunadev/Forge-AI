'use client';

/**
 * /login — Zone 3 (step-52).
 *
 * Layout follows the design system tokens:
 *   - --bg-base canvas, --bg-elevated card, --accent-primary CTA,
 *     --accent-rose for error states, --radius-xl for the card.
 *
 * Form behaviour:
 *   - Local-only email format check (UX hint only; server is source of
 *     truth — see CONSTRAINTS in the goal file).
 *   - On submit: call `useAuth.login(email, password)`, which posts to
 *     `/auth/login`, stores tokens, fetches the user + tenants, then
 *     redirects to `/dashboard` (or the original requested URL stored
 *     in `sessionStorage.return_url` by `AuthGuard`).
 *   - Show password toggle via eye icon (lucide-react).
 *   - Error states map backend `code` → user-facing message.
 *   - OAuth buttons trigger `useAuth.loginWithOAuth(provider)`, which
 *     bounces to `/auth/oauth/{provider}` on the backend.
 *
 * Skills applied:
 *   - Form layout via shadcn `Form` + `FormField` (UX skill, "Use Form
 *     with react-hook-form").
 *   - Error messages via `Alert` with role=alert (UX skill, FormMessage).
 *   - toast.success / toast.error semantics from the UX skill (Sonner).
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, GitBranch, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useAuth } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Validation — email format hint only. Password rules are server-side.
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

// Map backend ApiError.code → user-facing copy.
function explainError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Cannot reach the server. Check your connection.';
    if (err.status === 401) return 'Invalid email or password.';
    if (err.status === 423) return 'Account locked. Contact support.';
    if (err.status === 403 && err.code === 'email_unverified') {
      return 'Please verify your email first. Check your inbox for the link.';
    }
    if (err.status === 403 && err.code === 'mfa_required') {
      return 'Two-factor authentication required.';
    }
    if (err.status === 429) return 'Too many attempts. Try again in a minute.';
    return err.message || 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, loginWithOAuth, isLoading, user } = useAuth();
  const [showPassword, setShowPassword] = React.useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  // If the user is already signed in, bounce them straight to the
  // dashboard. Avoids the confusing "I logged out in another tab"
  // dance.
  React.useEffect(() => {
    if (user) {
      const target =
        searchParams.get('return_url') ||
        sessionStorage.getItem('return_url') ||
        '/dashboard';
      sessionStorage.removeItem('return_url');
      router.replace(target);
    }
  }, [user, router, searchParams]);

  const onSubmit = async (values: LoginValues) => {
    try {
      await login(values.email, values.password);
      toast.success('Welcome back');
      const target =
        searchParams.get('return_url') ||
        sessionStorage.getItem('return_url') ||
        '/dashboard';
      sessionStorage.removeItem('return_url');
      router.replace(target);
    } catch (err) {
      toast.error(explainError(err));
    }
  };

  const handleOAuth = async (provider: 'google' | 'github' | 'microsoft') => {
    try {
      await loginWithOAuth(provider);
      // loginWithOAuth redirects — no further action.
    } catch (err) {
      toast.error(explainError(err));
    }
  };

  return (
    <div className="w-full max-w-[440px]">
      {/* Brand mark — outside the card so the card stays clean */}
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="forge-mark mb-3" aria-hidden="true">
          <span className="text-base font-bold">F</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
          Forge AI
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-tertiary)]">
          The agent operating system
        </p>
      </div>

      {/* Card */}
      <div
        className="rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-lg)]"
        data-testid="login-card"
      >
        <div className="mb-6">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--fg-primary)]">
            Welcome back
          </h2>
          <p className="mt-1 text-sm text-[var(--fg-tertiary)]">
            Sign in to your workspace
          </p>
        </div>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      {...field}
                      data-testid="login-email"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-baseline justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href="/auth/forgot-password"
                      className="text-xs font-medium text-[var(--accent-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-elevated)] rounded-sm"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="••••••••"
                        className="pr-10"
                        {...field}
                        data-testid="login-password"
                      />
                      <button
                        type="button"
                        aria-label={
                          showPassword ? 'Hide password' : 'Show password'
                        }
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="h-12 w-full bg-[var(--accent-primary)] text-sm font-semibold text-white hover:bg-[var(--accent-primary)]/90 disabled:opacity-60"
              disabled={isLoading}
              data-testid="login-submit"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
        </Form>

        {/* Divider */}
        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
          <span className="h-px flex-1 bg-[var(--border-subtle)]" aria-hidden="true" />
          <span>or</span>
          <span className="h-px flex-1 bg-[var(--border-subtle)]" aria-hidden="true" />
        </div>

        {/* OAuth */}
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-center gap-2 border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)]"
            onClick={() => handleOAuth('google')}
            data-testid="login-oauth-google"
          >
            <GoogleMark />
            Continue with Google
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-center gap-2 border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)]"
            onClick={() => handleOAuth('github')}
            data-testid="login-oauth-github"
          >
            <GitBranch className="h-4 w-4" aria-hidden="true" />
            Continue with GitHub
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-center gap-2 border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)]"
            onClick={() => handleOAuth('microsoft')}
            data-testid="login-oauth-microsoft"
          >
            <MicrosoftMark />
            Continue with Microsoft
          </Button>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-[var(--fg-tertiary)]">
          Don&apos;t have an account?{' '}
          <Link
            href="/signup"
            className="font-medium text-[var(--accent-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-elevated)] rounded-sm"
          >
            Sign up
          </Link>
        </p>
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-[var(--fg-tertiary)]">
        By signing in, you agree to our{' '}
        <Link href="/legal/terms" className="underline hover:text-[var(--fg-secondary)]">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/legal/privacy" className="underline hover:text-[var(--fg-secondary)]">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider glyphs — inline SVGs so we don't pull a brand-asset package.
// ---------------------------------------------------------------------------

function GoogleMark() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09a6.62 6.62 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect width="11" height="11" x="1" y="1" fill="#F25022" />
      <rect width="11" height="11" x="12" y="1" fill="#7FBA00" />
      <rect width="11" height="11" x="1" y="12" fill="#00A4EF" />
      <rect width="11" height="11" x="12" y="12" fill="#FFB900" />
    </svg>
  );
}