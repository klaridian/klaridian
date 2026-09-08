"""Entry point: locate the embedded klaridian binary and hand off to it.

`os.execv` REPLACES this Python process with the native binary, so there is no
wrapper process lingering, no double signal handling, and exit codes/stdio pass
through transparently — critical because the generated MCP servers speak
JSON-RPC over stdio and any wrapper corrupting the stream would be a bug
(mirrors the stdio-safety discipline in ARCHITECTURE.md spike-001).

On Windows there is no `execv` that behaves like POSIX, so we fall back to
spawning the binary as a child and forwarding its exit code.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _binary_path() -> Path:
    """Absolute path to the bundled CLI binary inside this installed package."""
    here = Path(__file__).resolve().parent
    name = "klaridian.exe" if sys.platform == "win32" else "klaridian"
    candidate = here / "_binary" / name
    return candidate


def main() -> "int | None":
    binary = _binary_path()
    if not binary.exists():
        sys.stderr.write(
            f"klaridian: bundled binary not found at {binary}. This wheel may be "
            "corrupt or built for a different platform. Reinstall with "
            "`pip install --force-reinstall klaridian`.\n"
        )
        return 70  # EX_SOFTWARE

    # Ensure it's executable (wheels can strip the bit on some unpack paths).
    if sys.platform != "win32":
        mode = binary.stat().st_mode
        os.chmod(binary, mode | 0o111)

    argv = [str(binary), *sys.argv[1:]]

    if sys.platform == "win32":
        import subprocess

        completed = subprocess.run(argv)
        return completed.returncode

    # POSIX: replace this process entirely.
    os.execv(str(binary), argv)
    # execv only returns on failure.
    return 71  # EX_OSERR


if __name__ == "__main__":
    raise SystemExit(main())
