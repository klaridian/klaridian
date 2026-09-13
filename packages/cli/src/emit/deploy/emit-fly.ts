// packages/cli/src/emit/deploy/emit-fly.ts
//
// MCPFO-86 step 4 (final) — the `--target fly` deploy artifacts.
//
// Fly.io runs a container, so this target is the Docker target (§80) PLUS a
// fly.toml that tells Fly how to build and serve it. It reuses emitDockerArtifacts
// verbatim rather than re-deriving a Dockerfile — the "universal container
// baseline the fly target builds on" (ARCHITECTURE.md §78). Emit + shell out to
// `flyctl`; klaridian reimplements no infra.
//
// Works for BOTH languages (unlike cloudflare): a container carries the Python
// target too. The fly.toml wires the deploy contract from §79 so the container
// is actually reachable — internal_port matches the generated port, force_https,
// scale-to-zero, and KLARIDIAN_ALLOWED_HOSTS defaulted to the <app>.fly.dev host.

import { emitDockerArtifacts, type DeployLanguage } from "./emit-docker.js";

export interface FlyEmitOptions {
  /** Which generated project this wraps — passed through to the Docker emitter. */
  language: DeployLanguage;
  /** The port the server listens on (also fly.toml's internal_port). */
  port: number;
  /** App name — the fly.toml `app` and the default allowed public host. */
  appName: string;
}

/** Files the fly target contributes: the Docker artifacts + fly.toml. */
export type FlyArtifacts = Record<string, string>;

/** fly.toml — a Fly Machines app that builds from the emitted Dockerfile. */
function emitFlyToml(opts: FlyEmitOptions): string {
  // Fly app names must be lowercase, alphanumeric + hyphens. Normalize
  // defensively rather than emit a manifest `flyctl` rejects.
  const app = opts.appName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp-server";
  return `# Emitted by \`klaridian deploy --target fly\` (ephemeral deploy input,
# not a maintained part of the generated project — see klaridian ARCHITECTURE.md §78).
# Builds from the Dockerfile emitted alongside this file. \`app\` is a placeholder;
# run \`fly launch\` (or edit it) to claim a unique name before \`fly deploy\`.
app = "${app}"
primary_region = "cdg"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = ${opts.port}
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[env]
  KLARIDIAN_BIND_HOST = "0.0.0.0"
  # The server's Host-header validation must allow the public hostname, or every
  # request routed via it is rejected with 403 "Invalid Host". Defaulted to the
  # Fly-assigned host; set to your custom domain if you add one.
  KLARIDIAN_ALLOWED_HOSTS = "${app}.fly.dev"
  # Set KLARIDIAN_BASE_URL to your upstream API (here or via \`fly secrets set\`).

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
`;
}

/**
 * Emit the Fly deploy artifacts: the Docker artifacts (Dockerfile +
 * .dockerignore) plus fly.toml. Delegates the Dockerfile to the docker emitter
 * so the container definition stays single-sourced.
 */
export function emitFlyArtifacts(opts: FlyEmitOptions): FlyArtifacts {
  return {
    ...emitDockerArtifacts({ language: opts.language, port: opts.port }),
    "fly.toml": emitFlyToml(opts),
  };
}
