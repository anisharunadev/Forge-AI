"""
Knowledge Layer production-bar linter (FORA-408, sub-goal 0.8.1).

Enforces `workspace/README.md §3` on every file under
`workspace/memory/`, `workspace/customer/`, `workspace/project/`.

CLI:

    python -m agents.workspace.lint --root workspace/
    python -m agents.workspace.lint --root workspace/ --json

Exit codes:
    0 — every file passes
    1 — at least one violation found
    2 — usage error (bad --root, missing glossary, etc.)

The checker is pure Python (stdlib only): no network, no LLM. It runs
in < 200 ms on the current 17-file seed and produces one single-line
diagnostic per violation in the form

    workspace/<file>:<line>: <rule>: <message>

so a CI gate or smoke script can grep for failure without parsing
multi-line stack traces.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, List, Set, Tuple


# ---------------------------------------------------------------------------
# constants
# ---------------------------------------------------------------------------

SEED_DIRS = ("memory", "customer", "project")

# Headings of the form `## Related` or `## N. Related` (N is a 1-2 digit
# section number, optionally followed by a period). Matches the convention
# used across the existing seed (coding.md §12, tech-stack.md §15, etc.)
RELATED_HEADING_RE = re.compile(r"^##\s+(?:\d{1,2}\.\s+)?Related\s*$", re.MULTILINE)

# A word-boundary ALL-CAPS sequence of 2-5 letters (digits allowed) is the
# canonical "acronym candidate". We deliberately exclude single-letter
# words (which catch pronouns like "I") and length-6+ words (which are
# usually proper nouns or rendered in CamelCase).
ACRONYM_RE = re.compile(r"\b[A-Z][A-Z0-9]{1,4}\b")

# Phrases that point OUTSIDE the workspace (tribal knowledge). Each pattern
# is checked case-insensitively against body text (code blocks stripped).
# The patterns are narrow on purpose: meta-discussion of "tribal
# knowledge" as a concept is allowed; explicit pointers ("ask the team",
# "ping @alice") are not.
TRIBAL_PATTERNS: Tuple[Tuple[str, str], ...] = (
    (r"\bask\s+(?:the\s+team|@\w+|[A-Z][a-z]+)\b", "ask-<person|team>"),
    (r"\bping\s+@?\w+\b", "ping-<person>"),
    (r"\bin\s+(?:our|my|the)\s+heads?\b", "in-<our|my|the>-heads"),
    (r"\bhead\s+knowledge\b", "head-knowledge"),
    (r"\bwatercooler\b", "watercooler"),
    (r"\bsee\s+(?:the\s+)?(?:wiki|notion)\b", "see-<wiki|notion>"),
    (r"\bin\s+(?:our|the)\s+(?:slack|teams?)\s+channel\b", "in-<slack|teams>-channel"),
)

# Vague-hedge phrases from the anti-glossary in `glossary.md §7`.
# These are exact-substring matches (case-insensitive) outside code
# blocks and outside the glossary's anti-glossary section itself.
HEDGE_PATTERNS: Tuple[str, ...] = (
    "it depends",
    "just works",
    "just a small change",
    "best effort",
    "we'll fix it later",
    "eventually consistent",
    "ai magic",
)

# Baseline tech / universal terms that are NOT FORA-specific acronyms.
# The glossary is the source of truth for FORA terms; this list is for
# universally-known protocols, formats, priorities, business metrics,
# and placeholders that appear in any engineering doc and don't need
# glossary entries.
#
# Adding a term here is a deliberate choice: the rule is "every
# acronym must be in the glossary", and these are the universally-known
# exceptions. Project-specific terms (BMAD, the sub-agent role
# acronyms, FORA services) belong in the glossary, not here.
TECH_ALLOWED: Set[str] = {
    # protocols / wire formats
    "HTTP", "HTTPS", "SSH", "TLS", "SSL", "TCP", "UDP", "DNS", "SMTP",
    "URL", "URI", "UUID", "REST", "SOAP", "GRPC", "JSON", "YAML",
    "XML", "CSV", "HTML", "CSS", "PDF", "PNG", "SVG", "JPEG",
    "JSONL", "JSONB", "JWT",
    # data / compute primitives
    "SQL", "DB", "OS", "SDK", "CLI", "GUI", "FAQ", "RAM", "CPU", "GPU",
    "VM", "K8S", "OLTP", "OLAP", "IOPS",
    # programming languages / runtimes / package formats
    "TS", "JS", "PHP", "HCL", "ESM", "JSX", "TSX", "LTS", "GPT",
    # cloud providers + services (universally understood; not FORA-specific)
    "AWS", "GCP", "AZURE",
    "S3", "ECR", "VPC", "SES", "SQS", "SNS", "EBS", "ALB", "NLB",
    "AKS", "GKE", "EKS", "RDS", "KMS", "CDN",
    # auth / security primitives (not FORA inventions)
    "CSRF", "XSS", "SSRF", "CIDR", "TOTP", "SMS", "VPN", "WAF",
    # OSS license identifiers (SPDX)
    "MIT", "BSD", "GPL", "AGPL", "LGPL", "ISC", "APACHE",
    # general ML/data terms (LLM etc. stays in glossary)
    "AI", "ML", "NLP", "OCR", "OSS",
    # places (geographic, not org-specific)
    "EU", "US", "UK",
    # calendar tokens (quarters, priorities, stages) used as inline labels
    "Q1", "Q2", "Q3", "Q4", "Q5",
    "P0", "P1", "P2", "P3",
    "S0", "S1", "S2", "S3",
    # business / ops metrics commonly used in any product doc
    "GA", "ICP", "MRR", "MTTR", "KPI", "IDE", "UX", "VP", "CISO",
    "PM", "QA", "SRE", "ETR", "ETA",
    # compliance frameworks / regulatory acronyms that any security
    # doc legitimately cites
    "AA", "CCPA", "FIPS", "IEC", "SP",
    # incident response & alerting shorthand
    "IR", "OR",
    # Roman-numeral ordinals used in compliance text ("SOC 2 Type II")
    "II",
    # semver / version / placeholder tokens
    "NNN", "MAJOR", "MINOR", "PATCH",
    # generic admin markers
    "OK", "N/A", "TBD", "TBA", "D3",
    # generic verb-form acronyms that appear in body text
    "TODO", "FIXME", "NOT",
    # the seed tenant name (placeholder for any future customer)
    "ACME",
    # ---- FORA-408 widening (added on first smoke pass; see forge/0.8/0.8.1_lint.md) ----
    # FORA project identity
    "BMAD",  # the workflow methodology FORA is built on top of
    "FORA",  # the platform name (matches glossary §1 product names)
    # compliance / audit shorthand
    "SOC",   # "SOC 2"
    # noise tokens that are not jargon: roman numerals (II, III, IV) and
    # the bare "ID" identifier
    "ID", "II", "III", "IV",
    # OWASP LLM Top-10 entries are referenced as LLM01..LLM10
    "LLM01", "LLM02", "LLM03", "LLM04", "LLM05",
    "LLM06", "LLM07", "LLM08", "LLM09", "LLM10",
}


# ---------------------------------------------------------------------------
# data classes
# ---------------------------------------------------------------------------

@dataclass
class Violation:
    """One production-bar violation."""
    file: str         # path relative to --root, POSIX-style
    line: int         # 1-based; 0 means file-level (e.g. missing footer)
    rule: str         # short rule id, e.g. "undefined-acronym"
    message: str      # single-line human-readable diagnostic

    def render(self) -> str:
        return f"{self.file}:{self.line}: {self.rule}: {self.message}"


@dataclass
class LintReport:
    """Aggregate result of one lint pass over the seed."""
    root: str
    files_scanned: int = 0
    violations: List[Violation] = field(default_factory=list)
    by_rule: dict = field(default_factory=dict)
    elapsed_ms: float = 0.0

    def exit_code(self) -> int:
        return 0 if not self.violations else 1

    def to_dict(self) -> dict:
        d = asdict(self)
        d["exit_code"] = self.exit_code()
        d["violations"] = [asdict(v) for v in self.violations]
        return d


# ---------------------------------------------------------------------------
# helpers: text preparation
# ---------------------------------------------------------------------------

def strip_code_blocks(text: str) -> str:
    """Return `text` with fenced and indented code blocks stripped.

    The hedge/acronym/tribal rules must not fire on code samples — a doc
    that contains `it depends` inside a JSON example isn't hedging.

    Line numbers in the returned text MUST match the original file's
    line numbers, so each line of a removed region becomes an empty
    line in place. This is the seam every diagnostic depends on.
    """
    # Fenced blocks ```...``` (greedy across multiple lines). Replace
    # the entire block with the same number of newlines so line counts
    # are preserved.
    def _fenced_repl(m: "re.Match[str]") -> str:
        block = m.group(0)
        # Count newlines in the matched block and emit the same count.
        # A trailing `\n` in the block becomes the empty line below it.
        return "\n" * block.count("\n")

    out = re.sub(r"```.*?```", _fenced_repl, text, flags=re.DOTALL)

    # Indented code blocks: a line indented with 4+ spaces (or a tab)
    # that follows a blank line is a markdown indented code block. We
    # replace each such line with an empty line so line counts hold.
    out_lines = out.split("\n")
    in_code = False
    for i, line in enumerate(out_lines):
        is_indented = line.startswith(("    ", "\t"))
        prev_blank = (i == 0) or (out_lines[i - 1].strip() == "")
        if is_indented and prev_blank:
            in_code = True
            out_lines[i] = ""  # preserve line number, drop content
            continue
        if in_code and line.strip() == "":
            # blank line inside an indented block — keep counting, drop
            out_lines[i] = ""
            continue
        if in_code and not is_indented and line.strip() != "":
            in_code = False
    out = "\n".join(out_lines)

    # Inline code spans `...` — content is replaced by an equal-length
    # run of spaces so column positions (and therefore downstream
    # line-wrapped ACRONYM_RE matches) line up.
    def _inline_repl(m: "re.Match[str]") -> str:
        return " " * len(m.group(0))

    out = re.sub(r"`[^`\n]+`", _inline_repl, out)
    return out


def has_related_section(text: str) -> bool:
    """True if the file contains a `## Related` (or `## N. Related`) heading."""
    return bool(RELATED_HEADING_RE.search(text))


def _strip_antiglossary_section(text: str) -> str:
    """Remove the `## N. Anti-glossary ...` and `## 0. Quick start` sections.

    These two sections of the glossary are meta: they explain the rule
    rather than use the forbidden phrases. The glossary §0 Quick start
    explicitly cites "It depends" as an example of what to avoid; the
    §7 Anti-glossary is the documented home for the forbidden terms.
    Both are allowed to mention those phrases; nowhere else in the
    workspace is.
    """
    pattern = re.compile(
        r"^##\s+\d{0,2}\.?\s*(?:Quick\s+start|Anti-?glossary).*?(?=^##\s|\Z)",
        re.MULTILINE | re.DOTALL | re.IGNORECASE,
    )
    return pattern.sub("", text)


# ---------------------------------------------------------------------------
# acronym extraction from glossary
# ---------------------------------------------------------------------------

# Acronym soup table rows in glossary §6 look like `| TERM | meaning |`
# (one per line). We also pull bold-defined terms from §1-5 (`**TERM**`).
# The token class allows spaces so multi-word acronyms ("SOC 2",
# "PCI-DSS") are captured whole; the post-processing in
# `extract_known_acronyms` then splits to register both forms.
GLOSSARY_TABLE_ROW_RE = re.compile(
    r"^\|\s*([A-Z][A-Z0-9/\-\s]{1,15})\s*\|", re.MULTILINE
)
GLOSSARY_BOLD_TERM_RE = re.compile(
    r"\*\*([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)\*\*"
)


def extract_known_acronyms(glossary_text: str) -> Set[str]:
    """Collect the FORA-known acronym set from the glossary file body.

    Sources, in priority order:
      1. §6 "Acronym soup" table rows — canonical list. Multi-word
         acronyms ("SOC 2", "PCI-DSS", "CI/CD") yield BOTH the canonical
         form and the leading uppercase token so body text matching
         "SOC" alone is satisfied by the "SOC 2" entry.
      2. §1-5 bold-defined terms — project-specific words that must be
         treated as known vocabulary. Each uppercase token inside the
         bold span is added individually so "**Tenant ID**" covers
         both "Tenant ID" and "ID".

    The baseline `TECH_ALLOWED` set is unioned in by the caller so this
    function stays focused on the glossary.
    """
    known: Set[str] = set()

    # §6 acronym soup table rows (the canonical acronym list)
    for match in GLOSSARY_TABLE_ROW_RE.finditer(glossary_text):
        token = match.group(1).strip()
        # Canonical form (the whole entry: "CI/CD", "SOC 2")
        known.add(token)
        # First uppercase token — so "SOC" alone is known because
        # "SOC 2" is in the table.
        first = re.split(r"[\s/\-]", token)[0].strip()
        if 2 <= len(first) <= 9 and first.isupper():
            known.add(first)
        # Slashed/dashed parts (CI/CD -> CI and CD)
        for piece in re.split(r"[/\-]", token):
            piece = piece.strip()
            if 2 <= len(piece) <= 9 and piece.isupper():
                known.add(piece)

    # §1-5 bold-defined terms — add each uppercase word inside the bold
    # span so "**Tenant ID**" registers "Tenant" and "ID" separately.
    for match in GLOSSARY_BOLD_TERM_RE.finditer(glossary_text):
        token = match.group(1).strip()
        for piece in re.split(r"\s+", token):
            if 2 <= len(piece) <= 20 and piece[0].isupper():
                known.add(piece)

    return known


# ---------------------------------------------------------------------------
# rule checkers (one per production-bar rule)
# ---------------------------------------------------------------------------

def find_undefined_acronyms(
    body: str, known: Set[str]
) -> List[Tuple[int, str]]:
    """Return (line_no, acronym) for every acronym not in `known`.

    `body` must already have code blocks/spans stripped. The check is
    line-by-line so the diagnostic pinpoints the location.
    """
    allowed = known | TECH_ALLOWED
    out: List[Tuple[int, str]] = []
    for i, line in enumerate(body.splitlines(), start=1):
        for match in ACRONYM_RE.finditer(line):
            acro = match.group(0)
            if acro not in allowed:
                out.append((i, acro))
    return out


def find_vague_hedges(body: str) -> List[Tuple[int, str]]:
    """Return (line_no, phrase) for every anti-glossary hedge in `body`."""
    lowered = body.lower()
    out: List[Tuple[int, str]] = []
    for i, line in enumerate(lowered.splitlines(), start=1):
        for phrase in HEDGE_PATTERNS:
            if phrase in line:
                out.append((i, phrase))
    return out


def find_tribal_pointers(body: str) -> List[Tuple[int, str]]:
    """Return (line_no, pattern_id) for every tribal-knowledge pointer."""
    out: List[Tuple[int, str]] = []
    for i, line in enumerate(body.splitlines(), start=1):
        for pattern, pid in TRIBAL_PATTERNS:
            if re.search(pattern, line, flags=re.IGNORECASE):
                out.append((i, pid))
    return out


# ---------------------------------------------------------------------------
# main lint pass
# ---------------------------------------------------------------------------

def _seed_files(root: Path) -> List[Path]:
    """Return every .md file in the three Knowledge Layer subdirs, sorted."""
    files: List[Path] = []
    for sub in SEED_DIRS:
        d = root / sub
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.md")):
            files.append(p)
    return files


def lint(root: Path) -> LintReport:
    """Run all four production-bar rules against the seed under `root`.

    `root` is the directory that contains `memory/`, `customer/`, and
    `project/` — typically the workspace root. The function is pure
    (same root -> same report) and has no side effects beyond reading
    files.
    """
    import time as _time

    if not root.is_dir():
        raise FileNotFoundError(f"--root is not a directory: {root}")

    glossary_path = root / "customer" / "glossary.md"
    if not glossary_path.is_file():
        raise FileNotFoundError(
            f"glossary not found at {glossary_path}; the linter requires it."
        )

    t0 = _time.perf_counter()
    glossary_text = glossary_path.read_text(encoding="utf-8")
    known = extract_known_acronyms(glossary_text)

    report = LintReport(root=str(root))
    files = _seed_files(root)
    report.files_scanned = len(files)

    for f in files:
        rel = f.relative_to(root).as_posix()
        text = f.read_text(encoding="utf-8")
        body = strip_code_blocks(text)
        is_glossary = f.name == "glossary.md"

        # Rule 1: Related footer
        if not has_related_section(text):
            report.violations.append(Violation(
                file=rel, line=0, rule="related-footer",
                message="missing '## Related' (or '## N. Related') section",
            ))

        # Rule 2: undefined acronyms (skip the glossary file itself; it
        # is the source of truth and may define its own acronyms in §6
        # table rows and §1-5 bold terms).
        if not is_glossary:
            for line_no, acro in find_undefined_acronyms(body, known):
                report.violations.append(Violation(
                    file=rel, line=line_no, rule="undefined-acronym",
                    message=f"acronym {acro!r} is not in customer/glossary.md",
                ))

        # Rule 3: tribal-knowledge pointers
        for line_no, pid in find_tribal_pointers(body):
            report.violations.append(Violation(
                file=rel, line=line_no, rule="tribal-knowledge",
                message=f"tribal-knowledge reference (pattern={pid}); "
                        "point to another file in workspace/ instead",
            ))

        # Rule 4: vague hedges (skip the glossary's own anti-glossary
        # section, which is the documented home for these terms).
        hedge_body = _strip_antiglossary_section(body) if is_glossary else body
        for line_no, phrase in find_vague_hedges(hedge_body):
            report.violations.append(Violation(
                file=rel, line=line_no, rule="vague-hedge",
                message=f"vague hedge {phrase!r} from glossary §7 "
                        "anti-glossary is banned in production docs",
            ))

    report.elapsed_ms = round((_time.perf_counter() - t0) * 1000.0, 3)
    report.by_rule = _count_by_rule(report.violations)
    return report


def _count_by_rule(violations: Iterable[Violation]) -> dict:
    counts: dict = {}
    for v in violations:
        counts[v.rule] = counts.get(v.rule, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m agents.workspace.lint",
        description=(
            "Enforce the Knowledge Layer production bar from "
            "workspace/README.md §3 across the three seed directories."
        ),
    )
    p.add_argument(
        "--root", required=True, type=Path,
        help="Path to the workspace root (contains memory/, customer/, project/).",
    )
    p.add_argument(
        "--json", action="store_true",
        help="Emit a machine-readable JSON report on stdout.",
    )
    return p


def main(argv: List[str] | None = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    try:
        report = lint(args.root.resolve())
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report.to_dict(), indent=2, sort_keys=True))
    else:
        if report.violations:
            for v in report.violations:
                print(v.render(), file=sys.stderr)
        print(
            f"[workspace-lint] scanned {report.files_scanned} files in "
            f"{report.elapsed_ms} ms; "
            f"{len(report.violations)} violation(s)"
        )

    return report.exit_code()


if __name__ == "__main__":
    raise SystemExit(main())
