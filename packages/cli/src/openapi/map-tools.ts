// packages/cli/src/openapi/map-tools.ts
//
// Maps a parsed (and fully dereferenced) OpenAPI document into the internal
// ToolDefinition model. This is the trickiest logic in the generator per
// ARCHITECTURE.md section 7 — real design judgment, not just plumbing.
//
// Guiding rule (ARCHITECTURE.md section 7 + 8): fail loudly / skip-with-error
// on anything we can't confidently map. Never guess and generate a broken
// tool silently.

import type { OpenAPIV3 } from "openapi-types";
import type { ParsedSpec } from "./parse.js";
import type {
  AuthScheme,
  HttpMethod,
  JsonSchemaObject,
  MappingError,
  MappingResult,
  MappingWarning,
  ToolDefinition,
  ToolParameter,
} from "./types.js";

const SUPPORTED_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete"];

/** Converts an OpenAPI operationId (or a path+method fallback) into a valid MCP tool name. */
function toToolName(
  operationId: string | undefined,
  path: string,
  method: HttpMethod
): { name: string; warning?: string } {
  if (operationId && /^[A-Za-z_][A-Za-z0-9_]*$/.test(operationId)) {
    return { name: operationId };
  }

  // Fallback: derive from method + path, e.g. GET /pet/{petId} -> get_pet_petId
  const derived = `${method}_${path}`
    .replace(/[{}]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const warning = operationId
    ? `operationId "${operationId}" is not a valid tool identifier; derived "${derived}" instead.`
    : `Operation has no operationId; derived name "${derived}" from path and method. Consider adding an explicit operationId to the spec for a stabler tool name.`;

  return { name: derived, warning };
}

/** Converts an OpenAPI parameter's schema into our internal JsonSchemaObject shape. */
function convertParamSchema(
  param: OpenAPIV3.ParameterObject
): JsonSchemaObject {
  const rawSchema = (param.schema ?? {}) as OpenAPIV3.SchemaObject;
  const schema = "allOf" in rawSchema && rawSchema.allOf ? mergeAllOf(rawSchema) : rawSchema;
  const items = "items" in schema ? (schema as { items?: OpenAPIV3.SchemaObject }).items : undefined;
  return {
    type: schema.type ?? "string",
    description: param.description ?? schema.description,
    enum: schema.enum,
    format: schema.format,
    items: items ? convertSchemaObject(items) : undefined,
  };
}

/**
 * Merges an `allOf` schema's sibling subschemas into a single flat schema.
 *
 * Unlike `oneOf`/`anyOf` (genuinely ambiguous — which branch does a single
 * flat MCP `inputSchema` represent?), `allOf` is a deterministic
 * intersection: every subschema must hold simultaneously, so merging
 * `properties` (later subschemas win on key collision) and unioning
 * `required` arrays is a faithful, general-purpose translation — not a
 * spec-specific patch. This directly addresses the highest-impact real-world
 * finding from ARCHITECTURE.md section 14 (Wavix's spec uses `allOf` 151
 * times, `oneOf`/`anyOf` combined only 19 times).
 *
 * Recurses so nested `allOf` (an `allOf` member that itself has `allOf`) is
 * also flattened. A subschema that uses `oneOf`/`anyOf` internally is left
 * as-is here — detectUnsupportedSchemaFeatures still catches that case on
 * the merged result, since merging doesn't make a nested oneOf/anyOf any
 * less ambiguous.
 */
function mergeAllOf(schema: OpenAPIV3.SchemaObject): OpenAPIV3.SchemaObject {
  if (!("allOf" in schema) || !schema.allOf) {
    return schema;
  }

  const merged: Record<string, unknown> = { properties: {} };
  const requiredSet = new Set<string>();

  const subschemas = [...schema.allOf] as OpenAPIV3.SchemaObject[];
  // Sibling keys alongside `allOf` (e.g. an explicit `required` at the same
  // level) apply too, per the JSON Schema spec — include the outer schema's
  // own properties/required as one more subschema to merge, after allOf's
  // members so we don't discard them below.
  const { allOf: _allOf, ...ownSchema } = schema;
  subschemas.push(ownSchema as OpenAPIV3.SchemaObject);

  for (let sub of subschemas) {
    sub = "allOf" in sub && sub.allOf ? mergeAllOf(sub) : sub;

    if (sub.type && sub.type !== "object" && !merged.type) {
      merged.type = sub.type;
    }
    if (sub.description && !merged.description) {
      merged.description = sub.description;
    }
    if ("properties" in sub && sub.properties) {
      merged.properties = { ...(merged.properties as object), ...sub.properties };
    }
    if ("required" in sub && Array.isArray(sub.required)) {
      for (const key of sub.required) requiredSet.add(key);
    }
    // Preserve oneOf/anyOf found in any branch rather than silently dropping
    // them — merging must not hide genuine ambiguity from
    // detectUnsupportedSchemaFeatures, which inspects the merged result.
    if ("oneOf" in sub && sub.oneOf) {
      merged.oneOf = sub.oneOf;
    }
    if ("anyOf" in sub && sub.anyOf) {
      merged.anyOf = sub.anyOf;
    }
  }

  merged.type = merged.type ?? "object";
  if (requiredSet.size > 0) {
    merged.required = [...requiredSet];
  } else {
    delete merged.required;
  }
  if (merged.properties && Object.keys(merged.properties as object).length === 0) {
    delete merged.properties;
  }

  return merged as OpenAPIV3.SchemaObject;
}

/** Recursively converts an OpenAPI SchemaObject into our internal JsonSchemaObject shape. */
function convertSchemaObject(rawSchema: OpenAPIV3.SchemaObject): JsonSchemaObject {
  const schema = "allOf" in rawSchema && rawSchema.allOf ? mergeAllOf(rawSchema) : rawSchema;
  const result: JsonSchemaObject = {
    type: schema.type,
    description: schema.description,
    enum: schema.enum,
    format: schema.format,
  };

  if ("properties" in schema && schema.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = convertSchemaObject(value as OpenAPIV3.SchemaObject);
    }
  }

  if ("items" in schema && schema.items) {
    result.items = convertSchemaObject(schema.items as OpenAPIV3.SchemaObject);
  }

  if ("required" in schema && schema.required) {
    result.required = schema.required;
  }

  return result;
}

/**
 * Known-unsupported-in-v0 schema shapes that would silently produce a wrong
 * or empty tool if we tried to map them naively. Detected so callers can
 * fail loudly instead (ARCHITECTURE.md section 7 & 8).
 *
 * `allOf` is deliberately NOT flagged here anymore (see mergeAllOf) — it's
 * a deterministic merge, not an ambiguous union like oneOf/anyOf. Detection
 * runs on schemas that may still contain allOf internally (e.g. a oneOf
 * branch that itself uses allOf), so this still needs to look past a
 * top-level allOf into what it resolves to.
 */
function detectUnsupportedSchemaFeatures(schema: OpenAPIV3.SchemaObject | undefined): string | null {
  if (!schema) return null;
  const resolved = "allOf" in schema && schema.allOf ? mergeAllOf(schema) : schema;
  if ("oneOf" in resolved && resolved.oneOf) return "oneOf";
  if ("anyOf" in resolved && resolved.anyOf) return "anyOf";
  return null;
}

/**
 * True when every 2xx response for this operation has ONLY non-JSON
 * content types (or no content at all is fine — that's not "binary", just
 * empty). Mixed responses (e.g. both application/json and application/pdf
 * on the same 200) are treated as JSON-capable, not binary — the JSON path
 * stays usable. Only genuinely JSON-less 2xx responses trigger the
 * binary-response code path (ARCHITECTURE.md section 17).
 */
function isBinaryOnlyResponse(operation: OpenAPIV3.OperationObject): boolean {
  const responses = operation.responses ?? {};
  const twoXxEntries = Object.entries(responses).filter(([code]) => code.startsWith("2"));
  if (twoXxEntries.length === 0) return false;

  let sawAnyContent = false;
  for (const [, response] of twoXxEntries) {
    const content = (response as OpenAPIV3.ResponseObject).content;
    if (!content) continue;
    const contentTypes = Object.keys(content);
    if (contentTypes.length === 0) continue;
    sawAnyContent = true;
    const hasJson = contentTypes.some((ct) => ct === "application/json" || ct.endsWith("+json"));
    if (hasJson) return false;
  }
  return sawAnyContent;
}

function mapOperation(
  path: string,
  method: HttpMethod,
  operation: OpenAPIV3.OperationObject,
  warnings: MappingWarning[],
  errors: MappingError[]
): ToolDefinition | null {
  const { name, warning } = toToolName(operation.operationId, path, method);
  if (warning) {
    warnings.push({ operationId: operation.operationId, path, method, message: warning });
  }

  const parameters: ToolParameter[] = [];

  // --- path/query/header parameters ---
  for (const rawParam of operation.parameters ?? []) {
    const param = rawParam as OpenAPIV3.ParameterObject;
    if (!["path", "query", "header"].includes(param.in)) {
      warnings.push({
        operationId: operation.operationId,
        path,
        method,
        message: `Parameter "${param.name}" has unsupported location "${param.in}" (only path/query/header are supported in v0) — skipped.`,
      });
      continue;
    }

    const unsupported = detectUnsupportedSchemaFeatures(param.schema as OpenAPIV3.SchemaObject);
    if (unsupported) {
      errors.push({
        path,
        method,
        message: `Parameter "${param.name}" uses unsupported schema feature "${unsupported}" — operation skipped. v0 only supports plain schemas; see ARCHITECTURE.md section 7.`,
      });
      return null;
    }

    parameters.push({
      name: param.name,
      location: param.in as "path" | "query" | "header",
      required: Boolean(param.required),
      schema: convertParamSchema(param),
      description: param.description,
    });
  }

  // --- request body (JSON only in v0) ---
  if (operation.requestBody) {
    const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
    const jsonContent = requestBody.content?.["application/json"];

    if (!jsonContent) {
      warnings.push({
        operationId: operation.operationId,
        path,
        method,
        message:
          "Operation has a requestBody but no application/json content — non-JSON request bodies are not supported in v0, body was skipped.",
      });
    } else {
      const bodySchema = jsonContent.schema as OpenAPIV3.SchemaObject;
      const unsupported = detectUnsupportedSchemaFeatures(bodySchema);
      if (unsupported) {
        errors.push({
          path,
          method,
          message: `Request body uses unsupported schema feature "${unsupported}" — operation skipped. v0 only supports plain object schemas; see ARCHITECTURE.md section 7.`,
        });
        return null;
      }

      parameters.push({
        name: "body",
        location: "body",
        required: Boolean(requestBody.required),
        schema: convertSchemaObject(bodySchema),
        description: requestBody.description,
      });
    }
  }

  const inputSchema: JsonSchemaObject = {
    type: "object",
    properties: Object.fromEntries(parameters.map((p) => [p.name, p.schema])),
    required: parameters.filter((p) => p.required).map((p) => p.name),
  };

  const isBinaryResponse = isBinaryOnlyResponse(operation);

  return {
    name,
    description: operation.summary ?? operation.description ?? `${method.toUpperCase()} ${path}`,
    path,
    method,
    parameters,
    inputSchema,
    isBinaryResponse,
  };
}

/**
 * Detects the spec's required authentication scheme from its top-level
 * `security` requirement plus `components.securitySchemes`. Only the first
 * globally-required scheme is used — v0 doesn't support per-operation
 * overrides or multiple simultaneous schemes (OAuth2 "and" bearer, etc.),
 * which are rare in practice and out of scope for now (ARCHITECTURE.md
 * section 8 guardrails).
 *
 * Supports http-bearer and apiKey (header/query) — the two schemes that
 * cover real-world APIs mcpforge has actually been validated against (see
 * ARCHITECTURE.md section 16; Wavix uses bearerAuth). OAuth2 and
 * openIdConnect are detected but can't be automated (a generated server
 * can't run an interactive OAuth flow), so they produce a warning instead
 * of an AuthScheme.
 */
function detectAuthScheme(
  doc: OpenAPIV3.Document,
  warnings: MappingWarning[]
): AuthScheme | undefined {
  const security = doc.security;
  if (!security || security.length === 0) {
    return undefined;
  }

  const schemeNames = Object.keys(security[0] ?? {});
  if (schemeNames.length === 0) {
    return undefined;
  }

  const schemeName = schemeNames[0];
  const schemes = doc.components?.securitySchemes as
    | Record<string, OpenAPIV3.SecuritySchemeObject>
    | undefined;
  const scheme = schemes?.[schemeName];

  if (!scheme) {
    warnings.push({
      operationId: undefined,
      path: "",
      method: "get",
      message: `Spec requires security scheme "${schemeName}" but it's not defined in components.securitySchemes — generated server will have no auth wiring.`,
    });
    return undefined;
  }

  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return { type: "http-bearer" };
  }

  if (scheme.type === "apiKey") {
    if (scheme.in === "header" || scheme.in === "query") {
      return { type: "api-key", in: scheme.in, paramName: scheme.name };
    }
    warnings.push({
      operationId: undefined,
      path: "",
      method: "get",
      message: `Security scheme "${schemeName}" is an apiKey with unsupported location "${scheme.in}" (only header/query supported) — no auth wiring generated.`,
    });
    return undefined;
  }

  warnings.push({
    operationId: undefined,
    path: "",
    method: "get",
    message: `Security scheme "${schemeName}" has type "${scheme.type}" which mcpforge can't automate in v0 (only http-bearer and apiKey are supported) — generated server will have no auth wiring. Configure auth manually or see ARCHITECTURE.md section 9's post-v0 roadmap.`,
  });
  return undefined;
}

/**
 * Maps every supported operation in a parsed OpenAPI document into
 * ToolDefinitions. Never throws for per-operation issues — those are
 * collected as warnings/errors so the caller (CLI) can present a full
 * report, per ARCHITECTURE.md section 8's "fail loudly, don't guess" rule
 * applied at operation granularity rather than aborting the whole spec.
 */
export function mapOpenApiToTools(spec: ParsedSpec): MappingResult {
  const tools: ToolDefinition[] = [];
  const warnings: MappingWarning[] = [];
  const errors: MappingError[] = [];

  const doc = spec as OpenAPIV3.Document;
  const paths = doc.paths ?? {};

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;

    for (const method of SUPPORTED_METHODS) {
      const operation = (pathItem as OpenAPIV3.PathItemObject)[method];
      if (!operation) continue;

      const tool = mapOperation(path, method, operation, warnings, errors);
      if (tool) {
        tools.push(tool);
      }
    }
  }

  // Detect duplicate tool names (e.g. two operations both falling back to
  // the same derived name) — this would silently overwrite one tool with
  // another downstream, so it's a hard error rather than a warning.
  const seen = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    const existing = seen.get(tool.name);
    if (existing) {
      errors.push({
        path: tool.path,
        method: tool.method,
        message: `Duplicate tool name "${tool.name}" (also produced by ${existing.method.toUpperCase()} ${existing.path}). Add explicit, unique operationIds to the spec to resolve this.`,
      });
    } else {
      seen.set(tool.name, tool);
    }
  }
  const dedupedTools = tools.filter((t) => {
    // Keep only the first occurrence of each name if duplicates were found;
    // the error above tells the user to fix their spec regardless.
    if (seen.get(t.name) === t) {
      seen.delete(t.name); // ensure we only keep the true first occurrence
      return true;
    }
    return false;
  });

  const baseUrl = doc.servers?.[0]?.url;
  const auth = detectAuthScheme(doc, warnings);

  return { tools: dedupedTools, warnings, errors, baseUrl, auth };
}
