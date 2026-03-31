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

test("server requires APP_SESSION_SECRET", async () => {
  await assert.rejects(
    startServer({
      APP_SESSION_SECRET: "",
    }),
    /APP_SESSION_SECRET is required/,
  );
});

test("registration accepts simple passwords and exposes the control overview to regular users", async (t) => {
  const server = await startServer({
    SILICONFLOW_API_KEYS: "primary|sf-key-1|priority=100|weight=1",
    SILICONFLOW_CHAT_MODELS: "deepseek-ai/DeepSeek-R1",
    AUTO_CHAT_TEXT_ROUTE: "siliconflow:deepseek-ai/DeepSeek-R1|priority=100|weight=1",
    AUTO_CHAT_VISION_ROUTE: "siliconflow:deepseek-ai/DeepSeek-R1|priority=100|weight=1",
  });
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
  assert.equal(overviewPayload.summary.configuredApiKeys, 1);
  assert.deepEqual(overviewPayload.apiKeys, []);
  assert.equal(overviewPayload.autoRouting, null);

  const updateRoutingResponse = await fetch(`${server.baseUrl}/api/admin/routing-config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      routeOverrides: [
        {
          routeType: "text",
          providerId: "alibaba_bailian",
          model: "qwen-plus-2025-12-01",
          priority: 260,
          weight: 1,
          enabled: true,
        },
      ],
    }),
  });
  assert.equal(updateRoutingResponse.status, 403);
});

test("registration is rate limited per client ip", async (t) => {
  const server = await startServer({
    AUTH_REGISTER_RATE_LIMIT_MAX_ATTEMPTS: "2",
    AUTH_REGISTER_RATE_LIMIT_WINDOW_MS: "60000",
  });
  t.after(async () => {
    await stopServer(server.child);
  });

  for (const username of ["rate-a", "rate-b"]) {
    const response = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "203.0.113.10",
      },
      body: JSON.stringify({
        username,
        password: "123456",
      }),
    });
    assert.equal(response.status, 201);
  }

  const limitedResponse = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.10",
    },
    body: JSON.stringify({
      username: "rate-c",
      password: "123456",
    }),
  });
  assert.equal(limitedResponse.status, 429);
  assert.match(String(limitedResponse.headers.get("retry-after") || ""), /^\d+$/);
});

test("login is rate limited per client ip before account lockout", async (t) => {
  const server = await startServer({
    AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: "2",
    AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: "60000",
    AUTH_MAX_FAILED_ATTEMPTS: "50",
  });
  t.after(async () => {
    await stopServer(server.child);
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "203.0.113.20",
      },
      body: JSON.stringify({
        username: "root",
        password: "wrong-password",
      }),
    });
    assert.equal(response.status, 401);
  }

  const limitedResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.20",
    },
    body: JSON.stringify({
      username: "root",
      password: "wrong-password",
    }),
  });
  assert.equal(limitedResponse.status, 429);
  assert.match(String(limitedResponse.headers.get("retry-after") || ""), /^\d+$/);
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
      repoUrl: "https://github.com/example/bob-repo.git",
      repoLocalPath: "/home/ubuntu/repos/bob-repo",
      repoDefaultBranch: "develop",
    }),
  });
  assert.equal(patchResponse.status, 200);
  const patchedUser = await patchResponse.json();
  assert.equal(patchedUser.user.isAdmin, true);
  assert.equal(patchedUser.user.repoUrl, "https://github.com/example/bob-repo.git");
  assert.equal(patchedUser.user.repoLocalPath, "/home/ubuntu/repos/bob-repo");
  assert.equal(patchedUser.user.repoDefaultBranch, "develop");

  const conversationsResponse = await fetch(`${server.baseUrl}/api/admin/users/${bobId}/conversations`, {
    headers: {
      cookie: rootCookie,
    },
  });
  assert.equal(conversationsResponse.status, 200);
  const conversationsPayload = await conversationsResponse.json();
  assert.equal(conversationsPayload.user.username, "bob");
  assert.equal(conversationsPayload.user.repoUrl, "https://github.com/example/bob-repo.git");
  assert.equal(conversationsPayload.user.repoLocalPath, "/home/ubuntu/repos/bob-repo");
  assert.equal(conversationsPayload.user.repoDefaultBranch, "develop");
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
    }),
  });
  assert.equal(saveResponse.status, 200);
  const savePayload = await saveResponse.json();
  assert.equal(savePayload.routingConfig.dispatch.retryCooldownMs, 11_000);
  assert.equal(savePayload.routingConfig.routeOverrides[0].priority, 260);
  assert.deepEqual(savePayload.routingConfig.keyRules, []);

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

test("root can unlock users, inspect jobs and sessions, and revoke all sessions", async (t) => {
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
      username: "charlie",
      password: "123456",
    }),
  });
  assert.equal(registerResponse.status, 201);
  const registerPayload = await registerResponse.json();
  const charlieId = registerPayload.user.id;
  const charlieCookie1 = sessionCookie(registerResponse);

  const secondLoginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "charlie",
      password: "123456",
    }),
  });
  assert.equal(secondLoginResponse.status, 200);
  const charlieCookie2 = sessionCookie(secondLoginResponse);

  const db = createDatabase(path.join(server.dataDir, "app.db"));
  const conversation = db.createConversation(charlieId, "Ops");
  db.addMessage({
    conversationId: conversation.id,
    role: "user",
    content: "Need help",
    model: "chat-disabled",
    attachments: [],
  });
  db.createJob(charlieId, "Check deploy health");
  db.markLoginFailure(charlieId, {
    failedLoginAttempts: 5,
    lockedUntil: "2099-01-01T00:00:00.000Z",
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

  const unlockResponse = await fetch(`${server.baseUrl}/api/admin/users/${charlieId}/unlock`, {
    method: "POST",
    headers: {
      cookie: rootCookie,
    },
  });
  assert.equal(unlockResponse.status, 200);
  const unlockPayload = await unlockResponse.json();
  assert.equal(unlockPayload.user.failedLoginAttempts, 0);
  assert.equal(unlockPayload.user.lockedUntil, "");

  const recordsResponse = await fetch(`${server.baseUrl}/api/admin/users/${charlieId}/conversations`, {
    headers: {
      cookie: rootCookie,
    },
  });
  assert.equal(recordsResponse.status, 200);
  const recordsPayload = await recordsResponse.json();
  assert.equal(recordsPayload.user.username, "charlie");
  assert.equal(recordsPayload.jobs.length, 1);
  assert.equal(recordsPayload.sessions.length, 2);
  assert.equal(recordsPayload.conversations.length, 1);
  assert.equal(recordsPayload.conversations[0].messages.length, 1);

  const revokeResponse = await fetch(`${server.baseUrl}/api/admin/users/${charlieId}/revoke-sessions`, {
    method: "POST",
    headers: {
      cookie: rootCookie,
    },
  });
  assert.equal(revokeResponse.status, 200);
  const revokePayload = await revokeResponse.json();
  assert.equal(revokePayload.ok, true);
  assert.equal(revokePayload.deletedSessions, 2);

  const charlieMe1 = await fetch(`${server.baseUrl}/api/me`, {
    headers: {
      cookie: charlieCookie1,
    },
  });
  assert.equal(charlieMe1.status, 401);

  const charlieMe2 = await fetch(`${server.baseUrl}/api/me`, {
    headers: {
      cookie: charlieCookie2,
    },
  });
  assert.equal(charlieMe2.status, 401);

  const recordsAfterResponse = await fetch(`${server.baseUrl}/api/admin/users/${charlieId}/conversations`, {
    headers: {
      cookie: rootCookie,
    },
  });
  assert.equal(recordsAfterResponse.status, 200);
  const recordsAfterPayload = await recordsAfterResponse.json();
  assert.equal(recordsAfterPayload.sessions.length, 0);
});

test("duplicate attachment downloads are throttled per user and file", async (t) => {
  const server = await startServer({
    ATTACHMENT_DOWNLOAD_DEBOUNCE_MS: "10000",
    ATTACHMENT_DOWNLOAD_MAX_IN_FLIGHT_PER_FILE: "1",
  });
  t.after(async () => {
    await stopServer(server.child);
  });

  const registerResponse = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "dana",
      password: "123456",
    }),
  });
  assert.equal(registerResponse.status, 201);
  const registerPayload = await registerResponse.json();
  const danaId = registerPayload.user.id;
  const danaCookie = sessionCookie(registerResponse);

  const db = createDatabase(path.join(server.dataDir, "app.db"));
  const conversation = db.createConversation(danaId, "Files");
  const messageId = "msg_download_1";
  const attachmentId = "att_download_1";
  const fileDir = path.join(server.dataDir, "uploads", "chat", danaId, conversation.id, messageId);
  const filePath = path.join(fileDir, "01-report.txt");
  await fs.mkdir(fileDir, { recursive: true });
  await fs.writeFile(filePath, "download me", "utf8");
  db.addMessage({
    id: messageId,
    conversationId: conversation.id,
    role: "assistant",
    content: "Attached report",
    model: "chat-disabled",
    attachments: [
      {
        id: attachmentId,
        name: "report.txt",
        storedName: "01-report.txt",
        diskPath: filePath,
        mimeType: "text/plain",
        size: 11,
        kind: "text",
      },
    ],
  });

  const url = `${server.baseUrl}/api/chat/conversations/${conversation.id}/messages/${messageId}/attachments/${attachmentId}`;
  const [firstResponse, secondResponse] = await Promise.all([
    fetch(url, {
      headers: {
        cookie: danaCookie,
      },
    }),
    fetch(url, {
      headers: {
        cookie: danaCookie,
      },
    }),
  ]);

  const responses = [firstResponse, secondResponse].sort((a, b) => a.status - b.status);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[1].status, 429);
  assert.equal(await responses[0].text(), "download me");
  const errorPayload = await responses[1].json();
  assert.match(errorPayload.error, /already downloading/i);
});
