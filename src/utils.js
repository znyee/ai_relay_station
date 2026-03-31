import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function nowIso() {
  return new Date().toISOString();
}

export function randomId(prefix = "") {
  return `${prefix}${crypto.randomUUID()}`;
}

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

export function safeJsonParse(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

export function fromBase64Url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function truncate(text, maxLength = 120) {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function joinPath(...parts) {
  return path.join(...parts);
}
