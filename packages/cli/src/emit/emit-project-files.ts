// packages/cli/src/emit/emit-project-files.ts
//
// Emits package.json + tsconfig.json for the generated v2 MCP server project.
// v2 dependency set (@modelcontextprotocol/server + /node, zod v4) — NOT the
// v1 @modelcontextprotocol/sdk, and none of openapi-mcp-generator's v1
// runtime deps (hono/fetch-to-node/uuid). Versions match the set validated
// in spikes/021-sdk-v2-streamable-http.

import type { Transport } from "./emit-server.js";

const SDK_SERVER_VERSION = "^2.0.0";
const SDK_NODE_VERSION = "^2.0.0";
const ZOD_VERSION = "^4.2.0";

export function emitPackageJson(
  serverName: string,
  transport: Transport,
  extraDependencies: Record<string, string> = {}
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

  const startScript =
    transport === "streamable-http" ? "node dist/index.js" : "node dist/index.js";

  const pkg = {
    name: serverName,
    version: "1.0.0",
    private: true,
    type: "module",
    main: "dist/index.js",
    scripts: {
      build: "tsc -p tsconfig.json",
      start: startScript,
    },
    engines: { node: ">=20.0.0" },
    dependencies,
    devDependencies: {
      "@types/node": "^22.10.5",
      typescript: "^5.7.3",
    },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
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
