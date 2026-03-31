function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBoolean(value, fallback = true) {
  if (value == null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function slugify(value, fallback = "key") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function parseMetadata(tokens = []) {
  const metadata = {};
  for (const token of tokens) {
    const separator = token.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const key = token.slice(0, separator).trim();
    const value = token.slice(separator + 1).trim();
    if (!key) {
      continue;
    }
    metadata[key] = value;
  }
  return metadata;
}

function normalizeEntry(text) {
  return String(text || "")
    .trim()
    .replace(/^\s+|\s+$/g, "");
}

export function maskApiKey(secret) {
  const value = String(secret || "").trim();
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function createKeyRecord({
  providerId,
  providerLabel,
  endpoint,
  models,
  defaultModel,
  name,
  secret,
  sourceEnv,
  metadata,
  index,
}) {
  const keyName = String(name || `key-${index + 1}`).trim() || `key-${index + 1}`;
  const apiKey = String(secret || "").trim();
  if (!apiKey) {
    return null;
  }

  return {
    id: `${providerId}__${slugify(keyName, `key-${index + 1}`)}`,
    providerId,
    providerLabel,
    keyName,
    apiKey,
    maskedKey: maskApiKey(apiKey),
    endpoint,
    models,
    defaultModel,
    priority: normalizeNumber(metadata.priority, 100),
    weight: Math.max(1, normalizeNumber(metadata.weight, 1)),
    enabled: normalizeBoolean(metadata.enabled, true),
    sourceEnv,
  };
}

function createKeylessRecord({
  providerId,
  providerLabel,
  endpoint,
  models,
  defaultModel,
  name = "direct",
  sourceEnv = "NO_AUTH",
}) {
  const keyName = String(name || "direct").trim() || "direct";
  return {
    id: `${providerId}__${slugify(keyName, "direct")}`,
    providerId,
    providerLabel,
    keyName,
    apiKey: "",
    maskedKey: "",
    endpoint,
    models,
    defaultModel,
    priority: 100,
    weight: 1,
    enabled: true,
    sourceEnv,
  };
}

export function buildProviderApiKeys({
  env = process.env,
  envPrefix,
  providerId,
  providerLabel,
  endpoint,
  models,
  defaultModel,
  allowKeyless = false,
  keylessName = "direct",
  keylessSourceEnv = "",
}) {
  const keysVarName = `${envPrefix}_API_KEYS`;
  const singleVarName = `${envPrefix}_API_KEY`;
  const singleNameVarName = `${envPrefix}_API_KEY_NAME`;
  const multiSpec = normalizeEntry(env[keysVarName]);
  const records = [];

  if (multiSpec) {
    const entries = multiSpec
      .split(";")
      .map((entry) => normalizeEntry(entry))
      .filter(Boolean);

    for (const [index, entry] of entries.entries()) {
      const parts = entry
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean);
      if (parts.length < 2) {
        continue;
      }

      const [name, secret, ...metadataTokens] = parts;
      const record = createKeyRecord({
        providerId,
        providerLabel,
        endpoint,
        models,
        defaultModel,
        name,
        secret,
        sourceEnv: keysVarName,
        metadata: parseMetadata(metadataTokens),
        index,
      });
      if (record) {
        records.push(record);
      }
    }
  }

  if (records.length > 0) {
    return records;
  }

  const secret = normalizeEntry(env[singleVarName]);
  const single = secret
    ? createKeyRecord({
        providerId,
        providerLabel,
        endpoint,
        models,
        defaultModel,
        name: normalizeEntry(env[singleNameVarName]) || "primary",
        secret,
        sourceEnv: singleVarName,
        metadata: {},
        index: 0,
      })
    : null;

  if (single) {
    return [single];
  }

  if (!allowKeyless) {
    return [];
  }

  return [
    createKeylessRecord({
      providerId,
      providerLabel,
      endpoint,
      models,
      defaultModel,
      name: keylessName,
      sourceEnv: keylessSourceEnv || `${envPrefix}_ALLOW_NO_AUTH`,
    }),
  ];
}

export function serializeAiApiKey(apiKey) {
  return {
    id: apiKey.id,
    providerId: apiKey.providerId,
    providerLabel: apiKey.providerLabel,
    keyName: apiKey.keyName,
    maskedKey: apiKey.maskedKey,
    endpoint: apiKey.endpoint,
    models: apiKey.models,
    defaultModel: apiKey.defaultModel,
    priority: apiKey.priority,
    weight: apiKey.weight,
    enabled: apiKey.enabled,
    sourceEnv: apiKey.sourceEnv,
  };
}
