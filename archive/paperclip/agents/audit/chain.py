"""
Per-(tenant, run) hash chain (ADR-0001 §D2).

`record_hash = SHA256(canonical_json(event w/o recordHash) || prev_hash)`

The chain head is the (tenant_id, run_id) pair.  The verifier walks
one run at a time; a run with N events costs O(N) to verify.  A
deleted or redacted event surfaces as a chain break, not a silent
verification failure: the store emits a synthetic `event_redacted`
event so the head always advances.  See `test_chain.py`.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Iterable, List, Tuple

from .schema import AuditEvent


# 32 zero bytes, hex-encoded.  The `prev_hash` of the first event in
# any (tenant, run) chain.  Using a sentinel of fixed length keeps
# the canonical hash input stable.
GENESIS_HASH = "0" * 64


@dataclass
class ChainBreak:
    """One place where the chain does not match.  The verifier
    returns a list of these rather than raising so the board can
    see every break, not just the first."""
    index: int
    event_id: str
    expected_prev_hash: str
    actual_prev_hash: str
    reason: str         # "prev_hash_mismatch" | "self_hash_mismatch" | "missing_event"

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "eventId": self.event_id,
            "expectedPrevHash": self.expected_prev_hash,
            "actualPrevHash": self.actual_prev_hash,
            "reason": self.reason,
        }


class HashChain:
    """Stateless chain walker.  Use `verify(events)` to walk a
    run; use `next_hash(event, prev_hash)` to compute the head."""

    @staticmethod
    def next_hash(event: AuditEvent, prev_hash: str) -> str:
        """Compute the record hash for `event` chained to `prev_hash`."""
        payload = event.canonical_bytes() + b"|" + prev_hash.encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    @staticmethod
    def verify(events: Iterable[AuditEvent]) -> Tuple[bool, List[ChainBreak]]:
        """Walk `events` in order and return (ok, breaks).  `ok` is
        True iff no breaks were found.  The caller is responsible
        for delivering `events` in append order for the (tenant,
        run) pair; the verifier does not sort."""
        breaks: List[ChainBreak] = []
        prev = GENESIS_HASH
        for idx, ev in enumerate(events):
            if ev.prev_hash != prev:
                breaks.append(ChainBreak(
                    index=idx,
                    event_id=ev.event_id,
                    expected_prev_hash=prev,
                    actual_prev_hash=ev.prev_hash,
                    reason="prev_hash_mismatch",
                ))
                # Don't trust any subsequent hashes from this point.
                # We continue walking so the board can see the full
                # picture, but we don't update `prev` -- the chain is
                # broken here.
                continue
            expected = HashChain.next_hash(ev, ev.prev_hash)
            if ev.record_hash != expected:
                breaks.append(ChainBreak(
                    index=idx,
                    event_id=ev.event_id,
                    expected_prev_hash=prev,
                    actual_prev_hash=ev.prev_hash,
                    reason="self_hash_mismatch",
                ))
                continue
            prev = ev.record_hash
        return (len(breaks) == 0), breaks
