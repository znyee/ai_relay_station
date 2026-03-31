import { readAttachmentDataUrl, readAttachmentText, summarizeAttachment } from "./attachments.js";
import { sanitizeChatProviders } from "./chat-providers.js";
import { serializeAiApiKey } from "./ai-api-keys.js";
import { nowIso, randomId } from "./utils.js";

const AUTO_FAILOVER_STATUS_CODES = new Set([0, 402, 408, 409, 429, 500, 502, 503, 504]);
const AUTO_FAILOVER_MESSAGE = /quota|limit|exhaust|余额|insufficient|too many requests|resource[_ ]?exhausted|throttl|capacity|overloaded/i;
const AUTO_QUOTA_MESSAGE = /quota|余额|insufficient|resource[_ ]?exhausted|credit|额度|余额不足|exhaust/i;
const AUTO_RETRYABLE_MESSAGE = /too many requests|throttl|capacity|overloaded|temporar|timeout|unavailable|retry/i;

function coerceContent(content) {
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "text" in item) {
          return String(item.text || "");
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return String(content || "");
}

function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "text" in item) {
          return String(item.text || "");
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function extractStreamDeltaText(payload) {
  const content = payload?.choices?.[0]?.delta?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "text" in item) {
          return String(item.text || "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function extractError(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback || "Chat request failed.";
}

function buildRequestHeaders(provider, apiKey) {
  const headers = {
    "content-type": "application/json",
    ...provider.headers,
  };

  if ((provider.authMode || "bearer") === "bearer" && apiKey?.apiKey) {
    headers.authorization = `Bearer ${apiKey.apiKey}`;
  }

  return headers;
}

async function postChat(provider, apiKey, body, options = {}) {
  let response;
  try {
    response = await fetch(provider.endpoint, {
      method: "POST",
      headers: buildRequestHeaders(provider, apiKey),
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    const requestError = new Error(`${provider.label}: ${error instanceof Error ? error.message : String(error)}`);
    requestError.status = 0;
    requestError.providerId = provider.id;
    requestError.providerLabel = provider.label;
    requestError.apiKeyId = apiKey.id;
    requestError.apiKeyName = apiKey.keyName;
    requestError.isNetworkError = true;
    throw requestError;
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const requestError = new Error(`${provider.label}: ${extractError(payload, text || `HTTP ${response.status}`)}`);
    requestError.status = response.status;
    requestError.providerId = provider.id;
    requestError.providerLabel = provider.label;
    requestError.apiKeyId = apiKey.id;
    requestError.apiKeyName = apiKey.keyName;
    requestError.payload = payload;
    throw requestError;
  }

  return payload;
}

async function postChatStream(provider, apiKey, body, options = {}) {
  let response;
  try {
    response = await fetch(provider.endpoint, {
      method: "POST",
      headers: buildRequestHeaders(provider, apiKey),
      body: JSON.stringify({
        ...body,
        stream: true,
      }),
      signal: options.signal,
    });
  } catch (error) {
    const requestError = new Error(`${provider.label}: ${error instanceof Error ? error.message : String(error)}`);
    requestError.status = 0;
    requestError.providerId = provider.id;
    requestError.providerLabel = provider.label;
    requestError.apiKeyId = apiKey.id;
    requestError.apiKeyName = apiKey.keyName;
    requestError.isNetworkError = true;
    throw requestError;
  }

  if (!response.ok) {
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    const requestError = new Error(`${provider.label}: ${extractError(payload, text || `HTTP ${response.status}`)}`);
    requestError.status = response.status;
    requestError.providerId = provider.id;
    requestError.providerLabel = provider.label;
    requestError.apiKeyId = apiKey.id;
    requestError.apiKeyName = apiKey.keyName;
    requestError.payload = payload;
    throw requestError;
  }

  options.onStart?.({
    providerId: provider.id,
    providerLabel: provider.label,
    apiKeyId: apiKey.id,
    apiKeyName: apiKey.keyName,
    model: body.model,
  });

  const decoder = new TextDecoder();
  let buffer = "";
  let responseId = "";
  let fullText = "";
  let eventLines = [];

  function flushEvent() {
    if (eventLines.length === 0) {
      return false;
    }

    const data = eventLines.join("\n");
    eventLines = [];
    if (!data || data === "[DONE]") {
      return data === "[DONE]";
    }

    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return false;
    }

    responseId = payload?.id || responseId;
    const delta = extractStreamDeltaText(payload);
    if (delta) {
      fullText += delta;
      options.onDelta?.(delta, fullText, payload);
      return false;
    }

    const finalText = extractAssistantText(payload);
    if (finalText && !fullText) {
      fullText = finalText;
      options.onDelta?.(finalText, fullText, payload);
    }

    return false;
  }

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      if (!line) {
        const done = flushEvent();
        if (done) {
          break;
        }
        continue;
      }

      if (line.startsWith("data:")) {
        eventLines.push(line.slice(5).trimStart());
      }
    }
  }

  if (buffer.trim() && buffer.startsWith("data:")) {
    eventLines.push(buffer.slice(5).trimStart());
  }
  flushEvent();

  if (!fullText.trim()) {
    throw new Error(`${provider.label}: the model returned no text output.`);
  }

  return {
    providerId: provider.id,
    providerLabel: provider.label,
    apiKeyId: apiKey.id,
    apiKeyName: apiKey.keyName,
    model: body.model,
    text: fullText.trim(),
    responseId,
  };
}

export function shouldAutoFailover(error) {
  if (!error) {
    return false;
  }

  if (AUTO_FAILOVER_STATUS_CODES.has(Number(error.status || 0))) {
    return true;
  }

  return AUTO_FAILOVER_MESSAGE.test(String(error.message || ""));
}

function routeKey(route) {
  return route.id || `${route.routeType || "route"}:${route.providerId}:${route.model}`;
}

function cooldownDurationMs(error, config) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || "");
  if (status === 402 || AUTO_QUOTA_MESSAGE.test(message)) {
    return Math.max(0, Number(config.autoChatQuotaCooldownMs || 0));
  }

  if (
    status === 0 ||
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    AUTO_RETRYABLE_MESSAGE.test(message)
  ) {
    return Math.max(0, Number(config.autoChatRetryCooldownMs || 0));
  }

  return 0;
}

function hasImageContext(history) {
  return history.some(
    (message) =>
      message.role === "user" &&
      Array.isArray(message.attachments) &&
      message.attachments.some((attachment) => attachment.kind === "image"),
  );
}

async function executeProviderRequest(provider, apiKey, model, messages) {
  const payload = await postChat(provider, apiKey, {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 1200,
    ...provider.body,
  });

  const text = extractAssistantText(payload);
  if (!text) {
    throw new Error(`${provider.label}: the model returned no text output.`);
  }

  return {
    providerId: provider.id,
    providerLabel: provider.label,
    apiKeyId: apiKey.id,
    apiKeyName: apiKey.keyName,
    model,
    text,
    responseId: payload?.id || "",
  };
}

async function streamProviderRequest(provider, apiKey, model, messages, options = {}) {
  return postChatStream(
    provider,
    apiKey,
    {
      model,
      messages,
      temperature: 0.2,
      max_tokens: 1200,
      ...provider.body,
    },
    options,
  );
}

async function buildUserMessageContent(message, config) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length === 0) {
    return coerceContent(message.content);
  }

  const textBlocks = [];
  const imageBlocks = [];
  const messageText = coerceContent(message.content);
  if (messageText) {
    textBlocks.push(messageText);
  }

  for (const attachment of attachments) {
    if (attachment.kind === "text") {
      const { text, truncated } = await readAttachmentText(attachment, config.chatAttachmentTextBytes);
      textBlocks.push(
        [
          `Attached file: ${summarizeAttachment(attachment)}`,
          "Begin file content:",
          text,
          truncated ? "[file content truncated]" : "",
          "End file content.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      continue;
    }

    if (attachment.kind === "image") {
      const dataUrl = await readAttachmentDataUrl(attachment, config.chatInlineImageBytes);
      textBlocks.push(`Attached image: ${summarizeAttachment(attachment)}`);
      if (dataUrl) {
        imageBlocks.push({
          type: "image_url",
          image_url: {
            url: dataUrl,
          },
        });
      } else {
        textBlocks.push("This image was too large to inline. Use the file metadata only.");
      }
      continue;
    }

    textBlocks.push(
      `Attached file: ${summarizeAttachment(attachment)}. This binary file was provided as context but was not inlined.`,
    );
  }

  const combinedText =
    textBlocks.join("\n\n").trim() ||
    "The user attached files without additional text. Use the attachments as the primary input.";

  if (imageBlocks.length > 0) {
    return [
      {
        type: "text",
        text: combinedText,
      },
      ...imageBlocks,
    ];
  }

  return combinedText;
}

function createEmptyKeyState() {
  return {
    successCount: 0,
    failureCount: 0,
    quotaFailureCount: 0,
    retryableFailureCount: 0,
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastUsedAt: "",
    lastError: "",
    lastLatencyMs: 0,
    inFlight: 0,
  };
}

function normalizeCount(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(0, fallback);
  }
  return Math.max(0, Math.round(parsed));
}

function normalizeTimestampMs(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(0, fallback);
  }
  return Math.max(0, Math.round(parsed));
}

function normalizeText(value, fallback = "") {
  if (value == null) {
    return fallback;
  }
  return String(value);
}

function normalizePriority(value, fallback = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeWeight(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, parsed);
}

function normalizeDurationMs(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
}

function normalizeThreshold(value, fallback = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, fallback);
  }
  return Math.max(1, Math.round(parsed));
}

function routeId(routeType, providerId, model) {
  return `${routeType}:${providerId}:${model}`;
}

export function createChatService(config, options = {}) {
  const onRuntimeStateChange =
    typeof options.onRuntimeStateChange === "function" ? options.onRuntimeStateChange : null;
  const normalizedProviders = (config.chatProviders || []).map((provider) => {
    if (provider.isVirtual || (provider.keys && provider.keys.length > 0)) {
      return provider;
    }

    if (!provider.apiKey) {
      return {
        ...provider,
        keys: [],
      };
    }

    return {
      ...provider,
      keys: [
        {
          id: `${provider.id}__primary`,
          providerId: provider.id,
          providerLabel: provider.label,
          keyName: "primary",
          apiKey: provider.apiKey,
          maskedKey: "",
          endpoint: provider.endpoint,
          models: provider.models || [],
          defaultModel: provider.defaultModel,
          priority: 100,
          weight: 1,
          enabled: true,
          sourceEnv: "legacy",
        },
      ],
    };
  });
  const providers = new Map(normalizedProviders.map((provider) => [provider.id, provider]));
  const routeCooldowns = new Map();
  const apiKeyStates = new Map();
  const dispatchEvents = [];
  const providerKeys = normalizedProviders.flatMap((provider) => provider.keys || []);
  const providerKeysById = new Map(providerKeys.map((apiKey) => [apiKey.id, apiKey]));
  const baseAutoRoutes = normalizedProviders.flatMap((provider) =>
    Object.entries(provider.autoRoutes || {}).flatMap(([routeType, routes]) =>
      (routes || []).map((route) => ({
        id: routeId(routeType, route.providerId, route.model),
        routeType,
        providerId: route.providerId,
        model: route.model,
        priority: normalizePriority(route.priority, 100),
        weight: normalizeWeight(route.weight, 1),
      })),
    ),
  );
  const baseAutoRoutesById = new Map(baseAutoRoutes.map((route) => [route.id, route]));
  let routingConfig = null;
  let routeOverridesById = new Map();

  for (const apiKey of providerKeys) {
    apiKeyStates.set(apiKey.id, createEmptyKeyState());
  }

  function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizePersistedKeyState(input) {
    const base = createEmptyKeyState();
    const raw = input && typeof input === "object" ? input : {};
    const cooldownUntil = normalizeTimestampMs(raw.cooldownUntil, 0);
    return {
      successCount: normalizeCount(raw.successCount, base.successCount),
      failureCount: normalizeCount(raw.failureCount, base.failureCount),
      quotaFailureCount: normalizeCount(raw.quotaFailureCount, base.quotaFailureCount),
      retryableFailureCount: normalizeCount(raw.retryableFailureCount, base.retryableFailureCount),
      consecutiveFailures: normalizeCount(raw.consecutiveFailures, base.consecutiveFailures),
      cooldownUntil: cooldownUntil > Date.now() ? cooldownUntil : 0,
      lastUsedAt: normalizeText(raw.lastUsedAt, ""),
      lastError: normalizeText(raw.lastError, ""),
      lastLatencyMs: normalizeDurationMs(raw.lastLatencyMs, base.lastLatencyMs),
      inFlight: 0,
    };
  }

  function normalizePersistedDispatchEvent(input) {
    const raw = input && typeof input === "object" ? input : null;
    if (!raw) {
      return null;
    }

    return {
      id: normalizeText(raw.id, randomId("dsp_")),
      createdAt: normalizeText(raw.createdAt, nowIso()),
      routeType: normalizeText(raw.routeType, ""),
      requestKind: normalizeText(raw.requestKind, ""),
      userId: normalizeText(raw.userId, ""),
      username: normalizeText(raw.username, ""),
      conversationId: normalizeText(raw.conversationId, ""),
      providerId: normalizeText(raw.providerId, ""),
      providerLabel: normalizeText(raw.providerLabel, ""),
      apiKeyId: normalizeText(raw.apiKeyId, ""),
      apiKeyName: normalizeText(raw.apiKeyName, ""),
      model: normalizeText(raw.model, ""),
      attemptIndex: normalizeCount(raw.attemptIndex, 0),
      keyPriority: normalizePriority(raw.keyPriority, 0),
      keyWeight: normalizeWeight(raw.keyWeight, 1),
      status: normalizeText(raw.status, "unknown"),
      durationMs: normalizeDurationMs(raw.durationMs, 0),
      error: normalizeText(raw.error, ""),
      cooldownMs: normalizeDurationMs(raw.cooldownMs, 0),
    };
  }

  function defaultDispatchSettings() {
    return {
      retryCooldownMs: normalizeDurationMs(config.autoChatRetryCooldownMs, 2 * 60 * 1000),
      quotaCooldownMs: normalizeDurationMs(config.autoChatQuotaCooldownMs, 15 * 60 * 1000),
      circuitBreakerThreshold: normalizeThreshold(config.autoChatCircuitBreakerThreshold, 3),
      circuitBreakerMs: normalizeDurationMs(config.autoChatCircuitBreakerMs, 10 * 60 * 1000),
      dispatchHistoryLimit: Math.max(50, normalizeThreshold(config.adminDispatchHistoryLimit, 200)),
    };
  }

  function normalizeRoutingConfig(input = {}) {
    const raw = input && typeof input === "object" ? input : {};
    const dispatch = {
      retryCooldownMs: normalizeDurationMs(raw.dispatch?.retryCooldownMs, defaultDispatchSettings().retryCooldownMs),
      quotaCooldownMs: normalizeDurationMs(raw.dispatch?.quotaCooldownMs, defaultDispatchSettings().quotaCooldownMs),
      circuitBreakerThreshold: normalizeThreshold(
        raw.dispatch?.circuitBreakerThreshold,
        defaultDispatchSettings().circuitBreakerThreshold,
      ),
      circuitBreakerMs: normalizeDurationMs(raw.dispatch?.circuitBreakerMs, defaultDispatchSettings().circuitBreakerMs),
      dispatchHistoryLimit: Math.max(
        50,
        normalizeThreshold(raw.dispatch?.dispatchHistoryLimit, defaultDispatchSettings().dispatchHistoryLimit),
      ),
    };

    const routeOverrides = [];
    const seenRouteIds = new Set();
    for (const entry of Array.isArray(raw.routeOverrides) ? raw.routeOverrides : []) {
      const routeType = String(entry?.routeType || "").trim();
      const providerId = String(entry?.providerId || "").trim();
      const model = String(entry?.model || "").trim();
      const id = routeId(routeType, providerId, model);
      const baseRoute = baseAutoRoutesById.get(id);
      if (!baseRoute || seenRouteIds.has(id)) {
        continue;
      }
      seenRouteIds.add(id);
      routeOverrides.push({
        id,
        routeType,
        providerId,
        model,
        enabled: entry?.enabled !== false,
        priority: normalizePriority(entry?.priority, baseRoute.priority),
        weight: normalizeWeight(entry?.weight, baseRoute.weight),
      });
    }

    routeOverrides.sort((left, right) =>
      `${left.routeType}:${left.providerId}:${left.model}`.localeCompare(
        `${right.routeType}:${right.providerId}:${right.model}`,
      ),
    );

    return {
      dispatch,
      routeOverrides,
      keyRules: [],
    };
  }

  function trimDispatchHistory() {
    const limit = Math.max(50, Number(routingConfig?.dispatch?.dispatchHistoryLimit || config.adminDispatchHistoryLimit || 200));
    if (dispatchEvents.length > limit) {
      dispatchEvents.length = limit;
    }
  }

  function normalizeRuntimeState(input = {}) {
    const raw = input && typeof input === "object" ? input : {};
    const nextApiKeyStates = {};
    for (const apiKey of providerKeys) {
      nextApiKeyStates[apiKey.id] = normalizePersistedKeyState(raw.apiKeyStates?.[apiKey.id]);
    }

    const nextRouteCooldowns = {};
    for (const route of baseAutoRoutes) {
      const until = normalizeTimestampMs(raw.routeCooldowns?.[route.id], 0);
      if (until > Date.now()) {
        nextRouteCooldowns[route.id] = until;
      }
    }

    const nextDispatchEvents = (Array.isArray(raw.dispatchEvents) ? raw.dispatchEvents : [])
      .map(normalizePersistedDispatchEvent)
      .filter(Boolean)
      .slice(0, defaultDispatchSettings().dispatchHistoryLimit);

    return {
      apiKeyStates: nextApiKeyStates,
      routeCooldowns: nextRouteCooldowns,
      dispatchEvents: nextDispatchEvents,
    };
  }

  function snapshotRuntimeState() {
    const nextApiKeyStates = {};
    for (const apiKey of providerKeys) {
      const state = getKeyState(apiKey);
      nextApiKeyStates[apiKey.id] = {
        successCount: normalizeCount(state.successCount, 0),
        failureCount: normalizeCount(state.failureCount, 0),
        quotaFailureCount: normalizeCount(state.quotaFailureCount, 0),
        retryableFailureCount: normalizeCount(state.retryableFailureCount, 0),
        consecutiveFailures: normalizeCount(state.consecutiveFailures, 0),
        cooldownUntil: normalizeTimestampMs(state.cooldownUntil, 0),
        lastUsedAt: normalizeText(state.lastUsedAt, ""),
        lastError: normalizeText(state.lastError, ""),
        lastLatencyMs: normalizeDurationMs(state.lastLatencyMs, 0),
        inFlight: 0,
      };
    }

    const nextRouteCooldowns = {};
    for (const route of baseAutoRoutes) {
      const until = normalizeTimestampMs(routeCooldowns.get(route.id), 0);
      if (until > Date.now()) {
        nextRouteCooldowns[route.id] = until;
      }
    }

    return {
      apiKeyStates: nextApiKeyStates,
      routeCooldowns: nextRouteCooldowns,
      dispatchEvents: cloneValue(dispatchEvents),
    };
  }

  function persistRuntimeState() {
    if (!onRuntimeStateChange) {
      return;
    }
    try {
      onRuntimeStateChange(snapshotRuntimeState());
    } catch (error) {
      console.warn(`Warning: failed to persist chat runtime state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function applyRuntimeState(input = {}) {
    const runtimeState = normalizeRuntimeState(input);
    routeCooldowns.clear();
    for (const [key, value] of Object.entries(runtimeState.routeCooldowns)) {
      routeCooldowns.set(key, value);
    }

    dispatchEvents.length = 0;
    dispatchEvents.push(...runtimeState.dispatchEvents);

    for (const apiKey of providerKeys) {
      apiKeyStates.set(apiKey.id, runtimeState.apiKeyStates[apiKey.id] || createEmptyKeyState());
    }

    trimDispatchHistory();
  }

  function applyRoutingConfig(input = {}, settings = {}) {
    routingConfig = normalizeRoutingConfig(input);
    routeOverridesById = new Map(routingConfig.routeOverrides.map((entry) => [entry.id, entry]));
    trimDispatchHistory();
    if (settings.persist !== false) {
      persistRuntimeState();
    }
    return cloneValue(routingConfig);
  }

  applyRoutingConfig({}, { persist: false });
  applyRuntimeState(options.runtimeState || {});

  function dispatchSettings() {
    return routingConfig.dispatch;
  }

  function getKeyState(apiKey) {
    if (!apiKeyStates.has(apiKey.id)) {
      apiKeyStates.set(apiKey.id, createEmptyKeyState());
    }
    return apiKeyStates.get(apiKey.id);
  }

  function effectiveKeyConfig(apiKey) {
    return {
      enabled: apiKey.enabled,
      priority: apiKey.priority,
      weight: apiKey.weight,
      baseEnabled: apiKey.enabled,
      basePriority: apiKey.priority,
      baseWeight: apiKey.weight,
    };
  }

  function providerHasEnabledKey(providerId, model) {
    const provider = providers.get(providerId);
    if (!provider) {
      return false;
    }
    return (provider.keys || []).some((apiKey) => {
      if (!Array.isArray(apiKey.models) || !apiKey.models.includes(model)) {
        return false;
      }
      return effectiveKeyConfig(apiKey).enabled;
    });
  }

  function effectiveRouteConfig(routeType, route) {
    const id = routeId(routeType, route.providerId, route.model);
    const override = routeOverridesById.get(id);
    return {
      id,
      routeType,
      providerId: route.providerId,
      model: route.model,
      enabled: override ? override.enabled : true,
      priority: override ? override.priority : normalizePriority(route.priority, 100),
      weight: override ? override.weight : normalizeWeight(route.weight, 1),
      baseEnabled: true,
      basePriority: normalizePriority(route.priority, 100),
      baseWeight: normalizeWeight(route.weight, 1),
    };
  }

  function computeCooldownMs(error, state) {
    const settings = dispatchSettings();
    const baseCooldown = cooldownDurationMs(error, {
      autoChatRetryCooldownMs: settings.retryCooldownMs,
      autoChatQuotaCooldownMs: settings.quotaCooldownMs,
    });
    const nextConsecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
    const threshold = settings.circuitBreakerThreshold;
    if (nextConsecutiveFailures >= threshold) {
      return Math.max(baseCooldown, settings.circuitBreakerMs);
    }
    return baseCooldown;
  }

  function apiKeyStatus(keyConfig, state) {
    if (!keyConfig.enabled) {
      return "disabled";
    }
    if ((state.cooldownUntil || 0) > Date.now()) {
      return "cooldown";
    }
    if (state.consecutiveFailures >= dispatchSettings().circuitBreakerThreshold) {
      return "degraded";
    }
    return "healthy";
  }

  function serializeApiKeyState(apiKey) {
    const state = getKeyState(apiKey);
    const keyConfig = effectiveKeyConfig(apiKey);
    return {
      ...serializeAiApiKey(apiKey),
      enabled: keyConfig.enabled,
      priority: keyConfig.priority,
      weight: keyConfig.weight,
      baseEnabled: keyConfig.baseEnabled,
      basePriority: keyConfig.basePriority,
      baseWeight: keyConfig.baseWeight,
      status: apiKeyStatus(keyConfig, state),
      successCount: state.successCount,
      failureCount: state.failureCount,
      quotaFailureCount: state.quotaFailureCount,
      retryableFailureCount: state.retryableFailureCount,
      consecutiveFailures: state.consecutiveFailures,
      cooldownUntil: state.cooldownUntil ? new Date(state.cooldownUntil).toISOString() : "",
      lastUsedAt: state.lastUsedAt,
      lastError: state.lastError,
      lastLatencyMs: state.lastLatencyMs,
      inFlight: state.inFlight,
    };
  }

  function recordDispatchEvent(event) {
    dispatchEvents.unshift({
      id: randomId("dsp_"),
      createdAt: nowIso(),
      ...event,
    });
    trimDispatchHistory();
    persistRuntimeState();
  }

  function keyScore(apiKey, state, keyConfig) {
    const cooldownPenalty = Math.max(0, ((state.cooldownUntil || 0) - Date.now()) / 1000);
    const loadPenalty = state.inFlight * 40;
    const failurePenalty = state.consecutiveFailures * 80;
    const latencyPenalty = Math.round((state.lastLatencyMs || 0) / 25);
    const usagePenalty = state.successCount / Math.max(1, keyConfig.weight);
    return keyConfig.priority * 1000 + keyConfig.weight * 100 - cooldownPenalty - loadPenalty - failurePenalty - latencyPenalty - usagePenalty;
  }

  function routeScore(route) {
    const provider = providers.get(route.providerId);
    if (!provider) {
      return Number.NEGATIVE_INFINITY;
    }

    const bestKeyScore = Math.max(
      ...((provider.keys || [])
        .filter((apiKey) => Array.isArray(apiKey.models) && apiKey.models.includes(route.model))
        .map((apiKey) => {
          const keyConfig = effectiveKeyConfig(apiKey);
          if (!keyConfig.enabled) {
            return Number.NEGATIVE_INFINITY;
          }
          return keyScore(apiKey, getKeyState(apiKey), keyConfig);
        })),
      0,
    );
    return route.priority * 1000 + route.weight * 100 + bestKeyScore / 1000;
  }

  function listProviders() {
    return sanitizeChatProviders(normalizedProviders);
  }

  function listApiKeys() {
    return normalizedProviders
      .flatMap((provider) => provider.keys || [])
      .map(serializeApiKeyState)
      .sort((left, right) => {
        if (left.providerLabel !== right.providerLabel) {
          return left.providerLabel.localeCompare(right.providerLabel);
        }
        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }
        return left.keyName.localeCompare(right.keyName);
      });
  }

  function listDispatchEvents(limit = 100) {
    return dispatchEvents.slice(0, Math.max(1, Number(limit || 100)));
  }

  function resolveProvider(providerId) {
    const id = String(providerId || "").trim() || config.defaultChatProviderId;
    return providers.get(id) || null;
  }

  function resolveSelection(providerId, model) {
    const provider = resolveProvider(providerId);
    if (!provider) {
      throw new Error("Chat mode is not configured. Add at least one provider key.");
    }

    const chosenModel = String(model || "").trim() || provider.defaultModel;
    if (!provider.models.includes(chosenModel)) {
      throw new Error(`Model "${chosenModel}" is not enabled for provider "${provider.label}".`);
    }

    return {
      provider,
      model: chosenModel,
    };
  }

  function systemPromptFor(user) {
    return [
      "You are the chat-mode assistant inside Relay Station.",
      "This is a general-purpose AI chat session.",
      "Answer the user's questions directly and naturally, like a normal AI web chat assistant.",
      `Current user: ${user.display_name} (${user.username})`,
      "Each conversation is an independent chat session.",
      "This chat is not tied to any repository, workspace, or project unless the user provides that context in this conversation.",
      "Prefer clear plain prose by default. Use markdown only when it materially improves clarity.",
      "Do not assume context from any other chat session unless it appears in the current history.",
      "Use attached files as context when they are provided.",
      "Do not claim you changed files, ran commands, or accessed external systems unless that result is explicitly present in the conversation.",
    ].join("\n");
  }

  async function buildMessages(user, history) {
    const historyMessages = await Promise.all(
      history.map(async (message) => ({
        role: message.role,
        content:
          message.role === "user"
            ? await buildUserMessageContent(message, config)
            : coerceContent(message.content),
      })),
    );

    return [
      {
        role: "system",
        content: systemPromptFor(user),
      },
      ...historyMessages,
    ];
  }

  function orderProviderKeys(provider, model) {
    const candidates = (provider.keys || [])
      .filter((apiKey) => Array.isArray(apiKey.models) && apiKey.models.includes(model))
      .map((apiKey) => ({
        apiKey,
        keyConfig: effectiveKeyConfig(apiKey),
      }))
      .filter((entry) => entry.keyConfig.enabled);
    if (candidates.length === 0) {
      throw new Error(`Provider "${provider.label}" has no enabled API key for model "${model}".`);
    }

    const now = Date.now();
    const available = candidates.filter((entry) => (getKeyState(entry.apiKey).cooldownUntil || 0) <= now);
    const pool = available.length > 0 ? available : candidates;
    return [...pool].sort((left, right) => {
      const scoreDelta =
        keyScore(right.apiKey, getKeyState(right.apiKey), right.keyConfig) -
        keyScore(left.apiKey, getKeyState(left.apiKey), left.keyConfig);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return left.apiKey.keyName.localeCompare(right.apiKey.keyName);
    });
  }

  function resolveAutoRoutes(provider, history) {
    const routeType = hasImageContext(history) ? "vision" : "text";
    const routePlan = (provider.autoRoutes?.[routeType] || [])
      .map((route) => effectiveRouteConfig(routeType, route))
      .filter((route) => route.enabled && providerHasEnabledKey(route.providerId, route.model));
    if (routePlan.length === 0) {
      throw new Error(`Auto: no ${routeType} fallback route is configured.`);
    }

    const now = Date.now();
    const activeRoutes = routePlan.filter((route) => {
      const until = routeCooldowns.get(routeKey(route)) || 0;
      return until <= now;
    });

    const orderedRoutes = [...(activeRoutes.length > 0 ? activeRoutes : routePlan)].sort(
      (left, right) => routeScore(right) - routeScore(left),
    );

    return {
      routeType,
      eligibleRoutes: orderedRoutes,
    };
  }

  async function runProviderKeys({
    provider,
    model,
    routeType,
    requestKind,
    user,
    conversationId = "",
    attemptCounter,
    executeAttempt,
    abortFailover,
  }) {
    const orderedKeys = orderProviderKeys(provider, model);
    let lastError = null;

    for (const [index, candidate] of orderedKeys.entries()) {
      const apiKey = candidate.apiKey;
      const keyConfig = candidate.keyConfig;
      const state = getKeyState(apiKey);
      state.inFlight += 1;
      const attemptIndex = attemptCounter.value + 1;
      attemptCounter.value = attemptIndex;
      const startedAt = Date.now();

      try {
        const result = await executeAttempt(apiKey);
        const durationMs = Date.now() - startedAt;
        state.successCount += 1;
        state.consecutiveFailures = 0;
        state.cooldownUntil = 0;
        state.lastError = "";
        state.lastLatencyMs = durationMs;
        state.lastUsedAt = nowIso();

        recordDispatchEvent({
          routeType,
          requestKind,
          userId: user?.id || "",
          username: user?.username || "",
          conversationId,
          providerId: provider.id,
          providerLabel: provider.label,
          apiKeyId: apiKey.id,
          apiKeyName: apiKey.keyName,
          model,
          attemptIndex,
          keyPriority: keyConfig.priority,
          keyWeight: keyConfig.weight,
          status: "success",
          durationMs,
          error: "",
          cooldownMs: 0,
        });

        return result;
      } catch (error) {
        lastError = error;
        const cooldownMs = computeCooldownMs(error, state);
        state.failureCount += 1;
        state.consecutiveFailures += 1;
        state.lastError = error instanceof Error ? error.message : String(error);
        state.lastLatencyMs = Date.now() - startedAt;
        state.lastUsedAt = nowIso();
        if (cooldownMs > 0) {
          state.cooldownUntil = Date.now() + cooldownMs;
        }
        if (Number(error?.status || 0) === 402 || AUTO_QUOTA_MESSAGE.test(String(error?.message || ""))) {
          state.quotaFailureCount += 1;
        }
        if (shouldAutoFailover(error)) {
          state.retryableFailureCount += 1;
        }

        recordDispatchEvent({
          routeType,
          requestKind,
          userId: user?.id || "",
          username: user?.username || "",
          conversationId,
          providerId: provider.id,
          providerLabel: provider.label,
          apiKeyId: apiKey.id,
          apiKeyName: apiKey.keyName,
          model,
          attemptIndex,
          keyPriority: keyConfig.priority,
          keyWeight: keyConfig.weight,
          status: "failed",
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          cooldownMs,
        });

        const canFailOver =
          index < orderedKeys.length - 1 &&
          shouldAutoFailover(error) &&
          !(abortFailover && abortFailover(error));
        if (!canFailOver) {
          throw error;
        }
      } finally {
        state.inFlight = Math.max(0, state.inFlight - 1);
      }
    }

    throw lastError || new Error(`Provider "${provider.label}" has no available API key.`);
  }

  async function runAutoRoutes({
    provider,
    history,
    requestKind,
    user,
    conversationId = "",
    attemptCounter,
    executeRoute,
  }) {
    const { routeType, eligibleRoutes } = resolveAutoRoutes(provider, history);

    let lastError = null;
    for (const [index, route] of eligibleRoutes.entries()) {
      const routeProvider = providers.get(route.providerId);
      if (!routeProvider) {
        continue;
      }

      try {
        return await executeRoute(routeProvider, route, routeType);
      } catch (error) {
        lastError = error;
        const canFailOver = index < eligibleRoutes.length - 1 && shouldAutoFailover(error);
        const cooldownMs = cooldownDurationMs(error, {
          autoChatRetryCooldownMs: dispatchSettings().retryCooldownMs,
          autoChatQuotaCooldownMs: dispatchSettings().quotaCooldownMs,
        });
        if (cooldownMs > 0) {
          routeCooldowns.set(routeKey(route), Date.now() + cooldownMs);
        }

        recordDispatchEvent({
          routeType,
          requestKind,
          userId: user?.id || "",
          username: user?.username || "",
          conversationId,
          providerId: route.providerId,
          providerLabel: routeProvider.label,
          apiKeyId: "",
          apiKeyName: "",
          model: route.model,
          attemptIndex: attemptCounter.value,
          keyPriority: route.priority,
          keyWeight: route.weight,
          status: canFailOver ? "route-failed" : "route-terminal",
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error),
          cooldownMs,
        });

        if (!canFailOver) {
          throw error;
        }
      }
    }

    throw lastError || new Error("Auto: no available route succeeded.");
  }

  function describeAutoRouting() {
    const autoProvider = providers.get("auto");
    if (!autoProvider) {
      return { configured: false, routes: {} };
    }

    const routes = {};
    for (const [routeType, entries] of Object.entries(autoProvider.autoRoutes || {})) {
      routes[routeType] = entries.map((route) => {
        const resolvedRoute = effectiveRouteConfig(routeType, route);
        const provider = providers.get(resolvedRoute.providerId);
        return {
          routeId: resolvedRoute.id,
          providerId: resolvedRoute.providerId,
          providerLabel: provider?.label || resolvedRoute.providerId,
          model: resolvedRoute.model,
          enabled: resolvedRoute.enabled,
          priority: resolvedRoute.priority,
          weight: resolvedRoute.weight,
          baseEnabled: resolvedRoute.baseEnabled,
          basePriority: resolvedRoute.basePriority,
          baseWeight: resolvedRoute.baseWeight,
          cooldownUntil: routeCooldowns.get(routeKey(resolvedRoute))
            ? new Date(routeCooldowns.get(routeKey(resolvedRoute))).toISOString()
            : "",
        };
      });
    }

    return {
      configured: true,
      routes,
    };
  }

  return {
    isConfigured() {
      return providers.size > 0;
    },

    listProviders,

    listApiKeys,

    listDispatchEvents,

    describeAutoRouting,

    getRoutingConfig() {
      return cloneValue(routingConfig);
    },

    setRoutingConfig(nextConfig) {
      return applyRoutingConfig(nextConfig);
    },

    defaultProviderId() {
      return config.defaultChatProviderId;
    },

    async respond({ user, history, providerId, model, conversationId = "" }) {
      const { provider, model: chosenModel } = resolveSelection(providerId, model);
      const messages = await buildMessages(user, history);
      const attemptCounter = { value: 0 };

      if (!provider.isVirtual) {
        return runProviderKeys({
          provider,
          model: chosenModel,
          routeType: "manual",
          requestKind: "respond",
          user,
          conversationId,
          attemptCounter,
          executeAttempt: async (apiKey) => executeProviderRequest(provider, apiKey, chosenModel, messages),
        });
      }

      return runAutoRoutes({
        provider,
        history,
        requestKind: "respond",
        user,
        conversationId,
        attemptCounter,
        executeRoute: async (routeProvider, route, routeType) =>
          runProviderKeys({
            provider: routeProvider,
            model: route.model,
            routeType,
            requestKind: "respond",
            user,
            conversationId,
            attemptCounter,
            executeAttempt: async (apiKey) => executeProviderRequest(routeProvider, apiKey, route.model, messages),
          }),
      });
    },

    async streamRespond({ user, history, providerId, model, conversationId = "", onStart, onDelta, signal }) {
      const { provider, model: chosenModel } = resolveSelection(providerId, model);
      const messages = await buildMessages(user, history);
      const attemptCounter = { value: 0 };

      if (!provider.isVirtual) {
        let emitted = false;
        return runProviderKeys({
          provider,
          model: chosenModel,
          routeType: "manual",
          requestKind: "stream",
          user,
          conversationId,
          attemptCounter,
          abortFailover: () => emitted,
          executeAttempt: async (apiKey) =>
            streamProviderRequest(provider, apiKey, chosenModel, messages, {
              signal,
              onStart,
              onDelta: (delta, fullText, payload) => {
                emitted = true;
                onDelta?.(delta, fullText, payload);
              },
            }),
        });
      }

      return runAutoRoutes({
        provider,
        history,
        requestKind: "stream",
        user,
        conversationId,
        attemptCounter,
        executeRoute: async (routeProvider, route, routeType) => {
          let emitted = false;
          return runProviderKeys({
            provider: routeProvider,
            model: route.model,
            routeType,
            requestKind: "stream",
            user,
            conversationId,
            attemptCounter,
            abortFailover: () => emitted,
            executeAttempt: async (apiKey) =>
              streamProviderRequest(routeProvider, apiKey, route.model, messages, {
                signal,
                onStart,
                onDelta: (delta, fullText, payload) => {
                  emitted = true;
                  onDelta?.(delta, fullText, payload);
                },
              }),
          });
        },
      });
    },
  };
}
