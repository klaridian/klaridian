import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

// MCPFO-127: the klaridian Agent Skill lives ONCE, at the repo root
// (skills/klaridian/SKILL.md), where `npx skills add klaridian/klaridian`
// discovers it. The site serves those same bytes at build time (the routes
// using this are force-static) — never a copy, so the two can't drift.
// process.cwd() is packages/site during `next build`; same repo-root reach as
// scripts/generate-changelog.mjs does for CHANGELOG.md.
const SKILL_PATH = join(process.cwd(), "..", "..", "skills", "klaridian", "SKILL.md");

export const SKILL_NAME = "klaridian";
export const SKILL_URL = `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`;

export async function readSkill(): Promise<Buffer> {
  return readFile(/* turbopackIgnore: true */ SKILL_PATH);
}

export async function skillIndexEntry() {
  const bytes = await readSkill();
  const fm = bytes.toString("utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const description = fm.match(/^description:\s*(.+)$/m)?.[1].trim() ?? "";
  return {
    name: SKILL_NAME,
    type: "skill-md" as const,
    description,
    url: SKILL_URL,
    // Agent Skills discovery (v0.2.0): sha256 over the artifact's raw bytes.
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}
