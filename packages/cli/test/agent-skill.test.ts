// packages/cli/test/agent-skill.test.ts
//
// MCPFO-127: the klaridian Agent Skill (skills/klaridian/SKILL.md) is prose an
// agent follows literally, so a flag or error code that no longer exists makes
// the agent run a broken command. Same rule as cli-reference.mdx: nothing the
// skill claims about the CLI may drift from the real CLI. This test checks the
// claims against the live commander Commands and the real error stages, and
// checks the frontmatter against the Agent Skills spec (agentskills.io).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerGenerateCommand } from "../src/commands/generate.js";
import { registerInitCommand } from "../src/commands/init.js";
import { registerStartCommand } from "../src/commands/start.js";
import { registerDeployCommand } from "../src/commands/deploy.js";
import { registerPluginsCommand, registerLicensesCommand } from "../src/commands/list.js";
import { stageToCode } from "../src/cli-output.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> packages/cli -> repo root
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SKILL_DIR = path.join(REPO_ROOT, "skills", "klaridian");
const SKILL_PATH = path.join(SKILL_DIR, "SKILL.md");
const SRC_DIR = path.resolve(__dirname, "../../src");

function buildProgram(): Command {
  const program = new Command("klaridian");
  registerGenerateCommand(program);
  registerInitCommand(program);
  registerStartCommand(program);
  registerDeployCommand(program);
  registerPluginsCommand(program);
  registerLicensesCommand(program);
  return program;
}

function collectFlags(cmd: Command, into = new Set<string>()): Set<string> {
  for (const opt of cmd.options) {
    if (opt.long) into.add(opt.long);
    if (opt.negate && opt.long) into.add(opt.long);
  }
  for (const sub of cmd.commands) collectFlags(sub, into);
  return into;
}

function splitFrontmatter(raw: string): { fm: string; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, "SKILL.md must start with a YAML frontmatter block delimited by ---");
  return { fm: m[1], body: m[2] };
}

function topLevelField(fm: string, key: string): string | undefined {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m?.[1].trim();
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listSourceFiles(p)));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("agent skill: frontmatter follows the Agent Skills spec", async () => {
  const { fm } = splitFrontmatter(await readFile(SKILL_PATH, "utf-8"));

  const name = topLevelField(fm, "name");
  assert.ok(name, "frontmatter needs a name");
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, "name: lowercase letters, digits, single hyphens");
  assert.ok(name.length <= 64, "name: at most 64 characters");
  assert.equal(name, path.basename(SKILL_DIR), "name must match the skill's directory name");

  const description = topLevelField(fm, "description");
  assert.ok(description, "frontmatter needs a description");
  assert.ok(description.length <= 1024, `description is ${description.length} chars; the spec caps it at 1024`);

  const compatibility = topLevelField(fm, "compatibility");
  if (compatibility) assert.ok(compatibility.length <= 500, "compatibility: at most 500 characters");
});

test("agent skill: stays under the spec's recommended 500-line body", async () => {
  const lines = (await readFile(SKILL_PATH, "utf-8")).split("\n").length;
  assert.ok(lines < 500, `SKILL.md is ${lines} lines; move detail into references/`);
});

test("agent skill: every --flag it mentions is a real klaridian option", async () => {
  const { body } = splitFrontmatter(await readFile(SKILL_PATH, "utf-8"));
  const real = collectFlags(buildProgram());
  real.add("--help");
  real.add("--version");

  // `npm install --no-audit` style flags belong to other tools; the skill only
  // names klaridian's own flags, so every --flag in it must be real.
  const mentioned = new Set(body.match(/--[a-z][a-z0-9-]*/g) ?? []);
  assert.ok(mentioned.size > 10, "sanity: the skill should mention the flags it teaches");
  const unknown = [...mentioned].filter((f) => !real.has(f));
  assert.deepEqual(unknown, [], `SKILL.md mentions flags klaridian doesn't have: ${unknown.join(", ")}`);
});

test("agent skill: every error code it tells agents to branch on is real", async () => {
  const { body } = splitFrontmatter(await readFile(SKILL_PATH, "utf-8"));

  // Collect every stage string passed to fail(...) or StagedError across src/,
  // plus the generic "unexpected" fallback, and derive their codes the same
  // way the CLI does.
  const stages = new Set<string>(["unexpected"]);
  for (const file of await listSourceFiles(SRC_DIR)) {
    const src = await readFile(file, "utf-8");
    for (const m of src.matchAll(/"([a-z]+(?:-[a-z]+)+|emit)"\s*\)/g)) stages.add(m[1]);
  }
  const realCodes = new Set([...stages].map(stageToCode));

  const mentioned = new Set(body.match(/`([A-Z]+(?:_[A-Z]+)+|EMIT)`/g)?.map((s) => s.slice(1, -1)) ?? []);
  // Environment variables share the UPPER_SNAKE shape; they're checked below.
  const codes = [...mentioned].filter((c) => !c.startsWith("KLARIDIAN_"));
  assert.ok(codes.length >= 4, "sanity: the skill should document the error codes agents branch on");
  const unknown = codes.filter((c) => !realCodes.has(c));
  assert.deepEqual(unknown, [], `SKILL.md mentions error codes the CLI never emits: ${unknown.join(", ")}`);
});

test("agent skill: every KLARIDIAN_* environment variable it names is read by generated servers", async () => {
  const { body } = splitFrontmatter(await readFile(SKILL_PATH, "utf-8"));
  const mentioned = new Set(body.match(/KLARIDIAN_[A-Z_]+/g) ?? []);
  assert.ok(mentioned.size > 0, "sanity: the skill should name the auth env vars");

  let emitterSource = "";
  for (const file of await listSourceFiles(SRC_DIR)) emitterSource += await readFile(file, "utf-8");
  const unknown = [...mentioned].filter((v) => !emitterSource.includes(v));
  assert.deepEqual(unknown, [], `SKILL.md names env vars no emitter reads: ${unknown.join(", ")}`);
});
