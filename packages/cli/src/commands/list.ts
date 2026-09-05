// packages/cli/src/commands/list.ts
//
// Implements the two introspection commands `klaridian plugins list` and
// `klaridian licenses list` (MCPFO-39 / ARCHITECTURE.md section 54). They
// exist so a human or an agent can discover the option space —
// which observability plugins, which licenses — without parsing `--help`
// or reading the source.
//
// Both are deliberately nested (`plugins list`, not `list-plugins`) so a
// later `plugins info <id>` can slot in without a redesign, and both read
// straight from the same single sources of truth `generate` validates
// against — `AVAILABLE_PLUGINS` (generate.ts) and `SUPPORTED_LICENSES`
// (render/license.ts) — never a hand-copied list that could drift.
//
// Each has a `--json` flag; the human-readable and JSON forms both print to
// stdout (the list is the command's actual output, not progress noise). The
// shared `createCliOutput()` failure path (ARCHITECTURE.md section 32) is
// reused for uniformity even though the only realistic failure is an empty
// registry (a klaridian build error, not a usage error).

import type { Command } from "commander";
import { createCliOutput } from "../cli-output.js";
import { AVAILABLE_PLUGINS } from "./generate.js";
import { SUPPORTED_LICENSES, LICENSE_LABELS } from "../render/license.js";

/**
 * Doc-generation metadata for `klaridian plugins list`, mirroring
 * GENERATE_FLAG_DOC_GROUPS / INIT_FLAG_DOC_GROUPS. scripts/generate-cli-docs.mjs
 * introspects this command via DOCUMENTED_COMMANDS; every flag registered
 * below MUST have an entry here (the generator fails loudly otherwise).
 */
export const PLUGINS_LIST_FLAG_DOC_GROUPS: {
  category: string;
  docPage?: string;
  flags: string[];
}[] = [{ category: "Options", flags: ["--json"] }];

/** Doc-generation metadata for `klaridian licenses list` (see above). */
export const LICENSES_LIST_FLAG_DOC_GROUPS: {
  category: string;
  docPage?: string;
  flags: string[];
}[] = [{ category: "Options", flags: ["--json"] }];

/** Prints `id`-aligned `id  description` rows to stdout. */
function printAlignedList(rows: { id: string; description: string }[]): void {
  const width = Math.max(...rows.map((r) => r.id.length));
  for (const row of rows) {
    process.stdout.write(`${row.id.padEnd(width)}  ${row.description}\n`);
  }
}

export function registerPluginsCommand(program: Command): void {
  const plugins = program
    .command("plugins")
    .description("Inspect the observability plugins `klaridian generate --plugin` accepts");

  plugins
    .command("list")
    .description("List every available observability plugin (id and name)")
    .option(
      "--json",
      "Print the list as a single JSON object (`{ plugins: [...] }`) to stdout instead of aligned text",
      false
    )
    .action((opts: { json: boolean }) => {
      const { fail } = createCliOutput({ json: opts.json, quiet: false });

      const entries = Object.values(AVAILABLE_PLUGINS).map((p) => ({ id: p.id, name: p.name }));
      if (entries.length === 0) {
        fail(
          "No observability plugins are registered — this is a klaridian build error, not a usage error.",
          "list-plugins"
        );
        return;
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify({ plugins: entries }, null, 2) + "\n");
        return;
      }
      printAlignedList(entries.map((e) => ({ id: e.id, description: e.name })));
    });
}

export function registerLicensesCommand(program: Command): void {
  const licenses = program
    .command("licenses")
    .description("Inspect the licenses `klaridian generate --license` accepts");

  licenses
    .command("list")
    .description("List every supported license id for the generated server")
    .option(
      "--json",
      "Print the list as a single JSON object (`{ licenses: [...] }`) to stdout instead of aligned text",
      false
    )
    .action((opts: { json: boolean }) => {
      const { fail } = createCliOutput({ json: opts.json, quiet: false });

      const entries = SUPPORTED_LICENSES.map((id) => ({ id, label: LICENSE_LABELS[id] }));
      if (entries.length === 0) {
        fail(
          "No licenses are registered — this is a klaridian build error, not a usage error.",
          "list-licenses"
        );
        return;
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify({ licenses: entries }, null, 2) + "\n");
        return;
      }
      printAlignedList(entries.map((e) => ({ id: e.id, description: e.label })));
    });
}
