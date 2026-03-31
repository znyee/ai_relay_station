import { loadConfig } from "../src/config.js";
import { createDatabase } from "../src/db.js";
import { hashPassword, validatePasswordStrength } from "../src/security.js";
import { ensureDir } from "../src/utils.js";

function readFlag(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return "";
  }
  return process.argv[index + 1] || "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const config = loadConfig();
await ensureDir(config.dataDir);
const db = createDatabase(config.databasePath);

const username = readFlag("username") || process.env.SEED_USERNAME || "owner";
const password = readFlag("password") || process.env.SEED_PASSWORD || "";
const displayName = readFlag("display-name") || process.env.SEED_DISPLAY_NAME || username;
const unbound = hasFlag("unbound") || process.env.SEED_UNBOUND === "1";
const repoUrl = unbound ? "" : readFlag("repo-url") || process.env.SEED_REPO_URL || "";
const repoPath = unbound ? "" : readFlag("repo-path") || process.env.SEED_REPO_PATH || "";
const repoBranch = readFlag("repo-branch") || process.env.SEED_REPO_BRANCH || "main";
const isAdmin = hasFlag("admin") || process.env.SEED_ADMIN === "1";

function defaultChatSelection() {
  const provider = config.chatProviders[0];
  return {
    chatModel: provider?.defaultModel || "chat-disabled",
    allowedModels: provider?.models || [],
  };
}

if (!password) {
  console.error("Missing password. Pass --password or set SEED_PASSWORD.");
  process.exit(1);
}

const passwordPolicyError = validatePasswordStrength(password, {
  minLength: config.authMinPasswordLength,
});
if (passwordPolicyError) {
  console.error(passwordPolicyError);
  process.exit(1);
}

const existing = db.getUserByUsername(username);
if (existing) {
  db.updateUser({
    id: existing.id,
    passwordHash: await hashPassword(password),
    displayName,
    repoUrl,
    repoLocalPath: repoPath,
    repoDefaultBranch: repoBranch,
    chatModel: existing.chat_model,
    allowedModels: existing.allowedModels,
    canUseCode: true,
    isAdmin,
  });
  console.log(`Updated user ${username}`);
} else {
  const defaults = defaultChatSelection();
  db.createUser({
    username,
    passwordHash: await hashPassword(password),
    displayName,
    repoUrl,
    repoLocalPath: repoPath,
    repoDefaultBranch: repoBranch,
    chatModel: defaults.chatModel,
    allowedModels: defaults.allowedModels,
    canUseCode: true,
    isAdmin,
  });
  console.log(`Created user ${username}`);
}
