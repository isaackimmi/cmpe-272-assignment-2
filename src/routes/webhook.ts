import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../config";
import { AppError } from "../errors";
import { errorResponseSchema } from "../schemas/errors";
import type { EventStore, StoredEvent } from "../store/events";

const issueActions = ["opened", "edited", "closed", "reopened"] as const;
const commentActions = ["created", "edited", "deleted"] as const;

interface WebhookDependencies {
  config: AppConfig;
  store: EventStore;
  now?: () => number;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function invalidWebhook(): AppError {
  return new AppError(400, "INVALID_WEBHOOK", "The webhook event or action is not supported");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function verifySignature(rawBody: Buffer, signature: string | undefined, secret: string): void {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
    throw new AppError(401, "INVALID_WEBHOOK_SIGNATURE", "The webhook signature is invalid");
  }

  const suppliedDigest = Buffer.from(signature.slice("sha256=".length), "hex");
  const expectedDigest = createHmac("sha256", secret).update(rawBody).digest();

  if (
    suppliedDigest.length !== expectedDigest.length ||
    !timingSafeEqual(suppliedDigest, expectedDigest)
  ) {
    throw new AppError(401, "INVALID_WEBHOOK_SIGNATURE", "The webhook signature is invalid");
  }
}

function repositoryName(payload: Record<string, unknown>): string | undefined {
  const repository = payload.repository;
  return isRecord(repository) && typeof repository.full_name === "string"
    ? repository.full_name
    : undefined;
}

function issueNumber(payload: Record<string, unknown>): number | undefined {
  const issue = payload.issue;
  return isRecord(issue) && positiveInteger(issue.number) ? issue.number : undefined;
}

function storedEvent(
  payload: unknown,
  event: string,
  deliveryId: string,
  expectedRepository: string,
  timestamp: string,
): StoredEvent {
  if (!isRecord(payload) || repositoryName(payload) !== expectedRepository) {
    throw invalidWebhook();
  }

  if (event === "issues") {
    const action = payload.action;
    const number = issueNumber(payload);

    if (
      typeof action !== "string" ||
      !issueActions.includes(action as (typeof issueActions)[number]) ||
      number === undefined ||
      Object.hasOwn(payload, "comment")
    ) {
      throw invalidWebhook();
    }

    return {
      id: deliveryId,
      event: "issues",
      action: action as (typeof issueActions)[number],
      repository: expectedRepository,
      issue_number: number,
      timestamp,
    };
  }

  if (event === "issue_comment") {
    const action = payload.action;
    const number = issueNumber(payload);
    const comment = payload.comment;
    const commentId = isRecord(comment) && positiveInteger(comment.id) ? comment.id : undefined;

    if (
      typeof action !== "string" ||
      !commentActions.includes(action as (typeof commentActions)[number]) ||
      number === undefined ||
      commentId === undefined
    ) {
      throw invalidWebhook();
    }

    return {
      id: deliveryId,
      event: "issue_comment",
      action: action as (typeof commentActions)[number],
      repository: expectedRepository,
      issue_number: number,
      comment_id: commentId,
      timestamp,
    };
  }

  if (event === "ping") {
    if (
      typeof payload.zen !== "string" ||
      payload.zen.length === 0 ||
      !positiveInteger(payload.hook_id) ||
      Object.hasOwn(payload, "action")
    ) {
      throw invalidWebhook();
    }

    return {
      id: deliveryId,
      event: "ping",
      action: "ping",
      repository: expectedRepository,
      issue_number: null,
      timestamp,
    };
  }

  throw invalidWebhook();
}

export function webhookRoutes({
  config,
  store,
  now = Date.now,
}: WebhookDependencies): FastifyPluginAsync {
  return async (app) => {
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) =>
      done(null, body),
    );

    app.post<{ Body: Buffer }>(
      "/webhook",
      {
        schema: {
          response: {
            400: errorResponseSchema,
            401: errorResponseSchema,
            500: errorResponseSchema,
            503: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const rawBody = request.body;
        const signature = singleHeader(request.headers["x-hub-signature-256"]);
        verifySignature(rawBody, signature, config.webhookSecret);

        let payload: unknown;

        try {
          payload = JSON.parse(rawBody.toString("utf8"));
        } catch {
          throw invalidWebhook();
        }

        const event = singleHeader(request.headers["x-github-event"]);
        const deliveryId = singleHeader(request.headers["x-github-delivery"]);

        if (!event || !deliveryId?.trim()) {
          throw invalidWebhook();
        }

        const expectedRepository = `${config.githubOwner}/${config.githubRepo}`;
        const receipt = storedEvent(
          payload,
          event,
          deliveryId,
          expectedRepository,
          new Date(now()).toISOString(),
        );

        try {
          const inserted = store.insert(receipt);
          request.log.info(
            {
              deliveryId,
              event: receipt.event,
              action: receipt.action,
              inserted,
            },
            "webhook delivery processed",
          );
        } catch {
          throw new AppError(
            503,
            "STORAGE_UNAVAILABLE",
            "The webhook receipt store is temporarily unavailable",
          );
        }

        return reply.code(204).send();
      },
    );
  };
}
