// packages/cli/test/oauth-python.test.ts
//
// End-to-end test of the Python OAuth resource-server target (MCPFO-79), the
// Python peer of oauth.test.ts (MCPFO-22, TypeScript). Runs the REAL `klaridian
// generate --language python --oauth-*` binary, then a real generated Python
// server spawned as streamable-http, driven with real HTTP requests carrying
// JWTs signed by a throwaway RSA keypair served over a local HTTP JWKS endpoint
// — no mocking of PyJWT or the SDK. Verifies the scenarios the spec cares most
// about: missing token (401 + PRM challenge), the RFC 9728 PRM document itself,
// wrong audience (401, RFC 8707), expired token (401), missing required scope
// (403), and a valid token (200, real tool list).
//
// Requires a Python 3.11+ interpreter on PATH (python3.11/python3/python) — the
// same discipline as emit-python-e2e.test.ts: throw loudly, never silently skip.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { execFileAsync, CLI_ENTRYPOINT } from "./test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

const ISSUER = "https://example-idp.test";
const AUDIENCE = "https://mcp.example.com/mcp";

/** Resolve a usable Python 3.11+ interpreter, or throw loudly (no silent skip). */
function resolvePython(): string {
  // KLARIDIAN_TEST_PYTHON pins the interpreter (CI sets it per matrix leg, so
  // the floor AND the newest Python are each really exercised, MCPFO-121).
  const pinned = process.env.KLARIDIAN_TEST_PYTHON;
  for (const candidate of pinned ? [pinned] : ["python3.11", "python3", "python"]) {
    try {
      const v = execFileSync(candidate, ["--version"], { encoding: "utf-8" });
      const m = v.match(/Python (\d+)\.(\d+)/);
      if (m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 11))) return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error("No Python >=3.11 interpreter found on PATH (tried python3.11, python3, python).");
}

/** Starts a throwaway HTTP server serving one JWKS document. */
async function startFakeJwksServer(jwk: Record<string, unknown>): Promise<{ jwksUri: string; close: () => Promise<void> }> {
  const body = JSON.stringify({ keys: [jwk] });
  const server = http.createServer((_req, res) => {
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

test(
  "klaridian generate --language python --oauth-issuer: real resource-server enforcement (401/PRM/audience/expiry/scope/valid) — MCPFO-79",
  { timeout: 300_000 },
  async () => {
    const py = resolvePython();
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-py-oauth-"));
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    (jwk as Record<string, unknown>).kid = "test-key-1";
    (jwk as Record<string, unknown>).alg = "RS256";
    (jwk as Record<string, unknown>).use = "sig";

    const jwks = await startFakeJwksServer(jwk as Record<string, unknown>);
    let serverProc: ReturnType<typeof spawn> | undefined;
    let exitedEarly = false;
    try {
      const port = 4600 + Math.floor(Math.random() * 500);
      // The real binary — proves --language python now ACCEPTS --oauth-* (the
      // MCPFO-79 removal of the language rejection), not just the emitter.
      await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate",
        "--spec", PETSTORE_SPEC_PATH,
        "--out", outDir,
        "--name", "py-oauth-e2e",
        "--language", "python",
        "--base-url", "https://petstore3.swagger.io/api/v3",
        "--transport", "streamable-http",
        "--port", String(port),
        "--oauth-issuer", ISSUER,
        "--oauth-jwks-uri", jwks.jwksUri,
        "--oauth-audience", AUDIENCE,
        "--oauth-required-scopes", "mcp:tools",
        "--license", "none",
        "--force",
      ]);

      // Set up a venv and install the pinned requirements (pyjwt[crypto] included).
      await execFileAsync(py, ["-m", "venv", ".venv"], { cwd: outDir, timeout: 120_000 });
      const venvPy = path.join(outDir, ".venv", "bin", "python");
      await execFileAsync(venvPy, ["-m", "pip", "install", "-q", "-r", "requirements.txt"], {
        cwd: outDir,
        timeout: 240_000,
      });

      serverProc = spawn(venvPy, ["server.py", "--transport", "streamable-http", "--port", String(port)], {
        cwd: outDir,
        stdio: ["ignore", "pipe", "pipe"],
        // KLARIDIAN_BASE_URL for the proxies; OAuth env is baked into auth.py as
        // defaults from the flags, so no OAuth env needed here.
        env: { ...process.env, KLARIDIAN_BASE_URL: "https://petstore3.swagger.io/api/v3" },
      });
      serverProc.on("exit", () => { exitedEarly = true; });
      serverProc.stderr!.on("data", () => {});

      const base = `http://127.0.0.1:${port}`;
      const mcpRequest = (headers: Record<string, string>) =>
        fetch(`${base}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            origin: base,
            ...headers,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        });

      // Connection-based readiness (NOT log-based): server.py prints its startup
      // line before uvicorn binds the socket, so poll the real endpoint until it
      // answers, bailing if the child dies. (Durable pattern, per repo history.)
      await (async () => {
        const deadline = Date.now() + 30_000;
        let lastErr: unknown;
        while (Date.now() < deadline) {
          if (exitedEarly) throw new Error("server exited before it became ready");
          try {
            await mcpRequest({}); // any response (even 401) proves the port is live
            return;
          } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        throw new Error(`server did not become ready within 30s: ${String(lastErr)}`);
      })();

      // 1. No Authorization header -> 401 with a Bearer challenge naming the PRM URL.
      const noAuth = await mcpRequest({});
      assert.equal(noAuth.status, 401, "missing token -> 401");
      const challenge = noAuth.headers.get("www-authenticate") ?? "";
      assert.match(challenge, /Bearer/, "challenge is a Bearer challenge");
      assert.match(challenge, /resource_metadata=/, "challenge names the PRM discovery URL (RFC 9728)");

      // 2. The RFC 9728 Protected Resource Metadata document.
      const prm = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
      assert.equal(prm.status, 200, "PRM document is served");
      const prmBody = (await prm.json()) as { resource: string; authorization_servers: string[] };
      assert.equal(prmBody.resource, AUDIENCE, "PRM resource = configured audience");
      assert.deepEqual(prmBody.authorization_servers, [ISSUER], "PRM lists the configured issuer");

      // 3. Wrong audience -> 401 (RFC 8707: a token not bound to this RS is rejected).
      const wrongAudToken = await new SignJWT({ scope: "mcp:tools" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuer(ISSUER)
        .setAudience("https://someone-else.example.com/mcp")
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      const wrongAud = await mcpRequest({ authorization: `Bearer ${wrongAudToken}` });
      assert.equal(wrongAud.status, 401, "wrong audience -> 401");

      // 4. Expired token -> 401.
      const expiredToken = await new SignJWT({ scope: "mcp:tools" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("-1h")
        .sign(privateKey);
      const expired = await mcpRequest({ authorization: `Bearer ${expiredToken}` });
      assert.equal(expired.status, 401, "expired token -> 401");

      // 5. Valid signature/issuer/audience but MISSING the required scope -> 403.
      const noScopeToken = await new SignJWT({ scope: "some:other" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      const noScope = await mcpRequest({ authorization: `Bearer ${noScopeToken}` });
      assert.equal(noScope.status, 403, "missing required scope -> 403");

      // 6. Valid token, correct issuer + audience + scope -> 200 with the real tool list.
      const validToken = await new SignJWT({ scope: "mcp:tools" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      const valid = await mcpRequest({ authorization: `Bearer ${validToken}` });
      assert.equal(valid.status, 200, "valid token -> 200");
      const text = await valid.text();
      const line = text.split("\n").map((l) => l.replace(/^data:\s*/, "").trim()).find((l) => l.startsWith("{"));
      const parsed = line ? JSON.parse(line) : {};
      assert.ok(Array.isArray(parsed?.result?.tools), "real tool list is returned");
      assert.ok(parsed.result.tools.some((t: { name: string }) => t.name === "getPetById"), "petstore tools present");

      assert.equal(exitedEarly, false, "server survived the whole exchange");
    } finally {
      serverProc?.kill("SIGKILL");
      await jwks.close();
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

test("klaridian generate --language python --oauth-issuer with stdio transport fails loudly (MCPFO-79)", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-py-oauth-stdio-bad-"));
  try {
    await assert.rejects(
      execFileAsync("node", [
        CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir,
        "--name", "x", "--language", "python", "--base-url", "https://x/api",
        "--transport", "stdio",
        "--oauth-issuer", ISSUER, "--oauth-jwks-uri", "https://idp.test/jwks.json", "--oauth-audience", AUDIENCE,
      ]),
      /--oauth-issuer requires --transport streamable-http/
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
