// packages/cli/test/curation.test.ts
//
// Tests for tool curation (ARCHITECTURE.md section 24): user-chosen
// filtering of which OpenAPI operations become MCP tools, applied at
// generation time via the `x-mcp` extension openapi-mcp-generator already
// respects (confirmed with real generated output — see section 24 and
// generate.test.ts's E2E coverage of the actual CLI flags).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { OpenAPIV3 } from "openapi-types";
import {
  summarizeTags,
  validateCurationChoice,
  applyCurationToSpec,
  CurationValidationError,
  type OperationSummary,
} from "../src/curation/curation.js";
import { execFileAsync, CLI_ENTRYPOINT } from "./test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

const SAMPLE_OPERATIONS: OperationSummary[] = [
  { operationId: "listPets", tags: ["pets"], method: "get", path: "/pets" },
  { operationId: "createPet", tags: ["pets", "write"], method: "post", path: "/pets" },
  { operationId: "listUsers", tags: ["admin"], method: "get", path: "/users" },
  { operationId: "healthCheck", tags: [], method: "get", path: "/health" },
];

test("summarizeTags counts operations per tag, including untagged", () => {
  const summary = summarizeTags(SAMPLE_OPERATIONS);
  const asMap = Object.fromEntries(summary.map((s) => [s.tag, s.count]));
  assert.deepEqual(asMap, { pets: 2, write: 1, admin: 1, "(untagged)": 1 });
});

test("validateCurationChoice throws CurationValidationError on an unknown tag", () => {
  assert.throws(
    () => validateCurationChoice({ excludeTags: ["nonexistent"] }, SAMPLE_OPERATIONS),
    CurationValidationError
  );
});

test("validateCurationChoice throws CurationValidationError on an unknown operationId", () => {
  assert.throws(
    () => validateCurationChoice({ excludeOperationIds: ["doesNotExist"] }, SAMPLE_OPERATIONS),
    CurationValidationError
  );
});

test("validateCurationChoice passes silently for real tags/operationIds", () => {
  assert.doesNotThrow(() =>
    validateCurationChoice({ includeTags: ["pets"], excludeOperationIds: ["createPet"] }, SAMPLE_OPERATIONS)
  );
});

function buildTestDoc(): OpenAPIV3.Document {
  return {
    openapi: "3.0.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/pets": {
        get: { operationId: "listPets", tags: ["pets"], responses: { "200": { description: "OK" } } },
      },
      "/admin/users": {
        get: { operationId: "listUsers", tags: ["admin"], responses: { "200": { description: "OK" } } },
      },
      "/health": {
        get: { operationId: "healthCheck", responses: { "200": { description: "OK" } } },
      },
    },
  };
}

test("applyCurationToSpec sets x-mcp: false only on excluded operations, and doesn't mutate the input", () => {
  const original = buildTestDoc();
  const originalJson = JSON.stringify(original);

  const curated = applyCurationToSpec(original, { excludeTags: ["admin"] });

  // Input untouched.
  assert.equal(JSON.stringify(original), originalJson);

  const petsOp = (curated.paths!["/pets"] as OpenAPIV3.PathItemObject).get as OpenAPIV3.OperationObject & {
    "x-mcp"?: boolean;
  };
  const usersOp = (curated.paths!["/admin/users"] as OpenAPIV3.PathItemObject).get as OpenAPIV3.OperationObject & {
    "x-mcp"?: boolean;
  };
  const healthOp = (curated.paths!["/health"] as OpenAPIV3.PathItemObject).get as OpenAPIV3.OperationObject & {
    "x-mcp"?: boolean;
  };

  assert.equal(petsOp["x-mcp"], undefined, "non-excluded operation should be untouched");
  assert.equal(usersOp["x-mcp"], false, "admin-tagged operation should be excluded");
  assert.equal(healthOp["x-mcp"], undefined, "untagged operation not matching excludeTags should be untouched");
});

test("applyCurationToSpec with includeTags excludes everything NOT matching", () => {
  const curated = applyCurationToSpec(buildTestDoc(), { includeTags: ["admin"] });

  const petsOp = (curated.paths!["/pets"] as OpenAPIV3.PathItemObject).get as OpenAPIV3.OperationObject & {
    "x-mcp"?: boolean;
  };
  const usersOp = (curated.paths!["/admin/users"] as OpenAPIV3.PathItemObject).get as OpenAPIV3.OperationObject & {
    "x-mcp"?: boolean;
  };

  assert.equal(petsOp["x-mcp"], false, "non-admin-tagged operation should be excluded when includeTags=admin");
  assert.equal(usersOp["x-mcp"], undefined, "admin-tagged operation should survive includeTags=admin");
});

test("applyCurationToSpec excludeOperationIds overrides regardless of tags", () => {
  const curated = applyCurationToSpec(buildTestDoc(), { excludeOperationIds: ["listPets"] });
  const petsOp = (curated.paths!["/pets"] as OpenAPIV3.PathItemObject).get as OpenAPIV3.OperationObject & {
    "x-mcp"?: boolean;
  };
  assert.equal(petsOp["x-mcp"], false);
});

// --- MCPFO-8: tag-independent structural filters (path regex, HTTP method) ---
// Motivated directly by ARCHITECTURE.md section 34/36: Stripe's real public
// spec has zero OpenAPI tags on any of its 594 operations, so
// includeTags/excludeTags/excludeOperationIds are useless against it.
// buildTestDoc() below deliberately omits tags on the admin path to model
// that same untagged-real-API shape.

function buildUntaggedDoc(): OpenAPIV3.Document {
  return {
    openapi: "3.0.0",
    info: { title: "Untagged", version: "1.0.0" },
    paths: {
      "/customers": {
        get: { operationId: "listCustomers", responses: { "200": { description: "OK" } } },
        post: { operationId: "createCustomer", responses: { "200": { description: "OK" } } },
      },
      "/customers/{id}": {
        get: { operationId: "getCustomer", responses: { "200": { description: "OK" } } },
        delete: { operationId: "deleteCustomer", responses: { "200": { description: "OK" } } },
      },
      "/invoices": {
        get: { operationId: "listInvoices", responses: { "200": { description: "OK" } } },
      },
    },
  };
}

function xmcp(doc: OpenAPIV3.Document, path: string, method: string): boolean | undefined {
  const op = (doc.paths![path] as Record<string, OpenAPIV3.OperationObject>)[method] as
    | (OpenAPIV3.OperationObject & { "x-mcp"?: boolean })
    | undefined;
  return op?.["x-mcp"];
}

test("applyCurationToSpec --include-paths works on a spec with ZERO tags (the Stripe case)", () => {
  const curated = applyCurationToSpec(buildUntaggedDoc(), { includePathPatterns: ["^/customers"] });
  assert.equal(xmcp(curated, "/customers", "get"), undefined, "matches pattern -> survives");
  assert.equal(xmcp(curated, "/customers/{id}", "delete"), undefined, "matches pattern -> survives");
  assert.equal(xmcp(curated, "/invoices", "get"), false, "does not match pattern -> excluded");
});

test("applyCurationToSpec --exclude-paths drops matching operations", () => {
  const curated = applyCurationToSpec(buildUntaggedDoc(), { excludePathPatterns: ["\\{id\\}"] });
  assert.equal(xmcp(curated, "/customers/{id}", "get"), false);
  assert.equal(xmcp(curated, "/customers/{id}", "delete"), false);
  assert.equal(xmcp(curated, "/customers", "get"), undefined, "non-matching path survives");
});

test("applyCurationToSpec --include-methods/--exclude-methods filter by HTTP verb, tag-independent", () => {
  const onlyReads = applyCurationToSpec(buildUntaggedDoc(), { includeMethods: ["get"] });
  assert.equal(xmcp(onlyReads, "/customers", "get"), undefined);
  assert.equal(xmcp(onlyReads, "/customers", "post"), false);
  assert.equal(xmcp(onlyReads, "/customers/{id}", "delete"), false);

  const noDeletes = applyCurationToSpec(buildUntaggedDoc(), { excludeMethods: ["delete"] });
  assert.equal(xmcp(noDeletes, "/customers/{id}", "delete"), false);
  assert.equal(xmcp(noDeletes, "/customers/{id}", "get"), undefined);
});

test("applyCurationToSpec composes path/method filters with tag filters", () => {
  // pets is tagged, admin/health are not — mirrors a spec with partial tagging.
  const curated = applyCurationToSpec(buildTestDoc(), {
    excludeTags: ["admin"],
    includeMethods: ["get"],
  });
  const petsOp = (curated.paths!["/pets"] as OpenAPIV3.PathItemObject).get as OpenAPIV3.OperationObject & {
    "x-mcp"?: boolean;
  };
  assert.equal(petsOp["x-mcp"], undefined, "GET + not admin-tagged -> survives both filters");
});

test("validateCurationChoice rejects an invalid regex in --include-paths/--exclude-paths", () => {
  assert.throws(
    () => validateCurationChoice({ includePathPatterns: ["[unclosed"] }, SAMPLE_OPERATIONS),
    CurationValidationError
  );
});

test("validateCurationChoice rejects an unknown HTTP method", () => {
  assert.throws(
    () => validateCurationChoice({ includeMethods: ["fetch"] }, SAMPLE_OPERATIONS),
    CurationValidationError
  );
});

test("generate --include-paths: produces a working server, tag-independent (real untagged spec, CLI E2E)", { timeout: 120_000 }, async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-curation-paths-"));
  const specDir = await mkdtemp(path.join(tmpdir(), "klaridian-curation-spec-"));
  const specPath = path.join(specDir, "untagged.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    specPath,
    JSON.stringify({
      openapi: "3.0.0",
      info: { title: "untagged-api", version: "1.0.0" },
      servers: [{ url: "https://api.example.com/v1" }],
      paths: {
        "/customers": {
          get: { operationId: "listCustomers", responses: { "200": { description: "ok" } } },
          post: { operationId: "createCustomer", responses: { "200": { description: "ok" } } },
        },
        "/customers/{id}": {
          get: {
            operationId: "getCustomer",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "ok" } },
          },
        },
        "/invoices": {
          get: { operationId: "listInvoices", responses: { "200": { description: "ok" } } },
        },
      },
    })
  );
  try {
    const result = await execFileAsync("node", [
      CLI_ENTRYPOINT, "generate",
      "--spec", specPath,
      "--out", outputDir,
      "--name", "curated-paths-test",
      "--include-paths", "^/customers",
      "--license", "none",
    ]);
    assert.match(result.stderr, /Generated 3 tool\(s\)/, "only the 3 /customers operations survive, out of 4 total");

    const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
    assert.match(serverSource, /listCustomers/);
    assert.match(serverSource, /createCustomer/);
    assert.match(serverSource, /getCustomer/);
    assert.doesNotMatch(serverSource, /listInvoices/, "non-matching path excluded despite having no tags at all");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(specDir, { recursive: true, force: true });
  }
});

// --- End-to-end: the actual CLI flags against the real Petstore fixture ---

test(
  "generate --exclude-tags: produces a working server with only the non-excluded operations",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-curation-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-curated",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--exclude-tags",
        "store,user",
      ]);
      assert.match(result.stderr, /Generated 8 tool\(s\) \(curated from 19 total\)/);

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      // Petstore's "store" tag includes getInventory/placeOrder/etc, "user"
      // includes createUser/loginUser/etc — none of those operationIds
      // should be present in the curated output.
      assert.doesNotMatch(serverSource, /"getInventory"/);
      assert.doesNotMatch(serverSource, /"createUser"/);
      assert.match(serverSource, /"getPetById"/, "pet-tagged operations should survive");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test("generate --exclude-tags with an unknown tag fails loudly with a clear message", { timeout: 60_000 }, async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-curation-bad-"));
  try {
    await assert.rejects(
      execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-bad-tag",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--exclude-tags",
        "nonexistent",
      ]),
      (err: unknown) => {
        const e = err as { stderr: string };
        return /Unknown tag "nonexistent"/.test(e.stderr);
      }
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
