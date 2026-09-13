// packages/cli/src/emit/deploy/emit-docker.ts
//
// MCPFO-86 step 2 — the `--target docker` deploy artifact.
//
// klaridian's deploy story is "emit artifacts + shell out to the platform's
// native CLI", never a hand-rolled deploy engine (ARCHITECTURE.md §78). Docker
// is the first, most portable target: a plain Dockerfile runs on Fly, Render,
// Railway, Cloud Run, or a self-hosted box — vendor-neutral, and the baseline
// the later `--target fly` builds on.
//
// This reopens §55 NARROWLY: §55 removed Docker as a supported `generate`
// OUTPUT (a file maintained inside every generated project). Here the Dockerfile
// is an EPHEMERAL BUILD INPUT for a deploy — a different surface. It is written
// by `klaridian deploy`, not by `generate`, and is not part of the server
// project's maintained source. See ARCHITECTURE.md §78/§55.
//
// The emitter is language-aware because the two generated projects build and
// run differently:
//   - TypeScript: multi-stage — `npm run build` produces a self-contained
//     esbuild bundle (dist/server.bundle.js, ARCHITECTURE.md §55), so the
//     runtime stage copies ONLY that bundle onto a slim node base. No
//     node_modules layer to carry.
//   - Python: install requirements.txt into the image, then run server.py with
//     an explicit ≥3.10 interpreter (generated projects declare
//     requires-python >=3.10).
//
// Both set the deploy-contract env the step-1 refactor (§79) reads so the
// container is actually reachable: KLARIDIAN_BIND_HOST=0.0.0.0 (bind all
// interfaces, not loopback) and EXPOSE/PORT. KLARIDIAN_ALLOWED_HOSTS is left to
// deploy time (the public hostname isn't known at emit time) — the emitted
// Dockerfile documents it.

export type DeployLanguage = "typescript" | "python";

/** Files a deploy target contributes, as a relative-path -> content map. */
export type DeployArtifacts = Record<string, string>;

export interface DockerEmitOptions {
  /** Which generated project this wraps — decides the build/run shape. */
  language: DeployLanguage;
  /** The port the server listens on (the generated default; PORT overrides at runtime). */
  port: number;
}

/**
 * The `.dockerignore` — keep the build context small and never copy a local
 * build/deps tree into the image (they're rebuilt inside it). Shared by both
 * languages; the extra entries are harmless when absent.
 */
function emitDockerignore(): string {
  return `# Emitted by \`klaridian deploy --target docker\` (ephemeral build input).
node_modules
dist
.venv
__pycache__
*.pyc
.git
*.log
`;
}

/** TypeScript: multi-stage build → run only the esbuild bundle on node:22-slim. */
function emitDockerfileTypeScript(port: number): string {
  return `# Emitted by \`klaridian deploy --target docker\` (ephemeral build input,
# not a maintained part of the generated project — see klaridian ARCHITECTURE.md §78).
#
# Multi-stage: build the self-contained esbuild bundle, then run it on a slim
# node base. The generated project bundles to dist/server.bundle.js (no
# node_modules needed at runtime), so the runtime stage stays small.

# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist/server.bundle.js ./dist/server.bundle.js
COPY package.json ./

# Deploy contract (read by the generated server, klaridian ARCHITECTURE.md §79):
#  - PORT           platform-injected; the server binds it (falls back to ${port}).
#  - KLARIDIAN_BIND_HOST=0.0.0.0  bind all interfaces so the container is reachable.
#  - KLARIDIAN_ALLOWED_HOSTS      set at deploy time to your public hostname, or
#                                 requests routed via it get 403 "Invalid Host".
ENV PORT=${port} \\
    KLARIDIAN_BIND_HOST=0.0.0.0

EXPOSE ${port}
CMD ["node", "dist/server.bundle.js"]
`;
}

/** Python: install requirements into the image, run server.py on python:3.12-slim. */
function emitDockerfilePython(port: number): string {
  return `# Emitted by \`klaridian deploy --target docker\` (ephemeral build input,
# not a maintained part of the generated project — see klaridian ARCHITECTURE.md §78).
#
# The generated Python project declares requires-python >=3.10; python:3.12-slim
# satisfies it. Dependencies are installed into the image from requirements.txt.

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Deploy contract (read by the generated server, klaridian ARCHITECTURE.md §79):
#  - PORT           platform-injected; the server binds it (falls back to ${port}).
#  - KLARIDIAN_BIND_HOST=0.0.0.0  bind all interfaces so the container is reachable.
#  - KLARIDIAN_ALLOWED_HOSTS      set at deploy time to your public hostname (the
#                                 Python server serves via uvicorn; still bind 0.0.0.0).
ENV PORT=${port} \\
    KLARIDIAN_BIND_HOST=0.0.0.0

EXPOSE ${port}
CMD ["python", "server.py", "--transport", "streamable-http"]
`;
}

/**
 * Emit the Docker deploy artifacts for a generated project. Returns a
 * relative-path -> content map (Dockerfile + .dockerignore). Fails loudly on an
 * unknown language rather than emitting a Dockerfile that can't build the
 * project — the "fail loudly, don't guess" rule (AGENTS.md).
 */
export function emitDockerArtifacts(opts: DockerEmitOptions): DeployArtifacts {
  let dockerfile: string;
  if (opts.language === "typescript") {
    dockerfile = emitDockerfileTypeScript(opts.port);
  } else if (opts.language === "python") {
    dockerfile = emitDockerfilePython(opts.port);
  } else {
    throw new Error(
      `Docker deploy: unsupported language "${opts.language as string}". Expected "typescript" or "python".`
    );
  }
  return {
    Dockerfile: dockerfile,
    ".dockerignore": emitDockerignore(),
  };
}
