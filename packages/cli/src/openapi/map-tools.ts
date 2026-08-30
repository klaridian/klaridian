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
  const schema = (param.schema ?? {}) as OpenAPIV3.SchemaObject;
  const items = "items" in schema ? (schema as { items?: OpenAPIV3.SchemaObject }).items : undefined;
  return {
    type: schema.type ?? "string",
    description: param.description ?? schema.description,
    enum: schema.enum,
    format: schema.format,
    items: items ? convertSchemaObject(items) : undefined,
  };
}

/** Recursively converts an OpenAPI SchemaObject into our internal JsonSchemaObject shape. */
function convertSchemaObject(schema: OpenAPIV3.SchemaObject): JsonSchemaObject {
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
 */
function detectUnsupportedSchemaFeatures(schema: OpenAPIV3.SchemaObject | undefined): string | null {
  if (!schema) return null;
  if ("oneOf" in schema && schema.oneOf) return "oneOf";
  if ("allOf" in schema && schema.allOf) return "allOf";
  if ("anyOf" in schema && schema.anyOf) return "anyOf";
  return null;
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

  return {
    name,
    description: operation.summary ?? operation.description ?? `${method.toUpperCase()} ${path}`,
    path,
    method,
    parameters,
    inputSchema,
  };
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

  return { tools: dedupedTools, warnings, errors, baseUrl };
}
