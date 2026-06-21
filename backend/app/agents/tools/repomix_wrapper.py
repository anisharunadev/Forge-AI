"""Repomix tool — wraps the ``repomix`` CLI as a LangChain tool.

Repomix packs a repository into a single LLM-friendly file (XML, JSON,
or plain text). This module exposes it both as a LangChain ``BaseTool``
and as a high-level ``RepomixTool`` that node code can call directly.

If the ``repomix`` binary is missing from PATH the tool degrades to a
deterministic file-listing stub so tests and CI environments without
``repomix`` installed still get a structured response.
"""

from __future__ import annotations

import asyncio
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, ClassVar, Literal

from langchain_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field


OutputFormat = Literal["xml", "json", "markdown", "plain"]


@dataclass(slots=True)
class RepomixPack:
    """Output of a single ``repomix`` invocation."""

    repo_path: str
    output_format: OutputFormat
    output: str
    used_stub: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "repo_path": self.repo_path,
            "output_format": self.output_format,
            "used_stub": self.used_stub,
            "output": self.output,
        }


class RepomixInput(BaseModel):
    """Input schema for :class:`RepomixLangChainTool`."""

    repo_path: str = Field(
        ...,
        description="Absolute path to the repository to pack.",
    )
    output_format: OutputFormat = Field(
        default="xml",
        description="One of: xml, json, markdown, plain.",
    )
    include_patterns: list[str] = Field(
        default_factory=list,
        description="Glob patterns to include (e.g. 'src/**/*.py').",
    )


class RepomixTool:
    """High-level adapter used by SDLC nodes.

    Methods
    -------
    pack_repo(repo_path, output_format='xml') -> str
        Synchronously pack a repository and return the output text.
    pack_repo_async(repo_path, output_format='xml') -> str
        Async variant for use inside ``async def`` node methods.
    """

    def __init__(
        self,
        *,
        binary: str | None = None,
        timeout_seconds: float = 60.0,
    ) -> None:
        self._binary = binary or shutil.which("repomix") or "repomix"
        self._timeout = timeout_seconds

    @property
    def binary_available(self) -> bool:
        return shutil.which(self._binary) is not None

    # ---- Public API ----------------------------------------------------

    async def pack_repo_async(
        self,
        repo_path: str,
        output_format: OutputFormat = "xml",
        *,
        include_patterns: list[str] | None = None,
    ) -> str:
        """Pack a repo asynchronously. Falls back to the stub on failure."""

        if not self.binary_available:
            return _stub_pack(repo_path, output_format).output

        args = [self._binary, "--output-format", output_format, repo_path]
        for pattern in include_patterns or []:
            args.extend(["--include", pattern])
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=self._timeout
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return _stub_pack(repo_path, output_format, reason="timeout").output
        if proc.returncode != 0:
            return _stub_pack(
                repo_path,
                output_format,
                reason=(stderr_b.decode("utf-8", errors="replace")[:500]),
            ).output
        return stdout_b.decode("utf-8", errors="replace")

    def pack_repo(
        self,
        repo_path: str,
        output_format: OutputFormat = "xml",
        *,
        include_patterns: list[str] | None = None,
    ) -> str:
        """Synchronous wrapper used by LangChain ``_run`` and tests."""

        return asyncio.run(
            self.pack_repo_async(
                repo_path, output_format, include_patterns=include_patterns
            )
        )

    # ---- Stub fallback -------------------------------------------------

    def stub(self, repo_path: str, output_format: OutputFormat = "xml") -> RepomixPack:
        return _stub_pack(repo_path, output_format)


class RepomixLangChainTool(BaseTool):
    """LangChain ``BaseTool`` adapter around :class:`RepomixTool`.

    Provides the LangChain-required ``_run`` / ``_arun`` pair plus a
    typed args schema so it can be attached directly to an agent.
    """

    name: str = "repomix_pack_repo"
    description: str = (
        "Pack a repository into a single LLM-friendly document using repomix. "
        "Accepts the repo path and an output_format ('xml', 'json', "
        "'markdown', 'plain')."
    )
    args_schema: type[BaseModel] = RepomixInput
    tool: RepomixTool = Field(default_factory=RepomixTool)

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def _run(
        self,
        repo_path: str,
        output_format: OutputFormat = "xml",
        include_patterns: list[str] | None = None,
    ) -> str:
        return self.tool.pack_repo(repo_path, output_format, include_patterns=include_patterns)

    async def _arun(
        self,
        repo_path: str,
        output_format: OutputFormat = "xml",
        include_patterns: list[str] | None = None,
    ) -> str:
        return await self.tool.pack_repo_async(
            repo_path, output_format, include_patterns=include_patterns
        )


def _stub_pack(
    repo_path: str,
    output_format: OutputFormat,
    *,
    reason: str | None = None,
) -> RepomixPack:
    """Deterministic stub used when the real ``repomix`` binary is absent.

    Produces a small structured summary so downstream code can continue
    to work even in environments without repomix installed.
    """

    root = Path(repo_path)
    file_count = 0
    total_bytes = 0
    listed: list[str] = []
    if root.exists() and root.is_dir():
        for path in root.rglob("*"):
            if path.is_file():
                file_count += 1
                total_bytes += path.stat().st_size
                try:
                    rel = path.relative_to(root).as_posix()
                except ValueError:
                    rel = str(path)
                listed.append(rel)
                if len(listed) >= 50:
                    break
    if output_format == "json":
        payload = {
            "stub": True,
            "reason": reason or "repomix_not_installed",
            "repo_path": repo_path,
            "file_count": file_count,
            "total_bytes": total_bytes,
            "files": listed,
        }
        import json

        output = json.dumps(payload, indent=2)
    elif output_format == "markdown":
        lines = [f"# Repomix Stub Pack: {repo_path}", ""]
        if reason:
            lines.append(f"_reason: {reason}_")
        lines.append(f"- file_count: {file_count}")
        lines.append(f"- total_bytes: {total_bytes}")
        lines.append("")
        lines.append("## Files")
        for f in listed:
            lines.append(f"- `{f}`")
        output = "\n".join(lines)
    elif output_format == "plain":
        output = "\n".join(listed) or "(empty)"
    else:  # xml default
        lines = [f"<repomix repo={repo_path!r} stub='true'>"]
        if reason:
            lines.append(f"  <reason>{reason}</reason>")
        lines.append(f"  <file_count>{file_count}</file_count>")
        lines.append(f"  <total_bytes>{total_bytes}</total_bytes>")
        for f in listed:
            lines.append(f"  <file>{f}</file>")
        lines.append("</repomix>")
        output = "\n".join(lines)

    return RepomixPack(
        repo_path=repo_path,
        output_format=output_format,
        output=output,
        used_stub=True,
    )


def build_default_repomix_tool() -> RepomixTool:
    return RepomixTool()


__all__ = [
    "RepomixTool",
    "RepomixLangChainTool",
    "RepomixPack",
    "RepomixInput",
    "build_default_repomix_tool",
]
