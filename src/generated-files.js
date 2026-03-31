import path from "node:path";

const FENCE_PATTERN = /```([^\n`]*)\n([\s\S]*?)```/g;
const FILE_LINE_PATTERN = /^(?:file|filename|path)\s*:\s*`?([^`]+)`?$/i;
const HEADING_FILE_PATTERN = /^#{1,6}\s+`?([^`]+)`?$/;
const QUOTED_NAME_PATTERN = /^["'`](.*)["'`]$/;

function stripWrappingQuotes(value) {
  const text = String(value || "").trim();
  const match = text.match(QUOTED_NAME_PATTERN);
  return match ? match[1].trim() : text;
}

function normalizeCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\\/g, "/");
}

function looksLikeFilePath(value) {
  const text = normalizeCandidate(value);
  return Boolean(text) && (text.includes("/") || /\.[a-zA-Z0-9_-]{1,16}$/.test(text));
}

function extractFromInfoString(info) {
  const text = String(info || "").trim();
  if (!text) {
    return "";
  }

  for (const match of text.matchAll(/(?:^|\s)(?:file|filename|path|title)\s*=\s*("[^"]+"|'[^']+'|[^\s]+)/gi)) {
    const candidate = normalizeCandidate(stripWrappingQuotes(match[1]));
    if (looksLikeFilePath(candidate)) {
      return candidate;
    }
  }

  const tokens = text
    .split(/\s+/)
    .map(stripWrappingQuotes)
    .map(normalizeCandidate)
    .filter(Boolean);

  for (const token of tokens) {
    if (token.includes("=")) {
      continue;
    }
    if (looksLikeFilePath(token)) {
      return token;
    }
  }

  return "";
}

function extractFromPreviousLine(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1) || "";

  if (!line) {
    return "";
  }

  const fileLine = line.match(FILE_LINE_PATTERN);
  if (fileLine) {
    const candidate = normalizeCandidate(stripWrappingQuotes(fileLine[1]));
    if (looksLikeFilePath(candidate)) {
      return candidate;
    }
  }

  const headingLine = line.match(HEADING_FILE_PATTERN);
  if (headingLine) {
    const candidate = normalizeCandidate(stripWrappingQuotes(headingLine[1]));
    if (looksLikeFilePath(candidate)) {
      return candidate;
    }
  }

  const inlineCandidate = normalizeCandidate(stripWrappingQuotes(line));
  if (looksLikeFilePath(inlineCandidate)) {
    return inlineCandidate;
  }

  return "";
}

function withTrailingNewline(content) {
  const text = String(content || "");
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function buildChatGeneratedFiles(text) {
  const responseText = String(text || "").trim();
  if (!responseText) {
    return [];
  }

  const files = [];
  const seenLabels = new Set();

  for (const match of responseText.matchAll(FENCE_PATTERN)) {
    const info = match[1] || "";
    const body = match[2] || "";
    const candidate =
      extractFromInfoString(info) ||
      extractFromPreviousLine(responseText.slice(0, match.index));
    if (!candidate || seenLabels.has(candidate)) {
      continue;
    }

    seenLabels.add(candidate);
    files.push({
      name: path.basename(candidate),
      label: candidate,
      content: withTrailingNewline(body),
    });
  }

  return files;
}
