export const issueSchema = {
  type: "object",
  required: [
    "number",
    "html_url",
    "state",
    "title",
    "body",
    "labels",
    "created_at",
    "updated_at",
  ],
  properties: {
    number: { type: "integer", minimum: 1 },
    html_url: { type: "string", format: "uri" },
    state: { type: "string", enum: ["open", "closed"] },
    title: { type: "string", minLength: 1 },
    body: { type: ["string", "null"] },
    labels: { type: "array", items: { type: "string" } },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const;

export const createIssueBodySchema = {
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string", minLength: 1 },
    body: { type: "string" },
    labels: {
      type: "array",
      items: { type: "string" },
      uniqueItems: true,
    },
  },
  additionalProperties: false,
} as const;

export const updateIssueBodySchema = {
  type: "object",
  minProperties: 1,
  properties: {
    title: { type: "string", minLength: 1 },
    body: { type: "string" },
    state: { type: "string", enum: ["open", "closed"] },
  },
  additionalProperties: false,
} as const;

export const issueNumberParamsSchema = {
  type: "object",
  required: ["number"],
  properties: {
    number: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
} as const;

export const paginationQuerySchema = {
  type: "object",
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    per_page: { type: "integer", minimum: 1, maximum: 100, default: 30 },
  },
  additionalProperties: false,
} as const;

export const issueListQuerySchema = {
  type: "object",
  properties: {
    state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
    labels: { type: "string" },
    page: { type: "integer", minimum: 1, default: 1 },
    per_page: { type: "integer", minimum: 1, maximum: 100, default: 30 },
  },
  additionalProperties: false,
} as const;
