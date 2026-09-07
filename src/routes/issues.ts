import type { FastifyPluginAsync, onRequestHookHandler } from "fastify";
import type {
  CreateIssueInput,
  GitHubClient,
  IssueListQuery,
  PaginationQuery,
  UpdateIssueInput,
} from "../clients/github";
import { commentSchema, createCommentBodySchema } from "../schemas/comments";
import { standardErrorResponses } from "../schemas/errors";
import {
  createIssueBodySchema,
  issueListQuerySchema,
  issueNumberParamsSchema,
  issueSchema,
  paginationQuerySchema,
  updateIssueBodySchema,
} from "../schemas/issues";

interface IssueParams {
  number: number;
}

interface CommentBody {
  body: string;
}

interface IssueRouteDependencies {
  github: GitHubClient;
  authenticate: onRequestHookHandler;
}

export function issueRoutes({
  github,
  authenticate,
}: IssueRouteDependencies): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: CreateIssueInput }>(
      "/issues",
      {
        onRequest: authenticate,
        schema: {
          body: createIssueBodySchema,
          response: { 201: issueSchema, ...standardErrorResponses },
        },
      },
      async (request, reply) => {
        const issue = await github.createIssue(request.body);
        return reply
          .code(201)
          .header("location", `/issues/${issue.number}`)
          .send(issue);
      },
    );

    app.get<{ Querystring: IssueListQuery }>(
      "/issues",
      {
        onRequest: authenticate,
        schema: {
          querystring: issueListQuerySchema,
          response: {
            200: { type: "array", items: issueSchema },
            ...standardErrorResponses,
          },
        },
      },
      async (request, reply) => {
        const result = await github.listIssues(request.query);

        if (result.link) {
          reply.header("link", result.link);
        }

        return result.data;
      },
    );

    app.get<{ Params: IssueParams }>(
      "/issues/:number",
      {
        onRequest: authenticate,
        schema: {
          params: issueNumberParamsSchema,
          response: { 200: issueSchema, ...standardErrorResponses },
        },
      },
      async (request) => github.getIssue(request.params.number),
    );

    app.patch<{ Params: IssueParams; Body: UpdateIssueInput }>(
      "/issues/:number",
      {
        onRequest: authenticate,
        schema: {
          params: issueNumberParamsSchema,
          body: updateIssueBodySchema,
          response: { 200: issueSchema, ...standardErrorResponses },
        },
      },
      async (request) => github.updateIssue(request.params.number, request.body),
    );

    app.post<{ Params: IssueParams; Body: CommentBody }>(
      "/issues/:number/comments",
      {
        onRequest: authenticate,
        schema: {
          params: issueNumberParamsSchema,
          body: createCommentBodySchema,
          response: { 201: commentSchema, ...standardErrorResponses },
        },
      },
      async (request, reply) => {
        const comment = await github.createComment(
          request.params.number,
          request.body.body,
        );
        return reply
          .code(201)
          .header("location", comment.url ?? comment.html_url)
          .send(comment);
      },
    );

    app.get<{ Params: IssueParams; Querystring: PaginationQuery }>(
      "/issues/:number/comments",
      {
        onRequest: authenticate,
        schema: {
          params: issueNumberParamsSchema,
          querystring: paginationQuerySchema,
          response: {
            200: { type: "array", items: commentSchema },
            ...standardErrorResponses,
          },
        },
      },
      async (request, reply) => {
        const result = await github.listComments(
          request.params.number,
          request.query,
        );

        if (result.link) {
          reply.header("link", result.link);
        }

        return result.data;
      },
    );
  };
}
