export const createCommentBodySchema = {
  type: "object",
  required: ["body"],
  properties: {
    body: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const commentSchema = {
  type: "object",
  required: ["id", "body", "user", "created_at", "html_url"],
  properties: {
    id: { type: "integer", minimum: 1 },
    body: { type: "string" },
    user: { type: "object", additionalProperties: true },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    html_url: { type: "string", format: "uri" },
    url: { type: "string", format: "uri" },
  },
  additionalProperties: false,
} as const;
