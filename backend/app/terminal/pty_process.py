"""PTY process wrapper (F-402).

Uses the stdlib `pty` module on POSIX so we don't pin a third-party
dependency for what is fundamentally a forkpty + select loop. The
wrapper is async-friendly: read/write go through a thread that
blocks on the OS but yields bytes back to the asyncio loop.
"""

from __future__ import annotations

import asyncio
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import termios
from typing import Any


class PTYProcess:
    """Async wrapper around a forkpty'd child process.

    Lifecycle:
        pty = PTYProcess()
        await pty.start(["claude"], cwd="/workspace", env={...})
        while True:
            data = await pty.read()  # may be b'' on EOF
            if not data: break
        await pty.kill()
    """

    def __init__(self) -> None:
        self.pid: int | None = None
        self.fd: int | None = None
        self._closed = False
        self._loop: asyncio.AbstractEventLoop | None = None

    async def start(
        self,
        command: list[str],
        *,
        cwd: str,
        env: dict[str, str] | None = None,
    ) -> None:
        """Fork+exec the command under a new PTY.

        Args:
            command: argv list; argv[0] is the program.
            cwd: working directory; must already be inside the
                 session's allowed workspace (caller responsibility).
            env: environment overrides merged onto os.environ.
        """
        self._loop = asyncio.get_running_loop()
        pid, fd = await self._loop.run_in_executor(None, self._fork_exec, command, cwd, env or {})
        self.pid = pid
        self.fd = fd

    @staticmethod
    def _fork_exec(command: list[str], cwd: str, env: dict[str, str]) -> tuple[int, int]:
        """Blocking forkpty call (run in executor)."""
        full_env = {**os.environ, **env}
        pid, fd = pty.fork()
        if pid == 0:
            # Child: set cwd then exec.
            try:
                os.chdir(cwd)
            except OSError:
                os._exit(127)
            try:
                os.execvpe(command[0], command, full_env)
            except OSError:
                os._exit(126)
        # Parent
        # Set the master fd non-blocking so read() returns EAGAIN instead of blocking.
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        return pid, fd

    async def read(self) -> bytes:
        """Non-blocking read; returns b'' on EAGAIN/EOF.

        The WebSocket layer polls this in a tight loop.
        """
        if self.fd is None or self._closed:
            return b""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._read_blocking)

    def _read_blocking(self) -> bytes:
        assert self.fd is not None
        try:
            data = os.read(self.fd, 4096)
        except OSError as exc:
            if exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                return b""
            if exc.errno == errno.EIO:  # child exited
                self._closed = True
                return b""
            raise
        if not data:
            self._closed = True
        return data

    async def write(self, data: bytes) -> None:
        """Write user input to the PTY."""
        if self.fd is None or self._closed:
            raise RuntimeError("PTY closed")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._write_blocking, data)

    def _write_blocking(self, data: bytes) -> None:
        assert self.fd is not None
        try:
            os.write(self.fd, data)
        except OSError as exc:
            if exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                # Backpressure: caller will retry; we don't drop bytes.
                return
            raise

    async def resize(self, rows: int, cols: int) -> None:
        """Send TIOCSWINSZ so TUI apps re-layout."""
        if self.fd is None:
            return
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._resize_blocking, rows, cols)

    def _resize_blocking(self, rows: int, cols: int) -> None:
        assert self.fd is not None
        size = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, size)

    async def kill(self) -> None:
        """Send SIGTERM, then SIGKILL after a grace period."""
        if self.pid is None or self._closed:
            return
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._kill_blocking)

    def _kill_blocking(self) -> None:
        if self.pid is None or self.fd is None:
            return
        try:
            os.kill(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError:
            pass
        # Force-close the master fd so read() returns immediately.
        try:
            os.close(self.fd)
        except OSError:
            pass
        self._closed = True

    @property
    def closed(self) -> bool:
        return self._closed


__all__ = ["PTYProcess"]
