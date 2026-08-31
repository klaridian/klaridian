// packages/cli/src/render/branding.ts
//
// Post-processes openapi-mcp-generator's generated server source to add
// optional cosmetic/branding metadata to the server's Implementation info
// (icons, websiteUrl, description) — the MCP spec's 2025-11-25 SEP-973
// addition. See ARCHITECTURE.md section 31.
//
// Unlike render/conformance.ts and render/security.ts, this patch is
// OPT-IN: it only touches generated source when the user actually passes
// --icon/--website/--server-description, since there's nothing to fix or
// hardened by default here — icons/websiteUrl are purely cosmetic and the
// spec defines no default, unlike the always-wrong-until-fixed conformance
// bugs or the always-desirable security hardening.
//
// Confirmed directly (not assumed) that no protocol-version patch is
// needed: @modelcontextprotocol/sdk's Server class already negotiates up
// to LATEST_PROTOCOL_VERSION ("2025-11-25" as of the installed 1.30.0)
// whenever the connecting client requests it — the generated code never
// hardcodes an older version, so icons/websiteUrl "just work" once present
// in the Implementation object, with zero changes needed to the
// initialize-request handling itself.

export class BrandingPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandingPatchError";
  }
}

export interface Icon {
  /** URL or data URI pointing to the icon image. */
  src: string;
  /** e.g. "image/png", "image/svg+xml". */
  mimeType?: string;
  /** e.g. ["48x48"], ["any"] (SVG). */
  sizes?: string[];
  /** Which UI theme this icon variant is designed for. */
  theme?: "light" | "dark";
}

export interface BrandingOptions {
  icons?: Icon[];
  websiteUrl?: string;
  description?: string;
}

const SERVER_CONSTRUCTION_CALL_SITE = [
  "const server = new Server(",
  "    { name: SERVER_NAME, version: SERVER_VERSION },",
  "    { capabilities: { tools: {} } }",
  ");",
].join("\n");

/**
 * Patches the generated server's `new Server(...)` call to include
 * cosmetic Implementation metadata (icons, websiteUrl, description) per
 * MCP spec 2025-11-25 (SEP-973). Only called when at least one branding
 * option was actually provided — see commands/generate.ts, which skips
 * calling this entirely otherwise (no-op by omission, not by an internal
 * early-return, so a caller can't accidentally invoke this with nothing to
 * do and get a silently-unchanged file back).
 *
 * Fails loudly if the expected call site isn't found verbatim, same
 * discipline as every other render/*.ts patch in this project.
 */
export function applyBranding(serverSource: string, options: BrandingOptions): string {
  if (!serverSource.includes(SERVER_CONSTRUCTION_CALL_SITE)) {
    throw new BrandingPatchError(
      `Could not find the expected "new Server(...)" call site in the generated server source. ` +
        `This likely means openapi-mcp-generator's generated code shape changed — check its version ` +
        `and update applyBranding() accordingly. The server was NOT patched with branding metadata.`
    );
  }

  const fields: string[] = [];
  if (options.icons && options.icons.length > 0) {
    fields.push(`icons: ${JSON.stringify(options.icons)}`);
  }
  if (options.websiteUrl) {
    fields.push(`websiteUrl: ${JSON.stringify(options.websiteUrl)}`);
  }
  if (options.description) {
    fields.push(`description: ${JSON.stringify(options.description)}`);
  }

  const replacement = [
    "const server = new Server(",
    "    {",
    "        name: SERVER_NAME,",
    "        version: SERVER_VERSION,",
    ...fields.map((f) => `        ${f},`),
    "    },",
    "    { capabilities: { tools: {} } }",
    ");",
  ].join("\n");

  return serverSource.replace(SERVER_CONSTRUCTION_CALL_SITE, replacement);
}
