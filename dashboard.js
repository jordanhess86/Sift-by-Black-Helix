// Runs the organizer page: the buttons, chat table, preview window and action log.
// Loaded chats are only kept in this page's memory, and they're gone when you
// close the tab. Only the action log is saved (see storage.js).
(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const elements = {
    loadButton: byId("load-button"),
    backupButton: byId("backup-button"),
    dialogChangeFolder: byId("dialog-change-folder"),
    status: byId("status"),
    warnings: byId("warnings"),
    library: byId("library"),
    groups: byId("groups"),
    groupTitle: byId("group-title"),
    rows: byId("chat-rows"),
    emptyNote: byId("empty-note"),
    filterForm: byId("filters"),
    filterKeyword: byId("content-search-input"),
    sidebar: byId("sidebar"),
    sidebarToggle: byId("sidebar-toggle"),
    sidebarClose: byId("sidebar-close"),
    sidebarBackdrop: byId("sidebar-backdrop"),
    autoLoad: byId("setting-auto-load"),
    healthBanner: byId("health-banner"),
    healthDetail: byId("health-detail"),
    healthAdvice: byId("health-advice"),
    healthUpdate: byId("health-update"),
    healthRetry: byId("health-retry"),
    healthReport: byId("health-report"),
    settingsReport: byId("settings-report"),
    accountLabel: byId("account-label"),
    accountFolder: byId("setting-account-folder"),
    dialogSecondary: byId("dialog-secondary"),
    folderName: byId("setting-folder-name"),
    folderChange: byId("setting-folder-change"),
    guide: byId("guide"),
    guideDismiss: byId("guide-dismiss"),
    guideShow: byId("guide-show"),
    guideFolder: byId("guide-folder"),
    guideBackup: byId("guide-backup"),
    guideRelated: byId("guide-related"),
    selectionBar: byId("selection-bar"),
    moveToggle: byId("move-toggle"),
    movePanel: byId("move-panel"),
    movePanelClose: byId("move-panel-close"),
    settingsButton: byId("settings-button"),
    settingsPanel: byId("settings-panel"),
    contentSearchTitle: byId("content-search-title"),
    filterDateField: byId("filter-date-field"),
    filterFrom: byId("filter-from"),
    filterTo: byId("filter-to"),
    filterClear: byId("filter-clear"),
    selectAll: byId("select-all"),
    selectionCount: byId("selection-count"),
    selectionClear: byId("selection-clear"),
    archiveButton: byId("archive-button"),
    moveMode: byId("move-mode"),
    archivedBackupButton: byId("archived-backup-button"),
    contentSearch: byId("content-search"),
    contentSearchFormElement: byId("content-search-form"),
    contentSearchForm: byId("content-search-form"),
    contentSearchInput: byId("content-search-input"),
    contentSearchButton: byId("content-search-button"),
    contentSearchClear: byId("content-search-clear"),
    contentSearchStatus: byId("content-search-status"),
    contentResults: byId("content-results"),
    dialogText: byId("dialog-text"),
    relatedStatus: byId("related-status"),
    relatedPrepare: byId("related-prepare"),
    relatedStop: byId("related-stop"),
    restoreButton: byId("restore-button"),
    renameButton: byId("rename-button"),
    dialogRename: byId("dialog-rename"),
    dialogRenameInput: byId("dialog-rename-input"),
    moveModeExisting: byId("move-mode-existing"),
    moveModeNew: byId("move-mode-new"),
    moveTarget: byId("move-target"),
    moveButton: byId("move-button"),
    createProjectButton: byId("create-project-button"),
    newProjectName: byId("new-project-name"),
    deleteButton: byId("delete-button"),
    deleteChoice: byId("delete-backup-choice"),
    deleteQuestion: byId("delete-backup-question"),
    deleteChoiceBackup: byId("delete-choice-backup"),
    deleteChoiceSkip: byId("delete-choice-skip"),
    dialogTyped: byId("dialog-typed"),
    dialogTypedInput: byId("dialog-typed-input"),
    dialog: byId("archive-dialog"),
    dialogTitle: byId("dialog-title"),
    dialogIntro: byId("dialog-intro"),
    dialogList: byId("dialog-list"),
    dialogMessage: byId("dialog-message"),
    dialogCancel: byId("dialog-cancel"),
    dialogConfirm: byId("dialog-confirm"),
    dialogStop: byId("dialog-stop"),
    dialogClose: byId("dialog-close"),
    logSummary: byId("log-summary"),
    logEmpty: byId("log-empty"),
    logTable: byId("log-table"),
    logRows: byId("log-rows"),
    logExport: byId("log-export"),
  };

  const FILTER_DELAY_MS = 150;
  const LOG_ROWS_SHOWN = 200;
  const BACKUP_CHATS_PER_RUN = 200;
  const DELETE_CHATS_PER_RUN = 50;
  const ARCHIVE_CHATS_PER_RUN = 200;
  const DELETE_WORD = "DELETE";
  const RESULTS_SHOWN = 100;
  const COMPARE_NAMES = { numeric: true, sensitivity: "base" };
  const SHORT_CHAT_WORDS = 40;
  const SHORT_CHATS_KEY = "cleanup:short";
  const AUTO_LOAD_WAIT_SECONDS = 15;
  const PROJECT_MARK_COUNT = 6;
  const SORT_FIRST_DIRECTION = { title: "asc", project: "asc", createdAt: "desc", updatedAt: "desc" };
  const SECTIONS_PER_SECOND_ESTIMATE = 8;
  const RELATED_SNIPPET_CHARACTERS = 220;

  const state = {
    projects: [],
    chats: [],
    selectedGroup: "all",
    selectedIds: new Set(),
    visibleSelectableIds: [],
    previewChats: [],
    isRunning: false,
    stopRequested: false,
    dialogAction: null,
    dialogSecondaryAction: null,
    contentResults: [],
    relatedResults: [],
    deleteCounts: { total: 0, needsAnswer: 0 },
    relatedEngine: null,
    isPreparing: false,
    stopPreparing: false,
    backupLocations: {},
    backupFolder: null,
    deletedThisSession: new Set(),
    showingResults: false,
    sort: { key: "updatedAt", direction: "desc" },
    projectsDescending: false,
    settings: {},
    shortChatIds: null,
    lastTickedId: null,
    account: null,
    chromeVersionIsOld: false,
    projectSeeds: new Map(),
    loadedProjects: new Set(),
    archivedLoaded: false,
    isLazyLoading: false,
    stopLoadingAll: false,
    isLoadingAll: false,
    loadGeneration: 0,
  };
  let filterTimer = null;

  function readFilters() {
    return {
      keyword: elements.filterKeyword.value,
      dateField: elements.filterDateField.value,
      from: elements.filterFrom.value,
      to: elements.filterTo.value,
    };
  }

  const ACTION_NAMES = {
    archive: "Archive",
    restore: "Restore",
    rename: "Rename",
    move: "Move",
    createProject: "New project",
    delete: "Delete",
    backup: "Back up",
  };

  function showHealth() {
    const problems = OrganizerHealth.problems();
    elements.healthBanner.hidden = problems.length === 0;
    if (!problems.length) return;
    const paused = OrganizerHealth.pausedActions().map((action) => ACTION_NAMES[action]);
    elements.healthDetail.textContent = `${problems.map((problem) => problem.message).join(". ")}, so these are paused: ${paused.join(", ")}.`;
    const outdated = OrganizerHealth.hasProblem("oldVersion");
    elements.healthUpdate.hidden = !outdated;
    let advice = "ChatGPT may have changed its site. Reading and searching still work. A Sift update may be needed if this keeps happening.";
    if (!OrganizerHealth.hasSiteChange()) {
      advice = outdated
        ? "Your chats are fine, and this isn't a ChatGPT problem. Click Finish updating Sift, which closes this tab. Then reload your ChatGPT tab and open Sift again."
        : "Your chats are fine, and this isn't a ChatGPT problem. Reload your ChatGPT tab, then click Check again.";
    }
    elements.healthAdvice.textContent = advice;
  }

  // Chrome reads Sift's page files straight from disk, but keeps running the rest of
  // the older version until the extension is reloaded. A mix of the two isn't safe.
  async function checkInstalledVersion() {
    try {
      const running = chrome.runtime.getManifest().version;
      const response = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
      const onDisk = (await response.json()).version;
      state.chromeVersionIsOld = running !== onDisk;
    } catch {
      state.chromeVersionIsOld = false;
    }
    if (state.chromeVersionIsOld) {
      OrganizerHealth.noteOldVersion();
      showHealth();
      if (state.chats.length) updateSelectionUi();
    }
  }

  function saveDiagnosticReport() {
    const report = OrganizerHealth.buildReport({
      version: chrome.runtime?.getManifest?.().version,
      chrome: navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] || "unknown",
    });
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sift-diagnostic-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus(`Saved ${link.download} to your downloads. It has no chat titles, messages or login details.`);
  }

  function showStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle("error", isError);
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function plural(count, word) {
    return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
  }

  // Finds an open chatgpt.com tab where our helper (content.js) is running.
  async function findChatGptTab() {
    const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    for (const tab of tabs) {
      try {
        const answer = await chrome.tabs.sendMessage(tab.id, { type: "organizer-ping" });
        if (answer?.ok) return tab;
      } catch {
        // This tab was opened before the extension loaded. Try the next one.
      }
    }
    return null;
  }

  function createApiFor(tab, onProgress = showStatus) {
    const send = (message) => chrome.tabs.sendMessage(tab.id, message);
    const change = (action, path, message, isConfirmed) =>
      send(message).then((result) => OrganizerHealth.observeChange(action, path, result, isConfirmed));
    return OrganizerApi.createApi({
      transport: (path, chatContext) =>
        send({ type: "organizer-get", path, chatContext }).then((result) => OrganizerHealth.observeRead(path, result)),
      archiveTransport: (chatId) => change("archive", `/backend-api/conversation/${chatId}`, { type: "organizer-archive", chatId }),
      restoreTransport: (chatId) => change("restore", `/backend-api/conversation/${chatId}`, { type: "organizer-restore", chatId }),
      renameTransport: (chatId, title) => change("rename", `/backend-api/conversation/${chatId}`, { type: "organizer-rename", chatId, title }),
      moveTransport: (chatId, projectId) => change("move", `/backend-api/conversation/${chatId}`, { type: "organizer-move", chatId, projectId }),
      createProjectTransport: (name) =>
        change("createProject", "/backend-api/projects", { type: "organizer-create-project", name }, (data) => !data?.error && typeof data?.resource?.gizmo?.id === "string"),
      deleteTransport: (chatId) => change("delete", `/backend-api/conversation/id/${chatId}`, { type: "organizer-delete", chatId }),
      sleep,
      onProgress: (message) => onProgress(message),
    });
  }

  function inArchivedView() {
    return state.selectedGroup === "archived";
  }

  function projectNameOf(chat) {
    if (!chat.projectId) return "";
    return state.projects.find((project) => project.id === chat.projectId)?.name || "(unknown project)";
  }

  function buildGroups() {
    const active = state.chats.filter((chat) => !chat.isArchived);
    const groups = [
      { key: "all", name: allProjectsLoaded() ? "All active chats" : "Loaded chats", chats: active },
      { key: "none", name: "Not in any project", chats: active.filter((chat) => !chat.projectId) },
    ];
    const projectGroups = state.projects
      .map((project) => ({
        key: `project:${project.id}`,
        name: project.name,
        projectId: project.id,
        notLoaded: !state.loadedProjects.has(project.id),
        chats: active.filter((chat) => chat.projectId === project.id),
      }))
      .sort((a, b) => (state.projectsDescending ? -1 : 1) * a.name.localeCompare(b.name, undefined, COMPARE_NAMES));
    const archived = {
      key: "archived",
      name: "Archived",
      notLoaded: !state.archivedLoaded,
      chats: state.chats.filter((chat) => chat.isArchived),
    };
    const shortIds = state.shortChatIds;
    const cleanupGroups = [
      { key: "cleanup:6months", name: "Not updated in 6 months", chats: OrganizerFilters.notUpdatedSince(active, 182) },
      { key: "cleanup:year", name: "Not updated in a year", chats: OrganizerFilters.notUpdatedSince(active, 365) },
      {
        key: SHORT_CHATS_KEY,
        name: "Very short chats",
        chats: shortIds ? active.filter((chat) => shortIds.has(chat.id)) : [],
        notChecked: !shortIds,
      },
    ];
    return { groups, projectGroups, cleanupGroups, archived };
  }

  function formatDate(milliseconds) {
    if (milliseconds === null) return "—";
    return new Date(milliseconds).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function makeGroupButton(group) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-button";
    if (group.key === state.selectedGroup) button.setAttribute("aria-current", "true");

    if (group.projectId) button.append(makeProjectMark(group.projectId));
    const name = document.createElement("span");
    name.className = "group-name";
    name.textContent = group.name;
    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = group.notChecked ? "Check" : group.notLoaded ? "–" : group.chats.length.toLocaleString();
    if (group.notLoaded) count.setAttribute("aria-label", "Not loaded yet");
    button.append(name, count);

    button.addEventListener("click", () => selectGroup(group.key));
    return button;
  }

  function selectGroup(key) {
    // Archived chats have different actions, so ticks don't carry over between them and active chats.
    if ((key === "archived") !== inArchivedView()) state.selectedIds.clear();
    if (state.selectedGroup === SHORT_CHATS_KEY && key !== SHORT_CHATS_KEY) showStatus("");
    state.selectedGroup = key;
    setSidebarOpen(false);
    render();
    if (key === SHORT_CHATS_KEY) findShortChats();
    else if (key.startsWith("cleanup:") && !everythingLoaded()) showStatus("This view only covers chats that are loaded. Use Load all projects to include the rest.");
    ensureGroupLoaded(key);
  }

  function allProjectsLoaded() {
    return state.projects.every((project) => state.loadedProjects.has(project.id));
  }

  function everythingLoaded() {
    return allProjectsLoaded() && state.archivedLoaded;
  }

  function mergeChats(chats) {
    const merged = new Map(state.chats.map((chat) => [chat.id, chat]));
    for (const chat of chats) {
      const existing = merged.get(chat.id);
      merged.set(chat.id, existing ? { ...existing, ...chat, projectId: chat.projectId || existing.projectId, isArchived: chat.isArchived || existing.isArchived } : chat);
    }
    state.chats = [...merged.values()];
  }

  // Loads a project's chats, or the archived list, when you click it.
  async function ensureGroupLoaded(key) {
    const projectId = key.startsWith("project:") ? key.slice("project:".length) : null;
    const needed = projectId ? !state.loadedProjects.has(projectId) : key === "archived" && !state.archivedLoaded;
    if (!needed || state.isLazyLoading) return;

    state.isLazyLoading = true;
    const generation = state.loadGeneration;
    const name = projectId ? `"${state.projects.find((project) => project.id === projectId)?.name}"` : "archived chats";
    showStatus(`Loading ${name}…`);
    try {
      const tab = await findChatGptTab();
      if (!tab) throw new OrganizerApi.ApiError("Couldn't connect to ChatGPT. Open chatgpt.com, or reload it if it's already open, then try again.");
      const api = createApiFor(tab);
      const chats = projectId
        ? await api.loadProjectChats(state.projectSeeds.get(projectId) || { id: projectId, firstChats: [], nextCursor: null })
        : await api.loadArchivedChats(state.projects.map((project) => project.id));
      // A reload started meanwhile, possibly for another account, so these no longer apply.
      if (generation !== state.loadGeneration) return;
      mergeChats(chats);
      if (projectId) state.loadedProjects.add(projectId);
      else state.archivedLoaded = true;
      showStatus(`Loaded ${name}.`);
    } catch (error) {
      if (generation !== state.loadGeneration) return;
      showStatus(error instanceof OrganizerApi.ApiError ? `Couldn't load ${name}. ${error.message}` : "Lost connection to your chatgpt.com tab. Keep that tab open, reload it and try again.", true);
    } finally {
      state.isLazyLoading = false;
      render();
      showHealth();
    }
    if (state.selectedGroup !== key && generation === state.loadGeneration) ensureGroupLoaded(state.selectedGroup);
  }

  // Loads every project that isn't loaded yet, and optionally archived chats, one at a time.
  async function loadRemainingChats({ includeArchived = false } = {}) {
    if (state.isLoadingAll) return false;
    state.isLoadingAll = true;
    state.stopLoadingAll = false;
    render();
    while (state.isLazyLoading) await sleep(100);
    const generation = state.loadGeneration;
    let finished = true;
    try {
      const tab = await findChatGptTab();
      if (!tab) throw new OrganizerApi.ApiError("Couldn't connect to ChatGPT. Open chatgpt.com, or reload it if it's already open, then try again.");
      const api = createApiFor(tab);
      const waiting = state.projects.filter((project) => !state.loadedProjects.has(project.id));
      for (const [position, project] of waiting.entries()) {
        if (state.stopLoadingAll) {
          finished = false;
          break;
        }
        showStatus(`Loading project ${(position + 1).toLocaleString()} of ${waiting.length.toLocaleString()}: "${project.name}"…`);
        const chats = await api.loadProjectChats(state.projectSeeds.get(project.id) || { id: project.id, firstChats: [], nextCursor: null });
        if (generation !== state.loadGeneration) return false;
        mergeChats(chats);
        state.loadedProjects.add(project.id);
        render();
      }
      if (finished && includeArchived && !state.archivedLoaded) {
        showStatus("Loading archived chats…");
        const chats = await api.loadArchivedChats(state.projects.map((project) => project.id));
        if (generation !== state.loadGeneration) return false;
        mergeChats(chats);
        state.archivedLoaded = true;
      }
      showStatus(finished ? "All your chats in projects are loaded." : "Stopped. You can load the rest any time.");
    } catch (error) {
      if (generation !== state.loadGeneration) return false;
      finished = false;
      showStatus(error instanceof OrganizerApi.ApiError ? `Stopped loading. ${error.message}` : "Lost connection to your chatgpt.com tab. Keep that tab open, reload it and try again.", true);
    } finally {
      state.isLoadingAll = false;
      render();
      showHealth();
    }
    return finished;
  }

  function makeLoadAllButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-button group-new";
    button.textContent = state.isLoadingAll ? (state.stopLoadingAll ? "Stopping…" : "Stop loading") : "Load all projects";
    button.disabled = state.stopLoadingAll && state.isLoadingAll;
    button.addEventListener("click", () => {
      if (state.isLoadingAll) {
        state.stopLoadingAll = true;
        render();
      } else {
        loadRemainingChats();
      }
    });
    return button;
  }

  // Word counts come from your backup files, so this asks for no chats from ChatGPT.
  async function findShortChats() {
    const opened = await openBackupFolder();
    if (!opened) return;
    showStatus("Checking your backup files for very short chats…");
    try {
      const { searchIndex } = await OrganizerSearch.updateIndex(opened.folder, opened.index, (done, total) => {
        showStatus(`Reading backup files: ${done.toLocaleString()} of ${total.toLocaleString()}…`);
      });
      state.shortChatIds = OrganizerFilters.shortChatIds(searchIndex.chats, SHORT_CHAT_WORDS);
      const notBackedUp = state.chats.filter((chat) => !chat.isArchived && !opened.index.chats[chat.id]).length;
      showStatus(
        `These have ${SHORT_CHAT_WORDS} words or fewer in their latest backup.` +
          (notBackedUp ? ` ${plural(notBackedUp, "active chat")} not backed up yet, so not checked.` : "")
      );
      render();
    } catch {
      showStatus("Couldn't read your backup files. Check your backup folder and try again.", true);
    }
  }

  // Only a half-screen window shows the toggle button, so only there does the list slide.
  function setSidebarOpen(isOpen) {
    const wasOpen = elements.sidebar.classList.contains("is-open");
    if (isOpen === wasOpen) return;
    elements.sidebar.classList.toggle("is-open", isOpen);
    elements.sidebarBackdrop.hidden = !isOpen;
    elements.sidebarToggle.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) elements.sidebarClose.focus();
    else elements.sidebarToggle.focus();
  }

  // The same project always gets the same color.
  function makeProjectMark(projectId) {
    let total = 0;
    for (const character of String(projectId)) total += character.codePointAt(0);
    const mark = document.createElement("span");
    mark.className = `project-mark mark-${total % PROJECT_MARK_COUNT}`;
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }

  function makeProjectsHeading(count) {
    const heading = makeHeading(`Projects (${count})`);
    const sort = document.createElement("button");
    sort.type = "button";
    sort.className = "group-sort";
    sort.textContent = state.projectsDescending ? "Z to A ↑" : "A to Z ↓";
    sort.setAttribute("aria-label", `Sort projects ${state.projectsDescending ? "A to Z" : "Z to A"}`);
    sort.addEventListener("click", () => {
      state.projectsDescending = !state.projectsDescending;
      saveChoices();
      render();
    });
    heading.append(sort);
    return heading;
  }

  function makeNewProjectButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-button group-new";
    button.textContent = "New project";
    button.addEventListener("click", () => {
      elements.moveModeNew.checked = true;
      setSidebarOpen(false);
      setMovePanelOpen(true);
      updateSelectionUi();
      elements.newProjectName.focus();
    });
    return button;
  }

  function setMovePanelOpen(isOpen) {
    elements.movePanel.hidden = !isOpen;
    elements.moveToggle.setAttribute("aria-expanded", String(isOpen));
  }

  function makeProjectLabel(chat) {
    const label = document.createElement("span");
    label.className = "project-label";
    if (chat.projectId) {
      label.append(makeProjectMark(chat.projectId), projectNameOf(chat));
    } else {
      label.append(chat.hasOtherGizmo ? "None (may be a custom GPT)" : "None");
    }
    return label;
  }

  // Opens a chat in your ChatGPT tab and keeps you in Sift. Holding Command or Ctrl
  // opens a new tab as usual.
  function makeChatLink(chat, text) {
    const link = document.createElement("a");
    link.href = `https://chatgpt.com/c/${encodeURIComponent(chat.id)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text;
    link.addEventListener("click", async (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      const tab = await findChatTab().catch(() => null);
      if (tab) await chrome.tabs.update(tab.id, { url: link.href });
      else window.open(link.href, "_blank", "noopener,noreferrer");
    });
    return link;
  }

  function makeHeading(text) {
    const heading = document.createElement("div");
    heading.className = "group-heading";
    heading.textContent = text;
    return heading;
  }

  // Shift-clicking ticks or unticks every chat shown between the last click and this one.
  function tickRange(chatId, shouldTick) {
    const shown = state.visibleSelectableIds;
    const from = shown.indexOf(state.lastTickedId);
    const to = shown.indexOf(chatId);
    if (from === -1 || to === -1) return false;
    for (const id of shown.slice(Math.min(from, to), Math.max(from, to) + 1)) {
      if (shouldTick) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
    }
    state.lastTickedId = chatId;
    render();
    return true;
  }

  function makeChatRow(chat) {
    const row = document.createElement("tr");
    row.classList.toggle("is-selected", state.selectedIds.has(chat.id));

    const checkCell = row.insertCell();
    checkCell.className = "check-cell";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedIds.has(chat.id);
    checkbox.setAttribute("aria-label", `Select ${chat.title}`);
    checkbox.addEventListener("click", (event) => {
      if (event.shiftKey && tickRange(chat.id, checkbox.checked)) return;
      if (checkbox.checked) state.selectedIds.add(chat.id);
      else state.selectedIds.delete(chat.id);
      state.lastTickedId = chat.id;
      row.classList.toggle("is-selected", checkbox.checked);
      updateSelectionUi();
    });
    checkCell.append(checkbox);

    const titleCell = row.insertCell();
    titleCell.className = "title";
    titleCell.append(makeChatLink(chat, chat.title));
    const rowSub = document.createElement("div");
    rowSub.className = "row-sub";
    rowSub.append(makeProjectLabel(chat));
    titleCell.append(rowSub);

    const projectCell = row.insertCell();
    projectCell.className = "project-cell wide-only";
    projectCell.append(makeProjectLabel(chat));

    const createdCell = row.insertCell();
    createdCell.className = "date wide-only";
    createdCell.textContent = formatDate(chat.createdAt);
    const updatedCell = row.insertCell();
    updatedCell.className = "date";
    updatedCell.textContent = formatDate(chat.updatedAt);
    return row;
  }

  function updateSelectionUi() {
    const count = state.selectedIds.size;
    const visible = state.visibleSelectableIds;
    const visibleSelected = visible.filter((id) => state.selectedIds.has(id)).length;
    const hidden = count - visibleSelected;

    elements.selectionCount.textContent =
      `${plural(count, "chat")} selected` + (hidden > 0 ? ` (${hidden.toLocaleString()} not shown right now)` : "");
    elements.selectionBar.hidden = count === 0;
    const paused = (action) => OrganizerHealth.isPaused(action);
    elements.archiveButton.disabled = count === 0 || paused("archive");
    const archivedView = inArchivedView();
    const isNewProject = elements.moveModeNew.checked;
    elements.archiveButton.hidden = archivedView;
    elements.restoreButton.hidden = !archivedView;
    elements.restoreButton.disabled = count === 0 || paused("restore");
    elements.renameButton.disabled = count !== 1 || paused("rename");
    elements.moveTarget.hidden = isNewProject;
    elements.newProjectName.hidden = !isNewProject;
    elements.createProjectButton.hidden = !isNewProject;
    elements.createProjectButton.disabled = !elements.newProjectName.value.trim() || paused("createProject");
    elements.moveButton.textContent = isNewProject ? "Create and move…" : "Move selected…";
    elements.moveButton.disabled =
      count === 0 || paused("move") || (isNewProject && paused("createProject")) ||
      !(isNewProject ? elements.newProjectName.value.trim() : elements.moveTarget.value);
    elements.deleteButton.disabled = count === 0 || paused("delete");
    elements.backupButton.disabled = paused("backup");
    elements.archivedBackupButton.disabled = paused("backup");
    showHealth();
    elements.selectionClear.hidden = count === 0;

    elements.selectAll.disabled = visible.length === 0;
    elements.selectAll.checked = visible.length > 0 && visibleSelected === visible.length;
    elements.selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
  }

  function render() {
    const { groups, projectGroups, cleanupGroups, archived } = buildGroups();
    const allGroups = [...groups, ...projectGroups, ...cleanupGroups, archived];
    const selected = allGroups.find((group) => group.key === state.selectedGroup) || groups[0];
    state.selectedGroup = selected.key;

    const groupItems = groups.map(makeGroupButton);
    groupItems.push(makeProjectsHeading(projectGroups.length));
    if (!allProjectsLoaded() || state.isLoadingAll) groupItems.push(makeLoadAllButton());
    groupItems.push(...projectGroups.map(makeGroupButton), makeNewProjectButton());
    groupItems.push(makeHeading("Cleanup"), ...cleanupGroups.map(makeGroupButton));
    groupItems.push(makeHeading("Other"), makeGroupButton(archived));
    elements.groups.replaceChildren(...groupItems);

    const filters = readFilters();
    const filtering = OrganizerFilters.hasActiveFilters(filters);
    const visibleChats = OrganizerFilters.sortChats(
      OrganizerFilters.filterChats(selected.chats, filters),
      state.sort,
      projectNameOf
    );
    showSortState();
    const total = selected.chats.length.toLocaleString();
    const count = filtering ? `${visibleChats.length.toLocaleString()} of ${total}` : total;
    elements.groupTitle.textContent = `${selected.name} (${count})`;
    elements.rows.replaceChildren(...visibleChats.map(makeChatRow));
    elements.emptyNote.textContent = selected.notLoaded
      ? "Loading these chats…"
      : filtering ? "No chats match these filters." : "No chats here.";
    elements.emptyNote.hidden = visibleChats.length > 0;
    elements.filterClear.hidden = !filtering;
    elements.library.hidden = state.showingResults;

    state.visibleSelectableIds = visibleChats.map((chat) => chat.id);
    elements.archivedBackupButton.hidden = !inArchivedView();
    updateSelectionUi();
    renderContentResults();
  }

  function showSortState() {
    for (const heading of document.querySelectorAll("th[data-sort-key]")) {
      if (heading.dataset.sortKey === state.sort.key) {
        heading.setAttribute("aria-sort", state.sort.direction === "desc" ? "descending" : "ascending");
      } else {
        heading.removeAttribute("aria-sort");
      }
    }
  }

  function setSort(key, direction) {
    state.sort = { key, direction };
    saveChoices();
    render();
  }

  function saveChoices() {
    state.settings = { ...state.settings, sort: state.sort, projectsDescending: state.projectsDescending };
    OrganizerSettings.saveSettings(state.settings);
  }

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  function openMode() {
    return state.settings.openMode === "tabs" ? "tabs" : "split";
  }

  async function loadChoices() {
    state.settings = await OrganizerSettings.loadSettings();
    const { theme = "system", sort, projectsDescending } = state.settings;
    applyTheme(theme);
    const themeInput = document.querySelector(`input[name="theme"][value="${theme}"]`);
    if (themeInput) themeInput.checked = true;
    if (sort && SORT_FIRST_DIRECTION[sort.key] && (sort.direction === "asc" || sort.direction === "desc")) state.sort = sort;
    state.projectsDescending = projectsDescending === true;
    const modeInput = document.querySelector(`input[name="open-mode"][value="${openMode()}"]`);
    if (modeInput) modeInput.checked = true;
    const scopeInput = document.querySelector(`input[name="load-scope"][value="${state.settings.loadScope === "everything" ? "everything" : "basic"}"]`);
    if (scopeInput) scopeInput.checked = true;
    showSortState();
    if (state.chats.length) render();
  }

  // Waits briefly, because a ChatGPT tab that just opened needs a moment to get ready.
  async function loadAutomatically() {
    for (let second = 0; second < AUTO_LOAD_WAIT_SECONDS; second += 1) {
      const tab = await findChatGptTab().catch(() => null);
      if (tab) {
        await load();
        return;
      }
      await sleep(1000);
    }
    showStatus('Couldn\'t reach ChatGPT yet. Make sure you\'re logged in, then click "Load my chats".');
  }

  function saveGuideProgress(step) {
    state.settings = { ...state.settings, guide: { ...state.settings.guide, [step]: true } };
    OrganizerSettings.saveSettings(state.settings);
    showGuideProgress();
  }

  function showGuideProgress() {
    const progress = state.settings.guide || {};
    for (const step of ["folder", "backup", "related"]) {
      byId(`guide-step-${step}`).classList.toggle("is-done", progress[step] === true);
    }
  }

  async function setUpGuide() {
    elements.guide.hidden = state.settings.guideDismissed === true;
    const folder = await OrganizerBackup.getSavedFolder(state.account?.key).catch(() => null);
    showFolderName(folder, null);
    if (folder && state.settings.guide?.folder !== true) saveGuideProgress("folder");
    showGuideProgress();
  }

  function setSettingsOpen(isOpen) {
    elements.settingsPanel.hidden = !isOpen;
    elements.settingsButton.setAttribute("aria-expanded", String(isOpen));
  }

  async function showThisPage() {
    try {
      const tab = await chrome.tabs.getCurrent();
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      await applyOpenMode();
    } catch {
      // The page is still open, so you can switch to it yourself.
    }
  }

  // Picks the ChatGPT tab to use: the one sharing a split with Sift, then one in
  // this window, then any other.
  async function findChatTab() {
    const [tabs, mine] = await Promise.all([chrome.tabs.query({ url: "https://chatgpt.com/*" }), chrome.tabs.getCurrent()]);
    const none = chrome.tabs.SPLIT_VIEW_ID_NONE;
    const inMySplit = mine.splitViewId !== undefined && mine.splitViewId !== none
      ? tabs.find((tab) => tab.splitViewId === mine.splitViewId)
      : null;
    const inMyWindow = tabs.filter((tab) => tab.windowId === mine.windowId);
    return inMySplit || inMyWindow.find((tab) => tab.active) || inMyWindow[0] || tabs.find((tab) => tab.active) || tabs[0] || null;
  }

  async function findOrOpenChatTab(mine) {
    const existing = await findChatTab();
    if (existing) return existing;
    showStatus('Opening ChatGPT. Log in if needed, then click "Load my chats".');
    return chrome.tabs.create({ windowId: mine.windowId, index: mine.index, url: "https://chatgpt.com/", active: false });
  }

  // Why two tabs can't be split, in words, or null if they can. Chrome only splits
  // matching tabs, and Sift never unpins or regroups your tabs.
  function splitProblem(chatTab, mine) {
    const none = chrome.tabs.SPLIT_VIEW_ID_NONE;
    if (chatTab.splitViewId !== undefined && chatTab.splitViewId !== none && chatTab.splitViewId !== mine.splitViewId) {
      return "Your ChatGPT tab is already in another Split View, so Sift opened as a separate tab.";
    }
    if (chatTab.pinned !== mine.pinned) return "Your ChatGPT tab is pinned, so Sift opened as a separate tab. Unpin it to use Split View.";
    return null;
  }

  async function enterSplitView() {
    if (typeof chrome.tabs.createSplit !== "function") {
      showStatus("Split View needs Chrome 155 or newer, so Sift opened as a separate tab. Updating Chrome should turn it on.", true);
      return;
    }
    let mine = await chrome.tabs.getCurrent();
    let chatTab = await findOrOpenChatTab(mine);
    const none = chrome.tabs.SPLIT_VIEW_ID_NONE;
    if (mine.splitViewId !== none && chatTab.splitViewId === mine.splitViewId) return;

    const problem = splitProblem(chatTab, mine);
    if (problem) {
      showStatus(problem, true);
      return;
    }
    if (mine.splitViewId !== none) await chrome.tabs.unsplit(mine.splitViewId);

    // Puts ChatGPT directly before Sift, which keeps it on the left. Moving doesn't reload it.
    mine = await chrome.tabs.getCurrent();
    chatTab = await chrome.tabs.get(chatTab.id);
    const sameWindow = chatTab.windowId === mine.windowId;
    if (!sameWindow || chatTab.index !== mine.index - 1) {
      const index = sameWindow && chatTab.index < mine.index ? mine.index - 1 : mine.index;
      await chrome.tabs.move(chatTab.id, { windowId: mine.windowId, index });
      mine = await chrome.tabs.getCurrent();
      chatTab = await chrome.tabs.get(chatTab.id);
    }
    if (chatTab.groupId !== mine.groupId) {
      showStatus("Your ChatGPT tab is in a tab group, so Sift opened as a separate tab. Remove it from the group to use Split View.", true);
      return;
    }
    await chrome.tabs.createSplit([chatTab.id, mine.id]);
  }

  async function leaveSplitView() {
    const mine = await chrome.tabs.getCurrent();
    if (mine.splitViewId !== undefined && mine.splitViewId !== chrome.tabs.SPLIT_VIEW_ID_NONE) {
      await chrome.tabs.unsplit(mine.splitViewId);
    }
    await findOrOpenChatTab(mine);
  }

  async function applyOpenMode() {
    try {
      if (openMode() === "split") await enterSplitView();
      else await leaveSplitView();
    } catch {
      showStatus("Chrome couldn't set up the tabs. You can still use Sift as a separate tab.", true);
    }
  }

  function fillMoveTargets() {
    const chosen = elements.moveTarget.value;
    const [placeholder] = elements.moveTarget.options;
    const options = [...state.projects]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, COMPARE_NAMES))
      .map((project) => {
        const option = document.createElement("option");
        option.value = project.id;
        const name = document.createElement("span");
        name.textContent = project.name;
        option.append(makeProjectMark(project.id), name);
        return option;
      });
    elements.moveTarget.replaceChildren(placeholder, ...options);
    const stillValid = state.projects.some((project) => project.id === chosen);
    elements.moveTarget.value = stillValid ? chosen : "";
  }

  function showWarnings(warnings) {
    elements.warnings.replaceChildren(
      ...warnings.map((warning) => {
        const item = document.createElement("li");
        item.textContent = warning;
        return item;
      })
    );
    elements.warnings.hidden = warnings.length === 0;
  }

  async function readAccount(tab) {
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: "organizer-account" });
      // No answer at all means the helper in that tab was loaded before this version of Sift.
      if (reply === undefined) OrganizerHealth.noteOldHelper();
      const result = OrganizerHealth.observeAccount(reply);
      const key = result?.ok ? OrganizerAccounts.accountKey(result.data) : null;
      return key ? { key, name: OrganizerAccounts.displayName(result.data) } : null;
    } catch {
      return null;
    }
  }

  // Switches Sift to an account. Nothing worked out for the last account carries over.
  function useAccount(account) {
    const changed = state.account?.key !== account?.key;
    state.account = account;
    OrganizerLog.setAccount(account?.name);
    elements.accountLabel.textContent = account ? account.name : "";
    elements.accountLabel.hidden = !account;
    if (!changed) return;
    state.selectedIds.clear();
    state.selectedGroup = "all";
    state.shortChatIds = null;
    state.backupFolder = null;
    state.backupLocations = {};
    state.contentResults = [];
    state.relatedResults = [];
    state.showingResults = false;
    state.deletedThisSession.clear();
    elements.contentSearch.hidden = true;
    elements.contentSearchClear.hidden = true;
    showSavedFolder();
  }

  async function showSavedFolder() {
    if (!state.account) {
      showFolderName(null, null);
      return;
    }
    const main = await OrganizerBackup.getSavedFolder(state.account.key).catch(() => null);
    showFolderName(main, null);
  }

  // Stops anything being written for the wrong account if someone switched in the ChatGPT tab.
  async function confirmAccount() {
    if (!state.account) {
      showStatus("Sift can't tell which ChatGPT account is logged in yet, so nothing was changed. Reload your chats and try again.", true);
      return false;
    }
    const tab = await findChatGptTab().catch(() => null);
    if (!tab) return true;
    const current = await readAccount(tab);
    if (current?.key === state.account.key) return true;
    showStatus("Your ChatGPT account has changed, so nothing was changed. Reloading your chats for the new account…", true);
    await load();
    return false;
  }

  async function load() {
    if (elements.loadButton.disabled) return;
    elements.loadButton.disabled = true;
    state.loadGeneration += 1;
    state.stopLoadingAll = true;
    OrganizerHealth.reset();
    if (state.chromeVersionIsOld) OrganizerHealth.noteOldVersion();
    showHealth();
    showWarnings([]);
    showStatus("Looking for your chatgpt.com tab…");
    try {
      const tab = await findChatGptTab();
      if (!tab) {
        showStatus(
          "Couldn't connect to ChatGPT. Open chatgpt.com in another tab (or reload it if it's already open), then click the button again.",
          true
        );
        return;
      }

      const account = await readAccount(tab);
      const everything = state.settings.loadScope === "everything";
      const api = createApiFor(tab);
      const library = everything ? await api.loadLibrary() : await api.loadBasics();
      useAccount(account);
      state.projects = library.projects;
      state.chats = library.chats;
      state.projectSeeds = new Map((library.projectSeeds || []).map((seed) => [seed.id, seed]));
      state.loadedProjects = new Set(everything ? library.projects.map((project) => project.id) : []);
      state.archivedLoaded = everything;
      if (!everything) OrganizerHealth.noteFact("projectChatsInBasicList", library.projectChatsSkipped);

      // Drop any selection that no longer applies, such as a chat archived since the last load.
      const stillSelectable = new Set(library.chats.filter((chat) => chat.isArchived === inArchivedView()).map((chat) => chat.id));
      state.selectedIds = new Set([...state.selectedIds].filter((id) => stillSelectable.has(id)));

      showWarnings(library.warnings);
      showStatus(
        everything
          ? `Loaded ${plural(library.chats.length, "chat")} and ${plural(library.projects.length, "project")}${account ? ` for ${account.name}` : ""}.`
          : `Loaded ${plural(library.chats.length, "chat")} not in projects${account ? ` for ${account.name}` : ""}. Click a project to load its chats.`
      );
      elements.loadButton.textContent = "Reload my chats";
      elements.backupButton.hidden = false;
      elements.contentSearchFormElement.hidden = false;
      fillMoveTargets();
      render();
      ensureGroupLoaded(state.selectedGroup);
    } catch (error) {
      const message = error instanceof OrganizerApi.ApiError
        ? error.message
        : "Lost connection to your chatgpt.com tab. Keep that tab open, reload it and try again.";
      showStatus(message, true);
    } finally {
      elements.loadButton.disabled = false;
      if (state.chats.length && !state.account && !OrganizerHealth.hasProblem("oldHelper")) OrganizerHealth.noteAccountMissing();
      if (state.chats.length) updateSelectionUi();
      showHealth();
    }
  }

  function formatDuration(seconds) {
    if (seconds < 60) return "less than a minute";
    const minutes = Math.ceil(seconds / 60);
    return `about ${plural(minutes, "minute")}`;
  }

  function setDialogMessage(message, isError = false) {
    elements.dialogMessage.textContent = message;
    elements.dialogMessage.classList.toggle("error", isError);
    elements.dialogMessage.hidden = !message;
  }

  function setDialogButtons({ cancel = false, confirm = false, stop = false, close = false, changeFolder = false, typedConfirm = false, renameField = false, readText = false, backupChoice = false, secondary = false }) {
    elements.dialogSecondary.hidden = !secondary;
    elements.deleteChoice.hidden = !backupChoice;
    elements.deleteChoiceBackup.checked = false;
    elements.deleteChoiceSkip.checked = false;
    elements.dialogText.hidden = !readText;
    elements.dialogTyped.hidden = !typedConfirm;
    elements.dialogRename.hidden = !renameField;
    elements.dialogTypedInput.value = "";
    elements.dialogConfirm.classList.toggle("danger", typedConfirm);
    elements.dialogChangeFolder.hidden = !changeFolder;
    elements.dialogCancel.hidden = !cancel;
    elements.dialogConfirm.hidden = !confirm;
    elements.dialogStop.hidden = !stop;
    elements.dialogClose.hidden = !close;
  }

  // Gets the backup folder and its index, or returns null after explaining the problem.
  async function openBackupFolder() {
    const folder = await getBackupFolder();
    if (!folder) return null;
    try {
      return { folder, index: await OrganizerBackup.readIndex(folder) };
    } catch {
      showStatus("Couldn't read the backup index in that folder, so nothing was changed. Try choosing a new, empty folder.", true);
      return null;
    }
  }

  // Shows a message and returns true if too many chats are selected for one run.
  function blockTooMany(count, limit, word) {
    if (count <= limit) return false;
    elements.dialogList.hidden = true;
    elements.dialogTitle.textContent = `Too many chats for one ${word} run`;
    elements.dialogIntro.textContent =
      `To stay careful, one run handles up to ${limit} chats, and you've selected ${count.toLocaleString()}. Nothing was changed. Please untick some and try again.`;
    setDialogMessage("");
    setDialogButtons({ close: true });
    elements.dialog.showModal();
    elements.dialogClose.focus();
    return true;
  }

  async function openPreview() {
    const opened = await openBackupFolder();
    if (!opened) return;
    const { folder, index } = opened;

    state.previewChats = state.chats.filter((chat) => state.selectedIds.has(chat.id) && !chat.isArchived);
    const count = state.previewChats.length;
    if (count === 0 || blockTooMany(count, ARCHIVE_CHATS_PER_RUN, "archive")) return;

    elements.dialogList.hidden = false;
    elements.dialogTitle.textContent = `Back up and archive ${plural(count, "chat")}?`;
    elements.dialogIntro.textContent =
      `These are exactly the chats that will be archived. Each one is saved to the "${OrganizerBackup.ARCHIVED_FOLDER}" folder inside "${folder.name}" first, and the run stops if anything goes wrong. They'll leave your ChatGPT sidebar but won't be deleted, and you can restore them here. This takes a few seconds per chat, and longer for long chats.`;

    elements.dialogList.replaceChildren(
      ...state.previewChats.map((chat) => {
        const item = document.createElement("li");
        item.dataset.chatId = chat.id;
        item.append(chat.title);
        const projectName = projectNameOf(chat);
        if (projectName) {
          const project = document.createElement("span");
          project.className = "dialog-project";
          project.textContent = ` (${projectName})`;
          item.append(project);
        }
        return item;
      })
    );

    state.dialogAction = () => runArchive(folder, index);
    elements.dialogConfirm.textContent = `Yes, back up and archive ${plural(count, "chat")}`;
    elements.dialogConfirm.disabled = false;
    elements.dialogStop.disabled = false;
    elements.dialogStop.textContent = "Stop after this chat";
    setDialogMessage("");
    setDialogButtons({ cancel: true, confirm: true });
    elements.dialog.showModal();
    elements.dialogCancel.focus();
  }

  async function openRestorePreview() {
    const opened = await openBackupFolder();
    if (!opened) return;
    const { folder, index } = opened;

    state.previewChats = state.chats.filter((chat) => state.selectedIds.has(chat.id) && chat.isArchived);
    const count = state.previewChats.length;
    if (count === 0) return;

    elements.dialogList.hidden = false;
    elements.dialogTitle.textContent = `Restore ${plural(count, "chat")} to your regular chats?`;
    elements.dialogIntro.textContent =
      `These are exactly the chats that will stop being archived. Any backup file they have moves from "${OrganizerBackup.ARCHIVED_FOLDER}" back to "${OrganizerBackup.CHATS_FOLDER}". This will take ${formatDuration(OrganizerApi.estimatePacedSeconds(count))}.`;
    elements.dialogList.replaceChildren(
      ...state.previewChats.map((chat) => {
        const item = document.createElement("li");
        item.dataset.chatId = chat.id;
        item.append(chat.title);
        return item;
      })
    );

    state.dialogAction = () => runRestore(folder, index);
    elements.dialogConfirm.textContent = `Yes, restore ${plural(count, "chat")}`;
    elements.dialogConfirm.disabled = false;
    elements.dialogStop.disabled = false;
    elements.dialogStop.textContent = "Stop after this chat";
    setDialogMessage("");
    setDialogButtons({ cancel: true, confirm: true });
    elements.dialog.showModal();
    elements.dialogCancel.focus();
  }

  function openRenamePreview() {
    const chat = state.chats.find((candidate) => state.selectedIds.has(candidate.id));
    if (state.selectedIds.size !== 1 || !chat) return;
    state.previewChats = [chat];

    elements.dialogList.hidden = false;
    elements.dialogTitle.textContent = "Rename this chat?";
    elements.dialogIntro.textContent = `This changes the chat's name in ChatGPT.${chat.isArchived ? " It stays archived." : ""} Any backup file keeps its current file name.`;
    const item = document.createElement("li");
    item.dataset.chatId = chat.id;
    item.append(chat.title);
    elements.dialogList.replaceChildren(item);

    state.dialogAction = () => runRename(elements.dialogRenameInput.value.trim());
    elements.dialogConfirm.textContent = "Yes, rename it";
    elements.dialogConfirm.disabled = true;
    elements.dialogStop.disabled = false;
    elements.dialogStop.textContent = "Stop after this chat";
    setDialogMessage("");
    setDialogButtons({ cancel: true, confirm: true, renameField: true });
    elements.dialogRenameInput.value = chat.title;
    elements.dialog.showModal();
    elements.dialogRenameInput.select();
  }

  function markDialogResult(chatId, text, isFailure) {
    const item = [...elements.dialogList.children].find((child) => child.dataset.chatId === chatId);
    if (!item) return;
    const result = document.createElement("span");
    result.className = isFailure ? "dialog-result failed" : "dialog-result";
    result.textContent = ` — ${text}`;
    item.append(result);
    item.scrollIntoView({ block: "nearest" });
  }

  // Shows a message and returns true if a project with this name already exists.
  function blockDuplicateName(name) {
    const sameName = state.projects.find((project) => project.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!sameName) return false;
    elements.dialogList.hidden = true;
    elements.dialogTitle.textContent = "That project already exists";
    elements.dialogIntro.textContent = `You already have a project called "${sameName.name}". Choose "Existing project" and pick it from the menu, or type a different name.`;
    setDialogMessage("");
    setDialogButtons({ close: true });
    elements.dialog.showModal();
    elements.dialogClose.focus();
    return true;
  }

  function openCreateProjectPreview() {
    const name = elements.newProjectName.value.trim();
    if (!name || blockDuplicateName(name)) return;
    setMovePanelOpen(false);

    elements.dialogList.hidden = true;
    elements.dialogTitle.textContent = `Create the project "${name}"?`;
    elements.dialogIntro.textContent = "This creates a new, empty project in ChatGPT. No chats are moved or changed.";
    state.dialogAction = () => runCreateProject(name, { thenMove: false });
    elements.dialogConfirm.textContent = "Yes, create it";
    elements.dialogConfirm.disabled = false;
    setDialogMessage("");
    setDialogButtons({ cancel: true, confirm: true });
    elements.dialog.showModal();
    elements.dialogCancel.focus();
  }

  function openMovePreview() {
    const isNewProject = elements.moveModeNew.checked;
    const newName = elements.newProjectName.value.trim();
    // The hidden menu can still hold an earlier choice, so ignore it when creating a project.
    const target = isNewProject ? null : state.projects.find((project) => project.id === elements.moveTarget.value);
    if (isNewProject ? !newName : !target) return;

    if (isNewProject && blockDuplicateName(newName)) return;
    setMovePanelOpen(false);

    const selected = state.chats.filter((chat) => state.selectedIds.has(chat.id));
    const alreadyThere = target ? selected.filter((chat) => chat.projectId === target.id) : [];
    const possibleGpt = selected.filter((chat) => chat.hasOtherGizmo);
    const movable = selected.filter((chat) => chat.projectId !== target?.id && !chat.hasOtherGizmo);
    state.previewChats = movable;

    const skipped = [];
    if (alreadyThere.length) skipped.push(`${plural(alreadyThere.length, "chat")} already in this project`);
    if (possibleGpt.length) skipped.push(`${plural(possibleGpt.length, "chat")} that may be linked to a custom GPT, because moving could overwrite that link`);
    const skippedNote = skipped.length ? ` Skipping ${skipped.join(" and ")}.` : "";

    const count = movable.length;
    const targetName = target ? target.name : newName;
    elements.dialogTitle.textContent = !count
      ? "Nothing to move"
      : isNewProject
        ? `Create "${targetName}" and move ${plural(count, "chat")} into it?`
        : `Move ${plural(count, "chat")} to "${targetName}"?`;
    elements.dialogIntro.textContent = count
      ? `${isNewProject ? "This creates a new, empty project. " : ""}These are exactly the chats that will move. ${inArchivedView() ? "They should stay archived. " : ""}They may then use that project's instructions and files, and you can move them again later. This will take ${formatDuration(OrganizerApi.estimatePacedSeconds(count))}.${skippedNote}`
      : `None of the selected chats can be moved${isNewProject ? ", so no project was created" : ""}.${skippedNote}`;

    elements.dialogList.hidden = count === 0;
    elements.dialogList.replaceChildren(
      ...movable.map((chat) => {
        const item = document.createElement("li");
        item.dataset.chatId = chat.id;
        item.append(chat.title);
        const from = document.createElement("span");
        from.className = "dialog-project";
        from.textContent = ` (from ${projectNameOf(chat) || "no project"})`;
        item.append(from);
        return item;
      })
    );

    state.dialogAction = isNewProject ? () => runCreateProject(newName, { thenMove: true }) : () => runMove(target);
    elements.dialogConfirm.textContent = isNewProject
      ? `Yes, create it and move ${plural(count, "chat")}`
      : `Yes, move ${plural(count, "chat")}`;
    elements.dialogConfirm.disabled = false;
    elements.dialogStop.disabled = false;
    elements.dialogStop.textContent = "Stop after this chat";
    setDialogMessage("");
    setDialogButtons(count ? { cancel: true, confirm: true } : { close: true });
    elements.dialog.showModal();
    (count ? elements.dialogCancel : elements.dialogClose).focus();
  }

  // Creates the project first. If that fails, no chats are touched.
  async function runCreateProject(name, { thenMove }) {
    elements.dialogConfirm.disabled = true;
    let tab = null;
    try {
      tab = await findChatGptTab();
    } catch {
      tab = null;
    }
    if (!tab) {
      elements.dialogConfirm.disabled = false;
      setDialogMessage("Nothing was changed. Couldn't find your chatgpt.com tab, so open or reload it and try again.", true);
      return;
    }

    state.isRunning = true;
    setDialogButtons({});
    elements.dialogTitle.textContent = "Creating the project…";
    elements.dialogIntro.textContent = "Keep this tab and your chatgpt.com tab open until it finishes.";
    setDialogMessage("");

    let project;
    let problem = null;
    try {
      project = await createApiFor(tab, setDialogMessage).createProject(name);
    } catch (error) {
      problem = error instanceof OrganizerApi.ApiError
        ? error.message
        : "Lost connection to your chatgpt.com tab. Check your projects in ChatGPT before trying again.";
    }

    try {
      await OrganizerLog.addEntry({
        action: "create project",
        result: problem ? "failed" : "success",
        chatId: "",
        title: name,
        project: problem ? "" : name,
        detail: problem || `Project ID ${project.id}`,
      });
    } catch {
      problem = problem || `The project "${name}" was created, but the action log couldn't be saved${thenMove ? ", so no chats were moved" : ""}.`;
    }

    if (project) {
      state.projects.push({ id: project.id, name });
      state.loadedProjects.add(project.id);
      fillMoveTargets();
      elements.moveTarget.value = project.id;
      elements.moveModeExisting.checked = true;
      elements.newProjectName.value = "";
      render();
    }
    await renderLog();

    if (problem) {
      state.isRunning = false;
      elements.dialogTitle.textContent = "Stopped early";
      elements.dialogIntro.textContent = thenMove ? "No chats were moved." : "No chats were changed.";
      setDialogMessage(problem, true);
      setDialogButtons({ close: true });
      elements.dialogClose.focus();
      return;
    }

    if (!thenMove) {
      state.isRunning = false;
      elements.dialogTitle.textContent = "Done";
      elements.dialogIntro.textContent = "Your ChatGPT sidebar may not update until you reload it.";
      setDialogMessage(`Created "${name}". It's now chosen in the project menu.`);
      setDialogButtons({ close: true });
      elements.dialogClose.focus();
      return;
    }

    await sleep(1500);
    await runMove(project);
  }

  async function openDeletePreview() {
    const opened = await openBackupFolder();
    if (!opened) return;
    const { folder, index } = opened;

    const chats = state.chats.filter((chat) => state.selectedIds.has(chat.id));
    const count = chats.length;
    if (count === 0) return;
    state.previewChats = chats;
    setDialogMessage("");

    if (blockTooMany(count, DELETE_CHATS_PER_RUN, "delete")) return;

    const statuses = new Map(chats.map((chat) => [chat.id, OrganizerBackup.backupStatus(chat, index)]));
    const needsAnswer = chats.filter((chat) => statuses.get(chat.id) !== "current");
    state.deleteCounts = { total: count, needsAnswer: needsAnswer.length };

    elements.dialogList.hidden = false;
    elements.dialogTitle.textContent = `Permanently delete ${plural(count, "chat")}?`;
    elements.dialogIntro.textContent =
      `Deleted chats can't be restored in ChatGPT, on any of your devices. Backups can't be restored into ChatGPT, and they leave out images and uploaded files. Archiving is the safer choice if you might want these chats again.`;
    const labels = { current: "Backed up", older: "Older backup", none: "No backup" };
    const chatsNeedingAnswerFirst = [...needsAnswer, ...chats.filter((chat) => statuses.get(chat.id) === "current")];
    state.previewChats = chatsNeedingAnswerFirst;
    elements.dialogList.replaceChildren(
      ...chatsNeedingAnswerFirst.map((chat) => {
        const item = document.createElement("li");
        item.dataset.chatId = chat.id;
        item.append(chat.title);
        const status = statuses.get(chat.id);
        const label = document.createElement("span");
        label.className = status === "current" ? "dialog-backup-status" : "dialog-backup-status needs-backup";
        label.textContent = ` (${labels[status]})`;
        item.append(label);
        const projectName = projectNameOf(chat);
        if (projectName) {
          const project = document.createElement("span");
          project.className = "dialog-project";
          project.textContent = ` (${projectName})`;
          item.append(project);
        }
        return item;
      })
    );

    state.dialogAction = () => runDelete(folder, index, statuses, elements.deleteChoiceBackup.checked);
    elements.dialogStop.disabled = false;
    elements.dialogStop.textContent = "Stop after this chat";
    setDialogButtons({ cancel: true, confirm: true, typedConfirm: true, backupChoice: needsAnswer.length > 0 });
    elements.deleteQuestion.textContent = needsAnswer.length === 1
      ? "1 of these chats has no up-to-date backup. What should happen to it?"
      : `${needsAnswer.length.toLocaleString()} of these chats have no up-to-date backup. What should happen to them?`;
    updateDeleteConfirm();
    elements.dialog.showModal();
    (needsAnswer.length ? elements.deleteChoiceBackup : elements.dialogTypedInput).focus();
  }

  // The red button stays off until the backup question is answered and DELETE is typed.
  function updateDeleteConfirm() {
    const { total, needsAnswer } = state.deleteCounts;
    const backingUp = elements.deleteChoiceBackup.checked;
    const answered = needsAnswer === 0 || backingUp || elements.deleteChoiceSkip.checked;
    elements.dialogConfirm.disabled = !answered || elements.dialogTypedInput.value !== DELETE_WORD;
    if (backingUp) {
      elements.dialogConfirm.textContent = `Back up ${needsAnswer.toLocaleString()} and permanently delete ${plural(total, "chat")}`;
    } else if (elements.deleteChoiceSkip.checked) {
      elements.dialogConfirm.textContent = `Permanently delete ${plural(total, "chat")}, ${needsAnswer.toLocaleString()} with no up-to-date backup`;
    } else {
      elements.dialogConfirm.textContent = `Permanently delete ${plural(total, "chat")}`;
    }
  }

  // The backup steps shared by archiving and deleting. The file stays in its usual
  // folder until ChatGPT confirms the change, so "Archived" and "Deleted" never
  // hold a chat whose change didn't happen.
  function makeBackupSteps(folder, index, destination) {
    const paths = new Map();
    const notes = new Map();
    return {
      saveBackup: async (chat, fullChat) => {
        await OrganizerBackup.saveChat(folder, index, chat, fullChat);
        await OrganizerBackup.verifySavedChat(folder, index, chat.id, fullChat);
        paths.set(chat.id, OrganizerBackup.backupPath(index, chat.id));
      },
      beforeLog: async (chat, failure) => {
        if (failure || !paths.has(chat.id)) return;
        try {
          await OrganizerBackup.moveChatFile(folder, index, chat.id, destination);
          paths.set(chat.id, OrganizerBackup.backupPath(index, chat.id));
        } catch {
          notes.set(chat.id, ` (couldn't be moved to ${destination})`);
        }
      },
      // Files a backup that already exists, once the change is confirmed.
      track: (chat) => paths.set(chat.id, OrganizerBackup.backupPath(index, chat.id)),
      describe: (chat) => {
        const path = paths.get(chat.id);
        return path ? `Backup: ${path}${notes.get(chat.id) || ""}` : "No backup saved";
      },
    };
  }

  function runDelete(folder, index, statuses, backUpMissing) {
    const steps = makeBackupSteps(folder, index, OrganizerBackup.DELETED_FOLDER);
    const needsBackup = (chat) => backUpMissing && statuses.get(chat.id) !== "current";
    for (const chat of state.previewChats) {
      if (index.chats[chat.id]) steps.track(chat);
    }
    return runChange({
      runningTitle: backUpMissing ? "Backing up and deleting…" : "Deleting…",
      doneWord: "Deleted",
      start: (api, chats, options) => api.deleteChats(chats, { ...options, saveBackup: steps.saveBackup, needsBackup }),
      beforeLog: steps.beforeLog,
      logEntry: (chat, failure) => {
        const status = statuses.get(chat.id);
        const skipped = !backUpMissing && status !== "current";
        const description = skipped && status === "none"
          ? "No backup, by your choice"
          : `${steps.describe(chat)}${skipped ? " (older copy, by your choice)" : ""}`;
        return {
          action: "delete",
          result: failure ? "failed" : "success",
          chatId: chat.id,
          title: chat.title,
          project: projectNameOf(chat),
          detail: failure ? `${failure} ${description}` : description,
        };
      },
      apply: (chat) => {
        state.chats = state.chats.filter((other) => other.id !== chat.id);
        state.deletedThisSession.add(chat.id);
      },
    });
  }

  function runArchive(folder, index) {
    const steps = makeBackupSteps(folder, index, OrganizerBackup.ARCHIVED_FOLDER);
    return runChange({
      runningTitle: "Backing up and archiving…",
      doneWord: "Archived",
      start: (api, chats, options) => api.archiveChats(chats, { ...options, saveBackup: steps.saveBackup }),
      beforeLog: steps.beforeLog,
      logEntry: (chat, failure) => ({
        action: "archive",
        result: failure ? "failed" : "success",
        chatId: chat.id,
        title: chat.title,
        project: projectNameOf(chat),
        detail: failure ? `${failure} ${steps.describe(chat)}` : steps.describe(chat),
      }),
      apply: (chat) => {
        chat.isArchived = true;
      },
    });
  }

  function runRestore(folder, index) {
    const fileNotes = new Map();
    return runChange({
      runningTitle: "Restoring…",
      doneWord: "Restored",
      start: (api, chats, options) => api.restoreChats(chats, options),
      beforeLog: async (chat, failure) => {
        if (failure || !index.chats[chat.id]) return;
        try {
          await OrganizerBackup.moveChatFile(folder, index, chat.id, OrganizerBackup.CHATS_FOLDER);
          fileNotes.set(chat.id, `Backup: ${OrganizerBackup.backupPath(index, chat.id)}`);
        } catch {
          // The next backup run moves it, because the chat is active again.
          fileNotes.set(chat.id, `Backup file couldn't be moved to ${OrganizerBackup.CHATS_FOLDER} yet`);
        }
      },
      logEntry: (chat, failure) => ({
        action: "restore",
        result: failure ? "failed" : "success",
        chatId: chat.id,
        title: chat.title,
        project: projectNameOf(chat),
        detail: failure || fileNotes.get(chat.id) || "No backup file",
      }),
      apply: (chat) => {
        chat.isArchived = false;
      },
    });
  }

  function runRename(title) {
    return runChange({
      runningTitle: "Renaming…",
      doneWord: "Renamed",
      start: (api, chats, options) => api.renameChats(chats, title, options),
      logEntry: (chat, failure) => ({
        action: "rename",
        result: failure ? "failed" : "success",
        chatId: chat.id,
        title: `${chat.title} → ${title}`,
        project: projectNameOf(chat),
        detail: failure || "",
      }),
      apply: (chat) => {
        chat.title = title;
      },
    });
  }

  function runMove(target) {
    return runChange({
      runningTitle: "Moving…",
      doneWord: "Moved",
      start: (api, chats, options) => api.moveChats(chats, target.id, options),
      logEntry: (chat, failure) => ({
        action: "move",
        result: failure ? "failed" : "success",
        chatId: chat.id,
        title: chat.title,
        project: target.name,
        detail: failure || `Moved from ${projectNameOf(chat) || "no project"}`,
      }),
      apply: (chat) => {
        chat.projectId = target.id;
        chat.gizmoId = target.id;
        chat.hasOtherGizmo = false;
      },
    });
  }

  // The shared steps for any change to chats: run it slowly, show each result, keep the log.
  async function runChange({ runningTitle, doneWord, start, beforeLog, logEntry, apply }) {
    const chats = state.previewChats;
    const lowerWord = doneWord.toLowerCase();
    elements.dialogConfirm.disabled = true;

    let tab = null;
    try {
      tab = await findChatGptTab();
    } catch {
      tab = null;
    }
    if (!tab) {
      elements.dialogConfirm.disabled = false;
      setDialogMessage("Nothing was changed. Couldn't find your chatgpt.com tab, so open or reload it and try again.", true);
      return;
    }

    state.isRunning = true;
    state.stopRequested = false;
    setDialogButtons({ stop: true });
    elements.dialogTitle.textContent = runningTitle;
    elements.dialogIntro.textContent = "Keep this tab and your chatgpt.com tab open until it finishes.";
    setDialogMessage(`${doneWord} 0 of ${chats.length.toLocaleString()}`);

    let done = 0;
    const api = createApiFor(tab, setDialogMessage);
    const outcome = await start(api, chats, {
      shouldStop: () => state.stopRequested,
      onResult: async (chat, failure) => {
        await beforeLog?.(chat, failure);
        // The entry is built first, because it describes the chat before this change.
        const entry = logEntry(chat, failure);
        if (!failure) {
          done += 1;
          apply(chat);
          state.selectedIds.delete(chat.id);
        }
        markDialogResult(chat.id, failure ? "failed" : lowerWord, Boolean(failure));
        setDialogMessage(`${doneWord} ${done.toLocaleString()} of ${chats.length.toLocaleString()}`);
        await OrganizerLog.addEntry(entry);
      },
    });
    state.isRunning = false;

    for (const chat of outcome.notAttempted) markDialogResult(chat.id, "not attempted", false);

    const summary = `${doneWord} ${outcome.succeeded.length.toLocaleString()} of ${chats.length.toLocaleString()}.`;
    elements.dialogTitle.textContent = outcome.stopReason ? "Stopped early" : "Done";
    const leftOver = outcome.failed.length + outcome.notAttempted.length;
    elements.dialogIntro.textContent =
      "Your ChatGPT sidebar may not update until you reload it." +
      (leftOver > 0 ? ` Chats that weren't ${lowerWord} stay selected.` : "");
    setDialogMessage(outcome.stopReason ? `${summary} ${outcome.stopReason}` : summary, Boolean(outcome.failed.length));
    setDialogButtons({ close: true });
    elements.dialogClose.focus();

    render();
    showHealth();
    await renderLog();
  }

  // A different folder has its own backups, so anything worked out from the old one no longer applies.
  function useNewFolder(main, accountFolder, hadFolder) {
    state.backupFolder = accountFolder;
    state.shortChatIds = null;
    state.backupLocations = {};
    state.contentResults = [];
    state.relatedResults = [];
    state.showingResults = false;
    elements.contentSearch.hidden = true;
    elements.contentSearchClear.hidden = true;
    state.settings = { ...state.settings, guide: { folder: true } };
    OrganizerSettings.saveSettings(state.settings);
    showGuideProgress();
    showFolderName(main, accountFolder);
    if (state.chats.length) render();
    if (hadFolder) showStatus(`${state.account.name} now uses "${main.name}". Earlier backups stay in the old folder.`);
  }

  function showFolderName(main, accountFolder) {
    elements.folderName.textContent = main ? main.name : "No folder chosen yet";
    elements.folderChange.textContent = main ? "Change folder…" : "Choose folder…";
    elements.guideFolder.textContent = main ? "Change folder…" : "Choose folder…";
    const name = accountFolder?.name;
    elements.accountFolder.hidden = !(state.account && main);
    elements.accountFolder.textContent = name
      ? `${state.account.name}'s backups go in the "${name}" subfolder.`
      : state.account ? `${state.account.name}'s backups go in their own subfolder.` : "";
  }

  async function pickBackupFolder() {
    if (!state.account) {
      showStatus('Load your chats first, so Sift knows which ChatGPT account the folder is for.', true);
      return null;
    }
    try {
      const previous = await OrganizerBackup.getSavedFolder(state.account.key).catch(() => null);
      const main = await window.showDirectoryPicker({ mode: "readwrite", id: "organizer-backups" });
      await OrganizerBackup.saveFolder(main, state.account.key);
      const accountFolder = await OrganizerAccounts.resolveFolder(main, state.account);
      const isSame = previous ? await previous.isSameEntry(main).catch(() => false) : false;
      if (isSame) showFolderName(main, accountFolder);
      else useNewFolder(main, accountFolder, Boolean(previous));
      state.backupFolder = accountFolder;
      return (await offerOldBackups(main, accountFolder)) ? null : accountFolder;
    } catch (error) {
      if (error.name !== "AbortError") {
        showStatus("Couldn't use that folder. Please create a new, empty folder and choose that one.", true);
      }
      return null;
    }
  }

  // Gives back this account's own subfolder, never the main folder.
  async function getBackupFolder() {
    if (!(await confirmAccount())) return null;
    let main = null;
    try {
      main = await OrganizerBackup.getSavedFolder(state.account.key);
      if (main && !(await OrganizerBackup.ensurePermission(main))) main = null;
    } catch {
      main = null;
    }
    if (!main) return pickBackupFolder();
    try {
      const accountFolder = await OrganizerAccounts.resolveFolder(main, state.account);
      state.backupFolder = accountFolder;
      showFolderName(main, accountFolder);
      return (await offerOldBackups(main, accountFolder)) ? null : accountFolder;
    } catch {
      showStatus("Couldn't open this account's backup folder, so nothing was changed. Check the folder and try again.", true);
      return null;
    }
  }

  // Backups made before accounts had subfolders sit directly in the main folder.
  // Returns true if it's asking about them, so the action waits for an answer.
  async function offerOldBackups(main, accountFolder) {
    if (state.settings.oldBackupsLeft?.[state.account.key]) return false;
    const knownIds = new Set(state.chats.map((chat) => chat.id));
    for (const seed of state.projectSeeds.values()) {
      for (const chat of seed.firstChats) knownIds.add(chat?.id);
    }
    const old = await OrganizerAccounts.findOldBackups(main, accountFolder, knownIds).catch(() => null);
    if (!old) return false;

    const destination = `${main.name}/${accountFolder.name}`;
    elements.dialogList.hidden = true;
    elements.dialogTitle.textContent = `Move your existing backups into "${accountFolder.name}"?`;
    elements.dialogIntro.textContent =
      `Sift now keeps each ChatGPT account's backups in its own subfolder. "${main.name}" has ${plural(old.total, "backup")}, and ${old.matching.toLocaleString()} match this account's current chats, so these look like yours. They'd move to "${destination}". This only changes files on this computer. If they belong to another account, leave them where they are, and ${state.account.name} starts with an empty folder.`;
    state.dialogAction = () => runMoveOldBackups(main, accountFolder);
    state.dialogSecondaryAction = () => {
      state.settings = { ...state.settings, oldBackupsLeft: { ...state.settings.oldBackupsLeft, [state.account.key]: true } };
      OrganizerSettings.saveSettings(state.settings);
      elements.dialog.close();
      showStatus(`Your existing backups stayed in "${main.name}". ${state.account.name} is starting with an empty folder.`);
    };
    elements.dialogConfirm.textContent = "Yes, move them";
    elements.dialogConfirm.disabled = false;
    elements.dialogSecondary.textContent = "Leave them and start fresh";
    setDialogMessage("");
    setDialogButtons({ cancel: true, confirm: true, secondary: true });
    elements.dialog.showModal();
    elements.dialogCancel.focus();
    return true;
  }

  async function runMoveOldBackups(main, accountFolder) {
    state.isRunning = true;
    setDialogButtons({});
    elements.dialogTitle.textContent = "Moving your backups…";
    elements.dialogIntro.textContent = "Keep this tab open until it finishes. Each file is copied and checked before any originals are removed.";
    let problem = false;
    let moved = 0;
    try {
      moved = await OrganizerAccounts.moveOldBackups(main, accountFolder, (done, total) => {
        setDialogMessage(`Copied ${done.toLocaleString()} of ${plural(total, "file")}`);
      });
    } catch {
      problem = true;
    }
    state.isRunning = false;
    elements.dialogTitle.textContent = problem ? "Stopped early" : "Done";
    elements.dialogIntro.textContent = problem
      ? "Your original backups are still in place. Check your disk space, then try the same action again."
      : `Your backups are now in "${main.name}/${accountFolder.name}". You can carry on with what you were doing.`;
    setDialogMessage(problem ? "The backups weren't moved." : `Moved ${plural(moved, "file")}.`, problem);
    setDialogButtons({ close: true });
    elements.dialogClose.focus();
    try {
      await OrganizerLog.addEntry({
        action: "move backups",
        result: problem ? "failed" : "success",
        chatId: "",
        title: `${plural(moved, "file")} moved to the ${accountFolder.name} subfolder`,
        project: "",
        detail: "",
      });
      await renderLog();
    } catch {
      // The files are already moved, and the message above says so.
    }
  }

  async function startBackup() {
    if (OrganizerHealth.isPaused("backup")) return;
    if (!allProjectsLoaded()) {
      offerLoadBeforeBackup();
      return;
    }
    await continueBackup();
  }

  async function continueBackup() {
    const folder = await getBackupFolder();
    if (folder) await openBackupPreview(folder);
  }

  // A backup can only cover loaded chats, so it says so instead of looking complete.
  function offerLoadBeforeBackup() {
    const waiting = state.projects.filter((project) => !state.loadedProjects.has(project.id)).length;
    elements.dialogList.hidden = true;
    elements.dialogTitle.textContent = "Some chats aren't loaded yet";
    elements.dialogIntro.textContent = `${plural(waiting, "project")} still ${waiting === 1 ? "isn't" : "aren't"} loaded, so a backup now would skip ${waiting === 1 ? "its" : "their"} chats. You can load them first, or back up only what's loaded and do the rest later.`;
    state.dialogAction = () => {
      elements.dialog.close();
      loadRemainingChats().then((finished) => {
        if (finished) showStatus('All your projects are loaded. Click "Back up new and changed chats…" to continue.');
      });
    };
    state.dialogSecondaryAction = () => {
      elements.dialog.close();
      continueBackup();
    };
    elements.dialogConfirm.textContent = "Load all projects first";
    elements.dialogConfirm.disabled = false;
    elements.dialogSecondary.textContent = "Back up loaded chats only";
    setDialogMessage("");
    setDialogButtons({ cancel: true, confirm: true, secondary: true });
    elements.dialog.showModal();
    elements.dialogCancel.focus();
  }

  async function openBackupPreview(folder) {
    let index;
    try {
      index = await OrganizerBackup.readIndex(folder);
    } catch {
      if (elements.dialog.open) elements.dialog.close();
      showStatus("Couldn't read the backup index in that folder, so nothing was changed. Try choosing a new, empty folder.", true);
      return;
    }

    // Archived and deleted chats are saved when they're archived or deleted, so this run skips them.
    const plan = OrganizerBackup.planBackup(state.chats.filter((chat) => !chat.isArchived), index, BACKUP_CHATS_PER_RUN);
    const count = plan.items.length;
    const moveCount = plan.moves.length;
    state.dialogAction = () => runBackup(folder, plan, index);

    elements.dialogTitle.textContent = count
      ? `Back up ${plural(count, "chat")}?`
      : moveCount
        ? `Move ${plural(moveCount, "backup file")}?`
        : "Everything is backed up";
    elements.dialogIntro.textContent =
      `Backup folder on this computer: "${folder.name}". This only covers active chats. ${plan.newCount.toLocaleString()} new, ${plan.changedCount.toLocaleString()} changed, ${plan.upToDate.toLocaleString()} already up to date. ` +
      (count
        ? `Nothing in your ChatGPT account changes. Expect ${formatDuration(OrganizerApi.estimatePacedSeconds(count))}, and longer if some chats are long. `
        : "") +
      (plan.beyondLimit
        ? `To stay gentle, one run saves up to ${BACKUP_CHATS_PER_RUN.toLocaleString()} chats. Run it again later for the other ${plan.beyondLimit.toLocaleString()}. `
        : "") +
      (count ? "Images and uploaded files aren't included. " : "") +
      (moveCount ? `${plural(moveCount, "saved file")} will move to the folder shown, which only changes files on this computer.` : "");

    const makeItem = (id, title, noteText) => {
      const item = document.createElement("li");
      item.dataset.chatId = id;
      item.append(title);
      const note = document.createElement("span");
      note.className = "dialog-project";
      note.textContent = ` (${noteText})`;
      item.append(note);
      return item;
    };
    const anything = count + moveCount > 0;
    elements.dialogList.hidden = !anything;
    elements.dialogList.replaceChildren(
      ...plan.items.map(({ chat, reason }) => makeItem(chat.id, chat.title, reason)),
      ...plan.moves.map(({ id, title, to }) => makeItem(id, title, `move to ${to}`))
    );

    elements.dialogConfirm.textContent = count
      ? `Yes, back up ${plural(count, "chat")}`
      : `Yes, move ${plural(moveCount, "file")}`;
    elements.dialogConfirm.disabled = false;
    elements.dialogStop.disabled = false;
    elements.dialogStop.textContent = "Stop after this chat";
    setDialogMessage("");
    setDialogButtons(anything ? { cancel: true, confirm: true, changeFolder: true } : { close: true, changeFolder: true });
    if (!elements.dialog.open) elements.dialog.showModal();
    (anything ? elements.dialogCancel : elements.dialogClose).focus();
  }

  async function runBackup(folder, plan, index) {
    const chats = plan.items.map((item) => item.chat);
    elements.dialogConfirm.disabled = true;

    // Moving saved files doesn't need ChatGPT, so only look for the tab if chats need fetching.
    let tab = null;
    try {
      if (chats.length) tab = await findChatGptTab();
    } catch {
      tab = null;
    }
    if (chats.length && !tab) {
      elements.dialogConfirm.disabled = false;
      setDialogMessage("Nothing was saved. Couldn't find your chatgpt.com tab, so open or reload it and try again.", true);
      return;
    }

    state.isRunning = true;
    state.stopRequested = false;
    setDialogButtons({ stop: true });
    elements.dialogTitle.textContent = "Backing up…";
    elements.dialogIntro.textContent = "Keep this tab and your chatgpt.com tab open until it finishes. If it stops, the next run picks up where this one left off.";
    setDialogMessage(chats.length ? `Saved 0 of ${chats.length.toLocaleString()}` : "Moving files…");

    let movedFiles = 0;
    let moveFailures = 0;
    for (const { id, to } of plan.moves) {
      if (state.stopRequested) {
        markDialogResult(id, "not attempted", false);
        continue;
      }
      try {
        await OrganizerBackup.moveChatFile(folder, index, id, to);
        movedFiles += 1;
        markDialogResult(id, "moved", false);
      } catch {
        moveFailures += 1;
        markDialogResult(id, "couldn't be moved", true);
      }
    }

    let done = 0;
    const outcome = !chats.length ? { saved: [], failed: [], notAttempted: [], stopReason: null } : await createApiFor(tab, setDialogMessage).backupChats(chats, {
      shouldStop: () => state.stopRequested,
      saveChat: (chat, fullChat) => OrganizerBackup.saveChat(folder, index, chat, fullChat),
      onResult: async (chat, failure) => {
        if (!failure) done += 1;
        markDialogResult(chat.id, failure ? `failed: ${failure}` : "saved", Boolean(failure));
        setDialogMessage(`Saved ${done.toLocaleString()} of ${chats.length.toLocaleString()}`);
        if (!failure) return;
        try {
          await OrganizerLog.addEntry({
            action: "backup",
            result: "failed",
            chatId: chat.id,
            title: chat.title,
            project: projectNameOf(chat),
            detail: failure,
          });
        } catch {
          // The reason is still shown on screen, and the end-of-run entry reports any log problem.
        }
      },
    });
    state.isRunning = false;

    for (const chat of outcome.notAttempted) markDialogResult(chat.id, "not attempted", false);

    const moveSummary = plan.moves.length ? ` Moved ${movedFiles.toLocaleString()} of ${plural(plan.moves.length, "file")}.` : "";
    if (outcome.saved.length || movedFiles) saveGuideProgress("backup");
    const summary = `${chats.length ? `Saved ${outcome.saved.length.toLocaleString()} of ${chats.length.toLocaleString()}.` : ""}${moveSummary}`.trim();
    const failedNote = outcome.failed.length ? ` ${plural(outcome.failed.length, "chat")} failed and will be retried next run.` : "";
    const moreNote = plan.beyondLimit ? ` Run it again later for the other ${plan.beyondLimit.toLocaleString()}.` : "";
    elements.dialogTitle.textContent = outcome.stopReason ? "Stopped early" : "Done";
    elements.dialogIntro.textContent = `Your backups are in the "${folder.name}" folder.`;
    setDialogMessage(
      `${summary}${outcome.stopReason ? ` ${outcome.stopReason}` : failedNote}${moreNote}`,
      Boolean(outcome.failed.length || moveFailures)
    );
    setDialogButtons({ close: true });
    elements.dialogClose.focus();

    try {
      await OrganizerLog.addEntry({
        action: "backup",
        result: outcome.stopReason || outcome.failed.length || moveFailures ? "partial" : "success",
        title: `${plural(outcome.saved.length, "chat")} saved, ${outcome.failed.length.toLocaleString()} failed, ${plural(movedFiles, "file")} moved between folders`,
        project: "",
        chatId: "",
        detail: outcome.stopReason || "",
      });
      await renderLog();
    } catch {
      setDialogMessage(`${elements.dialogMessage.textContent} This run couldn't be added to the action log.`, true);
    }
  }

  // A one-time, opt-in backup for archived chats that have no backup file. The
  // regular backup button never touches archived chats.
  async function openArchivedBackupPreview() {
    const opened = await openBackupFolder();
    if (!opened) return;
    const { folder, index } = opened;

    const missing = state.chats.filter((chat) => chat.isArchived && !index.chats[chat.id]);
    const count = Math.min(missing.length, BACKUP_CHATS_PER_RUN);
    const beyondLimit = missing.length - count;
    const items = missing.slice(0, count).map((chat) => ({ chat, reason: "new" }));
    const plan = { items, moves: [], beyondLimit };

    elements.dialogTitle.textContent = count ? `Back up ${plural(count, "archived chat")}?` : "Every archived chat has a backup file";
    elements.dialogIntro.textContent = count
      ? `These are exactly the archived chats with no backup file. Each one is saved to the "${OrganizerBackup.ARCHIVED_FOLDER}" folder inside "${folder.name}", and they stay archived. Expect ${formatDuration(OrganizerApi.estimatePacedSeconds(count))}, and longer if some chats are long. ` +
        (beyondLimit ? `To stay gentle, one run saves up to ${BACKUP_CHATS_PER_RUN.toLocaleString()} chats. Run it again later for the other ${beyondLimit.toLocaleString()}.` : "")
      : "There's nothing to save. Older copies aren't updated here.";
    elements.dialogList.hidden = count === 0;
    elements.dialogList.replaceChildren(
      ...items.map(({ chat }) => {
        const item = document.createElement("li");
        item.dataset.chatId = chat.id;
        item.append(chat.title);
        return item;
      })
    );

    state.dialogAction = () => runBackup(folder, plan, index);
    elements.dialogConfirm.textContent = `Yes, back up ${plural(count, "chat")}`;
    elements.dialogConfirm.disabled = false;
    elements.dialogStop.disabled = false;
    elements.dialogStop.textContent = "Stop after this chat";
    setDialogMessage("");
    setDialogButtons(count ? { cancel: true, confirm: true } : { close: true });
    elements.dialog.showModal();
    (count ? elements.dialogCancel : elements.dialogClose).focus();
  }

  function showSearchStatus(message, isError = false) {
    elements.contentSearchStatus.textContent = message;
    elements.contentSearchStatus.hidden = !message;
    elements.contentSearchStatus.classList.toggle("error", isError);
  }

  // Describes a search result using what the extension currently knows about the chat.
  function resultStatus(id) {
    const chat = state.chats.find((candidate) => candidate.id === id);
    if (chat) return { chat, label: chat.isArchived ? "Archived" : "Active" };
    if (state.deletedThisSession.has(id) || state.backupLocations[id] === OrganizerBackup.DELETED_FOLDER) {
      return { chat: null, label: "Deleted" };
    }
    if (!everythingLoaded()) return { chat: null, label: "Not loaded yet", canLoad: true };
    return { chat: null, label: "Backup only, not in your current chat list" };
  }

  function makeResultRow(result) {
    const { chat, label, canLoad } = resultStatus(result.id);
    const row = document.createElement("li");
    row.className = "content-result";

    const checkCell = document.createElement("div");
    checkCell.className = "content-result-check";
    if (chat) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedIds.has(chat.id);
      checkbox.setAttribute("aria-label", `Select ${chat.title}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          // Selections never mix archived and active chats, so this switches to the right list.
          if (chat.isArchived !== inArchivedView()) {
            state.selectedIds.clear();
            state.selectedGroup = chat.isArchived ? "archived" : "all";
          }
          state.selectedIds.add(chat.id);
        } else {
          state.selectedIds.delete(chat.id);
        }
        render();
      });
      checkCell.append(checkbox);
    }

    const main = document.createElement("div");
    main.className = "content-result-main";
    const title = chat?.title || result.title || "Untitled";
    if (chat) {
      main.append(makeChatLink(chat, title));
    } else {
      main.append(title);
    }
    const status = document.createElement("span");
    status.className = label === "Deleted" ? "content-result-status deleted" : "content-result-status";
    status.textContent = result.related ? `Related · ${label}` : label;
    main.append(status);

    const snippet = document.createElement("p");
    snippet.className = "content-result-snippet";
    snippet.append(result.snippet.before);
    if (result.snippet.match) {
      const mark = document.createElement("mark");
      mark.textContent = result.snippet.match;
      snippet.append(mark);
    }
    snippet.append(result.snippet.after);
    main.append(snippet);

    const read = document.createElement("button");
    read.type = "button";
    read.className = "secondary-button";
    read.textContent = "Read";
    read.setAttribute("aria-label", `Read the saved copy of ${title}`);
    read.addEventListener("click", () => openSavedChat(result.id, title));

    row.append(checkCell, main);
    if (canLoad) {
      const loadAll = document.createElement("button");
      loadAll.type = "button";
      loadAll.className = "secondary-button";
      loadAll.textContent = "Load to select";
      loadAll.setAttribute("aria-label", `Load all chats, so ${title} can be selected`);
      loadAll.disabled = state.isLoadingAll || state.isLazyLoading;
      loadAll.addEventListener("click", () => loadRemainingChats({ includeArchived: true }));
      row.append(loadAll);
    }
    row.append(read);
    return row;
  }

  function renderContentResults() {
    const rows = state.contentResults.slice(0, RESULTS_SHOWN).map(makeResultRow);
    if (state.relatedResults.length) {
      const heading = document.createElement("li");
      heading.className = "content-results-heading";
      heading.textContent = "Related chats (closest first, and some may be off-topic)";
      rows.push(heading, ...state.relatedResults.map(makeResultRow));
    }
    elements.contentResults.replaceChildren(...rows);
    elements.contentResults.hidden = rows.length === 0;
  }

  async function runContentSearch() {
    const query = elements.contentSearchInput.value.trim();
    if (!query) return;

    elements.contentSearchButton.disabled = true;
    try {
      const opened = await openBackupFolder();
      if (!opened) return;
      const { folder, index } = opened;
      state.backupFolder = folder;
      state.backupLocations = Object.fromEntries(
        Object.entries(index.chats).map(([id, entry]) => [id, OrganizerBackup.locationOf(entry)])
      );

      const { searchIndex, unreadable } = await OrganizerSearch.updateIndex(folder, index, (done, total) => {
        showSearchStatus(`Reading backup files for the search index: ${done.toLocaleString()} of ${total.toLocaleString()}…`);
      });
      const liveTitles = new Map(state.chats.map((chat) => [chat.id, chat.title]));
      state.contentResults = OrganizerSearch.search(searchIndex.chats, query, (id, chat) => liveTitles.get(id) || chat.title);

      const missing = state.chats.filter((chat) => !index.chats[chat.id]);
      const missingActive = missing.filter((chat) => !chat.isArchived).length;
      const missingArchived = missing.length - missingActive;
      const emptyChats = Object.values(searchIndex.chats).filter((chat) => !chat.text).length;
      const total = state.contentResults.length;
      const relatedNote = await findRelatedChats(folder, searchIndex, query);
      showSearchStatus(
        `${plural(total, "chat")} with these exact words, in ${plural(Object.keys(searchIndex.chats).length, "backup file")}.` +
          relatedNote +
          (total > RESULTS_SHOWN ? ` Showing the top ${RESULTS_SHOWN}.` : "") +
          (missingActive ? ` ${plural(missingActive, "active chat")} not backed up yet, so not searched.` : "") +
          (missingArchived ? ` ${plural(missingArchived, "archived chat")} with no backup file, so not searched.` : "") +
          (emptyChats ? ` ${plural(emptyChats, "backup file")} had no readable text.` : "") +
          (unreadable.length ? ` ${plural(unreadable.length, "backup file")} couldn't be read.` : "")
      );
      state.showingResults = true;
      elements.contentSearchTitle.textContent = `Results for "${query}"`;
      elements.contentSearch.hidden = false;
      elements.library.hidden = true;
      elements.contentSearchClear.hidden = false;
      renderContentResults();
    } catch {
      showSearchStatus("Couldn't search your backup files. Check your backup folder and try again.", true);
    } finally {
      elements.contentSearchButton.disabled = false;
    }
  }

  // Adds chats on the same topic. A problem here never affects the exact-word results.
  async function findRelatedChats(folder, searchIndex, query) {
    state.relatedResults = [];
    try {
      const related = await OrganizerRelated.load(folder);
      const plan = OrganizerMeaning.planPreparation(searchIndex.chats, related);
      showRelatedCoverage(plan);
      if (Object.keys(related.chats).length === 0) return "";
      state.relatedEngine ??= OrganizerRelated.createEngine();
      const exact = new Set(state.contentResults.map((result) => result.id));
      const ranked = await OrganizerRelated.search(state.relatedEngine, related, query, exact);
      const liveTitles = new Map(state.chats.map((chat) => [chat.id, chat.title]));
      state.relatedResults = ranked.map(({ id, section }) => {
        const chat = searchIndex.chats[id];
        const text = OrganizerMeaning.splitIntoSections(chat.text)[section] || "";
        const cut = text.length > RELATED_SNIPPET_CHARACTERS;
        return {
          id,
          related: true,
          title: liveTitles.get(id) || chat.title,
          snippet: { before: cut ? `${text.slice(0, RELATED_SNIPPET_CHARACTERS)}…` : text, match: "", after: "" },
        };
      });
      return ` ${plural(state.relatedResults.length, "related chat")}.`;
    } catch {
      return " Related search couldn't run this time.";
    }
  }

  function showRelatedCoverage(plan) {
    const left = plan.work.length;
    elements.relatedStatus.textContent = left
      ? `Related search covers ${plan.prepared.toLocaleString()} of ${plural(plan.withText, "backed-up chat")}.`
      : `Related search covers all ${plural(plan.withText, "backed-up chat")}.`;
    elements.relatedPrepare.hidden = left === 0 || state.isPreparing;
    elements.relatedPrepare.textContent = `Prepare ${plural(left, "chat")}…`;
  }

  async function openPrepareRelated() {
    const opened = await openBackupFolder();
    if (!opened) return;
    const { folder, index } = opened;
    state.backupFolder = folder;
    let plan;
    let related;
    try {
      const { searchIndex } = await OrganizerSearch.updateIndex(folder, index, (done, total) => {
        elements.relatedStatus.textContent = `Reading backup files: ${done.toLocaleString()} of ${total.toLocaleString()}…`;
      });
      related = await OrganizerRelated.load(folder);
      plan = OrganizerMeaning.planPreparation(searchIndex.chats, related);
      showRelatedCoverage(plan);
    } catch {
      elements.relatedStatus.textContent = "Couldn't read your backup files. Check your backup folder and try again.";
      return;
    }

    const count = plan.work.length;
    elements.dialogList.hidden = true;
    elements.dialogTitle.textContent = count ? `Prepare ${plural(count, "chat")} for related search?` : "Related search is ready";
    elements.dialogIntro.textContent = count
      ? `This reads your backup files and saves the results as "related-index.bin" in "${folder.name}". Nothing changes in ChatGPT and nothing is sent anywhere. It should take ${formatDuration(plan.sectionCount / SECTIONS_PER_SECOND_ESTIMATE)}, and your computer may run warm. You can keep using other tabs, and you can stop and continue later.`
      : "All your backed-up chats are prepared.";
    state.dialogAction = () => {
      elements.dialog.close();
      runPrepareRelated(folder, related, plan);
    };
    elements.dialogConfirm.textContent = `Yes, prepare ${plural(count, "chat")}`;
    elements.dialogConfirm.disabled = false;
    setDialogMessage("");
    setDialogButtons(count ? { cancel: true, confirm: true } : { close: true });
    elements.dialog.showModal();
    (count ? elements.dialogCancel : elements.dialogClose).focus();
  }

  async function runPrepareRelated(folder, related, plan) {
    state.isPreparing = true;
    state.stopPreparing = false;
    elements.relatedPrepare.hidden = true;
    elements.relatedStop.hidden = false;
    elements.relatedStop.disabled = false;
    elements.contentSearchButton.disabled = true;
    const total = plan.work.length;
    let outcome = null;
    try {
      state.relatedEngine ??= OrganizerRelated.createEngine();
      outcome = await OrganizerRelated.prepare(folder, related, plan.work, state.relatedEngine, {
        shouldStop: () => state.stopPreparing,
        onProgress: (done) => {
          elements.relatedStatus.textContent = `Preparing related search: ${done.toLocaleString()} of ${plural(total, "chat")} done…`;
        },
      });
    } catch (error) {
      elements.relatedStatus.textContent = `Related search couldn't be prepared: ${error?.message || "unknown error"}`;
    }
    state.isPreparing = false;
    elements.relatedStop.hidden = true;
    elements.contentSearchButton.disabled = false;
    if (!outcome) {
      elements.relatedPrepare.hidden = false;
      return;
    }
    if (outcome.done) saveGuideProgress("related");
    const left = total - outcome.done;
    elements.relatedStatus.textContent = left
      ? `Prepared ${outcome.done.toLocaleString()} of ${plural(total, "chat")}. You can continue any time.`
      : `Prepared ${plural(total, "chat")}. Related search is ready.`;
    elements.relatedPrepare.hidden = left === 0;
    elements.relatedPrepare.textContent = `Prepare ${plural(left, "chat")}…`;
    if (elements.contentSearchInput.value.trim() && !outcome.stopped) runContentSearch();
  }

  async function openSavedChat(id, title) {
    let text;
    try {
      const index = await OrganizerBackup.readIndex(state.backupFolder);
      text = OrganizerSearch.formatForReading(await OrganizerBackup.readSavedChat(state.backupFolder, index.chats[id]));
    } catch {
      showSearchStatus(`Couldn't open the saved copy of "${title}".`, true);
      return;
    }
    elements.dialogList.hidden = true;
    elements.dialogTitle.textContent = title;
    elements.dialogIntro.textContent = "This is the saved copy on your computer, which may be older than the chat in ChatGPT. Images and uploaded files aren't included.";
    elements.dialogText.textContent = text || "This backup file had no readable text.";
    setDialogMessage("");
    setDialogButtons({ close: true, readText: true });
    elements.dialog.showModal();
    elements.dialogText.scrollTop = 0;
    elements.dialogClose.focus();
  }

  async function renderLog() {
    let entries = [];
    try {
      entries = await OrganizerLog.getEntries();
    } catch {
      elements.logSummary.textContent = "Action log (couldn't be read)";
      return;
    }
    elements.logSummary.textContent = `Action log (${entries.length.toLocaleString()})`;
    elements.logEmpty.hidden = entries.length > 0;
    elements.logTable.hidden = entries.length === 0;
    elements.logExport.disabled = entries.length === 0;

    const newestFirst = [...entries].reverse().slice(0, LOG_ROWS_SHOWN);
    elements.logRows.replaceChildren(
      ...newestFirst.map((entry) => {
        const row = document.createElement("tr");
        const time = new Date(entry.time).toLocaleString();
        for (const value of [time, entry.action, entry.result, entry.title, entry.project || "None"]) {
          row.insertCell().textContent = value;
        }
        return row;
      })
    );
  }

  async function exportLog() {
    const entries = await OrganizerLog.getEntries();
    const blob = new Blob([OrganizerLog.toCsv(entries)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sift-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  elements.loadButton.addEventListener("click", load);

  // Waits for a brief pause in typing, so long lists stay responsive.
  elements.filterForm.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(render, FILTER_DELAY_MS);
  });
  elements.filterKeyword.addEventListener("input", () => {
    clearTimeout(filterTimer);
    if (state.chats.length) filterTimer = setTimeout(render, FILTER_DELAY_MS);
  });
  elements.filterForm.addEventListener("submit", (event) => event.preventDefault());
  elements.filterClear.addEventListener("click", () => {
    clearTimeout(filterTimer);
    elements.filterFrom.value = "";
    elements.filterTo.value = "";
    render();
  });

  for (const button of document.querySelectorAll(".sort-button")) {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      const direction = state.sort.key === key
        ? (state.sort.direction === "asc" ? "desc" : "asc")
        : SORT_FIRST_DIRECTION[key];
      setSort(key, direction);
    });
  }
  elements.sidebarToggle.addEventListener("click", () => setSidebarOpen(!elements.sidebar.classList.contains("is-open")));
  elements.sidebarClose.addEventListener("click", () => setSidebarOpen(false));
  elements.sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.sidebar.classList.contains("is-open")) setSidebarOpen(false);
  });

  elements.moveToggle.addEventListener("click", () => setMovePanelOpen(elements.movePanel.hidden));
  elements.movePanelClose.addEventListener("click", () => setMovePanelOpen(false));

  elements.settingsButton.addEventListener("click", () => setSettingsOpen(elements.settingsPanel.hidden));
  document.addEventListener("click", (event) => {
    if (elements.settingsPanel.hidden) return;
    if (!elements.settingsPanel.contains(event.target) && !elements.settingsButton.contains(event.target)) setSettingsOpen(false);
  });
  for (const input of document.querySelectorAll('input[name="theme"]')) {
    input.addEventListener("change", () => {
      applyTheme(input.value);
      state.settings = { ...state.settings, theme: input.value };
      OrganizerSettings.saveSettings(state.settings);
    });
  }
  for (const input of document.querySelectorAll('input[name="load-scope"]')) {
    input.addEventListener("change", () => {
      state.settings = { ...state.settings, loadScope: input.value };
      OrganizerSettings.saveSettings(state.settings);
    });
  }
  elements.autoLoad.addEventListener("change", () => {
    state.settings = { ...state.settings, autoLoad: elements.autoLoad.checked };
    OrganizerSettings.saveSettings(state.settings);
  });
  elements.guideDismiss.addEventListener("click", () => {
    elements.guide.hidden = true;
    state.settings = { ...state.settings, guideDismissed: true };
    OrganizerSettings.saveSettings(state.settings);
  });
  elements.healthRetry.addEventListener("click", load);
  elements.healthUpdate.addEventListener("click", () => chrome.runtime.reload());
  elements.healthReport.addEventListener("click", saveDiagnosticReport);
  elements.settingsReport.addEventListener("click", () => {
    saveDiagnosticReport();
    setSettingsOpen(false);
  });
  elements.guideShow.addEventListener("click", () => {
    elements.guide.hidden = false;
    state.settings = { ...state.settings, guideDismissed: false };
    OrganizerSettings.saveSettings(state.settings);
    setSettingsOpen(false);
    window.scrollTo({ top: 0 });
    byId("guide-title").focus();
  });
  elements.guideFolder.addEventListener("click", async () => {
    if (await pickBackupFolder()) saveGuideProgress("folder");
  });
  elements.folderChange.addEventListener("click", pickBackupFolder);
  elements.guideBackup.addEventListener("click", () => {
    if (state.chats.length) startBackup();
    else showStatus('Click "Load my chats" first, so Sift knows which chats to back up.', true);
  });
  elements.guideRelated.addEventListener("click", openPrepareRelated);
  for (const input of document.querySelectorAll('input[name="open-mode"]')) {
    input.addEventListener("change", () => {
      state.settings = { ...state.settings, openMode: input.value };
      OrganizerSettings.saveSettings(state.settings);
      applyOpenMode();
    });
  }
  // The toolbar icon asks any open Sift page to come forward before opening another.
  chrome.runtime?.onMessage?.addListener((message, sender, reply) => {
    if (message?.type !== "sift-show") return false;
    reply({ shown: true });
    showThisPage();
    return false;
  });

  // "Select all" only affects the chats currently shown in the table.
  elements.selectAll.addEventListener("change", () => {
    for (const id of state.visibleSelectableIds) {
      if (elements.selectAll.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
    }
    render();
  });
  elements.selectionClear.addEventListener("click", () => {
    state.selectedIds.clear();
    render();
  });

  elements.archiveButton.addEventListener("click", openPreview);
  elements.restoreButton.addEventListener("click", openRestorePreview);
  elements.renameButton.addEventListener("click", openRenamePreview);
  elements.dialogRenameInput.addEventListener("input", () => {
    const title = elements.dialogRenameInput.value.trim();
    elements.dialogConfirm.disabled = !title || title === state.previewChats[0]?.title;
  });
  elements.moveButton.addEventListener("click", openMovePreview);
  elements.createProjectButton.addEventListener("click", openCreateProjectPreview);
  elements.moveTarget.addEventListener("change", updateSelectionUi);
  elements.moveModeExisting.addEventListener("change", updateSelectionUi);
  elements.moveModeNew.addEventListener("change", () => {
    updateSelectionUi();
    elements.newProjectName.focus();
  });
  elements.newProjectName.addEventListener("input", updateSelectionUi);
  elements.deleteButton.addEventListener("click", openDeletePreview);
  elements.dialogTypedInput.addEventListener("input", updateDeleteConfirm);
  elements.deleteChoiceBackup.addEventListener("change", updateDeleteConfirm);
  elements.deleteChoiceSkip.addEventListener("change", updateDeleteConfirm);
  elements.dialogCancel.addEventListener("click", () => elements.dialog.close());
  elements.dialogClose.addEventListener("click", () => elements.dialog.close());
  elements.dialogConfirm.addEventListener("click", () => state.dialogAction?.());
  elements.dialogSecondary.addEventListener("click", () => state.dialogSecondaryAction?.());
  elements.backupButton.addEventListener("click", startBackup);
  elements.archivedBackupButton.addEventListener("click", openArchivedBackupPreview);
  elements.contentSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runContentSearch();
  });
  elements.relatedPrepare.addEventListener("click", openPrepareRelated);
  elements.relatedStop.addEventListener("click", () => {
    state.stopPreparing = true;
    elements.relatedStop.disabled = true;
    elements.relatedStatus.textContent = "Stopping after the current step…";
  });
  elements.contentSearchClear.addEventListener("click", () => {
    state.contentResults = [];
    state.relatedResults = [];
    elements.contentSearchInput.value = "";
    elements.contentSearchClear.hidden = true;
    state.showingResults = false;
    elements.contentSearch.hidden = true;
    showSearchStatus("");
    render();
  });
  elements.dialogChangeFolder.addEventListener("click", async () => {
    const folder = await pickBackupFolder();
    if (folder) await openBackupPreview(folder);
  });
  elements.dialogStop.addEventListener("click", () => {
    state.stopRequested = true;
    elements.dialogStop.disabled = true;
    elements.dialogStop.textContent = "Stopping…";
  });

  // The Esc key can't close the window while chats are being archived.
  elements.dialog.addEventListener("cancel", (event) => {
    if (state.isRunning) event.preventDefault();
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.isRunning) event.preventDefault();
  });

  elements.logExport.addEventListener("click", exportLog);
  renderLog();
  loadChoices().then(async () => {
    await checkInstalledVersion();
    elements.autoLoad.checked = state.settings.autoLoad !== false;
    setUpGuide();
    const finish = () => {
      if (state.settings.autoLoad !== false) loadAutomatically();
    };
    // "arrange" is what version 0.14's background script asks for. It can keep running for
    // a while after an update, so this page sets itself up the same way for both.
    const asked = new URLSearchParams(location.search);
    if (asked.has("layout") || asked.has("arrange")) {
      history.replaceState(null, "", location.pathname);
      await applyOpenMode();
    }
    finish();
  });
})();
