"""Hatchling build hook: embed the prebuilt klaridian binary and force a
platform-specific wheel tag.

Two jobs a pure-Python wheel build wouldn't do:

1. Copy the compiled binary from where CI put it (KLARIDIAN_BINARY env var, or
   the conventional dist path) into the package tree at
   `src/klaridian/_binary/<name>` so it's included as package data.

2. Mark the wheel as NON-pure and stamp the correct platform tag. A wheel that
   ships a native executable must be tagged (e.g. `macosx_11_0_arm64`) so pip on
   another platform never installs the wrong binary. The tag comes from
   KLARIDIAN_WHEEL_PLAT (set per matrix leg in CI); locally it defaults to the
   host platform so a dev build is installable on the dev machine.
"""

from __future__ import annotations

import os
import shutil
import sys
import sysconfig
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


def _host_platform_tag() -> str:
    """Best-effort host wheel platform tag (e.g. macosx_11_0_arm64)."""
    tag = sysconfig.get_platform().replace("-", "_").replace(".", "_")
    return tag


class KlaridianBuildHook(BuildHookInterface):
    PLUGIN_NAME = "klaridian-binary"

    def initialize(self, version: str, build_data: dict) -> None:
        root = Path(self.root)
        pkg_bindir = root / "src" / "klaridian" / "_binary"
        pkg_bindir.mkdir(parents=True, exist_ok=True)

        # Windows detection must be exact: the substring "win" also appears in
        # "darwin" (dar-win), so a naive `"win" in ...` mislabels macOS as
        # Windows and ships a `.exe`. Check the wheel platform tag prefix, or
        # sys.platform == "win32".
        plat_env = os.environ.get("KLARIDIAN_WHEEL_PLAT", "")
        is_windows = plat_env.startswith("win") or (not plat_env and sys.platform == "win32")
        binary_name = "klaridian.exe" if is_windows else "klaridian"

        # Where CI (or a local build) left the compiled binary.
        src = os.environ.get("KLARIDIAN_BINARY")
        if not src:
            # Convention: spikes/060 or dist/ host build.
            for candidate in (
                root / "dist" / "binary" / binary_name,
                root.parent.parent / "dist" / "binary" / binary_name,
            ):
                if candidate.exists():
                    src = str(candidate)
                    break
        if not src or not Path(src).exists():
            raise RuntimeError(
                "KlaridianBuildHook: compiled binary not found. Set KLARIDIAN_BINARY "
                "to the `bun build --compile` output, or place it at dist/binary/"
                f"{binary_name}. (Refusing to build a wheel with no binary — "
                "fail loudly, don't ship an empty shim.)"
            )

        dst = pkg_bindir / binary_name
        shutil.copy2(src, dst)
        if not is_windows:
            os.chmod(dst, 0o755)

        # Non-pure: this wheel is platform-specific.
        build_data["pure_python"] = False
        build_data["infer_tag"] = False
        plat = os.environ.get("KLARIDIAN_WHEEL_PLAT") or _host_platform_tag()
        # py3-none-<plat>: no C-extension ABI, but platform-locked by the binary.
        build_data["tag"] = f"py3-none-{plat}"
        build_data["force_include"][str(dst)] = f"klaridian/_binary/{binary_name}"
