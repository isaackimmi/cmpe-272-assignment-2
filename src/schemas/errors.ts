export const errorResponseSchema = {
  type: "object",
  required: ["code", "message", "requestId"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    requestId: { type: "string" },
    upstreamStatus: { type: "integer", minimum: 400, maximum: 599 },
  },
  additionalProperties: false,
} as const;

export const standardErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
  503: errorResponseSchema,
} as const;
