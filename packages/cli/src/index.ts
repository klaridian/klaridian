#!/usr/bin/env node
// packages/cli/src/index.ts — the `mcpforge` command entrypoint.

import { Command } from "commander";
import { registerGenerateCommand } from "./commands/generate.js";

const program = new Command();
program
  .name("mcpforge")
  .description("Generate MCP servers with built-in observability from an OpenAPI spec.")
  .version("0.0.1");

registerGenerateCommand(program);

program.parseAsync(process.argv);
