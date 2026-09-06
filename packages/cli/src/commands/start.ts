// packages/cli/src/commands/start.ts
//
// Implements `klaridian start [dir]` — a thin launcher for a project
// previously produced by `klaridian generate`. It generates nothing and
// accepts no spec/architecture/plugin/etc. flags: every structural decision
// was already made and baked into `dir` at generation time (ARCHITECTURE.md
// section 55). This command exists purely so a user doesn't need to
// remember that "run it" means `npm start` inside the output directory —
// it does not introduce a second way to configure or regenerate a server.
//
// Deliberately dumb by design: no --port, --env-file, or any other flag
// that would let it drift back into being a second `generate`. Runtime
// configuration (base URL, auth tokens, plugin credentials, bind host) is
// read from the environment by the generated server itself, exactly as it
// always has been — `start` only launches it.

import type { Command } from "commander";
import path from "node:path";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createCliOutput } from "../cli-output.js";

/**
 * Doc-generation metadata for `klaridian start` (see generate.ts's
 * GENERATE_FLAG_DOC_GROUPS for the convention this mirrors). Only one
 * flag exists, and only for the pre-launch validation path — once the
 * generated server takes over stdio, this command has nothing left to say.
 */
export const START_FLAG_DOC_GROUPS: {
  category: string;
  docPage?: string;
  flags: string[];
}[] = [{ category: "Options", docPage: "/docs/how-to/running-the-server", flags: ["--json"] }];

/**
 * True once a directory looks enough like a `klaridian generate` output to
 * be worth launching — has a package.json with a `start` script, and a
 * server.json (which only klaridian emits, unlike a `start` script alone).
 * Deliberately not exhaustive: this is a helpful guardrail against typos
 * like `klaridian start ./wrong-dir`, not a security boundary.
 */
async function looksLikeGeneratedProject(
  dir: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pkgPath = path.join(dir, "package.json");
  let pkg: { scripts?: Record<string, string>; main?: string };
  try {
    pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  } catch {
    return { ok: false, reason: `No readable package.json in ${dir}. Is this a klaridian generate --out directory?` };
  }
  if (!pkg.scripts?.start) {
    return { ok: false, reason: `${pkgPath} has no "start" script — this doesn't look like a klaridian-generated project.` };
  }
  try {
    await stat(path.join(dir, "server.json"));
  } catch {
    return { ok: false, reason: `No server.json in ${dir} — this doesn't look like a klaridian-generated project.` };
  }
  return { ok: true };
}

/**
 * True once the project has actually been built (`npm install && npm run
 * build`), i.e. its package.json `main` entry exists on disk. Without this
 * check, a not-yet-built project fails with Node's generic
 * MODULE_NOT_FOUND — accurate, but not actionable for someone who forgot
 * the build step.
 */
async function isBuilt(dir: string): Promise<{ ok: true } | { ok: false; mainPath: string }> {
  const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf-8")) as { main?: string };
  const mainPath = path.join(dir, pkg.main ?? "dist/server.bundle.js");
  try {
    await stat(mainPath);
    return { ok: true };
  } catch {
    return { ok: false, mainPath };
  }
}

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .argument("[dir]", "Path to a previously generated klaridian server project", ".")
    .description(
      "Launch a server previously produced by `klaridian generate` — runs its `npm start` in place. Generates and configures nothing; pass every generation flag (--spec, --architecture, --plugin, ...) to `generate` instead, once, when you create or regenerate the project."
    )
    .option(
      "--json",
      "If a pre-launch check fails (missing/unbuilt project), print a single JSON error object to stdout instead of a human message. Has no effect once the server itself starts — from that point the server owns stdout.",
      false
    )
    .action(async (dirArg: string, opts: { json: boolean }) => {
      const { fail } = createCliOutput({ json: opts.json, quiet: false });
      const dir = path.resolve(dirArg);

      const looksRight = await looksLikeGeneratedProject(dir);
      if (!looksRight.ok) {
        fail(looksRight.reason, "validate-project");
        return;
      }

      const built = await isBuilt(dir);
      if (!built.ok) {
        fail(
          `${built.mainPath} does not exist yet. Run \`npm install && npm run build\` in ${dir} first (or \`cd ${dir} && npm run build\` if dependencies are already installed).`,
          "validate-built"
        );
        return;
      }

      // From here on, the generated server owns stdio/stdout — inherit it
      // directly (critical for stdio-transport servers: nothing may sit
      // between this process and the parent MCP client on stdin/stdout).
      const child = spawn("npm", ["start"], { cwd: dir, stdio: "inherit" });
      await new Promise<void>((resolve) => {
        child.on("exit", (code, signal) => {
          process.exitCode = code ?? (signal ? 1 : 0);
          resolve();
        });
        child.on("error", (err) => {
          fail(`Failed to launch \`npm start\` in ${dir}: ${err.message}`, "spawn-failed");
          resolve();
        });
      });
    });
}
