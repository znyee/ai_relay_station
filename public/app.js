import { renderMarkdown } from "./markdown.js";

const state = {
  me: null,
  chat: null,
  capabilities: null,
  adminOverview: null,
  authMode: "login",
  mode: "chat",
  themeMode: document.documentElement.dataset.theme || "light",
  conversations: [],
  selectedConversationId: null,
  messages: [],
  jobs: [],
  selectedJobId: null,
  selectedJob: null,
  selectedJobLogText: "",
  adminSelectedUserId: null,
  adminSelectedUser: null,
  adminSelectedUserConversations: [],
  adminSelectedUserJobs: [],
  adminSelectedUserSessions: [],
  adminUserSearch: "",
  pendingChatAttachments: [],
  pendingCodeAttachments: [],
  chatRequestPending: false,
};

const CHAT_PROVIDER_STORAGE_KEY = "relay.chatProviderId.v2";
const CHAT_MODEL_STORAGE_KEY_PREFIX = "relay.chatModel.v2.";
const THEME_STORAGE_KEY = "relay.theme.v1";
const JOB_POLL_INTERVAL_MS = 2000;
const ATTACHMENT_DOWNLOAD_DEBOUNCE_MS = 1500;
const ROUTING_PRIORITY_BASE = 1000;
const ROUTING_PRIORITY_STEP = 10;

const els = {
  appShell: document.getElementById("app-shell"),
  bootScreen: document.getElementById("boot-screen"),
  loginScreen: document.getElementById("login-screen"),
  appScreen: document.getElementById("app-screen"),
  themeButtons: Array.from(document.querySelectorAll("[data-theme-mode]")),
  authModeButtons: Array.from(document.querySelectorAll("#auth-mode-toggle [data-auth-mode]")),
  loginForm: document.getElementById("login-form"),
  loginPanelTitle: document.getElementById("login-panel-title"),
  loginConfirmPasswordRow: document.getElementById("login-confirm-password-row"),
  loginSubmitButton: document.getElementById("login-submit-button"),
  loginError: document.getElementById("login-error"),
  userName: document.getElementById("user-name"),
  chatListPanel: document.getElementById("chat-list-panel"),
  codeListPanel: document.getElementById("code-list-panel"),
  conversationList: document.getElementById("conversation-list"),
  newChatButton: document.getElementById("new-chat-button"),
  chatMessages: document.getElementById("chat-messages"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  chatTitle: document.getElementById("chat-title"),
  chatConversationActions: document.getElementById("chat-conversation-actions"),
  chatPinButton: document.getElementById("chat-pin-button"),
  chatDeleteButton: document.getElementById("chat-delete-button"),
  chatProviderSelect: document.getElementById("chat-provider-select"),
  chatModelSelect: document.getElementById("chat-model-select"),
  chatAttachmentsInput: document.getElementById("chat-attachments-input"),
  chatAttachmentList: document.getElementById("chat-attachment-list"),
  chatSubmitButton: document.querySelector("#chat-form button[type='submit']"),
  codeModeButton: document.querySelector('#app-mode-toggle .mode-button[data-mode="code"]'),
  adminModeButton: document.getElementById("admin-mode-button"),
  codeForm: document.getElementById("code-form"),
  codeInput: document.getElementById("code-input"),
  codeAttachmentsInput: document.getElementById("code-attachments-input"),
  codeAttachmentList: document.getElementById("code-attachment-list"),
  codeSubmitButton: document.querySelector("#code-form button[type='submit']"),
  jobList: document.getElementById("job-list"),
  jobDetail: document.getElementById("job-detail"),
  jobTitle: document.getElementById("job-title"),
  jobActions: document.getElementById("job-actions"),
  jobPinButton: document.getElementById("job-pin-button"),
  jobDeleteButton: document.getElementById("job-delete-button"),
  queuePill: document.getElementById("queue-pill"),
  logoutButton: document.getElementById("logout-button"),
  modeToggle: document.getElementById("app-mode-toggle"),
  modeButtons: Array.from(document.querySelectorAll("#app-mode-toggle [data-mode]")),
  modePanels: {
    chat: document.getElementById("chat-mode"),
    code: document.getElementById("code-mode"),
    admin: document.getElementById("admin-mode"),
  },
  adminRefreshButton: document.getElementById("admin-refresh-button"),
  adminSummary: document.getElementById("admin-summary"),
  adminUsersSection: document.getElementById("admin-users-section"),
  adminUserSearchInput: document.getElementById("admin-user-search-input"),
  adminUsersTable: document.getElementById("admin-users-table"),
  adminDispatchSettingsSection: document.getElementById("admin-dispatch-settings-section"),
  adminDispatchForm: document.getElementById("admin-dispatch-form"),
  adminRetryCooldownInput: document.getElementById("admin-retry-cooldown-input"),
  adminQuotaCooldownInput: document.getElementById("admin-quota-cooldown-input"),
  adminBreakerThresholdInput: document.getElementById("admin-breaker-threshold-input"),
  adminBreakerCooldownInput: document.getElementById("admin-breaker-cooldown-input"),
  adminHistoryLimitInput: document.getElementById("admin-history-limit-input"),
  adminRoutingResetButton: document.getElementById("admin-routing-reset-button"),
  adminUserRecordsSection: document.getElementById("admin-user-records-section"),
  adminUserRecordsTitle: document.getElementById("admin-user-records-title"),
  adminUserConversations: document.getElementById("admin-user-conversations"),
  adminUserJobsSection: document.getElementById("admin-user-jobs-section"),
  adminUserJobsTitle: document.getElementById("admin-user-jobs-title"),
  adminUserJobs: document.getElementById("admin-user-jobs"),
  adminUserSessionsSection: document.getElementById("admin-user-sessions-section"),
  adminUserSessionsTitle: document.getElementById("admin-user-sessions-title"),
  adminUserSessions: document.getElementById("admin-user-sessions"),
  adminAuthSection: document.getElementById("admin-auth-section"),
  adminProviderUsageTable: document.getElementById("admin-provider-usage-table"),
  adminApiKeyTable: document.getElementById("admin-api-key-table"),
  adminAutoRoutingTable: document.getElementById("admin-auto-routing-table"),
  adminDispatchTable: document.getElementById("admin-dispatch-table"),
  adminAuthTable: document.getElementById("admin-auth-table"),
};

let jobsRefreshInFlight = false;
let messageRenderFrame = 0;
const attachmentDownloads = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString();
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!value) {
    return "—";
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
}

function escapeCell(value, fallback = "—") {
  const text = String(value ?? "").trim();
  return escapeHtml(text || fallback);
}

function shouldAllowAttachmentDownload(url) {
  const key = String(url || "").trim();
  if (!key) {
    return true;
  }

  const now = Date.now();
  const cooldownUntil = attachmentDownloads.get(key) || 0;
  if (cooldownUntil > now) {
    return false;
  }

  const nextCooldown = now + ATTACHMENT_DOWNLOAD_DEBOUNCE_MS;
  attachmentDownloads.set(key, nextCooldown);
  window.setTimeout(() => {
    const latest = attachmentDownloads.get(key) || 0;
    if (latest <= Date.now()) {
      attachmentDownloads.delete(key);
    }
  }, ATTACHMENT_DOWNLOAD_DEBOUNCE_MS + 50);
  return true;
}

function setAttachmentDownloadPending(card, pending) {
  if (!card) {
    return;
  }

  const hint = card.querySelector(".attachment-download-hint");
  if (pending) {
    card.classList.add("download-pending");
    if (hint) {
      hint.dataset.defaultText ||= hint.textContent || "Click to download";
      hint.textContent = "Preparing download";
    }
    return;
  }

  card.classList.remove("download-pending");
  if (hint?.dataset.defaultText) {
    hint.textContent = hint.dataset.defaultText;
  }
}

function normalizeThemeMode(value) {
  return value === "dark" ? "dark" : "light";
}

function applyThemeMode(mode, { persist = true } = {}) {
  const normalized = normalizeThemeMode(mode);
  state.themeMode = normalized;
  document.documentElement.dataset.theme = normalized;
  document.documentElement.style.colorScheme = normalized;
  if (persist) {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
  }
  for (const button of els.themeButtons) {
    const active = button.dataset.themeMode === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function copyTextFallback(text) {
  const element = document.createElement("textarea");
  element.value = text;
  element.setAttribute("readonly", "");
  element.style.position = "absolute";
  element.style.left = "-9999px";
  document.body.append(element);
  element.select();
  document.execCommand("copy");
  element.remove();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  copyTextFallback(text);
}

function codeBlockLanguage(code) {
  const match = String(code.className || "").match(/language-([a-z0-9_-]+)/i);
  if (!match) {
    return "Text";
  }
  return match[1].replaceAll("-", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function enhanceMarkdownBlocks(container) {
  if (!container) {
    return;
  }

  for (const pre of container.querySelectorAll(".message-markdown pre")) {
    if (pre.parentElement?.classList.contains("code-block-shell")) {
      continue;
    }
    const code = pre.querySelector("code");
    const shell = document.createElement("div");
    shell.className = "code-block-shell";
    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar";
    const label = document.createElement("span");
    label.className = "code-block-label";
    label.textContent = codeBlockLanguage(code || pre);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button compact-button code-copy-button";
    button.textContent = "Copy";
    toolbar.append(label, button);
    pre.replaceWith(shell);
    shell.append(toolbar, pre);
  }
}

function setCopyButtonState(button, label) {
  button.textContent = label;
  button.classList.add("copied");
  if (button.resetTimerId) {
    window.clearTimeout(Number(button.resetTimerId));
  }
  button.resetTimerId = String(
    window.setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("copied");
      delete button.resetTimerId;
    }, 1500),
  );
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const body = options.body;
  if (!(body instanceof FormData) && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    showLogin();
    throw new Error("Authentication required.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload;
}

async function apiStream(path, options = {}, onEvent) {
  const response = await fetch(path, options);
  if (response.status === 401) {
    showLogin();
    throw new Error("Authentication required.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Streaming is not supported by this browser.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      onEvent(JSON.parse(line));
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer.trim()));
  }
}

function scheduleMessagesRender() {
  if (messageRenderFrame) {
    return;
  }
  messageRenderFrame = window.requestAnimationFrame(() => {
    messageRenderFrame = 0;
    renderMessages();
  });
}

function renderAuthMode() {
  const registerMode = state.authMode === "register";
  for (const button of els.authModeButtons) {
    button.classList.toggle("active", button.dataset.authMode === state.authMode);
  }
  els.loginConfirmPasswordRow.classList.toggle("hidden", !registerMode);
  els.loginForm.elements.password.setAttribute(
    "autocomplete",
    registerMode ? "new-password" : "current-password",
  );
  els.loginForm.elements.confirmPassword.toggleAttribute("required", registerMode);
  els.loginSubmitButton.textContent = registerMode ? "Create Account" : "Enter Station";
  els.loginPanelTitle.textContent = registerMode ? "Create Account" : "Enter";
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "login";
  els.loginError.textContent = "";
  renderAuthMode();
}

function setBooting(isBooting) {
  els.appShell.classList.toggle("booting", Boolean(isBooting));
}

function showLogin() {
  state.me = null;
  state.adminOverview = null;
  state.adminSelectedUserId = null;
  state.adminSelectedUser = null;
  state.adminSelectedUserConversations = [];
  state.adminSelectedUserJobs = [];
  state.adminSelectedUserSessions = [];
  state.adminUserSearch = "";
  els.loginScreen.classList.remove("hidden");
  els.appScreen.classList.add("hidden");
  renderAuthMode();
}

function showApp() {
  els.loginScreen.classList.add("hidden");
  els.appScreen.classList.remove("hidden");
}

function getChatProvider(providerId) {
  return state.chat?.providers?.find((provider) => provider.id === providerId) || null;
}

function selectedProviderId() {
  return state.chat?.selectedProviderId || state.chat?.defaultProviderId || "";
}

function selectedConversation() {
  return state.conversations.find((conversation) => conversation.id === state.selectedConversationId) || null;
}

function selectedModelFor(providerId) {
  if (!providerId) {
    return "";
  }

  const provider = getChatProvider(providerId);
  if (!provider) {
    return "";
  }

  const storageKey = `${CHAT_MODEL_STORAGE_KEY_PREFIX}${providerId}`;
  const stored = window.localStorage.getItem(storageKey);
  if (stored && provider.models.includes(stored)) {
    return stored;
  }

  return provider.defaultModel || provider.models[0] || "";
}

function setSelectedProvider(providerId) {
  state.chat.selectedProviderId = providerId;
  window.localStorage.setItem(CHAT_PROVIDER_STORAGE_KEY, providerId);
}

function renderChatModels() {
  const provider = getChatProvider(selectedProviderId());
  els.chatModelSelect.innerHTML = "";

  if (!provider) {
    els.chatModelSelect.disabled = true;
    return;
  }

  els.chatModelSelect.disabled = false;
  const selectedModel = selectedModelFor(provider.id);
  for (const model of provider.models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = provider.id === "auto" && model === "auto" ? "Auto" : model;
    if (model === selectedModel) {
      option.selected = true;
    }
    els.chatModelSelect.append(option);
  }
}

function renderIdentity() {
  if (!state.me) {
    return;
  }

  els.userName.textContent = state.me.displayName || state.me.username;
  const visibleModeCount = 3;
  els.modeToggle.classList.toggle("chat-only", false);
  els.modeToggle.style.gridTemplateColumns = `repeat(${visibleModeCount}, minmax(0, 1fr))`;
  els.codeModeButton.classList.remove("hidden");
  els.adminModeButton.classList.remove("hidden");

  els.chatProviderSelect.innerHTML = "";
  els.chatModelSelect.innerHTML = "";
  if (!state.chat?.providers?.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No provider configured";
    els.chatProviderSelect.append(emptyOption);
    els.chatProviderSelect.disabled = true;
    els.chatModelSelect.disabled = true;
    return;
  }

  els.chatProviderSelect.disabled = false;
  for (const provider of state.chat.providers) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.label;
    if (provider.id === selectedProviderId()) {
      option.selected = true;
    }
    els.chatProviderSelect.append(option);
  }

  renderChatModels();
}

function setMode(mode) {
  state.mode = mode;
  for (const button of els.modeButtons) {
    button.classList.toggle("active", button.dataset.mode === mode);
  }
  els.chatListPanel.classList.toggle("hidden", mode !== "chat");
  els.codeListPanel.classList.toggle("hidden", mode !== "code");
  Object.entries(els.modePanels).forEach(([key, panel]) => {
    panel.classList.toggle("hidden", key !== mode);
  });

  if (mode === "admin" && state.me) {
    refreshAdminOverview().catch(() => {});
  }
}

function attachmentMarkup(attachments, variant = "default") {
  if (!attachments?.length) {
    return "";
  }

  return `
    <div class="attachment-gallery ${variant}">
      ${attachments
        .map((attachment) => {
          const displayName = attachment.label || attachment.name;
          const label = `${displayName} · ${formatFileSize(attachment.size)}`;
          if (attachment.kind === "image") {
            return `
              <a
                class="attachment-card image"
                href="${escapeHtml(attachment.url)}"
                download="${escapeHtml(attachment.name || displayName)}"
                title="Click to download ${escapeHtml(displayName)}"
              >
                <img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(displayName)}" loading="lazy" />
                <span>${escapeHtml(label)}</span>
                <em class="attachment-download-hint">Click to download</em>
              </a>
            `;
          }
          return `
            <a
              class="attachment-card"
              href="${escapeHtml(attachment.url)}"
              download="${escapeHtml(attachment.name || displayName)}"
              title="Click to download ${escapeHtml(displayName)}"
            >
              <strong>${escapeHtml(displayName)}</strong>
              <span>${escapeHtml(label)}</span>
              <em class="attachment-download-hint">Click to download</em>
            </a>
          `;
        })
        .join("")}
    </div>
  `;
}

function visibleMessageAttachments(message) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  if (message?.role !== "assistant") {
    return attachments;
  }
  return attachments.filter((attachment) => attachment.label !== "reply.md" && attachment.name !== "reply.md");
}

function renderPendingAttachmentList(kind) {
  const attachments = kind === "chat" ? state.pendingChatAttachments : state.pendingCodeAttachments;
  const container = kind === "chat" ? els.chatAttachmentList : els.codeAttachmentList;
  container.classList.toggle("hidden", attachments.length === 0);
  if (attachments.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = attachments
    .map(
      (file, index) => `
        <div class="attachment-chip">
          <span>${escapeHtml(file.name)} · ${escapeHtml(formatFileSize(file.size))}</span>
          <button type="button" class="attachment-remove" data-kind="${kind}" data-index="${index}">Remove</button>
        </div>
      `,
    )
    .join("");
}

function appendPendingAttachments(kind, fileList) {
  const nextFiles = Array.from(fileList || []);
  if (nextFiles.length === 0) {
    return;
  }
  const target = kind === "chat" ? state.pendingChatAttachments : state.pendingCodeAttachments;
  target.push(...nextFiles);
  renderPendingAttachmentList(kind);
}

function clearPendingAttachments(kind) {
  if (kind === "chat") {
    state.pendingChatAttachments = [];
    els.chatAttachmentsInput.value = "";
  } else {
    state.pendingCodeAttachments = [];
    els.codeAttachmentsInput.value = "";
  }
  renderPendingAttachmentList(kind);
}

function removePendingAttachment(kind, index) {
  const target = kind === "chat" ? state.pendingChatAttachments : state.pendingCodeAttachments;
  target.splice(index, 1);
  renderPendingAttachmentList(kind);
}

function renderConversations() {
  els.conversationList.innerHTML = "";
  if (state.conversations.length === 0) {
    els.conversationList.innerHTML = `<div class="empty-state">No chats.</div>`;
    return;
  }

  for (const conversation of state.conversations) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-item";
    item.classList.toggle("active", conversation.id === state.selectedConversationId);
    item.innerHTML = `
      <strong>${escapeHtml(conversation.title)}</strong>
      <div class="list-meta">
        <span>${new Date(conversation.updatedAt).toLocaleString()}</span>
        ${conversation.isPinned ? '<span class="pin-pill">Pinned</span>' : ""}
      </div>
    `;
    item.addEventListener("click", () => selectConversation(conversation.id));
    els.conversationList.append(item);
  }
}

function renderConversationActions() {
  const conversation = selectedConversation();
  const hasConversation = Boolean(conversation);
  els.chatConversationActions.classList.toggle("hidden", !hasConversation);
  if (!hasConversation) {
    els.chatPinButton.textContent = "Pin";
    return;
  }

  els.chatPinButton.textContent = conversation.isPinned ? "Unpin" : "Pin";
}

function renderMessageBody(message) {
  const content = message.content || (message.isStreaming ? "Thinking…" : "");
  if (message.role === "assistant" && !message.isError) {
    const html = renderMarkdown(content) || `<p>${escapeHtml(content || "Thinking…")}</p>`;
    return `<div class="message-body message-markdown">${html}</div>`;
  }
  return `<div class="message-body plain">${escapeHtml(content)}</div>`;
}

function renderMessages() {
  els.chatMessages.innerHTML = "";
  if (state.messages.length === 0) {
    els.chatMessages.className = "message-stream empty-state";
    els.chatMessages.textContent = "Start a chat.";
    renderConversationActions();
    return;
  }

  els.chatMessages.className = "message-stream";
  for (const message of state.messages) {
    const node = document.createElement("article");
    node.className = `message ${message.role}`;
    if (message.isStreaming) {
      node.classList.add("streaming");
    }
    if (message.isError) {
      node.classList.add("error");
    }
    const content = message.content || (message.isStreaming ? "Thinking…" : "");
    const meta = [
      message.providerLabel || "",
      message.isStreaming ? "Streaming" : "",
      message.isError ? "Failed" : "",
    ].filter(Boolean).join(" · ");
    const visibleAttachments = visibleMessageAttachments(message);
    node.innerHTML = `
      ${renderMessageBody({ ...message, content })}
      ${meta ? `<div class="message-meta">${escapeHtml(meta)}</div>` : ""}
      ${attachmentMarkup(visibleAttachments, "message")}
    `;
    enhanceMarkdownBlocks(node);
    els.chatMessages.append(node);
  }
  renderConversationActions();
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function setChatRequestPending(isPending) {
  state.chatRequestPending = isPending;
  els.chatInput.disabled = isPending;
  els.chatAttachmentsInput.disabled = isPending;
  els.chatProviderSelect.disabled = isPending;
  els.chatModelSelect.disabled = isPending;
  els.chatSubmitButton.disabled = isPending;
  els.newChatButton.disabled = isPending;
  els.chatSubmitButton.textContent = isPending ? "Streaming…" : "Send";
}

function jobTitle(job) {
  const trimmed = String(job.prompt || "").trim();
  if (trimmed) {
    return trimmed;
  }
  if (job.attachments?.length) {
    return `Attachments: ${job.attachments[0].name}${job.attachments.length > 1 ? "…" : ""}`;
  }
  return "Untitled job";
}

function renderJobs() {
  els.jobList.innerHTML = "";
  if (state.jobs.length === 0) {
    els.jobList.innerHTML = `<div class="empty-state">No jobs.</div>`;
    return;
  }

  for (const job of state.jobs) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-item";
    item.classList.toggle("active", job.id === state.selectedJobId);
    const title = jobTitle(job);
    item.innerHTML = `
      <strong>${escapeHtml(title.slice(0, 70))}${title.length > 70 ? "…" : ""}</strong>
      <div class="list-meta">
        ${job.isPinned ? '<span class="pin-pill">Pinned</span>' : ""}
        <span class="status-pill ${job.status}">${job.status}</span>
        <span>${new Date(job.createdAt).toLocaleString()}</span>
      </div>
    `;
    item.addEventListener("click", () => selectJob(job.id));
    els.jobList.append(item);
  }
}

function renderJobActions() {
  const job = state.selectedJob;
  if (!job) {
    els.jobActions.classList.add("hidden");
    els.jobPinButton.textContent = "Pin";
    els.jobDeleteButton.disabled = false;
    els.jobDeleteButton.title = "";
    return;
  }

  els.jobActions.classList.remove("hidden");
  els.jobPinButton.textContent = job.isPinned ? "Unpin" : "Pin";
  const isRunning = job.status === "running";
  els.jobDeleteButton.disabled = isRunning;
  els.jobDeleteButton.title = isRunning ? "Running jobs cannot be deleted." : "";
}

function renderJobDetail() {
  if (!state.selectedJob) {
    els.jobTitle.textContent = "No job selected";
    els.jobDetail.className = "job-detail empty-state";
    els.jobDetail.textContent = "Select a job.";
    renderJobActions();
    return;
  }

  const job = state.selectedJob;
  els.jobTitle.textContent = `${jobTitle(job).slice(0, 72)}${jobTitle(job).length > 72 ? "…" : ""}`;
  els.jobDetail.className = "job-detail";
  renderJobActions();
  const sections = [];

  sections.push(`
    <div class="job-section">
      <h4>Status</h4>
      <p class="job-status-line">
        <span class="status-pill ${job.status}">${job.status}</span>
      </p>
      <pre>${escapeHtml(job.errorText || job.finalMessage || "No output yet.")}</pre>
    </div>
  `);

  if (job.attachments?.length) {
    sections.push(`
      <div class="job-section">
        <h4>Input Files</h4>
        ${attachmentMarkup(job.attachments)}
      </div>
    `);
  }

  if (job.outputFiles?.length) {
    sections.push(`
      <div class="job-section">
        <h4>Output Files</h4>
        ${attachmentMarkup(job.outputFiles)}
      </div>
    `);
  }

  if (job.status === "pending" || job.status === "running" || state.selectedJobLogText) {
    sections.push(`
      <div class="job-section">
        <h4>${job.status === "pending" ? "Queue" : "Live Output"}</h4>
        ${job.status === "pending" ? '<p class="job-meta">Waiting for a worker slot.</p>' : ""}
        <pre>${escapeHtml(state.selectedJobLogText || (job.status === "running" ? "Waiting for live output…" : "Queued…"))}</pre>
      </div>
    `);
  }

  if (job.gitStatusText) {
    sections.push(`
      <div class="job-section">
        <h4>Changed Files</h4>
        <pre>${escapeHtml(job.gitStatusText)}</pre>
      </div>
    `);
  }

  if (job.diffText || job.diffStat) {
    sections.push(`
      <div class="job-section">
        <h4>Diff</h4>
        ${job.diffStat ? `<p class="job-meta">${escapeHtml(job.diffStat)}</p>` : ""}
        ${job.diffText ? `<pre>${escapeHtml(job.diffText)}</pre>` : ""}
      </div>
    `);
  }

  els.jobDetail.innerHTML = sections.join("");
}

function renderTableEmptyBody(element, colSpan, message) {
  element.innerHTML = `<tr><td colspan="${colSpan}" class="table-empty">${escapeHtml(message)}</td></tr>`;
}

function currentRoutingConfig() {
  return (
    state.adminOverview?.routingConfig || {
      dispatch: {
        retryCooldownMs: 0,
        quotaCooldownMs: 0,
        circuitBreakerThreshold: 3,
        circuitBreakerMs: 0,
        dispatchHistoryLimit: 200,
      },
      routeOverrides: [],
      keyRules: [],
    }
  );
}

function cloneRoutingConfig() {
  return JSON.parse(JSON.stringify(currentRoutingConfig()));
}

function routingPriorityForIndex(index) {
  return Math.max(1, ROUTING_PRIORITY_BASE - index * ROUTING_PRIORITY_STEP);
}

function rankLabel(index) {
  return `#${index + 1}`;
}

function autoRouteGroupsForDisplay() {
  const groups = {};
  for (const [routeType, routes] of Object.entries(state.adminOverview?.autoRouting?.routes || {})) {
    groups[routeType] = [...(routes || [])].sort((left, right) => {
      if ((right.priority || 0) !== (left.priority || 0)) {
        return (right.priority || 0) - (left.priority || 0);
      }
      return `${left.providerLabel || left.providerId}:${left.model}`.localeCompare(
        `${right.providerLabel || right.providerId}:${right.model}`,
      );
    });
  }
  return groups;
}

function buildRouteOverridesFromGroups(groups) {
  return Object.entries(groups).flatMap(([routeType, routes]) =>
    (routes || []).map((route, index) => ({
      routeType,
      providerId: route.providerId,
      model: route.model,
      enabled: route.enabled !== false,
      priority: routingPriorityForIndex(index),
      weight: 1,
    })),
  );
}

async function saveRoutingConfig(routingConfig) {
  await api("/api/admin/routing-config", {
    method: "PUT",
    body: JSON.stringify(routingConfig),
  });
  await refreshAdminOverview();
}

function filteredAdminUsers() {
  const users = state.adminOverview?.users || [];
  const search = String(state.adminUserSearch || "").trim().toLowerCase();
  if (!search) {
    return users;
  }
  return users.filter((user) => {
    const haystack = `${user.displayName || ""} ${user.username || ""}`.toLowerCase();
    return haystack.includes(search);
  });
}

function renderAdminUserRecords() {
  if (!state.me?.isAdmin) {
    return;
  }

  if (!state.adminSelectedUser) {
    els.adminUserRecordsTitle.textContent = "User Conversations";
    els.adminUserConversations.className = "admin-user-records empty-state";
    els.adminUserConversations.textContent = "Select a user.";
    els.adminUserJobsTitle.textContent = "User Jobs";
    els.adminUserJobs.className = "admin-user-records empty-state";
    els.adminUserJobs.textContent = "Select a user.";
    els.adminUserSessionsTitle.textContent = "User Sessions";
    els.adminUserSessions.className = "admin-user-records empty-state";
    els.adminUserSessions.textContent = "Select a user.";
    return;
  }

  els.adminUserRecordsTitle.textContent = `User Conversations · ${state.adminSelectedUser.displayName} (${state.adminSelectedUser.username})`;
  els.adminUserJobsTitle.textContent = `User Jobs · ${state.adminSelectedUser.displayName}`;
  els.adminUserSessionsTitle.textContent = `User Sessions · ${state.adminSelectedUser.displayName}`;

  if (!state.adminSelectedUserConversations.length) {
    els.adminUserConversations.className = "admin-user-records empty-state";
    els.adminUserConversations.textContent = "No chat history.";
  } else {
    els.adminUserConversations.className = "admin-user-records";
    els.adminUserConversations.innerHTML = state.adminSelectedUserConversations
      .map(
        (conversation) => `
          <article class="admin-record-card">
            <div class="admin-record-header">
              <div>
                <h5>${escapeHtml(conversation.title)}</h5>
                <p>${escapeHtml(formatDateTime(conversation.updatedAt))}</p>
              </div>
              <span>${escapeHtml(String(conversation.messages?.length || 0))} msgs</span>
            </div>
            <div class="admin-record-stream">
              ${
                conversation.messages?.length
                  ? conversation.messages
                      .map((message) => {
                        const attachmentText = message.attachments?.length
                          ? `<div class="table-subline">Attachments: ${escapeHtml(message.attachments.map((attachment) => attachment.label || attachment.name).join(", "))}</div>`
                          : "";
                        return `
                          <div class="admin-record-message ${escapeHtml(message.role)}">
                            <div class="admin-record-meta">
                              <strong>${escapeHtml(message.role)}</strong>
                              <span>${escapeHtml(formatDateTime(message.createdAt))}</span>
                              ${message.model ? `<span>${escapeHtml(message.model)}</span>` : ""}
                            </div>
                            <pre>${escapeHtml(message.content || "")}</pre>
                            ${attachmentText}
                          </div>
                        `;
                      })
                      .join("")
                  : '<div class="table-empty">No messages recorded.</div>'
              }
            </div>
          </article>
        `,
      )
      .join("");
  }

  if (!state.adminSelectedUserJobs.length) {
    els.adminUserJobs.className = "admin-user-records empty-state";
    els.adminUserJobs.textContent = "No jobs.";
  } else {
    els.adminUserJobs.className = "admin-user-records";
    els.adminUserJobs.innerHTML = state.adminSelectedUserJobs
      .map(
        (job) => `
        <article class="admin-record-card">
          <div class="admin-record-header">
            <div>
              <h5>${escapeHtml(jobTitle(job))}</h5>
              <p>${escapeHtml(formatDateTime(job.createdAt))}</p>
            </div>
            <span class="status-pill ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
          </div>
          <div class="admin-record-stream">
            <div class="admin-record-message assistant">
              <div class="admin-record-meta">
                <span>${escapeHtml(job.branchName || "no branch")}</span>
                <span>${escapeHtml(job.finishedAt ? formatDateTime(job.finishedAt) : "in progress")}</span>
                ${job.diffStat ? `<span>${escapeHtml(job.diffStat)}</span>` : ""}
              </div>
              <pre>${escapeHtml(job.finalMessage || job.errorText || job.commandPreview || "No output.")}</pre>
            </div>
          </div>
        </article>
      `,
      )
      .join("");
  }

  if (!state.adminSelectedUserSessions.length) {
    els.adminUserSessions.className = "admin-user-records empty-state";
    els.adminUserSessions.textContent = "No active sessions.";
    return;
  }

  els.adminUserSessions.className = "admin-user-records";
  els.adminUserSessions.innerHTML = state.adminSelectedUserSessions
    .map(
      (session) => `
        <article class="admin-record-card">
          <div class="admin-record-header">
            <div>
              <h5>${escapeHtml(session.ipAddress || "Unknown IP")}</h5>
              <p>${escapeHtml(formatDateTime(session.lastSeenAt || session.createdAt))}</p>
            </div>
            ${session.isCurrent ? '<span class="pin-pill">Current</span>' : ""}
          </div>
          <div class="admin-record-stream">
            <div class="admin-record-message assistant">
              <div class="admin-record-meta">
                <span>${escapeHtml(formatDateTime(session.createdAt))}</span>
                <span>${escapeHtml(formatDateTime(session.expiresAt))}</span>
              </div>
              <pre>${escapeHtml(session.userAgent || "Unknown agent")}</pre>
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderAdminOverview() {
  const overview = state.adminOverview;
  if (!state.me) {
    return;
  }

  const isAdmin = Boolean(state.me.isAdmin);
  els.adminUsersSection.classList.toggle("hidden", !isAdmin);
  els.adminDispatchSettingsSection.classList.toggle("hidden", !isAdmin);
  els.adminUserRecordsSection.classList.toggle("hidden", !isAdmin);
  els.adminUserJobsSection.classList.toggle("hidden", !isAdmin);
  els.adminUserSessionsSection.classList.toggle("hidden", !isAdmin);
  els.adminAuthSection.classList.toggle("hidden", !isAdmin);

  if (!overview) {
    els.adminSummary.innerHTML = "";
    renderTableEmptyBody(els.adminProviderUsageTable, 7, "No API usage data loaded.");
    renderTableEmptyBody(els.adminApiKeyTable, 9, "No admin data loaded.");
    renderTableEmptyBody(els.adminAutoRoutingTable, 6, "No auto routing data loaded.");
    renderTableEmptyBody(els.adminDispatchTable, 8, "No dispatch events yet.");
    if (isAdmin) {
      renderTableEmptyBody(els.adminUsersTable, 5, "No users loaded.");
      renderTableEmptyBody(els.adminAuthTable, 5, "No authentication audit events yet.");
      renderAdminUserRecords();
    }
    return;
  }

  const summary = overview.summary || {};
  const usage = overview.apiUsage || {};
  els.adminSummary.innerHTML = `
    <article class="metric-card">
      <span>Configured Providers</span>
      <strong>${escapeHtml(String(summary.configuredProviders || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>Configured API Keys</span>
      <strong>${escapeHtml(String(summary.configuredApiKeys || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>API Successes</span>
      <strong>${escapeHtml(String(usage.totalSuccessCount || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>API Failures</span>
      <strong>${escapeHtml(String(usage.totalFailureCount || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>Recent Dispatches</span>
      <strong>${escapeHtml(String(usage.recentDispatches || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>Active Users</span>
      <strong>${escapeHtml(String(usage.activeUsers || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>Cooldown Keys</span>
      <strong>${escapeHtml(String(usage.cooldownKeys || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>Users</span>
      <strong>${escapeHtml(String(summary.users || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>Code Queue</span>
      <strong>${escapeHtml(`${summary.queue?.running || 0}/${summary.queue?.concurrency || 0}`)}</strong>
    </article>
  `;

  if (isAdmin) {
    const routingConfig = currentRoutingConfig();
    els.adminRetryCooldownInput.value = String(routingConfig.dispatch?.retryCooldownMs ?? 0);
    els.adminQuotaCooldownInput.value = String(routingConfig.dispatch?.quotaCooldownMs ?? 0);
    els.adminBreakerThresholdInput.value = String(routingConfig.dispatch?.circuitBreakerThreshold ?? 3);
    els.adminBreakerCooldownInput.value = String(routingConfig.dispatch?.circuitBreakerMs ?? 0);
    els.adminHistoryLimitInput.value = String(routingConfig.dispatch?.dispatchHistoryLimit ?? 200);
    els.adminUserSearchInput.value = state.adminUserSearch;
  }

  if (!usage.providerBreakdown?.length) {
    renderTableEmptyBody(els.adminProviderUsageTable, 7, "No API usage recorded yet.");
  } else {
    els.adminProviderUsageTable.innerHTML = usage.providerBreakdown
      .map(
        (provider) => `
          <tr>
            <td>${escapeCell(provider.providerLabel)}</td>
            <td>${escapeCell(provider.keyCount)}</td>
            <td>${escapeCell(provider.successCount)}</td>
            <td>${escapeCell(provider.failureCount)}</td>
            <td>${escapeCell(provider.cooldownKeys)}</td>
            <td>${escapeCell(provider.inFlight)}</td>
            <td>${escapeCell(provider.lastUsedAt ? formatDateTime(provider.lastUsedAt) : "—")}</td>
          </tr>
        `,
      )
      .join("");
  }

  if (!overview.apiKeys?.length) {
    renderTableEmptyBody(els.adminApiKeyTable, 9, "No API keys configured.");
  } else {
    els.adminApiKeyTable.innerHTML = overview.apiKeys
      .map(
        (apiKey) => `
          <tr>
            <td>${escapeCell(apiKey.providerLabel)}</td>
            <td>
              <strong>${escapeCell(apiKey.keyName)}</strong>
              <div class="table-subline">${escapeCell(apiKey.maskedKey)}</div>
            </td>
            <td><span class="status-pill ${escapeHtml(apiKey.status)}">${escapeCell(apiKey.status)}</span></td>
            <td>
              <strong>${escapeCell(apiKey.priority)}</strong>
              ${apiKey.basePriority !== apiKey.priority ? `<div class="table-subline">base ${escapeCell(apiKey.basePriority)}</div>` : ""}
            </td>
            <td>
              <strong>${escapeCell(apiKey.weight)}</strong>
              ${apiKey.baseWeight !== apiKey.weight ? `<div class="table-subline">base ${escapeCell(apiKey.baseWeight)}</div>` : ""}
            </td>
            <td>${escapeCell(apiKey.successCount)}</td>
            <td>${escapeCell(apiKey.failureCount)}</td>
            <td>${escapeCell(apiKey.cooldownUntil ? formatDateTime(apiKey.cooldownUntil) : "Active")}</td>
            <td>${escapeCell(apiKey.lastError, "—")}</td>
          </tr>
        `,
      )
      .join("");
  }

  const autoRouteGroups = autoRouteGroupsForDisplay();
  const autoRouteTypes = Object.keys(autoRouteGroups);
  if (!autoRouteTypes.length) {
    renderTableEmptyBody(els.adminAutoRoutingTable, 6, "Auto mode is not configured.");
  } else {
    els.adminAutoRoutingTable.innerHTML = autoRouteTypes
      .flatMap((routeType) => {
        const routes = autoRouteGroups[routeType] || [];
        return routes.map((route, index) => `
          <tr data-route-type="${escapeHtml(routeType)}" data-route-id="${escapeHtml(route.routeId)}">
            <td>${escapeCell(routeType)}</td>
            <td>
              <strong>${escapeCell(route.providerLabel)}</strong>
              <div class="table-subline">${escapeCell(route.model)}</div>
            </td>
            <td>
              <label class="table-toggle">
                <input class="table-checkbox" data-field="enabled" type="checkbox" ${route.enabled ? "checked" : ""} />
                <span>${escapeCell(route.enabled ? "on" : "off")}</span>
              </label>
            </td>
            <td><span class="rank-pill">${escapeHtml(rankLabel(index))}</span></td>
            <td>
              <div class="admin-table-actions">
                <button type="button" class="ghost-button compact-button" data-action="route-up" ${index === 0 ? "disabled" : ""}>Up</button>
                <button type="button" class="ghost-button compact-button" data-action="route-down" ${index === routes.length - 1 ? "disabled" : ""}>Down</button>
              </div>
            </td>
            <td>${escapeCell(route.cooldownUntil ? formatDateTime(route.cooldownUntil) : "Active")}</td>
          </tr>
        `);
      })
      .join("");
  }

  if (!overview.dispatchEvents?.length) {
    renderTableEmptyBody(els.adminDispatchTable, 8, "No dispatch events recorded yet.");
  } else {
    els.adminDispatchTable.innerHTML = overview.dispatchEvents
      .map(
        (event) => `
          <tr>
            <td>${escapeCell(formatDateTime(event.createdAt))}</td>
            <td>${escapeCell(`${event.routeType}/${event.requestKind}`)}</td>
            <td>
              <strong>${escapeCell(event.providerLabel || event.providerId)}</strong>
              <div class="table-subline">${escapeCell(event.apiKeyName || "route")}</div>
            </td>
            <td>${escapeCell(event.model)}</td>
            <td>${escapeCell(event.username)}</td>
            <td><span class="status-pill ${escapeHtml(event.status)}">${escapeCell(event.status)}</span></td>
            <td>${escapeCell(formatDuration(event.durationMs))}</td>
            <td>${escapeCell(event.error)}</td>
          </tr>
        `,
      )
      .join("");
  }

  if (isAdmin) {
    const users = filteredAdminUsers();
    if (!users.length) {
      renderTableEmptyBody(els.adminUsersTable, 5, state.adminUserSearch ? "No matching users." : "No users found.");
    } else {
      els.adminUsersTable.innerHTML = users
        .map((user) => {
          const protectedUser = user.username === "root" || user.id === state.me.id;
          const locked = Boolean(user.lockedUntil);
          return `
            <tr class="${state.adminSelectedUserId === user.id ? "is-selected" : ""}">
              <td>
                <strong>${escapeCell(user.displayName)}</strong>
                <div class="table-subline">${escapeCell(user.username)}</div>
              </td>
              <td>
                <strong>${escapeCell(user.isAdmin ? "admin" : "member")}</strong>
                ${locked ? '<div class="table-subline">locked</div>' : ""}
              </td>
              <td>${escapeCell(`${user.conversationCount || 0} chats · ${user.jobCount || 0} jobs · ${user.sessionCount || 0} sessions`)}</td>
              <td>${escapeCell(user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never")}</td>
              <td>
                <div class="admin-user-actions">
                  <button type="button" class="ghost-button compact-button" data-action="view" data-user-id="${escapeHtml(user.id)}">Open</button>
                  <button
                    type="button"
                    class="ghost-button compact-button"
                    data-action="unlock"
                    data-user-id="${escapeHtml(user.id)}"
                    ${locked ? "" : "disabled"}
                  >Unlock</button>
                  <button
                    type="button"
                    class="ghost-button compact-button"
                    data-action="signout"
                    data-user-id="${escapeHtml(user.id)}"
                    ${protectedUser ? "disabled" : ""}
                  >Sign Out</button>
                  <button type="button" class="ghost-button compact-button" data-action="password" data-user-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}">Password</button>
                  <button
                    type="button"
                    class="ghost-button compact-button"
                    data-action="role"
                    data-user-id="${escapeHtml(user.id)}"
                    data-is-admin="${user.isAdmin ? "1" : "0"}"
                    ${protectedUser ? "disabled" : ""}
                  >${user.isAdmin ? "Revoke Admin" : "Make Admin"}</button>
                  <button
                    type="button"
                    class="ghost-button compact-button danger-button"
                    data-action="delete"
                    data-user-id="${escapeHtml(user.id)}"
                    data-username="${escapeHtml(user.username)}"
                    ${protectedUser ? "disabled" : ""}
                  >Delete</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    if (!overview.authEvents?.length) {
      renderTableEmptyBody(els.adminAuthTable, 5, "No authentication audit events recorded yet.");
    } else {
      els.adminAuthTable.innerHTML = overview.authEvents
        .map(
          (event) => `
            <tr>
              <td>${escapeCell(formatDateTime(event.createdAt))}</td>
              <td>${escapeCell(event.username)}</td>
              <td>${escapeCell(event.eventType)}</td>
              <td>${escapeCell(event.ipAddress)}</td>
              <td>${escapeCell(event.reason)}</td>
            </tr>
          `,
        )
        .join("");
    }

    renderAdminUserRecords();
  }
}

async function refreshAdminOverview() {
  if (!state.me) {
    state.adminOverview = null;
    renderAdminOverview();
    return;
  }

  const payload = await api("/api/admin/overview");
  state.adminOverview = payload;
  renderAdminOverview();
}

async function bootstrap() {
  setBooting(true);
  try {
    const payload = await api("/api/me");
    state.me = payload.user;
    state.chat = payload.chat;
    state.capabilities = payload.capabilities;
    const storedProviderId = window.localStorage.getItem(CHAT_PROVIDER_STORAGE_KEY);
    const validStoredProvider = payload.chat.providers.find((provider) => provider.id === storedProviderId);
    state.chat.selectedProviderId = validStoredProvider?.id || payload.chat.defaultProviderId || "";
    renderIdentity();
    showApp();
    setMode(state.mode);
    renderPendingAttachmentList("chat");
    renderPendingAttachmentList("code");
    await refreshConversations();
    await refreshJobs();
    if (state.mode === "admin") {
      await refreshAdminOverview();
    } else {
      state.adminOverview = null;
      renderAdminOverview();
    }
  } catch {
    showLogin();
  } finally {
    setBooting(false);
  }
}

async function refreshConversations() {
  const payload = await api("/api/chat/conversations");
  state.conversations = payload.conversations;
  if (!state.selectedConversationId && state.conversations[0]) {
    state.selectedConversationId = state.conversations[0].id;
  } else if (state.selectedConversationId && !state.conversations.some((conversation) => conversation.id === state.selectedConversationId)) {
    state.selectedConversationId = state.conversations[0]?.id || null;
  }
  renderConversations();
  if (state.selectedConversationId) {
    await loadMessages(state.selectedConversationId);
  } else {
    state.messages = [];
    els.chatTitle.textContent = "Select or create a conversation";
    renderMessages();
  }
}

async function selectConversation(conversationId) {
  if (state.chatRequestPending) {
    return;
  }
  state.selectedConversationId = conversationId;
  renderConversations();
  await loadMessages(conversationId);
}

async function loadMessages(conversationId) {
  const payload = await api(`/api/chat/conversations/${conversationId}/messages`);
  state.messages = payload.messages;
  els.chatTitle.textContent = payload.conversation.title;
  renderMessages();
}

async function createConversation() {
  if (state.chatRequestPending) {
    return;
  }
  const payload = await api("/api/chat/conversations", {
    method: "POST",
    body: JSON.stringify({ title: "New chat" }),
  });
  state.selectedConversationId = payload.conversation.id;
  await refreshConversations();
}

async function setConversationPinned(conversationId, pinned) {
  await api(`/api/chat/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({ pinned }),
  });
  await refreshConversations();
}

async function deleteConversation(conversationId) {
  await api(`/api/chat/conversations/${conversationId}`, {
    method: "DELETE",
  });
  if (state.selectedConversationId === conversationId) {
    state.selectedConversationId = null;
    state.messages = [];
  }
  await refreshConversations();
}

function buildAttachmentFormData(fields, attachments) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value != null && value !== "") {
      formData.append(key, value);
    }
  }
  for (const file of attachments) {
    formData.append("attachments", file);
  }
  return formData;
}

async function sendChatMessage(content, attachments) {
  if (!state.selectedConversationId) {
    await createConversation();
  }

  const providerId = selectedProviderId();
  const model = els.chatModelSelect.value;
  const conversationId = state.selectedConversationId;
  const optimisticUserMessage = {
    id: `tmp_user_${Date.now()}`,
    role: "user",
    content: content || `Sent ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}.`,
    attachments: [],
  };
  const placeholderMessage = {
    id: `tmp_assistant_${Date.now()}`,
    role: "assistant",
    content: "",
    attachments: [],
    isStreaming: true,
    isError: false,
    providerLabel: "",
  };

  state.messages = [...state.messages, optimisticUserMessage, placeholderMessage];
  setChatRequestPending(true);
  renderMessages();

  let streamError = "";
  try {
    await apiStream(
      `/api/chat/conversations/${conversationId}/messages/stream`,
      {
        method: "POST",
        body: buildAttachmentFormData(
          {
            content,
            providerId,
            model,
          },
          attachments,
        ),
      },
      (event) => {
        if (event.type === "meta") {
          placeholderMessage.providerLabel = event.providerLabel || "";
          placeholderMessage.model = event.model || "";
          scheduleMessagesRender();
          return;
        }

        if (event.type === "delta") {
          placeholderMessage.content = event.text || `${placeholderMessage.content || ""}${event.delta || ""}`;
          scheduleMessagesRender();
          return;
        }

        if (event.type === "error") {
          streamError = event.error || "Chat request failed.";
          placeholderMessage.isStreaming = false;
          placeholderMessage.isError = true;
          placeholderMessage.content = placeholderMessage.content || streamError;
          scheduleMessagesRender();
          return;
        }

        if (event.type === "done") {
          placeholderMessage.isStreaming = false;
        }
      },
    );
  } catch (error) {
    placeholderMessage.isStreaming = false;
    placeholderMessage.isError = true;
    placeholderMessage.content = placeholderMessage.content || error.message;
    renderMessages();
    setChatRequestPending(false);
    throw error;
  }
  if (providerId && model) {
    window.localStorage.setItem(`${CHAT_MODEL_STORAGE_KEY_PREFIX}${providerId}`, model);
  }
  setChatRequestPending(false);
  if (streamError) {
    throw new Error(streamError);
  }
  await refreshConversations();
  await loadMessages(conversationId);
}

async function refreshJobs() {
  if (jobsRefreshInFlight) {
    return;
  }
  jobsRefreshInFlight = true;
  try {
  if (!state.me?.canUseCode) {
    state.jobs = [];
    state.selectedJobId = null;
    state.selectedJob = null;
    state.selectedJobLogText = "";
    renderJobs();
    renderJobDetail();
    return;
  }
  const payload = await api("/api/code/jobs");
  state.jobs = payload.jobs;
  els.queuePill.textContent = `${payload.queue.running}/${payload.queue.concurrency} running`;
  if (!state.selectedJobId && state.jobs[0]) {
    state.selectedJobId = state.jobs[0].id;
  } else if (state.selectedJobId && !state.jobs.some((job) => job.id === state.selectedJobId)) {
    state.selectedJobId = state.jobs[0]?.id || null;
  }
  renderJobs();
  if (state.selectedJobId) {
    await selectJob(state.selectedJobId);
  } else {
    state.selectedJob = null;
    state.selectedJobLogText = "";
    renderJobDetail();
  }
  } finally {
    jobsRefreshInFlight = false;
  }
}

async function selectJob(jobId) {
  state.selectedJobId = jobId;
  renderJobs();
  const payload = await api(`/api/code/jobs/${jobId}`);
  state.selectedJob = payload.job;
  if (payload.job.status === "pending" || payload.job.status === "running") {
    await loadJobLog(jobId);
  } else {
    state.selectedJobLogText = "";
  }
  renderJobDetail();
}

async function loadJobLog(jobId) {
  const payload = await api(`/api/code/jobs/${jobId}/log`);
  if (state.selectedJobId !== jobId) {
    return;
  }
  state.selectedJobLogText = payload.log || "";
  renderJobDetail();
}

async function queueCodeJob(prompt, attachments) {
  const payload = await api("/api/code/jobs", {
    method: "POST",
    body: buildAttachmentFormData({ prompt }, attachments),
  });
  state.selectedJobId = payload.job.id;
  await refreshJobs();
}

async function setJobPinned(jobId, pinned) {
  await api(`/api/code/jobs/${jobId}`, {
    method: "PATCH",
    body: JSON.stringify({ pinned }),
  });
  await refreshJobs();
}

async function deleteJob(jobId) {
  await api(`/api/code/jobs/${jobId}`, {
    method: "DELETE",
  });
  if (state.selectedJobId === jobId) {
    state.selectedJobId = null;
    state.selectedJob = null;
  }
  await refreshJobs();
}

async function updateAdminUser(userId, payload) {
  await api(`/api/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  await refreshAdminOverview();
  if (state.adminSelectedUserId === userId) {
    await loadAdminUserConversations(userId);
  }
}

async function unlockAdminUser(userId) {
  await api(`/api/admin/users/${userId}/unlock`, {
    method: "POST",
  });
  await refreshAdminOverview();
  if (state.adminSelectedUserId === userId) {
    await loadAdminUserConversations(userId);
  }
}

async function revokeAdminUserSessions(userId) {
  await api(`/api/admin/users/${userId}/revoke-sessions`, {
    method: "POST",
  });
  await refreshAdminOverview();
  if (state.adminSelectedUserId === userId) {
    await loadAdminUserConversations(userId);
  }
}

async function deleteAdminUser(userId) {
  await api(`/api/admin/users/${userId}`, {
    method: "DELETE",
  });
  if (state.adminSelectedUserId === userId) {
    state.adminSelectedUserId = null;
    state.adminSelectedUser = null;
    state.adminSelectedUserConversations = [];
    state.adminSelectedUserJobs = [];
    state.adminSelectedUserSessions = [];
  }
  await refreshAdminOverview();
}

async function loadAdminUserConversations(userId) {
  const payload = await api(`/api/admin/users/${userId}/conversations`);
  state.adminSelectedUserId = userId;
  state.adminSelectedUser = payload.user;
  state.adminSelectedUserConversations = payload.conversations || [];
  state.adminSelectedUserJobs = payload.jobs || [];
  state.adminSelectedUserSessions = payload.sessions || [];
  renderAdminUserRecords();
}

async function resetRoutingConfig() {
  await api("/api/admin/routing-config", {
    method: "DELETE",
  });
  await refreshAdminOverview();
}

async function saveDispatchSettings() {
  const routingConfig = cloneRoutingConfig();
  routingConfig.dispatch = {
    retryCooldownMs: Number(els.adminRetryCooldownInput.value || 0),
    quotaCooldownMs: Number(els.adminQuotaCooldownInput.value || 0),
    circuitBreakerThreshold: Number(els.adminBreakerThresholdInput.value || 1),
    circuitBreakerMs: Number(els.adminBreakerCooldownInput.value || 0),
    dispatchHistoryLimit: Number(els.adminHistoryLimitInput.value || 200),
  };
  await saveRoutingConfig(routingConfig);
}

async function saveAutoRoutingOverrides(groups = autoRouteGroupsForDisplay()) {
  const routingConfig = cloneRoutingConfig();
  routingConfig.routeOverrides = buildRouteOverridesFromGroups(groups);
  await saveRoutingConfig(routingConfig);
}

async function setAutoRouteEnabled(routeType, routeId, enabled) {
  const groups = autoRouteGroupsForDisplay();
  const routes = groups[routeType] || [];
  const route = routes.find((entry) => entry.routeId === routeId);
  if (!route) {
    return;
  }
  route.enabled = Boolean(enabled);
  await saveAutoRoutingOverrides(groups);
}

async function moveAutoRoute(routeType, routeId, direction) {
  const groups = autoRouteGroupsForDisplay();
  const routes = groups[routeType] || [];
  const index = routes.findIndex((route) => route.routeId === routeId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= routes.length) {
    return;
  }
  [routes[index], routes[nextIndex]] = [routes[nextIndex], routes[index]];
  await saveAutoRoutingOverrides(groups);
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.textContent = "";
  const formData = new FormData(els.loginForm);
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  try {
    if (state.authMode === "register" && password !== confirmPassword) {
      throw new Error("Passwords do not match.");
    }

    await api(state.authMode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password,
      }),
    });
    els.loginForm.reset();
    setAuthMode("login");
    await bootstrap();
  } catch (error) {
    els.loginError.textContent = error.message;
  }
});

els.logoutButton.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  clearPendingAttachments("chat");
  clearPendingAttachments("code");
  state.adminOverview = null;
  showLogin();
});

els.adminRefreshButton?.addEventListener("click", async () => {
  await refreshAdminOverview().catch((error) => {
    window.alert(error.message);
  });
});

els.adminDispatchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveDispatchSettings().catch((error) => {
    window.alert(error.message);
  });
});

els.adminRoutingResetButton?.addEventListener("click", async () => {
  if (!window.confirm("Reset dispatch settings and auto routing to defaults?")) {
    return;
  }
  await resetRoutingConfig().catch((error) => {
    window.alert(error.message);
  });
});

els.adminAutoRoutingTable?.addEventListener("change", async (event) => {
  const input = event.target.closest('input[data-field="enabled"]');
  if (!input) {
    return;
  }
  const row = input.closest("tr[data-route-type][data-route-id]");
  if (!row) {
    return;
  }
  await setAutoRouteEnabled(row.dataset.routeType, row.dataset.routeId, input.checked).catch((error) => {
    window.alert(error.message);
  });
});

els.adminAutoRoutingTable?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const row = button.closest("tr[data-route-type][data-route-id]");
  if (!row) {
    return;
  }
  try {
    if (button.dataset.action === "route-up") {
      await moveAutoRoute(row.dataset.routeType, row.dataset.routeId, -1);
      return;
    }
    if (button.dataset.action === "route-down") {
      await moveAutoRoute(row.dataset.routeType, row.dataset.routeId, 1);
    }
  } catch (error) {
    window.alert(error.message);
  }
});

els.adminUsersTable?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const userId = button.dataset.userId;
  const action = button.dataset.action;
  const username = button.dataset.username || "user";
  const isAdmin = button.dataset.isAdmin === "1";

  try {
    if (action === "view") {
      await loadAdminUserConversations(userId);
      return;
    }
    if (action === "unlock") {
      await unlockAdminUser(userId);
      return;
    }
    if (action === "signout") {
      if (!window.confirm(`Sign out all active sessions for "${username}"?`)) {
        return;
      }
      await revokeAdminUserSessions(userId);
      return;
    }
    if (action === "password") {
      const nextPassword = window.prompt(`Set a new password for ${username}:`, "");
      if (nextPassword === null) {
        return;
      }
      await updateAdminUser(userId, {
        password: nextPassword,
      });
      return;
    }
    if (action === "role") {
      await updateAdminUser(userId, {
        isAdmin: !isAdmin,
      });
      return;
    }
    if (action === "delete") {
      if (!window.confirm(`Delete user "${username}" and all of their data?`)) {
        return;
      }
      await deleteAdminUser(userId);
    }
  } catch (error) {
    window.alert(error.message);
  }
});

els.adminUserSearchInput?.addEventListener("input", () => {
  state.adminUserSearch = String(els.adminUserSearchInput.value || "");
  renderAdminOverview();
});

els.newChatButton.addEventListener("click", async () => {
  await createConversation();
});

els.chatPinButton.addEventListener("click", async () => {
  const conversation = selectedConversation();
  if (!conversation) {
    return;
  }
  await setConversationPinned(conversation.id, !conversation.isPinned).catch((error) => {
    window.alert(error.message);
  });
});

els.chatDeleteButton.addEventListener("click", async () => {
  const conversation = selectedConversation();
  if (!conversation) {
    return;
  }
  if (!window.confirm(`Delete conversation "${conversation.title}"?`)) {
    return;
  }
  await deleteConversation(conversation.id).catch((error) => {
    window.alert(error.message);
  });
});

els.jobPinButton.addEventListener("click", async () => {
  const job = state.selectedJob;
  if (!job) {
    return;
  }
  await setJobPinned(job.id, !job.isPinned).catch((error) => {
    window.alert(error.message);
  });
});

els.jobDeleteButton.addEventListener("click", async () => {
  const job = state.selectedJob;
  if (!job) {
    return;
  }
  if (job.status === "running") {
    return;
  }
  if (!window.confirm(`Delete code job "${jobTitle(job)}"?`)) {
    return;
  }
  await deleteJob(job.id).catch((error) => {
    window.alert(error.message);
  });
});

els.chatProviderSelect.addEventListener("change", () => {
  setSelectedProvider(els.chatProviderSelect.value);
  renderIdentity();
});

els.chatModelSelect.addEventListener("change", () => {
  const providerId = selectedProviderId();
  if (!providerId) {
    return;
  }
  window.localStorage.setItem(`${CHAT_MODEL_STORAGE_KEY_PREFIX}${providerId}`, els.chatModelSelect.value);
});

els.chatAttachmentsInput.addEventListener("change", () => {
  appendPendingAttachments("chat", els.chatAttachmentsInput.files);
  els.chatAttachmentsInput.value = "";
});

els.codeAttachmentsInput.addEventListener("change", () => {
  appendPendingAttachments("code", els.codeAttachmentsInput.files);
  els.codeAttachmentsInput.value = "";
});

els.chatAttachmentList.addEventListener("click", (event) => {
  const button = event.target.closest(".attachment-remove");
  if (!button) {
    return;
  }
  removePendingAttachment(button.dataset.kind, Number(button.dataset.index));
});

els.codeAttachmentList.addEventListener("click", (event) => {
  const button = event.target.closest(".attachment-remove");
  if (!button) {
    return;
  }
  removePendingAttachment(button.dataset.kind, Number(button.dataset.index));
});

els.chatMessages.addEventListener("click", async (event) => {
  const button = event.target.closest(".code-copy-button");
  if (!button) {
    return;
  }

  const shell = button.closest(".code-block-shell");
  const code = shell?.querySelector("pre code");
  if (!code) {
    return;
  }

  try {
    await copyText(code.innerText);
    setCopyButtonState(button, "Copied");
  } catch {
    setCopyButtonState(button, "Failed");
  }
});

document.addEventListener("click", (event) => {
  const link = event.target.closest("a.attachment-card");
  if (!link) {
    return;
  }

  const href = String(link.getAttribute("href") || "").trim();
  if (!href) {
    return;
  }

  if (!shouldAllowAttachmentDownload(href)) {
    event.preventDefault();
    setAttachmentDownloadPending(link, true);
    window.setTimeout(() => setAttachmentDownloadPending(link, false), ATTACHMENT_DOWNLOAD_DEBOUNCE_MS + 120);
    return;
  }

  setAttachmentDownloadPending(link, true);
  window.setTimeout(() => setAttachmentDownloadPending(link, false), ATTACHMENT_DOWNLOAD_DEBOUNCE_MS + 120);
});

for (const button of els.themeButtons) {
  button.addEventListener("click", () => {
    applyThemeMode(button.dataset.themeMode || "light");
  });
}

els.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.chatRequestPending) {
    return;
  }
  const content = els.chatInput.value.trim();
  const attachments = [...state.pendingChatAttachments];
  if (!content && attachments.length === 0) {
    return;
  }
  els.chatInput.value = "";
  clearPendingAttachments("chat");
  await sendChatMessage(content, attachments).catch((error) => {
    setChatRequestPending(false);
    els.chatInput.value = content;
    state.pendingChatAttachments = attachments;
    renderPendingAttachmentList("chat");
    window.alert(error.message);
  });
});

els.codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = els.codeInput.value.trim();
  const attachments = [...state.pendingCodeAttachments];
  if (!prompt && attachments.length === 0) {
    return;
  }
  els.codeInput.value = "";
  clearPendingAttachments("code");
  await queueCodeJob(prompt, attachments).catch((error) => {
    els.codeInput.value = prompt;
    state.pendingCodeAttachments = attachments;
    renderPendingAttachmentList("code");
    window.alert(error.message);
  });
});

for (const button of els.modeButtons) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}

for (const button of els.authModeButtons) {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
}

setInterval(() => {
  if (document.visibilityState === "hidden") {
    return;
  }
  if (state.me?.canUseCode) {
    refreshJobs().catch(() => {});
  }
  if (state.me && state.mode === "admin") {
    refreshAdminOverview().catch(() => {});
  }
}, JOB_POLL_INTERVAL_MS);

renderAuthMode();
applyThemeMode(state.themeMode, { persist: false });
bootstrap();
