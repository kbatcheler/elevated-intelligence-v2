import { SIGNAL_KINDS } from "@workspace/connectors";

// A real, honest OpenAPI 3.1 description of the public Ingestion API, generated
// from the actual DerivedSignalSet contract (the same SIGNAL_KINDS the runtime
// guard enforces). It is served unauthenticated at GET /v1/ingest/openapi.json
// so a client can read the contract before it holds a key. It describes only the
// shape and the bearer requirement; it never contains a secret or any tenant data.
export function ingestionOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Elevated Intelligence Ingestion API",
      version: "1.0.0",
      description:
        "Submit derived, non-reversible numeric signals for one layer. The platform " +
        "stores math, not records: every value must be a finite number or a numeric " +
        "vector. Raw rows, names, identifiers, and free text are rejected at the boundary.",
    },
    servers: [{ url: "/v1/ingest" }],
    components: {
      securitySchemes: {
        ingestionKey: {
          type: "http",
          scheme: "bearer",
          description:
            "A per-tenant ingestion key in the form <keyId>.<secret>, issued and " +
            "revoked in the admin console. The tenant is resolved from the key.",
        },
      },
      schemas: {
        DerivedSignal: {
          type: "object",
          additionalProperties: false,
          required: ["key", "kind", "value"],
          properties: {
            key: { type: "string", minLength: 1, maxLength: 120 },
            kind: { type: "string", enum: [...SIGNAL_KINDS] },
            value: {
              oneOf: [
                { type: "number" },
                { type: "array", items: { type: "number" }, minItems: 1, maxItems: 4096 },
              ],
              description:
                "A finite number for scalar kinds; a numeric array for distribution and embedding.",
            },
            window: { type: "string", minLength: 1, maxLength: 60 },
            unit: { type: "string", maxLength: 40 },
          },
        },
        IngestRequest: {
          type: "object",
          additionalProperties: false,
          required: ["layer", "signals"],
          properties: {
            layer: {
              type: "string",
              minLength: 1,
              maxLength: 120,
              description: "The target layer key, for example finance.",
            },
            signals: {
              type: "array",
              maxItems: 5000,
              items: { $ref: "#/components/schemas/DerivedSignal" },
            },
            generatedAt: { type: "string", description: "ISO 8601 timestamp of derivation." },
            windowStart: { type: "string" },
            windowEnd: { type: "string" },
          },
        },
        IngestAccepted: {
          type: "object",
          properties: {
            accepted: { type: "boolean" },
            rootHash: { type: "string", description: "sha256 over the derived math." },
            signalsCount: { type: "integer" },
            layers: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    security: [{ ingestionKey: [] }],
    paths: {
      "/": {
        post: {
          summary: "Ingest a derived signal set for one layer",
          operationId: "ingestSignals",
          security: [{ ingestionKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/IngestRequest" } },
            },
          },
          responses: {
            "202": {
              description: "Accepted and persisted as derived math.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/IngestAccepted" } },
              },
            },
            "400": { description: "Malformed request, unknown or disabled layer, or non-numeric signals." },
            "401": { description: "Missing, malformed, or revoked ingestion key." },
            "429": { description: "Rate limit exceeded for this key." },
          },
        },
      },
      "/openapi.json": {
        get: {
          summary: "This OpenAPI document",
          operationId: "getOpenApi",
          security: [],
          responses: { "200": { description: "The ingestion API contract." } },
        },
      },
    },
  };
}
