import { buildProviderApiKeys } from "./ai-api-keys.js";

function splitCsv(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonObject(value, fallback = {}) {
  const text = String(value || "").trim();
  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback;
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, entryValue]) => [String(key), entryValue]),
    );
  } catch {
    return fallback;
  }
}

function normalizeAuthMode(value, fallback = "bearer") {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "none") {
    return "none";
  }
  if (mode === "bearer") {
    return "bearer";
  }
  return fallback;
}

function parseRouteEntry(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const [base, ...metadataTokens] = text
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  const separator = base.indexOf(":");
  if (separator < 0) {
    return null;
  }

  const providerId = base.slice(0, separator).trim();
  const model = base.slice(separator + 1).trim();
  if (!providerId || !model) {
    return null;
  }

  const metadata = Object.fromEntries(
    metadataTokens
      .map((token) => {
        const index = token.indexOf("=");
        if (index < 0) {
          return null;
        }
        return [token.slice(0, index).trim(), token.slice(index + 1).trim()];
      })
      .filter(Boolean),
  );

  return {
    providerId,
    model,
    priority: Number.isFinite(Number(metadata.priority)) ? Number(metadata.priority) : 100,
    weight: Math.max(1, Number.isFinite(Number(metadata.weight)) ? Number(metadata.weight) : 1),
  };
}

function parseRouteList(value, fallback = []) {
  return splitCsv(value, fallback)
    .map(parseRouteEntry)
    .filter(Boolean);
}

function pushProvider(providers, env, input) {
  const authMode = normalizeAuthMode(
    input.authMode,
    input.allowUnauthenticated ? "none" : "bearer",
  );
  const keys = buildProviderApiKeys({
    env,
    envPrefix: input.envPrefix,
    providerId: input.id,
    providerLabel: input.label,
    endpoint: input.endpoint,
    models: input.models,
    defaultModel: input.defaultModel || input.models[0],
    allowKeyless: input.allowUnauthenticated || authMode === "none",
    keylessName: input.keylessName || "direct",
    keylessSourceEnv: input.keylessSourceEnv || `${input.envPrefix}_ALLOW_NO_AUTH`,
  });

  if (keys.length === 0 || input.models.length === 0) {
    return;
  }

  providers.push({
    id: input.id,
    label: input.label,
    endpoint: input.endpoint,
    apiKey: keys[0].apiKey,
    models: input.models,
    defaultModel: input.defaultModel || input.models[0],
    headers: input.headers || {},
    body: input.body || {},
    authMode,
    keys,
  });
}

function pushAutoProvider(providers, env) {
  const availableProviders = new Set(providers.map((provider) => provider.id));
  const textRoutes = parseRouteList(env.AUTO_CHAT_TEXT_ROUTE, [
    "siliconflow:deepseek-ai/DeepSeek-R1",
    "alibaba_bailian:qwen-plus-2025-12-01",
    "alibaba_bailian:qwen-plus-2025-07-28",
    "alibaba_bailian:qwen-turbo-latest",
    "alibaba_bailian:qwen3.5-35b-a3b",
    "alibaba_bailian:qwen-max-latest",
  ]).filter((route) => availableProviders.has(route.providerId));

  const visionRoutes = parseRouteList(env.AUTO_CHAT_VISION_ROUTE, [
    "siliconflow:Qwen/Qwen3-VL-235B-A22B-Thinking",
    "alibaba_bailian:qwen3-omni-flash",
    "alibaba_bailian:qwen3-omni-flash-2025-12-01",
    "alibaba_bailian:qwen3-omni-flash-2025-09-15",
    "alibaba_bailian:qwen2.5-omni-7b",
    "alibaba_bailian:qwen-omni-turbo-latest",
  ]).filter((route) => availableProviders.has(route.providerId));

  if (textRoutes.length === 0 && visionRoutes.length === 0) {
    return;
  }

  providers.unshift({
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
      text: textRoutes,
      vision: visionRoutes.length > 0 ? visionRoutes : textRoutes,
    },
  });
}

export function buildChatProviders(env = process.env) {
  const providers = [];

  pushProvider(providers, env, {
    id: "openai",
    label: "OpenAI",
    envPrefix: "OPENAI",
    endpoint:
      env.OPENAI_CHAT_BASE_URL ||
      env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1/chat/completions",
    models: splitCsv(env.OPENAI_CHAT_MODELS, []),
    defaultModel: env.OPENAI_CHAT_MODEL || "",
  });

  pushProvider(providers, env, {
    id: "zhipu",
    label: "Zhipu",
    envPrefix: "ZHIPU",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    models: splitCsv(env.ZHIPU_CHAT_MODELS, ["glm-4-flash"]),
  });

  pushProvider(providers, env, {
    id: "deepseek",
    label: "DeepSeek",
    envPrefix: "DEEPSEEK",
    endpoint: "https://api.deepseek.com/chat/completions",
    models: splitCsv(env.DEEPSEEK_CHAT_MODELS, ["deepseek-chat", "deepseek-reasoner"]),
  });

  pushProvider(providers, env, {
    id: "github_models",
    label: "GitHub Models",
    envPrefix: "GITHUB_MODELS",
    endpoint: "https://models.github.ai/inference/chat/completions",
    models: splitCsv(
      env.GITHUB_MODELS_CHAT_MODELS,
      ["openai/gpt-4.1-mini", "openai/gpt-4.1", "openai/gpt-4o-mini"],
    ),
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });

  pushProvider(providers, env, {
    id: "siliconflow",
    label: "SiliconFlow",
    envPrefix: "SILICONFLOW",
    endpoint: env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1/chat/completions",
    models: splitCsv(
      env.SILICONFLOW_CHAT_MODELS,
      ["Qwen/Qwen2.5-7B-Instruct", "THUDM/GLM-4-9B-0414"],
    ),
  });

  pushProvider(providers, env, {
    id: "openrouter",
    label: "OpenRouter",
    envPrefix: "OPENROUTER",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    models: splitCsv(env.OPENROUTER_CHAT_MODELS, ["openrouter/free"]),
    headers: {
      "http-referer": env.OPENROUTER_REFERER || "http://127.0.0.1:3210",
      "x-title": env.OPENROUTER_TITLE || "Relay Station",
    },
    body: {
      provider: {
        data_collection: "allow",
      },
    },
  });

  pushProvider(providers, env, {
    id: "alibaba_bailian",
    label: "Alibaba Bailian",
    envPrefix: "ALIBABA_BAILIAN",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    models: splitCsv(env.ALIBABA_BAILIAN_CHAT_MODELS, ["qwen-turbo", "qwen-plus"]),
  });

  pushProvider(providers, env, {
    id: "stepfun",
    label: "StepFun",
    envPrefix: "STEPFUN",
    endpoint: "https://api.stepfun.com/v1/chat/completions",
    models: splitCsv(env.STEPFUN_CHAT_MODELS, ["step-1-8k"]),
  });

  pushProvider(providers, env, {
    id: "tencent_hunyuan",
    label: "Tencent Hunyuan",
    envPrefix: "TENCENT_HUNYUAN",
    endpoint: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    models: splitCsv(env.TENCENT_HUNYUAN_CHAT_MODELS, ["hunyuan-lite"]),
  });

  pushProvider(providers, env, {
    id: "gemini_web",
    label: env.GEMINI_WEB_LABEL || "Gemini Web Relay",
    envPrefix: "GEMINI_WEB",
    endpoint: env.GEMINI_WEB_CHAT_BASE_URL || env.GEMINI_WEB_BASE_URL || "",
    models: splitCsv(env.GEMINI_WEB_CHAT_MODELS, []),
    defaultModel: env.GEMINI_WEB_CHAT_MODEL || "",
    headers: parseJsonObject(env.GEMINI_WEB_CHAT_HEADERS_JSON, {}),
    body: parseJsonObject(env.GEMINI_WEB_CHAT_BODY_JSON, {}),
    authMode: normalizeAuthMode(
      env.GEMINI_WEB_AUTH_MODE,
      env.GEMINI_WEB_API_KEY || env.GEMINI_WEB_API_KEYS ? "bearer" : "none",
    ),
    allowUnauthenticated: env.GEMINI_WEB_ALLOW_NO_AUTH === "1",
    keylessName: "relay",
    keylessSourceEnv: "GEMINI_WEB_ALLOW_NO_AUTH",
  });

  pushAutoProvider(providers, env);

  const defaultProviderId =
    providers.find((provider) => provider.id === env.CHAT_DEFAULT_PROVIDER)?.id ||
    providers[0]?.id ||
    "";

  return {
    providers,
    defaultProviderId,
  };
}

export function sanitizeChatProviders(providers) {
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    models: provider.models,
    defaultModel: provider.defaultModel,
  }));
}
