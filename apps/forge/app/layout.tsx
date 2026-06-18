import './globals.css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { PersonaSwitcher } from '@/components/PersonaSwitcher';
import { PERSONAS } from '@/lib/types';
import { SEED_TENANT_ID, SEED_TENANT_NAME, defaultPersona, isPersona } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Forge AI Console',
  description: 'FORA SDLC operating-system persona dashboards and run timeline.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get('forge.persona')?.value;
  const persona = isPersona(cookieValue) ? cookieValue : defaultPersona();

  return (
    <html lang="en">
      <body className="min-h-screen bg-forge-900 text-forge-50">
        <header className="border-b border-forge-700 bg-forge-800">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="text-lg font-semibold tracking-tight"
                data-testid="brand"
              >
                Forge <span className="text-forge-300">AI</span>
              </Link>
              <nav className="flex gap-4 text-sm text-forge-200" aria-label="persona">
                {PERSONAS.map((p) => (
                  <Link
                    key={p.id}
                    href={p.href}
                    className={
                      p.id === persona
                        ? 'font-semibold text-white'
                        : 'hover:text-white'
                    }
                    data-persona-nav={p.id}
                  >
                    {p.shortLabel}
                  </Link>
                ))}
              </nav>
              <span className="hidden text-xs text-forge-300 md:inline" title="Tenant">
                tenant · {SEED_TENANT_NAME} ({SEED_TENANT_ID})
              </span>
            </div>
            <PersonaSwitcher current={persona} />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}