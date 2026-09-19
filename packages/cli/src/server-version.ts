// packages/cli/src/server-version.ts
//
// MCPFO-107 (ARCHITECTURE.md §97) — resolve the VERSION stamped onto a
// generated MCP server. "Derive, don't duplicate": the version is not invented,
// it comes from a single source with a clear precedence, and it is validated as
// SemVer before it can reach the generated project. This is the same discipline
// as `--version` (reads package.json), `cli-reference.mdx` (generated), and
// `CHANGELOG.md` (single source) — a value the user sees must be derived and
// checked, never hardcoded per-emit-site.
//
// Why SemVer is enforced, not just recommended: the official MCP Registry parses
// server.json's `version` as SemVer to sort releases and mark one "latest". A
// value that fails to parse is ALWAYS marked latest, so a single non-semver
// version silently sinks every real one. klaridian therefore fails loudly at
// generation time rather than emit a version the registry would mishandle — the
// emitter's "fail loudly, don't guess" rule applied to versioning.

/** The version stamped when nothing else supplies one (fresh, unversioned spec). */
export const DEFAULT_SERVER_VERSION = "1.0.0";

// SemVer 2.0.0 core + optional prerelease/build, anchored. Deliberately rejects
// ranges (^, ~, >=, 1.2.*, 1 - 2) and a leading `v`, which the MCP Registry also
// rejects — a concrete, publishable version only.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** True if `v` is a valid concrete SemVer 2.0.0 string (no ranges, no `v` prefix). */
export function isSemver(v: string): boolean {
  return typeof v === "string" && SEMVER_RE.test(v.trim());
}

export type ServerVersionResolution =
  | { ok: true; version: string; source: "flag" | "spec" | "default" }
  | { ok: false; reason: string };

/**
 * Resolve the generated server's version, mirroring `generate`'s established
 * precedence layer: an explicit flag wins over the spec, which wins over the
 * built-in default.
 *
 *   --server-version (flag)  >  spec info.version  >  DEFAULT_SERVER_VERSION
 *
 * A non-semver flag or a non-semver spec version is a hard error (returned as
 * `{ ok: false }` for the caller to `fail()` on), never a silent fallback: a
 * spec that versions itself as "2" or a date must be resolved explicitly by the
 * author rather than have klaridian guess or bury the intent under 1.0.0.
 */
export function resolveServerVersion(input: {
  override?: string;
  specVersion?: string;
}): ServerVersionResolution {
  const override = input.override?.trim();
  if (override) {
    if (!isSemver(override)) {
      return {
        ok: false,
        reason:
          `--server-version "${override}" is not a valid semantic version (for example 1.2.3). ` +
          `The MCP Registry requires a concrete SemVer string and rejects ranges (^, ~, >=, 1.2.*).`,
      };
    }
    return { ok: true, version: override, source: "flag" };
  }
  const specVersion = input.specVersion?.trim();
  if (specVersion) {
    if (!isSemver(specVersion)) {
      return {
        ok: false,
        reason:
          `The spec's info.version "${specVersion}" is not a valid semantic version. ` +
          `The MCP Registry parses versions as SemVer and marks any unparseable version "latest", ` +
          `so klaridian won't emit it silently. Pass --server-version <x.y.z> to set the generated ` +
          `server's version explicitly.`,
      };
    }
    return { ok: true, version: specVersion, source: "spec" };
  }
  return { ok: true, version: DEFAULT_SERVER_VERSION, source: "default" };
}
