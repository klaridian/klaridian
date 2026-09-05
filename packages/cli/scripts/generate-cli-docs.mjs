#!/usr/bin/env node
// packages/cli/scripts/generate-cli-docs.mjs
//
// Generates packages/site/content/docs/cli-reference.mdx directly from the
// real `klaridian generate` command (introspecting the actual commander.js
// Command object built by registerGenerateCommand, not hand-copied text).
//
// This exists because the CLI reference doc drifted from the real CLI more
// than once (documented flags that didn't exist, real flags never
// documented) when it was hand-written. Run `npm run docs:gen` after
// changing any --option() in src/commands/generate.ts, or building
// (`npm run build`) automatically regenerates it. CI's `docs-flags-sync`
// job fails the build if the committed file doesn't match what this script
// produces right now -- see .github/workflows/ci.yml.
//
// Grouping/section metadata comes from GENERATE_FLAG_DOC_GROUPS in
// src/commands/generate.ts (the single source of truth for how flags are
// organized on the docs page) -- everything else (flag syntax, description,
// default value) is read directly off the live Command instance.

import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerGenerateCommand,
  GENERATE_FLAG_DOC_GROUPS,
} from "../dist/src/commands/generate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(
  __dirname,
  "../../site/content/docs/reference/cli-reference.mdx"
);

function flagName(flags) {
  // commander's `.flags` is the raw definition string, e.g.
  // "--exclude-tags <tags>" or "--plugin <id>" -- the bare flag name
  // (before any <arg>) is what GENERATE_FLAG_DOC_GROUPS keys on.
  return flags.split(/[\s,]/)[0].replace(/^--?/, "--");
}

function formatFlagCell(opt) {
  // Render exactly what a user types: the flags string as commander
  // defines it (e.g. "--plugin <id>"), wrapped as inline code.
  return `\`${opt.flags}\``;
}

function formatDescription(opt) {
  let text = opt.description.trim();

  // Anything outside a backtick-wrapped code span is parsed as MDX/JSX, so
  // a literal placeholder like `<pluginId>.<key>=<value>` in prose breaks
  // the build ("Expected a closing tag"). Escape angle brackets in plain
  // text; leave text inside backticks untouched.
  text = text
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith("`") ? part : part.replace(/</g, "&lt;").replace(/>/g, "&gt;")))
    .join("");

  if (
    opt.defaultValue !== undefined &&
    opt.defaultValue !== false &&
    !(Array.isArray(opt.defaultValue) && opt.defaultValue.length === 0) &&
    !text.toLowerCase().includes("default")
  ) {
    const shown = Array.isArray(opt.defaultValue)
      ? JSON.stringify(opt.defaultValue)
      : opt.defaultValue;
    text += text.endsWith(".") || text.endsWith(":") ? "" : ".";
    text += ` Defaults to \`${shown}\`.`;
  }

  return text;
}

function main() {
  const program = new Command();
  registerGenerateCommand(program);
  const generateCmd = program.commands.find((c) => c.name() === "generate");
  if (!generateCmd) {
    throw new Error("Could not find the 'generate' command on the built CLI.");
  }

  const allOptions = generateCmd.options.map((o) => ({
    flags: o.flags,
    description: o.description,
    defaultValue: o.defaultValue,
    name: flagName(o.flags),
  }));

  const byName = new Map(allOptions.map((o) => [o.name, o]));

  // Fail loudly on drift in either direction, rather than silently
  // producing an incomplete or stale doc.
  const documented = new Set(GENERATE_FLAG_DOC_GROUPS.flatMap((g) => g.flags));
  const real = new Set(allOptions.map((o) => o.name));

  const undocumented = [...real].filter((f) => !documented.has(f));
  const nonExistent = [...documented].filter((f) => !real.has(f));

  if (undocumented.length > 0) {
    throw new Error(
      `Flag(s) exist on 'klaridian generate' but aren't in GENERATE_FLAG_DOC_GROUPS ` +
        `(src/commands/generate.ts): ${undocumented.join(", ")}. Add them to a group before regenerating docs.`
    );
  }
  if (nonExistent.length > 0) {
    throw new Error(
      `GENERATE_FLAG_DOC_GROUPS references flag(s) that don't exist on the real CLI: ` +
        `${nonExistent.join(", ")}. Remove them or fix the flag name.`
    );
  }

  const sections = GENERATE_FLAG_DOC_GROUPS.map(({ category, docPage, flags }) => {
    const rows = flags.map((name) => {
      const opt = byName.get(name);
      return `| ${formatFlagCell(opt)} | ${formatDescription(opt)} |`;
    });
    const seeAlso = docPage ? `\nSee [${category}](${docPage}) for the full guide.\n` : "";
    return `## ${category}\n${seeAlso}\n| Flag | What it does |\n|---|---|\n${rows.join("\n")}\n`;
  });

  const body = `---
title: CLI reference
description: Every flag for klaridian generate, generated from the real CLI.
---

{/*
  GENERATED FILE -- do not hand-edit.
  Produced by packages/cli/scripts/generate-cli-docs.mjs from the live
  commander.js Command. Run \`npm run docs:gen\` (packages/cli) after
  changing any flag, then commit the result. CI fails the build if this
  file doesn't match what the generator produces from the current code.
*/}

${sections.join("\n")}`;

  return body;
}

const body = main();
await writeFile(OUTPUT_PATH, body, "utf-8");
console.log(`Wrote ${OUTPUT_PATH}`);
