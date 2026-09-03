// packages/cli/test/emit-registry.test.ts
//
// MCPFO-25 — emit server.json + mcpName for the official MCP Registry
// (registry.modelcontextprotocol.io). Verified against the live registry
// 2026-09-03: current schema is 2025-12-11; packages[] entries carry
// registryType/registryBaseUrl/identifier/version/transport.type; the npm
// package.json must contain an `mcpName` equal to the server.json `name`
// (automated package-ownership proof). Keep server.json under 4 KB.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emitServerJson, emitPackageJson } from "../src/emit/emit-project-files.js";

test("server.json uses the current 2025-12-11 schema and a reverse-DNS name", () => {
  const sj = JSON.parse(emitServerJson({ serverName: "petstore", registryName: "io.github.acme/petstore", description: "Petstore MCP", transport: "stdio" }));
  assert.equal(sj["$schema"], "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  assert.equal(sj.name, "io.github.acme/petstore");
  assert.equal(sj.version, "1.0.0");
  assert.ok(Array.isArray(sj.packages) && sj.packages.length === 1);
  const p = sj.packages[0];
  assert.equal(p.registryType, "npm");
  assert.equal(p.registryBaseUrl, "https://registry.npmjs.org");
  assert.equal(p.transport.type, "stdio");
});

test("server.json defaults to a documented placeholder namespace when none is given", () => {
  const sj = JSON.parse(emitServerJson({ serverName: "petstore", description: "x", transport: "stdio" }));
  assert.match(sj.name, /^io\.github\.OWNER\/petstore$/, "placeholder namespace the author must customize");
});

test("streamable-http transport is reflected in the package transport type", () => {
  const sj = JSON.parse(emitServerJson({ serverName: "petstore", registryName: "io.github.acme/petstore", description: "x", transport: "streamable-http" }));
  assert.equal(sj.packages[0].transport.type, "streamable-http");
});

test("package.json carries mcpName equal to the server.json name (ownership proof)", () => {
  const registryName = "io.github.acme/petstore";
  const pkg = JSON.parse(emitPackageJson("petstore", "stdio", {}, registryName));
  const sj = JSON.parse(emitServerJson({ serverName: "petstore", registryName, description: "x", transport: "stdio" }));
  assert.equal(pkg.mcpName, registryName);
  assert.equal(pkg.mcpName, sj.name, "mcpName must equal server.json name for registry ownership proof");
});

test("package.json omits mcpName when no registry name is configured", () => {
  const pkg = JSON.parse(emitPackageJson("petstore", "stdio", {}));
  assert.ok(!("mcpName" in pkg), "no mcpName unless a registry name is set");
});

test("server.json stays comfortably under the registry 4 KB limit", () => {
  const sj = emitServerJson({ serverName: "petstore", registryName: "io.github.acme/petstore", description: "A".repeat(200), transport: "stdio" });
  assert.ok(Buffer.byteLength(sj, "utf-8") < 4096, "under 4 KB");
});
