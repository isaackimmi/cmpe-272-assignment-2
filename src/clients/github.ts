import type { AppConfig } from "../config";
import { AppError } from "../errors";

export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
}

export interface UpdateIssueInput {
  title?: string;
  body?: string;
  state?: "open" | "closed";
}

export interface IssueListQuery {
  state: "open" | "closed" | "all";
  labels?: string;
  page: number;
  per_page: number;
}

export interface PaginationQuery {
  page: number;
  per_page: number;
}

export interface Issue {
  number: number;
  html_url: string;
  state: "open" | "closed";
  title: string;
  body: string | null;
  labels: string[];
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: number;
  body: string;
  user: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  html_url: string;
  url?: string;
}

interface GitHubIssue extends Omit<Issue, "labels"> {
  labels: Array<string | { name?: string }>;
}

type GitHubComment = Comment;

export interface GitHubResult<T> {
  data: T;
  link?: string;
}

function normalizeIssue(issue: GitHubIssue): Issue {
  return {
    number: issue.number,
    html_url: issue.html_url,
    state: issue.state,
    title: issue.title,
    body: issue.body,
    labels: issue.labels.flatMap((label) => {
      if (typeof label === "string") {
        return [label];
      }

      return label.name ? [label.name] : [];
    }),
    created_at: issue.created_at,
    updated_at: issue.updated_at,
  };
}

function normalizeComment(comment: GitHubComment): Comment {
  return {
    id: comment.id,
    body: comment.body,
    user: comment.user,
    created_at: comment.created_at,
    ...(comment.updated_at ? { updated_at: comment.updated_at } : {}),
    html_url: comment.html_url,
    ...(comment.url ? { url: comment.url } : {}),
  };
}

function parseSeconds(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

export class GitHubClient {
  private readonly repositoryUrl: string;
  private cooldownUntil = 0;
  private secondaryLimitCount = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    const baseUrl = config.githubApiBaseUrl.replace(/\/$/, "");
    this.repositoryUrl = `${baseUrl}/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}`;
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const result = await this.request<GitHubIssue>("/issues", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return normalizeIssue(result.data);
  }

  async listIssues(query: IssueListQuery): Promise<GitHubResult<Issue[]>> {
    const search = new URLSearchParams({
      state: query.state,
      page: String(query.page),
      per_page: String(query.per_page),
    });

    if (query.labels) {
      search.set("labels", query.labels);
    }

    const result = await this.request<GitHubIssue[]>(`/issues?${search}`);
    return { data: result.data.map(normalizeIssue), ...(result.link ? { link: result.link } : {}) };
  }

  async getIssue(number: number): Promise<Issue> {
    const result = await this.request<GitHubIssue>(`/issues/${number}`);
    return normalizeIssue(result.data);
  }

  async updateIssue(number: number, input: UpdateIssueInput): Promise<Issue> {
    const result = await this.request<GitHubIssue>(`/issues/${number}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return normalizeIssue(result.data);
  }

  async createComment(number: number, body: string): Promise<Comment> {
    const result = await this.request<GitHubComment>(`/issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    return normalizeComment(result.data);
  }

  async listComments(number: number, query: PaginationQuery): Promise<GitHubResult<Comment[]>> {
    const search = new URLSearchParams({
      page: String(query.page),
      per_page: String(query.per_page),
    });
    const result = await this.request<GitHubComment[]>(
      `/issues/${number}/comments?${search}`,
    );
    return {
      data: result.data.map(normalizeComment),
      ...(result.link ? { link: result.link } : {}),
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<GitHubResult<T>> {
    const now = this.now();

    if (now < this.cooldownUntil) {
      const retryAfter = Math.max(1, Math.ceil((this.cooldownUntil - now) / 1000));
      throw new AppError(
        429,
        "GITHUB_RATE_LIMITED",
        "GitHub rate limiting is active; retry later",
        429,
        retryAfter,
      );
    }

    let response: Response;

    try {
      response = await this.fetchImpl(`${this.repositoryUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.config.githubToken}`,
          "content-type": "application/json",
          "user-agent": "cmpe-272-assignment-2",
          "x-github-api-version": "2026-03-10",
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        503,
        "GITHUB_UNAVAILABLE",
        "GitHub is temporarily unavailable",
      );
    }

    const responseText = await response.text();
    let responseBody: unknown = null;

    if (responseText) {
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        throw new AppError(
          503,
          "GITHUB_UNAVAILABLE",
          "GitHub is temporarily unavailable",
          response.ok ? undefined : response.status,
        );
      }
    }

    if (!response.ok) {
      this.throwMappedError(response, responseBody);
    }

    this.secondaryLimitCount = 0;
    this.applySuccessfulExhaustion(response);

    return {
      data: responseBody as T,
      ...(response.headers.get("link")
        ? { link: response.headers.get("link") ?? undefined }
        : {}),
    };
  }

  private throwMappedError(response: Response, body: unknown): never {
    if (response.status === 429 || this.isRateLimited(response, body)) {
      const retryAfter = this.rateLimitDelay(response);
      this.cooldownUntil = this.now() + retryAfter * 1000;
      throw new AppError(
        429,
        "GITHUB_RATE_LIMITED",
        "GitHub rate limiting is active; retry later",
        response.status,
        retryAfter,
      );
    }

    if (response.status === 401) {
      throw new AppError(
        401,
        "GITHUB_AUTHENTICATION_FAILED",
        "GitHub authentication failed",
        401,
      );
    }

    if (response.status === 403) {
      throw new AppError(
        403,
        "GITHUB_FORBIDDEN",
        "GitHub denied access to the requested resource",
        403,
      );
    }

    if (response.status === 404) {
      throw new AppError(
        404,
        "GITHUB_NOT_FOUND",
        "The requested GitHub resource was not found",
        404,
      );
    }

    if (response.status === 422) {
      throw new AppError(
        400,
        "GITHUB_VALIDATION_FAILED",
        "GitHub rejected the supplied data",
        422,
      );
    }

    if (response.status >= 500) {
      throw new AppError(
        503,
        "GITHUB_UNAVAILABLE",
        "GitHub is temporarily unavailable",
        response.status,
      );
    }

    throw new AppError(
      400,
      "GITHUB_REQUEST_FAILED",
      "GitHub rejected the request",
      response.status,
    );
  }

  private isRateLimited(response: Response, body: unknown): boolean {
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      return true;
    }

    if (typeof body !== "object" || body === null || !("message" in body)) {
      return false;
    }

    return String(body.message).toLowerCase().includes("rate limit");
  }

  private rateLimitDelay(response: Response): number {
    const retryAfter = parseSeconds(response.headers.get("retry-after"));

    if (retryAfter !== undefined) {
      return Math.max(1, retryAfter);
    }

    const reset = parseSeconds(response.headers.get("x-ratelimit-reset"));

    if (reset !== undefined) {
      return Math.max(1, reset - Math.floor(this.now() / 1000));
    }

    const delay = Math.min(60 * 2 ** this.secondaryLimitCount, 3600);
    this.secondaryLimitCount += 1;
    return delay;
  }

  private applySuccessfulExhaustion(response: Response): void {
    if (response.headers.get("x-ratelimit-remaining") !== "0") {
      return;
    }

    const reset = parseSeconds(response.headers.get("x-ratelimit-reset"));

    if (reset !== undefined) {
      this.cooldownUntil = Math.max(this.cooldownUntil, reset * 1000);
    }
  }
}
