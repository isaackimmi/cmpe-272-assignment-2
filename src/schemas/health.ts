export const healthResponseSchema = {
  type: "object",
  required: ["status"],
  properties: {
    status: { type: "string", enum: ["ok"] },
  },
  additionalProperties: false,
};
