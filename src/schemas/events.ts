const storedIssueEventSchema = {
  type: "object",
  required: ["id", "event", "action", "issue_number", "timestamp"],
  properties: {
    id: { type: "string", minLength: 1 },
    event: { type: "string", const: "issues" },
    action: { type: "string", enum: ["opened", "edited", "closed", "reopened"] },
    issue_number: { type: "integer", minimum: 1 },
    timestamp: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const;

const storedCommentEventSchema = {
  type: "object",
  required: ["id", "event", "action", "issue_number", "comment_id", "timestamp"],
  properties: {
    id: { type: "string", minLength: 1 },
    event: { type: "string", const: "issue_comment" },
    action: { type: "string", enum: ["created", "edited", "deleted"] },
    issue_number: { type: "integer", minimum: 1 },
    comment_id: { type: "integer", minimum: 1 },
    timestamp: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const;

const storedPingEventSchema = {
  type: "object",
  required: ["id", "event", "action", "issue_number", "timestamp"],
  properties: {
    id: { type: "string", minLength: 1 },
    event: { type: "string", const: "ping" },
    action: { type: "string", const: "ping" },
    issue_number: { type: "null" },
    timestamp: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const;

export const storedEventSchema = {
  oneOf: [storedIssueEventSchema, storedCommentEventSchema, storedPingEventSchema],
} as const;

export const eventListQuerySchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
  additionalProperties: false,
} as const;
