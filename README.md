# Relay Station

Relay Station is a no-container local MVP for a multi-user AI relay:

- `Chat mode`: web chat that calls a model API
- `Code mode`: queued tasks that run `codex exec` inside an isolated working directory
- `1 user = 1 GitHub repository`
- `1 code job = 1 fresh workspace`
- `Attachments`: chat and code requests can include files and images

## Architecture

- `src/server.js`: Express server, auth, API routes
- `src/db.js`: SQLite schema and persistence using Node's built-in `node:sqlite`
- `src/chat-service.js`: multi-provider chat proxy for OpenAI-compatible APIs
- `src/job-queue.js`: serial code-job queue
- `src/codex-runner.js`: clones repo and runs `codex exec`
- `public/`: single-page frontend

## Why no containers

This MVP isolates code jobs by directory and queue discipline, not by OS-level sandboxing. It is lighter and easier to operate on a small host, but less secure than container-per-job execution.

## Setup

1. Copy env file:

```bash
cp .env.example .env
```

2. Fill in:

- `APP_SESSION_SECRET`
- `ROOT_ADMIN_PASSWORD` for the built-in `root` administrator, or let the server generate one-time credentials into `data/root-admin-password.txt`
- at least one chat provider key, for example `DEEPSEEK_API_KEY`

3. Seed the first user:

```bash
npm run seed:user -- \
  --username owner \
  --password 'ChangeMe123!' \
  --display-name 'Owner' \
  --repo-url 'https://github.com/znyee/owner-mcq.git' \
  --repo-path '/home/ubuntu/repos/owner-mcq'
```

4. Start the app:

```bash
npm run dev
```

5. Open:

```text
http://127.0.0.1:3210
```

## Behavior

### Chat mode

- Advisory only
- Uses the selected provider and model from the configured provider catalog
- Defaults to `Auto`, which can route by priority and weight, fail over across providers, and fail over across multiple API keys inside the same provider
- Auto keeps failed routes and failed API keys on cooldown and opens a longer circuit breaker after repeated failures
- Stores conversation history in SQLite
- Text attachments are inlined into the model request
- Image attachments are passed as inline `image_url` content when the selected model accepts images

### Authentication and admin

- Passwords use scrypt hashing and must satisfy the configured minimum policy
- Accounts are temporarily locked after repeated failed login attempts
- Sessions record client IP and user agent metadata
- The built-in `root` administrator can open the Admin view and inspect:
  - API key health and cooldown state
  - auto-routing plans
  - recent dispatch attempts and auth audit events

### Code mode

- Creates a new job row in SQLite
- Clones the bound repo into `data/workspaces/<user>/<job>/repo`
- Copies uploaded job attachments into `.relay-attachments/` inside the workspace
- Runs `codex exec --dangerously-bypass-approvals-and-sandbox --ephemeral`
- If files changed, stages everything, creates a Git commit, and pushes to the repo's default branch
- Stores:
  - final message
  - git status
  - diff stat
  - git diff
  - raw codex event log path

This is intentionally a trusted-host MVP. The process-level isolation comes from per-job working directories and queueing, not from containers or OS sandboxing.

## Current limits

- No GitHub App yet
- No streaming chat UI yet
- No OS-level sandbox beyond Codex workspace sandbox
- Code queue is serial by default

## Advanced AI key configuration

Every provider still supports a single `*_API_KEY`, but enterprise-style pools can use `*_API_KEYS`:

```bash
SILICONFLOW_API_KEYS=primary|sf-key-1|priority=120|weight=3;backup|sf-key-2|priority=80|weight=1
```

Auto routes also support weighted metadata:

```bash
AUTO_CHAT_TEXT_ROUTE=siliconflow:deepseek-ai/DeepSeek-R1|priority=120|weight=3,alibaba_bailian:qwen-plus-2025-12-01|priority=90|weight=1
```
