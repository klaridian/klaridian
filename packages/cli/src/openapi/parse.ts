// packages/cli/src/openapi/parse.ts
//
// Loads and validates an OpenAPI spec (JSON or YAML, local file or URL).
// Uses @apidevtools/swagger-parser, which also fully dereferences $refs —
// meaning downstream code (map-tools.ts) never has to resolve $ref itself.

import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";

export type ParsedSpec = OpenAPIV3.Document | OpenAPIV3_1.Document;

export class OpenApiParseError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown
  ) {
    super(message);
    this.name = "OpenApiParseError";
  }
}

/**
 * Parses and fully dereferences an OpenAPI spec.
 *
 * Deliberately fails loudly (throws OpenApiParseError) rather than trying to
 * recover from a malformed spec — per ARCHITECTURE.md section 7: "fail
 * loudly on anything it can't confidently map, not silently generate broken
 * tools."
 */
export async function parseOpenApiSpec(specPath: string): Promise<ParsedSpec> {
  try {
    const api = await SwaggerParser.validate(specPath);
    return api as ParsedSpec;
  } catch (err) {
    throw new OpenApiParseError(
      `Failed to parse or validate OpenAPI spec at "${specPath}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      err
    );
  }
}

/** True if this looks like an OpenAPI 3.x document (v0 only supports 3.x, not Swagger 2.0). */
export function isOpenApi3(spec: ParsedSpec): boolean {
  return "openapi" in spec && typeof spec.openapi === "string" && spec.openapi.startsWith("3.");
}
