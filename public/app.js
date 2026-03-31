const state = {
  me: null,
  chat: null,
  capabilities: null,
  adminOverview: null,
  mode: "chat",
  conversations: [],
  selectedConversationId: null,
  messages: [],
  jobs: [],
  selectedJobId: null,
  selectedJob: null,
  selectedJobLogText: "",
  pendingChatAttachments: [],
  pendingCodeAttachments: [],
  chatRequestPending: false,
};

const CHAT_PROVIDER_STORAGE_KEY = "relay.chatProviderId.v2";
const CHAT_MODEL_STORAGE_KEY_PREFIX = "relay.chatModel.v2.";
const JOB_POLL_INTERVAL_MS = 2000;

const els = {
  loginScreen: document.getElementById("login-screen"),
  appScreen: document.getElementById("app-screen"),
  loginForm: document.getElementById("login-form"),
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
  codeModeButton: document.querySelector('.mode-button[data-mode="code"]'),
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
  modeToggle: document.querySelector(".mode-toggle"),
  modeButtons: Array.from(document.querySelectorAll(".mode-button")),
  modePanels: {
    chat: document.getElementById("chat-mode"),
    code: document.getElementById("code-mode"),
    admin: document.getElementById("admin-mode"),
  },
  adminRefreshButton: document.getElementById("admin-refresh-button"),
  adminSummary: document.getElementById("admin-summary"),
  adminApiKeyTable: document.getElementById("admin-api-key-table"),
  adminAutoRoutingTable: document.getElementById("admin-auto-routing-table"),
  adminDispatchTable: document.getElementById("admin-dispatch-table"),
  adminAuthTable: document.getElementById("admin-auth-table"),
};

let jobsRefreshInFlight = false;
let messageRenderFrame = 0;

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

function showLogin() {
  state.me = null;
  state.adminOverview = null;
  els.loginScreen.classList.remove("hidden");
  els.appScreen.classList.add("hidden");
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

  els.userName.textContent = state.me.displayName;
  const visibleModeCount = 1 + (state.me.canUseCode ? 1 : 0) + (state.me.isAdmin ? 1 : 0);
  els.modeToggle.classList.toggle("chat-only", visibleModeCount === 1);
  els.modeToggle.style.gridTemplateColumns = `repeat(${visibleModeCount}, minmax(0, 1fr))`;
  els.codeModeButton.classList.toggle("hidden", !state.me.canUseCode);
  els.adminModeButton.classList.toggle("hidden", !state.me.isAdmin);
  if (!state.me.canUseCode && state.mode === "code") {
    setMode("chat");
  }
  if (!state.me.isAdmin && state.mode === "admin") {
    setMode("chat");
  }

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
  if (mode === "code" && !state.me?.canUseCode) {
    mode = "chat";
  }
  if (mode === "admin" && !state.me?.isAdmin) {
    mode = "chat";
  }
  state.mode = mode;
  for (const button of els.modeButtons) {
    button.classList.toggle("active", button.dataset.mode === mode);
  }
  els.chatListPanel.classList.toggle("hidden", mode !== "chat");
  els.codeListPanel.classList.toggle("hidden", mode !== "code");
  Object.entries(els.modePanels).forEach(([key, panel]) => {
    panel.classList.toggle("hidden", key !== mode);
  });

  if (mode === "admin" && state.me?.isAdmin) {
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
    els.conversationList.innerHTML = `<div class="empty-state">No conversations yet.</div>`;
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

function renderMessages() {
  els.chatMessages.innerHTML = "";
  if (state.messages.length === 0) {
    els.chatMessages.className = "message-stream empty-state";
    els.chatMessages.textContent = "Start a new chat. Each chat window keeps its own context.";
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
      <div class="message-body">${escapeHtml(content)}</div>
      ${meta ? `<div class="message-meta">${escapeHtml(meta)}</div>` : ""}
      ${attachmentMarkup(visibleAttachments, "message")}
    `;
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
    els.jobList.innerHTML = `<div class="empty-state">No code jobs queued yet.</div>`;
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
    els.jobDetail.textContent = "Pick a job on the left to inspect status, summary, output files, and logs.";
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
        ${job.status === "pending" ? '<p class="job-meta">Waiting for a worker slot. This panel refreshes automatically.</p>' : ""}
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

function renderAdminOverview() {
  const overview = state.adminOverview;
  if (!state.me?.isAdmin) {
    return;
  }

  if (!overview) {
    els.adminSummary.innerHTML = "";
    renderTableEmptyBody(els.adminApiKeyTable, 9, "No admin data loaded.");
    renderTableEmptyBody(els.adminAutoRoutingTable, 6, "No auto routing data loaded.");
    renderTableEmptyBody(els.adminDispatchTable, 8, "No dispatch events yet.");
    renderTableEmptyBody(els.adminAuthTable, 5, "No authentication audit events yet.");
    return;
  }

  const summary = overview.summary || {};
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
      <span>Users</span>
      <strong>${escapeHtml(String(summary.users || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>Code Queue</span>
      <strong>${escapeHtml(`${summary.queue?.running || 0}/${summary.queue?.concurrency || 0}`)}</strong>
    </article>
  `;

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
            <td>${escapeCell(apiKey.priority)}</td>
            <td>${escapeCell(apiKey.weight)}</td>
            <td>${escapeCell(apiKey.successCount)}</td>
            <td>${escapeCell(apiKey.failureCount)}</td>
            <td>${escapeCell(apiKey.cooldownUntil ? formatDateTime(apiKey.cooldownUntil) : "Active")}</td>
            <td>${escapeCell(apiKey.lastError, "—")}</td>
          </tr>
        `,
      )
      .join("");
  }

  const autoRoutes = Object.entries(overview.autoRouting?.routes || {}).flatMap(([routeType, routes]) =>
    (routes || []).map((route) => ({ routeType, ...route })),
  );
  if (!autoRoutes.length) {
    renderTableEmptyBody(els.adminAutoRoutingTable, 6, "Auto mode is not configured.");
  } else {
    els.adminAutoRoutingTable.innerHTML = autoRoutes
      .map(
        (route) => `
          <tr>
            <td>${escapeCell(route.routeType)}</td>
            <td>${escapeCell(route.providerLabel)}</td>
            <td>${escapeCell(route.model)}</td>
            <td>${escapeCell(route.priority)}</td>
            <td>${escapeCell(route.weight)}</td>
            <td>${escapeCell(route.cooldownUntil ? formatDateTime(route.cooldownUntil) : "Active")}</td>
          </tr>
        `,
      )
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
}

async function refreshAdminOverview() {
  if (!state.me?.isAdmin) {
    state.adminOverview = null;
    renderAdminOverview();
    return;
  }

  const payload = await api("/api/admin/overview");
  state.adminOverview = payload;
  renderAdminOverview();
}

async function bootstrap() {
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
    if (state.mode === "code" && !state.me.canUseCode) {
      state.mode = "chat";
    }
    if (state.mode === "admin" && !state.me.isAdmin) {
      state.mode = "chat";
    }
    setMode(state.mode);
    renderPendingAttachmentList("chat");
    renderPendingAttachmentList("code");
    await refreshConversations();
    if (state.me.canUseCode) {
      await refreshJobs();
    } else {
      state.jobs = [];
      state.selectedJobId = null;
      state.selectedJob = null;
      renderJobs();
      renderJobDetail();
    }
    if (state.me.isAdmin) {
      await refreshAdminOverview();
    } else {
      state.adminOverview = null;
      renderAdminOverview();
    }
  } catch {
    showLogin();
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

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.textContent = "";
  const formData = new FormData(els.loginForm);

  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });
    els.loginForm.reset();
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

setInterval(() => {
  if (document.visibilityState === "hidden") {
    return;
  }
  if (state.me?.canUseCode) {
    refreshJobs().catch(() => {});
  }
  if (state.me?.isAdmin && state.mode === "admin") {
    refreshAdminOverview().catch(() => {});
  }
}, JOB_POLL_INTERVAL_MS);

bootstrap();
