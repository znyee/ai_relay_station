import test from "node:test";
import assert from "node:assert/strict";
import { summarizeApiUsage, validateConfiguredRootAdminPassword } from "../src/admin-utils.js";

test("configured root admin password only allows weak passwords when explicitly enabled", () => {
  assert.throws(
    () => validateConfiguredRootAdminPassword("123456", { minLength: 12, allowWeakPassword: false }),
    /Root admin password:/,
  );
  assert.match(
    validateConfiguredRootAdminPassword("123456", { minLength: 12, allowWeakPassword: true }),
    /at least/i,
  );
  assert.equal(
    validateConfiguredRootAdminPassword("ChangeMe123!", { minLength: 12, allowWeakPassword: false }),
    "",
  );
});

test("api usage summary aggregates key health and dispatch history", () => {
  const summary = summarizeApiUsage(
    [
      {
        providerId: "openai",
        providerLabel: "OpenAI",
        status: "healthy",
        successCount: 7,
        failureCount: 2,
        quotaFailureCount: 1,
        retryableFailureCount: 1,
        inFlight: 1,
        lastUsedAt: "2026-03-31T02:00:00.000Z",
      },
      {
        providerId: "openai",
        providerLabel: "OpenAI",
        status: "cooldown",
        successCount: 3,
        failureCount: 4,
        quotaFailureCount: 2,
        retryableFailureCount: 3,
        inFlight: 0,
        lastUsedAt: "2026-03-31T03:00:00.000Z",
      },
      {
        providerId: "deepseek",
        providerLabel: "DeepSeek",
        status: "degraded",
        successCount: 5,
        failureCount: 1,
        quotaFailureCount: 0,
        retryableFailureCount: 1,
        inFlight: 2,
        lastUsedAt: "2026-03-31T01:00:00.000Z",
      },
    ],
    [
      {
        userId: "usr_1",
        username: "owner",
        status: "success",
        createdAt: "2026-03-31T03:10:00.000Z",
      },
      {
        userId: "usr_2",
        username: "root",
        status: "failed",
        createdAt: "2026-03-31T03:09:00.000Z",
      },
      {
        userId: "usr_1",
        username: "owner",
        status: "route-failed",
        createdAt: "2026-03-31T03:08:00.000Z",
      },
    ],
  );

  assert.equal(summary.totalSuccessCount, 15);
  assert.equal(summary.totalFailureCount, 7);
  assert.equal(summary.totalQuotaFailures, 3);
  assert.equal(summary.totalRetryableFailures, 5);
  assert.equal(summary.cooldownKeys, 1);
  assert.equal(summary.degradedKeys, 1);
  assert.equal(summary.inFlight, 3);
  assert.equal(summary.recentDispatches, 3);
  assert.equal(summary.successfulDispatches, 1);
  assert.equal(summary.failedDispatches, 1);
  assert.equal(summary.routeFailovers, 1);
  assert.equal(summary.activeUsers, 2);
  assert.equal(summary.latestDispatchAt, "2026-03-31T03:10:00.000Z");
  assert.equal(summary.providerBreakdown[0].providerLabel, "OpenAI");
  assert.equal(summary.providerBreakdown[0].keyCount, 2);
  assert.equal(summary.providerBreakdown[0].cooldownKeys, 1);
  assert.equal(summary.providerBreakdown[0].lastUsedAt, "2026-03-31T03:00:00.000Z");
});
