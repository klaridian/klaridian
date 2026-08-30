// packages/cli/src/openapi/types.ts
//
// Internal representation of an MCP tool, derived from an OpenAPI operation.
// This is the model the parser produces and the templating layer consumes —
// keeping it independent of both OpenAPI's and MCP SDK's exact shapes means
// either can evolve without rewriting the other side.

export interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaObject>;
  items?: JsonSchemaObject;
  required?: string[];
  enum?: unknown[];
  description?: string;
  format?: string;
  [key: string]: unknown;
}

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** A single parameter or request-body field mapped into the tool's flat input schema. */
export interface ToolParameter {
  name: string;
  /** Where this value needs to go when making the actual HTTP call. */
  location: "path" | "query" | "header" | "body";
  required: boolean;
  schema: JsonSchemaObject;
  description?: string;
}

/** One MCP tool, derived from one OpenAPI operation. */
export interface ToolDefinition {
  /** MCP tool name — from operationId, sanitized. */
  name: string;
  description: string;
  /** Original OpenAPI path template, e.g. "/pet/{petId}" */
  path: string;
  method: HttpMethod;
  parameters: ToolParameter[];
  /** Full JSON Schema for the MCP tool's inputSchema (object of all parameters). */
  inputSchema: JsonSchemaObject;
}

/** Non-fatal issue found while mapping — surfaced to the user, doesn't stop generation. */
export interface MappingWarning {
  operationId: string | undefined;
  path: string;
  method: HttpMethod;
  message: string;
}

/** Fatal issue — this operation could not be mapped at all and was skipped. */
export interface MappingError {
  path: string;
  method: HttpMethod;
  message: string;
}

export interface MappingResult {
  tools: ToolDefinition[];
  warnings: MappingWarning[];
  errors: MappingError[];
  /** Base server URL taken from the spec's `servers[0].url`, if present. */
  baseUrl: string | undefined;
  /**
   * Authentication scheme required by the spec, if any. v0 supports http
   * bearer and apiKey (header or query) — the two schemes that cover the
   * overwhelming majority of real-world APIs (e.g. Wavix uses bearerAuth,
   * see ARCHITECTURE.md section 16). OAuth2/openIdConnect are detected but
   * not automatable — surfaced as a warning instead, since a generated
   * server can't run an interactive OAuth flow on its own.
   */
  auth: AuthScheme | undefined;
}

export type AuthScheme =
  | { type: "http-bearer" }
  | { type: "api-key"; in: "header" | "query"; paramName: string };

