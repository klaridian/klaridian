// packages/cli/src/emit/emit-project-files.ts
//
// Emits package.json + tsconfig.json for the generated v2 MCP server project.
// v2 dependency set (@modelcontextprotocol/server + /node, zod v4) — NOT the
// v1 @modelcontextprotocol/sdk, and none of openapi-mcp-generator's v1
// runtime deps (hono/fetch-to-node/uuid). Versions match the set validated
// in spikes/021-sdk-v2-streamable-http.

import type { Transport } from "./emit-server.js";
import { NODE_FLOOR_MAJOR } from "./runtime-versions.js";

const SDK_SERVER_VERSION = "^2.0.0";
const SDK_NODE_VERSION = "^2.0.0";
const ZOD_VERSION = "^4.2.0";
const JOSE_VERSION = "^6.2.0";
const ESBUILD_VERSION = "^0.28.0";

export function emitPackageJson(
  serverName: string,
  transport: Transport,
  extraDependencies: Record<string, string> = {},
  registryName?: string,
  needsAuth = false,
  version = "1.0.0",
  publishable = false
): string {
  const dependencies: Record<string, string> = {
    "@modelcontextprotocol/server": SDK_SERVER_VERSION,
    zod: ZOD_VERSION,
    ...extraDependencies,
  };
  // The node adapter is only needed for the HTTP transport's host/origin
  // validation + toNodeHandler; stdio uses @modelcontextprotocol/server/stdio.
  if (transport === "streamable-http") {
    dependencies["@modelcontextprotocol/node"] = SDK_NODE_VERSION;
  }
  // MCPFO-22: jose is the zero-dependency JOSE/JWT library used by
  // src/auth.ts for remote-JWKS bearer token verification.
  if (needsAuth) {
    dependencies["jose"] = JOSE_VERSION;
  }

  // MCPFO-12 replacement (ARCHITECTURE.md section 55): the run artifact is a
  // single bundled file (`dist/server.bundle.js`), not the tsc-compiled
  // `dist/index.js` plus a live `node_modules` tree. `build` still runs `tsc`
  // first — real type-checking against the SDK's types, catching a bad edit
  // to this project's own generated source — then bundles the *compiled*
  // output with esbuild. `start` runs only the bundle; restarting the server
  // never re-resolves dependencies or touches the network.
  const pkg: Record<string, unknown> = {
    name: serverName,
    version,
    // MCPFO-111 (§97): `private: true` blocks `npm publish` by design. Emit it
    // ONLY for a non-publishable project (the default). When the project is
    // publishable (a --registry-name signalled publish intent), omit `private`
    // so the npm path actually works — and server.json then declares a matching
    // npm packages[] entry. The two files never disagree about publishability.
    ...(publishable ? {} : { private: true }),
    type: "module",
    main: "dist/server.bundle.js",
    // mcpName is the official MCP Registry's npm package-ownership proof: it
    // MUST equal the server.json `name`. Only emitted when a registry name is
    // configured (MCPFO-25).
    ...(registryName ? { mcpName: registryName } : {}),
    scripts: {
      build: "tsc -p tsconfig.json && npm run bundle",
      bundle:
        `esbuild dist/index.js --bundle --platform=node --target=node${NODE_FLOOR_MAJOR} --format=esm --outfile=dist/server.bundle.js`,
      start: "node dist/server.bundle.js",
    },
    engines: { node: `>=${NODE_FLOOR_MAJOR}` },
    dependencies,
    devDependencies: {
      // @types/node tracks the engines floor so the typings never offer an API
      // the oldest supported Node lacks.
      "@types/node": `^${NODE_FLOOR_MAJOR}.0.0`,
      typescript: "^5.7.3",
      esbuild: ESBUILD_VERSION,
    },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

export interface ServerJsonOptions {
  serverName: string;
  description: string;
  transport: Transport;
  /** Reverse-DNS registry name, e.g. "io.github.acme/petstore". Defaults to a
   *  documented placeholder the author must customize before publishing. */
  registryName?: string;
  /** Package identifier to publish as; defaults to the server name. For npm this
   *  is the package name; for PyPI the distribution name. */
  npmIdentifier?: string;
  /** Which code registry the published package lives in. Drives registryType +
   *  registryBaseUrl + runtimeHint in the packages[] entry. Defaults to "npm"
   *  (the TypeScript target); the Python target passes "pypi". */
  registryType?: "npm" | "pypi";
  version?: string;
  /** MCPFO-111 (§97): when true, emit a `packages[]` entry (the project is
   *  publishable). When false (default), omit `packages[]` entirely — a valid,
   *  package-less server.json (name/description/version are the only required
   *  fields per the 2025-12-11 schema) that does NOT claim a package the
   *  `private: true` package.json / unpublished dist can't back. */
  publishable?: boolean;
}

/**
 * Emits a server.json for the official MCP Registry (MCPFO-25). Schema verified
 * against the live registry 2026-09-03 (2025-12-11). Feeds GitHub/VS Code,
 * PulseMCP, Glama and Docker's community registry from a single upstream.
 * Publish with: `mcp-publisher login github && mcp-publisher publish`.
 */
export function emitServerJson(opts: ServerJsonOptions): string {
  const registryName = opts.registryName ?? `io.github.OWNER/${opts.serverName}`;
  const version = opts.version ?? "1.0.0";
  const identifier = opts.npmIdentifier ?? opts.serverName;
  const registryType = opts.registryType ?? "npm";
  // Only the official public registries are accepted by the MCP Registry's
  // package-ownership validator (registry.modelcontextprotocol.io); npm proves
  // ownership via package.json `mcpName`, PyPI via an `mcp-name:` line in the
  // README (the package description). runtimeHint tells clients how to launch
  // the published package one-shot (npx / uvx).
  const registryBaseUrl = registryType === "pypi" ? "https://pypi.org" : "https://registry.npmjs.org";
  const runtimeHint = registryType === "pypi" ? "uvx" : "npx";
  // MCPFO-111 (§97): the packages[] entry is emitted ONLY for a publishable
  // project, so a package-less (non-publishable) server never claims a package
  // that its `private: true` package.json / unpublished dist cannot back. name +
  // description + version are the only fields the 2025-12-11 schema requires,
  // so a packages-free server.json is fully valid.
  const packages = opts.publishable
    ? [
        {
          registryType,
          registryBaseUrl,
          identifier,
          version,
          runtimeHint,
          transport: { type: opts.transport },
          environmentVariables: [
            {
              name: "KLARIDIAN_BASE_URL",
              description: "Base URL of the upstream HTTP API this server proxies.",
              isRequired: true,
            },
            {
              name: "KLARIDIAN_AUTH_TOKEN",
              description: "Bearer token for the upstream API, if it requires auth.",
              isRequired: false,
              isSecret: true,
            },
          ],
        },
      ]
    : undefined;
  const server = {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: registryName,
    description: opts.description || `${opts.serverName} — MCP server generated by klaridian`,
    version,
    ...(packages ? { packages } : {}),
  };
  return JSON.stringify(server, null, 2) + "\n";
}

export function emitTsconfig(): string {
  const tsconfig = {
    compilerOptions: {
      // v2's published .d.mts references Buffer; TS >=6 no longer auto-includes
      // @types/*, so "types": ["node"] is required (v2 README).
      types: ["node"],
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "dist",
      rootDir: "src",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      declaration: false,
    },
    include: ["src/**/*.ts"],
  };
  return JSON.stringify(tsconfig, null, 2) + "\n";
}
