// packages/cli/src/spec/swagger2-conversion.ts
//
// MCPFO-27 / ARCHITECTURE.md section 36: transparent Swagger 2.0 -> OpenAPI
// 3.0 pre-conversion step. openapi-mcp-generator's getToolsFromOpenApi() only
// understands OpenAPI 3.x — handed a raw Swagger 2.0 (`swagger: "2.0"`)
// document, it silently produces tools with empty inputSchema.properties for
// every operation (ARCHITECTURE.md section 35's Slack-spec finding), rather
// than failing loudly. Section 36 validated the fix end to end: convert with
// swagger2openapi (Mermade/APIs.guru's converter, the de facto standard for
// this exact conversion) *before* handing the spec to openapi-mcp-generator,
// with zero klaridian generation-pipeline changes needed.
//
// Design, per section 36's "concrete shape for a real implementation":
// - Detect `swagger: "2.0"` (vs `openapi: "3.x"`) on the raw parsed document.
// - When detected, run it through swagger2openapi with `patch: true` (minor
//   spec non-compliance in the wild is common in Swagger 2.0 files per
//   swagger2openapi's own README, and `patch: true` auto-repairs rather than
//   hard-failing) and `warnOnly: true` (don't abort generation over lint
//   warnings that don't block conversion).
// - Surface the conversion step to the user (non-`--quiet`/`--json` callers
//   get a step() line) rather than silently swapping the input file — this
//   project's "fail loudly, don't guess" principle (AGENTS.md) extends to
//   "don't silently transform, don't guess" for user-visible input handling.
// - This is purely a pre-processing step ahead of the existing curation /
//   getToolsFromOpenApi() pipeline (generate.ts) — no changes to emit/* or
//   curation.ts, exactly as validated in section 36.

import convert from "swagger2openapi";
import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";

/** True when the parsed document is a Swagger 2.0 document (`swagger: "2.0"`), not OpenAPI 3.x. */
export function isSwagger2Document(doc: unknown): doc is OpenAPIV2.Document {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "swagger" in doc &&
    typeof (doc as { swagger?: unknown }).swagger === "string" &&
    (doc as { swagger: string }).swagger.startsWith("2.")
  );
}

export class Swagger2ConversionError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "Swagger2ConversionError";
  }
}

/**
 * Converts a parsed Swagger 2.0 document to OpenAPI 3.0 via swagger2openapi.
 * Throws Swagger2ConversionError (fail loudly, per AGENTS.md's discipline)
 * rather than returning a partially-converted or undefined result on error.
 */
export async function convertSwagger2ToOpenApi3(doc: OpenAPIV2.Document): Promise<OpenAPIV3.Document> {
  try {
    const options = await convert.convertObj(doc, { patch: true, warnOnly: true });
    const converted = options.openapi as OpenAPIV3.Document | undefined;
    if (!converted) {
      throw new Swagger2ConversionError(
        "swagger2openapi reported no error but returned no converted document — this shouldn't happen; please file an issue with the input spec."
      );
    }
    return converted;
  } catch (err) {
    if (err instanceof Swagger2ConversionError) throw err;
    throw new Swagger2ConversionError(
      `Failed to convert Swagger 2.0 spec to OpenAPI 3.0: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }
}
