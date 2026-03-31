import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, joinPath, randomId } from "./utils.js";

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "application/x-typescript",
  "application/sql",
  "image/svg+xml",
]);

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cfg",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".lua",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export const WORKSPACE_ATTACHMENTS_DIR = ".relay-attachments";
const ATTACHMENT_MIME_BY_EXTENSION = new Map([
  [".c", "text/plain"],
  [".cc", "text/plain"],
  [".cfg", "text/plain"],
  [".conf", "text/plain"],
  [".cpp", "text/plain"],
  [".css", "text/css"],
  [".csv", "text/csv"],
  [".env", "text/plain"],
  [".go", "text/plain"],
  [".graphql", "application/graphql-response+json"],
  [".h", "text/plain"],
  [".hpp", "text/plain"],
  [".html", "text/html"],
  [".ini", "text/plain"],
  [".java", "text/plain"],
  [".js", "application/javascript"],
  [".json", "application/json"],
  [".jsx", "text/plain"],
  [".log", "text/plain"],
  [".lua", "text/plain"],
  [".md", "text/markdown"],
  [".mjs", "application/javascript"],
  [".py", "text/x-python"],
  [".rb", "text/plain"],
  [".rs", "text/plain"],
  [".sh", "application/x-sh"],
  [".sql", "application/sql"],
  [".svg", "image/svg+xml"],
  [".toml", "text/plain"],
  [".ts", "application/typescript"],
  [".tsx", "text/plain"],
  [".txt", "text/plain"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
]);

function formatSize(size) {
  if (!Number.isFinite(size) || size < 1024) {
    return `${size || 0} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function sanitizeAttachmentName(name) {
  const basename = path.basename(String(name || "").trim()) || "file";
  const cleaned = basename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "") || "file";
}

export function classifyAttachment({ mimeType = "", name = "" }) {
  const normalizedMime = String(mimeType || "").toLowerCase();
  const extension = path.extname(String(name || "").toLowerCase());
  if (normalizedMime.startsWith("image/")) {
    return "image";
  }
  if (
    TEXT_MIME_PREFIXES.some((prefix) => normalizedMime.startsWith(prefix)) ||
    TEXT_MIME_TYPES.has(normalizedMime) ||
    TEXT_EXTENSIONS.has(extension)
  ) {
    return "text";
  }
  return "binary";
}

export function inferAttachmentMimeType(name, fallback = "application/octet-stream") {
  const extension = path.extname(String(name || "").toLowerCase());
  return ATTACHMENT_MIME_BY_EXTENSION.get(extension) || fallback;
}

export function summarizeAttachment(attachment) {
  return `${attachment.name} (${attachment.mimeType || attachment.kind}, ${formatSize(attachment.size)})`;
}

export async function storeUploadedAttachments({ files, rootDir }) {
  await ensureDir(rootDir);

  const attachments = [];
  for (const [index, file] of files.entries()) {
    const id = randomId("att_");
    const name = sanitizeAttachmentName(file.originalname || file.fieldname || `file-${index + 1}`);
    const storedName = `${String(index + 1).padStart(2, "0")}-${name}`;
    const diskPath = joinPath(rootDir, storedName);
    await fs.writeFile(diskPath, file.buffer);
    attachments.push({
      id,
      name,
      storedName,
      diskPath,
      mimeType: String(file.mimetype || "application/octet-stream"),
      size: Number(file.size || file.buffer.length || 0),
      kind: classifyAttachment({ mimeType: file.mimetype, name }),
    });
  }

  return attachments;
}

export async function storeTextAttachments({ files, rootDir }) {
  await ensureDir(rootDir);

  const attachments = [];
  for (const [index, file] of files.entries()) {
    const label = String(file.label || file.name || `file-${index + 1}.txt`).trim() || `file-${index + 1}.txt`;
    const name = sanitizeAttachmentName(path.basename(label));
    const storedName = `${String(index + 1).padStart(2, "0")}-${name}`;
    const diskPath = joinPath(rootDir, storedName);
    const buffer = Buffer.from(String(file.content || ""), "utf8");
    const mimeType = String(file.mimeType || inferAttachmentMimeType(name, "text/plain"));
    await fs.writeFile(diskPath, buffer);
    attachments.push({
      id: randomId("att_"),
      name,
      label,
      storedName,
      diskPath,
      mimeType,
      size: buffer.length,
      kind: classifyAttachment({ mimeType, name }),
    });
  }

  return attachments;
}

export async function copyAttachmentsFromDisk({ files, rootDir }) {
  await ensureDir(rootDir);

  const attachments = [];
  for (const [index, file] of files.entries()) {
    const label = String(file.label || file.name || path.basename(file.diskPath || "") || `file-${index + 1}`).trim() || `file-${index + 1}`;
    const name = sanitizeAttachmentName(path.basename(file.name || label));
    const storedName = `${String(index + 1).padStart(2, "0")}-${name}`;
    const diskPath = joinPath(rootDir, storedName);
    await fs.copyFile(file.diskPath, diskPath);
    const stat = await fs.stat(diskPath);
    const mimeType = String(file.mimeType || inferAttachmentMimeType(name));
    attachments.push({
      id: randomId("att_"),
      name,
      label,
      storedName,
      diskPath,
      mimeType,
      size: stat.size,
      kind: classifyAttachment({ mimeType, name }),
    });
  }

  return attachments;
}

export async function readAttachmentText(attachment, maxBytes) {
  const buffer = await fs.readFile(attachment.diskPath);
  const truncated = buffer.length > maxBytes;
  const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;
  return {
    text: slice.toString("utf8"),
    truncated,
  };
}

export async function readAttachmentDataUrl(attachment, maxBytes) {
  if (attachment.size > maxBytes) {
    return null;
  }
  const buffer = await fs.readFile(attachment.diskPath);
  return `data:${attachment.mimeType || "application/octet-stream"};base64,${buffer.toString("base64")}`;
}

async function ensureWorkspaceIgnore(workspacePath) {
  const excludePath = joinPath(workspacePath, ".git", "info", "exclude");
  const marker = `# Relay Station attachments\n/${WORKSPACE_ATTACHMENTS_DIR}/\n`;
  const current = await fs.readFile(excludePath, "utf8").catch(() => "");
  if (current.includes(`/${WORKSPACE_ATTACHMENTS_DIR}/`)) {
    return;
  }
  await fs.appendFile(excludePath, `${current && !current.endsWith("\n") ? "\n" : ""}${marker}`, "utf8");
}

export async function stageWorkspaceAttachments(attachments, workspacePath) {
  if (!attachments.length) {
    return [];
  }

  await ensureWorkspaceIgnore(workspacePath);
  const targetDir = joinPath(workspacePath, WORKSPACE_ATTACHMENTS_DIR);
  await ensureDir(targetDir);

  const staged = [];
  for (const [index, attachment] of attachments.entries()) {
    const storedName = `${String(index + 1).padStart(2, "0")}-${sanitizeAttachmentName(attachment.name)}`;
    const relativePath = path.posix.join(WORKSPACE_ATTACHMENTS_DIR, storedName);
    const diskPath = joinPath(workspacePath, relativePath);
    await fs.copyFile(attachment.diskPath, diskPath);
    staged.push({
      ...attachment,
      workspaceRelativePath: relativePath,
    });
  }

  const manifest = [
    "# Relay Station Attachments",
    "",
    ...staged.map((attachment) => `- ${attachment.workspaceRelativePath} — ${summarizeAttachment(attachment)}`),
    "",
    "These files are user-provided context. Do not commit them back to the repository.",
    "",
  ].join("\n");
  await fs.writeFile(joinPath(targetDir, "ATTACHMENTS.md"), manifest, "utf8");

  return staged;
}

export function serializeAttachmentForClient(attachment, url) {
  return {
    id: attachment.id,
    name: attachment.name,
    label: attachment.label || attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: attachment.kind,
    url,
  };
}
