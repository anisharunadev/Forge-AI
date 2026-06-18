import Link from 'next/link';
import { PERSONAS } from '@/lib/types';
import { SEED_TENANT_NAME } from '@/lib/auth';

export default function HomePage() {
  return (
    <div className="space-y-8" data-testid="home-page">
      <section className="card">
        <h1 className="text-2xl font-semibold">Forge AI Console</h1>
        <p className="mt-2 text-sm text-forge-200">
          Welcome to <strong>{SEED_TENANT_NAME}</strong>. Pick the persona dashboard that
          matches your role. The Forge console is a thin read + operator shell over the
          Master Orchestrator REST API; docs live at{' '}
          <a className="underline" href="https://docs.fora.dev" target="_blank" rel="noreferrer">
            docs.fora.dev
          </a>
          .
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {PERSONAS.map((p) => (
          <Link
            key={p.id}
            href={p.href}
            className="card hover:border-forge-400 hover:shadow-md"
            data-persona-card={p.id}
          >
            <h2 className="text-lg font-semibold">{p.label}</h2>
            <p className="mt-2 text-sm text-forge-200">{p.description}</p>
            <p className="mt-4 text-xs text-forge-300">Open {p.shortLabel} →</p>
          </Link>
        ))}
      </section>
    </div>
  );
}