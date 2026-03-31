import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { copyAttachmentsFromDisk, stageWorkspaceAttachments, storeTextAttachments, summarizeAttachment } from "./attachments.js";
import { ensureDir, joinPath, truncate } from "./utils.js";

const CODEX_ENV_BLOCKLIST = [
  "OPENAI_API_KEY",
  "OPENAI_API_BASE",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT",
];

function execProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer =
      options.timeoutMs != null
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
        return;
      }
      if (code !== 0 && !options.allowFailure) {
        reject(new Error(`${command} exited with code ${code}\n${stderr || stdout}`));
        return;
      }
      resolve({
        code,
        stdout,
        stderr,
      });
    });

    if (options.stdinText) {
      child.stdin.end(options.stdinText, "utf8");
    } else {
      child.stdin.end();
    }
  });
}

export function buildCodexPrompt(prompt, attachments = []) {
  const sections = [
    "You are running inside Relay Station code mode.",
    "This task runs inside an isolated workspace created for the current code job.",
    "The workspace is independent from chat sessions and does not rely on a repository checkout.",
    "",
  ];

  if (attachments.length > 0) {
    sections.push(
      "User-provided attachments are available in this workspace:",
      ...attachments.map(
        (attachment) => `- ${attachment.workspaceRelativePath} — ${summarizeAttachment(attachment)}`,
      ),
      "",
      "Use these attachments as input when relevant.",
      "Do not modify, delete, or commit files inside `.relay-attachments/`.",
      "",
    );
  }

  sections.push(
    "Task:",
    prompt.trim() || "Use the uploaded attachments as the primary task input.",
    "",
    "Rules:",
    "- Work only inside this workspace.",
    "- You may inspect, create, modify, and run files in this workspace.",
    "- Do not run git push, merge, deploy, or change remote settings.",
    "- If a record repository is configured, Relay Station may sync your finished outputs after you stop editing.",
    "- Summarize files changed and tests run in the final answer.",
    "- If you cannot finish, explain the blocker precisely.",
  );

  return sections.join("\n");
}

export function buildCodexChildEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const key of CODEX_ENV_BLOCKLIST) {
    delete env[key];
  }
  return env;
}

export function getJobPaths(config, user, job) {
  const workspacePath = joinPath(config.workspaceRoot, user.id, job.id, "workspace");
  const recordPath = joinPath(config.workspaceRoot, user.id, job.id, "record");
  const runDir = joinPath(config.runsRoot, user.id, job.id);
  const finalMessagePath = joinPath(runDir, "final.txt");
  const eventsPath = joinPath(runDir, "events.jsonl");
  const stderrPath = joinPath(runDir, "stderr.log");

  return {
    workspacePath,
    recordPath,
    runDir,
    finalMessagePath,
    eventsPath,
    stderrPath,
  };
}

export function buildCodexExecArgs(workspacePath, finalMessagePath) {
  return [
    "exec",
    "-C",
    workspacePath,
    "--json",
    "--output-last-message",
    finalMessagePath,
    "--dangerously-bypass-approvals-and-sandbox",
    "--ephemeral",
  ];
}

async function createWorkspace(workspacePath) {
  const parentDir = path.dirname(workspacePath);
  await ensureDir(parentDir);
  await fs.rm(workspacePath, { recursive: true, force: true });
  await ensureDir(workspacePath);
  await execProcess("git", ["init", "--quiet"], { cwd: workspacePath });
}

function buildCommitMessage(prompt) {
  return `ai: ${truncate(prompt, 68)}`;
}

function normalizeRepoWebUrl(repoUrl) {
  const raw = String(repoUrl || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("git@github.com:")) {
    return `https://github.com/${raw.slice("git@github.com:".length).replace(/\.git$/, "")}`;
  }
  if (raw.startsWith("ssh://git@github.com/")) {
    return `https://github.com/${raw.slice("ssh://git@github.com/".length).replace(/\.git$/, "")}`;
  }
  return raw.replace(/\.git$/, "");
}

function buildCommitUrl(repoUrl, commitHash) {
  const baseUrl = normalizeRepoWebUrl(repoUrl);
  if (!baseUrl || !commitHash) {
    return "";
  }
  return `${baseUrl}/commit/${commitHash}`;
}

function parseGitStatusLine(line) {
  const text = String(line || "").trimEnd();
  if (!text) {
    return null;
  }

  const status = text.slice(0, 2).trim() || "??";
  const rawPath = text.slice(3).trim();
  if (!rawPath) {
    return null;
  }

  if ((status.startsWith("R") || status.startsWith("C")) && rawPath.includes(" -> ")) {
    const [previousPath, nextPath] = rawPath.split(/\s+->\s+/);
    return {
      status,
      path: String(nextPath || "").trim(),
      previousPath: String(previousPath || "").trim(),
    };
  }

  return {
    status,
    path: rawPath,
  };
}

async function inspectGitWorkspace(workspacePath) {
  const [status, diffStat, diffText] = await Promise.all([
    execProcess("git", ["status", "--short"], { cwd: workspacePath, allowFailure: true }),
    execProcess("git", ["diff", "--stat"], { cwd: workspacePath, allowFailure: true }),
    execProcess("git", ["diff", "--no-ext-diff"], { cwd: workspacePath, allowFailure: true }),
  ]);

  const changedFiles = status.stdout
    .split(/\r?\n/)
    .map(parseGitStatusLine)
    .filter(Boolean);

  const untrackedFiles = changedFiles
    .filter((file) => file.status === "??")
    .map((file) => file.path);

  const untrackedDiffs = await Promise.all(
    untrackedFiles.map(async (filePath) => {
      const [fileDiffStat, fileDiffText] = await Promise.all([
        execProcess("git", ["diff", "--no-index", "--stat", "--", "/dev/null", filePath], {
          cwd: workspacePath,
          allowFailure: true,
        }),
        execProcess("git", ["diff", "--no-index", "--", "/dev/null", filePath], {
          cwd: workspacePath,
          allowFailure: true,
        }),
      ]);

      return {
        diffStat: fileDiffStat.stdout.trim(),
        diffText: fileDiffText.stdout.trim(),
      };
    }),
  );

  return {
    gitStatusText: status.stdout.trim(),
    diffStat: [diffStat.stdout.trim(), ...untrackedDiffs.map((entry) => entry.diffStat).filter(Boolean)]
      .filter(Boolean)
      .join("\n"),
    diffText: [diffText.stdout.trim(), ...untrackedDiffs.map((entry) => entry.diffText).filter(Boolean)]
      .filter(Boolean)
      .join("\n"),
    changedFiles,
  };
}

function resolveRecordSource(user) {
  const remoteUrl = String(user.repo_url || "").trim();
  const localPath = String(user.repo_local_path || "").trim();
  return remoteUrl || localPath || "";
}

async function cloneRecordRepo(user, recordPath) {
  const parentDir = path.dirname(recordPath);
  await ensureDir(parentDir);
  await fs.rm(recordPath, { recursive: true, force: true });

  const cloneSource = resolveRecordSource(user);
  if (!cloneSource) {
    return false;
  }

  await execProcess("git", ["clone", "--quiet", cloneSource, recordPath]);
  return true;
}

async function checkoutRecordBranch(recordPath, branch, gitEnv) {
  const checkoutCurrent = await execProcess("git", ["checkout", branch], {
    cwd: recordPath,
    env: gitEnv,
    allowFailure: true,
  });
  if (checkoutCurrent.code === 0) {
    return;
  }

  const checkoutRemote = await execProcess("git", ["checkout", "-B", branch, `origin/${branch}`], {
    cwd: recordPath,
    env: gitEnv,
    allowFailure: true,
  });
  if (checkoutRemote.code === 0) {
    return;
  }

  const checkoutOrphan = await execProcess("git", ["checkout", "--orphan", branch], {
    cwd: recordPath,
    env: gitEnv,
    allowFailure: true,
  });
  if (checkoutOrphan.code === 0) {
    return;
  }

  throw new Error(`Unable to prepare record branch "${branch}".`);
}

export async function mirrorWorkspaceOutputs(recordPath, workspacePath, changedFiles) {
  for (const file of changedFiles || []) {
    const relativePath = String(file.path || "").trim();
    const previousPath = String(file.previousPath || "").trim();
    const status = String(file.status || "").trim();
    if (!relativePath || relativePath.startsWith(".git/") || relativePath.startsWith(".relay-attachments/")) {
      continue;
    }

    if (previousPath && previousPath !== relativePath && !previousPath.startsWith(".relay-attachments/")) {
      await fs.rm(joinPath(recordPath, previousPath), { force: true }).catch(() => {});
    }

    const sourcePath = joinPath(workspacePath, relativePath);
    const exists = await fs.stat(sourcePath).then(() => true).catch(() => false);
    if (status.includes("D") || !exists) {
      await fs.rm(joinPath(recordPath, relativePath), { force: true }).catch(() => {});
      continue;
    }

    const destinationPath = joinPath(recordPath, relativePath);
    await ensureDir(path.dirname(destinationPath));
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function collectJobOutputAttachments({ config, user, job, workspacePath, summaryText, changedFiles }) {
  const rootDir = joinPath(config.uploadsRoot, "code-generated", user.id, job.id);
  const attachments = await storeTextAttachments({
    rootDir,
    files: [
      {
        name: "summary.md",
        label: "summary.md",
        mimeType: "text/markdown",
        content: String(summaryText || "").trim() || "No summary generated.\n",
      },
    ],
  });

  const outputFiles = [];
  for (const file of changedFiles || []) {
    const relativePath = String(file.path || "").trim();
    if (!relativePath || relativePath.startsWith(".relay-attachments/")) {
      continue;
    }

    const absolutePath = joinPath(workspacePath, relativePath);
    const exists = await fs.stat(absolutePath).then(() => true).catch(() => false);
    if (!exists) {
      continue;
    }

    outputFiles.push({
      diskPath: absolutePath,
      name: path.basename(relativePath),
      label: relativePath,
    });
  }

  if (outputFiles.length > 0) {
    const copied = await copyAttachmentsFromDisk({
      rootDir,
      files: outputFiles,
    });
    attachments.push(...copied);
  }

  return attachments;
}

async function recordWorkspaceOutputs({ config, user, job, workspacePath, recordPath, finalMessage, changedFiles }) {
  const branch = user.repo_default_branch || "main";
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: config.gitAuthorName,
    GIT_AUTHOR_EMAIL: config.gitAuthorEmail,
    GIT_COMMITTER_NAME: config.gitAuthorName,
    GIT_COMMITTER_EMAIL: config.gitAuthorEmail,
  };

  const cloned = await cloneRecordRepo(user, recordPath);
  if (!cloned) {
    return {
      recorded: false,
      finalMessage,
    };
  }

  await checkoutRecordBranch(recordPath, branch, gitEnv);
  await mirrorWorkspaceOutputs(recordPath, workspacePath, changedFiles);
  await execProcess("git", ["add", "-A"], {
    cwd: recordPath,
    env: gitEnv,
  });

  const stagedState = await execProcess("git", ["status", "--short"], {
    cwd: recordPath,
    env: gitEnv,
  });
  if (!stagedState.stdout.trim()) {
    return {
      recorded: false,
      finalMessage,
    };
  }

  await execProcess("git", ["commit", "-m", buildCommitMessage(job.prompt)], {
    cwd: recordPath,
    env: gitEnv,
  });

  const commitHash = (
    await execProcess("git", ["rev-parse", "HEAD"], {
      cwd: recordPath,
      env: gitEnv,
    })
  ).stdout.trim();

  await execProcess("git", ["push", "--set-upstream", "origin", `HEAD:${branch}`], {
    cwd: recordPath,
    env: gitEnv,
    timeoutMs: config.gitPushTimeoutMs,
  });

  const commitUrl = buildCommitUrl(user.repo_url, commitHash);
  const pushSummary = [
    finalMessage.trim(),
    "",
    `Recorded to repository branch ${branch} at commit ${commitHash.slice(0, 12)}.`,
    commitUrl ? `View online: ${commitUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    recorded: true,
    finalMessage: pushSummary,
    pushedBranch: branch,
    commitHash,
    commitUrl,
  };
}

export async function runCodexJob({ config, user, job }) {
  const {
    workspacePath,
    recordPath,
    runDir,
    finalMessagePath,
    eventsPath,
    stderrPath,
  } = getJobPaths(config, user, job);
  await ensureDir(runDir);
  await createWorkspace(workspacePath);
  const stagedAttachments = await stageWorkspaceAttachments(job.attachments || [], workspacePath);

  const args = buildCodexExecArgs(workspacePath, finalMessagePath);
  const codexEnv = buildCodexChildEnv();

  const child = spawn(config.codexBin, args, {
    cwd: workspacePath,
    env: codexEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdoutHandle = await fs.open(eventsPath, "w");
  const stderrHandle = await fs.open(stderrPath, "w");
  const prompt = buildCodexPrompt(job.prompt, stagedAttachments);

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, config.codexTimeoutMs);

  const exitCode = await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => stdoutHandle.write(chunk));
    child.stderr.on("data", (chunk) => stderrHandle.write(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`codex exec timed out after ${config.codexTimeoutMs}ms`));
        return;
      }
      resolve(code ?? 1);
    });
    child.stdin.end(prompt, "utf8");
  }).finally(async () => {
    await stdoutHandle.close();
    await stderrHandle.close();
  });

  const finalMessage = await fs.readFile(finalMessagePath, "utf8").catch(() => "");
  const gitState = await inspectGitWorkspace(workspacePath);
  const stderrText = await fs.readFile(stderrPath, "utf8").catch(() => "");

  if (exitCode !== 0) {
    const errorText = stderrText.trim() || `codex exec failed with code ${exitCode}`;
    const outputAttachments = await collectJobOutputAttachments({
      config,
      user,
      job,
      workspacePath,
      summaryText: errorText,
      changedFiles: gitState.changedFiles,
    });
    return {
      ok: false,
      workspacePath,
      logPath: eventsPath,
      commandPreview: `${config.codexBin} ${args.join(" ")}`,
      errorText,
      outputAttachments,
      ...gitState,
    };
  }

  if (config.codeAutoPush && gitState.changedFiles.length > 0) {
    try {
      const pushed = await recordWorkspaceOutputs({
        config,
        user,
        job,
        workspacePath,
        recordPath,
        finalMessage,
        changedFiles: gitState.changedFiles,
      });
      const outputAttachments = await collectJobOutputAttachments({
        config,
        user,
        job,
        workspacePath,
        summaryText: pushed.finalMessage,
        changedFiles: gitState.changedFiles,
      });

      return {
        ok: true,
        workspacePath,
        logPath: eventsPath,
        commandPreview: `${config.codexBin} ${args.join(" ")}`,
        finalMessage: pushed.finalMessage,
        outputAttachments,
        ...gitState,
      };
    } catch (error) {
      const warningText = [
        finalMessage.trim(),
        "",
        `Repository recording failed: ${error instanceof Error ? error.message : String(error)}`,
        "The code job itself completed. Review the output files attached to this job.",
      ]
        .filter(Boolean)
        .join("\n");
      const outputAttachments = await collectJobOutputAttachments({
        config,
        user,
        job,
        workspacePath,
        summaryText: warningText,
        changedFiles: gitState.changedFiles,
      });
      return {
        ok: true,
        workspacePath,
        logPath: eventsPath,
        commandPreview: `${config.codexBin} ${args.join(" ")}`,
        finalMessage: warningText,
        outputAttachments,
        ...gitState,
      };
    }
  }

  const outputAttachments = await collectJobOutputAttachments({
    config,
    user,
    job,
    workspacePath,
    summaryText: finalMessage.trim(),
    changedFiles: gitState.changedFiles,
  });

  return {
    ok: true,
    workspacePath,
    logPath: eventsPath,
    commandPreview: `${config.codexBin} ${args.join(" ")}`,
    finalMessage: finalMessage.trim(),
    outputAttachments,
    ...gitState,
  };
}
