// packages/cli/src/commands/generate-helpers.ts
//
// Standalone helpers used by `generate.ts`, extracted so the command file
// itself stays focused on wiring the `klaridian generate` command together
// rather than also hosting general-purpose utilities. None of these close
// over command state — each is independently testable/reusable.

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

/** Infers an icon's MIME type from its URL/path extension, for the common formats. Returns undefined if unrecognized (the field is optional per spec). */
export function inferIconMimeType(src: string): string | undefined {
  const ext = src.split(".").pop()?.toLowerCase().split(/[?#]/)[0];
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "ico":
      return "image/x-icon";
    default:
      return undefined;
  }
}

/**
 * Runs `fn` with `console.log`/`console.warn`/`console.error` temporarily
 * replaced with no-ops, restoring the originals in a `finally` no matter
 * how `fn` exits (including throwing). Workaround for a real, upstream gap
 * (ARCHITECTURE.md section 33): `openapi-mcp-generator`'s `generateMcpServer()`
 * writes ~20 lines of its own hardcoded progress text directly to
 * `console.error`/`console.warn` with no verbosity/logger option exposed in
 * its public API to control it — confirmed directly by reading its source,
 * not assumed. This is the only available lever klaridian has to honor its
 * own `--quiet`/`--json` contracts without a fork or an upstream fix.
 *
 * Deliberately scoped as tightly as possible around the single call site
 * that needs it (`generateMcpServer()`) rather than applied globally for
 * the whole command — anything klaridian's own code logs during that same
 * window (there is none today, but this guards against a future regression)
 * would also be silenced otherwise, which isn't the intent.
 */
export async function withConsoleSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const noop = () => {};
  console.log = noop;
  console.warn = noop;
  console.error = noop;
  try {
    return await fn();
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
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
  license?: string | null;
  plugins?: string[];
  branding?: { icons: number; website: boolean; description: boolean } | null;
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
