/**
 * Loading skeleton for `/governance/compliance`.
 */
export default function Loading() {
  return (
    <div
      data-testid="compliance-feed-loading"
      className="p-6 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      Loading compliance feed…
    </div>
  );
}
