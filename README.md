# CMPE 272 Assignment 2

A TypeScript and Fastify gateway for the GitHub Issues API. The service creates, reads, and
updates issues; creates and lists comments; verifies GitHub webhook signatures; and stores
normalized webhook receipts in SQLite.

Supporting submission materials are included in [Assignment-2-Design-Note.docx](Assignment-2-Design-Note.docx) and [CMPE_272_Assignment_2_Screenshot_Evidence.docx](CMPE_272_Assignment_2_Screenshot_Evidence.docx).

## Prerequisites

- [HTTPie](https://httpie.io/) for the request examples
- A dedicated GitHub repository with Issues enabled
- A fine-grained GitHub personal access token for that repository
- An [ngrok](https://ngrok.com/) account and authtoken for receiving webhooks locally
- One of these runtime options:
  - Node.js 24 and npm for non-Docker startup
  - Docker Desktop for Docker startup

## Environment setup and credential scopes

Create the local environment file:

```bash
cp .env.example .env
```

Replace the placeholders in `.env`. Never commit the completed file.

| Variable               | Required               | Purpose and scope                                                                                                                                                                                                                                |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GITHUB_TOKEN`         | Yes                    | Fine-grained GitHub PAT restricted to the configured repository with **Issues: Read and write**. GitHub grants Metadata read access automatically. The application token does not need webhook-administration or repository-contents permission. |
| `GITHUB_OWNER`         | Yes                    | Owner of the one repository the gateway is allowed to access.                                                                                                                                                                                    |
| `GITHUB_REPO`          | Yes                    | Repository whose issues and comments the gateway manages.                                                                                                                                                                                        |
| `API_AUTH_TOKEN`       | Yes                    | Private bearer token chosen for clients of this gateway. It is not an OAuth token and has no GitHub scopes.                                                                                                                                      |
| `WEBHOOK_SECRET`       | Yes                    | Random shared secret entered both here and in GitHub's webhook **Secret** field. It signs and verifies webhook bytes.                                                                                                                            |
| `NGROK_AUTHTOKEN`      | Docker webhook testing | Authenticates the ngrok agent. It is unrelated to all application and GitHub credentials.                                                                                                                                                        |
| `HOST`                 | Startup                | Use `127.0.0.1` locally. Docker Compose overrides this with `0.0.0.0` so the published container port is reachable.                                                                                                                              |
| `PORT`                 | Startup                | HTTP listening port; the provided configuration uses `3000`.                                                                                                                                                                                     |
| `EVENTS_DATABASE_PATH` | Optional               | SQLite receipt location. Defaults locally to `./data/events.sqlite`; Docker Compose uses `/app/data/events.sqlite` in a named volume.                                                                                                            |
| `GITHUB_API_BASE_URL`  | Optional               | Overrides `https://api.github.com`, primarily for controlled testing. Leave unset for normal use.                                                                                                                                                |

The three security credentials have separate trust boundaries:

```text
HTTP client --API_AUTH_TOKEN--> Fastify gateway
Fastify gateway --GITHUB_TOKEN--> GitHub API
GitHub --WEBHOOK_SECRET signature--> POST /webhook
```

## Run locally without Docker

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

For a production-style local run:

```bash
npm run build
npm start
```

The API is available at <http://localhost:3000>. For real webhook delivery, keep the API running
and start ngrok in a separate terminal:

```bash
ngrok http 3000
```

## Run with Docker

Docker Compose starts the API and ngrok together:

```bash
docker compose up --build
```

- API: <http://localhost:3000>
- ngrok request inspector: <http://localhost:4040>
- SQLite receipts: the persistent `events-data` Docker volume

Stop the containers without deleting stored receipts:

```bash
docker compose down
```

The Docker image uses Node.js 24, builds TypeScript in a separate build stage, installs only
production dependencies in the runtime stage, and runs the application as a non-root user.

## GitHub webhook setup

The tunnel can start automatically with Docker, but the repository webhook must be configured
manually:

1. Start the API and ngrok using either startup method above.
2. Open <http://localhost:4040> and copy ngrok's public HTTPS forwarding URL.
3. In the configured GitHub repository, open **Settings → Webhooks → Add webhook**.
4. Set **Payload URL** to the forwarding URL followed by `/webhook`, for example
   `https://example.ngrok-free.dev/webhook`.
5. Set **Content type** to `application/json`.
6. Set **Secret** to the exact `WEBHOOK_SECRET` value from `.env`.
7. Choose **Let me select individual events**, then select **Issues** and
   **Issue comments**.
8. Keep SSL verification and **Active** enabled, then save the webhook.
9. In **Recent deliveries**, verify that GitHub's setup `ping` received `204 No Content`.

If the ngrok URL changes, update the webhook's payload URL in GitHub. The webhook route uses its
HMAC signature instead of `API_AUTH_TOKEN`, so do not configure gateway bearer authentication on
the GitHub webhook.

### Redelivery and deduplication

1. Create or modify an issue or comment so GitHub sends a delivery.
2. Run the `GET /events` example below and note the matching delivery ID and event count.
3. In GitHub, open **Settings → Webhooks**, select the webhook, and open
   **Recent deliveries**.
4. Select that delivery and choose **Redeliver**.
5. Confirm that GitHub again receives `204 No Content`.
6. Run `GET /events` again. The count must be unchanged and the delivery must appear only once.

SQLite enforces uniqueness for the `(delivery ID, action)` pair. A duplicate is acknowledged but
is not inserted again. This remains true after restarting the application because receipts are
stored on disk rather than in memory.

## HTTPie API examples

The examples below cover every route. Set these shell variables first, replacing the token and
issue number with values from your environment and repository:

```bash
export BASE_URL=http://localhost:3000
export API_AUTH_TOKEN=YOUR_API_AUTH_TOKEN
export ISSUE_NUMBER=3
```

`API_AUTH_TOKEN` must match the value used by the running application. `ISSUE_NUMBER` must identify
an issue in the configured GitHub repository.

### `GET /healthz`

Public liveness check. Expected response: `200 OK` with `{"status":"ok"}`.

```bash
http GET "$BASE_URL/healthz"
```

### `POST /issues`

Creates an issue in the configured repository. Only `title` is required. Expected response:
`201 Created` with the issue and a gateway `Location` header.

```bash
http --ignore-stdin POST "$BASE_URL/issues" \
  Authorization:"Bearer $API_AUTH_TOKEN" \
  title="HTTPie assignment issue" \
  body="Created through the Fastify GitHub Issues gateway" \
  labels:='["test"]'
```

### `GET /issues`

Lists issues and demonstrates every supported filter and pagination parameter. Expected response:
`200 OK`; a GitHub `Link` response header is included when another page exists.

```bash
http --print=HB GET "$BASE_URL/issues" \
  Authorization:"Bearer $API_AUTH_TOKEN" \
  state==all \
  labels==test \
  page==1 \
  per_page==10
```

### `GET /issues/{number}`

Retrieves one issue. Expected response: `200 OK`.

```bash
http GET "$BASE_URL/issues/$ISSUE_NUMBER" \
  Authorization:"Bearer $API_AUTH_TOKEN"
```

### `PATCH /issues/{number}`

Updates any combination of `title`, `body`, and `state`. At least one field is required. This
example closes the issue; use `state=open` to reopen it. Expected response: `200 OK`.

```bash
http --ignore-stdin PATCH "$BASE_URL/issues/$ISSUE_NUMBER" \
  Authorization:"Bearer $API_AUTH_TOKEN" \
  title="HTTPie assignment issue - edited" \
  state=closed
```

### `POST /issues/{number}/comments`

Adds a comment to an issue. Expected response: `201 Created` with the comment and its GitHub API
URL in the `Location` header.

```bash
http --ignore-stdin POST "$BASE_URL/issues/$ISSUE_NUMBER/comments" \
  Authorization:"Bearer $API_AUTH_TOKEN" \
  body="Comment created through HTTPie"
```

### `GET /issues/{number}/comments`

Lists an issue's comments with native GitHub pagination. Expected response: `200 OK`; a `Link`
header is included when another page exists.

```bash
http --print=HB GET "$BASE_URL/issues/$ISSUE_NUMBER/comments" \
  Authorization:"Bearer $API_AUTH_TOKEN" \
  page==1 \
  per_page==10
```

### `POST /webhook`

GitHub normally calls this route. This local example constructs a correctly signed issue payload
using the `WEBHOOK_SECRET` loaded from `.env`. Expected response: `204 No Content`.

```bash
WEBHOOK_BODY="$(node --env-file=.env -e 'process.stdout.write(JSON.stringify({ action: "opened", repository: { full_name: process.env.GITHUB_OWNER + "/" + process.env.GITHUB_REPO }, issue: { number: Number(process.env.ISSUE_NUMBER) } }));')"
WEBHOOK_SIGNATURE="$(node --env-file=.env -e 'const { createHmac } = require("node:crypto"); process.stdout.write("sha256=" + createHmac("sha256", process.env.WEBHOOK_SECRET).update(process.argv[1]).digest("hex"));' "$WEBHOOK_BODY")"

http --ignore-stdin --print=Hh POST "$BASE_URL/webhook" \
  Content-Type:application/json \
  X-GitHub-Event:issues \
  X-GitHub-Delivery:manual-httpie-delivery-001 \
  X-Hub-Signature-256:"$WEBHOOK_SIGNATURE" \
  --raw "$WEBHOOK_BODY"
```

The body uses `GITHUB_OWNER`, `GITHUB_REPO`, and the exported `ISSUE_NUMBER`. Reusing the same
delivery ID and action demonstrates deduplication.

### `GET /events`

Returns normalized webhook receipts newest first. `limit` defaults to `50` and accepts values from
`1` through `100`. Expected response: `200 OK`.

```bash
http GET "$BASE_URL/events" \
  Authorization:"Bearer $API_AUTH_TOKEN" \
  limit==20
```

## Pagination behavior

`GET /issues` supports:

- `state`: `open`, `closed`, or `all`; default `open`
- `labels`: comma-separated GitHub label names
- `page`: one-based page number; default `1`
- `per_page`: results per page from `1` through `100`; default `30`

`GET /issues/{number}/comments` supports the same `page` and `per_page` parameters. The gateway
forwards these values to GitHub and returns GitHub's `Link` header unchanged. An absent `Link`
header normally means all matching results fit on the current page. The URLs inside `Link` point
directly to GitHub, not back through this gateway, and therefore require GitHub authentication if
followed directly. Do not send `API_AUTH_TOKEN` to a GitHub URL.

## Persistence

GitHub remains the source of truth for issues and comments. SQLite only stores normalized webhook
receipts used for inspection and deduplication.

- Non-Docker default: `./data/events.sqlite`
- Docker: `/app/data/events.sqlite` in the `events-data` named volume

Normal application restarts and `docker compose down` preserve receipts. Removing the named volume
deletes the Docker-managed receipt database.

## Verification commands

The default tests block unexpected external network access and do not modify GitHub:

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run check:contract
npm run build
```

The live tests use the real configured repository and are intentionally separate because they
create or modify GitHub data:

> Run live tests when you are not simultaneously making manual API calls against the same test
> resources. Earlier manual calls should not normally cause a failure, but concurrent changes,
> GitHub rate limiting or eventual consistency, changed credentials, and an unavailable API,
> ngrok tunnel, or GitHub webhook can affect the result. The webhook test requires the API,
> tunnel, and correctly configured GitHub webhook to already be running.

```bash
npm run test:integration
npm run test:webhook
```
