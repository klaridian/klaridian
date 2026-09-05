// packages/cli/src/commands/init.ts
//
// Implements `klaridian init` — an onboarding wizard that prompts for the
// handful of inputs most `klaridian generate` runs share and writes a
// klaridian.config.json scaffold (MCPFO-38 / ARCHITECTURE.md section 53).
//
// It deliberately does NOT run generation itself: its only output is the
// config file, then a "Next: run klaridian generate" line. `generate`
// already knows how to consume that file (MCPFO-37 / section 52), so `init`
// is a thin front door, not a second code path into the emitter.
//
// Non-interactive design: a field is prompted for ONLY if its flag wasn't
// passed (commander's flag-overrides-prompt pattern, the same CLI > config >
// default precedence `generate`'s config merge uses). --spec and
// --generate-out are required; with neither a flag nor a way to prompt
// (no TTY, no piped answers, or --json), the command fails loudly rather
// than hanging or silently guessing.

import type { Command } from "commander";
import path from "node:path";
import { writeFile, stat } from "node:fs/promises";
import { input, select, checkbox } from "@inquirer/prompts";
import { CONFIG_FILE_NAME } from "../config/config-file.js";
import { createCliOutput } from "../cli-output.js";
import { AVAILABLE_PLUGINS, SUPPORTED_TRANSPORTS } from "./generate.js";
import { SUPPORTED_LICENSES, isSupportedLicense } from "../render/license.js";

/**
 * Doc-generation metadata for `klaridian init`'s flags, mirroring
 * GENERATE_FLAG_DOC_GROUPS in generate.ts. scripts/generate-cli-docs.mjs
 * introspects both commands; every flag registered below MUST have an entry
 * here (the generator fails loudly otherwise).
 */
export const INIT_FLAG_DOC_GROUPS: {
  category: string;
  docPage?: string;
  flags: string[];
}[] = [
  { category: "Options", flags: ["--out", "--force", "--json", "--quiet"] },
  {
    category: "Wizard fields",
    docPage: "/docs/how-to/init",
    flags: ["--spec", "--generate-out", "--plugin", "--license", "--transport"],
  },
];

/** The answers the wizard collects, written verbatim as klaridian.config.json. */
interface InitConfig {
  spec: string;
  out: string;
  plugin: string[];
  license: string;
  transport: string;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description(
      `Interactive wizard that scaffolds a ${CONFIG_FILE_NAME} for \`klaridian generate\` (writes the file only — it does not generate a server)`
    )
    .option(
      "--out <path>",
      `Where to write the config file (default: ./${CONFIG_FILE_NAME} in the current directory)`,
      CONFIG_FILE_NAME
    )
    .option(
      "--force",
      `Overwrite the config file even if it already exists (default: refuse, to avoid silently replacing one you meant to keep)`,
      false
    )
    .option(
      "--spec <path>",
      "OpenAPI spec path or URL (skips that prompt when passed)"
    )
    .option(
      "--generate-out <dir>",
      "Output directory `klaridian generate` should write the server to — the config file's `out` field, distinct from this command's own --out (skips that prompt when passed)"
    )
    .option(
      "--plugin <id>",
      `Observability plugin to enable, repeatable (available: ${Object.keys(AVAILABLE_PLUGINS).join(", ")}); skips that prompt when passed`,
      (value: string, previous: string[]) => [...previous, value],
      [] as string[]
    )
    .option(
      "--license <id>",
      `License for the generated server: ${SUPPORTED_LICENSES.join(", ")} (skips that prompt when passed)`,
      "mit"
    )
    .option(
      "--transport <type>",
      `Transport for the generated server: ${SUPPORTED_TRANSPORTS.join(" or ")} (skips that prompt when passed)`,
      "stdio"
    )
    .option(
      "--json",
      "Print a single machine-readable JSON result to stdout instead of human-readable progress on stderr. Implies non-interactive: every wizard answer must come from a flag.",
      false
    )
    .option(
      "--quiet",
      "Suppress step-by-step progress messages; still prints warnings, errors, and the final next-steps line",
      false
    )
    .action(
      async (
        opts: {
          out: string;
          force: boolean;
          spec?: string;
          generateOut?: string;
          plugin: string[];
          license: string;
          transport: string;
          json: boolean;
          quiet: boolean;
        },
        command: Command
      ) => {
        const { step, fail, warnings } = createCliOutput({ json: opts.json, quiet: opts.quiet });

        /** A value only if the user actually passed the flag (not left at its default) — mirrors generate.ts's config-merge precedence check. */
        const passed = <T>(attr: string, value: T): T | undefined => {
          const source = command.getOptionValueSource(attr);
          return source === "cli" || source === "env" ? value : undefined;
        };

        try {
          const configOutPath = path.resolve(opts.out);

          // Overwrite protection, same philosophy as `generate`'s --force:
          // refuse to clobber an existing file unless asked. Checked before
          // any prompting so a mistaken --out fails fast.
          let existing: Awaited<ReturnType<typeof stat>> | undefined;
          try {
            existing = await stat(configOutPath);
          } catch {
            existing = undefined;
          }
          if (existing?.isDirectory()) {
            fail(`Config output path "${configOutPath}" already exists and is a directory.`, "check-output");
            return;
          }
          if (existing && !opts.force) {
            fail(
              `Config file "${configOutPath}" already exists. Use --force to overwrite it, or choose a different --out.`,
              "check-output"
            );
            return;
          }

          const specFlag = passed("spec", opts.spec);
          const generateOutFlag = passed("generateOut", opts.generateOut);
          const pluginFlag = passed("plugin", opts.plugin);
          const licenseFlag = passed("license", opts.license);
          const transportFlag = passed("transport", opts.transport);

          // Validate anything supplied by flag up front (prompted values are
          // constrained by their choice lists and can't be invalid).
          if (licenseFlag !== undefined && !isSupportedLicense(licenseFlag)) {
            fail(`Unknown license "${licenseFlag}". Supported: ${SUPPORTED_LICENSES.join(", ")}`, "validate-license");
            return;
          }
          if (transportFlag !== undefined && !(SUPPORTED_TRANSPORTS as readonly string[]).includes(transportFlag)) {
            fail(`Unknown transport "${transportFlag}". Supported: ${SUPPORTED_TRANSPORTS.join(", ")}`, "validate-transport");
            return;
          }
          for (const id of pluginFlag ?? []) {
            if (!AVAILABLE_PLUGINS[id]) {
              fail(`Unknown plugin "${id}". Available plugins: ${Object.keys(AVAILABLE_PLUGINS).join(", ")}`, "validate-plugin");
              return;
            }
          }

          // --spec and --generate-out have no sensible default — they're the
          // two things every run genuinely varies. If neither a flag nor an
          // interactive prompt can supply them, stop loudly.
          const missingRequired = specFlag === undefined || generateOutFlag === undefined;
          if (opts.json && missingRequired) {
            fail(
              "`klaridian init --json` is non-interactive: pass --spec and --generate-out (and optionally --plugin/--license/--transport) explicitly.",
              "non-interactive"
            );
            return;
          }

          // Prompt when a flag is missing and we have a way to ask: a real
          // TTY, or (for the required fields) piped answers. `@inquirer`
          // throws ExitPromptError on EOF, so a bare CI/agent run with no
          // input fails loudly here rather than hanging.
          const interactive = !opts.json && (process.stdin.isTTY === true || missingRequired);

          let spec = specFlag;
          let generateOut = generateOutFlag;
          let plugins = pluginFlag;
          let license = licenseFlag;
          let transport = transportFlag;

          if (interactive) {
            const io = { output: process.stderr } as const;
            try {
              if (spec === undefined) {
                spec = await input(
                  { message: "OpenAPI spec path or URL:", validate: (v) => v.trim().length > 0 || "Required." },
                  io
                );
              }
              if (generateOut === undefined) {
                generateOut = await input(
                  {
                    message: "Output directory for the generated server (klaridian generate --out):",
                    validate: (v) => v.trim().length > 0 || "Required.",
                  },
                  io
                );
              }
              if (plugins === undefined) {
                plugins = await checkbox(
                  {
                    message: "Observability plugins to enable (space to toggle, enter to confirm):",
                    choices: Object.keys(AVAILABLE_PLUGINS).map((id) => ({ name: id, value: id })),
                  },
                  io
                );
              }
              if (license === undefined) {
                license = await select(
                  {
                    message: "License for the generated server:",
                    choices: SUPPORTED_LICENSES.map((id) => ({ name: id, value: id })),
                    default: "mit",
                  },
                  io
                );
              }
              if (transport === undefined) {
                transport = await select(
                  {
                    message: "Transport for the generated server:",
                    choices: SUPPORTED_TRANSPORTS.map((t) => ({ name: t, value: t })),
                    default: "stdio",
                  },
                  io
                );
              }
            } catch (err) {
              if (err instanceof Error && (err.name === "ExitPromptError" || err.name === "AbortPromptError")) {
                fail(
                  "`klaridian init` needs an interactive terminal (or piped answers) to prompt for the missing fields. " +
                    "In a script, CI, or agent context, pass --spec and --generate-out (and optionally --plugin/--license/--transport) instead.",
                  "non-interactive"
                );
                return;
              }
              throw err;
            }
          }

          // Anything still unset here means: not a flag, and not prompted
          // (non-TTY run with the required fields supplied by flag). Fall
          // back to the same defaults `generate` would apply.
          const config: InitConfig = {
            spec: spec as string,
            out: generateOut as string,
            plugin: plugins ?? [],
            license: license ?? "mit",
            transport: transport ?? "stdio",
          };

          await writeFile(configOutPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
          step(`✅ Wrote ${configOutPath}`);

          const atDefaultLocation = configOutPath === path.resolve(process.cwd(), CONFIG_FILE_NAME);
          const configArg = atDefaultLocation
            ? ""
            : ` --config ${path.relative(process.cwd(), configOutPath) || configOutPath}`;
          // --spec and --out still go on the command line: commander enforces
          // them as required options before the config file is read
          // (ARCHITECTURE.md section 52), so the file can't supply them yet.
          const nextCommand = `klaridian generate --spec ${config.spec} --out ${config.out}${configArg}`;

          if (opts.json) {
            process.stdout.write(
              JSON.stringify({ success: true, configPath: configOutPath, config, nextCommand, warnings }, null, 2) + "\n"
            );
          } else {
            console.error(
              `   Next: run \`${nextCommand}\`${atDefaultLocation ? ` (${CONFIG_FILE_NAME} is picked up automatically)` : ""}`
            );
          }
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err), "unexpected");
        }
      }
    );
}
