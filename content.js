// Runs inside your chatgpt.com tab. It is the ONLY code that talks to ChatGPT.
//
// Safety: it can do exactly these kinds of thing, and refuses everything else:
//   1. Read (GET) the addresses listed in ALLOWED_READ_PATHS.
//   2. Archive one chat at a time, always sending the same fixed instruction.
//   3. Move one chat at a time into a project, sending only that project's ID.
//   4. Create one project, sending only its name and fixed default settings.
//   5. Delete one chat at a time. The organizer page only asks for this after
//      asking you about any chat with no up-to-date backup (see deleteChats in api.js).
//   6. Rename or restore one chat at a time.
//   7. Tell the organizer page which account is logged in: its IDs, name and email.
// No other part of the extension can ask for a different kind of change.
//
// Your login token stays in this file's memory: it is never saved and never
// passed to the rest of the extension.
(() => {
  const ALLOWED_READ_PATHS = [
    /^\/backend-api\/conversations\?/,
    /^\/backend-api\/gizmos\/snorlax\/sidebar\?/,
    /^\/backend-api\/gizmos\/[A-Za-z0-9_-]+\/conversations\?/,
    /^\/backend-api\/conversations\/[A-Za-z0-9-]{8,64}\?num_turns=/,
    /^\/backend-api\/conversations\/[A-Za-z0-9-]{8,64}\/messages\?before=/,
  ];
  const CHAT_ID = /^[A-Za-z0-9-]{8,64}$/;
  const PROJECT_ID = /^g-p-[A-Za-z0-9_-]{1,64}$/;
  const OWNER_ID = /^user-[A-Za-z0-9_-]{1,64}$/;
  const MAX_PROJECT_NAME_LENGTH = 100;
  const SINGLE_CHAT_READ = /^\/backend-api\/conversations\/[A-Za-z0-9-]{8,64}(\?num_turns=|\/messages\?before=)/;

  let accessToken = null;

  async function refreshToken() {
    accessToken = null;
    try {
      const response = await fetch(`${location.origin}/api/auth/session`, {
        credentials: "include",
      });
      if (response.ok) {
        const session = await response.json();
        accessToken = session.accessToken || null;
      }
    } catch {
      // Carry on without a token. ChatGPT will say if it needs one.
    }
  }

  // Reads the session fresh each time, so switching accounts is noticed. Only these four
  // fields leave this file, and the login token is never one of them.
  async function readAccount() {
    const response = await fetch(`${location.origin}/api/auth/session`, { credentials: "include" });
    if (!response.ok) return { ok: false, status: response.status };
    const session = await response.json();
    accessToken = session.accessToken || null;
    const text = (value) => (typeof value === "string" ? value : "");
    return {
      ok: true,
      status: response.status,
      data: {
        id: text(session.user?.id),
        workspaceId: text(session.account?.id),
        name: text(session.user?.name),
        email: text(session.user?.email),
      },
    };
  }

  function send(path, method, body, extraHeaders) {
    const headers = { Accept: "application/json", ...extraHeaders };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (body) headers["Content-Type"] = "application/json";
    return fetch(`${location.origin}${path}`, {
      method,
      credentials: "include",
      headers,
      ...(body ? { body } : {}),
    });
  }

  async function sendWithLogin(path, method, body, extraHeaders) {
    if (!accessToken) await refreshToken();
    let response = await send(path, method, body, extraHeaders);
    if (response.status === 401) {
      await refreshToken();
      response = await send(path, method, body, extraHeaders);
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        retryAfter: response.headers.get("Retry-After"),
      };
    }
    try {
      return { ok: true, status: response.status, data: await response.json() };
    } catch {
      return { ok: false, status: response.status, error: "not-json" };
    }
  }

  // Some project chats can only be read when the request also names the chat's
  // project and owner, as ChatGPT's own page does. Only single-chat reads can do this.
  function readOnlyGet(path, chatContext) {
    if (typeof path !== "string" || !ALLOWED_READ_PATHS.some((pattern) => pattern.test(path))) {
      return Promise.resolve({ ok: false, status: 0, error: "blocked" });
    }
    if (!chatContext) return sendWithLogin(path, "GET");

    const { projectId, ownerId } = chatContext;
    if (
      !SINGLE_CHAT_READ.test(path) ||
      typeof projectId !== "string" || !PROJECT_ID.test(projectId) ||
      typeof ownerId !== "string" || !OWNER_ID.test(ownerId)
    ) {
      return Promise.resolve({ ok: false, status: 0, error: "blocked" });
    }
    return sendWithLogin(path, "GET", undefined, {
      "chatgpt-project-id": projectId,
      "chatgpt-conv-owner-id": ownerId,
    });
  }

  const MAX_TITLE_LENGTH = 200;

  function setArchived(chatId, isArchived) {
    if (typeof chatId !== "string" || !CHAT_ID.test(chatId)) {
      return Promise.resolve({ ok: false, status: 0, error: "blocked" });
    }
    return sendWithLogin(
      `/backend-api/conversation/${chatId}`,
      "PATCH",
      JSON.stringify({ is_archived: isArchived })
    );
  }

  function renameChat(chatId, title) {
    if (
      typeof chatId !== "string" || !CHAT_ID.test(chatId) ||
      typeof title !== "string" || !title.trim() || title.length > MAX_TITLE_LENGTH
    ) {
      return Promise.resolve({ ok: false, status: 0, error: "blocked" });
    }
    return sendWithLogin(
      `/backend-api/conversation/${chatId}`,
      "PATCH",
      JSON.stringify({ title })
    );
  }

  function moveChat(chatId, projectId) {
    if (
      typeof chatId !== "string" || !CHAT_ID.test(chatId) ||
      typeof projectId !== "string" || !PROJECT_ID.test(projectId)
    ) {
      return Promise.resolve({ ok: false, status: 0, error: "blocked" });
    }
    return sendWithLogin(
      `/backend-api/conversation/${chatId}`,
      "PATCH",
      JSON.stringify({ gizmo_id: projectId })
    );
  }

  function createProject(name) {
    if (typeof name !== "string" || name !== name.trim() || name.length < 1 || name.length > MAX_PROJECT_NAME_LENGTH) {
      return Promise.resolve({ ok: false, status: 0, error: "blocked" });
    }
    return sendWithLogin(
      "/backend-api/projects",
      "POST",
      JSON.stringify({ name, instructions: "", memory_scope: "unset", emoji: null, theme: null })
    );
  }

  function deleteChat(chatId) {
    if (typeof chatId !== "string" || !CHAT_ID.test(chatId)) {
      return Promise.resolve({ ok: false, status: 0, error: "blocked" });
    }
    return sendWithLogin(`/backend-api/conversation/id/${chatId}`, "DELETE");
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    // Only accept messages from this extension's own pages.
    if (sender.id !== chrome.runtime.id || sender.tab) return false;

    if (message?.type === "organizer-ping") {
      reply({ ok: true });
      return false;
    }

    let work = null;
    if (message?.type === "organizer-get") work = readOnlyGet(message.path, message.chatContext);
    if (message?.type === "organizer-archive") work = setArchived(message.chatId, true);
    if (message?.type === "organizer-restore") work = setArchived(message.chatId, false);
    if (message?.type === "organizer-rename") work = renameChat(message.chatId, message.title);
    if (message?.type === "organizer-move") work = moveChat(message.chatId, message.projectId);
    if (message?.type === "organizer-create-project") work = createProject(message.name);
    if (message?.type === "organizer-delete") work = deleteChat(message.chatId);
    if (message?.type === "organizer-account") work = readAccount();
    if (!work) return false;

    work.then(reply).catch(() => reply({ ok: false, status: 0, error: "network" }));
    return true; // Tells Chrome the reply will come later.
  });
})();
