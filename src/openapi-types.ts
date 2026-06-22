// Minimal structural types for the subset of OpenAPI 3.1 that Mealie emits.

export type JsonSchema = Record<string, unknown>;

export interface OpenApiParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

export interface OpenApiMediaType {
  schema?: JsonSchema;
}

export interface OpenApiRequestBody {
  required?: boolean;
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, unknown>;
  security?: Array<Record<string, unknown>>;
}

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>> & {
  parameters?: OpenApiParameter[];
};

export interface OpenApiDocument {
  openapi: string;
  info: { title?: string; version?: string; description?: string };
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, JsonSchema>;
  };
}

export const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete"];
