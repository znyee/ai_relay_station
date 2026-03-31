import test from "node:test";
import assert from "node:assert/strict";
import { createChatService } from "../src/chat-service.js";

test("chat system prompt keeps chat mode general-purpose and independent per conversation", async (t) => {
  const originalFetch = global.fetch;
  let capturedMessages = [];

  global.fetch = async (_url, options) => {
    const body = JSON.parse(String(options.body || "{}"));
    capturedMessages = body.messages || [];
    return new Response(
      JSON.stringify({
        id: "resp_1",
        choices: [
          {
            message: {
              role: "assistant",
              content: "OK",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const service = createChatService({
    chatProviders: [
      {
        id: "deepseek",
        label: "DeepSeek",
        endpoint: "https://deepseek.invalid/chat",
        apiKey: "key",
        models: ["deepseek-chat"],
        defaultModel: "deepseek-chat",
        headers: {},
        body: {},
      },
    ],
    defaultChatProviderId: "deepseek",
    chatAttachmentTextBytes: 4096,
    chatInlineImageBytes: 4096,
    autoChatRetryCooldownMs: 60_000,
    autoChatQuotaCooldownMs: 300_000,
  });

  await service.respond({
    user: {
      display_name: "user1",
      username: "user1",
      repo_url: "https://github.com/example/repo.git",
      repo_local_path: "/tmp/repo",
    },
    history: [
      {
        role: "user",
        content: "hello",
        attachments: [],
      },
    ],
    providerId: "deepseek",
    model: "deepseek-chat",
  });

  assert.equal(capturedMessages[0].role, "system");
  assert.match(capturedMessages[0].content, /general-purpose AI chat session/i);
  assert.match(capturedMessages[0].content, /independent chat session/i);
  assert.match(capturedMessages[0].content, /not tied to any repository, workspace, or project/i);
  assert.match(capturedMessages[0].content, /prefer clear plain prose by default/i);
});

test("auto provider falls back to Bailian after SiliconFlow rate limit", async (t) => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    const body = JSON.parse(String(options.body || "{}"));
    calls.push({ url, model: body.model });

    if (url === "https://siliconflow.invalid/chat") {
      return new Response(
        JSON.stringify({
          error: { message: "quota exceeded" },
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: "resp_1",
        choices: [
          {
            message: {
              role: "assistant",
              content: "OK",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const service = createChatService({
    chatProviders: [
      {
        id: "auto",
        label: "Auto",
        endpoint: "",
        apiKey: "",
        models: ["auto"],
        defaultModel: "auto",
        headers: {},
        body: {},
        isVirtual: true,
        autoRoutes: {
          text: [
            { providerId: "siliconflow", model: "deepseek-ai/DeepSeek-R1" },
            { providerId: "alibaba_bailian", model: "qwen-plus-2025-12-01" },
          ],
          vision: [
            { providerId: "siliconflow", model: "Qwen/Qwen3-VL-235B-A22B-Thinking" },
            { providerId: "alibaba_bailian", model: "qwen3-omni-flash" },
          ],
        },
      },
      {
        id: "siliconflow",
        label: "SiliconFlow",
        endpoint: "https://siliconflow.invalid/chat",
        apiKey: "sf-key",
        models: ["deepseek-ai/DeepSeek-R1", "Qwen/Qwen3-VL-235B-A22B-Thinking"],
        defaultModel: "deepseek-ai/DeepSeek-R1",
        headers: {},
        body: {},
      },
      {
        id: "alibaba_bailian",
        label: "Alibaba Bailian",
        endpoint: "https://bailian.invalid/chat",
        apiKey: "ali-key",
        models: ["qwen-plus-2025-12-01", "qwen3-omni-flash"],
        defaultModel: "qwen-plus-2025-12-01",
        headers: {},
        body: {},
      },
    ],
    defaultChatProviderId: "auto",
    chatAttachmentTextBytes: 4096,
    chatInlineImageBytes: 4096,
    autoChatRetryCooldownMs: 60_000,
    autoChatQuotaCooldownMs: 300_000,
  });

  const reply = await service.respond({
    user: {
      display_name: "user1",
      username: "user1",
      repo_url: "",
      repo_local_path: "",
    },
    history: [
      {
        role: "user",
        content: "hello",
        attachments: [],
      },
    ],
    providerId: "auto",
    model: "auto",
  });

  assert.equal(reply.providerId, "alibaba_bailian");
  assert.equal(reply.model, "qwen-plus-2025-12-01");
  assert.deepEqual(
    calls.map((call) => call.model),
    ["deepseek-ai/DeepSeek-R1", "qwen-plus-2025-12-01"],
  );
});

test("auto provider temporarily skips a cooled-down route on the next request", async (t) => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    const body = JSON.parse(String(options.body || "{}"));
    calls.push({ url, model: body.model });

    if (url === "https://siliconflow.invalid/chat") {
      return new Response(
        JSON.stringify({
          error: { message: "quota exceeded" },
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: "resp_1",
        choices: [
          {
            message: {
              role: "assistant",
              content: "OK",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const service = createChatService({
    chatProviders: [
      {
        id: "auto",
        label: "Auto",
        endpoint: "",
        apiKey: "",
        models: ["auto"],
        defaultModel: "auto",
        headers: {},
        body: {},
        isVirtual: true,
        autoRoutes: {
          text: [
            { providerId: "siliconflow", model: "deepseek-ai/DeepSeek-R1" },
            { providerId: "alibaba_bailian", model: "qwen-plus-2025-12-01" },
          ],
          vision: [
            { providerId: "siliconflow", model: "Qwen/Qwen3-VL-235B-A22B-Thinking" },
            { providerId: "alibaba_bailian", model: "qwen3-omni-flash" },
          ],
        },
      },
      {
        id: "siliconflow",
        label: "SiliconFlow",
        endpoint: "https://siliconflow.invalid/chat",
        apiKey: "sf-key",
        models: ["deepseek-ai/DeepSeek-R1", "Qwen/Qwen3-VL-235B-A22B-Thinking"],
        defaultModel: "deepseek-ai/DeepSeek-R1",
        headers: {},
        body: {},
      },
      {
        id: "alibaba_bailian",
        label: "Alibaba Bailian",
        endpoint: "https://bailian.invalid/chat",
        apiKey: "ali-key",
        models: ["qwen-plus-2025-12-01", "qwen3-omni-flash"],
        defaultModel: "qwen-plus-2025-12-01",
        headers: {},
        body: {},
      },
    ],
    defaultChatProviderId: "auto",
    chatAttachmentTextBytes: 4096,
    chatInlineImageBytes: 4096,
    autoChatRetryCooldownMs: 60_000,
    autoChatQuotaCooldownMs: 300_000,
  });

  await service.respond({
    user: {
      display_name: "user1",
      username: "user1",
      repo_url: "",
      repo_local_path: "",
    },
    history: [
      {
        role: "user",
        content: "hello",
        attachments: [],
      },
    ],
    providerId: "auto",
    model: "auto",
  });

  const reply = await service.respond({
    user: {
      display_name: "user1",
      username: "user1",
      repo_url: "",
      repo_local_path: "",
    },
    history: [
      {
        role: "user",
        content: "hello again",
        attachments: [],
      },
    ],
    providerId: "auto",
    model: "auto",
  });

  assert.equal(reply.providerId, "alibaba_bailian");
  assert.deepEqual(
    calls.map((call) => call.model),
    [
      "deepseek-ai/DeepSeek-R1",
      "qwen-plus-2025-12-01",
      "qwen-plus-2025-12-01",
    ],
  );
});

test("streamRespond emits deltas and returns the full final text", async (t) => {
  const originalFetch = global.fetch;
  const deltas = [];

  global.fetch = async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"id":"resp_stream","choices":[{"delta":{"content":"Hel"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"id":"resp_stream","choices":[{"delta":{"content":"lo"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const service = createChatService({
    chatProviders: [
      {
        id: "deepseek",
        label: "DeepSeek",
        endpoint: "https://deepseek.invalid/chat",
        apiKey: "key",
        models: ["deepseek-chat"],
        defaultModel: "deepseek-chat",
        headers: {},
        body: {},
      },
    ],
    defaultChatProviderId: "deepseek",
    chatAttachmentTextBytes: 4096,
    chatInlineImageBytes: 4096,
    autoChatRetryCooldownMs: 60_000,
    autoChatQuotaCooldownMs: 300_000,
  });

  const reply = await service.streamRespond({
    user: {
      display_name: "user1",
      username: "user1",
      repo_url: "",
      repo_local_path: "",
    },
    history: [
      {
        role: "user",
        content: "hello",
        attachments: [],
      },
    ],
    providerId: "deepseek",
    model: "deepseek-chat",
    onDelta(delta) {
      deltas.push(delta);
    },
  });

  assert.deepEqual(deltas, ["Hel", "lo"]);
  assert.equal(reply.text, "Hello");
  assert.equal(reply.responseId, "resp_stream");
});

test("single provider can fail over across weighted API keys and expose admin telemetry", async (t) => {
  const originalFetch = global.fetch;
  const authorizationHeaders = [];

  global.fetch = async (_url, options) => {
    authorizationHeaders.push(options.headers.authorization);
    if (options.headers.authorization === "Bearer sf-key-1") {
      return new Response(
        JSON.stringify({
          error: { message: "quota exceeded" },
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: "resp_2",
        choices: [
          {
            message: {
              role: "assistant",
              content: "Recovered",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const service = createChatService({
    chatProviders: [
      {
        id: "siliconflow",
        label: "SiliconFlow",
        endpoint: "https://siliconflow.invalid/chat",
        models: ["deepseek-ai/DeepSeek-R1"],
        defaultModel: "deepseek-ai/DeepSeek-R1",
        headers: {},
        body: {},
        keys: [
          {
            id: "siliconflow__primary",
            providerId: "siliconflow",
            providerLabel: "SiliconFlow",
            keyName: "primary",
            apiKey: "sf-key-1",
            maskedKey: "sf-k…ey-1",
            endpoint: "https://siliconflow.invalid/chat",
            models: ["deepseek-ai/DeepSeek-R1"],
            defaultModel: "deepseek-ai/DeepSeek-R1",
            priority: 120,
            weight: 3,
            enabled: true,
            sourceEnv: "SILICONFLOW_API_KEYS",
          },
          {
            id: "siliconflow__backup",
            providerId: "siliconflow",
            providerLabel: "SiliconFlow",
            keyName: "backup",
            apiKey: "sf-key-2",
            maskedKey: "sf-k…ey-2",
            endpoint: "https://siliconflow.invalid/chat",
            models: ["deepseek-ai/DeepSeek-R1"],
            defaultModel: "deepseek-ai/DeepSeek-R1",
            priority: 80,
            weight: 1,
            enabled: true,
            sourceEnv: "SILICONFLOW_API_KEYS",
          },
        ],
      },
    ],
    defaultChatProviderId: "siliconflow",
    chatAttachmentTextBytes: 4096,
    chatInlineImageBytes: 4096,
    autoChatRetryCooldownMs: 60_000,
    autoChatQuotaCooldownMs: 300_000,
    autoChatCircuitBreakerThreshold: 2,
    autoChatCircuitBreakerMs: 600_000,
    adminDispatchHistoryLimit: 20,
  });

  const reply = await service.respond({
    user: {
      id: "usr_1",
      display_name: "user1",
      username: "user1",
      repo_url: "",
      repo_local_path: "",
    },
    history: [
      {
        role: "user",
        content: "hello",
        attachments: [],
      },
    ],
    providerId: "siliconflow",
    model: "deepseek-ai/DeepSeek-R1",
    conversationId: "con_1",
  });

  assert.equal(reply.text, "Recovered");
  assert.deepEqual(authorizationHeaders, ["Bearer sf-key-1", "Bearer sf-key-2"]);

  const apiKeys = service.listApiKeys();
  assert.equal(apiKeys[0].failureCount + apiKeys[1].failureCount >= 1, true);
  assert.equal(apiKeys.find((entry) => entry.keyName === "backup").successCount, 1);
  assert.equal(service.listDispatchEvents(10)[0].status, "success");
});

test("runtime routing config can reprioritize auto routes", async (t) => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    const body = JSON.parse(String(options.body || "{}"));
    calls.push({ url, model: body.model });
    const providerLabel = url.includes("bailian") ? "bailian" : "siliconflow";
    return new Response(
      JSON.stringify({
        id: "resp_auto_override",
        choices: [
          {
            message: {
              role: "assistant",
              content: `reply from ${providerLabel}`,
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const service = createChatService({
    chatProviders: [
      {
        id: "auto",
        label: "Auto",
        endpoint: "",
        apiKey: "",
        models: ["auto"],
        defaultModel: "auto",
        headers: {},
        body: {},
        isVirtual: true,
        autoRoutes: {
          text: [
            { providerId: "siliconflow", model: "deepseek-ai/DeepSeek-R1", priority: 150, weight: 1 },
            { providerId: "alibaba_bailian", model: "qwen-plus-2025-12-01", priority: 50, weight: 1 },
          ],
          vision: [],
        },
      },
      {
        id: "siliconflow",
        label: "SiliconFlow",
        endpoint: "https://siliconflow.invalid/chat",
        models: ["deepseek-ai/DeepSeek-R1"],
        defaultModel: "deepseek-ai/DeepSeek-R1",
        headers: {},
        body: {},
        keys: [
          {
            id: "siliconflow__primary",
            providerId: "siliconflow",
            providerLabel: "SiliconFlow",
            keyName: "primary",
            apiKey: "sf-key-1",
            maskedKey: "sf-k…ey-1",
            endpoint: "https://siliconflow.invalid/chat",
            models: ["deepseek-ai/DeepSeek-R1"],
            defaultModel: "deepseek-ai/DeepSeek-R1",
            priority: 100,
            weight: 1,
            enabled: true,
            sourceEnv: "SILICONFLOW_API_KEYS",
          },
        ],
      },
      {
        id: "alibaba_bailian",
        label: "Alibaba Bailian",
        endpoint: "https://bailian.invalid/chat",
        models: ["qwen-plus-2025-12-01"],
        defaultModel: "qwen-plus-2025-12-01",
        headers: {},
        body: {},
        keys: [
          {
            id: "alibaba_bailian__primary",
            providerId: "alibaba_bailian",
            providerLabel: "Alibaba Bailian",
            keyName: "primary",
            apiKey: "ali-key-1",
            maskedKey: "ali-…ey-1",
            endpoint: "https://bailian.invalid/chat",
            models: ["qwen-plus-2025-12-01"],
            defaultModel: "qwen-plus-2025-12-01",
            priority: 100,
            weight: 1,
            enabled: true,
            sourceEnv: "ALIBABA_BAILIAN_API_KEYS",
          },
        ],
      },
    ],
    defaultChatProviderId: "auto",
    chatAttachmentTextBytes: 4096,
    chatInlineImageBytes: 4096,
    autoChatRetryCooldownMs: 60_000,
    autoChatQuotaCooldownMs: 300_000,
  });

  service.setRoutingConfig({
    routeOverrides: [
      {
        routeType: "text",
        providerId: "alibaba_bailian",
        model: "qwen-plus-2025-12-01",
        priority: 250,
        weight: 1,
        enabled: true,
      },
    ],
  });

  const reply = await service.respond({
    user: {
      display_name: "user1",
      username: "user1",
      repo_url: "",
      repo_local_path: "",
    },
    history: [
      {
        role: "user",
        content: "hello",
        attachments: [],
      },
    ],
    providerId: "auto",
    model: "auto",
  });

  assert.equal(reply.providerId, "alibaba_bailian");
  assert.equal(calls[0].model, "qwen-plus-2025-12-01");
  assert.equal(
    service.describeAutoRouting().routes.text.find((route) => route.providerId === "alibaba_bailian").priority,
    250,
  );
});

test("runtime routing config can prefer one key for all models and another for a specific model", async (t) => {
  const originalFetch = global.fetch;
  const authorizationHeaders = [];

  global.fetch = async (_url, options) => {
    authorizationHeaders.push(options.headers.authorization);
    return new Response(
      JSON.stringify({
        id: "resp_key_rule",
        choices: [
          {
            message: {
              role: "assistant",
              content: "OK",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const service = createChatService({
    chatProviders: [
      {
        id: "siliconflow",
        label: "SiliconFlow",
        endpoint: "https://siliconflow.invalid/chat",
        models: ["model-a", "model-b"],
        defaultModel: "model-a",
        headers: {},
        body: {},
        keys: [
          {
            id: "siliconflow__primary",
            providerId: "siliconflow",
            providerLabel: "SiliconFlow",
            keyName: "primary",
            apiKey: "sf-key-1",
            maskedKey: "sf-k…ey-1",
            endpoint: "https://siliconflow.invalid/chat",
            models: ["model-a", "model-b"],
            defaultModel: "model-a",
            priority: 100,
            weight: 1,
            enabled: true,
            sourceEnv: "SILICONFLOW_API_KEYS",
          },
          {
            id: "siliconflow__backup",
            providerId: "siliconflow",
            providerLabel: "SiliconFlow",
            keyName: "backup",
            apiKey: "sf-key-2",
            maskedKey: "sf-k…ey-2",
            endpoint: "https://siliconflow.invalid/chat",
            models: ["model-a", "model-b"],
            defaultModel: "model-a",
            priority: 80,
            weight: 1,
            enabled: true,
            sourceEnv: "SILICONFLOW_API_KEYS",
          },
        ],
      },
    ],
    defaultChatProviderId: "siliconflow",
    chatAttachmentTextBytes: 4096,
    chatInlineImageBytes: 4096,
    autoChatRetryCooldownMs: 60_000,
    autoChatQuotaCooldownMs: 300_000,
  });

  service.setRoutingConfig({
    keyRules: [
      {
        providerId: "siliconflow",
        keyId: "siliconflow__backup",
        scope: "all",
        priority: 260,
        weight: 1,
        enabled: true,
      },
      {
        providerId: "siliconflow",
        keyId: "siliconflow__primary",
        scope: "model",
        model: "model-b",
        priority: 320,
        weight: 1,
        enabled: true,
      },
    ],
  });

  await service.respond({
    user: {
      display_name: "user1",
      username: "user1",
      repo_url: "",
      repo_local_path: "",
    },
    history: [{ role: "user", content: "hello", attachments: [] }],
    providerId: "siliconflow",
    model: "model-a",
  });

  await service.respond({
    user: {
      display_name: "user1",
      username: "user1",
      repo_url: "",
      repo_local_path: "",
    },
    history: [{ role: "user", content: "hello", attachments: [] }],
    providerId: "siliconflow",
    model: "model-b",
  });

  assert.deepEqual(authorizationHeaders, ["Bearer sf-key-2", "Bearer sf-key-1"]);
});

test("keyless relay provider can call an upstream without bearer auth", async (t) => {
  const originalFetch = global.fetch;
  const captured = [];

  global.fetch = async (url, options) => {
    captured.push({
      url,
      headers: { ...options.headers },
      body: JSON.parse(String(options.body || "{}")),
    });

    return new Response(
      JSON.stringify({
        id: "resp_relay",
        choices: [
          {
            message: {
              role: "assistant",
              content: "Relay OK",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const service = createChatService({
    chatProviders: [
      {
        id: "gemini_web",
        label: "Gemini Web Relay",
        endpoint: "http://127.0.0.1:4100/v1/chat/completions",
        models: ["gemini-2.5-pro"],
        defaultModel: "gemini-2.5-pro",
        headers: {
          "x-relay-source": "member-web",
        },
        body: {
          metadata: {
            account: "gemini-pro",
          },
        },
        authMode: "none",
        keys: [
          {
            id: "gemini_web__relay",
            providerId: "gemini_web",
            providerLabel: "Gemini Web Relay",
            keyName: "relay",
            apiKey: "",
            maskedKey: "",
            endpoint: "http://127.0.0.1:4100/v1/chat/completions",
            models: ["gemini-2.5-pro"],
            defaultModel: "gemini-2.5-pro",
            priority: 100,
            weight: 1,
            enabled: true,
            sourceEnv: "GEMINI_WEB_ALLOW_NO_AUTH",
          },
        ],
      },
    ],
    defaultChatProviderId: "gemini_web",
    chatAttachmentTextBytes: 4096,
    chatInlineImageBytes: 4096,
    autoChatRetryCooldownMs: 60_000,
    autoChatQuotaCooldownMs: 300_000,
  });

  const reply = await service.respond({
    user: {
      display_name: "user1",
      username: "user1",
      repo_url: "",
      repo_local_path: "",
    },
    history: [
      {
        role: "user",
        content: "hello",
        attachments: [],
      },
    ],
    providerId: "gemini_web",
    model: "gemini-2.5-pro",
  });

  assert.equal(reply.text, "Relay OK");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].headers.authorization, undefined);
  assert.equal(captured[0].headers["x-relay-source"], "member-web");
  assert.equal(captured[0].body.metadata.account, "gemini-pro");
  assert.equal(captured[0].body.model, "gemini-2.5-pro");
});
