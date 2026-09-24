// packages/cli/src/emit/runtime-versions.ts
//
// The runtime versions a GENERATED server targets, in one place (MCPFO-121).
// Every emitted surface that states a Node or Python version (package.json
// engines, the esbuild target, @types/node, pyproject requires-python, the
// deploy Dockerfiles) reads these constants, and test/runtime-versions.test.ts
// asserts the emitted files agree with them, so they can't drift apart.
//
// Policy (ARCHITECTURE.md §102):
//   - FLOOR = the oldest release line that is still supported upstream AND
//     that CI actually runs the E2E suite on. Never declare a floor CI doesn't
//     exercise.
//   - DOCKER image = the newest line in active support (Node: active LTS;
//     Python: newest line the pinned `mcp` SDK is verified on).
// Re-check against https://endoflife.date/nodejs and /python when bumping.

/** Oldest Node.js major a generated TypeScript server supports (engines + esbuild target). */
export const NODE_FLOOR_MAJOR = 22;

/** Base image for `klaridian deploy --target docker|fly` on TypeScript projects. */
export const NODE_DOCKER_IMAGE = "node:24-slim";

/** Oldest Python a generated Python server supports (pyproject requires-python). */
export const PYTHON_FLOOR = "3.11";

/** Base image for `klaridian deploy --target docker|fly` on Python projects. */
export const PYTHON_DOCKER_IMAGE = "python:3.13-slim";
