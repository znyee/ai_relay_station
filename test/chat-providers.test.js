import test from "node:test";
import assert from "node:assert/strict";
import { buildChatProviders, sanitizeChatProviders } from "../src/chat-providers.js";

test("chat providers only expose configured providers and resolve a default", () => {
  const { providers, defaultProviderId } = buildChatProviders({
    CHAT_DEFAULT_PROVIDER: "auto",
    DEEPSEEK_API_KEY: "deepseek-key",
    DEEPSEEK_CHAT_MODELS: "deepseek-chat,deepseek-reasoner",
    SILICONFLOW_API_KEY: "siliconflow-key",
    SILICONFLOW_CHAT_MODELS: "deepseek-ai/DeepSeek-R1",
    ALIBABA_BAILIAN_API_KEY: "bailian-key",
    ALIBABA_BAILIAN_CHAT_MODELS: "qwen-plus-2025-12-01",
    AUTO_CHAT_TEXT_ROUTE: "siliconflow:deepseek-ai/DeepSeek-R1,alibaba_bailian:qwen-plus-2025-12-01",
    OPENROUTER_API_KEY: "openrouter-key",
    OPENROUTER_CHAT_MODELS: "openrouter/free",
  });

  assert.equal(defaultProviderId, "auto");
  assert.deepEqual(
    providers.map((provider) => provider.id),
    ["auto", "deepseek", "siliconflow", "openrouter", "alibaba_bailian"],
  );
});

test("sanitizeChatProviders strips secrets and keeps labels/models", () => {
  const catalog = sanitizeChatProviders([
    {
      id: "deepseek",
      label: "DeepSeek",
      endpoint: "https://api.deepseek.com/chat/completions",
      apiKey: "secret",
      models: ["deepseek-chat"],
      defaultModel: "deepseek-chat",
      headers: {},
      body: {},
    },
  ]);

  assert.deepEqual(catalog, [
    {
      id: "deepseek",
      label: "DeepSeek",
      models: ["deepseek-chat"],
      defaultModel: "deepseek-chat",
    },
  ]);
});

test("openai provider prefers app-specific base url over legacy env name", () => {
  const { providers } = buildChatProviders({
    OPENAI_API_KEY: "openai-key",
    OPENAI_CHAT_MODELS: "gpt-5-mini",
    OPENAI_CHAT_BASE_URL: "https://chat.example/v1/chat/completions",
    OPENAI_BASE_URL: "https://legacy.example/v1/chat/completions",
  });

  assert.equal(providers[0].id, "openai");
  assert.equal(providers[0].endpoint, "https://chat.example/v1/chat/completions");
});

test("auto provider exposes a single auto model", () => {
  const { providers } = buildChatProviders({
    CHAT_DEFAULT_PROVIDER: "auto",
    SILICONFLOW_API_KEY: "siliconflow-key",
    SILICONFLOW_CHAT_MODELS: "deepseek-ai/DeepSeek-R1,Qwen/Qwen3-VL-235B-A22B-Thinking",
    ALIBABA_BAILIAN_API_KEY: "bailian-key",
    ALIBABA_BAILIAN_CHAT_MODELS: "qwen-plus-2025-12-01,qwen3-omni-flash",
  });

  const autoProvider = providers.find((provider) => provider.id === "auto");
  assert.equal(autoProvider.label, "Auto");
  assert.deepEqual(autoProvider.models, ["auto"]);
});

test("provider catalog supports multiple weighted API keys per provider", () => {
  const { providers } = buildChatProviders({
    SILICONFLOW_API_KEYS: "primary|sf-key-1|priority=120|weight=3;backup|sf-key-2|priority=90|weight=1",
    SILICONFLOW_CHAT_MODELS: "deepseek-ai/DeepSeek-R1",
  });

  const provider = providers.find((entry) => entry.id === "siliconflow");
  assert.equal(provider.keys.length, 2);
  assert.equal(provider.keys[0].keyName, "primary");
  assert.equal(provider.keys[0].priority, 120);
  assert.equal(provider.keys[0].weight, 3);
  assert.equal(provider.keys[1].keyName, "backup");
});
