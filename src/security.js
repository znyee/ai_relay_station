import crypto from "node:crypto";
import { base64Url, fromBase64Url, nowIso } from "./utils.js";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password, hash) {
  const [salt, expected] = String(hash || "").split(":");
  if (!salt || !expected) {
    return false;
  }

  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function validatePasswordStrength(password, options = {}) {
  const value = String(password || "");
  const minLength = Math.max(6, Number(options.minLength || 6));
  if (value.length < minLength) {
    return `Password must be at least ${minLength} characters long.`;
  }
  return "";
}

export function generateStrongPassword(length = 20) {
  const size = Math.max(16, Number(length || 20));
  while (true) {
    const candidate = crypto.randomBytes(size).toString("base64url").slice(0, size);
    if (!validatePasswordStrength(candidate)) {
      return candidate;
    }
  }
}

function signPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionCookie(session, secret) {
  const payload = base64Url(
    JSON.stringify({
      sid: session.id,
      t: nowIso(),
    }),
  );
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function verifySessionCookie(cookieValue, secret) {
  const [payload, signature] = String(cookieValue || "").split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = signPayload(payload, secret);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const decoded = JSON.parse(fromBase64Url(payload));
    if (decoded.exp && new Date(decoded.exp).getTime() <= Date.now()) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookies(headerValue) {
  const cookies = {};
  if (!headerValue) {
    return cookies;
  }

  for (const part of headerValue.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name) {
      continue;
    }
    cookies[name] = decodeURIComponent(rest.join("="));
  }

  return cookies;
}
