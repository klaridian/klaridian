#!/usr/bin/env node
// packages/cli/src/index.ts — the `klaridian` command entrypoint.

import { Command } from "commander";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerInitCommand } from "./commands/init.js";
import { registerStartCommand } from "./commands/start.js";
import { registerPluginsCommand, registerLicensesCommand } from "./commands/list.js";
// Single source of truth for the CLI version: the package manifest. Hardcoding
// it here (was "0.0.1") silently drifts from package.json on every release —
// nothing tested it, so `klaridian --version` shipped 0.0.1 while the package
// was 0.1.0. The static JSON import is inlined by tsc AND embedded by
// `bun --compile`, so the standalone binary reports the real version too.
import pkg from "../package.json" with { type: "json" };

const program = new Command();
program
  .name("klaridian")
  .description("Generate MCP servers with built-in observability from an OpenAPI spec.")
  .version(pkg.version);

registerGenerateCommand(program);
registerInitCommand(program);
registerStartCommand(program);
registerPluginsCommand(program);
registerLicensesCommand(program);

program.parseAsync(process.argv);
