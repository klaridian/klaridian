#!/usr/bin/env node
// packages/cli/src/index.ts — the `klaridian` command entrypoint.

import { Command } from "commander";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerInitCommand } from "./commands/init.js";
import { registerStartCommand } from "./commands/start.js";
import { registerPluginsCommand, registerLicensesCommand } from "./commands/list.js";

const program = new Command();
program
  .name("klaridian")
  .description("Generate MCP servers with built-in observability from an OpenAPI spec.")
  .version("0.0.1");

registerGenerateCommand(program);
registerInitCommand(program);
registerStartCommand(program);
registerPluginsCommand(program);
registerLicensesCommand(program);

program.parseAsync(process.argv);
