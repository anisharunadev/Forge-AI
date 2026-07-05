# SLO Degradation

If a sustained-breach alert fires:

1. Confirm via OTel dashboard.
2. Read alert body for `value`/`threshold`.
3. Run `query_cost(tenant_id, since=now-1h)` to correlate with traffic spikes.
4. If regression: revert last merge to surface.
