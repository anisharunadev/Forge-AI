"""
Hybrid Logical Clock (HLC) — ADR-0010 §3.2.

Format: "<physical_ms>.<laa>-<seq>"  e.g. "1718645112000.004-0042"

  * physical_ms : wall-clock milliseconds at the producing node
  * laa         : "latest observed assumed" physical_ms (the high
                  watermark of physical time this node has seen,
                  including the inbound events it has processed)
  * seq         : monotonic counter on the local node.  Increments
                  every time the wall clock doesn't advance past laa;
                  rolls back to 0 when the wall clock does.

The clock satisfies the two invariants the §4 Tier-2 conflict
resolver depends on:

  H1. HLC is strictly monotonic on the producing node (within laa).
  H2. If event A is observed by the node that produces event B, then
      HLC(A) < HLC(B) (no missed happens-before edges).

Reference: Kulkarni et al., "Logical Physical Clocks and Consistent
Snapshots in Globally Distributed Databases", OPODIS 2014.  The
canonical Android / CockroachDB implementation.  We track `laa`
inside the physical_ms so the timestamp is byte-comparable as a
string: "1718645112000.004-0042" < "1718645112000.005-0000" because
the `laa` is the high part of the dot-delimited fraction.

This module is dependency-free and pure-Python so it can run in
the smoke test (no Postgres / no JetStream needed).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass


# Sentinel for an HLC that has not been ticked yet.  The dot-fraction
# is `0.000-0000` so the empty value sorts before any real HLC.
GENESIS_HLC = "0000000000000.000-0000"

# Bound the wall clock in either direction so a misbehaving remote
# (clock in 1970 or 2099) cannot poison our laa.  Clock skew
# detection (Tier 3) treats an inbound HLC outside this band as
# adversarial and routes to the divergence workbench.
MIN_PHYSICAL_MS = 1_577_836_800_000   # 2020-01-01 UTC
MAX_PHYSICAL_MS = 4_102_444_800_000   # 2100-01-01 UTC


@dataclass(frozen=True)
class HLC:
    """An HLC timestamp.  Immutable; build via `now()` or `parse()`."""
    physical_ms: int
    laa: int
    seq: int

    def __str__(self) -> str:                          # canonical form
        return f"{self.physical_ms:013d}.{self.laa:03d}-{self.seq:04d}"

    def __repr__(self) -> str:                        # repr mirror
        return f"HLC({self.physical_ms:013d}.{self.laa:03d}-{self.seq:04d})"

    def __lt__(self, other: "HLC") -> bool:            # H1 / H2 invariants
        if self.physical_ms != other.physical_ms:
            return self.physical_ms < other.physical_ms
        if self.laa != other.laa:
            return self.laa < other.laa
        return self.seq < other.seq

    def __le__(self, other: "HLC") -> bool:
        return self == other or self < other

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, HLC)
            and self.physical_ms == other.physical_ms
            and self.laa == other.laa
            and self.seq == other.seq
        )

    def __hash__(self) -> int:
        return hash((self.physical_ms, self.laa, self.seq))


def parse(s: str) -> HLC:
    """Parse the canonical HLC string.  Raises ValueError on bad input.

    The format is `<13d>.<3d>-<4d>` so the string is fixed-width
    22 chars.  Anything else is a contract violation by the caller.
    """
    if not isinstance(s, str) or len(s) != 22:
        raise ValueError(f"HLC must be 22 chars, got {s!r}")
    physical_str, tail = s.split(".", 1)
    laa_str, seq_str = tail.split("-", 1)
    if len(physical_str) != 13 or len(laa_str) != 3 or len(seq_str) != 4:
        raise ValueError(f"HLC width mismatch: {s!r}")
    return HLC(int(physical_str), int(laa_str), int(seq_str))


def wall_ms(clock=time.time) -> int:
    """Wall-clock milliseconds.  `clock` is injectable for tests."""
    return int(clock() * 1000)


class Clock:
    """The HLC ticking clock for one node.

    Holds the running laa + seq; `tick()` is the only legal way to
    obtain a new HLC and `observe()` is the only legal way to feed
    an inbound HLC into the local laa.  Both methods are
    thread-safe; the resolver instantiates one Clock per
    (tenant, node) and shares it across the Tier 1 / Tier 2
    hot path.
    """

    __slots__ = ("_lock", "_laa", "_seq", "_clock", "_node_id")

    def __init__(self, *, clock=time.time, node_id: str = "local") -> None:
        self._lock = threading.Lock()
        self._laa = 0
        self._seq = 0
        self._clock = clock
        self._node_id = node_id

    @property
    def node_id(self) -> str:
        return self._node_id

    def tick(self) -> HLC:
        """Advance the clock and return the new HLC.

        Rule (Kulkarni §3.2):
          now = max(wall_ms, laa)
          if now == laa: seq += 1
          else:          seq = 0; laa = now
        """
        with self._lock:
            now = wall_ms(self._clock)
            if now > self._laa:
                self._laa = now
                self._seq = 0
            else:
                self._seq += 1
            return HLC(self._laa, self._laa, self._seq)

    def observe(self, remote: HLC) -> None:
        """Fold an inbound remote HLC into the local laa.

        Rule (Kulkarni §3.2):
          laa = max(laa, remote.physical_ms, remote.laa, wall_ms)
        The next `tick()` will pick up from this laa, guaranteeing
        H2 (causal consistency) without the resolver having to know
        which side of the write happened first.
        """
        with self._lock:
            now = wall_ms(self._clock)
            self._laa = max(self._laa, remote.physical_ms, remote.laa, now)

    def now_hlc(self) -> HLC:
        """Read-only view: tick() then return; advances state."""
        return self.tick()
