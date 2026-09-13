// packages/cli/src/commands/deploy.ts
//
// MCPFO-86 — `klaridian deploy [dir] --target <target>`.
//
// Emits deploy artifacts for a project previously produced by
// `klaridian generate`, following the "emit + shell out to the platform's
// native CLI" pattern (ARCHITECTURE.md §78) — klaridian never reimplements
// deploy infra. Like `start`, it operates on an already-generated project and
// reconfigures nothing about the server itself; every structural decision was
// baked in at generation time.
//
// This step ships `--target docker`: a portable, vendor-neutral Dockerfile +
// .dockerignore (the baseline the later cloudflare/fly targets build on). The
// Dockerfile is an EPHEMERAL BUILD INPUT, not a maintained part of the
// generated project — that distinction is what lets §55 (which removed Docker
// as a `generate` output) stay intact while `deploy` still writes one. See §78.
//
// Deploy only makes sense for a network transport: a stdio server has nothing
// to expose. So the command detects the generated transport and fails loudly
// on a stdio project rather than emitting a Dockerfile that boots a server no
// one can reach.

import type { Command } from "commander";
import path from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createCliOutput } from "../cli-output.js";
import { emitDockerArtifacts, type DeployLanguage } from "../emit/deploy/emit-docker.js";
import { emitCloudflareArtifacts } from "../emit/deploy/emit-cloudflare.js";

/** Deploy targets shipped so far. fly is a tracked follow-up (§78). */
const SUPPORTED_TARGETS = ["docker", "cloudflare"] as const;
type DeployTarget = (typeof SUPPORTED_TARGETS)[number];

/**
 * Doc-generation metadata for `klaridian deploy` (mirrors START_FLAG_DOC_GROUPS;
 * see generate.ts's GENERATE_FLAG_DOC_GROUPS for the convention).
 */
export const DEPLOY_FLAG_DOC_GROUPS: {
  category: string;
  docPage?: string;
  flags: string[];
}[] = [
  {
    category: "Options",
    docPage: "/docs/how-to/deploy",
    flags: ["--target", "--out", "--force", "--json"],
  },
];

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify `dir` as a TypeScript or Python klaridian output, plus recover the
 * transport and the fallback port from the emitted source. Mirrors start.ts's
 * detectProject signatures (package.json+server.json for TS, pyproject.toml+
 * server.py for Python) and additionally reads what deploy needs: transport
 * (deploy is streamable-http-only) and the baked-in port (for EXPOSE/PORT).
 */
async function detectProject(dir: string): Promise<
  | { ok: true; language: DeployLanguage; transport: string; port: number; hasAuth: boolean; isCodeMode: boolean }
  | { ok: false; reason: string }
> {
  const pkgPath = path.join(dir, "package.json");
  const pyprojectPath = path.join(dir, "pyproject.toml");

  if (await fileExists(pkgPath)) {
    if (!(await fileExists(path.join(dir, "server.json")))) {
      return { ok: false, reason: `No server.json in ${dir} — this doesn't look like a klaridian-generated project.` };
    }
    // Transport lives in server.json (packages[0].transport.type).
    let transport = "stdio";
    try {
      const sj = JSON.parse(await readFile(path.join(dir, "server.json"), "utf-8")) as {
        packages?: { transport?: { type?: string } }[];
      };
      transport = sj.packages?.[0]?.transport?.type ?? "stdio";
    } catch {
      return { ok: false, reason: `${path.join(dir, "server.json")} is not readable JSON. Is this a klaridian generate --out directory?` };
    }
    const port = await recoverPort(path.join(dir, "src", "index.ts"), /KLARIDIAN_PORT\s*\|\|\s*(\d+)\)/);
    const hasAuth = await fileExists(path.join(dir, "src", "auth.ts"));
    // code-mode emits a Deno-sandbox runner; that subprocess can't run on Workers.
    const isCodeMode = await fileExists(path.join(dir, "src", "sandbox-runner.ts"));
    return { ok: true, language: "typescript", transport, port, hasAuth, isCodeMode };
  }

  if (await fileExists(pyprojectPath)) {
    if (!(await fileExists(path.join(dir, "server.py")))) {
      return { ok: false, reason: `No server.py in ${dir} — this doesn't look like a klaridian-generated Python project.` };
    }
    const serverPy = path.join(dir, "server.py");
    // Transport: the argparse default baked into server.py.
    let transport = "stdio";
    try {
      const src = await readFile(serverPy, "utf-8");
      const m = src.match(/add_argument\("--transport",\s*default="([^"]+)"/);
      if (m) transport = m[1];
    } catch {
      return { ok: false, reason: `${serverPy} is not readable. Is this a klaridian generate --out directory?` };
    }
    const port = await recoverPort(serverPy, /KLARIDIAN_PORT"\)\s*or\s*(\d+)\)/);
    const hasAuth = await fileExists(path.join(dir, "auth.py"));
    return { ok: true, language: "python", transport, port, hasAuth, isCodeMode: false };
  }

  return {
    ok: false,
    reason: `No package.json or pyproject.toml in ${dir}. Is this a klaridian generate --out directory?`,
  };
}

/** Recover the generated fallback port from emitted source, defaulting to 3000. */
async function recoverPort(sourcePath: string, pattern: RegExp): Promise<number> {
  try {
    const src = await readFile(sourcePath, "utf-8");
    const m = src.match(pattern);
    if (m) return Number(m[1]);
  } catch {
    // fall through to the default
  }
  return 3000;
}

/**
 * The server name for a Cloudflare Worker: the generated project's package.json
 * `name`, falling back to the directory basename. wrangler normalizes it further.
 */
async function serverNameFor(_detected: unknown, dir: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf-8")) as { name?: string };
    if (pkg.name) return pkg.name;
  } catch {
    // fall through to the basename
  }
  return path.basename(dir);
}

/** Whether `dir` already contains one of the artifacts we'd write. */
async function anyArtifactExists(dir: string, names: string[]): Promise<string | null> {
  for (const n of names) {
    if (await fileExists(path.join(dir, n))) return n;
  }
  return null;
}

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .argument("[dir]", "Path to a previously generated klaridian server project", ".")
    .description(
      "Emit deploy artifacts for a project previously produced by `klaridian generate`. Uses the emit + shell-out model: klaridian writes the platform's native config (a portable Dockerfile for --target docker) rather than reimplementing deploy infrastructure. Reconfigures nothing about the server itself — every structural decision was made at generation time. Requires a streamable-http project (a stdio server has nothing to expose)."
    )
    .option(
      "--target <target>",
      `Deploy target to emit artifacts for. Supported: ${SUPPORTED_TARGETS.join(", ")}.`,
      "docker"
    )
    .option(
      "--out <dir>",
      "Directory to write the artifacts into (default: the project directory itself)."
    )
    .option(
      "--force",
      "Overwrite existing artifacts (Dockerfile/.dockerignore) instead of refusing.",
      false
    )
    .option(
      "--json",
      "Print a single machine-readable JSON result to stdout instead of human-readable lines.",
      false
    )
    .action(
      async (
        dirArg: string,
        opts: { target: string; out?: string; force: boolean; json: boolean }
      ) => {
        const { step, fail } = createCliOutput({ json: opts.json, quiet: false });
        const dir = path.resolve(dirArg);
        const outDir = opts.out ? path.resolve(opts.out) : dir;

        // Validate the target first — a clear error beats emitting nothing silently.
        if (!SUPPORTED_TARGETS.includes(opts.target as DeployTarget)) {
          fail(
            `Unknown --target "${opts.target}". Supported: ${SUPPORTED_TARGETS.join(", ")}.`,
            "validate-target"
          );
          return;
        }

        const detected = await detectProject(dir);
        if (!detected.ok) {
          fail(detected.reason, "validate-project");
          return;
        }

        // Deploy is streamable-http-only: a stdio server exposes nothing.
        if (detected.transport !== "streamable-http") {
          fail(
            `deploy needs a streamable-http project, but ${dir} was generated with transport "${detected.transport}". Regenerate with \`klaridian generate --transport streamable-http --port <n>\` before deploying (a stdio server has no network endpoint to expose).`,
            "validate-transport"
          );
          return;
        }

        // Emit the artifacts for the chosen target.
        let artifacts: Record<string, string>;
        if (opts.target === "cloudflare") {
          // Cloudflare Workers runs JS/TS on workerd — not a CPython server.
          if (detected.language !== "typescript") {
            fail(
              `--target cloudflare only supports TypeScript projects, but ${dir} is a ${detected.language} project. Cloudflare Workers runs JavaScript/TypeScript, not a Python server — use \`--target docker\` (or fly) for the Python target.`,
              "validate-language"
            );
            return;
          }
          // code-mode runs model code in a spawned Deno subprocess, which the
          // Workers runtime has no way to launch.
          if (detected.isCodeMode) {
            fail(
              `--target cloudflare can't deploy a code-mode server: its execute_code tool spawns a Deno sandbox subprocess, which the Workers runtime cannot run. Use \`--target docker\` (or fly) for a code-mode server.`,
              "validate-architecture"
            );
            return;
          }
          artifacts = emitCloudflareArtifacts({ serverName: await serverNameFor(detected, dir), hasAuth: detected.hasAuth });
        } else {
          artifacts = emitDockerArtifacts({ language: detected.language, port: detected.port });
        }
        const names = Object.keys(artifacts);

        // Overwrite protection, mirroring generate's --force contract.
        if (!opts.force) {
          const clash = await anyArtifactExists(outDir, names);
          if (clash !== null) {
            fail(
              `${path.join(outDir, clash)} already exists. Use --force to overwrite it, or --out to write elsewhere.`,
              "check-output"
            );
            return;
          }
        }

        for (const [name, content] of Object.entries(artifacts)) {
          await writeFile(path.join(outDir, name), content, "utf-8");
          step(`Wrote ${path.join(outDir, name)}`);
        }

        const nextSteps =
          opts.target === "cloudflare"
            ? "Next: validate with `npx wrangler deploy --dry-run` (no account needed), " +
              "set KLARIDIAN_BASE_URL in wrangler.toml, then `npx wrangler deploy`. " +
              "KLARIDIAN_ALLOWED_HOSTS is preset to <name>.workers.dev — add your custom domain if you use one."
            : "Next: build and run locally with `docker build -t my-server " +
              `${path.relative(process.cwd(), outDir) || "."}` +
              "` then `docker run -p 3000:3000 -e KLARIDIAN_BASE_URL=<api> my-server`. " +
              "To deploy, hand the Dockerfile to your platform's CLI (for example `fly launch` / `fly deploy`). " +
              "Set KLARIDIAN_ALLOWED_HOSTS to your public hostname so requests aren't rejected with 403.";

        if (opts.json) {
          process.stdout.write(
            JSON.stringify(
              {
                success: true,
                target: opts.target,
                language: detected.language,
                port: detected.port,
                out: outDir,
                files: names,
              },
              null,
              2
            ) + "\n"
          );
        } else {
          step(nextSteps);
        }
      }
    );
}
