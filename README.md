# Nirik

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Automated AI-powered code reviews for Pull Requests (GitHub) and Merge Requests (GitLab).**  
When you open or update a PR/MR, this app fetches the diff, sends the changed code to an AI (Gemini or OpenAI), and posts the review as comments on your PR/MR.

Built for teams who want fewer "looks good to me" comments and fewer 2 a.m. "who approved this?" moments.

---

## Table of contents

- [What does this app do?](#what-does-this-app-do)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Self-hosting](#self-hosting)
- [Project website (GitHub Pages)](#project-website-github-pages)
- [Configuration](#configuration)
- [Domain and webhook URL](#domain-and-webhook-url)
- [Setting up webhooks (GitHub & GitLab)](#setting-up-webhooks-github--gitlab)
- [Webhook security](#webhook-security)
- [API reference](#api-reference)
- [How it works](#how-it-works)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing & license](#contributing--license)

---

## What does this app do?

1. **You** configure a webhook in your GitHub or GitLab repo pointing to this app.
2. **When** you open or update a Pull Request (GitHub) or Merge Request (GitLab), the platform sends a webhook to this app.
3. **The app** fetches the PR/MR diff, filters out noise (e.g. lock files, minified code), and sends only the **added lines** to an AI (Google Gemini or OpenAI).
4. **The AI** returns a structured review (summary + line-level comments).
5. **The app** posts that review back to your PR/MR so you and your team see it like a normal code review.

You need to provide:

- **One AI provider**: either a Gemini API key or an OpenAI API key (or both; Gemini is used first if both are set).
- **One or both Git providers**: GitHub token and/or GitLab token so the app can fetch diffs and post reviews.
- **Redis**: used as a job queue so the app can respond to the webhook quickly and run the review in the background.

---

## Features

- **GitHub** – Pull request webhooks; posts a single PR review with a summary and line comments.
- **GitLab** – Merge request webhooks (GitLab.com and self-hosted); posts a discussion with summary and line-level comments.
- **Single webhook URL** – One endpoint for both GitHub and GitLab; the app detects the provider from the payload.
- **AI** – Google **Gemini** or **OpenAI** (you set one or both; Gemini takes precedence if both keys are set).
- **Efficient** – Only added lines are reviewed; files like `package-lock.json`, `*.min.js`, images are skipped to save tokens.
- **Background jobs** – Uses Redis (BullMQ) so the webhook responds with `202 Accepted` immediately and the review runs asynchronously.
- **Metrics** – Prometheus-style metrics at `GET /metrics` for monitoring.
- **Docker** – Run the app and Redis with `docker compose up`.

---

## Prerequisites

- **Node.js** ≥ 20 (if running without Docker).
- **Redis** – Required for the job queue. Use a local Redis, a cloud Redis, or the Redis service in Docker Compose.
- **API keys**:
  - At least one **AI** key: [Google AI Studio](https://aistudio.google.com/apikey) (Gemini) and/or [OpenAI](https://platform.openai.com/api-keys) (OpenAI).
  - At least one **Git** token: [GitHub Personal Access Token](https://github.com/settings/tokens) (scope `repo`) and/or [GitLab Personal Access Token](https://gitlab.com/-/user_settings/personal_access_tokens) (scope `api`).

---

## Quick start

If "quick start" takes more than 10 minutes, you are officially allowed to blame DNS.

### Option A: Docker (easiest)

1. **Clone and go into the project**

   ```bash
   git clone https://github.com/imabhinavdev/nirik.git
   cd nirik
   ```

2. **Copy the example env file and edit it**

   ```bash
   cp .env.example .env
   ```

   Open `.env` and set at least:
   - One AI key: `GEMINI_API_KEY` and/or `OPENAI_API_KEY`
   - One Git token: `GITHUB_TOKEN` and/or `GITLAB_TOKEN`
   - (Optional but recommended) `BASE_URL` to your public URL, e.g. `https://your-domain.com`
   - (Optional) Webhook secrets: `GITHUB_WEBHOOK_SECRET` and/or `GITLAB_WEBHOOK_TOKEN` (see [Webhook security](#webhook-security))

3. **Start the app and Redis**

   ```bash
   docker compose up
   ```

4. **Check the logs** – On startup you’ll see something like:

   ```
   Server is running on http://localhost:3000
   Webhook URL (GitHub & GitLab): http://localhost:3000/api/v1/webhooks/review-pr
   Other endpoints: GET / (health), GET /metrics (Prometheus)
   ```

   Use that **Webhook URL** when configuring the webhook in GitHub or GitLab (see [Setting up webhooks](#setting-up-webhooks-github--gitlab)).

### Option B: Run locally (without Docker)

1. **Install dependencies and copy env**

   ```bash
   git clone https://github.com/imabhinavdev/nirik.git
   cd nirik
   pnpm install
   cp .env.example .env
   ```

2. **Edit `.env`** – Same as above; set your API keys/tokens and optional webhook secrets.

3. **Start Redis** (if you don’t have it running already), then start the app:

   ```bash
   pnpm start
   ```

4. **Read the startup logs** – The webhook URL and other endpoints are printed so you know exactly what to configure.

---

## Self-hosting

Nirik is designed for self-hosting and works well on a small VM or container host.
It is happiest when your server has stable internet, stable clocks, and unstable opinions about tabs vs spaces.

1. **Choose runtime**
   - **Docker Compose (recommended)**: easiest to run the app + Redis together.
   - **Node process**: run with `pnpm start` behind a process manager (systemd or PM2) and a separate Redis instance.

2. **Run in production**

   ```bash
   docker compose up -d
   ```

3. **Expose with HTTPS**

   Put Nirik behind a reverse proxy (Nginx, Caddy, Traefik, or Cloudflare Tunnel) and route:
   - `POST /api/v1/webhooks/review-pr`
   - `GET /` (health)
   - `GET /metrics` (optional monitoring)

4. **Set public URL**

   In `.env`, set:

   ```env
   BASE_URL=https://your-domain.com
   ```

5. **Secure webhooks**

   Set `GITHUB_WEBHOOK_SECRET` and/or `GITLAB_WEBHOOK_TOKEN` in `.env`, and use those same values in webhook settings.

---

## Project website (GitHub Pages)

This repo includes a one-page landing site in `docs/` and a Pages workflow at `.github/workflows/deploy-pages.yml`.

1. Push these changes to your default branch (for example, `main`).
2. In GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. GitHub Actions will deploy the content from `docs/`.
4. Your site will be available at:
   - `https://<your-username>.github.io/<your-repo>/`
5. If your domain is showing `README.md` instead of the landing page, your Pages source is likely set to a branch/folder. Switch it back to **GitHub Actions**.

---

## Configuration

All configuration is via environment variables (e.g. in `.env`).

| Variable                                | Required   | Description                                                                                                                                                                                |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Server**                              |            |                                                                                                                                                                                            |
| `PORT`                                  | No         | HTTP port (default: `3000`).                                                                                                                                                               |
| `NODE_ENV`                              | No         | `development`, `production`, or `test`.                                                                                                                                                    |
| `BASE_URL`                              | No         | Public URL of your server with no trailing slash (e.g. `https://your-domain.com`). Used in startup logs so you see the correct webhook URL. If not set, logs show `http://localhost:PORT`. |
| **AI (set at least one)**               |            |                                                                                                                                                                                            |
| `GEMINI_API_KEY`                        | One        | Google Gemini API key. If both Gemini and OpenAI are set, Gemini is used.                                                                                                                  |
| `GEMINI_MODEL`                          | No         | Gemini model name (default: `gemini-2.0-flash`).                                                                                                                                           |
| `OPENAI_API_KEY`                        | One        | OpenAI API key. Used when `GEMINI_API_KEY` is not set.                                                                                                                                     |
| `OPENAI_MODEL`                          | No         | OpenAI model (default: `gpt-4o-mini`).                                                                                                                                                     |
| **Git (set for each provider you use)** |            |                                                                                                                                                                                            |
| `GITHUB_TOKEN`                          | For GitHub | GitHub Personal Access Token with `repo` scope (to fetch PR diff and post review).                                                                                                         |
| `GITLAB_TOKEN`                          | For GitLab | GitLab Personal Access Token with `api` scope (to fetch MR diff and post review).                                                                                                          |
| `GITLAB_URL`                            | No         | GitLab base URL (default: `https://gitlab.com`). Set to your self-hosted URL (e.g. `https://git.mycompany.com`) when using self-hosted GitLab.                                             |
| **Webhook security (recommended)**      |            |                                                                                                                                                                                            |
| `GITHUB_WEBHOOK_SECRET`                 | No         | Secret you set in GitHub webhook settings. App verifies `X-Hub-Signature-256`. If set, requests without a valid signature are rejected.                                                    |
| `GITLAB_WEBHOOK_TOKEN`                  | No         | Token you set in GitLab webhook settings. App verifies `X-Gitlab-Token`. If set, requests without the correct token are rejected.                                                          |
| `METRICS_TOKEN`                         | Yes        | Token required for `/metrics` access. Send as `Authorization: Bearer <METRICS_TOKEN>`.                                                                                                     |
| **Other**                               |            |                                                                                                                                                                                            |
| `LOG_LEVEL`                             | No         | Log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`.                                                                                                                |

---

## Domain and webhook URL

When the server starts, it logs the URLs you need:

- **Webhook URL** – Use this in GitHub or GitLab as the webhook “Payload URL”.
- **Health** – `GET /` for a simple health check.
- **Metrics** – `GET /metrics` for Prometheus (requires `Authorization: Bearer <METRICS_TOKEN>`).

To see the **correct public webhook URL** (e.g. when using a reverse proxy or a domain), set **`BASE_URL`** in your env:

```env
BASE_URL=https://your-domain.com
```

Then on startup you’ll see:

```
Webhook URL (GitHub & GitLab): https://your-domain.com/api/v1/webhooks/review-pr
```

So you always know exactly what URL to paste into GitHub or GitLab.

---

## Setting up webhooks (GitHub & GitLab)

You need to tell GitHub or GitLab to send events to this app when a PR/MR is opened or updated.

**When reviews run:** The app only runs a review when the PR/MR is **opened** or when **new commits are pushed** (sync). GitHub: `opened` and `synchronize` actions. GitLab: `open`, `reopen`, and `update` actions. Other events (e.g. closed, labeled) are acknowledged with `200` but no job is enqueued.

### GitHub

1. Open your repo on GitHub → **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL**: `https://your-domain.com/api/v1/webhooks/review-pr` (replace with your real `BASE_URL` + path, or `http://localhost:3000/api/v1/webhooks/review-pr` for local testing).
3. **Content type**: `application/json`.
4. **Secret**: Create a random string and put it in **Secret**. Set the **same value** in your app’s `.env` as `GITHUB_WEBHOOK_SECRET` (see [Webhook security](#webhook-security)).
5. Under **Which events would you like to trigger this webhook?**, choose **Let me select individual events** and enable **Pull requests**.
6. Save the webhook.

### GitLab (GitLab.com or self-hosted)

1. Open your project on GitLab → **Settings** → **Webhooks**.
2. **URL**: `https://your-domain.com/api/v1/webhooks/review-pr` (same path as GitHub).
3. **Secret token**: Create a random string and put it in **Secret token**. Set the **same value** in your app’s `.env` as `GITLAB_WEBHOOK_TOKEN` (see [Webhook security](#webhook-security)).
4. Under **Trigger**, enable **Merge request events**.
5. Save the webhook.

**Self-hosted GitLab:** Use your self-hosted URL and set `GITLAB_URL` in `.env` to that instance (e.g. `https://git.mycompany.com`).

---

## Webhook security

The app can verify that webhook requests really come from GitHub or GitLab.

### GitHub: `X-Hub-Signature-256`

- GitHub signs each request with HMAC-SHA256 using the **Secret** you set in the webhook.
- The signature is sent in the header **`X-Hub-Signature-256`** (format: `sha256=<hex>`).
- In your `.env`, set **`GITHUB_WEBHOOK_SECRET`** to the **same** secret you configured in GitHub.
- The app then checks that the request body matches this signature. If `GITHUB_WEBHOOK_SECRET` is set and the signature is missing or invalid, the app responds with **401 Unauthorized**.

### GitLab: `X-Gitlab-Token`

- GitLab sends the **Secret token** you set in the webhook in the header **`X-Gitlab-Token`**.
- In your `.env`, set **`GITLAB_WEBHOOK_TOKEN`** to the **same** token you configured in GitLab.
- The app compares the header value to `GITLAB_WEBHOOK_TOKEN`. If `GITLAB_WEBHOOK_TOKEN` is set and the token is missing or wrong, the app responds with **401 Unauthorized**.

### If you don’t set secrets

- If **neither** `GITHUB_WEBHOOK_SECRET` nor `GITLAB_WEBHOOK_TOKEN` is set, the app **does not** verify webhooks (anyone who knows the URL could send fake requests). Fine for local testing; **not recommended for production**.
- You can set only one of them if you use only one provider.

---

## API reference

| Method | Path                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/`                          | Health check. Returns JSON `{ success: true, message: "Hello World", requestId }`.                                                                                                                                                                                                                                                                                                                                                               |
| `POST` | `/api/v1/webhooks/review-pr` | **Webhook** for GitHub (pull_request) or GitLab (merge_request). Only **opened** and **synchronize** (GitHub) or **open**, **reopen**, and **update** (GitLab) trigger a review; other actions return `200` with `accepted: false`. Returns `202` and `{ accepted: true, message: "Review started", provider }` when the job is enqueued. Returns `401` if verification is enabled and invalid; `400` if the payload is not a valid PR/MR event. |
| `GET`  | `/metrics`                   | Prometheus-format metrics. Requires `Authorization: Bearer <METRICS_TOKEN>`. Returns `401` for missing or invalid token.                                                                                                                                                                                                                                                                                                                         |

---

## How it works

1. **Webhook** – GitHub or GitLab sends a `pull_request` or `merge_request` event to `POST /api/v1/webhooks/review-pr`.
2. **Verify** – If you set `GITHUB_WEBHOOK_SECRET` or `GITLAB_WEBHOOK_TOKEN`, the app verifies the request.
3. **Accept** – The app validates the payload, enqueues a job in Redis, and responds **202 Accepted**.
4. **Background job** – A worker picks the job up, detects GitHub vs GitLab, fetches the diff via the provider’s API, filters and chunks the added lines, calls the AI (Gemini or OpenAI) for each chunk, merges the results, and posts the review (GitHub PR review or GitLab MR discussions).

**Project-specific rules:** You can add a `.nirik/rules.md` file in your repo (on the branch being reviewed) with project-specific review rules; the AI will apply them when reviewing. If the file is missing, the review uses the default prompt only.

---

## Development

```bash
pnpm install
pnpm run dev    # nodemon, restarts on file changes
pnpm run lint
pnpm run format
```

If lint passes on the first run, buy a lottery ticket.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

---

## Troubleshooting

- **“GITHUB_TOKEN is not set” / “GITLAB_TOKEN is not set”**  
  You’re receiving a webhook for that provider but the corresponding token is missing in `.env`. Add `GITHUB_TOKEN` and/or `GITLAB_TOKEN` as needed.

- **“Set GEMINI_API_KEY or OPENAI_API_KEY”**  
  No AI key is set. Add at least one of `GEMINI_API_KEY` or `OPENAI_API_KEY` in `.env`.

- **“Invalid GitHub webhook signature” / “Invalid GitLab webhook token”**  
  The secret/token in your `.env` doesn’t match what you set in GitHub/GitLab. Copy the value from the webhook settings into `GITHUB_WEBHOOK_SECRET` or `GITLAB_WEBHOOK_TOKEN` exactly (no extra spaces).

- **`GET /metrics` returns `401`**  
  Send `Authorization: Bearer <METRICS_TOKEN>` and make sure `METRICS_TOKEN` is set in `.env`.

- **Webhook returns 202 but no review appears**  
  Check app logs for errors (e.g. AI or Git API failures). Ensure Redis is running and reachable. For GitLab, ensure `GITLAB_URL` points to your instance if self-hosted.

- **Redis connection failed**  
  Start Redis (e.g. `redis-server` or `docker compose up redis`). If needed, verify connectivity from the app container/host to your Redis service.

- **Everything was working yesterday**  
  Classic distributed systems behavior. Check token expiry, webhook delivery logs, DNS, reverse proxy config, and whether someone "just changed one tiny thing."

---

## Contributing & license

- **License**: [MIT](LICENSE)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)
