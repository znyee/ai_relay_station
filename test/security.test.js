import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionCookie,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
  verifySessionCookie,
} from "../src/security.js";

test("password hashing verifies correctly", () => {
  const hash = hashPassword("secret-123");
  assert.equal(verifyPassword("secret-123", hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
});

test("session cookie roundtrip", () => {
  const cookie = createSessionCookie(
    {
      id: "ses_1",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    "test-secret",
  );
  const decoded = verifySessionCookie(cookie, "test-secret");
  assert.equal(decoded.sid, "ses_1");
});

test("password strength policy enforces enterprise baseline", () => {
  assert.match(validatePasswordStrength("short"), /at least/i);
  assert.equal(validatePasswordStrength("123456"), "");
  assert.equal(validatePasswordStrength("ChangeMe123!"), "");
});
