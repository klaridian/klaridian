// packages/cli/src/commands/generate-helpers.ts
//
// Standalone helpers used by `generate.ts`, extracted so the command file
// itself stays focused on wiring the `klaridian generate` command together
// rather than also hosting general-purpose utilities. None of these close
// over command state — each is independently testable/reusable.

import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile } from "node:fs/promises";

/** Parses `--plugin-config otel.serviceName=foo` style flags into a nested map. */
export function parsePluginConfigFlags(flags: string[]): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const flag of flags) {
    const match = /^([^.]+)\.([^=]+)=(.*)$/.exec(flag);
    if (!match) {
      throw new Error(`Invalid --plugin-config value "${flag}", expected format: <pluginId>.<key>=<value>`);
    }
    const [, pluginId, key, value] = match;
    result[pluginId] ??= {};
    result[pluginId][key] = value;
  }
  return result;
}

/**
 * Resolves a default LICENSE copyright-holder name from local git config
 * (`git config user.name`), mirroring how most scaffolding tools (e.g.
 * `npm init`) pick a sensible default without requiring an explicit flag.
 * Returns undefined (never throws) if git isn't installed or unconfigured —
 * the caller falls back to a generic placeholder in that case.
 */
export async function resolveGitAuthorName(): Promise<string | undefined> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("git", ["config", "user.name"]);
    const name = stdout.trim();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Shape of the machine-readable summary printed to stdout when --json is
 * passed. On failure, `success: false` + `error` + `stage` (which step
 * failed) are set and everything else is omitted — deliberately a single,
 * predictable JSON value on stdout either way (never a mix of prose and
 * JSON), so a script/agent doing `klaridian generate --json ... | jq` always
 * gets exactly one parseable value regardless of outcome. Exit code (0/1)
 * still reflects success independent of this payload, so callers that only
 * check the exit code don't need to parse anything.
 */
export interface GenerateJsonResult {
  success: boolean;
  outputDir?: string;
  toolCount?: number;
  curatedFromTotal?: number | null;
  transport?: string;
  port?: number | null;
  architecture?: string;
  license?: string | null;
  plugins?: string[];
  nextSteps?: string;
  warnings?: string[];
  error?: string;
  stage?: string;
}

export async function directoryExistsAndIsNonEmpty(dir: string): Promise<{ exists: boolean; isDirectory: boolean; nonEmpty: boolean }> {
  const { stat, readdir } = await import("node:fs/promises");
  let st;
  try {
    st = await stat(dir);
  } catch {
    return { exists: false, isDirectory: false, nonEmpty: false };
  }
  if (!st.isDirectory()) {
    return { exists: true, isDirectory: false, nonEmpty: false };
  }
  const entries = await readdir(dir);
  return { exists: true, isDirectory: true, nonEmpty: entries.length > 0 };
}

/**
 * Writes a parsed spec document to a fresh temp file as JSON and returns its
 * path — the shared integration seam both the Swagger 2.0 pre-conversion
 * step and tool curation use to hand a modified in-memory document back to
 * getToolsFromOpenApi()/listOperations(), which only accept a file path, not
 * a parsed document (MCPFO-27, ARCHITECTURE.md section 24). The caller is
 * responsible for tracking the returned temp dir (pushed onto its own
 * cleanup list) and removing it once generation finishes — this helper only
 * creates it, it doesn't own its lifecycle.
 */
export async function writeTempSpec(doc: unknown, dirPrefix: string): Promise<{ dir: string; specPath: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), dirPrefix));
  const specPath = path.join(dir, "spec.json");
  await writeFile(specPath, JSON.stringify(doc), "utf-8");
  return { dir, specPath };
}
