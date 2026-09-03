// packages/cli/test/emit-dockerfile.test.ts
//
// MCPFO-12 — a --docker flag writes a minimal, least-privilege Dockerfile
// alongside the generated server. Only meaningful for network transports
// (streamable-http); stdio servers leak orphaned containers when the client
// session ends, so --docker requires --transport streamable-http.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emitDockerfile, emitDockerignore } from "../src/emit/emit-dockerfile.js";

test("Dockerfile is multi-stage, runs as non-root, and binds 0.0.0.0", () => {
  const df = emitDockerfile({ port: 3000 });
  // multi-stage build (build deps then a lean runtime)
  assert.match(df, /AS build/, "has a build stage");
  // least privilege: a non-root USER before CMD
  assert.match(df, /USER\s+\w+/, "drops to non-root user");
  const userIdx = df.indexOf("USER ");
  const cmdIdx = df.indexOf("CMD");
  assert.ok(userIdx !== -1 && cmdIdx !== -1 && userIdx < cmdIdx, "USER precedes CMD");
  // reachable inside the container
  assert.match(df, /MCPFORGE_BIND_HOST=0\.0\.0\.0/, "binds all interfaces in-container");
  assert.match(df, /EXPOSE\s+3000/, "exposes the configured port");
});

test("Dockerfile installs only production deps and builds TypeScript", () => {
  const df = emitDockerfile({ port: 8080 });
  assert.match(df, /npm ci|npm install/, "installs deps");
  assert.match(df, /npm run build|tsc/, "builds the server");
  assert.match(df, /--omit=dev|--production/, "prunes dev deps in the runtime image");
  assert.match(df, /EXPOSE\s+8080/, "uses the given port");
});

test("Dockerfile pins a concrete Node base image (no :latest)", () => {
  const df = emitDockerfile({ port: 3000 });
  assert.match(df, /FROM node:\d+/, "pins a Node major");
  assert.doesNotMatch(df, /node:latest/, "never :latest");
});

test(".dockerignore excludes node_modules and dist", () => {
  const di = emitDockerignore();
  assert.match(di, /node_modules/);
  assert.match(di, /dist/);
});
