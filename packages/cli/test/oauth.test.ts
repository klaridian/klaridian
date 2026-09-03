// packages/cli/test/oauth.test.ts
//
// End-to-end test of --oauth-issuer/--oauth-jwks-uri/--oauth-audience
// (MCPFO-22): the real `klaridian generate` binary, a real generated server
// spawned as streamable-http, and real HTTP requests against it with JWTs
// signed by a throwaway RSA keypair served over a local HTTP JWKS endpoint —
// no mocking of jose or the SDK's bearer-auth helpers. Verifies the four
// scenarios the spec cares most about: missing token (401 + PRM challenge),
// wrong audience (401, RFC 8707), expired token (401), and a valid token
// (200, real tool list). Also verifies the RFC 9728 PRM document itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRYPOINT = path.resolve(__dirname, "../src/index.js");
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

const ISSUER = "https://example-idp.test";
const AUDIENCE = "https://mcp.example.com/mcp";

/** Starts a throwaway HTTP server serving one JWKS document, returns { url, port, close }. */
async function startFakeJwksServer(jwk: Record<string, unknown>): Promise<{ jwksUri: string; close: () => Promise<void> }> {
  const body = JSON.stringify({ keys: [jwk] });
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    jwksUri: `http://127.0.0.1:${port}/.well-known/jwks.json`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Waits for the server's stderr to report it's listening, or rejects on timeout. */
function waitForListening(proc: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("server did not start in time")), 15_000);
    proc.stderr!.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      if (buf.includes("streamable-http")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

test(
  "klaridian generate --oauth-issuer: real resource-server enforcement (401/expiry/audience/valid) — MCPFO-22",
  { timeout: 300_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-oauth-"));
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    (jwk as Record<string, unknown>).kid = "test-key-1";
    (jwk as Record<string, unknown>).alg = "RS256";
    (jwk as Record<string, unknown>).use = "sig";

    const jwks = await startFakeJwksServer(jwk as Record<string, unknown>);
    let serverProc: ReturnType<typeof spawn> | undefined;
    try {
      const port = 4100 + Math.floor(Math.random() * 500);
      await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate",
        "--spec", PETSTORE_SPEC_PATH,
        "--out", outDir,
        "--name", "oauth-e2e-test",
        "--base-url", "https://petstore3.swagger.io/api/v3",
        "--engine", "v2",
        "--transport", "streamable-http",
        "--port", String(port),
        "--oauth-issuer", ISSUER,
        "--oauth-jwks-uri", jwks.jwksUri,
        "--oauth-audience", AUDIENCE,
        "--license", "none",
        "--force",
      ]);

      const pkg = JSON.parse(await readFile(path.join(outDir, "package.json"), "utf-8"));
      assert.ok(pkg.dependencies["jose"], "jose dependency present when OAuth is configured");
      const authSource = await readFile(path.join(outDir, "src", "auth.ts"), "utf-8");
      assert.match(authSource, /verifyBearerToken/, "vendors the bearer-auth wiring as readable source");

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outDir, timeout: 120_000 });

      serverProc = spawn("node", ["dist/index.js"], { cwd: outDir, stdio: ["ignore", "ignore", "pipe"] });
      await waitForListening(serverProc);

      const base = `http://127.0.0.1:${port}`;
      const mcpRequest = (headers: Record<string, string>) =>
        fetch(`${base}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", "mcp-protocol-version": "2025-11-25", "mcp-method": "tools/list", ...headers },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        });

      // 1. No Authorization header → 401 with a WWW-Authenticate challenge naming the PRM URL.
      const noAuth = await mcpRequest({});
      assert.equal(noAuth.status, 401, "missing token -> 401");
      const challenge = noAuth.headers.get("www-authenticate") ?? "";
      assert.match(challenge, /Bearer/, "challenge is a Bearer challenge");
      assert.match(challenge, /resource_metadata=/, "challenge names the PRM discovery URL (RFC 9728)");

      // 2. RFC 9728 Protected Resource Metadata document itself.
      const prm = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
      assert.equal(prm.status, 200, "PRM document is served");
      const prmBody = (await prm.json()) as { resource: string; authorization_servers: string[] };
      assert.equal(prmBody.resource, AUDIENCE, "PRM resource = configured audience");
      assert.deepEqual(prmBody.authorization_servers, [ISSUER], "PRM lists the configured issuer");

      // 3. Wrong audience → 401, MUST NOT be accepted (RFC 8707).
      const wrongAudToken = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuer(ISSUER)
        .setAudience("https://someone-else.example.com/mcp")
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      const wrongAud = await mcpRequest({ authorization: `Bearer ${wrongAudToken}` });
      assert.equal(wrongAud.status, 401, "wrong audience -> 401");

      // 4. Expired token → 401.
      const expiredToken = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("-1h")
        .sign(privateKey);
      const expired = await mcpRequest({ authorization: `Bearer ${expiredToken}` });
      assert.equal(expired.status, 401, "expired token -> 401");

      // 5. Valid token, correct issuer + audience → 200 with the real tool list.
      // Never forward this same token upstream — that's src/index.ts's job to
      // not do, verified structurally by generate.ts's existing conformance
      // suite; this test only asserts the RS side accepts it.
      const validToken = await new SignJWT({ scope: "mcp:tools" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      const valid = await mcpRequest({ authorization: `Bearer ${validToken}`, accept: "application/json, text/event-stream" });
      assert.equal(valid.status, 200, "valid token -> 200");
      const text = await valid.text();
      assert.match(text, /"tools":\[/, "real tool list is returned");
      assert.match(text, /getPetById/, "petstore tools present");
    } finally {
      serverProc?.kill("SIGKILL");
      await jwks.close();
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

test("klaridian generate --oauth-issuer with stdio transport fails loudly (MCPFO-22)", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-oauth-stdio-bad-"));
  try {
    await assert.rejects(
      execFileAsync("node", [
        CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir,
        "--name", "x", "--base-url", "https://x/api", "--engine", "v2",
        "--transport", "stdio",
        "--oauth-issuer", ISSUER, "--oauth-jwks-uri", "https://idp.test/jwks.json", "--oauth-audience", AUDIENCE,
      ]),
      /--oauth-issuer requires --transport streamable-http/
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("klaridian generate --oauth-issuer without --oauth-audience fails loudly (MCPFO-22)", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-oauth-noaud-"));
  try {
    await assert.rejects(
      execFileAsync("node", [
        CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir,
        "--name", "x", "--base-url", "https://x/api", "--engine", "v2",
        "--transport", "streamable-http", "--port", "3000",
        "--oauth-issuer", ISSUER, "--oauth-jwks-uri", "https://idp.test/jwks.json",
      ]),
      /--oauth-audience is required/
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("klaridian generate --oauth-issuer rejects a non-HTTPS issuer (except localhost) (MCPFO-22)", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-oauth-http-issuer-"));
  try {
    await assert.rejects(
      execFileAsync("node", [
        CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir,
        "--name", "x", "--base-url", "https://x/api", "--engine", "v2",
        "--transport", "streamable-http", "--port", "3000",
        "--oauth-issuer", "http://insecure-idp.example.com",
        "--oauth-jwks-uri", "https://idp.test/jwks.json",
        "--oauth-audience", AUDIENCE,
      ]),
      /--oauth-issuer must be HTTPS/
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
