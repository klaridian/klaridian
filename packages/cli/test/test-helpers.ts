// packages/cli/test/test-helpers.ts
//
// Shared setup for this package's real-binary CLI E2E tests (generate.test.ts,
// swagger2-conversion.test.ts, license.test.ts, oauth.test.ts, transport.test.ts,
// ux.test.ts, curation.test.ts, engine-v2.test.ts, emit-*-e2e.test.ts, ...).
// Every one of these tests spawns/execs the real compiled CLI binary rather
// than mocking anything (this repo's standing testing discipline, AGENTS.md /
// spikes/001-otel-mechanic/FINDINGS.md) — they all independently re-derived
// the same 3-line __dirname/CLI_ENTRYPOINT/execFileAsync boilerplate before
// this extraction (a repo-audit finding, Sep 4 2026). No behavior change:
// each constant here is byte-identical to what every test file computed
// locally.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

// import.meta.url here resolves relative to *this* file's location
// (packages/cli/test/), which is exactly where every test file importing it
// also lives — so CLI_ENTRYPOINT below is correct for any importer in this
// same directory, matching what each test previously computed from its own
// __dirname.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the compiled CLI entrypoint (dist/src/index.js, built by `npm run build` before tests run). */
export const CLI_ENTRYPOINT = path.resolve(__dirname, "../src/index.js");

/** Writes a JSON-RPC message to a spawned CLI process's stdin (newline-delimited, per the stdio MCP transport). */
export function sendJsonRpc(proc: ReturnType<typeof spawn>, msg: unknown): void {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}
