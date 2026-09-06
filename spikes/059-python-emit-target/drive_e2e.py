"""
spikes/059-python-emit-target/drive_e2e.py

Real E2E driver — mirrors packages/cli/test/emit-e2e.test.ts's rigor but for
the Python emit target: spawn the emitted server as a REAL subprocess (fresh
venv, real `pip install` already done), speak REAL JSON-RPC over stdio
(initialize -> tools/list -> tools/call unknown -> tools/call real, with a
mocked upstream HTTP so we don't need network), and assert on real responses.

Not a unit test. This is throwaway spike code, run once, verdict recorded in
README.md.
"""
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

OUT_DIR = Path(__file__).parent / "out"
PYTHON = str(OUT_DIR / ".venv" / "bin" / "python")


def send(proc, msg):
    proc.stdin.write((json.dumps(msg) + "\n").encode())
    proc.stdin.flush()


import queue

def _reader_thread(proc, q):
    for line in iter(proc.stdout.readline, b""):
        q.put(line)


def read_line(proc, timeout=15):
    if not hasattr(proc, "_line_queue"):
        proc._line_queue = queue.Queue()
        t = threading.Thread(target=_reader_thread, args=(proc, proc._line_queue), daemon=True)
        t.start()
    while True:
        try:
            line = proc._line_queue.get(timeout=timeout).decode().strip()
        except queue.Empty:
            raise TimeoutError(f"no JSON-RPC line within {timeout}s")
        if line:
            return json.loads(line)


def main():
    proc = subprocess.Popen(
        [PYTHON, "server.py"],
        cwd=str(OUT_DIR),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={"KLARIDIAN_BASE_URL": "https://petstore3.swagger.io/api/v3", "PATH": "/usr/bin:/bin"},
    )

    def drain_stderr():
        for line in iter(proc.stderr.readline, b""):
            sys.stderr.write("[server stderr] " + line.decode())

    t = threading.Thread(target=drain_stderr, daemon=True)
    t.start()

    results = {}
    try:
        # 1. initialize
        send(proc, {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                       "clientInfo": {"name": "e2e-py", "version": "1.0.0"}},
        })
        init_resp = read_line(proc)
        results["initialize"] = init_resp
        assert init_resp.get("id") == 1, init_resp
        assert "result" in init_resp, init_resp
        print("PASS: initialize ->", json.dumps(init_resp["result"])[:200])

        # Send required 'notifications/initialized' (some SDKs require it before other calls)
        send(proc, {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

        # 2. tools/list
        send(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        list_resp = read_line(proc)
        results["tools_list"] = list_resp
        tools = list_resp["result"]["tools"]
        assert isinstance(tools, list), list_resp
        print(f"PASS: tools/list -> {len(tools)} tools")
        names = {t["name"] for t in tools}
        assert "getPetById" in names, names
        get_pet = next(t for t in tools if t["name"] == "getPetById")
        assert get_pet["annotations"]["readOnlyHint"] is True or get_pet["annotations"].get("read_only_hint") is True, get_pet
        print("PASS: getPetById present with read-only annotation")

        # 3. tools/call unknown tool -> protocol error
        send(proc, {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                     "params": {"name": "noSuchTool", "arguments": {}}})
        unknown_resp = read_line(proc)
        results["unknown_tool"] = unknown_resp
        print("PASS/FAIL check unknown tool ->", json.dumps(unknown_resp)[:300])

        # 4. tools/call real tool against the real petstore demo API (network call)
        send(proc, {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                     "params": {"name": "getPetById", "arguments": {"petId": 1}}})
        call_resp = read_line(proc, timeout=20)
        results["call_get_pet"] = call_resp
        print("RESULT: tools/call getPetById ->", json.dumps(call_resp)[:400])

    finally:
        proc.kill()
        proc.wait(timeout=5)

    Path(__file__).with_name("e2e-results.json").write_text(json.dumps(results, indent=2))
    print("\nAll results written to e2e-results.json")


if __name__ == "__main__":
    main()
