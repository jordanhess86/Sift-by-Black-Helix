// Knows what to ask ChatGPT for, and how to turn the answers into one tidy list.
// It goes slowly on purpose: one request at a time, with a pause between each.
(function (root) {
  "use strict";

  const PAGE_SIZE = 20;
  const PAUSE_BETWEEN_REQUESTS_MS = 1500;
  const MAX_PAGES_PER_LIST = 1000;
  const MAX_RATE_LIMIT_RETRIES = 3;
  const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 60;
  const MAX_RATE_LIMIT_WAIT_SECONDS = 300;
  const ARCHIVE_BATCH_SIZE = 5;
  const PAUSE_BETWEEN_BATCHES_MS = 6000;
  const MESSAGE_TURNS_PER_PAGE = 10;
  const MAX_MESSAGE_PAGES_PER_CHAT = 500;

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  function describeFailure(result) {
    if (result.error === "blocked") return "The extension blocked a request that isn't on its read-only list.";
    if (result.error === "network") return "Couldn't reach ChatGPT. Check your internet connection and try again.";
    if (result.error === "not-json") return "ChatGPT sent back something unexpected. Its site may have changed.";
    if (result.status === 401) return "ChatGPT says you're not logged in (error 401). Log in on chatgpt.com, reload that tab and try again.";
    if (result.status === 403) return "ChatGPT refused the request (error 403). Reload your chatgpt.com tab and try again.";
    if (result.status === 404) return "ChatGPT couldn't find that address (error 404). Its site may have changed.";
    if (result.status === 429) return "ChatGPT is still asking us to slow down (error 429). Stopped for now, so please try again later.";
    return `ChatGPT returned error ${result.status}.`;
  }

  function toMillis(value) {
    if (typeof value === "number") return value * 1000; // Some answers use seconds.
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  function describeBackupError(error) {
    if (error instanceof ApiError) return error.message;
    if (error?.name === "BackupVerificationError") return error.message;
    if (["NotAllowedError", "QuotaExceededError", "NoModificationAllowedError", "NotFoundError", "InvalidStateError"].includes(error?.name)) {
      return "Couldn't save to your backup folder. Check that it still exists and your disk has space.";
    }
    return "Lost connection to your chatgpt.com tab. Keep that tab open, reload it and try again.";
  }

  // A rough minimum time for a preview, counting only our own pauses.
  function estimatePacedSeconds(count) {
    let milliseconds = 0;
    for (let index = 1; index < count; index++) {
      milliseconds += index % ARCHIVE_BATCH_SIZE === 0 ? PAUSE_BETWEEN_BATCHES_MS : PAUSE_BETWEEN_REQUESTS_MS;
    }
    return Math.ceil(milliseconds / 1000);
  }

  function createApi({ transport, archiveTransport, restoreTransport, renameTransport, moveTransport, createProjectTransport, deleteTransport, sleep, onProgress = () => {} }) {
    let isFirstRequest = true;

    async function get(path) {
      if (!isFirstRequest) await sleep(PAUSE_BETWEEN_REQUESTS_MS);
      isFirstRequest = false;
      return withRetries(() => transport(path));
    }

    async function withRetries(sendRequest) {
      for (let retries = 0; ; retries++) {
        const result = await sendRequest();
        if (result.ok) return result.data;

        if (result.status === 429 && retries < MAX_RATE_LIMIT_RETRIES) {
          const asked = parseInt(result.retryAfter, 10);
          const seconds = Math.min(
            Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_RATE_LIMIT_WAIT_SECONDS,
            MAX_RATE_LIMIT_WAIT_SECONDS
          );
          onProgress(`ChatGPT asked us to slow down. Waiting ${seconds} seconds…`);
          await sleep(seconds * 1000);
          continue;
        }
        throw new ApiError(describeFailure(result), result.status);
      }
    }

    function itemsFrom(data) {
      if (!data || !Array.isArray(data.items)) {
        throw new ApiError("ChatGPT's answer wasn't in the expected format. Its site may have changed.");
      }
      return data.items;
    }

    // Reads a whole chat list, 20 at a time, until a page has nothing new.
    async function readChatList({ archived, onChat, warnings, hideProjectChats = false }) {
      const seen = new Set();
      for (let page = 0; page < MAX_PAGES_PER_LIST; page++) {
        const query = new URLSearchParams({
          offset: String(page * PAGE_SIZE),
          limit: String(PAGE_SIZE),
          order: "updated",
          is_archived: String(archived),
          expand: "false",
          hide_snorlax: String(hideProjectChats),
        });
        const items = itemsFrom(await get(`/backend-api/conversations?${query}`));

        const newItems = items.filter((item) => !seen.has(item.id));
        if (newItems.length === 0) return;
        for (const item of newItems) {
          seen.add(item.id);
          onChat(item);
        }
        onProgress(`Loading ${archived ? "archived" : "active"} chats… ${seen.size} so far`);
      }
      warnings.push(`Stopped after ${MAX_PAGES_PER_LIST} pages of chats, so this list may be incomplete.`);
    }

    async function readProjects(warnings) {
      const projects = [];
      const seenCursors = new Set();
      let cursor = null;
      for (let page = 0; page < MAX_PAGES_PER_LIST; page++) {
        const query = new URLSearchParams({
          conversations_per_gizmo: "5",
          limit: String(PAGE_SIZE),
          owned_only: "false",
        });
        if (cursor) query.set("cursor", cursor);

        const data = await get(`/backend-api/gizmos/snorlax/sidebar?${query}`);
        for (const item of itemsFrom(data)) {
          const details = item.gizmo?.gizmo;
          if (!details?.id) continue;
          projects.push({
            id: details.id,
            name: details.display?.name || "(unnamed project)",
            firstChats: item.conversations?.items || [],
            nextCursor: item.conversations?.cursor || null,
          });
        }
        onProgress(`Loading projects… ${projects.length} so far`);

        cursor = data.cursor;
        if (!cursor || seenCursors.has(cursor)) return projects;
        seenCursors.add(cursor);
      }
      warnings.push(`Stopped after ${MAX_PAGES_PER_LIST} pages of projects, so this list may be incomplete.`);
      return projects;
    }

    // The project list already includes each project's first few chats, so
    // this only asks for more when ChatGPT says there are more.
    async function readRestOfProject(project, onChat) {
      const seenCursors = new Set();
      let cursor = project.nextCursor;
      for (let page = 0; cursor && !seenCursors.has(cursor) && page < MAX_PAGES_PER_LIST; page++) {
        seenCursors.add(cursor);
        const query = new URLSearchParams({ limit: String(PAGE_SIZE), owned_only: "false", cursor });
        const data = await get(`/backend-api/gizmos/${encodeURIComponent(project.id)}/conversations?${query}`);
        itemsFrom(data).forEach(onChat);
        cursor = data.cursor;
      }
    }

    function makeChat(raw, { archived = false, projectId = null } = {}, existing = null) {
      return {
        id: raw.id,
        title: raw.title || existing?.title || "(untitled chat)",
        createdAt: toMillis(raw.create_time) ?? existing?.createdAt ?? null,
        updatedAt: toMillis(raw.update_time) ?? existing?.updatedAt ?? null,
        gizmoId: raw.gizmo_id || existing?.gizmoId || null,
        isArchived: archived || raw.is_archived === true || existing?.isArchived === true,
        projectId: projectId || existing?.projectId || null,
        ownerId: raw.owner?.user_id || existing?.ownerId || null,
      };
    }

    // A chat's gizmo_id only counts as a project if it matches a real project.
    // Otherwise it may be a custom GPT, so it's labeled separately.
    function finishChat(chat, projectIds) {
      const projectId = chat.projectId || (projectIds.has(chat.gizmoId) ? chat.gizmoId : null);
      return { ...chat, projectId, hasOtherGizmo: !projectId && Boolean(chat.gizmoId) };
    }

    // Loads project names and chats outside projects. Project and archived chats load later.
    async function loadBasics() {
      const warnings = [];
      let projects = [];
      try {
        projects = await readProjects(warnings);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status === 429) throw error;
        warnings.push(`Couldn't load your projects. ${error.message}`);
      }
      const projectIds = new Set(projects.map((project) => project.id));
      const chats = new Map();
      let projectChatsSkipped = 0;
      await readChatList({
        archived: false,
        hideProjectChats: true,
        warnings,
        onChat: (raw) => {
          if (!raw?.id) return;
          // In case ChatGPT sends them anyway, project chats still wait for their project.
          if (projectIds.has(raw.gizmo_id)) projectChatsSkipped += 1;
          else chats.set(raw.id, finishChat(makeChat(raw), projectIds));
        },
      });
      return {
        projects: projects.map(({ id, name }) => ({ id, name })),
        projectSeeds: projects.map(({ id, firstChats, nextCursor }) => ({ id, firstChats, nextCursor })),
        chats: [...chats.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
        warnings,
        projectChatsSkipped,
      };
    }

    // ChatGPT already sent each project's first chats, so a small project needs no request.
    async function loadProjectChats(seed) {
      const chats = new Map();
      const add = (raw) => {
        if (raw?.id) chats.set(raw.id, makeChat(raw, { projectId: seed.id }, chats.get(raw.id)));
      };
      seed.firstChats.forEach(add);
      await readRestOfProject(seed, add);
      return [...chats.values()].map((chat) => finishChat(chat, new Set([seed.id])));
    }

    async function loadArchivedChats(projectIds = []) {
      const chats = [];
      const known = new Set(projectIds);
      await readChatList({
        archived: true,
        warnings: [],
        onChat: (raw) => {
          if (raw?.id) chats.push(finishChat(makeChat(raw, { archived: true }), known));
        },
      });
      return chats;
    }

    // Fetches everything and returns { projects, chats, warnings }.
    async function loadLibrary() {
      const warnings = [];
      const chats = new Map();

      const addChat = (raw, { archived = false, projectId = null } = {}) => {
        if (!raw?.id) return;
        const existing = chats.get(raw.id);
        chats.set(raw.id, makeChat(raw, { archived, projectId }, existing));
      };

      // Reads one section. A failure becomes a warning so that everything
      // already loaded is kept, except repeated "slow down" answers: those
      // stop all further requests.
      const attempt = async (failureNote, work) => {
        try {
          await work();
        } catch (error) {
          if (!(error instanceof ApiError) || error.status === 429) throw error;
          warnings.push(`${failureNote} ${error.message}`);
        }
      };

      let projects = [];
      await attempt("Couldn't load your projects.", async () => {
        projects = await readProjects(warnings);
      });
      for (const project of projects) {
        project.firstChats.forEach((raw) => addChat(raw, { projectId: project.id }));
      }

      let activeError = null;
      try {
        await readChatList({ archived: false, onChat: (raw) => addChat(raw), warnings });
      } catch (error) {
        if (chats.size === 0 || !(error instanceof ApiError) || error.status === 429) throw error;
        activeError = error;
        warnings.push(`Your chat list may be incomplete. ${error.message}`);
      }

      if (!activeError) {
        await attempt("Couldn't load your archived chats.", () =>
          readChatList({
            archived: true,
            onChat: (raw) => addChat(raw, { archived: true }),
            warnings,
          })
        );

        for (const [index, project] of projects.entries()) {
          if (!project.nextCursor) continue;
          onProgress(`Checking project ${index + 1} of ${projects.length}…`);
          await attempt(`Couldn't load every chat in "${project.name}".`, () =>
            readRestOfProject(project, (raw) => addChat(raw, { projectId: project.id }))
          );
        }
      }

      const projectIds = new Set(projects.map((project) => project.id));
      const finishedChats = [...chats.values()].map((chat) => finishChat(chat, projectIds));
      finishedChats.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

      return {
        projects: projects.map(({ id, name }) => ({ id, name })),
        chats: finishedChats,
        warnings,
      };
    }

    // With saveBackup, a chat is only archived after its backup has fully succeeded.
    function archiveChats(chats, options) {
      return changeChats(chats, (chat) => archiveTransport(chat.id), options);
    }

    function restoreChats(chats, options) {
      return changeChats(chats, (chat) => restoreTransport(chat.id), options);
    }

    function renameChats(chats, title, options) {
      return changeChats(chats, (chat) => renameTransport(chat.id, title), options);
    }

    function moveChats(chats, projectId, options) {
      return changeChats(chats, (chat) => moveTransport(chat.id, projectId), options);
    }

    // Changes chats one at a time, with a longer pause after every small batch.
    // It stops at the first problem instead of pressing on. onResult saves the
    // action log entry, and the run also stops if that entry can't be saved.
    async function changeChats(chats, sendChange, { saveBackup, shouldStop = () => false, onResult = async () => {} } = {}) {
      const outcome = { succeeded: [], failed: [], notAttempted: [], stopReason: null };

      for (const [index, chat] of chats.entries()) {
        if (index > 0) {
          await sleep(index % ARCHIVE_BATCH_SIZE === 0 ? PAUSE_BETWEEN_BATCHES_MS : PAUSE_BETWEEN_REQUESTS_MS);
        }
        if (shouldStop()) {
          outcome.notAttempted = chats.slice(index);
          outcome.stopReason = "You stopped the run.";
          return outcome;
        }

        let failure = null;
        if (saveBackup) {
          try {
            await backUpFully(chat, saveBackup);
          } catch (error) {
            failure = `Not changed, because its backup didn't finish. ${describeBackupError(error)}`;
          }
          if (!failure) {
            if (shouldStop()) {
              outcome.notAttempted = chats.slice(index);
              outcome.stopReason = "You stopped the run. The last chat was backed up but not changed.";
              return outcome;
            }
            await sleep(PAUSE_BETWEEN_REQUESTS_MS);
          }
        }

        if (!failure) {
          try {
            const data = await withRetries(() => sendChange(chat));
            if (data?.success !== true) failure = "ChatGPT didn't confirm the change. Its site may have changed.";
          } catch (error) {
            failure = error instanceof ApiError
              ? error.message
              : "Lost connection to your chatgpt.com tab. Check this chat in ChatGPT, because the change may or may not have happened.";
          }
        }

        (failure ? outcome.failed : outcome.succeeded).push(chat);

        let logFailed = false;
        try {
          await onResult(chat, failure);
        } catch {
          logFailed = true;
        }

        if (failure || logFailed) {
          outcome.notAttempted = chats.slice(index + 1);
          outcome.stopReason = failure || "Couldn't save the action log, so the run stopped.";
          return outcome;
        }
      }
      return outcome;
    }

    // Fetches every message in one chat. ChatGPT sends the newest messages
    // first, and each page says how to ask for the older page before it. If any
    // page is missing, this fails, so a partial chat is never saved as complete.
    async function fetchFullChat(chat) {
      const chatId = chat.id;
      const turns = `num_turns=${MESSAGE_TURNS_PER_PAGE}&include_has_versions=true`;
      const firstPath = `/backend-api/conversations/${chatId}?${turns}`;
      let chatContext = null;
      let first;
      try {
        first = await withRetries(() => transport(firstPath));
      } catch (error) {
        // Some project chats answer 404 unless the request names their project
        // and owner, so this tries once more the way ChatGPT's own page does.
        if (!(error instanceof ApiError) || error.status !== 404 || !chat.projectId || !chat.ownerId) throw error;
        chatContext = { projectId: chat.projectId, ownerId: chat.ownerId };
        await sleep(PAUSE_BETWEEN_REQUESTS_MS);
        first = await withRetries(() => transport(firstPath, chatContext));
      }
      if (!Array.isArray(first?.messages)) {
        throw new ApiError("ChatGPT's answer wasn't in the expected format. Its site may have changed.");
      }

      const pages = [first.messages];
      const seenCursors = new Set();
      let pageInfo = first.page_info;
      while (pageInfo?.has_previous_page) {
        const cursor = pageInfo.start_cursor;
        let problem = null;
        if (!cursor) problem = "ChatGPT gave no pointer to them";
        else if (seenCursors.has(cursor)) problem = "ChatGPT repeated the same page";
        else if (pages.length >= MAX_MESSAGE_PAGES_PER_CHAT) problem = `the chat is longer than ${MAX_MESSAGE_PAGES_PER_CHAT} pages`;
        if (problem) {
          throw new ApiError(`Couldn't load all of this chat's older messages because ${problem}, so it wasn't saved.`, 404);
        }
        seenCursors.add(cursor);
        await sleep(PAUSE_BETWEEN_REQUESTS_MS);
        const query = `before=${encodeURIComponent(cursor)}&${turns}`;
        let older;
        try {
          older = await withRetries(() => transport(`/backend-api/conversations/${chatId}/messages?${query}`, chatContext));
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          throw new ApiError(`While loading older messages: ${error.message}`, error.status);
        }
        if (!Array.isArray(older?.messages)) {
          throw new ApiError("ChatGPT's answer wasn't in the expected format. Its site may have changed.");
        }
        pages.unshift(older.messages);
        pageInfo = older.page_info;
      }

      const seenMessages = new Set();
      const messages = pages.flat().filter((message) => {
        if (seenMessages.has(message.id)) return false;
        seenMessages.add(message.id);
        return true;
      });
      const { page_info: _pageInfo, ...details } = first;
      return { ...details, messages };
    }

    // Backs up chats one at a time, at the same slow pace as archiving. A chat
    // that can't be found is skipped and retried next run. Anything suggesting a
    // wider problem (a login error, "slow down", a full disk) stops the run.
    async function backupChats(chats, { shouldStop = () => false, saveChat, onResult = () => {} }) {
      const outcome = { saved: [], failed: [], notAttempted: [], stopReason: null };

      for (const [index, chat] of chats.entries()) {
        if (index > 0) {
          await sleep(index % ARCHIVE_BATCH_SIZE === 0 ? PAUSE_BETWEEN_BATCHES_MS : PAUSE_BETWEEN_REQUESTS_MS);
        }
        if (shouldStop()) {
          outcome.notAttempted = chats.slice(index);
          outcome.stopReason = "You stopped the run.";
          return outcome;
        }

        let failure = null;
        let keepGoing = false;
        try {
          await saveChat(chat, await fetchFullChat(chat));
        } catch (error) {
          failure = describeBackupError(error);
          keepGoing = error instanceof ApiError && error.status === 404;
        }

        (failure ? outcome.failed : outcome.saved).push(chat);
        await onResult(chat, failure);

        if (failure && !keepGoing) {
          outcome.notAttempted = chats.slice(index + 1);
          outcome.stopReason = failure;
          return outcome;
        }
      }
      return outcome;
    }

    // Creates one project and returns its ID. It's only tried once (apart from
    // "slow down" answers), so a failure can't quietly create duplicates.
    async function createProject(name) {
      const data = await withRetries(() => createProjectTransport(name));
      const id = data?.resource?.gizmo?.id;
      if (data?.error || typeof id !== "string") {
        throw new ApiError("ChatGPT didn't confirm the new project. Check your projects in ChatGPT before trying again.");
      }
      return { id, name };
    }

    async function backUpFully(chat, saveBackup) {
      const fullChat = await fetchFullChat(chat);
      if (fullChat.messages.length === 0) {
        throw new ApiError("ChatGPT sent no messages for this chat.");
      }
      await saveBackup(chat, fullChat);
    }

    // Deletes chats one at a time. When needsBackup says so, it first fetches every
    // message, saves a backup and re-checks it (saveBackup). Any problem at any step
    // stops the whole run, and such a chat is never deleted unless its backup fully
    // succeeded. The person decides which chats need a backup in the preview.
    async function deleteChats(chats, { saveBackup, needsBackup = () => true, shouldStop = () => false, onResult = async () => {} }) {
      const outcome = { succeeded: [], failed: [], notAttempted: [], stopReason: null };

      for (const [index, chat] of chats.entries()) {
        if (index > 0) {
          await sleep(index % ARCHIVE_BATCH_SIZE === 0 ? PAUSE_BETWEEN_BATCHES_MS : PAUSE_BETWEEN_REQUESTS_MS);
        }
        if (shouldStop()) {
          outcome.notAttempted = chats.slice(index);
          outcome.stopReason = "You stopped the run.";
          return outcome;
        }

        let failure = null;
        const backingUp = needsBackup(chat);
        if (backingUp) {
          try {
            await backUpFully(chat, saveBackup);
          } catch (error) {
            failure = `Not deleted, because its backup didn't finish. ${describeBackupError(error)}`;
          }
        }

        if (!failure) {
          if (shouldStop()) {
            outcome.notAttempted = chats.slice(index);
            outcome.stopReason = backingUp ? "You stopped the run. The last chat was backed up but not deleted." : "You stopped the run.";
            return outcome;
          }
          if (backingUp) await sleep(PAUSE_BETWEEN_REQUESTS_MS);
          try {
            const data = await withRetries(() => deleteTransport(chat.id));
            if (data?.success !== true) failure = "ChatGPT didn't confirm the delete. Check this chat in ChatGPT.";
          } catch (error) {
            failure = error instanceof ApiError
              ? error.message
              : "Lost connection to your chatgpt.com tab. Check this chat in ChatGPT, because it may or may not have been deleted.";
          }
        }

        (failure ? outcome.failed : outcome.succeeded).push(chat);

        let logFailed = false;
        try {
          await onResult(chat, failure);
        } catch {
          logFailed = true;
        }

        if (failure || logFailed) {
          outcome.notAttempted = chats.slice(index + 1);
          outcome.stopReason = failure || "Couldn't save the action log, so the run stopped.";
          return outcome;
        }
      }
      return outcome;
    }

    return { loadLibrary, loadBasics, loadProjectChats, loadArchivedChats, archiveChats, restoreChats, renameChats, moveChats, createProject, deleteChats, fetchFullChat, backupChats };
  }

  root.OrganizerApi = { createApi, ApiError, estimatePacedSeconds };
})(globalThis);
