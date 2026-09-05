// packages/cli/src/config/config-file.ts
//
// MCPFO-37 / ARCHITECTURE.md section 52: an optional config file that
// supplies DEFAULT values for `klaridian generate`'s flags. It is a
// defaults layer, never a source of truth — an explicit flag on the
// command line always wins over the file, and the file always wins over
// the command's hardcoded default. The merge itself (using commander's own
// per-option "where did this value come from" tracking) lives in
// generate.ts; this module only finds, reads, and parses the file.

import { readFile } from "node:fs/promises";
import path from "node:path";

/** File name auto-discovered in the current working directory when --config isn't passed. */
export const CONFIG_FILE_NAME = "klaridian.config.json";

/** Thrown when an explicit --config path is missing or isn't valid JSON — never on auto-discovery. */
export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigFileError";
  }
}

/**
 * Loads the klaridian config file, if there is one.
 *
 * - `explicitPath` given (from --config): the file MUST exist and MUST be a
 *   JSON object — anything else throws `ConfigFileError` (with the path), so
 *   a typo'd --config never silently generates with the wrong defaults.
 * - `explicitPath` omitted: look for `klaridian.config.json` in
 *   `process.cwd()`. Absent is not an error (returns undefined) — most runs
 *   won't have one. A file that exists but is malformed still throws, since
 *   at that point the user clearly meant for it to be used.
 *
 * The returned `config` object's keys are commander's camelCase option
 * attribute names (`baseUrl`, `pluginConfig`, `oauthIssuer`, ...), i.e. the
 * same shape as the `opts` object in generate.ts's `.action()` callback.
 * Key validation (warn on unknown keys) happens in generate.ts, which has
 * the live Command to check names against and the `warn()` helper.
 */
export async function loadConfigFile(
  explicitPath?: string
): Promise<{ path: string; config: Record<string, unknown> } | undefined> {
  const resolvedPath = explicitPath
    ? path.resolve(explicitPath)
    : path.join(process.cwd(), CONFIG_FILE_NAME);

  let raw: string;
  try {
    raw = await readFile(resolvedPath, "utf-8");
  } catch (err) {
    if (!explicitPath && (err as NodeJS.ErrnoException).code === "ENOENT") {
      // Auto-discovery: no file in cwd is the common case, not a problem.
      return undefined;
    }
    throw new ConfigFileError(
      `Could not read config file "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigFileError(
      `Config file "${resolvedPath}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigFileError(
      `Config file "${resolvedPath}" must contain a JSON object mapping flag names to default values (got ${
        Array.isArray(parsed) ? "an array" : parsed === null ? "null" : typeof parsed
      }).`
    );
  }

  return { path: resolvedPath, config: parsed as Record<string, unknown> };
}
