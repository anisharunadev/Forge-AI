"""Deterministic hashed-bag-of-tokens embedder for the v1 dev store.

Production target (ADR-0002 §3.1) is text-embedding-3-small on
Postgres+pgvector. The dev path uses a fixed-dimension hash-bag with
token-hash -> dim mapping and per-token TF*IDF weighting. It is not
state-of-the-art; it is a stable, offline, dependency-light stand-in
that the same hybrid lexical+vector query shape (ADR-0002 §3.3) can
sit on top of.

Why a fixed-dim hash-bag and not sklearn HashingVectorizer:
    * No fit step, no state, no pickled model.
    * Pure-stdlib (hashlib + struct) so the same module is importable
      in the smoke test, the server, and any future worker.
    * Deterministic across processes: same text -> same bytes.

The dev weights (0.7 vec / 0.3 lex) match ADR-0002 §3.3.
"""

from __future__ import annotations

import hashlib
import math
import re
import struct
from collections import Counter
from typing import Iterable, List, Sequence, Tuple

EMBED_DIM = 256

# Light tokenizer: word characters and intra-word hyphens, lowercased.
_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_\-]{1,}")


def tokenize(text: str) -> List[str]:
    """Return the lowercased word tokens of *text*.

    Tokens shorter than 3 chars are dropped to reduce noise; common
    English stop words are also dropped because the seed corpus is
    small enough that IDF over-counts them.
    """
    stop = {"the", "and", "for", "with", "that", "this", "are", "but",
            "not", "you", "all", "can", "her", "his", "one", "our", "out",
            "may", "has", "had", "was", "were", "been", "into", "than",
            "then", "them", "its", "any", "from", "have"}
    out: List[str] = []
    for raw in _TOKEN_RE.findall(text or ""):
        tok = raw.lower()
        if len(tok) < 3 or tok in stop:
            continue
        out.append(tok)
    return out


def _hash_to_dim(token: str) -> int:
    """Map a token to one of EMBED_DIM dimensions (FNV-1a, stable)."""
    h = 0x811C9DC5
    for b in token.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % EMBED_DIM


def embed(tokens: Sequence[str], idf: Sequence[float] | None = None) -> bytes:
    """Encode *tokens* as a fixed-dim float32 vector (BLOB).

    When *idf* is provided, the i-th unique token's contribution is
    multiplied by ``idf[id(token)]``. The vector is L2-normalized so
    cosine similarity reduces to a dot product and the vec0 distance
    (L2) ranks results in the same order as cosine.
    """
    if not tokens:
        return struct.pack(f"{EMBED_DIM}f", *([0.0] * EMBED_DIM))
    counts = Counter(tokens)
    if idf is None:
        idf = [1.0] * (max(counts) + 1)  # type: ignore[arg-type]
    vec = [0.0] * EMBED_DIM
    for tok, c in counts.items():
        dim = _hash_to_dim(tok)
        # Bound the IDF so a single rare token doesn't dominate.
        w = c * min(5.0, math.log(1.0 + 1.0 / max(1, c)) * idf[min(c, len(idf) - 1)])
        vec[dim] += w
    # L2 normalize.
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    vec = [x / norm for x in vec]
    return struct.pack(f"{EMBED_DIM}f", *vec)


def fit_idf(documents: Iterable[Sequence[str]]) -> List[float]:
    """Return an IDF table of length (max_cf+1) per ADR-0002 §3.3 style.

    The dev implementation uses log(1 + N/df) per token, then a per-doc
    scaling per term-frequency bucket so re-embedding is cheap.
    """
    docs = list(documents)
    n = max(1, len(docs))
    df: Counter[str] = Counter()
    for d in docs:
        for tok in set(d):
            df[tok] += 1
    idf: dict[str, float] = {tok: math.log(1.0 + n / max(1, c)) for tok, c in df.items()}
    # Per-bucket scaling: bucket by term-frequency.
    # Max CF across the corpus caps the table.
    max_cf = max((max(Counter(d).values()) if d else 1) for d in docs)
    table: List[float] = [0.0] * (max_cf + 2)
    for c in range(1, max_cf + 1):
        # Approximate: average IDF of tokens seen c times in the corpus.
        # Cheap because we only call this at seed time.
        samples = [t for d in docs for t, cc in Counter(d).items() if cc == c]
        if not samples:
            table[c] = 1.0
            continue
        table[c] = sum(idf.get(t, 1.0) for t in samples) / len(samples)
    return table


def lexical_score(query_tokens: Sequence[str], content_tokens: Sequence[str]) -> float:
    """TF-style lexical score, used in the hybrid query (ADR-0002 §3.3)."""
    if not query_tokens or not content_tokens:
        return 0.0
    q = Counter(query_tokens)
    c = Counter(content_tokens)
    common = set(q) & set(c)
    if not common:
        return 0.0
    # A simple OKAPI-BM25-flavored score; constants are dev defaults.
    k1, b = 1.2, 0.75
    avgdl = max(1.0, sum(len(t) for t in c) / max(1, len(c)))
    dl = float(sum(c.values()))
    s = 0.0
    for t in common:
        tf = c[t]
        idf = math.log(1.0 + 1.0 / max(1, q[t]))
        s += idf * (tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * dl / avgdl))
    return float(s)


# Helper: stable text-hash for query-id audit rows.
def query_hash(query: str) -> str:
    return hashlib.sha256((query or "").encode("utf-8")).hexdigest()[:16]


# Helper: blend vec + lex to match ADR-0002 §3.3 hybrid weights.
def hybrid_score(vec_sim: float, lex: float) -> float:
    return 0.7 * float(vec_sim) + 0.3 * float(lex)
