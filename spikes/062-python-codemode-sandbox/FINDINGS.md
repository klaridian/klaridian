# Spike 062 — Python code-mode sandbox feasibility (MCPFO-54 / 60.25)

**Status:** DONE. Verdict per area below. Throwaway; no production code.
**Question:** can klaridian's TS code-mode sandbox (`emit-sandbox.ts`) be brought
to the Python target to close the last language-parity gap (MCPFO-55 / 60.35)?

---

## How TS code-mode is sandboxed today (the bar to match)

`emit-sandbox.ts` does NOT sandbox in-process. It spawns a **Deno subprocess**
and relies on Deno's runtime **capability** model (verified against the file):

- `--allow-net=<api-host-only>` — network scoped to the one API host.
- `--allow-read=<distDir-only>` — read scoped to the compiled client dir.
- `--allow-env=KLARIDIAN_BASE_URL,KLARIDIAN_AUTH_TOKEN` — exactly the two vars
  the generated client reads; every other parent-process secret is invisible.
- No `--allow-write`, `--allow-run`, `--allow-ffi`, `--allow-sys`.

The security is **deny-by-default at the runtime boundary**, not language tricks.
Model code is piped over stdin (`deno run -`) with cwd at the client dir.

## Why it is NOT a mechanical port to Python

Python has **no built-in capability sandbox**. `python -c` / `exec` run with full
OS access. The tempting in-process equivalent — run agent code with
`__builtins__ = {}` so it "can't" import `os` — is **broken by design**:

### PROOF (escape_poc.py, run on the real target interpreter)

    $ python3.11 escape_poc.py
    ESCAPED: imported os, os.getpid()=6797
    VERDICT: in-process empty-builtins sandbox is INVALID.  (exit 0)

Untrusted code using ONLY object introspection (no builtin names) walks the
subclass graph to `warnings.catch_warnings`, recovers the real `__builtins__`
dict off its module, calls `__import__("os")`, and runs a syscall. Generated
Python projects declare `requires-python = ">=3.10"`, so 3.11 is a real target;
the escape lands there. `sys.addaudithook` is likewise bypassable (documented
frame-walk on the SO thread) and, worse, is process-global — it would also
constrain the generated server's own code. **In-process Python sandboxing is a
known-lost battle** (RestrictedPython's own docs disclaim full safety).

## Options that actually isolate (research + first-principles)

| Mechanism | Isolates? | Cost to us | Portability |
|---|---|---|---|
| In-process (`__builtins__={}` / RestrictedPython / audit hooks) | ❌ escapable | low | n/a — rejected |
| **seccomp** subprocess (pyseccomp, syscall allowlist) | ✅ strong | medium | **Linux-only** (no macOS/Windows) |
| **OS containers** (Docker/Firecracker/gVisor) | ✅ strong | high; requires a runtime present | needs Docker/daemon |
| **WASM** (Pyodide / wasmtime + CPython.wasm) | ✅ strong (deny-by-default, like Deno) | medium | cross-platform, self-contained |

Only the last three are real. seccomp is Linux-only (klaridian's users run
macOS/Windows too — a non-starter as the *only* mechanism). Containers impose a
Docker dependency on a plain `generate`d project, which contradicts the
"standalone, auditable artifact you just run" positioning (PLAN §14/§16).

## Verdicts

**Code-mode sandbox: PARTIAL / feasible-but-not-cheap.**
- In-process port: **INVALIDATED** (proof above). Do not ship it.
- The faithful analogue of the Deno model is **WASM** (deny-by-default,
  capability-gated host functions, cross-platform, no external daemon). That is
  a *materially larger* build than the TS path (which got Deno's sandbox for
  free), and it constrains what the agent's Python code can import (no arbitrary
  C-extension deps inside WASM).
- seccomp-subprocess is a viable **Linux-only** fast path but fails the
  cross-platform bar as a sole mechanism.

**Run/prepare lifecycle (the second spike area): VALIDATED as already-shipped.**
- The ticket predates the base Python work. Re-checking the real tree: Python
  `start`/deploy/venv lifecycle already exists and is E2E-tested
  (`start.test.ts` Python branch, `emit-python-e2e.test.ts`, deploy detects
  `pyproject.toml`+`server.py`). The venv IS the artifact; no bundle-equivalent
  needed. This half of the spike is a no-op today.

## Recommendation (feeds MCPFO-55 / 60.35)

**Do NOT build Python code-mode now. Keep the current fail-loud gate.** Rationale:

1. "Full parity" minus code-mode is **near-total and honest** — the gate throws a
   clear message pointing to `--language typescript`. That is a defensible
   product state, not a hidden hole.
2. Closing it *correctly* means a WASM sandbox — a real project of its own, with
   its own security-review burden — not the mechanical port the parity framing
   implies. Wrong to slip it in at the end of a session.
3. No demand signal yet (§8/§60: Python exists as an IR forcing-function, not
   from pull). Spend the sandbox-engineering budget only when code-mode-in-Python
   is actually asked for.

**Follow-up:** if/when demand appears, scope a dedicated ticket for a WASM-based
Python sandbox (evaluate wasmtime + CPython.wasm vs Pyodide; define the host-fn
capability surface mirroring the Deno allow-list). Track as successor to 60.35.
