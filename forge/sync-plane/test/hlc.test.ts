import { describe, expect, it } from 'vitest';
import {
  Hlc,
  HlcClockSkewError,
  HlcParseError,
  MAX_COUNTER,
  MAX_SKEW_MS,
  hlcCompare,
  hlcEqual,
  hlcFromWire,
  hlcMax,
  hlcToWire,
  type HlcTimestamp,
} from '../src/hlc.js';

describe('HLC', () => {
  it('emits monotonically increasing timestamps when wall clock advances', () => {
    let t = 1_000;
    const clock = new Hlc({ nodeId: 'n1', physicalClock: () => t });
    const a = clock.now();
    t = 1_001;
    const b = clock.now();
    t = 1_002;
    const c = clock.now();
    expect(a.physicalMs).toBe(1_000);
    expect(b.physicalMs).toBe(1_001);
    expect(c.physicalMs).toBe(1_002);
    expect(hlcCompare(a, b)).toBeLessThan(0);
    expect(hlcCompare(b, c)).toBeLessThan(0);
  });

  it('bumps counter when same physical ms', () => {
    const clock = new Hlc({ nodeId: 'n1', physicalClock: () => 5_000 });
    const a = clock.now();
    const b = clock.now();
    const c = clock.now();
    expect(a.counter).toBe(0);
    expect(b.counter).toBe(1);
    expect(c.counter).toBe(2);
    expect(hlcCompare(a, b)).toBeLessThan(0);
    expect(hlcCompare(b, c)).toBeLessThan(0);
  });

  it('counter overflow rolls physical_ms forward', () => {
    const clock = new Hlc({ nodeId: 'n1', physicalClock: () => 100 });
    // burn through MAX_COUNTER+1 calls — last one should roll physicalMs.
    let last: HlcTimestamp | undefined;
    for (let i = 0; i <= MAX_COUNTER + 1; i++) last = clock.now();
    expect(last!.physicalMs).toBeGreaterThan(100);
    expect(last!.counter).toBe(0);
  });

  it('observe(remote) absorbs forward skew within MAX_SKEW_MS', () => {
    let local = 10_000;
    const clock = new Hlc({ nodeId: 'a', physicalClock: () => local });
    const remote: HlcTimestamp = { physicalMs: 10_000 + 60_000, counter: 7, nodeId: 'b' };
    const out = clock.observe(remote);
    expect(out.physicalMs).toBe(remote.physicalMs);
    expect(out.counter).toBe(8); // remote.counter + 1
    // Next local now() continues from the advanced clock.
    local = 10_000 + 60_001;
    const after = clock.now();
    expect(after.physicalMs).toBe(local);
    expect(after.counter).toBe(0);
  });

  it('observe(remote) throws HlcClockSkewError beyond 5 min', () => {
    const local = 0;
    const clock = new Hlc({ nodeId: 'a', physicalClock: () => local });
    const remote: HlcTimestamp = {
      physicalMs: local + MAX_SKEW_MS + 1,
      counter: 0,
      nodeId: 'b',
    };
    expect(() => clock.observe(remote)).toThrowError(HlcClockSkewError);
    try {
      clock.observe(remote);
    } catch (e) {
      expect(e).toBeInstanceOf(HlcClockSkewError);
      expect((e as HlcClockSkewError).skewMs).toBeGreaterThan(MAX_SKEW_MS);
    }
  });

  it('observe at exactly MAX_SKEW_MS boundary succeeds (5 min skew allowed)', () => {
    const clock = new Hlc({ nodeId: 'a', physicalClock: () => 0 });
    const remote: HlcTimestamp = {
      physicalMs: MAX_SKEW_MS,
      counter: 0,
      nodeId: 'b',
    };
    expect(() => clock.observe(remote)).not.toThrow();
  });

  it('observe handles negative skew (remote behind local)', () => {
    const clock = new Hlc({ nodeId: 'a', physicalClock: () => 1_000_000 });
    const remote: HlcTimestamp = { physicalMs: 999_000, counter: 99, nodeId: 'b' };
    const out = clock.observe(remote);
    expect(out.physicalMs).toBe(1_000_000); // local wins
    expect(out.counter).toBe(0);
  });

  it('observe merges counters when local and remote share physical_ms', () => {
    const clock = new Hlc({ nodeId: 'a', physicalClock: () => 5_000 });
    // Advance local counter first.
    clock.now(); // counter 0
    clock.now(); // counter 1
    const remote: HlcTimestamp = { physicalMs: 5_000, counter: 4, nodeId: 'b' };
    const out = clock.observe(remote);
    expect(out.physicalMs).toBe(5_000);
    expect(out.counter).toBe(5); // max(local=1, remote=4) + 1
  });

  it('wire-format round-trip preserves all fields', () => {
    const ts: HlcTimestamp = { physicalMs: 1_718_645_112, counter: 0x002a, nodeId: 'sync-plane-1' };
    const wire = hlcToWire(ts);
    expect(wire).toBe('1718645112.002a-sync-plane-1');
    const parsed = hlcFromWire(wire);
    expect(parsed).toEqual(ts);
  });

  it('hlcFromWire rejects malformed inputs', () => {
    expect(() => hlcFromWire('nodelimiters')).toThrowError(HlcParseError);
    expect(() => hlcFromWire('123.abc')).toThrowError(HlcParseError);
    expect(() => hlcFromWire('123.zzzz-node')).toThrowError(HlcParseError);
    expect(() => hlcFromWire('123.0001-')).toThrowError(HlcParseError);
    expect(() => hlcFromWire('-1.0000-n')).toThrowError(HlcParseError);
  });

  it('hlcCompare orders by physical, counter, then nodeId', () => {
    const a: HlcTimestamp = { physicalMs: 1, counter: 1, nodeId: 'a' };
    const b: HlcTimestamp = { physicalMs: 1, counter: 1, nodeId: 'b' };
    const c: HlcTimestamp = { physicalMs: 1, counter: 2, nodeId: 'a' };
    const d: HlcTimestamp = { physicalMs: 2, counter: 0, nodeId: 'a' };
    expect(hlcCompare(a, b)).toBeLessThan(0);
    expect(hlcCompare(a, c)).toBeLessThan(0);
    expect(hlcCompare(c, d)).toBeLessThan(0);
    expect(hlcCompare(a, a)).toBe(0);
    expect(hlcEqual(a, a)).toBe(true);
    expect(hlcEqual(a, b)).toBe(false);
  });

  it('hlcMax picks the later HLC and breaks tie on left arg', () => {
    const a: HlcTimestamp = { physicalMs: 10, counter: 0, nodeId: 'a' };
    const b: HlcTimestamp = { physicalMs: 10, counter: 0, nodeId: 'a' };
    const c: HlcTimestamp = { physicalMs: 20, counter: 0, nodeId: 'a' };
    expect(hlcMax(a, c)).toBe(c);
    expect(hlcMax(c, a)).toBe(c);
    expect(hlcMax(a, b)).toBe(a);
  });

  it('snapshot does not advance state', () => {
    const clock = new Hlc({ nodeId: 'a', physicalClock: () => 7_000 });
    clock.now();
    const s1 = clock.snapshot();
    const s2 = clock.snapshot();
    expect(s1).toEqual(s2);
  });

  it('requires a nodeId at construction', () => {
    expect(() => new Hlc({ nodeId: '' })).toThrow();
  });
});
