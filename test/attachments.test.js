import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  classifyAttachment,
  copyAttachmentsFromDisk,
  storeTextAttachments,
  sanitizeAttachmentName,
  stageWorkspaceAttachments,
  storeUploadedAttachments,
} from "../src/attachments.js";

const execFileAsync = promisify(execFile);

test("attachment helpers classify and sanitize input", () => {
  assert.equal(sanitizeAttachmentName("../ui spec?.png"), "ui-spec-.png");
  assert.equal(classifyAttachment({ mimeType: "image/png", name: "screen.png" }), "image");
  assert.equal(classifyAttachment({ mimeType: "text/plain", name: "notes.txt" }), "text");
  assert.equal(classifyAttachment({ mimeType: "application/octet-stream", name: "archive.zip" }), "binary");
});

test("uploaded attachments are stored and staged into ignored workspace paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-attachments-"));
  const uploadsDir = path.join(tempDir, "uploads");
  const repoDir = path.join(tempDir, "repo");
  await fs.mkdir(repoDir, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repoDir });
  await fs.writeFile(path.join(repoDir, "README.md"), "# temp\n", "utf8");

  const attachments = await storeUploadedAttachments({
    rootDir: uploadsDir,
    files: [
      {
        originalname: "notes.txt",
        mimetype: "text/plain",
        size: 5,
        buffer: Buffer.from("hello", "utf8"),
      },
      {
        originalname: "screen.png",
        mimetype: "image/png",
        size: 4,
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      },
    ],
  });

  const staged = await stageWorkspaceAttachments(attachments, repoDir);
  const exclude = await fs.readFile(path.join(repoDir, ".git", "info", "exclude"), "utf8");
  const manifest = await fs.readFile(path.join(repoDir, ".relay-attachments", "ATTACHMENTS.md"), "utf8");

  assert.equal(attachments.length, 2);
  assert.equal(staged[0].workspaceRelativePath, ".relay-attachments/01-notes.txt");
  assert.match(exclude, /\/\.relay-attachments\//);
  assert.match(manifest, /Relay Station Attachments/);
});

test("uploaded attachments can be copied from disk-backed temp files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-attachments-disk-"));
  const uploadsDir = path.join(tempDir, "uploads");
  const tempUpload = path.join(tempDir, "incoming", "notes.txt");
  await fs.mkdir(path.dirname(tempUpload), { recursive: true });
  await fs.writeFile(tempUpload, "hello-from-disk", "utf8");

  const attachments = await storeUploadedAttachments({
    rootDir: uploadsDir,
    files: [
      {
        originalname: "notes.txt",
        mimetype: "text/plain",
        size: 15,
        path: tempUpload,
      },
    ],
  });

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, "notes.txt");
  assert.equal(await fs.readFile(attachments[0].diskPath, "utf8"), "hello-from-disk");
});

test("generated text and copied file attachments keep labels and become downloadable artifacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-attachments-"));
  const uploadsDir = path.join(tempDir, "outputs");
  const sourceFile = path.join(tempDir, "src", "nested", "report.txt");
  await fs.mkdir(path.dirname(sourceFile), { recursive: true });
  await fs.writeFile(sourceFile, "report-body\n", "utf8");

  const generated = await storeTextAttachments({
    rootDir: uploadsDir,
    files: [
      {
        name: "reply.md",
        label: "reply.md",
        content: "# Hello\n",
      },
    ],
  });
  const copied = await copyAttachmentsFromDisk({
    rootDir: uploadsDir,
    files: [
      {
        diskPath: sourceFile,
        name: "report.txt",
        label: "docs/report.txt",
      },
    ],
  });

  assert.equal(generated[0].label, "reply.md");
  assert.equal(generated[0].mimeType, "text/markdown");
  assert.equal(copied[0].label, "docs/report.txt");
  assert.equal(copied[0].name, "report.txt");
  assert.equal(await fs.readFile(copied[0].diskPath, "utf8"), "report-body\n");
});
