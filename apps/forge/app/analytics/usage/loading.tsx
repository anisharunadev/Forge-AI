/**
 * Loading skeleton for `/analytics/usage`.
 */
export default function Loading() {
  return (
    <div
      data-testid="usage-dashboard-loading"
      className="p-6 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      Loading LLM usage…
    </div>
  );
}
