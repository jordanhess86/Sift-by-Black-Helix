const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const PROJECT = require("path").resolve(__dirname, "..");
const S = __dirname;

function load(file, extra = {}) {
  const s = { URLSearchParams, encodeURIComponent, JSON, ...extra };
  s.globalThis = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(`${PROJECT}/${file}`, "utf8"), s);
  return s;
}
async function run(name, test) { await test(); console.log("ok -", name); }

const fullChat = { ok: true, data: { messages: [{ id: "m1" }, { id: "m2" }], page_info: { has_previous_page: false } } };
const confirmed = { ok: true, data: { success: true } };

(async () => {
  const { OrganizerApi: Api } = load("api.js");
  const chats = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));

  // Records the order of every step, so tests can prove backup came before delete.
  function setup({ transport = async () => fullChat, del = async () => confirmed } = {}) {
    const steps = [];
    const api = Api.createApi({
      transport: async (p, c) => { steps.push(`read:${p.split("/")[3].split("?")[0]}`); return transport(p, c); },
      deleteTransport: async (id) => { steps.push(`delete:${id}`); return del(id); },
      sleep: async () => {},
    });
    return { api, steps };
  }

  await run("each chat is read, then backed up, then deleted, in that order", async () => {
    const { api, steps } = setup();
    const out = await api.deleteChats(chats(2), { saveBackup: async (c) => steps.push(`backup:${c.id}`) });
    assert.deepEqual(steps, ["read:c0", "backup:c0", "delete:c0", "read:c1", "backup:c1", "delete:c1"]);
    assert.equal(out.succeeded.length, 2);
  });

  await run("a failed or unverified backup means no delete, and the run stops", async () => {
    for (const name of ["BackupVerificationError", "QuotaExceededError", "NotAllowedError"]) {
      const { api, steps } = setup();
      const out = await api.deleteChats(chats(3), { saveBackup: async () => { const e = new Error("the saved backup differs"); e.name = name; throw e; } });
      assert.ok(!steps.some((s) => s.startsWith("delete")), name);
      assert.equal(out.failed.length, 1);
      assert.equal(out.notAttempted.length, 2);
      assert.ok(out.stopReason.startsWith("Not deleted"));
    }
  });

  await run("an unreadable, empty or partial chat is never deleted", async () => {
    let backups = 0;
    const save = async () => { backups++; };
    let t = setup({ transport: async () => ({ ok: false, status: 404 }) });
    assert.equal((await t.api.deleteChats(chats(2), { saveBackup: save })).notAttempted.length, 1, "404 stops a delete run");
    assert.ok(!t.steps.some((s) => s.startsWith("delete")));

    t = setup({ transport: async () => ({ ok: true, data: { messages: [] } }) });
    await t.api.deleteChats(chats(1), { saveBackup: save });
    assert.ok(!t.steps.some((s) => s.startsWith("delete")));

    t = setup({ transport: async () => ({ ok: true, data: { messages: [{ id: "a" }], page_info: { has_previous_page: true } } }) });
    await t.api.deleteChats(chats(1), { saveBackup: save });
    assert.ok(!t.steps.some((s) => s.startsWith("delete")));

    t = setup({ transport: async (p) => (p.includes("/messages") ? { ok: false, status: 500 } : { ok: true, data: { messages: [{ id: "a" }], page_info: { start_cursor: "c", has_previous_page: true } } }) });
    await t.api.deleteChats(chats(1), { saveBackup: save });
    assert.ok(!t.steps.some((s) => s.startsWith("delete")));
    assert.equal(backups, 0);
  });

  await run("Stop works before reading, and between backup and delete", async () => {
    let stop = false;
    let t = setup();
    let out = await t.api.deleteChats(chats(3), { shouldStop: () => stop, saveBackup: async () => { stop = true; } });
    assert.ok(!t.steps.some((s) => s.startsWith("delete")));
    assert.equal(out.notAttempted.length, 3);
    assert.ok(out.stopReason.includes("backed up but not deleted"));

    let calls = 0;
    t = setup();
    out = await t.api.deleteChats(chats(3), { shouldStop: () => calls++ >= 2, saveBackup: async () => {} });
    assert.equal(out.succeeded.length, 1);
    assert.equal(out.notAttempted.length, 2);
  });

  await run("a failed delete stops the run, and is reported", async () => {
    let t = setup({ del: async () => ({ ok: false, status: 403 }) });
    const logged = [];
    let out = await t.api.deleteChats(chats(3), { saveBackup: async () => {}, onResult: async (c, f) => logged.push([c.id, f]) });
    assert.equal(out.failed.length, 1);
    assert.equal(out.notAttempted.length, 2);
    assert.ok(logged[0][1].includes("403"));

    t = setup({ del: async () => ({ ok: true, data: {} }) });
    out = await t.api.deleteChats(chats(2), { saveBackup: async () => {} });
    assert.equal(out.succeeded.length, 0, "unconfirmed delete isn't counted as success");

    t = setup({ del: async () => { throw new Error("tab gone"); } });
    out = await t.api.deleteChats(chats(2), { saveBackup: async () => {} });
    assert.ok(out.stopReason.includes("may or may not"));
  });

  await run("the run stops if the delete can't be logged", async () => {
    const { api, steps } = setup();
    const out = await api.deleteChats(chats(3), { saveBackup: async () => {}, onResult: async () => { throw new Error("full"); } });
    assert.equal(steps.filter((s) => s.startsWith("delete")).length, 1);
    assert.ok(out.stopReason.includes("action log"));
  });

  await run("chats that don't need a backup are deleted with no reads or saves", async () => {
    const steps = [];
    const api = Api.createApi({
      transport: async () => { steps.push("read"); return { ok: true, data: { messages: [{ id: "m" }], page_info: { has_previous_page: false } } }; },
      deleteTransport: async (id) => { steps.push(`delete ${id}`); return { ok: true, data: { success: true } }; },
      sleep: async () => {},
    });
    const out = await api.deleteChats([{ id: "keep" }, { id: "junk" }], {
      needsBackup: (chat) => chat.id === "keep",
      saveBackup: async (chat) => steps.push(`save ${chat.id}`),
    });
    assert.deepEqual(steps, ["read", "save keep", "delete keep", "delete junk"]);
    assert.equal(out.succeeded.length, 2);

    let stop = false;
    steps.length = 0;
    const stopped = await api.deleteChats([{ id: "a" }], { needsBackup: () => { stop = true; return false; }, shouldStop: () => stop });
    assert.deepEqual(steps, []);
    assert.equal(stopped.stopReason, "You stopped the run.");
  });

  await run("createProject needs a confirmed ID, and isn't resent after failure", async () => {
    let calls = 0;
    const make = (reply) => Api.createApi({ createProjectTransport: async () => { calls++; return reply; }, sleep: async () => {} });
    const good = await make({ ok: true, data: { resource: { gizmo: { id: "g-p-9" } }, error: null } }).createProject("X");
    assert.equal(good.id, "g-p-9");
    for (const bad of [{ ok: true, data: { resource: {}, error: null } }, { ok: true, data: { resource: { gizmo: { id: "g-p-9" } }, error: "nope" } }, { ok: false, status: 403 }]) {
      calls = 0;
      await assert.rejects(make(bad).createProject("X"), Api.ApiError);
      assert.equal(calls, 1);
    }
  });

  await run("content.js: delete and create send only fixed requests", async () => {
    const fetches = []; let listener;
    load("content.js", {
      location: { origin: "https://chatgpt.com" },
      chrome: { runtime: { id: "me", onMessage: { addListener: (f) => { listener = f; } } } },
      fetch: async (url, o = {}) => {
        fetches.push({ url, o });
        if (url.endsWith("/session")) return { ok: true, status: 200, json: async () => ({}) };
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ success: true }) };
      },
    });
    const ask = (m, sender = { id: "me" }) => new Promise((r) => { if (!listener(m, sender, r)) r("ignored"); });
    const id = "6f1c2d3e-aaaa-4bbb-8ccc-0123456789ab";
    for (const bad of ["../me", "abc/def", "short", "", null, 5, "a".repeat(65), "12345678/../x"]) {
      assert.equal((await ask({ type: "organizer-delete", chatId: bad })).error, "blocked", String(bad));
    }
    for (const bad of ["", "  x", "x  ", null, 5, "a".repeat(101)]) {
      assert.equal((await ask({ type: "organizer-create-project", name: bad })).error, "blocked", String(bad));
    }
    assert.equal(fetches.length, 0);
    assert.equal(await ask({ type: "organizer-delete", chatId: id }, { id: "other" }), "ignored");
    assert.equal(await ask({ type: "organizer-delete", chatId: id }, { id: "me", tab: {} }), "ignored");
    assert.equal(fetches.length, 0);

    assert.equal((await ask({ type: "organizer-delete", chatId: id })).ok, true);
    const del = fetches.find((f) => f.o.method === "DELETE");
    assert.equal(del.url, `https://chatgpt.com/backend-api/conversation/id/${id}`);
    assert.equal(del.o.body, undefined);

    assert.equal((await ask({ type: "organizer-create-project", name: 'My "Project"', instructions: "evil", memory_scope: "x" })).ok, true);
    const post = fetches.find((f) => f.o.method === "POST");
    assert.equal(post.url, "https://chatgpt.com/backend-api/projects");
    assert.deepEqual(JSON.parse(post.o.body), { name: 'My "Project"', instructions: "", memory_scope: "unset", emoji: null, theme: null });
  });

  // Whole-page runs in a browser, with real files in Chrome's private test storage and made-up chats.
  const fake = fs.readFileSync(`${S}/preview.html`, "utf8").match(/<script>\s*\/\/ Fake[\s\S]*?<\/script>/)[0];
  const stub = `<script>
    const realSend = chrome.tabs.sendMessage;
    const store = {};
    window.calls = [];
    window.folderName = "fake-backups-" + Date.now();
    const backupFolder = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(window.folderName, { create: true });
    window.showDirectoryPicker = backupFolder;
    chrome.tabs.sendMessage = async (id, m) => {
      if (m.type === "organizer-create-project") { window.calls.push(["create", m.name]); return window.failCreate ? { ok: false, status: 403 } : { ok: true, data: { resource: { gizmo: { id: "g-p-new" } }, error: null } }; }
      if (m.type === "organizer-archive") { window.calls.push(["archive", m.chatId]); return window.failArchive ? { ok: false, status: 500 } : { ok: true, data: { success: true } }; }
      if (m.type === "organizer-rename") { window.calls.push(["rename", m.chatId, m.title]); return { ok: true, data: { success: true } }; }
      if (m.type === "organizer-restore") { window.calls.push(["restore", m.chatId]); return { ok: true, data: { success: true } }; }
      if (m.type === "organizer-move") { window.calls.push(["move", m.chatId, m.projectId]); return { ok: true, data: { success: true } }; }
      if (m.type === "organizer-delete") {
        const chatsDir = await (await (await backupFolder()).getDirectoryHandle("Test User")).getDirectoryHandle("chats");
        const names = []; for await (const n of chatsDir.keys()) names.push(n);
        const file = names.find((n) => n.includes(" - " + m.chatId + ".json"));
        const saved = file ? JSON.parse(await (await (await chatsDir.getFileHandle(file)).getFile()).text()) : null;
        window.calls.push(["delete", m.chatId, saved ? saved.chat.messages.map((x) => x.id).join("+") : "NO BACKUP"]);
        if (window.failDelete) return { ok: false, status: 500 };
        return { ok: true, data: { success: true } };
      }
      if (m.path && m.path.includes("/messages?before=")) return { ok: true, data: { messages: [{ id: "older", author: { role: "user" }, content: { content_type: "text", parts: ["This is fake older text"] } }], page_info: { has_previous_page: false } } };
      if (m.path && m.path.includes("?num_turns=")) return { ok: true, data: { title: "fake", messages: [{ id: "newer", author: { role: "assistant" }, content: { content_type: "text", parts: ["This is fake newer text"] } }], page_info: { start_cursor: "c", has_previous_page: true } } };
      return realSend(id, m);
    };
    chrome.storage = { local: { set: async (v) => Object.assign(store, v), get: async () => ({ ...store }) } };
  </script>`;
  const body = fs.readFileSync(`${PROJECT}/dashboard.html`, "utf8").replace('<script src="api.js"></script>', `${fake}${stub}<script src="api.js"></script>`);
  const start = `
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test) => { for (let i = 0; i < 400 && !test(); i++) await wait(100); };
    const $ = (id) => document.getElementById(id);
    const list = () => [...$("dialog-list").children].map((li) => li.textContent);
    const groups = () => [...document.querySelectorAll(".group-button")].map((b) => b.textContent);
    const finished = () => ["Done", "Stopped early"].includes($("dialog-title").textContent);
    const box = (i) => document.querySelectorAll("#chat-rows input[type=checkbox]")[i];
    const type = (el, value) => { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); };
    window.addEventListener("error", (e) => fetch("/result", { method: "POST", body: "ERR " + e.message }));
    window.addEventListener("unhandledrejection", (e) => fetch("/result", { method: "POST", body: "REJ " + (e.reason && e.reason.message) }));
    $("load-button").click();
    await until(() => !$("backup-button").hidden);`;
  const page = (name, script) => fs.writeFileSync(`${S}/web/${name}.html`, body.replace("</body>", `<script type="module">${start}${script}</script></body>`));

  page("full", `
    const r = {};
    // --- Stage 5: blocked name, then a new project.
    box(0).click();
    r.defaultMode = { existingChosen: $("move-mode-existing").checked, menuShown: !$("move-target").hidden, nameShown: !$("new-project-name").hidden };
    r.menuHasNoNewOption = ![...$("move-target").options].some((o) => o.value === "__new__");
    // An earlier menu choice must not be used once "Create New Project" is chosen.
    $("move-target").value = "g-p-1"; $("move-target").dispatchEvent(new Event("change"));
    r.enabledWithProject = !$("move-button").disabled;
    $("move-mode-new").click();
    r.moveOffWithoutName = $("move-button").disabled;
    r.nameBoxShown = !$("new-project-name").hidden;
    r.menuHiddenWhenNew = $("move-target").hidden;
    r.buttonWhenNew = $("move-button").textContent;
    r.focusOnName = document.activeElement === $("new-project-name");
    $("move-mode-existing").click();
    r.backToExisting = { menuShown: !$("move-target").hidden, nameShown: !$("new-project-name").hidden, button: $("move-button").textContent };
    $("move-mode-new").click();
    type($("new-project-name"), "trip PLANNING");
    $("move-button").click();
    r.duplicateTitle = $("dialog-title").textContent;
    $("dialog-close").click();
    r.callsAfterDuplicate = window.calls.length;
    type($("new-project-name"), "  New Stuff  ");
    box(3).click();
    $("move-button").click();
    r.createTitle = $("dialog-title").textContent;
    r.createList = list();
    r.callsBeforeConfirm = window.calls.length;
    $("dialog-confirm").click();
    await until(finished);
    r.createDone = $("dialog-message").textContent;
    r.callsAfterCreate = JSON.parse(JSON.stringify(window.calls));
    r.groupsAfterCreate = groups();
    r.targetNow = $("move-target").selectedOptions[0].textContent;
    r.afterCreate = { existingChosen: $("move-mode-existing").checked, nameShown: !$("new-project-name").hidden, button: $("move-button").textContent };
    $("dialog-close").click();
    await until(() => $("log-summary").textContent === "Action log (3)");
    // --- Stage 6: selecting, typed confirmation, then a delete.
    window.calls.length = 0;
    box(1).click(); box(2).click();
    r.selected = $("selection-count").textContent;
    $("delete-button").click();
    await until(() => $("archive-dialog").open);
    r.deleteTitle = $("dialog-title").textContent;
    r.deleteList = list();
    r.disabledAtStart = $("dialog-confirm").disabled;
    type($("dialog-typed-input"), "delete");
    r.disabledLowercase = $("dialog-confirm").disabled;
    $("delete-choice-backup").click(); type($("dialog-typed-input"), "DELETE");
    r.disabledAfterTyping = $("dialog-confirm").disabled;
    r.callsBeforeDeleteConfirm = window.calls.length;
    $("dialog-confirm").click();
    await until(finished);
    r.deleteDone = $("dialog-message").textContent;
    r.deleteCalls = JSON.parse(JSON.stringify(window.calls));
    r.groupsAfterDelete = groups();
    await until(() => $("log-summary").textContent === "Action log (5)");
    r.log = $("log-summary").textContent;
    r.logRows = [...$("log-rows").rows].map((row) => [...row.cells].slice(1).map((c) => c.textContent).join(" | "));
    const all = await OrganizerLog.getEntries();
    r.deleteLogDetail = all.filter((e) => e.action === "delete").map((e) => e.detail);
    $("dialog-close").click();
    // --- A cancelled delete dialog changes nothing, and the next one starts blank.
    window.calls.length = 0;
    box(0).click();
    $("delete-button").click();
    await until(() => $("archive-dialog").open);
    r.typedReset = $("dialog-typed-input").value === "" && $("dialog-confirm").disabled;
    $("dialog-cancel").click();
    r.callsAfterCancel = window.calls.length;
    // --- Archive still works, with its normal one-click confirm.
    $("archive-button").click();
    await until(() => $("archive-dialog").open);
    r.archiveTypedHidden = $("dialog-typed").hidden;
    r.archiveConfirmEnabled = !$("dialog-confirm").disabled;
    r.archiveDangerStyle = $("dialog-confirm").classList.contains("danger");
    $("dialog-cancel").click();
    fetch("/result", { method: "POST", body: JSON.stringify(r) });
  `);

  page("createfail", `
    window.failCreate = true;
    box(0).click();
    $("move-mode-new").click();
    type($("new-project-name"), "Nope");
    $("move-button").click();
    $("dialog-confirm").click();
    await until(finished);
    await wait(200);
    fetch("/result", { method: "POST", body: JSON.stringify({ title: $("dialog-title").textContent, message: $("dialog-message").textContent, calls: window.calls, stillSelected: $("selection-count").textContent, log: (await OrganizerLog.getEntries()).map((e) => [e.action, e.result]) }) });
  `);

  page("shot", `
    box(1).click(); box(4).click();
    $("delete-button").click();
    await until(() => $("archive-dialog").open);
    $("delete-choice-backup").click(); type($("dialog-typed-input"), "DELETE");
    fetch("/result", { method: "POST", body: "ready" });
  `);

  page("folders", `
    const r = {};
    const listing = async () => {
      const root = await (await window.showDirectoryPicker()).getDirectoryHandle("Test User");
      const out = {};
      for await (const [name, handle] of root.entries()) {
        if (handle.kind !== "directory") continue;
        out[name] = [];
        for await (const file of handle.keys()) out[name].push(file);
        out[name].sort();
      }
      return out;
    };
    // Create only: no chats ticked, no chats moved.
    r.createOffWithoutName = (() => { $("move-mode-new").click(); return { shown: !$("create-project-button").hidden, disabled: $("create-project-button").disabled, moveDisabled: $("move-button").disabled }; })();
    type($("new-project-name"), "Empty One");
    r.createOnWithName = !$("create-project-button").disabled;
    $("create-project-button").click();
    r.createOnlyTitle = $("dialog-title").textContent;
    r.callsBeforeCreateConfirm = window.calls.length;
    $("dialog-confirm").click();
    await until(finished);
    r.createOnlyDone = [$("dialog-title").textContent, $("dialog-message").textContent];
    r.createOnlyCalls = JSON.parse(JSON.stringify(window.calls));
    r.createOnlyGroups = groups();
    r.createOnlyMode = { existing: $("move-mode-existing").checked, target: $("move-target").selectedOptions[0].textContent, createHidden: $("create-project-button").hidden };
    $("dialog-close").click();

    // The backup button only covers active chats.
    $("backup-button").click();
    await until(() => $("archive-dialog").open);
    r.backupList = list();
    $("dialog-confirm").click();
    await until(finished);
    r.backupDone = $("dialog-message").textContent;
    r.afterBackup = await listing();
    $("dialog-close").click();

    // Deleting moves the backup to Deleted only after ChatGPT confirms.
    box(1).click();
    $("delete-button").click();
    await until(() => $("archive-dialog").open);
    $("delete-choice-backup").click(); type($("dialog-typed-input"), "DELETE");
    $("dialog-confirm").click();
    await until(finished);
    r.deleteCalls = window.calls.filter((c) => c[0] === "delete");
    r.afterDelete = await listing();
    r.deleteDetail = (await OrganizerLog.getEntries()).filter((e) => e.action === "delete").map((e) => e.detail);
    $("dialog-close").click();

    // Archiving backs up first, then files the chat under Archived.
    box(0).click();
    $("archive-button").click();
    await until(() => $("archive-dialog").open);
    r.archiveTitle = $("dialog-title").textContent;
    r.archiveConfirm = $("dialog-confirm").textContent;
    $("dialog-confirm").click();
    await until(finished);
    r.afterArchive = await listing();
    r.archiveDetail = (await OrganizerLog.getEntries()).filter((e) => e.action === "archive").map((e) => e.detail);
    $("dialog-close").click();

    // Backing up again finds nothing: archived and deleted chats aren't touched.
    $("backup-button").click();
    await until(() => $("archive-dialog").open);
    r.secondBackupTitle = $("dialog-title").textContent;
    $("dialog-close").click();

    // The Archived view: restore and delete in bulk.
    box(0).click();
    [...document.querySelectorAll(".group-button")].find((b) => b.textContent.startsWith("Archived")).click();
    r.archivedView = {
      selection: $("selection-count").textContent,
      restoreShown: !$("restore-button").hidden, archiveHidden: $("archive-button").hidden, moveHidden: $("move-button").hidden,
      radiosHidden: $("move-mode").hidden, menuHidden: $("move-target").hidden, nameHidden: $("new-project-name").hidden, createHidden: $("create-project-button").hidden,
      deleteShown: !$("delete-button").hidden, boxes: document.querySelectorAll("#chat-rows input[type=checkbox]").length,
      list: [...document.querySelectorAll("#chat-rows .title")].map((c) => c.textContent),
    };
    $("select-all").click();
    $("restore-button").click();
    await until(() => $("archive-dialog").open);
    r.restoreTitle = $("dialog-title").textContent;
    r.restoreList = list();
    $("dialog-cancel").click();
    r.callsAfterRestoreCancel = window.calls.filter((c) => c[0] === "restore").length;

    // Restore just the one with a backup file: it returns to "chats".
    $("selection-clear").click();
    [...document.querySelectorAll("#chat-rows tr")].find((row) => row.textContent.includes("Explain compound interest")).querySelector("input").click();
    $("restore-button").click();
    await until(() => $("archive-dialog").open);
    r.restoreOneList = list();
    $("dialog-confirm").click();
    await until(finished);
    r.restoreCalls = window.calls.filter((c) => c[0] === "restore");
    r.afterRestore = await listing();
    r.restoreDetail = (await OrganizerLog.getEntries()).filter((e) => e.action === "restore").map((e) => e.detail);
    $("dialog-close").click();
    r.groupsAfterRestore = groups();

    // Delete the remaining archived chat in bulk, with a fresh backup and typed DELETE.
    $("select-all").click();
    $("delete-button").click();
    await until(() => $("archive-dialog").open);
    r.archivedDeleteList = list();
    r.archivedDeleteLocked = $("dialog-confirm").disabled;
    $("delete-choice-backup").click(); type($("dialog-typed-input"), "DELETE");
    $("dialog-confirm").click();
    await until(finished);
    r.archivedDeleteMsg = $("dialog-message").textContent;
    r.afterArchivedDelete = await listing();
    r.groupsAtEnd = groups();
    $("dialog-close").click();
    fetch("/result", { method: "POST", body: JSON.stringify(r) });
  `);

  page("archivefail", `
    window.failArchive = true;
    box(0).click(); box(1).click();
    $("archive-button").click();
    await until(() => $("archive-dialog").open);
    $("dialog-confirm").click();
    await until(finished);
    const root = await (await window.showDirectoryPicker()).getDirectoryHandle("Test User");
    const out = {};
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === "directory") { out[name] = []; for await (const f of handle.keys()) out[name].push(f); }
    }
    fetch("/result", { method: "POST", body: JSON.stringify({ title: $("dialog-title").textContent, msg: $("dialog-message").textContent, calls: window.calls, folders: out, selected: $("selection-count").textContent }) });
  `);

  page("deletefail", `
    window.failDelete = true;
    box(0).click();
    $("delete-button").click();
    await until(() => $("archive-dialog").open);
    $("delete-choice-backup").click(); type($("dialog-typed-input"), "DELETE");
    $("dialog-confirm").click();
    await until(finished);
    const root = await (await window.showDirectoryPicker()).getDirectoryHandle("Test User");
    const out = {};
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === "directory") { out[name] = []; for await (const f of handle.keys()) out[name].push(f); }
    }
    fetch("/result", { method: "POST", body: JSON.stringify({ title: $("dialog-title").textContent, folders: out }) });
  `);

  page("archivededit", `
    const r = {};
    [...document.querySelectorAll(".group-button")].find((b) => b.textContent.startsWith("Archived")).click();
    r.controls = { rename: !$("rename-button").hidden, renameDisabled: $("rename-button").disabled, move: !$("move-button").hidden, radios: !$("move-mode").hidden, menu: !$("move-target").hidden, archive: !$("archive-button").hidden };
    box(0).click();
    r.renameEnabledWithOne = !$("rename-button").disabled;
    $("rename-button").click();
    r.renameTitle = $("dialog-title").textContent;
    r.renamePrefill = $("dialog-rename-input").value;
    r.renameFieldShown = !$("dialog-rename").hidden;
    r.lockedUnchanged = $("dialog-confirm").disabled;
    type($("dialog-rename-input"), "   ");
    r.lockedBlank = $("dialog-confirm").disabled;
    type($("dialog-rename-input"), "  Better recipes  ");
    r.unlockedNew = !$("dialog-confirm").disabled;
    r.callsBeforeRename = window.calls.length;
    $("dialog-confirm").click();
    await until(finished);
    r.renameDone = $("dialog-message").textContent;
    r.renameCalls = window.calls.filter((c) => c[0] === "rename");
    r.renameFieldAfter = $("dialog-rename").hidden;
    r.renameLog = (await OrganizerLog.getEntries()).filter((e) => e.action === "rename").map((e) => [e.result, e.title]);
    $("dialog-close").click();
    r.rowsAfterRename = [...document.querySelectorAll("#chat-rows .title")].map((c) => c.textContent);
    r.selectionAfterRename = $("selection-count").textContent;
    // Moving an archived chat into a project keeps it in the Archived view.
    box(0).click();
    $("move-target").value = "g-p-1"; $("move-target").dispatchEvent(new Event("change"));
    $("move-button").click();
    r.moveTitle = $("dialog-title").textContent;
    r.moveIntro = $("dialog-intro").textContent;
    r.moveList = list();
    $("dialog-confirm").click();
    await until(finished);
    r.moveCalls = window.calls.filter((c) => c[0] === "move");
    $("dialog-close").click();
    r.groupsAfterMove = groups();
    r.projectCell = document.querySelector("#chat-rows tr").cells[2].textContent;
    fetch("/result", { method: "POST", body: JSON.stringify(r) });
  `);

  page("contentsearch", `
    const r = {};
    r.panelShown = !$("content-search").hidden;
    // Active rename.
    r.renameShownOnActive = !$("rename-button").hidden;
    r.renameDisabledNoneTicked = $("rename-button").disabled;
    box(0).click();
    $("rename-button").click();
    r.activeRenameIntro = $("dialog-intro").textContent;
    type($("dialog-rename-input"), "Renamed interest chat");
    $("dialog-confirm").click();
    await until(finished);
    r.activeRenameCalls = window.calls.filter((c) => c[0] === "rename");
    $("dialog-close").click();
    r.activeRowTitle = document.querySelector("#chat-rows .title").textContent;
    // Back up active chats, then search.
    $("backup-button").click();
    await until(() => $("archive-dialog").open);
    $("dialog-confirm").click();
    await until(finished);
    $("dialog-close").click();
    const search = async (words) => {
      $("content-search-input").value = words;
      $("content-search-button").click();
      await wait(100);
      await until(() => !$("content-search-button").disabled);
      return { status: $("content-search-status").textContent, rows: [...document.querySelectorAll(".content-result")].map((li) => li.textContent) };
    };
    r.firstSearch = await search("newer");
    r.noMatch = await search("dragon");
    // The fake chats all share one text, so check the highlight and reading view.
    const found = await search("fake older");
    r.marks = [...document.querySelectorAll(".content-result mark")].slice(0, 1).map((m) => m.textContent);
    document.querySelector(".content-result button").click();
    await until(() => $("archive-dialog").open);
    r.readTitle = $("dialog-title").textContent;
    r.readText = $("dialog-text").textContent;
    r.readShown = !$("dialog-text").hidden;
    r.readButtons = { confirm: $("dialog-confirm").hidden, close: !$("dialog-close").hidden };
    $("dialog-close").click();
    // Ticking an active result selects it for the normal actions.
    document.querySelector(".content-result input").click();
    r.selectedFromResults = $("selection-count").textContent;
    r.rowStillTicked = document.querySelector(".content-result input").checked;
    $("selection-clear").click();
    // Delete one: its result is relabelled, with no checkbox, and can still be read.
    document.querySelector(".content-result input").click();
    $("delete-button").click();
    await until(() => $("archive-dialog").open);
    $("delete-choice-backup").click(); type($("dialog-typed-input"), "DELETE");
    $("dialog-confirm").click();
    await until(finished);
    $("dialog-close").click();
    await search("fake older");
    const deletedRow = [...document.querySelectorAll(".content-result")].find((li) => li.querySelector(".content-result-status").textContent === "Deleted");
    r.deletedRow = { text: deletedRow.textContent, checkbox: deletedRow.querySelectorAll("input").length, link: deletedRow.querySelectorAll("a").length, label: deletedRow.querySelector(".content-result-status").textContent };
    deletedRow.querySelector("button").click();
    await until(() => $("archive-dialog").open);
    r.deletedReadable = $("dialog-text").textContent;
    $("dialog-close").click();
    // Older archived chats: not searched until the opt-in backup runs.
    r.statusBefore = (await search("fake older")).status;
    r.archivedBackupHiddenOnActive = $("archived-backup-button").hidden;
    [...document.querySelectorAll(".group-button")].find((b) => b.textContent.startsWith("Archived")).click();
    r.archivedBackupShown = !$("archived-backup-button").hidden;
    $("archived-backup-button").click();
    await until(() => $("archive-dialog").open);
    r.oneTimeTitle = $("dialog-title").textContent;
    r.oneTimeList = list();
    $("dialog-confirm").click();
    await until(finished);
    r.oneTimeDone = $("dialog-message").textContent;
    $("dialog-close").click();
    r.statusAfter = (await search("fake older")).status;
    const archivedRow = [...document.querySelectorAll(".content-result")].find((li) => li.textContent.includes("Old recipe ideas"));
    r.archivedLabel = archivedRow.querySelector(".content-result-status").textContent;
    // Ticking an active result from the archived view switches lists and clears ticks.
    const activeRow = [...document.querySelectorAll(".content-result")].find((li) => li.querySelector(".content-result-status").textContent === "Active");
    activeRow.querySelector("input").click();
    r.afterSwitch = { group: $("group-title").textContent, selected: $("selection-count").textContent, restoreHidden: $("restore-button").hidden };
    $("content-search-clear").click();
    r.afterClear = { rows: document.querySelectorAll(".content-result").length, status: $("content-search-status").hidden };
    r.errors = window.errors || [];
    fetch("/result", { method: "POST", body: JSON.stringify(r) });
  `);

  page("shot-search", `
    $("backup-button").click();
    await until(() => $("archive-dialog").open);
    $("dialog-confirm").click();
    await until(finished);
    $("dialog-close").click();
    $("content-search-input").value = "fake older";
    $("content-search-button").click();
    await wait(100);
    await until(() => !$("content-search-button").disabled);
    fetch("/result", { method: "POST", body: "ready" });
  `);

  page("shot-archived", `
    [...document.querySelectorAll(".group-button")].find((b) => b.textContent.startsWith("Archived")).click();
    box(0).click();
    fetch("/result", { method: "POST", body: "ready" });
  `);
  console.log("ok - browser pages built");
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
