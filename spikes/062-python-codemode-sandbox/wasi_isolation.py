"""
Spike 062 Phase 1 — PROVE a WASI (wasmtime + CPython.wasm) sandbox actually
isolates untrusted Python, where the in-process approach failed (see escape_poc.py).

Runs a snippet of UNTRUSTED python inside python.wasm under wasmtime with:
  - NO filesystem preopens  -> host FS unreachable
  - NO inherited env/network -> deny-by-default
The attacker tries the SAME escape that beat the in-process sandbox (recover
builtins, import os) AND then tries to actually read a host secret file.

exit 0 = sandbox HELD (attacker could not read the host secret).
exit 2 = sandbox BREACHED.
"""
import sys, tempfile, os
from wasmtime import Engine, Store, Module, Linker, WasiConfig

HERE = os.path.dirname(os.path.abspath(__file__))
WASM = os.path.join(HERE, "python.wasm")

# A real host secret that MUST remain unreachable from inside the sandbox.
secret_path = os.path.join(tempfile.gettempdir(), "klaridian_host_secret.txt")
with open(secret_path, "w") as f:
    f.write("TOP-SECRET-HOST-VALUE-42\n")

# Untrusted code: escape builtins (works in-process) THEN try to read the host
# secret via the recovered os. Under WASI with no preopens, the open must fail.
UNTRUSTED = r'''
# Full builtins are available here (normal `python -c`). No escape needed —
# this is the STRONGER test: even with os/open in hand, WASI must deny host
# access because nothing was preopened.
import os
print("SANDBOX: builtins available, os imported directly")
breached = False
try:
    data = open("/HOST_SECRET", "r").read()
    print("BREACH: read host secret ->", data.strip())
    breached = True
except Exception as e:
    print("BLOCKED file read:", type(e).__name__, str(e)[:60])
# try the real host tmp path too (absolute host path)
try:
    with open("/tmp/klaridian_host_secret.txt") as f:
        print("BREACH: read host tmp secret ->", f.read().strip())
        breached = True
except Exception as e:
    print("BLOCKED host-tmp read:", type(e).__name__)
# try to enumerate the host root
try:
    entries = os.listdir("/")
    print("root listing:", entries[:10])
    # if we can see host dirs like Users/etc, that's a breach signal
    if any(x in entries for x in ("Users", "etc", "home", "bin")):
        print("BREACH: host root visible")
        breached = True
except Exception as e:
    print("BLOCKED listdir /:", type(e).__name__)
print("ATTACKER_DONE breached=", breached)
'''

def run(preopen_secret: bool):
    engine = Engine()
    store = Store(engine)
    linker = Linker(engine)
    linker.define_wasi()
    wasi = WasiConfig()
    wasi.argv = ("python", "-c", UNTRUSTED)
    out = os.path.join(tempfile.gettempdir(), "wasi_stdout.txt")
    wasi.stdout_file = out
    wasi.stderr_file = os.path.join(tempfile.gettempdir(), "wasi_stderr.txt")
    # The whole point: do NOT preopen the host FS. (preopen_secret=True would
    # deliberately map the secret in, to show the sandbox only exposes what we grant.)
    if preopen_secret:
        wasi.preopen_dir(os.path.dirname(secret_path), "/")
    store.set_wasi(wasi)
    module = Module.from_file(engine, WASM)
    inst = linker.instantiate(store, module)
    start = inst.exports(store)["_start"]
    code = 0
    try:
        start(store)
    except Exception as e:
        code = getattr(e, "exit_code", 0) or 0
    return open(out).read()

if __name__ == "__main__":
    print("=== RUN A: no preopens (deny-by-default) ===")
    a = run(preopen_secret=False)
    print(a)
    # Honest verdict: require POSITIVE proof the attacker actually executed,
    # then that it was blocked. An empty/crashed run is INCONCLUSIVE, not a pass.
    ran = "ATTACKER_DONE" in a
    breached = "BREACH" in a
    if not ran:
        print("=== VERDICT: INCONCLUSIVE — attacker snippet did not run to completion ===")
        sys.exit(3)
    print("=== VERDICT:", "BREACHED" if breached else "HELD — host FS unreachable despite full builtins", "===")
    sys.exit(2 if breached else 0)
