#!/usr/bin/env node
// packages/cli/src/index.ts — the `klaridian` command entrypoint.

import { Command } from "commander";
import { registerGenerateCommand } from "./commands/generate.js";

const program = new Command();
program
  .name("klaridian")
  .description("Generate MCP servers with built-in observability from an OpenAPI spec.")
  .version("0.0.1");

registerGenerateCommand(program);

program.parseAsync(process.argv);
