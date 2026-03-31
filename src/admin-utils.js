import { validatePasswordStrength } from "./security.js";

export function validateConfiguredRootAdminPassword(password, options = {}) {
  const message = validatePasswordStrength(password, {
    minLength: options.minLength,
  });
  if (!message) {
    return "";
  }
  if (options.allowWeakPassword) {
    return message;
  }
  throw new Error(`Root admin password: ${message}`);
}

export function summarizeApiUsage(apiKeys = [], dispatchEvents = []) {
  const keyRows = Array.isArray(apiKeys) ? apiKeys : [];
  const eventRows = Array.isArray(dispatchEvents) ? dispatchEvents : [];

  const providers = new Map();
  for (const apiKey of keyRows) {
    const providerId = String(apiKey.providerId || "");
    if (!providers.has(providerId)) {
      providers.set(providerId, {
        providerId,
        providerLabel: apiKey.providerLabel || providerId || "Unknown",
        keyCount: 0,
        healthyKeys: 0,
        cooldownKeys: 0,
        degradedKeys: 0,
        disabledKeys: 0,
        successCount: 0,
        failureCount: 0,
        quotaFailureCount: 0,
        retryableFailureCount: 0,
        inFlight: 0,
        lastUsedAt: "",
      });
    }

    const summary = providers.get(providerId);
    summary.keyCount += 1;
    summary.successCount += Number(apiKey.successCount || 0);
    summary.failureCount += Number(apiKey.failureCount || 0);
    summary.quotaFailureCount += Number(apiKey.quotaFailureCount || 0);
    summary.retryableFailureCount += Number(apiKey.retryableFailureCount || 0);
    summary.inFlight += Number(apiKey.inFlight || 0);

    const status = String(apiKey.status || "");
    if (status === "healthy") {
      summary.healthyKeys += 1;
    } else if (status === "cooldown") {
      summary.cooldownKeys += 1;
    } else if (status === "degraded") {
      summary.degradedKeys += 1;
    } else if (status === "disabled") {
      summary.disabledKeys += 1;
    }

    const lastUsedAt = String(apiKey.lastUsedAt || "");
    if (lastUsedAt && (!summary.lastUsedAt || lastUsedAt > summary.lastUsedAt)) {
      summary.lastUsedAt = lastUsedAt;
    }
  }

  const uniqueUsers = new Set();
  let successfulDispatches = 0;
  let failedDispatches = 0;
  let routeFailovers = 0;
  let latestDispatchAt = "";

  for (const event of eventRows) {
    const identifier = String(event.userId || event.username || "").trim();
    if (identifier) {
      uniqueUsers.add(identifier);
    }

    const status = String(event.status || "");
    if (status === "success") {
      successfulDispatches += 1;
    } else if (status === "failed") {
      failedDispatches += 1;
    } else if (status === "route-failed" || status === "route-terminal") {
      routeFailovers += 1;
    }

    const createdAt = String(event.createdAt || "");
    if (createdAt && (!latestDispatchAt || createdAt > latestDispatchAt)) {
      latestDispatchAt = createdAt;
    }
  }

  const providerBreakdown = [...providers.values()].sort((left, right) => {
    const successDelta = right.successCount - left.successCount;
    if (successDelta !== 0) {
      return successDelta;
    }
    return left.providerLabel.localeCompare(right.providerLabel);
  });

  return {
    totalSuccessCount: keyRows.reduce((sum, row) => sum + Number(row.successCount || 0), 0),
    totalFailureCount: keyRows.reduce((sum, row) => sum + Number(row.failureCount || 0), 0),
    totalQuotaFailures: keyRows.reduce((sum, row) => sum + Number(row.quotaFailureCount || 0), 0),
    totalRetryableFailures: keyRows.reduce((sum, row) => sum + Number(row.retryableFailureCount || 0), 0),
    cooldownKeys: keyRows.filter((row) => row.status === "cooldown").length,
    degradedKeys: keyRows.filter((row) => row.status === "degraded").length,
    inFlight: keyRows.reduce((sum, row) => sum + Number(row.inFlight || 0), 0),
    configuredProviders: providerBreakdown.length,
    recentDispatches: eventRows.length,
    successfulDispatches,
    failedDispatches,
    routeFailovers,
    activeUsers: uniqueUsers.size,
    latestDispatchAt,
    providerBreakdown,
  };
}
