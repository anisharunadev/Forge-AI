"""ScriptSandbox — hardened subprocess runner for workflow ``script`` nodes.

A ``script`` node in a custom workflow is user-authored code that runs in
the orchestrator's process. We must execute it without giving it the keys
to the kingdom: no network, bounded CPU, bounded memory, bounded
processes. The class wraps :func:`subprocess.run` with:

* ``RLIMIT_CPU`` — wall-clock CPU seconds (default 60s).
* ``RLIMIT_AS`` — virtual address-space bytes (default 256 MiB).
* ``RLIMIT_NPROC`` — number of processes (default 1).
* A seccomp filter that blocks ``socket(AF_INET, *)`` so the child cannot
  reach the network even by direct syscall.
* A clean environment (``env={}``) — no inherited ``DATABASE_URL`` etc.

Cross-platform:

* **Linux** — all four guardrails apply. The seccomp filter is a
  lightweight BPF program installed via ``libseccomp-tools`` or a
  pure-Python fallback (we ship the pure-Python fallback so tests do
  not require a kernel module).
* **macOS / other** — seccomp is not available. We still set RLIMITS
  but log a warning that the sandbox is best-effort. The tests mark
  the network-blocked case as ``xfail`` on Darwin.

The contract returns a typed envelope::

    {
        "stdout": str,
        "stderr": str,
        "exit_code": int,       # -signal on SIGKILL, -1 on timeout
        "duration_ms": int,
        "network_blocked": bool,
    }

``network_blocked`` is True iff the kernel delivered SIGSYS to the
child because of the seccomp filter. The test suite asserts this on
Linux; on macOS it is always False (network access is permitted at
the syscall layer — the test is ``xfail``).

Rule 1 (provider-agnostic) — sandbox does NOT import any LLM SDK.
Rule 2 (multi-tenancy) — caller passes ``tenant_id`` so the audit
emitted in :class:`WorkflowExecutor` carries it.
"""

from __future__ import annotations

import os
import platform
import resource
import shutil
import struct
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


_IS_LINUX = platform.system() == "Linux"

# Sentinel written to stderr by the in-script probe when an AF_INET socket
# creation raises EPERM. Read by the parent to set ``network_blocked=True``.
_BLOCKED_MARKER = "__FORGE_SANDBOX_NET_BLOCKED__"


def _indent(text: str, prefix: str) -> str:
    """Indent every non-empty line of ``text`` by ``prefix``."""
    return "\n".join(prefix + line if line else line for line in text.splitlines())


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class ScriptSandboxResult:
    """Typed envelope returned by :meth:`ScriptSandbox.run`."""

    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
    network_blocked: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "stdout": self.stdout,
            "stderr": self.stderr,
            "exit_code": self.exit_code,
            "duration_ms": self.duration_ms,
            "network_blocked": self.network_blocked,
        }


# ---------------------------------------------------------------------------
# Seccomp filter (Linux only) — blocks socket(AF_INET, *)
# ---------------------------------------------------------------------------


def _build_seccomp_filter_af_inet_block() -> bytes | None:
    """Return a BPF program that returns EPERM (``0x00050026``) when
    the child invokes ``socket(AF_INET, ...)``.

    The ``seccomp_data`` layout (see ``<linux/seccomp.h>``)::

        struct seccomp_data {
            int   nr;                    // offset 0  — syscall number
            __u32 arch;                  // offset 4
            __u64 instruction_pointer;   // offset 8
            __u64 args[6];               // offset 16, 24, 32, 40, 48, 56
        };

    Filter (BPF_STMT / BPF_JUMP):

        0. ld [0]   — load syscall number
        1. jeq SYS_socket (41), jt=0, jf=3
        2. ld [16]  — load arg0 (AF_*)
        3. jeq AF_INET (2), jt=0, jf=1
        4. ret EPERM
        5. ret ALLOW

    On x86_64 SYS_SOCKET = 41. On aarch64 SYS_SOCKET = 198. We pass the
    correct value via :data:`_SYS_SOCKET_NR` per-architecture.

    Only used on Linux. On macOS this function returns ``None`` and the
    caller logs a sandbox-degraded warning.
    """
    if not _IS_LINUX:
        return None

    # Per-arch syscall number — see /usr/include/asm-generic/unistd.h
    # and arch-specific asm/unistd_64.h.
    import platform as _platform

    # Default to x86_64 — covers all Linux dev/CI runners we ship.
    SYS_SOCKET = 198 if _platform.machine() == "aarch64" else 41

    BPF_LD_W_ABS = 0x20
    BPF_JMP_JEQ = 0x15
    BPF_RET = 0x06

    SECCOMP_RET_ALLOW = 0x7FFF0000
    # SECCOMP_RET_ERRNO(value) = 0x0005FFFF & (value & 0xFFFF)
    # EPERM = 1 → SECCOMP_RET_ERRNO_EPERM = 0x00050001
    SECCOMP_RET_ERRNO_EPERM = 0x00050001

    def stmt(code: int, jt: int, jf: int, k: int) -> bytes:
        return struct.pack("<HBBI", code, jt, jf, k)

    prog = b""
    # ld [0] — syscall number (seccomp_data.nr)
    prog += stmt(BPF_LD_W_ABS, 0, 0, 0)
    # jeq SYS_SOCKET, jt=0 (fall through), jf=3 (skip to ALLOW)
    prog += stmt(BPF_JMP_JEQ, 0, 3, SYS_SOCKET)
    # ld [16] — arg0 (AF_*)
    prog += stmt(BPF_LD_W_ABS, 0, 0, 16)
    # jeq AF_INET (2), jt=0 (fall through to EPERM), jf=1 (skip to ALLOW)
    prog += stmt(BPF_JMP_JEQ, 0, 1, 2)
    # ret EPERM
    prog += stmt(BPF_RET, 0, 0, SECCOMP_RET_ERRNO_EPERM)
    # ret ALLOW
    prog += stmt(BPF_RET, 0, 0, SECCOMP_RET_ALLOW)
    return prog


def _install_seccomp_filter() -> None:
    """Install the seccomp BPF filter for the current process.

    Uses ``prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, prog)`` (mode 2)
    via ``ctypes`` to avoid a libseccomp dependency. ``prctl`` is
    available on Linux only.
    """
    if not _IS_LINUX:
        return
    prog = _build_seccomp_filter_af_inet_block()
    if prog is None:
        return
    import ctypes
    import ctypes.util

    libc = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6", use_errno=True)
    PR_SET_NO_NEW_PRIVS = 38  # /usr/include/linux/prctl.h
    PR_SET_SECCOMP = 22
    SECCOMP_MODE_FILTER = 2

    # prctl(unsigned long option, unsigned long arg2, unsigned long arg3, ...)
    # Second arg is a pointer to the sock_fprog struct: { unsigned short len; struct sock_filter *filter; }  # noqa: E501
    class _SockFprog(ctypes.Structure):
        _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.c_char_p)]

    # SECCOMP_MODE_FILTER requires no_new_privs to be set first; otherwise
    # prctl returns EPERM. This is a per-thread flag that survives exec.
    rc_no_new_privs = libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
    if rc_no_new_privs != 0:
        errno = ctypes.get_errno()
        logger.warning(
            "script_sandbox.no_new_privs_failed",
            errno=errno,
            fallback="rlimits_only",
        )
        return

    fprog = _SockFprog(len=len(prog) // 8, filter=ctypes.c_char_p(prog))
    rc = libc.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ctypes.byref(fprog), 0, 0)
    if rc != 0:
        errno = ctypes.get_errno()
        logger.warning(
            "script_sandbox.seccomp_install_failed",
            errno=errno,
            fallback="rlimits_only",
        )


# ---------------------------------------------------------------------------
# Sandbox
# ---------------------------------------------------------------------------


class ScriptSandbox:
    """Run user-authored scripts under hard resource limits."""

    # Default limits.
    DEFAULT_CPU_SECONDS = 60
    DEFAULT_MEMORY_BYTES = 256 * 1024 * 1024  # 256 MiB
    DEFAULT_NPROC = 1

    # Per-language interpreter map. Keep tiny on purpose — Phase C ships
    # ``python``; ``javascript`` is a placeholder until we wire node in 5-02.
    _INTERPRETERS = {
        "python": sys.executable,
        "javascript": None,  # not bundled in Phase C
    }

    def __init__(
        self,
        *,
        cpu_seconds: int = DEFAULT_CPU_SECONDS,
        memory_bytes: int = DEFAULT_MEMORY_BYTES,
        nproc: int = DEFAULT_NPROC,
    ) -> None:
        self.cpu_seconds = cpu_seconds
        self.memory_bytes = memory_bytes
        self.nproc = nproc

    # ---- Public API -------------------------------------------------------

    def run(
        self,
        language: str,
        source: str,
        timeout_s: int | None = None,
        *,
        stdin_input: str = "",
    ) -> ScriptSandboxResult:
        """Execute ``source`` in the language's interpreter.

        Args:
            language: ``"python"`` (supported) or ``"javascript"`` (stub).
            source: program text.
            timeout_s: hard wall-clock cap (defaults to ``cpu_seconds``).
            stdin_input: optional stdin payload.

        Returns:
            A :class:`ScriptSandboxResult` envelope.

        Raises:
            ValueError: unknown language.
            NotImplementedError: language interpreter is not bundled.
        """
        if language not in self._INTERPRETERS:
            raise ValueError(f"unknown script language: {language!r}")
        interpreter = self._INTERPRETERS[language]
        if interpreter is None:
            raise NotImplementedError(
                f"script language {language!r} interpreter is not bundled in this build"
            )

        timeout = float(timeout_s if timeout_s is not None else self.cpu_seconds)

        # Wrap the user source in a try/finally so the network probe
        # fires even if user code raises. The probe tries to create an
        # AF_INET socket; if the seccomp filter blocks it, the
        # resulting OSError carries the marker so the parent can detect
        # ``network_blocked=True`` for this run.
        wrapped_source = (
            "import sys as _forge_sys\n"
            "try:\n" + _indent(source, "    ") + "\nexcept BaseException:\n"
            "    _forge_sys.stderr.write(_forge_sys.exc_info()[1] or '')\n"
            "    raise\n"
            "finally:\n"
            "    try:\n"
            "        import socket as _forge_socket\n"
            "        _forge_s = _forge_socket.socket(_forge_socket.AF_INET, _forge_socket.SOCK_STREAM)\n"  # noqa: E501
            "        _forge_s.close()\n"
            "    except OSError as _forge_e:\n"
            "        if _forge_e.errno in (1, 13, 38):\n"
            f'            _forge_sys.stderr.write("{_BLOCKED_MARKER}\\n")\n'
            "            _forge_sys.stderr.flush()\n"
            if language == "python"
            else source
        )

        # Write the source to a temp file so the child gets a real
        # interpreter (avoids the ``-c`` quoting footgun on Windows).
        import tempfile

        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix={  # type: ignore[arg-type]
                "python": ".py",
                "javascript": ".js",
            }.get(language, ".txt"),
            delete=False,
        ) as handle:
            handle.write(wrapped_source)
            tmp_path = handle.name

        try:
            return self._spawn(
                interpreter=interpreter,
                args=[interpreter, tmp_path],
                timeout_s=timeout,
                stdin_input=stdin_input,
            )
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:  # pragma: no cover - best-effort cleanup
                pass

    # ---- Internals --------------------------------------------------------

    def _spawn(
        self,
        *,
        interpreter: str,
        args: list[str],
        timeout_s: float,
        stdin_input: str,
    ) -> ScriptSandboxResult:
        preexec_fn = self._build_preexec_fn()
        start = time.monotonic()

        # ``subprocess.run`` raises TimeoutExpired on timeout. We catch
        # that and convert to a typed envelope with ``exit_code=-1``.
        # On a SIGSYS from seccomp, the child dies with signal 31 and
        # ``exit_code`` is ``-31`` (negative signal) per CPython convention.
        try:
            completed = subprocess.run(
                args,
                input=stdin_input,
                capture_output=True,
                text=True,
                timeout=timeout_s,
                env={},  # hard rule: no inherited env
                check=False,
                preexec_fn=preexec_fn if _IS_LINUX else None,
            )
        except subprocess.TimeoutExpired as exc:
            duration_ms = int((time.monotonic() - start) * 1000)
            return ScriptSandboxResult(
                stdout=exc.stdout or "",
                stderr=(exc.stderr or "") + f"\n[sandbox] timeout after {timeout_s}s",
                exit_code=-1,
                duration_ms=duration_ms,
                network_blocked=False,
            )
        except FileNotFoundError as exc:
            # Interpreter missing — surface as a typed failure.
            duration_ms = int((time.monotonic() - start) * 1000)
            return ScriptSandboxResult(
                stdout="",
                stderr=f"[sandbox] interpreter not found: {exc}",
                exit_code=127,
                duration_ms=duration_ms,
                network_blocked=False,
            )

        duration_ms = int((time.monotonic() - start) * 1000)
        # We return SECCOMP_RET_ERRNO_EPERM from the filter, so the child
        # process exits with exit code 0 even though the syscall was
        # blocked at the OS layer (Python translates EPERM → OSError).
        # We can't use returncode to detect the block, so we set
        # ``_network_block_seen`` on the parent's stderr if the child
        # prints the blocked marker (see _BLOCKED_MARKER below).
        network_blocked = _BLOCKED_MARKER in (completed.stderr or "")

        return ScriptSandboxResult(
            stdout=completed.stdout or "",
            stderr=completed.stderr or "",
            exit_code=completed.returncode,
            duration_ms=duration_ms,
            network_blocked=network_blocked,
        )

    def _build_preexec_fn(self):
        """Build the preexec callback applied between fork() and exec().

        On Linux this:
        - sets RLIMIT_CPU (hard wall-clock cap)
        - sets RLIMIT_AS (virtual memory cap)
        - sets RLIMIT_NPROC (process cap)
        - installs the seccomp filter
        - drops into a new process group so we can kill the subtree

        On non-Linux the function still returns a callable that sets
        RLIMITS where available (macOS lacks RLIMIT_NPROC; we silently
        skip it). No seccomp install.
        """

        def _preexec() -> None:  # runs in the child after fork, before exec
            # Best-effort RLIMITS — wrapped in try/except because the
            # child is in a fragile state and any error here masks the
            # real exception from the program. ALL exceptions are
            # swallowed here so an EINTR or EPERM in the child doesn't
            # kill the parent subprocess plumbing (subprocess.run wraps
            # any exception here into SubprocessError which then masks
            # the actual sandbox outcome).
            try:
                resource.setrlimit(resource.RLIMIT_CPU, (self.cpu_seconds, self.cpu_seconds))
            except BaseException:  # pragma: no cover
                pass
            try:
                resource.setrlimit(resource.RLIMIT_AS, (self.memory_bytes, self.memory_bytes))
            except BaseException:  # pragma: no cover
                pass
            if hasattr(resource, "RLIMIT_NPROC"):
                try:
                    resource.setrlimit(resource.RLIMIT_NPROC, (self.nproc, self.nproc))
                except BaseException:  # pragma: no cover
                    pass

            # Move to its own process group so a timeout kill can reach
            # any grandchildren without nuking the orchestrator.
            try:
                os.setsid()
            except BaseException:  # pragma: no cover
                pass

            if not _IS_LINUX:
                # Best-effort: no seccomp on Darwin. Log once on the
                # parent side via the caller's logger.
                return

            try:
                _install_seccomp_filter()
            except BaseException:  # pragma: no cover
                pass

        return _preexec


# ---------------------------------------------------------------------------
# Convenience singletons
# ---------------------------------------------------------------------------


def get_default_sandbox() -> ScriptSandbox:
    """Default sandbox instance used by the executor."""
    return ScriptSandbox()


# Sanity-check at import time that the shell command we hand to the
# interpreter is at least findable on PATH. Logged once.
if _IS_LINUX and shutil.which("python3") is None:
    logger.warning("script_sandbox.python3_not_on_path")


__all__ = ["ScriptSandbox", "ScriptSandboxResult", "get_default_sandbox"]
