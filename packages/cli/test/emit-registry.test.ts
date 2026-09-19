// packages/cli/test/emit-registry.test.ts
//
// MCPFO-25 — emit server.json + mcpName for the official MCP Registry
// (registry.modelcontextprotocol.io). Verified against the live registry
// 2026-09-03: current schema is 2025-12-11; packages[] entries carry
// registryType/registryBaseUrl/identifier/version/transport.type; the npm
// package.json must contain an `mcpName` equal to the server.json `name`
// (automated package-ownership proof). Keep server.json under 4 KB.
//
// MCPFO-111 (§97) — the emitted package.json's publishability and the emitted
// server.json's packages[] must AGREE. `packages[]` (and dropping package.json's
// `private: true`) is gated on `publishable`, which generate.ts sets from a
// --registry-name (publish intent). The Gate-B invariant test at the bottom
// enforces that the two files can never contradict each other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emitServerJson, emitPackageJson } from "../src/emit/emit-project-files.js";

test("server.json uses the current 2025-12-11 schema and a reverse-DNS name", () => {
  const sj = JSON.parse(emitServerJson({ serverName: "petstore", registryName: "io.github.acme/petstore", description: "Petstore MCP", transport: "stdio", publishable: true }));
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
  const sj = JSON.parse(emitServerJson({ serverName: "petstore", registryName: "io.github.acme/petstore", description: "x", transport: "streamable-http", publishable: true }));
  assert.equal(sj.packages[0].transport.type, "streamable-http");
});

test("package.json carries mcpName equal to the server.json name (ownership proof)", () => {
  const registryName = "io.github.acme/petstore";
  const pkg = JSON.parse(emitPackageJson("petstore", "stdio", {}, registryName, false, "1.0.0", true));
  const sj = JSON.parse(emitServerJson({ serverName: "petstore", registryName, description: "x", transport: "stdio", publishable: true }));
  assert.equal(pkg.mcpName, registryName);
  assert.equal(pkg.mcpName, sj.name, "mcpName must equal server.json name for registry ownership proof");
});

test("package.json omits mcpName when no registry name is configured", () => {
  const pkg = JSON.parse(emitPackageJson("petstore", "stdio", {}));
  assert.ok(!("mcpName" in pkg), "no mcpName unless a registry name is set");
});

test("server.json stays comfortably under the registry 4 KB limit", () => {
  const sj = emitServerJson({ serverName: "petstore", registryName: "io.github.acme/petstore", description: "A".repeat(200), transport: "stdio", publishable: true });
  assert.ok(Buffer.byteLength(sj, "utf-8") < 4096, "under 4 KB");
});

// MCPFO-107 (§97) — the resolved version is stamped into BOTH manifests as one
// value, so package.json and server.json can never disagree about the version.
test("MCPFO-107: the version is stamped identically into package.json and server.json", () => {
  const version = "2.4.1";
  const pkg = JSON.parse(emitPackageJson("petstore", "stdio", {}, "io.github.acme/petstore", false, version, true));
  const sj = JSON.parse(emitServerJson({ serverName: "petstore", registryName: "io.github.acme/petstore", description: "x", transport: "stdio", version, publishable: true }));
  assert.equal(pkg.version, version, "package.json version");
  assert.equal(sj.version, version, "server.json server-level version");
  assert.equal(sj.packages[0].version, version, "server.json package-level version");
});

// MCPFO-111 (§97) — GATE B: the publishability invariant. package.json's
// publishability (no `private: true`) and server.json's `packages[]` presence
// MUST agree in every combination. This is the mechanical guard that stops the
// original contradiction (private:true + an npm packages[] entry) from ever
// being reintroduced.
test("MCPFO-111 Gate B: package.json publishability and server.json packages[] never contradict", () => {
  for (const publishable of [true, false]) {
    const pkg = JSON.parse(
      emitPackageJson("petstore", "stdio", {}, "io.github.acme/petstore", false, "1.0.0", publishable)
    );
    const sj = JSON.parse(
      emitServerJson({
        serverName: "petstore",
        registryName: "io.github.acme/petstore",
        description: "x",
        transport: "stdio",
        publishable,
      })
    );
    const pkgIsPublishable = pkg.private !== true;
    const serverDeclaresPackage = Array.isArray(sj.packages) && sj.packages.length > 0;
    assert.equal(
      pkgIsPublishable,
      serverDeclaresPackage,
      `contradiction for publishable=${publishable}: package.json publishable=${pkgIsPublishable} but server.json declares packages=${serverDeclaresPackage}`
    );
    // And each half is what we expect for the intent.
    assert.equal(pkgIsPublishable, publishable, "package.json publishability tracks intent");
    assert.equal(serverDeclaresPackage, publishable, "server.json packages[] tracks intent");
  }
});

// Non-publishable is the default: package.json stays private and server.json
// carries no packages[] — a valid, package-less registry manifest.
test("MCPFO-111: non-publishable default emits private package.json and a package-less server.json", () => {
  const pkg = JSON.parse(emitPackageJson("petstore", "stdio"));
  const sj = JSON.parse(emitServerJson({ serverName: "petstore", description: "x", transport: "stdio" }));
  assert.equal(pkg.private, true, "default package.json is private (unpublishable)");
  assert.ok(!("packages" in sj), "default server.json declares no npm packages[]");
  // name/description/version — the only fields the 2025-12-11 schema requires.
  assert.ok(sj.name && sj.description && sj.version, "package-less server.json still carries the required fields");
});
