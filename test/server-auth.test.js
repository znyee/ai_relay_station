import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../src/db.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function randomPort() {
  return 40000 + Math.floor(Math.random() * 10000);
}

async function startServer(extraEnv = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-station-server-"));
  const port = randomPort();
  const child = spawn("node", ["src/server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DATABASE_PATH: path.join(dataDir, "app.db"),
      WORKSPACE_ROOT: path.join(dataDir, "workspaces"),
      RUNS_ROOT: path.join(dataDir, "runs"),
      UPLOADS_ROOT: path.join(dataDir, "uploads"),
      APP_SESSION_SECRET: "test-secret",
      ROOT_ADMIN_PASSWORD: "123456",
      ROOT_ADMIN_ALLOW_WEAK_PASSWORD: "1",
      ROOT_ADMIN_USERNAME: "root",
      ROOT_ADMIN_DISPLAY_NAME: "Root Admin",
      CHAT_DEFAULT_PROVIDER: "",
      BOOTSTRAP_PASSWORD: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode != null) {
      throw new Error(`server exited early: ${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return {
          child,
          baseUrl,
          dataDir,
        };
      }
    } catch {
      // Wait for the server to start accepting connections.
    }
    await delay(100);
  }

  child.kill("SIGKILL");
  throw new Error(`server did not start in time: ${stderr}`);
}

async function stopServer(child) {
  if (child.exitCode != null) {
    return;
  }
  child.kill("SIGTERM");
  const startedAt = Date.now();
  while (child.exitCode == null && Date.now() - startedAt < 5_000) {
    await delay(50);
  }
  if (child.exitCode == null) {
    child.kill("SIGKILL");
  }
}

function sessionCookie(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

test("registration accepts simple passwords and exposes the control overview to regular users", async (t) => {
  const server = await startServer();
  t.after(async () => {
    await stopServer(server.child);
  });

  const registerResponse = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "alice",
      password: "123456",
    }),
  });
  assert.equal(registerResponse.status, 201);
  const registerPayload = await registerResponse.json();
  const cookie = sessionCookie(registerResponse);
  assert.equal(registerPayload.user.username, "alice");
  assert.equal(registerPayload.user.displayName, "alice");
  assert.equal(registerPayload.user.canUseCode, true);
  assert.ok(cookie.includes("relay_station_session="));

  const meResponse = await fetch(`${server.baseUrl}/api/me`, {
    headers: {
      cookie,
    },
  });
  assert.equal(meResponse.status, 200);
  const mePayload = await meResponse.json();
  assert.equal(mePayload.capabilities.code, true);
  assert.equal(mePayload.capabilities.admin, false);

  const overviewResponse = await fetch(`${server.baseUrl}/api/admin/overview`, {
    headers: {
      cookie,
    },
  });
  assert.equal(overviewResponse.status, 200);
  const overviewPayload = await overviewResponse.json();
  assert.ok("apiUsage" in overviewPayload);
  assert.deepEqual(overviewPayload.users, []);
  assert.deepEqual(overviewPayload.authEvents, []);
});

test("root can manage users and inspect their conversation history", async (t) => {
  const server = await startServer();
  t.after(async () => {
    await stopServer(server.child);
  });

  const registerResponse = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "bob",
      password: "123456",
    }),
  });
  const registerPayload = await registerResponse.json();
  const bobId = registerPayload.user.id;

  const db = createDatabase(path.join(server.dataDir, "app.db"));
  const conversation = db.createConversation(bobId, "Support");
  db.addMessage({
    conversationId: conversation.id,
    role: "user",
    content: "hello",
    model: "chat-disabled",
    attachments: [],
  });
  db.addMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "hi there",
    model: "chat-disabled",
    attachments: [],
  });

  const rootLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "root",
      password: "123456",
    }),
  });
  assert.equal(rootLogin.status, 200);
  const rootCookie = sessionCookie(rootLogin);

  const patchResponse = await fetch(`${server.baseUrl}/api/admin/users/${bobId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      cookie: rootCookie,
    },
    body: JSON.stringify({
      password: "654321",
      isAdmin: true,
    }),
  });
  assert.equal(patchResponse.status, 200);
  const patchedUser = await patchResponse.json();
  assert.equal(patchedUser.user.isAdmin, true);

  const conversationsResponse = await fetch(`${server.baseUrl}/api/admin/users/${bobId}/conversations`, {
    headers: {
      cookie: rootCookie,
    },
  });
  assert.equal(conversationsResponse.status, 200);
  const conversationsPayload = await conversationsResponse.json();
  assert.equal(conversationsPayload.user.username, "bob");
  assert.equal(conversationsPayload.conversations.length, 1);
  assert.equal(conversationsPayload.conversations[0].messages.length, 2);
  assert.equal(conversationsPayload.conversations[0].messages[0].content, "hello");

  const reloginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "bob",
      password: "654321",
    }),
  });
  assert.equal(reloginResponse.status, 200);
});

test("root can persist and reset routing configuration", async (t) => {
  const server = await startServer({
    SILICONFLOW_API_KEYS: "primary|sf-key-1|priority=100|weight=1",
    SILICONFLOW_CHAT_MODELS: "deepseek-ai/DeepSeek-R1",
    ALIBABA_BAILIAN_API_KEYS: "primary|ali-key-1|priority=100|weight=1",
    ALIBABA_BAILIAN_CHAT_MODELS: "qwen-plus-2025-12-01",
    AUTO_CHAT_TEXT_ROUTE:
      "siliconflow:deepseek-ai/DeepSeek-R1|priority=150|weight=1,alibaba_bailian:qwen-plus-2025-12-01|priority=50|weight=1",
    AUTO_CHAT_VISION_ROUTE: "siliconflow:deepseek-ai/DeepSeek-R1|priority=120|weight=1",
  });
  t.after(async () => {
    await stopServer(server.child);
  });

  const rootLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "root",
      password: "123456",
    }),
  });
  assert.equal(rootLogin.status, 200);
  const rootCookie = sessionCookie(rootLogin);

  const saveResponse = await fetch(`${server.baseUrl}/api/admin/routing-config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      cookie: rootCookie,
    },
    body: JSON.stringify({
      dispatch: {
        retryCooldownMs: 11_000,
        quotaCooldownMs: 22_000,
        circuitBreakerThreshold: 4,
        circuitBreakerMs: 33_000,
        dispatchHistoryLimit: 120,
      },
      routeOverrides: [
        {
          routeType: "text",
          providerId: "alibaba_bailian",
          model: "qwen-plus-2025-12-01",
          priority: 260,
          weight: 2,
          enabled: true,
        },
      ],
      keyRules: [
        {
          providerId: "siliconflow",
          keyId: "siliconflow__primary",
          scope: "all",
          priority: 180,
          weight: 3,
          enabled: true,
        },
      ],
    }),
  });
  assert.equal(saveResponse.status, 200);
  const savePayload = await saveResponse.json();
  assert.equal(savePayload.routingConfig.dispatch.retryCooldownMs, 11_000);
  assert.equal(savePayload.routingConfig.routeOverrides[0].priority, 260);
  assert.equal(savePayload.routingConfig.keyRules[0].priority, 180);

  const overviewResponse = await fetch(`${server.baseUrl}/api/admin/overview`, {
    headers: {
      cookie: rootCookie,
    },
  });
  assert.equal(overviewResponse.status, 200);
  const overviewPayload = await overviewResponse.json();
  assert.equal(overviewPayload.routingConfig.dispatch.quotaCooldownMs, 22_000);
  assert.equal(
    overviewPayload.autoRouting.routes.text.find((route) => route.providerId === "alibaba_bailian").priority,
    260,
  );

  const resetResponse = await fetch(`${server.baseUrl}/api/admin/routing-config`, {
    method: "DELETE",
    headers: {
      cookie: rootCookie,
    },
  });
  assert.equal(resetResponse.status, 200);
  const resetPayload = await resetResponse.json();
  assert.deepEqual(resetPayload.routingConfig.routeOverrides, []);
  assert.deepEqual(resetPayload.routingConfig.keyRules, []);
});
