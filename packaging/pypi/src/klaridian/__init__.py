"""klaridian — Python-ecosystem distribution shim.

This package contains NO Python logic. It bundles the prebuilt, standalone
klaridian CLI binary (compiled from the TypeScript source with `bun build
--compile`, see ARCHITECTURE.md §64 / MCPFO-69) and execs it. A Python
developer runs `pip install klaridian` / `uv tool install klaridian` and gets
the native binary — zero Node, zero venv — for `klaridian generate
--language python`.

One source of truth (the TypeScript CLI), multiple distribution channels
(npm + PyPI wheels + Homebrew). Same pattern as ruff/uv (Astral).
"""

__all__ = ["__version__"]

# Kept in sync with packages/cli/package.json by the release tag gate.
__version__ = "0.0.1"
