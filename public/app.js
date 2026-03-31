import { renderMarkdown } from "./markdown.js";

const state = {
  me: null,
  chat: null,
  capabilities: null,
  adminOverview: null,
  authMode: "login",
  mode: "chat",
  language: document.documentElement.lang || "en",
  themeMode: document.documentElement.dataset.theme || "light",
  conversations: [],
  selectedConversationId: null,
  messages: [],
  jobs: [],
  queueStats: null,
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
const LANGUAGE_STORAGE_KEY = "relay.language.v1";
const THEME_STORAGE_KEY = "relay.theme.v1";
const JOB_POLL_INTERVAL_MS = 4000;
const IDLE_JOB_POLL_INTERVAL_MS = 15000;
const ADMIN_POLL_INTERVAL_MS = 12000;
const ATTACHMENT_DOWNLOAD_DEBOUNCE_MS = 1500;
const ROUTING_PRIORITY_BASE = 1000;
const ROUTING_PRIORITY_STEP = 10;

const els = {
  appShell: document.getElementById("app-shell"),
  bootScreen: document.getElementById("boot-screen"),
  loginScreen: document.getElementById("login-screen"),
  appScreen: document.getElementById("app-screen"),
  languageButtons: Array.from(document.querySelectorAll("[data-language-mode]")),
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
  chatSubmitButton: document.getElementById("chat-submit-button"),
  codeModeButton: document.querySelector('#app-mode-toggle .mode-button[data-mode="code"]'),
  adminModeButton: document.getElementById("admin-mode-button"),
  codeForm: document.getElementById("code-form"),
  codeInput: document.getElementById("code-input"),
  codeAttachmentsInput: document.getElementById("code-attachments-input"),
  codeAttachmentList: document.getElementById("code-attachment-list"),
  codeSubmitButton: document.getElementById("code-submit-button"),
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
  adminUserRepoSection: document.getElementById("admin-user-repo-section"),
  adminUserRepoTitle: document.getElementById("admin-user-repo-title"),
  adminUserRepoForm: document.getElementById("admin-user-repo-form"),
  adminUserRepoUrlInput: document.getElementById("admin-user-repo-url-input"),
  adminUserRepoPathInput: document.getElementById("admin-user-repo-path-input"),
  adminUserRepoBranchInput: document.getElementById("admin-user-repo-branch-input"),
  adminUserRepoSaveButton: document.getElementById("admin-user-repo-save-button"),
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
  adminApiKeysSection: document.getElementById("admin-api-keys-section"),
  adminApiKeyTable: document.getElementById("admin-api-key-table"),
  adminAutoRoutingSection: document.getElementById("admin-auto-routing-section"),
  adminAutoRoutingTable: document.getElementById("admin-auto-routing-table"),
  adminDispatchTable: document.getElementById("admin-dispatch-table"),
  adminAuthTable: document.getElementById("admin-auth-table"),
  modalRoot: document.getElementById("modal-root"),
  modalEyebrow: document.getElementById("modal-eyebrow"),
  modalTitle: document.getElementById("modal-title"),
  modalMessage: document.getElementById("modal-message"),
  modalInputRow: document.getElementById("modal-input-row"),
  modalInputLabel: document.getElementById("modal-input-label"),
  modalInput: document.getElementById("modal-input"),
  modalError: document.getElementById("modal-error"),
  modalCancelButton: document.getElementById("modal-cancel-button"),
  modalConfirmButton: document.getElementById("modal-confirm-button"),
};

const TRANSLATIONS = {
  en: {
    "brand.name": "Relay Station",
    "brand.user": "User",
    "controls.language": "Language",
    "controls.theme": "Theme",
    "controls.languageZh": "中文",
    "controls.languageEn": "English",
    "controls.themeLight": "Light",
    "controls.themeDark": "Dark",
    "boot.loading": "Loading",
    "login.heroTitle": "Chat. Code. Control.",
    "login.heroLede": "Private multi-user AI relay.",
    "auth.access": "Access",
    "auth.enter": "Enter",
    "auth.createAccount": "Create Account",
    "auth.login": "Login",
    "auth.register": "Register",
    "auth.username": "Username",
    "auth.password": "Password",
    "auth.confirmPassword": "Confirm Password",
    "auth.enterStation": "Enter Station",
    "auth.passwordsMismatch": "Passwords do not match.",
    "sidebar.chatMode": "Chat Mode",
    "sidebar.codeMode": "Code Mode",
    "sidebar.control": "Control",
    "sidebar.chats": "Chats",
    "sidebar.jobs": "Jobs",
    "sidebar.new": "New",
    "sidebar.logout": "Log out",
    "common.notice": "Notice",
    "common.confirm": "Confirm",
    "common.input": "Input",
    "common.error": "Error",
    "common.close": "Close",
    "common.continue": "Continue",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.value": "Value",
    "common.remove": "Remove",
    "common.copy": "Copy",
    "common.copied": "Copied",
    "common.copyFailed": "Failed",
    "common.clickToDownload": "Click to download",
    "common.preparingDownload": "Preparing download",
    "common.active": "Active",
    "common.adminOnly": "Admin only",
    "common.on": "on",
    "common.off": "off",
    "common.current": "Current",
    "common.never": "Never",
    "common.unknownIp": "Unknown IP",
    "common.unknownAgent": "Unknown agent",
    "chat.selectConversation": "Select or create a conversation",
    "chat.start": "Start a chat.",
    "chat.provider": "Provider",
    "chat.model": "Model",
    "chat.askPlaceholder": "Ask anything or attach files for context...",
    "chat.addFiles": "Add Files",
    "chat.send": "Send",
    "chat.streaming": "Streaming…",
    "chat.noProviderConfigured": "No provider configured",
    "chat.pin": "Pin",
    "chat.unpin": "Unpin",
    "chat.delete": "Delete",
    "chat.thinking": "Thinking…",
    "chat.streamingMeta": "Streaming",
    "chat.failedMeta": "Failed",
    "chat.noChats": "No chats.",
    "chat.pinned": "Pinned",
    "chat.sentAttachments": "Sent {count} attachment{suffix}.",
    "chat.newConversationTitle": "New chat",
    "chat.deleteTitle": "Delete chat",
    "chat.deletePrompt": "Delete conversation \"{title}\"?",
    "chat.messageFailed": "Message failed",
    "chat.streamingUnsupported": "Streaming is not supported by this browser.",
    "code.formTitle": "Queue a code job",
    "code.placeholder": "Describe the task, script, automation, or implementation work...",
    "code.queueButton": "Queue Code Job",
    "code.noJobSelected": "No job selected",
    "code.selectJob": "Select a job.",
    "code.noJobs": "No jobs.",
    "code.pin": "Pin",
    "code.unpin": "Unpin",
    "code.delete": "Delete",
    "code.untitledJob": "Untitled job",
    "code.attachmentsTitle": "Attachments",
    "code.status": "Status",
    "code.inputFiles": "Input Files",
    "code.outputFiles": "Output Files",
    "code.noOutputYet": "No output yet.",
    "code.queue": "Queue",
    "code.liveOutput": "Live Output",
    "code.waitingForWorker": "Waiting for a worker slot.",
    "code.waitingForLiveOutput": "Waiting for live output…",
    "code.queued": "Queued…",
    "code.changedFiles": "Changed Files",
    "code.diff": "Diff",
    "code.queueIdle": "idle",
    "code.queueRunning": "{running}/{concurrency} running",
    "code.runningDeleteBlocked": "Running jobs cannot be deleted.",
    "code.deleteTitle": "Delete job",
    "code.deletePrompt": "Delete code job \"{title}\"?",
    "code.queueFailed": "Queue failed",
    "admin.title": "AI Control",
    "admin.refresh": "Refresh",
    "admin.users": "User Management",
    "admin.searchUsers": "Search users",
    "admin.dispatchSettings": "Dispatch Settings",
    "admin.reset": "Reset",
    "admin.retryCooldown": "Retry Cooldown (ms)",
    "admin.quotaCooldown": "Quota Cooldown (ms)",
    "admin.breakerThreshold": "Breaker Threshold",
    "admin.breakerCooldown": "Breaker Cooldown (ms)",
    "admin.historyLimit": "History Limit",
    "admin.saveDispatch": "Save Dispatch",
    "admin.apiUsage": "API Usage",
    "admin.apiKeys": "API Keys",
    "admin.autoRouting": "Auto Routing",
    "admin.autoRoutingNote": "Top to bottom wins inside each route type.",
    "admin.dispatchTimeline": "Dispatch Timeline",
    "admin.dispatchEvents": "Dispatch Events",
    "admin.codeRepository": "Code Repository",
    "admin.remoteUrl": "Remote URL",
    "admin.localPath": "Local Path",
    "admin.defaultBranch": "Default Branch",
    "admin.saveRepo": "Save Repo",
    "admin.userConversations": "User Conversations",
    "admin.userJobs": "User Jobs",
    "admin.userSessions": "User Sessions",
    "admin.authenticationAudit": "Authentication Audit",
    "admin.noApiUsageLoaded": "No API usage data loaded.",
    "admin.noAdminDataLoaded": "No admin data loaded.",
    "admin.noAutoRoutingLoaded": "No auto routing data loaded.",
    "admin.noDispatchYet": "No dispatch events yet.",
    "admin.noUsersLoaded": "No users loaded.",
    "admin.noAuthAuditYet": "No authentication audit events yet.",
    "admin.configuredProviders": "Configured Providers",
    "admin.configuredApiKeys": "Configured API Keys",
    "admin.apiSuccesses": "API Successes",
    "admin.apiFailures": "API Failures",
    "admin.recentDispatches": "Recent Dispatches",
    "admin.activeUsers": "Active Users",
    "admin.cooldownKeys": "Cooldown Keys",
    "admin.usersMetric": "Users",
    "admin.codeQueue": "Code Queue",
    "admin.noApiUsageYet": "No API usage recorded yet.",
    "admin.noApiKeysConfigured": "No API keys configured.",
    "admin.autoModeNotConfigured": "Auto mode is not configured.",
    "admin.noDispatchEventsRecorded": "No dispatch events recorded yet.",
    "admin.selectUser": "Select a user.",
    "admin.noChatHistory": "No chat history.",
    "admin.noMessagesRecorded": "No messages recorded.",
    "admin.noJobs": "No jobs.",
    "admin.noActiveSessions": "No active sessions.",
    "admin.noMatchingUsers": "No matching users.",
    "admin.noUsersFound": "No users found.",
    "admin.open": "Open",
    "admin.unlock": "Unlock",
    "admin.signOut": "Sign Out",
    "admin.password": "Password",
    "admin.makeAdmin": "Make Admin",
    "admin.revokeAdmin": "Revoke Admin",
    "admin.delete": "Delete",
    "admin.member": "member",
    "admin.roleAdmin": "admin",
    "admin.locked": "locked",
    "admin.activitySummary": "{chats} chats · {jobs} jobs · {sessions} sessions",
    "admin.signOutTitle": "Sign out sessions",
    "admin.signOutPrompt": "Sign out all active sessions for \"{username}\"?",
    "admin.changePasswordTitle": "Change password",
    "admin.changePasswordPrompt": "Set a new password for {username}:",
    "admin.newPassword": "New password",
    "admin.savePassword": "Save Password",
    "admin.deleteUserTitle": "Delete user",
    "admin.deleteUserPrompt": "Delete user \"{username}\" and all of their data?",
    "admin.resetRoutingTitle": "Reset routing",
    "admin.resetRoutingPrompt": "Reset dispatch settings and auto routing to defaults?",
    "admin.refreshFailed": "Refresh failed",
    "admin.saveFailed": "Save failed",
    "admin.resetFailed": "Reset failed",
    "admin.updateFailed": "Update failed",
    "admin.userUpdateFailed": "User update failed",
    "admin.repositoryFor": "Code Repository · {displayName}",
    "admin.conversationsFor": "User Conversations · {displayName} ({username})",
    "admin.jobsFor": "User Jobs · {displayName}",
    "admin.sessionsFor": "User Sessions · {displayName}",
    "admin.messageCount": "{count} msgs",
    "admin.attachments": "Attachments: {files}",
    "admin.noBranch": "no branch",
    "admin.inProgress": "in progress",
    "admin.noOutput": "No output.",
    "admin.selectUserButton": "Select a user",
    "table.user": "User",
    "table.role": "Role",
    "table.activity": "Activity",
    "table.lastLogin": "Last Login",
    "table.actions": "Actions",
    "table.provider": "Provider",
    "table.keys": "Keys",
    "table.success": "Success",
    "table.failure": "Failure",
    "table.cooldown": "Cooldown",
    "table.inFlight": "In Flight",
    "table.lastUsed": "Last Used",
    "table.key": "Key",
    "table.status": "Status",
    "table.priority": "Priority",
    "table.weight": "Weight",
    "table.lastError": "Last Error",
    "table.type": "Type",
    "table.route": "Route",
    "table.state": "State",
    "table.order": "Order",
    "table.time": "Time",
    "table.providerKey": "Provider / Key",
    "table.model": "Model",
    "table.userLabel": "User",
    "table.latency": "Latency",
    "table.error": "Error",
    "table.ip": "IP",
    "table.reason": "Reason",
    "table.event": "Event",
    "actions.up": "Up",
    "actions.down": "Down",
    "status.pending": "pending",
    "status.running": "running",
    "status.completed": "completed",
    "status.failed": "failed",
    "status.success": "success",
    "status.healthy": "healthy",
    "status.degraded": "degraded",
    "status.cooldown": "cooldown",
    "status.disabled": "disabled",
    "status.route-failed": "route-failed",
    "status.route-terminal": "route-terminal",
    "status.login_failed": "login_failed",
    "status.login_locked": "login_locked",
    "status.login_blocked": "login_blocked",
  },
  "zh-CN": {
    "brand.name": "Relay Station",
    "brand.user": "用户",
    "controls.language": "语言",
    "controls.theme": "主题",
    "controls.languageZh": "中文",
    "controls.languageEn": "English",
    "controls.themeLight": "亮色",
    "controls.themeDark": "暗色",
    "boot.loading": "加载中",
    "login.heroTitle": "对话 · 代码 · 控制",
    "login.heroLede": "面向多用户的私有 AI Relay。",
    "auth.access": "访问",
    "auth.enter": "登录",
    "auth.createAccount": "创建账户",
    "auth.login": "登录",
    "auth.register": "注册",
    "auth.username": "用户名",
    "auth.password": "密码",
    "auth.confirmPassword": "确认密码",
    "auth.enterStation": "进入系统",
    "auth.passwordsMismatch": "两次输入的密码不一致。",
    "sidebar.chatMode": "对话",
    "sidebar.codeMode": "代码",
    "sidebar.control": "控制台",
    "sidebar.chats": "对话",
    "sidebar.jobs": "任务",
    "sidebar.new": "新建",
    "sidebar.logout": "退出登录",
    "common.notice": "提示",
    "common.confirm": "确认",
    "common.input": "输入",
    "common.error": "错误",
    "common.close": "关闭",
    "common.continue": "继续",
    "common.cancel": "取消",
    "common.save": "保存",
    "common.value": "值",
    "common.remove": "移除",
    "common.copy": "复制",
    "common.copied": "已复制",
    "common.copyFailed": "失败",
    "common.clickToDownload": "点击下载",
    "common.preparingDownload": "准备下载中",
    "common.active": "正常",
    "common.adminOnly": "仅管理员",
    "common.on": "开启",
    "common.off": "关闭",
    "common.current": "当前",
    "common.never": "从未",
    "common.unknownIp": "未知 IP",
    "common.unknownAgent": "未知设备",
    "chat.selectConversation": "选择或新建一个对话",
    "chat.start": "开始一段对话。",
    "chat.provider": "提供商",
    "chat.model": "模型",
    "chat.askPlaceholder": "输入问题，或附加文件作为上下文...",
    "chat.addFiles": "添加文件",
    "chat.send": "发送",
    "chat.streaming": "生成中…",
    "chat.noProviderConfigured": "未配置提供商",
    "chat.pin": "置顶",
    "chat.unpin": "取消置顶",
    "chat.delete": "删除",
    "chat.thinking": "思考中…",
    "chat.streamingMeta": "生成中",
    "chat.failedMeta": "失败",
    "chat.noChats": "暂无对话。",
    "chat.pinned": "已置顶",
    "chat.sentAttachments": "已发送 {count} 个附件。",
    "chat.newConversationTitle": "新对话",
    "chat.deleteTitle": "删除对话",
    "chat.deletePrompt": "确定删除对话“{title}”吗？",
    "chat.messageFailed": "消息发送失败",
    "chat.streamingUnsupported": "当前浏览器不支持流式响应。",
    "code.formTitle": "创建代码任务",
    "code.placeholder": "描述任务、脚本、自动化流程或实现需求...",
    "code.queueButton": "加入代码队列",
    "code.noJobSelected": "未选择任务",
    "code.selectJob": "选择一个任务。",
    "code.noJobs": "暂无任务。",
    "code.pin": "置顶",
    "code.unpin": "取消置顶",
    "code.delete": "删除",
    "code.untitledJob": "未命名任务",
    "code.attachmentsTitle": "附件",
    "code.status": "状态",
    "code.inputFiles": "输入文件",
    "code.outputFiles": "输出文件",
    "code.noOutputYet": "暂无输出。",
    "code.queue": "排队情况",
    "code.liveOutput": "实时输出",
    "code.waitingForWorker": "等待可用执行槽位。",
    "code.waitingForLiveOutput": "等待实时输出…",
    "code.queued": "排队中…",
    "code.changedFiles": "变更文件",
    "code.diff": "差异",
    "code.queueIdle": "空闲",
    "code.queueRunning": "{running}/{concurrency} 运行中",
    "code.runningDeleteBlocked": "运行中的任务不能删除。",
    "code.deleteTitle": "删除任务",
    "code.deletePrompt": "确定删除代码任务“{title}”吗？",
    "code.queueFailed": "入队失败",
    "admin.title": "AI 控制台",
    "admin.refresh": "刷新",
    "admin.users": "用户管理",
    "admin.searchUsers": "搜索用户",
    "admin.dispatchSettings": "调度设置",
    "admin.reset": "重置",
    "admin.retryCooldown": "重试冷却（毫秒）",
    "admin.quotaCooldown": "额度冷却（毫秒）",
    "admin.breakerThreshold": "熔断阈值",
    "admin.breakerCooldown": "熔断冷却（毫秒）",
    "admin.historyLimit": "历史条数",
    "admin.saveDispatch": "保存调度设置",
    "admin.apiUsage": "API 使用情况",
    "admin.apiKeys": "API Keys",
    "admin.autoRouting": "自动路由",
    "admin.autoRoutingNote": "同一类型路由按从上到下优先。",
    "admin.dispatchTimeline": "调度时间线",
    "admin.dispatchEvents": "调度事件",
    "admin.codeRepository": "代码仓库",
    "admin.remoteUrl": "远端地址",
    "admin.localPath": "本地路径",
    "admin.defaultBranch": "默认分支",
    "admin.saveRepo": "保存仓库配置",
    "admin.userConversations": "用户对话",
    "admin.userJobs": "用户任务",
    "admin.userSessions": "用户会话",
    "admin.authenticationAudit": "认证审计",
    "admin.noApiUsageLoaded": "尚未加载 API 使用数据。",
    "admin.noAdminDataLoaded": "尚未加载管理员数据。",
    "admin.noAutoRoutingLoaded": "尚未加载自动路由数据。",
    "admin.noDispatchYet": "暂无调度事件。",
    "admin.noUsersLoaded": "尚未加载用户。",
    "admin.noAuthAuditYet": "暂无认证审计记录。",
    "admin.configuredProviders": "已配置提供商",
    "admin.configuredApiKeys": "已配置 API Key",
    "admin.apiSuccesses": "API 成功次数",
    "admin.apiFailures": "API 失败次数",
    "admin.recentDispatches": "最近调度次数",
    "admin.activeUsers": "活跃用户",
    "admin.cooldownKeys": "冷却中的 Key",
    "admin.usersMetric": "用户数",
    "admin.codeQueue": "代码队列",
    "admin.noApiUsageYet": "暂无 API 使用记录。",
    "admin.noApiKeysConfigured": "未配置 API Key。",
    "admin.autoModeNotConfigured": "未配置自动模式。",
    "admin.noDispatchEventsRecorded": "暂无调度事件记录。",
    "admin.selectUser": "请选择一个用户。",
    "admin.noChatHistory": "暂无对话记录。",
    "admin.noMessagesRecorded": "暂无消息记录。",
    "admin.noJobs": "暂无任务。",
    "admin.noActiveSessions": "暂无活跃会话。",
    "admin.noMatchingUsers": "没有匹配的用户。",
    "admin.noUsersFound": "没有用户。",
    "admin.open": "查看",
    "admin.unlock": "解锁",
    "admin.signOut": "强制退出",
    "admin.password": "改密码",
    "admin.makeAdmin": "设为管理员",
    "admin.revokeAdmin": "取消管理员",
    "admin.delete": "删除",
    "admin.member": "成员",
    "admin.roleAdmin": "管理员",
    "admin.locked": "已锁定",
    "admin.activitySummary": "{chats} 个对话 · {jobs} 个任务 · {sessions} 个会话",
    "admin.signOutTitle": "强制退出会话",
    "admin.signOutPrompt": "确定让“{username}”的所有活跃会话退出吗？",
    "admin.changePasswordTitle": "修改密码",
    "admin.changePasswordPrompt": "为 {username} 设置新密码：",
    "admin.newPassword": "新密码",
    "admin.savePassword": "保存密码",
    "admin.deleteUserTitle": "删除用户",
    "admin.deleteUserPrompt": "确定删除用户“{username}”及其全部数据吗？",
    "admin.resetRoutingTitle": "重置路由",
    "admin.resetRoutingPrompt": "确定将调度设置和自动路由恢复为默认值吗？",
    "admin.refreshFailed": "刷新失败",
    "admin.saveFailed": "保存失败",
    "admin.resetFailed": "重置失败",
    "admin.updateFailed": "更新失败",
    "admin.userUpdateFailed": "用户更新失败",
    "admin.repositoryFor": "代码仓库 · {displayName}",
    "admin.conversationsFor": "用户对话 · {displayName}（{username}）",
    "admin.jobsFor": "用户任务 · {displayName}",
    "admin.sessionsFor": "用户会话 · {displayName}",
    "admin.messageCount": "{count} 条消息",
    "admin.attachments": "附件：{files}",
    "admin.noBranch": "无分支",
    "admin.inProgress": "进行中",
    "admin.noOutput": "暂无输出。",
    "admin.selectUserButton": "请选择用户",
    "table.user": "用户",
    "table.role": "角色",
    "table.activity": "活跃度",
    "table.lastLogin": "最后登录",
    "table.actions": "操作",
    "table.provider": "提供商",
    "table.keys": "Key 数",
    "table.success": "成功",
    "table.failure": "失败",
    "table.cooldown": "冷却",
    "table.inFlight": "进行中",
    "table.lastUsed": "最近使用",
    "table.key": "Key",
    "table.status": "状态",
    "table.priority": "优先级",
    "table.weight": "权重",
    "table.lastError": "最后错误",
    "table.type": "类型",
    "table.route": "路由",
    "table.state": "状态",
    "table.order": "顺序",
    "table.time": "时间",
    "table.providerKey": "提供商 / Key",
    "table.model": "模型",
    "table.userLabel": "用户",
    "table.latency": "耗时",
    "table.error": "错误",
    "table.ip": "IP",
    "table.reason": "原因",
    "table.event": "事件",
    "actions.up": "上移",
    "actions.down": "下移",
    "status.pending": "排队中",
    "status.running": "运行中",
    "status.completed": "已完成",
    "status.failed": "失败",
    "status.success": "成功",
    "status.healthy": "健康",
    "status.degraded": "降级",
    "status.cooldown": "冷却中",
    "status.disabled": "已停用",
    "status.route-failed": "路由失败",
    "status.route-terminal": "路由终止",
    "status.login_failed": "登录失败",
    "status.login_locked": "登录锁定",
    "status.login_blocked": "登录阻止",
  },
};

let jobsRefreshInFlight = false;
let adminOverviewRefreshPromise = null;
let messageRenderFrame = 0;
let messageRenderPatchLastOnly = false;
let jobsPollTimer = 0;
let adminPollTimer = 0;
const attachmentDownloads = new Map();
const modalState = {
  resolve: null,
  options: null,
  previouslyFocused: null,
};

function normalizeLanguage(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh_hans") {
    return "zh-CN";
  }
  return "en";
}

function translationTemplate(key, fallback = key) {
  return TRANSLATIONS[normalizeLanguage(state.language)]?.[key] ?? TRANSLATIONS.en[key] ?? fallback;
}

function t(key, values = {}, fallback = key) {
  return translationTemplate(key, fallback).replace(/\{(\w+)\}/g, (_match, token) => String(values[token] ?? ""));
}

function setText(id, key, values = {}, fallback = key) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = t(key, values, fallback);
  }
}

function setPlaceholder(id, key, values = {}, fallback = key) {
  const element = document.getElementById(id);
  if (element) {
    element.setAttribute("placeholder", t(key, values, fallback));
  }
}

function translateStatus(status) {
  const value = String(status || "").trim();
  if (!value) {
    return "";
  }
  return t(`status.${value}`, {}, value);
}

function rerenderLocalizedViews() {
  applyStaticTranslations();
  renderAuthMode();
  renderIdentity();
  renderPendingAttachmentList("chat");
  renderPendingAttachmentList("code");
  renderConversations();
  renderMessages();
  renderJobs();
  renderJobDetail();
  renderAdminOverview();
  renderQueuePill();
}

async function saveLanguagePreference(language) {
  if (!state.me) {
    return;
  }
  const payload = await api("/api/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({
      language,
    }),
  });
  state.me = payload.user;
}

function applyLanguage(language, { persist = true, syncUser = true, rerender = true } = {}) {
  const normalized = normalizeLanguage(language);
  const previous = normalizeLanguage(state.language);
  state.language = normalized;
  document.documentElement.lang = normalized;
  if (persist) {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
  }
  for (const button of els.languageButtons) {
    const active = button.dataset.languageMode === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  applyStaticTranslations();
  if (rerender) {
    rerenderLocalizedViews();
  }
  if (syncUser && state.me && previous !== normalized && state.me.language !== normalized) {
    saveLanguagePreference(normalized).catch((error) => {
      console.error(error);
    });
  }
}

function applyStaticTranslations() {
  document.title = t("brand.name");
  setText("boot-eyebrow", "brand.name");
  setText("boot-loading-text", "boot.loading");
  setText("login-brand-eyebrow", "brand.name");
  setText("login-hero-title", "login.heroTitle");
  setText("login-hero-lede", "login.heroLede");
  setText("login-access-eyebrow", "auth.access");
  setText("auth-login-button", "auth.login");
  setText("auth-register-button", "auth.register");
  setText("login-username-label", "auth.username");
  setText("login-password-label", "auth.password");
  setText("login-confirm-password-label", "auth.confirmPassword");
  setText("sidebar-brand-eyebrow", "brand.name");
  setText("chat-mode-button", "sidebar.chatMode");
  setText("code-mode-tab-button", "sidebar.codeMode");
  setText("admin-mode-button", "sidebar.control");
  setText("chat-list-title", "sidebar.chats");
  setText("job-list-title", "sidebar.jobs");
  setText("new-chat-button", "sidebar.new");
  setText("logout-button", "sidebar.logout");
  setText("chat-provider-label", "chat.provider");
  setText("chat-model-label", "chat.model");
  if (!state.selectedConversationId) {
    setText("chat-title", "chat.selectConversation");
  }
  setPlaceholder("chat-input", "chat.askPlaceholder");
  setText("chat-add-files-button", "chat.addFiles");
  setText("chat-submit-button", "chat.send");
  setText("chat-pin-button", "chat.pin");
  setText("chat-delete-button", "chat.delete");
  setText("code-form-title", "code.formTitle");
  setPlaceholder("code-input", "code.placeholder");
  setText("code-add-files-button", "chat.addFiles");
  setText("code-submit-button", "code.queueButton");
  if (!state.selectedJob) {
    setText("job-title", "code.noJobSelected");
    els.jobDetail.textContent = t("code.selectJob");
  }
  setText("admin-title", "admin.title");
  setText("admin-refresh-button", "admin.refresh");
  setText("admin-users-title", "admin.users");
  setPlaceholder("admin-user-search-input", "admin.searchUsers");
  setText("admin-dispatch-settings-title", "admin.dispatchSettings");
  setText("admin-routing-reset-button", "admin.reset");
  setText("admin-retry-cooldown-label", "admin.retryCooldown");
  setText("admin-quota-cooldown-label", "admin.quotaCooldown");
  setText("admin-breaker-threshold-label", "admin.breakerThreshold");
  setText("admin-breaker-cooldown-label", "admin.breakerCooldown");
  setText("admin-history-limit-label", "admin.historyLimit");
  setText("admin-save-dispatch-button", "admin.saveDispatch");
  setText("admin-api-usage-title", "admin.apiUsage");
  setText("admin-api-keys-title", "admin.apiKeys");
  setText("admin-auto-routing-title", "admin.autoRouting");
  setText("admin-auto-routing-note", "admin.autoRoutingNote");
  setText("admin-dispatch-timeline-title", "admin.dispatchTimeline");
  setText("admin-dispatch-events-title", "admin.dispatchEvents");
  setText("admin-user-repo-title", "admin.codeRepository");
  setText("admin-user-repo-url-label", "admin.remoteUrl");
  setText("admin-user-repo-path-label", "admin.localPath");
  setText("admin-user-repo-branch-label", "admin.defaultBranch");
  setText("admin-user-repo-save-button", state.adminSelectedUser ? "admin.saveRepo" : "admin.selectUserButton");
  setText("admin-user-records-title", "admin.userConversations");
  setText("admin-user-jobs-title", "admin.userJobs");
  setText("admin-user-sessions-title", "admin.userSessions");
  setText("admin-auth-title", "admin.authenticationAudit");
  setText("modal-eyebrow", "common.notice");
  if (els.modalRoot) {
    els.modalRoot.querySelector(".modal-card")?.setAttribute("aria-label", t("common.notice"));
  }
  document.getElementById("language-switch")?.setAttribute("aria-label", t("controls.language"));
  document.getElementById("theme-switch")?.setAttribute("aria-label", t("controls.theme"));
  if (els.languageButtons[0]) {
    els.languageButtons[0].textContent = t("controls.languageZh");
  }
  if (els.languageButtons[1]) {
    els.languageButtons[1].textContent = t("controls.languageEn");
  }
  if (els.themeButtons[0]) {
    els.themeButtons[0].textContent = t("controls.themeLight");
  }
  if (els.themeButtons[1]) {
    els.themeButtons[1].textContent = t("controls.themeDark");
  }

  const setHeader = (selector, key) => {
    const element = document.querySelector(selector);
    if (element) {
      element.textContent = t(key);
    }
  };
  setHeader("#admin-users-section thead th:nth-child(1)", "table.user");
  setHeader("#admin-users-section thead th:nth-child(2)", "table.role");
  setHeader("#admin-users-section thead th:nth-child(3)", "table.activity");
  setHeader("#admin-users-section thead th:nth-child(4)", "table.lastLogin");
  setHeader("#admin-users-section thead th:nth-child(5)", "table.actions");
  setHeader("#admin-api-usage-title + .table-wrap thead th:nth-child(1)", "table.provider");
  setHeader("#admin-api-usage-title + .table-wrap thead th:nth-child(2)", "table.keys");
  setHeader("#admin-api-usage-title + .table-wrap thead th:nth-child(3)", "table.success");
  setHeader("#admin-api-usage-title + .table-wrap thead th:nth-child(4)", "table.failure");
  setHeader("#admin-api-usage-title + .table-wrap thead th:nth-child(5)", "table.cooldown");
  setHeader("#admin-api-usage-title + .table-wrap thead th:nth-child(6)", "table.inFlight");
  setHeader("#admin-api-usage-title + .table-wrap thead th:nth-child(7)", "table.lastUsed");
  setHeader("#admin-api-keys-section thead th:nth-child(1)", "table.provider");
  setHeader("#admin-api-keys-section thead th:nth-child(2)", "table.key");
  setHeader("#admin-api-keys-section thead th:nth-child(3)", "table.status");
  setHeader("#admin-api-keys-section thead th:nth-child(4)", "table.priority");
  setHeader("#admin-api-keys-section thead th:nth-child(5)", "table.weight");
  setHeader("#admin-api-keys-section thead th:nth-child(6)", "table.success");
  setHeader("#admin-api-keys-section thead th:nth-child(7)", "table.failure");
  setHeader("#admin-api-keys-section thead th:nth-child(8)", "table.cooldown");
  setHeader("#admin-api-keys-section thead th:nth-child(9)", "table.lastError");
  setHeader("#admin-auto-routing-section thead th:nth-child(1)", "table.type");
  setHeader("#admin-auto-routing-section thead th:nth-child(2)", "table.route");
  setHeader("#admin-auto-routing-section thead th:nth-child(3)", "table.state");
  setHeader("#admin-auto-routing-section thead th:nth-child(4)", "table.order");
  setHeader("#admin-auto-routing-section thead th:nth-child(5)", "table.actions");
  setHeader("#admin-auto-routing-section thead th:nth-child(6)", "table.cooldown");
  setHeader("#admin-dispatch-table thead th:nth-child(1)", "table.time");
  setHeader("#admin-dispatch-table thead th:nth-child(2)", "table.type");
  setHeader("#admin-dispatch-table thead th:nth-child(3)", "table.providerKey");
  setHeader("#admin-dispatch-table thead th:nth-child(4)", "table.model");
  setHeader("#admin-dispatch-table thead th:nth-child(5)", "table.userLabel");
  setHeader("#admin-dispatch-table thead th:nth-child(6)", "table.status");
  setHeader("#admin-dispatch-table thead th:nth-child(7)", "table.latency");
  setHeader("#admin-dispatch-table thead th:nth-child(8)", "table.error");
  setHeader("#admin-auth-section thead th:nth-child(1)", "table.time");
  setHeader("#admin-auth-section thead th:nth-child(2)", "table.user");
  setHeader("#admin-auth-section thead th:nth-child(3)", "table.event");
  setHeader("#admin-auth-section thead th:nth-child(4)", "table.ip");
  setHeader("#admin-auth-section thead th:nth-child(5)", "table.reason");
  renderQueuePill();
}

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
  return date.toLocaleString(normalizeLanguage(state.language));
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!value) {
    return "—";
  }
  if (value < 1000) {
    return normalizeLanguage(state.language) === "zh-CN" ? `${value} 毫秒` : `${value} ms`;
  }
  return normalizeLanguage(state.language) === "zh-CN"
    ? `${(value / 1000).toFixed(2)} 秒`
    : `${(value / 1000).toFixed(2)} s`;
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
      hint.dataset.defaultText ||= hint.textContent || t("common.clickToDownload");
      hint.textContent = t("common.preparingDownload");
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

function closeModal(result) {
  if (!modalState.resolve) {
    return;
  }

  const resolve = modalState.resolve;
  const previouslyFocused = modalState.previouslyFocused;
  modalState.resolve = null;
  modalState.options = null;
  modalState.previouslyFocused = null;
  els.modalRoot.classList.add("hidden");
  els.modalRoot.setAttribute("aria-hidden", "true");
  els.appShell.classList.remove("modal-open");
  els.modalError.classList.add("hidden");
  els.modalError.textContent = "";

  if (previouslyFocused && typeof previouslyFocused.focus === "function") {
    window.requestAnimationFrame(() => previouslyFocused.focus());
  }

  resolve(result);
}

function openModal(options = {}) {
  if (modalState.resolve) {
    closeModal(null);
  }

  const {
    eyebrow = "",
    title = t("common.notice"),
    message = "",
    confirmText = t("common.continue"),
    cancelText = t("common.cancel"),
    showCancel = true,
    tone = "default",
    input = null,
  } = options;

  els.modalEyebrow.textContent = eyebrow;
  els.modalEyebrow.classList.toggle("hidden", !eyebrow);
  els.modalTitle.textContent = title;
  els.modalMessage.textContent = message;
  els.modalCancelButton.textContent = cancelText;
  els.modalCancelButton.classList.toggle("hidden", !showCancel);
  els.modalConfirmButton.textContent = confirmText;
  els.modalConfirmButton.classList.toggle("modal-confirm-danger", tone === "danger");
  els.modalError.classList.add("hidden");
  els.modalError.textContent = "";

  if (input) {
    els.modalInputRow.classList.remove("hidden");
    els.modalInputLabel.textContent = input.label || t("common.value");
    els.modalInput.type = input.type || "text";
    els.modalInput.placeholder = input.placeholder || "";
    els.modalInput.value = input.value || "";
    els.modalInput.autocomplete = input.autocomplete || "off";
  } else {
    els.modalInputRow.classList.add("hidden");
    els.modalInput.type = "text";
    els.modalInput.value = "";
    els.modalInput.placeholder = "";
    els.modalInput.autocomplete = "off";
  }

  els.modalRoot.classList.remove("hidden");
  els.modalRoot.setAttribute("aria-hidden", "false");
  els.appShell.classList.add("modal-open");
  modalState.options = options;
  modalState.previouslyFocused = document.activeElement;

  return new Promise((resolve) => {
    modalState.resolve = resolve;
    window.requestAnimationFrame(() => {
      if (input) {
        els.modalInput.focus();
        els.modalInput.select();
        return;
      }
      els.modalConfirmButton.focus();
    });
  });
}

function showAlertDialog(message, options = {}) {
  return openModal({
    title: options.title || t("common.notice"),
    message: String(message || ""),
    confirmText: options.confirmText || t("common.close"),
    showCancel: false,
    tone: options.tone || "default",
  });
}

function showConfirmDialog(message, options = {}) {
  return openModal({
    title: options.title || t("common.confirm"),
    message: String(message || ""),
    confirmText: options.confirmText || t("common.continue"),
    cancelText: options.cancelText || t("common.cancel"),
    showCancel: true,
    tone: options.tone || "default",
  });
}

function showPromptDialog(message, options = {}) {
  return openModal({
    title: options.title || t("common.input"),
    message: String(message || ""),
    confirmText: options.confirmText || t("common.save"),
    cancelText: options.cancelText || t("common.cancel"),
    showCancel: true,
    tone: options.tone || "default",
    input: {
      label: options.inputLabel || t("common.value"),
      placeholder: options.placeholder || "",
      value: options.value || "",
      type: options.inputType || "text",
      autocomplete: options.autocomplete || "off",
    },
  });
}

function showErrorDialog(error, title = t("common.error")) {
  const message = error instanceof Error ? error.message : String(error || t("common.error"));
  return showAlertDialog(message, {
    title,
    tone: "danger",
  });
}

function hasActiveJobActivity() {
  return (
    state.jobs.some((job) => job.status === "pending" || job.status === "running") ||
    state.selectedJob?.status === "pending" ||
    state.selectedJob?.status === "running"
  );
}

function shouldPollJobs() {
  return Boolean(state.me) && (state.mode === "code" || hasActiveJobActivity());
}

function shouldPollAdminOverview() {
  return Boolean(state.me) && state.mode === "admin";
}

function clearPollTimers() {
  if (jobsPollTimer) {
    window.clearTimeout(jobsPollTimer);
    jobsPollTimer = 0;
  }
  if (adminPollTimer) {
    window.clearTimeout(adminPollTimer);
    adminPollTimer = 0;
  }
}

function scheduleJobsPoll(delay = hasActiveJobActivity() ? JOB_POLL_INTERVAL_MS : IDLE_JOB_POLL_INTERVAL_MS) {
  if (jobsPollTimer) {
    window.clearTimeout(jobsPollTimer);
    jobsPollTimer = 0;
  }
  if (!shouldPollJobs()) {
    return;
  }
  jobsPollTimer = window.setTimeout(async () => {
    jobsPollTimer = 0;
    if (document.visibilityState === "hidden") {
      return;
    }
    await refreshJobs().catch(() => {});
  }, delay);
}

function scheduleAdminPoll(delay = ADMIN_POLL_INTERVAL_MS) {
  if (adminPollTimer) {
    window.clearTimeout(adminPollTimer);
    adminPollTimer = 0;
  }
  if (!shouldPollAdminOverview()) {
    return;
  }
  adminPollTimer = window.setTimeout(async () => {
    adminPollTimer = 0;
    if (document.visibilityState === "hidden") {
      return;
    }
    await refreshAdminOverview().catch(() => {});
  }, delay);
}

function syncPolling() {
  scheduleJobsPoll();
  scheduleAdminPoll();
}

function codeBlockLanguage(code) {
  const match = String(code.className || "").match(/language-([a-z0-9_-]+)/i);
  if (!match) {
    return normalizeLanguage(state.language) === "zh-CN" ? "文本" : "Text";
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
    button.textContent = t("common.copy");
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
      button.textContent = t("common.copy");
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
    throw new Error(normalizeLanguage(state.language) === "zh-CN" ? "需要登录。" : "Authentication required.");
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
    throw new Error(normalizeLanguage(state.language) === "zh-CN" ? "需要登录。" : "Authentication required.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error(t("chat.streamingUnsupported"));
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

function scheduleMessagesRender({ patchLastOnly = true } = {}) {
  messageRenderPatchLastOnly = messageRenderPatchLastOnly || patchLastOnly;
  if (messageRenderFrame) {
    return;
  }
  messageRenderFrame = window.requestAnimationFrame(() => {
    const shouldPatchLastOnly = messageRenderPatchLastOnly;
    messageRenderFrame = 0;
    messageRenderPatchLastOnly = false;
    renderMessages({ patchLastOnly: shouldPatchLastOnly });
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
  els.loginSubmitButton.textContent = registerMode ? t("auth.createAccount") : t("auth.enterStation");
  els.loginPanelTitle.textContent = registerMode ? t("auth.createAccount") : t("auth.enter");
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
  clearPollTimers();
  state.me = null;
  state.chat = null;
  state.capabilities = null;
  state.adminOverview = null;
  state.queueStats = null;
  state.conversations = [];
  state.selectedConversationId = null;
  state.messages = [];
  state.jobs = [];
  state.selectedJobId = null;
  state.selectedJob = null;
  state.selectedJobLogText = "";
  state.adminSelectedUserId = null;
  state.adminSelectedUser = null;
  state.adminSelectedUserConversations = [];
  state.adminSelectedUserJobs = [];
  state.adminSelectedUserSessions = [];
  state.adminUserSearch = "";
  els.loginScreen.classList.remove("hidden");
  els.appScreen.classList.add("hidden");
  renderAuthMode();
  renderQueuePill();
}

function showApp() {
  els.loginScreen.classList.add("hidden");
  els.appScreen.classList.remove("hidden");
  syncPolling();
}

function renderQueuePill() {
  const running = Number(state.queueStats?.running || 0);
  const concurrency = Number(state.queueStats?.concurrency || 0);
  els.queuePill.textContent =
    running > 0 || concurrency > 0
      ? t("code.queueRunning", { running, concurrency })
      : t("code.queueIdle");
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
    option.textContent = provider.id === "auto" && model === "auto"
      ? (normalizeLanguage(state.language) === "zh-CN" ? "自动" : "Auto")
      : model;
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
    emptyOption.textContent = t("chat.noProviderConfigured");
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
  if (mode === "code" && state.me) {
    refreshJobs().catch(() => {});
  }
  syncPolling();
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
                title="${escapeHtml(`${t("common.clickToDownload")} ${displayName}`)}"
              >
                <img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(displayName)}" loading="lazy" />
                <span>${escapeHtml(label)}</span>
                <em class="attachment-download-hint">${escapeHtml(t("common.clickToDownload"))}</em>
              </a>
            `;
          }
          return `
            <a
              class="attachment-card"
              href="${escapeHtml(attachment.url)}"
              download="${escapeHtml(attachment.name || displayName)}"
              title="${escapeHtml(`${t("common.clickToDownload")} ${displayName}`)}"
            >
              <strong>${escapeHtml(displayName)}</strong>
              <span>${escapeHtml(label)}</span>
              <em class="attachment-download-hint">${escapeHtml(t("common.clickToDownload"))}</em>
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
          <button type="button" class="attachment-remove" data-kind="${kind}" data-index="${index}">${escapeHtml(t("common.remove"))}</button>
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
    els.conversationList.innerHTML = `<div class="empty-state">${escapeHtml(t("chat.noChats"))}</div>`;
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
        <span>${escapeHtml(formatDateTime(conversation.updatedAt))}</span>
        ${conversation.isPinned ? `<span class="pin-pill">${escapeHtml(t("chat.pinned"))}</span>` : ""}
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
    els.chatPinButton.textContent = t("chat.pin");
    els.chatDeleteButton.textContent = t("chat.delete");
    return;
  }

  els.chatPinButton.textContent = conversation.isPinned ? t("chat.unpin") : t("chat.pin");
  els.chatDeleteButton.textContent = t("chat.delete");
}

function renderMessageBody(message) {
  const content = message.content || (message.isStreaming ? t("chat.thinking") : "");
  if (message.role === "assistant" && !message.isError) {
    const html = renderMarkdown(content) || `<p>${escapeHtml(content || t("chat.thinking"))}</p>`;
    return `<div class="message-body message-markdown">${html}</div>`;
  }
  return `<div class="message-body plain">${escapeHtml(content)}</div>`;
}

function messageMetaText(message) {
  return [
    message.providerLabel || "",
    message.isStreaming ? t("chat.streamingMeta") : "",
    message.isError ? t("chat.failedMeta") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function applyMessageNode(node, message) {
  node.dataset.messageId = message.id || "";
  node.className = `message ${message.role}`;
  if (message.isStreaming) {
    node.classList.add("streaming");
  }
  if (message.isError) {
    node.classList.add("error");
  }
  const content = message.content || (message.isStreaming ? t("chat.thinking") : "");
  const meta = messageMetaText(message);
  const visibleAttachments = visibleMessageAttachments(message);
  node.innerHTML = `
    ${renderMessageBody({ ...message, content })}
    ${meta ? `<div class="message-meta">${escapeHtml(meta)}</div>` : ""}
    ${attachmentMarkup(visibleAttachments, "message")}
  `;
  enhanceMarkdownBlocks(node);
}

function renderMessageNode(message) {
  const node = document.createElement("article");
  applyMessageNode(node, message);
  return node;
}

function shouldStickMessagesToBottom() {
  const remaining = els.chatMessages.scrollHeight - els.chatMessages.scrollTop - els.chatMessages.clientHeight;
  return remaining < 64;
}

function patchLastMessage() {
  if (state.messages.length === 0) {
    renderMessages();
    return;
  }

  if (
    els.chatMessages.classList.contains("empty-state") ||
    els.chatMessages.children.length !== state.messages.length
  ) {
    renderMessages();
    return;
  }

  const lastMessage = state.messages[state.messages.length - 1];
  const node = els.chatMessages.lastElementChild;
  if (!node || node.dataset.messageId !== (lastMessage.id || "")) {
    renderMessages();
    return;
  }

  const stickToBottom = shouldStickMessagesToBottom() || Boolean(lastMessage.isStreaming);
  applyMessageNode(node, lastMessage);
  renderConversationActions();
  if (stickToBottom) {
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }
}

function renderMessages(options = {}) {
  const patchLastOnly = options.patchLastOnly === true;
  if (patchLastOnly) {
    patchLastMessage();
    return;
  }

  els.chatMessages.innerHTML = "";
  if (state.messages.length === 0) {
    els.chatMessages.className = "message-stream empty-state";
    els.chatMessages.textContent = t("chat.start");
    renderConversationActions();
    return;
  }

  els.chatMessages.className = "message-stream";
  for (const message of state.messages) {
    els.chatMessages.append(renderMessageNode(message));
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
  els.chatSubmitButton.textContent = isPending ? t("chat.streaming") : t("chat.send");
}

function jobTitle(job) {
  const trimmed = String(job.prompt || "").trim();
  if (trimmed) {
    return trimmed;
  }
  if (job.attachments?.length) {
    return `${t("code.attachmentsTitle")}: ${job.attachments[0].name}${job.attachments.length > 1 ? "…" : ""}`;
  }
  return t("code.untitledJob");
}

function findJobById(jobId) {
  return state.jobs.find((job) => job.id === jobId) || null;
}

function renderJobs() {
  els.jobList.innerHTML = "";
  if (state.jobs.length === 0) {
    els.jobList.innerHTML = `<div class="empty-state">${escapeHtml(t("code.noJobs"))}</div>`;
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
        ${job.isPinned ? `<span class="pin-pill">${escapeHtml(t("chat.pinned"))}</span>` : ""}
        <span class="status-pill ${job.status}">${escapeHtml(translateStatus(job.status))}</span>
        <span>${escapeHtml(formatDateTime(job.createdAt))}</span>
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
    els.jobPinButton.textContent = t("code.pin");
    els.jobDeleteButton.textContent = t("code.delete");
    els.jobDeleteButton.disabled = false;
    els.jobDeleteButton.title = "";
    return;
  }

  els.jobActions.classList.remove("hidden");
  els.jobPinButton.textContent = job.isPinned ? t("code.unpin") : t("code.pin");
  els.jobDeleteButton.textContent = t("code.delete");
  const isRunning = job.status === "running";
  els.jobDeleteButton.disabled = isRunning;
  els.jobDeleteButton.title = isRunning ? t("code.runningDeleteBlocked") : "";
}

function renderJobDetail() {
  if (!state.selectedJob) {
    els.jobTitle.textContent = t("code.noJobSelected");
    els.jobDetail.className = "job-detail empty-state";
    els.jobDetail.textContent = t("code.selectJob");
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
      <h4>${escapeHtml(t("code.status"))}</h4>
      <p class="job-status-line">
        <span class="status-pill ${job.status}">${escapeHtml(translateStatus(job.status))}</span>
      </p>
      <pre>${escapeHtml(job.errorText || job.finalMessage || t("code.noOutputYet"))}</pre>
    </div>
  `);

  if (job.attachments?.length) {
    sections.push(`
      <div class="job-section">
        <h4>${escapeHtml(t("code.inputFiles"))}</h4>
        ${attachmentMarkup(job.attachments)}
      </div>
    `);
  }

  if (job.outputFiles?.length) {
    sections.push(`
      <div class="job-section">
        <h4>${escapeHtml(t("code.outputFiles"))}</h4>
        ${attachmentMarkup(job.outputFiles)}
      </div>
    `);
  }

  if (job.status === "pending" || job.status === "running" || state.selectedJobLogText) {
    sections.push(`
      <div class="job-section">
        <h4>${escapeHtml(job.status === "pending" ? t("code.queue") : t("code.liveOutput"))}</h4>
        ${job.status === "pending" ? `<p class="job-meta">${escapeHtml(t("code.waitingForWorker"))}</p>` : ""}
        <pre>${escapeHtml(state.selectedJobLogText || (job.status === "running" ? t("code.waitingForLiveOutput") : t("code.queued")))}</pre>
      </div>
    `);
  }

  if (job.gitStatusText) {
    sections.push(`
      <div class="job-section">
        <h4>${escapeHtml(t("code.changedFiles"))}</h4>
        <pre>${escapeHtml(job.gitStatusText)}</pre>
      </div>
    `);
  }

  if (job.diffText || job.diffStat) {
    sections.push(`
      <div class="job-section">
        <h4>${escapeHtml(t("code.diff"))}</h4>
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

function setAdminRepoFormDisabled(disabled) {
  els.adminUserRepoUrlInput.disabled = disabled;
  els.adminUserRepoPathInput.disabled = disabled;
  els.adminUserRepoBranchInput.disabled = disabled;
  els.adminUserRepoSaveButton.disabled = disabled;
  els.adminUserRepoSaveButton.textContent = disabled ? t("admin.selectUserButton") : t("admin.saveRepo");
}

function renderAdminUserRecords() {
  if (!state.me?.isAdmin) {
    return;
  }

  if (!state.adminSelectedUser) {
    els.adminUserRepoTitle.textContent = t("admin.codeRepository");
    els.adminUserRepoUrlInput.value = "";
    els.adminUserRepoPathInput.value = "";
    els.adminUserRepoBranchInput.value = "main";
    setAdminRepoFormDisabled(true);
    els.adminUserRecordsTitle.textContent = t("admin.userConversations");
    els.adminUserConversations.className = "admin-user-records empty-state";
    els.adminUserConversations.textContent = t("admin.selectUser");
    els.adminUserJobsTitle.textContent = t("admin.userJobs");
    els.adminUserJobs.className = "admin-user-records empty-state";
    els.adminUserJobs.textContent = t("admin.selectUser");
    els.adminUserSessionsTitle.textContent = t("admin.userSessions");
    els.adminUserSessions.className = "admin-user-records empty-state";
    els.adminUserSessions.textContent = t("admin.selectUser");
    return;
  }

  els.adminUserRepoTitle.textContent = t("admin.repositoryFor", {
    displayName: state.adminSelectedUser.displayName,
  });
  els.adminUserRepoUrlInput.value = state.adminSelectedUser.repoUrl || "";
  els.adminUserRepoPathInput.value = state.adminSelectedUser.repoLocalPath || "";
  els.adminUserRepoBranchInput.value = state.adminSelectedUser.repoDefaultBranch || "main";
  setAdminRepoFormDisabled(false);
  els.adminUserRecordsTitle.textContent = t("admin.conversationsFor", {
    displayName: state.adminSelectedUser.displayName,
    username: state.adminSelectedUser.username,
  });
  els.adminUserJobsTitle.textContent = t("admin.jobsFor", {
    displayName: state.adminSelectedUser.displayName,
  });
  els.adminUserSessionsTitle.textContent = t("admin.sessionsFor", {
    displayName: state.adminSelectedUser.displayName,
  });

  if (!state.adminSelectedUserConversations.length) {
    els.adminUserConversations.className = "admin-user-records empty-state";
    els.adminUserConversations.textContent = t("admin.noChatHistory");
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
              <span>${escapeHtml(t("admin.messageCount", { count: String(conversation.messages?.length || 0) }))}</span>
            </div>
            <div class="admin-record-stream">
              ${
                conversation.messages?.length
                  ? conversation.messages
                      .map((message) => {
                        const attachmentText = message.attachments?.length
                          ? `<div class="table-subline">${escapeHtml(t("admin.attachments", { files: message.attachments.map((attachment) => attachment.label || attachment.name).join(", ") }))}</div>`
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
                  : `<div class="table-empty">${escapeHtml(t("admin.noMessagesRecorded"))}</div>`
              }
            </div>
          </article>
        `,
      )
      .join("");
  }

  if (!state.adminSelectedUserJobs.length) {
    els.adminUserJobs.className = "admin-user-records empty-state";
    els.adminUserJobs.textContent = t("admin.noJobs");
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
            <span class="status-pill ${escapeHtml(job.status)}">${escapeHtml(translateStatus(job.status))}</span>
          </div>
          <div class="admin-record-stream">
            <div class="admin-record-message assistant">
              <div class="admin-record-meta">
                <span>${escapeHtml(job.branchName || t("admin.noBranch"))}</span>
                <span>${escapeHtml(job.finishedAt ? formatDateTime(job.finishedAt) : t("admin.inProgress"))}</span>
                ${job.diffStat ? `<span>${escapeHtml(job.diffStat)}</span>` : ""}
              </div>
              <pre>${escapeHtml(job.finalMessage || job.errorText || job.commandPreview || t("admin.noOutput"))}</pre>
            </div>
          </div>
        </article>
      `,
      )
      .join("");
  }

  if (!state.adminSelectedUserSessions.length) {
    els.adminUserSessions.className = "admin-user-records empty-state";
    els.adminUserSessions.textContent = t("admin.noActiveSessions");
    return;
  }

  els.adminUserSessions.className = "admin-user-records";
  els.adminUserSessions.innerHTML = state.adminSelectedUserSessions
    .map(
      (session) => `
        <article class="admin-record-card">
          <div class="admin-record-header">
            <div>
              <h5>${escapeHtml(session.ipAddress || t("common.unknownIp"))}</h5>
              <p>${escapeHtml(formatDateTime(session.lastSeenAt || session.createdAt))}</p>
            </div>
            ${session.isCurrent ? `<span class="pin-pill">${escapeHtml(t("common.current"))}</span>` : ""}
          </div>
          <div class="admin-record-stream">
            <div class="admin-record-message assistant">
              <div class="admin-record-meta">
                <span>${escapeHtml(formatDateTime(session.createdAt))}</span>
                <span>${escapeHtml(formatDateTime(session.expiresAt))}</span>
              </div>
              <pre>${escapeHtml(session.userAgent || t("common.unknownAgent"))}</pre>
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
  els.adminUserRepoSection.classList.toggle("hidden", !isAdmin);
  els.adminUserRecordsSection.classList.toggle("hidden", !isAdmin);
  els.adminUserJobsSection.classList.toggle("hidden", !isAdmin);
  els.adminUserSessionsSection.classList.toggle("hidden", !isAdmin);
  els.adminAuthSection.classList.toggle("hidden", !isAdmin);
  els.adminApiKeysSection.classList.toggle("hidden", !isAdmin);
  els.adminAutoRoutingSection.classList.toggle("hidden", !isAdmin);

  if (!overview) {
    els.adminSummary.innerHTML = "";
    renderTableEmptyBody(els.adminProviderUsageTable, 7, t("admin.noApiUsageLoaded"));
    renderTableEmptyBody(els.adminApiKeyTable, 9, t("admin.noAdminDataLoaded"));
    renderTableEmptyBody(els.adminAutoRoutingTable, 6, t("admin.noAutoRoutingLoaded"));
    renderTableEmptyBody(els.adminDispatchTable, 8, t("admin.noDispatchYet"));
    if (isAdmin) {
      renderTableEmptyBody(els.adminUsersTable, 5, t("admin.noUsersLoaded"));
      renderTableEmptyBody(els.adminAuthTable, 5, t("admin.noAuthAuditYet"));
      renderAdminUserRecords();
    }
    return;
  }

  const summary = overview.summary || {};
  const usage = overview.apiUsage || {};
  els.adminSummary.innerHTML = `
    <article class="metric-card">
      <span>${escapeHtml(t("admin.configuredProviders"))}</span>
      <strong>${escapeHtml(String(summary.configuredProviders || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>${escapeHtml(t("admin.configuredApiKeys"))}</span>
      <strong>${escapeHtml(String(summary.configuredApiKeys || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>${escapeHtml(t("admin.apiSuccesses"))}</span>
      <strong>${escapeHtml(String(usage.totalSuccessCount || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>${escapeHtml(t("admin.apiFailures"))}</span>
      <strong>${escapeHtml(String(usage.totalFailureCount || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>${escapeHtml(t("admin.recentDispatches"))}</span>
      <strong>${escapeHtml(String(usage.recentDispatches || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>${escapeHtml(t("admin.activeUsers"))}</span>
      <strong>${escapeHtml(String(usage.activeUsers || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>${escapeHtml(t("admin.cooldownKeys"))}</span>
      <strong>${escapeHtml(String(usage.cooldownKeys || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>${escapeHtml(t("admin.usersMetric"))}</span>
      <strong>${escapeHtml(String(summary.users || 0))}</strong>
    </article>
    <article class="metric-card">
      <span>${escapeHtml(t("admin.codeQueue"))}</span>
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
    renderTableEmptyBody(els.adminProviderUsageTable, 7, t("admin.noApiUsageYet"));
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
    renderTableEmptyBody(els.adminApiKeyTable, 9, t("admin.noApiKeysConfigured"));
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
            <td><span class="status-pill ${escapeHtml(apiKey.status)}">${escapeCell(translateStatus(apiKey.status))}</span></td>
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
            <td>${escapeCell(apiKey.cooldownUntil ? formatDateTime(apiKey.cooldownUntil) : t("common.active"))}</td>
            <td>${escapeCell(apiKey.lastError, "—")}</td>
          </tr>
        `,
      )
      .join("");
  }

  const autoRouteGroups = autoRouteGroupsForDisplay();
  const autoRouteTypes = Object.keys(autoRouteGroups);
  if (!autoRouteTypes.length) {
    renderTableEmptyBody(els.adminAutoRoutingTable, 6, t("admin.autoModeNotConfigured"));
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
              ${
                isAdmin
                  ? `<label class="table-toggle">
                      <input class="table-checkbox" data-field="enabled" type="checkbox" ${route.enabled ? "checked" : ""} />
                      <span>${escapeCell(route.enabled ? t("common.on") : t("common.off"))}</span>
                    </label>`
                  : `<span class="table-readonly">${escapeCell(route.enabled ? t("common.on") : t("common.off"))}</span>`
              }
            </td>
            <td><span class="rank-pill">${escapeHtml(rankLabel(index))}</span></td>
            <td>
              ${
                isAdmin
                  ? `<div class="admin-table-actions">
                      <button type="button" class="ghost-button compact-button" data-action="route-up" ${index === 0 ? "disabled" : ""}>${escapeHtml(t("actions.up"))}</button>
                      <button type="button" class="ghost-button compact-button" data-action="route-down" ${index === routes.length - 1 ? "disabled" : ""}>${escapeHtml(t("actions.down"))}</button>
                    </div>`
                  : `<span class="table-readonly">${escapeHtml(t("common.adminOnly"))}</span>`
              }
            </td>
            <td>${escapeCell(route.cooldownUntil ? formatDateTime(route.cooldownUntil) : t("common.active"))}</td>
          </tr>
        `);
      })
      .join("");
  }

  if (!overview.dispatchEvents?.length) {
    renderTableEmptyBody(els.adminDispatchTable, 8, t("admin.noDispatchEventsRecorded"));
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
            <td><span class="status-pill ${escapeHtml(event.status)}">${escapeCell(translateStatus(event.status))}</span></td>
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
      renderTableEmptyBody(els.adminUsersTable, 5, state.adminUserSearch ? t("admin.noMatchingUsers") : t("admin.noUsersFound"));
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
                <strong>${escapeCell(user.isAdmin ? t("admin.roleAdmin") : t("admin.member"))}</strong>
                ${locked ? `<div class="table-subline">${escapeHtml(t("admin.locked"))}</div>` : ""}
              </td>
              <td>${escapeCell(t("admin.activitySummary", { chats: user.conversationCount || 0, jobs: user.jobCount || 0, sessions: user.sessionCount || 0 }))}</td>
              <td>${escapeCell(user.lastLoginAt ? formatDateTime(user.lastLoginAt) : t("common.never"))}</td>
              <td>
                <div class="admin-user-actions">
                  <button type="button" class="ghost-button compact-button" data-action="view" data-user-id="${escapeHtml(user.id)}">${escapeHtml(t("admin.open"))}</button>
                  <button
                    type="button"
                    class="ghost-button compact-button"
                    data-action="unlock"
                    data-user-id="${escapeHtml(user.id)}"
                    ${locked ? "" : "disabled"}
                  >${escapeHtml(t("admin.unlock"))}</button>
                  <button
                    type="button"
                    class="ghost-button compact-button"
                    data-action="signout"
                    data-user-id="${escapeHtml(user.id)}"
                    ${protectedUser ? "disabled" : ""}
                  >${escapeHtml(t("admin.signOut"))}</button>
                  <button type="button" class="ghost-button compact-button" data-action="password" data-user-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}">${escapeHtml(t("admin.password"))}</button>
                  <button
                    type="button"
                    class="ghost-button compact-button"
                    data-action="role"
                    data-user-id="${escapeHtml(user.id)}"
                    data-is-admin="${user.isAdmin ? "1" : "0"}"
                    ${protectedUser ? "disabled" : ""}
                  >${escapeHtml(user.isAdmin ? t("admin.revokeAdmin") : t("admin.makeAdmin"))}</button>
                  <button
                    type="button"
                    class="ghost-button compact-button danger-button"
                    data-action="delete"
                    data-user-id="${escapeHtml(user.id)}"
                    data-username="${escapeHtml(user.username)}"
                    ${protectedUser ? "disabled" : ""}
                  >${escapeHtml(t("admin.delete"))}</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    if (!overview.authEvents?.length) {
      renderTableEmptyBody(els.adminAuthTable, 5, t("admin.noAuthAuditYet"));
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
    syncPolling();
    return;
  }

  if (adminOverviewRefreshPromise) {
    return adminOverviewRefreshPromise;
  }

  adminOverviewRefreshPromise = (async () => {
    const payload = await api("/api/admin/overview");
    state.adminOverview = payload;
    renderAdminOverview();
  })();

  try {
    await adminOverviewRefreshPromise;
  } finally {
    adminOverviewRefreshPromise = null;
    syncPolling();
  }
}

async function bootstrap() {
  setBooting(true);
  try {
    const payload = await api("/api/me");
    state.me = payload.user;
    state.chat = payload.chat;
    state.capabilities = payload.capabilities;
    state.queueStats = payload.queue || null;
    applyLanguage(payload.user.language || state.language, {
      persist: true,
      syncUser: false,
      rerender: false,
    });
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
    els.chatTitle.textContent = t("chat.selectConversation");
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
    body: JSON.stringify({ title: t("chat.newConversationTitle") }),
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
    content:
      content ||
      t("chat.sentAttachments", {
        count: attachments.length,
        suffix: attachments.length === 1 ? "" : "s",
      }),
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
          streamError = event.error || t("chat.messageFailed");
          placeholderMessage.isStreaming = false;
          placeholderMessage.isError = true;
          placeholderMessage.content = placeholderMessage.content || streamError;
          scheduleMessagesRender();
          return;
        }

        if (event.type === "done") {
          placeholderMessage.isStreaming = false;
          scheduleMessagesRender();
        }
      },
    );
  } catch (error) {
    placeholderMessage.isStreaming = false;
    placeholderMessage.isError = true;
    placeholderMessage.content = placeholderMessage.content || error.message;
    renderMessages({ patchLastOnly: true });
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
  if (!state.me) {
    state.jobs = [];
    state.selectedJobId = null;
    state.selectedJob = null;
    state.selectedJobLogText = "";
    renderJobs();
    renderJobDetail();
    syncPolling();
    return;
  }
  if (jobsRefreshInFlight) {
    return;
  }
  jobsRefreshInFlight = true;
  try {
    const payload = await api("/api/code/jobs");
    state.jobs = payload.jobs;
    state.queueStats = payload.queue || null;
    renderQueuePill();
    if (!state.selectedJobId && state.jobs[0]) {
      state.selectedJobId = state.jobs[0].id;
    } else if (state.selectedJobId && !state.jobs.some((job) => job.id === state.selectedJobId)) {
      state.selectedJobId = state.jobs[0]?.id || null;
    }
    renderJobs();
    if (state.selectedJobId) {
      state.selectedJob = findJobById(state.selectedJobId);
      if (!state.selectedJob) {
        state.selectedJobLogText = "";
        renderJobDetail();
      } else if (state.selectedJob.status === "pending" || state.selectedJob.status === "running") {
        await loadJobLog(state.selectedJob.id);
      } else {
        state.selectedJobLogText = "";
        renderJobDetail();
      }
    } else {
      state.selectedJob = null;
      state.selectedJobLogText = "";
      renderJobDetail();
    }
  } finally {
    jobsRefreshInFlight = false;
    syncPolling();
  }
}

async function selectJob(jobId) {
  state.selectedJobId = jobId;
  state.selectedJob = findJobById(jobId);
  renderJobs();
  if (!state.selectedJob) {
    const payload = await api(`/api/code/jobs/${jobId}`);
    state.selectedJob = payload.job;
  }
  if (state.selectedJob.status === "pending" || state.selectedJob.status === "running") {
    await loadJobLog(jobId);
  } else {
    state.selectedJobLogText = "";
    renderJobDetail();
  }
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

async function saveAdminUserRepoBinding() {
  if (!state.adminSelectedUserId) {
    return;
  }

  await updateAdminUser(state.adminSelectedUserId, {
    repoUrl: String(els.adminUserRepoUrlInput.value || "").trim(),
    repoLocalPath: String(els.adminUserRepoPathInput.value || "").trim(),
    repoDefaultBranch: String(els.adminUserRepoBranchInput.value || "").trim() || "main",
  });
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
      throw new Error(t("auth.passwordsMismatch"));
    }

    await api(state.authMode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password,
        language: state.language,
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
    return showErrorDialog(error, t("admin.refreshFailed"));
  });
});

els.adminDispatchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveDispatchSettings().catch((error) => {
    return showErrorDialog(error, t("admin.saveFailed"));
  });
});

els.adminRoutingResetButton?.addEventListener("click", async () => {
  const confirmed = await showConfirmDialog(t("admin.resetRoutingPrompt"), {
    title: t("admin.resetRoutingTitle"),
    confirmText: t("admin.reset"),
    tone: "danger",
  });
  if (!confirmed) {
    return;
  }
  await resetRoutingConfig().catch((error) => {
    return showErrorDialog(error, t("admin.resetFailed"));
  });
});

els.adminAutoRoutingTable?.addEventListener("change", async (event) => {
  if (!state.me?.isAdmin) {
    return;
  }
  const input = event.target.closest('input[data-field="enabled"]');
  if (!input) {
    return;
  }
  const row = input.closest("tr[data-route-type][data-route-id]");
  if (!row) {
    return;
  }
  await setAutoRouteEnabled(row.dataset.routeType, row.dataset.routeId, input.checked).catch((error) => {
    return showErrorDialog(error, t("admin.updateFailed"));
  });
});

els.adminAutoRoutingTable?.addEventListener("click", async (event) => {
  if (!state.me?.isAdmin) {
    return;
  }
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
    await showErrorDialog(error, t("admin.updateFailed"));
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
      const confirmed = await showConfirmDialog(t("admin.signOutPrompt", { username }), {
        title: t("admin.signOutTitle"),
        confirmText: t("admin.signOut"),
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
      await revokeAdminUserSessions(userId);
      return;
    }
    if (action === "password") {
      const nextPassword = await showPromptDialog(t("admin.changePasswordPrompt", { username }), {
        title: t("admin.changePasswordTitle"),
        confirmText: t("admin.savePassword"),
        inputLabel: t("admin.newPassword"),
        inputType: "password",
        autocomplete: "new-password",
      });
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
      const confirmed = await showConfirmDialog(t("admin.deleteUserPrompt", { username }), {
        title: t("admin.deleteUserTitle"),
        confirmText: t("admin.delete"),
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
      await deleteAdminUser(userId);
    }
  } catch (error) {
    await showErrorDialog(error, t("admin.userUpdateFailed"));
  }
});

els.adminUserSearchInput?.addEventListener("input", () => {
  state.adminUserSearch = String(els.adminUserSearchInput.value || "");
  renderAdminOverview();
});

els.adminUserRepoForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.adminSelectedUserId) {
    return;
  }
  try {
    await saveAdminUserRepoBinding();
  } catch (error) {
    await showErrorDialog(error, t("admin.saveFailed"));
  }
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
    return showErrorDialog(error, t("admin.updateFailed"));
  });
});

els.chatDeleteButton.addEventListener("click", async () => {
  const conversation = selectedConversation();
  if (!conversation) {
    return;
  }
  const confirmed = await showConfirmDialog(t("chat.deletePrompt", { title: conversation.title }), {
    title: t("chat.deleteTitle"),
    confirmText: t("chat.delete"),
    tone: "danger",
  });
  if (!confirmed) {
    return;
  }
  await deleteConversation(conversation.id).catch((error) => {
    return showErrorDialog(error, t("chat.deleteTitle"));
  });
});

els.jobPinButton.addEventListener("click", async () => {
  const job = state.selectedJob;
  if (!job) {
    return;
  }
  await setJobPinned(job.id, !job.isPinned).catch((error) => {
    return showErrorDialog(error, t("admin.updateFailed"));
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
  const confirmed = await showConfirmDialog(t("code.deletePrompt", { title: jobTitle(job) }), {
    title: t("code.deleteTitle"),
    confirmText: t("code.delete"),
    tone: "danger",
  });
  if (!confirmed) {
    return;
  }
  await deleteJob(job.id).catch((error) => {
    return showErrorDialog(error, t("code.deleteTitle"));
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
    setCopyButtonState(button, t("common.copied"));
  } catch {
    setCopyButtonState(button, t("common.copyFailed"));
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

els.modalCancelButton?.addEventListener("click", () => {
  closeModal(null);
});

els.modalConfirmButton?.addEventListener("click", () => {
  if (els.modalInputRow.classList.contains("hidden")) {
    closeModal(true);
    return;
  }
  closeModal(els.modalInput.value);
});

els.modalRoot?.addEventListener("click", (event) => {
  if (event.target.closest("[data-modal-dismiss='1']")) {
    closeModal(null);
  }
});

document.addEventListener("keydown", (event) => {
  if (!modalState.resolve) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal(null);
    return;
  }
  if (event.key === "Enter" && document.activeElement === els.modalInput) {
    event.preventDefault();
    closeModal(els.modalInput.value);
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    syncPolling();
  }
});

for (const button of els.themeButtons) {
  button.addEventListener("click", () => {
    applyThemeMode(button.dataset.themeMode || "light");
  });
}

for (const button of els.languageButtons) {
  button.addEventListener("click", () => {
    applyLanguage(button.dataset.languageMode || "en");
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
    return showErrorDialog(error, t("chat.messageFailed"));
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
    return showErrorDialog(error, t("code.queueFailed"));
  });
});

for (const button of els.modeButtons) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}

for (const button of els.authModeButtons) {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
}

renderAuthMode();
applyStaticTranslations();
applyLanguage(state.language, { persist: false, syncUser: false, rerender: false });
applyThemeMode(state.themeMode, { persist: false });
bootstrap();
