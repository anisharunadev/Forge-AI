#!/usr/bin/env node
// FORA-446 smoke — exercises AC #2 (5 failures trip; next invoke returns
// circuit_open in ≤50ms) end-to-end against the built package. Run via
// `pnpm --filter @fora/mcp-breaker smoke` after `pnpm --filter build`.
import {
  McpCircuitBreaker,
  InMemoryBreakerStore,
  InMemoryBreakerEventSink,
  CircuitOpenError,
} from '../dist/index.js';

const ctx = {
  tenant_id: 'tnt_smoke',
  principal: 'agent',
  actor: 'agent:smoke:run-001',
  trace_id: '01HSMOKE',
};

const sink = new InMemoryBreakerEventSink();
const breaker = new McpCircuitBreaker({
  store: new InMemoryBreakerStore(),
  events: sink,
});
const key = { tenant_id: ctx.tenant_id, server_name: 'jira' };

console.log('FORA-446 smoke:');
console.log('  policy:', JSON.stringify({
  consecutive_failure_threshold: 5,
  window_ms: 30000,
  error_rate_threshold: 0.5,
  cooldown_ms: 30000,
}));

// 1. Trip the breaker.
for (let i = 0; i < 5; i++) {
  await breaker.beforeCall(ctx, key);
  await breaker.recordFailure(ctx, key);
}
console.log('  tripped after 5 consecutive failures');

// 2. AC #2 — measure rejection latency over 100 samples.
const samples = [];
let rejected = 0;
let allowed = 0;
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  try {
    await breaker.beforeCall(ctx, key);
    allowed++;
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      rejected++;
      samples.push(performance.now() - start);
    } else {
      throw err;
    }
  }
}
samples.sort((a, b) => a - b);
const p50 = samples[Math.floor(samples.length * 0.5)];
const p95 = samples[Math.floor(samples.length * 0.95)];
const p99 = samples[Math.floor(samples.length * 0.99)];
const max = samples[samples.length - 1];

console.log(`  ${rejected}/100 calls rejected with circuit_open (${allowed} allowed)`);
console.log(`  rejection latency p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms`);
console.log(`  AC #2 (≤50ms): ${max <= 50 ? 'PASS' : 'FAIL'}`);

// 3. Event-stream accounting.
const trips = sink.listOfType('breaker.trip');
const rejects = sink.listOfType('breaker.reject');
console.log(`  breaker.trip events:    ${trips.length} (expect 1)`);
console.log(`  breaker.reject events:  ${rejects.length} (expect ${rejected})`);

if (max > 50) {
  console.error('SMOKE FAILED: rejection latency exceeded 50ms budget');
  process.exit(1);
}
if (trips.length !== 1) {
  console.error('SMOKE FAILED: expected exactly 1 breaker.trip event');
  process.exit(1);
}
console.log('SMOKE OK');
