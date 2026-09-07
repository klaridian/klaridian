// packages/cli/src/commands/start.ts
//
// Implements `klaridian start [dir]` — a thin launcher for a project
// previously produced by `klaridian generate`. It generates nothing and
// accepts no spec/architecture/plugin/language/etc. flags: every structural
// decision was already made and baked into `dir` at generation time
// (ARCHITECTURE.md section 55). This command exists purely so a user doesn't
// need to remember how "run it" is spelled for each language — it does not
// introduce a second way to configure or regenerate a server.
//
// Language-neutral by design (ARCHITECTURE.md section 62). `start` is the
// "Run" verb of the generate/prepare/run lifecycle, and Run is language-
// agnostic — it never touches the network in any language. It launches
// whichever project `generate` emitted into `dir`:
//   - TypeScript: `npm start` (runs the built dist/server.bundle.js)
//   - Python:     the project's `.venv` interpreter on `server.py`
// It passes NO transport/port flags in either case: the transport and port
// chosen at generation time are baked into the emitted project (the TS
// bundle, and the Python argparse defaults), so a bare launch reproduces the
// generated server exactly. Runtime configuration (base URL, auth tokens,
// plugin credentials, bind host) is read from the environment by the
// generated server itself, exactly as it always has been.
//
// Deliberately dumb: no --port, --env-file, --language, or any other flag
// that would let it drift back into being a second `generate`.

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

type ProjectLanguage = "typescript" | "python";

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classifies `dir` as a TypeScript or Python klaridian output, or explains why
 * it doesn't look like one. Deliberately not exhaustive: this is a helpful
 * guardrail against typos like `klaridian start ./wrong-dir`, not a security
 * boundary. Each language has a two-marker signature mirroring the other's:
 *   - TypeScript: package.json (with a `start` script) + server.json
 *   - Python:     pyproject.toml + server.py
 * package.json/pyproject.toml is the cheap discriminator; the second marker
 * (server.json / server.py, both emitted only by `generate`) confirms it's a
 * klaridian project rather than an unrelated Node or Python directory.
 */
async function detectProject(
  dir: string
): Promise<{ ok: true; language: ProjectLanguage } | { ok: false; reason: string }> {
  const pkgPath = path.join(dir, "package.json");
  const pyprojectPath = path.join(dir, "pyproject.toml");

  if (await fileExists(pkgPath)) {
    let pkg: { scripts?: Record<string, string>; main?: string };
    try {
      pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    } catch {
      return { ok: false, reason: `${pkgPath} is not readable JSON. Is this a klaridian generate --out directory?` };
    }
    if (!pkg.scripts?.start) {
      return { ok: false, reason: `${pkgPath} has no "start" script — this doesn't look like a klaridian-generated project.` };
    }
    if (!(await fileExists(path.join(dir, "server.json")))) {
      return { ok: false, reason: `No server.json in ${dir} — this doesn't look like a klaridian-generated project.` };
    }
    return { ok: true, language: "typescript" };
  }

  if (await fileExists(pyprojectPath)) {
    if (!(await fileExists(path.join(dir, "server.py")))) {
      return { ok: false, reason: `No server.py in ${dir} — this doesn't look like a klaridian-generated Python project.` };
    }
    return { ok: true, language: "python" };
  }

  return {
    ok: false,
    reason: `No package.json or pyproject.toml in ${dir}. Is this a klaridian generate --out directory?`,
  };
}

/**
 * For a TypeScript project: true once it's been built (`npm install && npm run
 * build`), i.e. its package.json `main` entry exists on disk. Without this
 * check a not-yet-built project fails with Node's generic MODULE_NOT_FOUND —
 * accurate, but not actionable for someone who forgot the build step.
 */
async function tsIsBuilt(dir: string): Promise<{ ok: true } | { ok: false; mainPath: string }> {
  const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf-8")) as { main?: string };
  const mainPath = path.join(dir, pkg.main ?? "dist/server.bundle.js");
  return (await fileExists(mainPath)) ? { ok: true } : { ok: false, mainPath };
}

/**
 * For a Python project: resolve the interpreter inside the project's `.venv`,
 * or null if there is no virtual environment yet. This is the Python peer of
 * tsIsBuilt() — the "prepare step ran" gate. A Python project is "prepared"
 * once its venv exists with requirements.txt installed (the exact layout the
 * `generate` Next-steps and the emitted README instruct: `python -m venv
 * .venv`). Checks the POSIX path first, then the Windows one.
 */
async function resolveVenvPython(dir: string): Promise<string | null> {
  const candidates = [
    path.join(dir, ".venv", "bin", "python"),
    path.join(dir, ".venv", "Scripts", "python.exe"),
  ];
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  return null;
}

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .argument("[dir]", "Path to a previously generated klaridian server project", ".")
    .description(
      "Launch a server previously produced by `klaridian generate` — runs it in place (npm start for a TypeScript project, the .venv interpreter on server.py for a Python one). Generates and configures nothing; pass every generation flag (--spec, --language, --architecture, --plugin, ...) to `generate` instead, once, when you create or regenerate the project."
    )
    .option(
      "--json",
      "If a pre-launch check fails (missing/unbuilt project), print a single JSON error object to stdout instead of a human message. Has no effect once the server itself starts — from that point the server owns stdout.",
      false
    )
    .action(async (dirArg: string, opts: { json: boolean }) => {
      const { fail } = createCliOutput({ json: opts.json, quiet: false });
      const dir = path.resolve(dirArg);

      const detected = await detectProject(dir);
      if (!detected.ok) {
        fail(detected.reason, "validate-project");
        return;
      }

      // Resolve the launch command per language. Both branches end with a
      // command + args; the spawn/handoff below is shared, so stdio inheritance
      // (critical for stdio-transport servers — nothing may sit between this
      // process and the parent MCP client on stdin/stdout) is identical.
      let command: string;
      let args: string[];

      if (detected.language === "typescript") {
        const built = await tsIsBuilt(dir);
        if (!built.ok) {
          fail(
            `${built.mainPath} does not exist yet. Run \`npm install && npm run build\` in ${dir} first (or \`cd ${dir} && npm run build\` if dependencies are already installed).`,
            "validate-built"
          );
          return;
        }
        command = "npm";
        args = ["start"];
      } else {
        const venvPython = await resolveVenvPython(dir);
        if (venvPython === null) {
          fail(
            `No Python virtual environment found in ${dir} (expected .venv/). Run \`python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt\` in ${dir} first (the steps \`klaridian generate\` printed under "Next"), then run \`klaridian start\` again.`,
            "validate-built"
          );
          return;
        }
        command = venvPython;
        // No --transport/--port: the values chosen at generation time are the
        // argparse defaults baked into server.py, so a bare launch reproduces
        // the generated server exactly (parity with the TS `npm start` path).
        args = ["server.py"];
      }

      // From here on, the generated server owns stdio/stdout — inherit it
      // directly (critical for stdio-transport servers: nothing may sit
      // between this process and the parent MCP client on stdin/stdout).
      const child = spawn(command, args, { cwd: dir, stdio: "inherit" });
      await new Promise<void>((resolve) => {
        child.on("exit", (code, signal) => {
          process.exitCode = code ?? (signal ? 1 : 0);
          resolve();
        });
        child.on("error", (err) => {
          fail(`Failed to launch \`${command} ${args.join(" ")}\` in ${dir}: ${err.message}`, "spawn-failed");
          resolve();
        });
      });
    });
}
