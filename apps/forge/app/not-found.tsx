import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card max-w-xl space-y-3">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-forge-200">
        That run id is not visible to the seeded <code>acme-corp</code> tenant, or the
        orchestrator is unreachable.
      </p>
      <p>
        <Link className="underline" href="/">
          Back to home
        </Link>
      </p>
    </div>
  );
}