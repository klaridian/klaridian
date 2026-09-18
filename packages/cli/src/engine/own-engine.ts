// packages/cli/src/engine/own-engine.ts
//
// MCPFO-73/74 — IR ownership: klaridian's OWN OpenAPI-operation → tool-DATA
// engine. As of the Phase 3 cutover (MCPFO-74, ARCHITECTURE.md §92) this is the
// ONLY engine klaridian uses; the openapi-mcp-generator dependency was removed.
//
// This owns the ONE part that is genuinely ours to own — the
// operation → tool-DATA mapping — while DELEGATING the hard, mature bits:
//
//   OWNED here (this file):
//     - operation → { name, description, method, pathTemplate, inputSchema,
//       parameters, executionParameters, requestBodyContentType,
//       securityRequirements, operationId, tags, deprecated }
//     - the input-schema assembly (path/query/header params → properties,
//       requestBody → properties.requestBody), the OpenAPI→JSON-Schema field
//       scrubbing, and the exact tool-name derivation (operationId fallback,
//       sanitize, abbreviate/hash-truncate, collision resolution).
//
//   DELEGATED (unchanged, mature libraries):
//     - $ref dereference + JSON-Schema validation → @apidevtools/swagger-parser
//     - Swagger 2.0 → OpenAPI 3.0 conversion → the repo's existing
//       src/spec/swagger2-conversion.ts (which itself wraps swagger2openapi).
//       Callers convert BEFORE calling this engine (same as the default path),
//       so this engine only ever sees an OpenAPI 3.x document.
//
// PARITY CONTRACT: `getToolsFromOwnEngine()` returns objects structurally
// identical to what `openapi-mcp-generator`'s `getToolsFromOpenApi()` returns
// (the `McpToolDefinition` shape, including `baseUrl`), so the SAME
// `mapMcpToolDefinitionToIR()` adapter and the SAME downstream pipeline consume
// it with ZERO changes. Proven by `test/own-engine-parity.test.ts`, which runs
// this engine over the Phase-1 corpus and deep-equals the committed goldens.
//
// The algorithms below are a faithful, intentional re-implementation of
// `openapi-mcp-generator@4.0.1`'s `dist/parser/extract-tools.js` +
// `dist/utils/code-gen.js` (generateOperationId) + `dist/utils/url.js`
// (determineBaseUrl). Comments cite the mirrored behavior; the goldens are the
// byte-for-byte test of that faithfulness. Parity against that (now-removed)
// dependency was proven across the golden corpus (MCPFO-72) and 6 large real
// specs (MCPFO-104, §90/§91) before the Phase 3 cutover (MCPFO-74, §92).

import { createHash } from "node:crypto";
import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPIV3 } from "openapi-types";
import type { JSONSchema7 } from "json-schema";
import type { McpToolDefinitionLike } from "../emit/ir.js";

/** The engine's per-tool output. Superset of `McpToolDefinitionLike` (adds the
 *  engine-only `parameters` + `baseUrl` that `getToolsFromOpenApi` also carries)
 *  so it is a drop-in for the default engine's return value. */
export interface OwnEngineToolDefinition extends McpToolDefinitionLike {
  /** Full OpenAPI parameter objects for the operation (path-level merged with
   *  operation-level), as the default engine also returns. */
  parameters: OpenAPIV3.ParameterObject[];
  /** Resolved upstream base URL (spec `servers` or the caller override), as the
   *  default engine attaches to every tool. */
  baseUrl: string;
  /** The engine ALWAYS produces these (narrowed from `McpToolDefinitionLike`'s
   *  optional shape), so `OwnEngineToolDefinition[]` is assignable to `ToolIR[]`
   *  directly — the E2E tests feed raw engine output to the emitters unmapped. */
  executionParameters: { name: string; in: string }[];
  securityRequirements: OpenAPIV3.SecurityRequirementObject[];
}

export interface GetToolsFromOwnEngineOptions {
  /** Fully dereference the spec via swagger-parser before mapping. Matches the
   *  default engine's `{ dereference: true }`; the pipeline always passes this. */
  dereference?: boolean;
  /** Optional base-url override (CLI `--base-url`), same precedence as upstream. */
  baseUrl?: string;
  /** Max tool-name length (Claude Desktop's 64 limit). Mirrors upstream default. */
  maxToolNameLength?: number;
  /** Default x-mcp include behavior when the extension is absent. Default true. */
  defaultInclude?: boolean;
}

// ---------------------------------------------------------------------------
// Tool-name derivation (mirrors extract-tools.js + code-gen.js exactly).
// ---------------------------------------------------------------------------

/** Default maximum tool name length (Claude Desktop limit). */
const DEFAULT_MAX_TOOL_NAME_LENGTH = 64;
/** Smallest tool-name length that still guarantees collision-resolution progress. */
const MIN_TOOL_NAME_LENGTH = 8;
/** Length of the deterministic hex hash segment appended for uniqueness. */
const HASH_LEN = 6;
/** Marker inserted where the middle of a name is elided: `head__tail`. */
const ELISION_MARKER = "__";
/** Fraction of the head/tail budget given to the head. */
const HEAD_RATIO = 0.6;
/** Words this length or shorter are kept intact during abbreviation. */
const SHORT_WORD_MAX = 3;
/** Longer words are abbreviated to this many leading characters. */
const ABBREV_WORD_LEN = 4;

/** Convert a string to title case (mirrors code-gen.js `titleCase`). */
function titleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[-_/](.)/g, (_, char: string) => char.toUpperCase())
    .replace(/^{/, "")
    .replace(/}$/, "")
    .replace(/^./, (char) => char.toUpperCase());
}

/** Generate an operationId from method + path (mirrors code-gen.js). */
function generateOperationId(method: string, path: string): string {
  const parts = path.split("/").filter((p) => p);
  let name = method.toLowerCase();
  parts.forEach((part, index) => {
    if (part.startsWith("{") && part.endsWith("}")) {
      if (index === parts.length - 1) {
        name += "By" + titleCase(part);
      }
    } else {
      name += titleCase(part);
    }
  });
  if (name === method.toLowerCase()) {
    name += "Root";
  }
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return name;
}

/** Split a tool name into words on `_`/`-` and camelCase humps. */
function splitNameIntoWords(name: string): string[] {
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .flatMap(
      (segment) =>
        segment.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g) ?? [segment]
    );
}

/** Abbreviate a tool name word-by-word (keeps the first word intact). */
function abbreviateToolName(name: string): string {
  const words = splitNameIntoWords(name);
  if (words.length <= 1) return name;
  return words
    .map((word, i) => {
      if (i === 0) return word;
      if (word.length <= SHORT_WORD_MAX) return word;
      return word.slice(0, ABBREV_WORD_LEN);
    })
    .join("_");
}

/** Truncate "Start…End" style with a stable hash suffix (mirrors upstream). */
function truncateToolName(name: string, maxLength: number): string {
  if (maxLength <= 0 || name.length <= maxLength) return name;
  const hash = createHash("sha1").update(name).digest("hex").slice(0, HASH_LEN);
  const hashSuffix = `_${hash}`;
  const nameBudget = maxLength - hashSuffix.length;
  const headTailBudget = nameBudget - ELISION_MARKER.length;
  if (headTailBudget < 4) {
    const headLength = Math.max(1, nameBudget);
    return `${name.slice(0, headLength)}${hashSuffix}`.slice(0, maxLength);
  }
  const headLength = Math.ceil(headTailBudget * HEAD_RATIO);
  const tailLength = headTailBudget - headLength;
  const head = name.slice(0, headLength);
  const tail = tailLength > 0 ? name.slice(name.length - tailLength) : "";
  return `${head}${ELISION_MARKER}${tail}${hashSuffix}`.slice(0, maxLength);
}

/** Produce an MCP-compliant tool name within `maxLength` (mirrors upstream). */
function shortenToolName(name: string, maxLength: number): string {
  if (maxLength <= 0 || name.length <= maxLength) return name;
  const abbreviated = abbreviateToolName(name);
  if (abbreviated.length <= maxLength && abbreviated !== name) {
    return abbreviated;
  }
  return truncateToolName(abbreviated.length < name.length ? abbreviated : name, maxLength);
}

// ---------------------------------------------------------------------------
// x-mcp include/exclude filtering (mirrors helpers.js).
// ---------------------------------------------------------------------------

/** Normalize a value to boolean if booleanish; otherwise undefined. */
function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(v)) return true;
    if (["false", "0", "no", "off"].includes(v)) return false;
  }
  return undefined;
}

/** x-mcp inclusion decision, precedence operation > path > root (mirrors upstream). */
function shouldIncludeOperationForMcp(
  api: Record<string, unknown>,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
  defaultInclude: boolean
): boolean {
  const opVal = normalizeBoolean(operation["x-mcp"]);
  if (typeof opVal !== "undefined") return opVal;
  const pathVal = normalizeBoolean(pathItem["x-mcp"]);
  if (typeof pathVal !== "undefined") return pathVal;
  const rootVal = normalizeBoolean(api["x-mcp"]);
  if (typeof rootVal !== "undefined") return rootVal;
  return defaultInclude;
}

// ---------------------------------------------------------------------------
// Schema mapping + input-schema assembly (mirrors extract-tools.js).
// ---------------------------------------------------------------------------

/** Map an OpenAPI schema to a JSON Schema with cycle protection (mirrors upstream). */
function mapOpenApiSchemaToJsonSchema(
  schema: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (schema && typeof schema === "object" && "$ref" in (schema as object)) {
    // Should not occur after dereference; mirror upstream's defensive fallback.
    console.warn(`Unresolved $ref '${(schema as { $ref: string }).$ref}'.`);
    return { type: "object" };
  }
  if (typeof schema === "boolean") return schema;
  if (!schema || typeof schema !== "object") return schema;
  const obj = schema as Record<string, unknown>;
  if (seen.has(obj)) {
    console.warn(
      `Cycle detected in schema${obj.title ? ` "${String(obj.title)}"` : ""}, returning generic object to break recursion.`
    );
    return { type: "object" };
  }
  seen.add(obj);
  try {
    const jsonSchema: Record<string, unknown> = { ...obj };
    if (obj.type === "integer") jsonSchema.type = "number";
    delete jsonSchema.nullable;
    delete jsonSchema.example;
    delete jsonSchema.xml;
    delete jsonSchema.externalDocs;
    delete jsonSchema.deprecated;
    delete jsonSchema.readOnly;
    delete jsonSchema.writeOnly;
    if (obj.nullable) {
      if (Array.isArray(jsonSchema.type)) {
        if (!(jsonSchema.type as unknown[]).includes("null")) {
          (jsonSchema.type as unknown[]).push("null");
        }
      } else if (typeof jsonSchema.type === "string") {
        jsonSchema.type = [jsonSchema.type, "null"];
      } else if (!jsonSchema.type) {
        jsonSchema.type = "null";
      }
    }
    if (jsonSchema.type === "object" && jsonSchema.properties) {
      const mappedProps: Record<string, unknown> = {};
      for (const [key, propSchema] of Object.entries(
        jsonSchema.properties as Record<string, unknown>
      )) {
        if (typeof propSchema === "object" && propSchema !== null) {
          mappedProps[key] = mapOpenApiSchemaToJsonSchema(propSchema, seen);
        } else if (typeof propSchema === "boolean") {
          mappedProps[key] = propSchema;
        }
      }
      jsonSchema.properties = mappedProps;
    }
    if (
      jsonSchema.type === "array" &&
      typeof jsonSchema.items === "object" &&
      jsonSchema.items !== null
    ) {
      jsonSchema.items = mapOpenApiSchemaToJsonSchema(jsonSchema.items, seen);
    }
    return jsonSchema;
  } finally {
    seen.delete(obj);
  }
}

interface InputSchemaResult {
  inputSchema: JSONSchema7 | boolean;
  parameters: OpenAPIV3.ParameterObject[];
  requestBodyContentType: string | undefined;
}

/** Build the input schema + parameter details for an operation (mirrors upstream). */
function generateInputSchemaAndDetails(
  operation: OpenAPIV3.OperationObject,
  pathParameters: unknown
): InputSchemaResult {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  const operationParameters = Array.isArray(operation.parameters)
    ? (operation.parameters as OpenAPIV3.ParameterObject[])
    : [];
  const pathParametersResolved = Array.isArray(pathParameters)
    ? (pathParameters as OpenAPIV3.ParameterObject[])
    : [];

  // Merge path-level and operation-level params; operation overrides on name+in.
  const allParameters: OpenAPIV3.ParameterObject[] = [];
  pathParametersResolved.concat(operationParameters).forEach((param) => {
    const existingIndex = allParameters.findIndex(
      (p) => p.name === param.name && p.in === param.in
    );
    if (existingIndex >= 0) {
      allParameters[existingIndex] = param;
    } else {
      allParameters.push(param);
    }
  });

  allParameters.forEach((param) => {
    if (!param.name || !param.schema) return;
    const paramSchema = mapOpenApiSchemaToJsonSchema(param.schema);
    if (paramSchema && typeof paramSchema === "object") {
      (paramSchema as Record<string, unknown>).description =
        param.description || (paramSchema as Record<string, unknown>).description;
    }
    properties[param.name] = paramSchema;
    if (param.required) required.push(param.name);
  });

  let requestBodyContentType: string | undefined = undefined;
  if (operation.requestBody) {
    const opRequestBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
    const jsonContent = opRequestBody.content?.["application/json"];
    const firstContent = opRequestBody.content
      ? Object.entries(opRequestBody.content)[0]
      : undefined;
    if (jsonContent?.schema) {
      requestBodyContentType = "application/json";
      const bodySchema = mapOpenApiSchemaToJsonSchema(jsonContent.schema);
      if (bodySchema && typeof bodySchema === "object") {
        (bodySchema as Record<string, unknown>).description =
          opRequestBody.description ||
          (bodySchema as Record<string, unknown>).description ||
          "The JSON request body.";
      }
      properties["requestBody"] = bodySchema;
      if (opRequestBody.required) required.push("requestBody");
    } else if (firstContent) {
      const [contentType] = firstContent;
      requestBodyContentType = contentType;
      properties["requestBody"] = {
        type: "string",
        description:
          opRequestBody.description || `Request body (content type: ${contentType})`,
      };
      if (opRequestBody.required) required.push("requestBody");
    }
  }

  const inputSchema = {
    type: "object",
    properties,
    ...(required.length > 0 && { required }),
  } as unknown as JSONSchema7;

  return { inputSchema, parameters: allParameters, requestBodyContentType };
}

// ---------------------------------------------------------------------------
// Base URL (mirrors url.js determineBaseUrl).
// ---------------------------------------------------------------------------

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function determineBaseUrl(
  api: OpenAPIV3.Document,
  cmdLineBaseUrl?: string
): string | null {
  if (cmdLineBaseUrl) return normalizeUrl(cmdLineBaseUrl);
  const servers = api.servers;
  if (servers && servers.length === 1 && servers[0].url) return normalizeUrl(servers[0].url);
  if (servers && servers.length > 1) {
    console.warn(
      `Multiple servers found. Using first: "${servers[0].url}". Use --base-url to override.`
    );
    return normalizeUrl(servers[0].url);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool extraction (mirrors extract-tools.js extractToolsFromApi).
// ---------------------------------------------------------------------------

function extractToolsFromApi(
  api: OpenAPIV3.Document,
  defaultInclude: boolean,
  maxToolNameLength: number
): OwnEngineToolDefinition[] {
  if (maxToolNameLength < MIN_TOOL_NAME_LENGTH) {
    console.warn(
      `maxToolNameLength=${maxToolNameLength} is too small; using ${MIN_TOOL_NAME_LENGTH} to keep tool names unique.`
    );
    maxToolNameLength = MIN_TOOL_NAME_LENGTH;
  }
  const tools: OwnEngineToolDefinition[] = [];
  const usedNames = new Set<string>();
  const globalSecurity = api.security || [];
  if (!api.paths) return tools;

  for (const [path, pathItem] of Object.entries(api.paths)) {
    if (!pathItem) continue;
    for (const method of Object.values(OpenAPIV3.HttpMethods)) {
      const operation = (pathItem as Record<string, unknown>)[method] as
        | OpenAPIV3.OperationObject
        | undefined;
      if (!operation) continue;

      // x-mcp filtering, precedence operation > path > root.
      if (
        !shouldIncludeOperationForMcp(
          api as unknown as Record<string, unknown>,
          pathItem as unknown as Record<string, unknown>,
          operation as unknown as Record<string, unknown>,
          defaultInclude
        )
      ) {
        continue;
      }

      const originalOperationId =
        operation.operationId || generateOperationId(method, path);
      if (!originalOperationId) continue;

      // Sanitize to MCP-compatible (a-z, 0-9, _, -).
      const sanitized = originalOperationId
        .replace(/\./g, "_")
        .replace(/[^a-z0-9_-]/gi, "_");
      const baseName = shortenToolName(sanitized, maxToolNameLength);

      // Deterministic collision resolution via content hash (order-independent).
      let finalToolName = baseName;
      let attempt = 0;
      while (usedNames.has(finalToolName)) {
        const disambiguator = createHash("sha1")
          .update(`${sanitized}#${attempt++}`)
          .digest("hex")
          .slice(0, HASH_LEN);
        const suffix = `_${disambiguator}`;
        const headRoom = Math.max(1, maxToolNameLength - suffix.length);
        finalToolName = `${baseName.slice(0, headRoom)}${suffix}`;
      }
      usedNames.add(finalToolName);

      const description =
        operation.description ||
        operation.summary ||
        `Executes ${method.toUpperCase()} ${path}`;

      const { inputSchema, parameters, requestBodyContentType } =
        generateInputSchemaAndDetails(
          operation,
          (pathItem as OpenAPIV3.PathItemObject).parameters
        );

      const executionParameters = parameters.map((p) => ({ name: p.name, in: p.in }));

      const securityRequirements =
        operation.security === null
          ? globalSecurity
          : operation.security || globalSecurity;

      const tags = Array.isArray(operation.tags)
        ? operation.tags.filter(Boolean)
        : [];
      const deprecated = operation.deprecated === true;

      tools.push({
        name: finalToolName,
        description,
        inputSchema,
        method,
        pathTemplate: path,
        parameters,
        executionParameters,
        requestBodyContentType,
        securityRequirements,
        operationId: originalOperationId,
        tags,
        deprecated,
        baseUrl: "",
      });
    }
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * klaridian's own spec → tool-DATA engine (MCPFO-73, shadow mode).
 *
 * Drop-in replacement for `openapi-mcp-generator`'s `getToolsFromOpenApi()`:
 * accepts a spec file path (an OpenAPI 3.x document — Swagger 2.0 is converted
 * by the caller first, exactly as the default path does), delegates $ref
 * dereference + validation to `@apidevtools/swagger-parser`, then applies
 * klaridian's owned operation → tool-DATA mapping. Returns the same
 * `McpToolDefinition`-shaped objects the default engine returns, so the rest of
 * the pipeline (the `mapMcpToolDefinitionToIR` adapter + every emitter) consumes
 * it unchanged.
 *
 * OFF by default — only reached when a caller explicitly selects this engine
 * (see `isOwnEngineSelected`). Parity with the default engine is proven against
 * the committed Phase-1 golden corpus in `test/own-engine-parity.test.ts`.
 */
export async function getToolsFromOwnEngine(
  specPathOrUrl: string,
  options: GetToolsFromOwnEngineOptions = {}
): Promise<OwnEngineToolDefinition[]> {
  try {
    // DELEGATED: parse + $ref dereference + validation via swagger-parser.
    // `dereference` bundles+resolves+validates; we default to it because the
    // pipeline always passes { dereference: true } and the owned mapping below
    // assumes resolved schemas (matching the default engine's contract).
    const api = (
      options.dereference === false
        ? await SwaggerParser.parse(specPathOrUrl)
        : await SwaggerParser.dereference(specPathOrUrl)
    ) as OpenAPIV3.Document;

    const tools = extractToolsFromApi(
      api,
      options.defaultInclude ?? true,
      options.maxToolNameLength ?? DEFAULT_MAX_TOOL_NAME_LENGTH
    );

    const baseUrl = determineBaseUrl(api, options.baseUrl);
    return tools.map((tool) => ({ ...tool, baseUrl: baseUrl || "" }));
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to extract tools from OpenAPI: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
}
