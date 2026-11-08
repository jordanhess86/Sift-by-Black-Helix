const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const PROJECT = require("path").resolve(__dirname, "..");
const S = __dirname;

function load(file, extra = {}) {
  const sandbox = { URLSearchParams, encodeURIComponent, ...extra };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(`${PROJECT}/${file}`, "utf8"), sandbox);
  return sandbox;
}
const { OrganizerApi: Api } = load("api.js");
const { OrganizerBackup: Backup } = load("backup.js");

const msg = (id) => ({ id, content: { parts: [id] } });
async function run(name, test) { await test(); console.log("ok -", name); }

// A chat of 3 pages: newest m5,m6 / middle m3,m4 / oldest m1,m2.
function pagedTransport(calls, overrides = {}) {
  return async (path) => {
    calls.push(path);
    if (overrides[path]) return overrides[path];
    if (path.includes("/messages?before=c2")) return { ok: true, data: { messages: [msg("m3"), msg("m4")], page_info: { start_cursor: "c1", has_previous_page: true } } };
    if (path.includes("/messages?before=c1")) return { ok: true, data: { messages: [msg("m1"), msg("m2")], page_info: { start_cursor: "c0", has_previous_page: false } } };
    if (path.includes("/backend-api/conversations/")) return { ok: true, data: { title: "T", conversation_id: "x", messages: [msg("m5"), msg("m6")], page_info: { start_cursor: "c2", has_previous_page: true } } };
    throw new Error(path);
  };
}

(async () => {
  await run("fetches every page and puts messages oldest first", async () => {
    const calls = [], sleeps = [];
    const api = Api.createApi({ transport: pagedTransport(calls), sleep: async (ms) => sleeps.push(ms) });
    const chat = await api.fetchFullChat({ id: "chat-id-1234" });
    assert.deepEqual(Array.from(chat.messages, (m) => m.id), ["m1", "m2", "m3", "m4", "m5", "m6"]);
    assert.equal(chat.title, "T");
    assert.equal(chat.page_info, undefined);
    assert.equal(calls.length, 3);
    assert.equal(sleeps.length, 2);
  });

  await run("a repeating page pointer fails and isn't saved as complete", async () => {
    const api = Api.createApi({
      transport: async () => ({ ok: true, data: { messages: [msg("a")], page_info: { start_cursor: "same", has_previous_page: true } } }),
      sleep: async () => {},
    });
    const saved = [];
    const out = await api.backupChats([{ id: "chat-1" }, { id: "chat-2" }], { saveChat: async (c) => saved.push(c.id) });
    assert.equal(saved.length, 0);
    assert.equal(out.failed.length, 2, "skips and tries the next chat");
  });

  await run("a missing page fails the chat rather than saving part of it", async () => {
    const calls = [], saved = [];
    const transport = async (path) => {
      calls.push(path);
      if (path.includes("/messages")) return { ok: false, status: 500 };
      return { ok: true, data: { messages: [msg("m")], page_info: { start_cursor: "c", has_previous_page: true } } };
    };
    const api = Api.createApi({ transport, sleep: async () => {} });
    const out = await api.backupChats([{ id: "chat-1" }, { id: "chat-2" }], { saveChat: async (c) => saved.push(c.id) });
    assert.equal(saved.length, 0);
    assert.equal(out.notAttempted.length, 1, "500 stops the run");
  });

  await run("404 skips one chat; 403 and disk errors stop the run", async () => {
    let api = Api.createApi({
      transport: async (p) => (p.includes("chat-1") ? { ok: false, status: 404 } : { ok: true, data: { messages: [] } }),
      sleep: async () => {},
    });
    let saved = [];
    let out = await api.backupChats([{ id: "chat-1" }, { id: "chat-2" }], { saveChat: async (c) => saved.push(c.id) });
    assert.deepEqual(saved, ["chat-2"]);
    assert.equal(out.stopReason, null);

    api = Api.createApi({ transport: async () => ({ ok: false, status: 403 }), sleep: async () => {} });
    out = await api.backupChats([{ id: "a" }, { id: "b" }], { saveChat: async () => {} });
    assert.equal(out.notAttempted.length, 1);

    api = Api.createApi({ transport: async () => ({ ok: true, data: { messages: [] } }), sleep: async () => {} });
    out = await api.backupChats([{ id: "a" }, { id: "b" }], { saveChat: async () => { const e = new Error("x"); e.name = "QuotaExceededError"; throw e; } });
    assert.ok(out.stopReason.includes("backup folder"));
    assert.equal(out.notAttempted.length, 1);
  });

  await run("the plan skips unchanged chats and respects the limit", async () => {
    const chats = [
      { id: "new1", updatedAt: 5 }, { id: "changed", updatedAt: 9 }, { id: "same", updatedAt: 3 },
      { id: "nodate", updatedAt: null }, { id: "new2", updatedAt: 1 },
    ];
    const index = { chats: { changed: { updatedAt: 2 }, same: { updatedAt: 3 }, nodate: { updatedAt: 1 } } };
    const plan = Backup.planBackup(chats, index, 2);
    assert.deepEqual(Array.from(plan.items, (i) => i.chat.id), ["new1", "changed"]);
    assert.equal(plan.newCount, 2);
    assert.equal(plan.changedCount, 1);
    assert.equal(plan.upToDate, 2);
    assert.equal(plan.beyondLimit, 1);
  });

  await run("the plan moves a file back when its active chat was un-archived", async () => {
    const chats = [{ id: "stay", updatedAt: 1 }, { id: "backActive", title: "B", updatedAt: 1 }];
    const index = { chats: { stay: { updatedAt: 1 }, backActive: { updatedAt: 1, location: "Archived" }, gone: { updatedAt: 1 } } };
    const plan = Backup.planBackup(chats, index, 10);
    assert.equal(plan.items.length, 0);
    assert.equal(plan.upToDate, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(plan.moves)), [{ id: "backActive", title: "B", to: "chats" }]);
  });

  // A small stand-in for a folder on disk, kept in memory.
  function fakeFolder() {
    const files = new Map(); const folders = new Map();
    const folder = {
      files, folders, options: { failWrites: null },
      async getDirectoryHandle(name, { create } = {}) {
        if (!folders.has(name)) {
          if (!create) throw Object.assign(new Error("none"), { name: "NotFoundError" });
          folders.set(name, fakeFolder());
          folders.get(name).options = folder.options;
        }
        return folders.get(name);
      },
      async getFileHandle(name, { create } = {}) {
        if (!files.has(name) && !create) throw Object.assign(new Error("none"), { name: "NotFoundError" });
        return {
          getFile: async () => ({ text: async () => files.get(name) }),
          createWritable: async () => ({
            write: async (text) => { if (folder.options.failWrites === name) throw new Error("disk full"); files.set(name, text); },
            close: async () => {}, abort: async () => {},
          }),
        };
      },
      async removeEntry(name) { files.delete(name); },
    };
    return folder;
  }
  const fullChat = { messages: [{ id: "m1" }, { id: "m2" }] };

  await run("saving files each chat by its status, and replaces an older copy elsewhere", async () => {
    const folder = fakeFolder(); const index = { chats: {} };
    const file = await Backup.saveChat(folder, index, { id: "c1", title: "T", updatedAt: 1 }, fullChat);
    assert.ok(folder.folders.get("chats").files.has(file));
    await Backup.saveChat(folder, index, { id: "c1", title: "T", updatedAt: 2, isArchived: true }, fullChat);
    assert.ok(folder.folders.get("Archived").files.has(file));
    assert.ok(!folder.folders.get("chats").files.has(file));
    assert.equal(index.chats.c1.location, "Archived");
    await Backup.verifySavedChat(folder, index, "c1", fullChat);
    assert.equal(Backup.backupPath(index, "c1"), `Archived/${file}`);
  });

  await run("moving a file keeps it safe if anything fails", async () => {
    const folder = fakeFolder(); const index = { chats: {} };
    const file = await Backup.saveChat(folder, index, { id: "c1", title: "T", updatedAt: 1 }, fullChat);
    const original = folder.folders.get("chats").files.get(file);

    folder.options.failWrites = file;
    await assert.rejects(Backup.moveChatFile(folder, index, "c1", "Deleted"));
    assert.equal(folder.folders.get("chats").files.get(file), original);
    assert.equal(index.chats.c1.location, "chats");

    folder.options.failWrites = "backup-index.json";
    await assert.rejects(Backup.moveChatFile(folder, index, "c1", "Deleted"));
    assert.equal(folder.folders.get("chats").files.get(file), original);
    assert.equal(index.chats.c1.location, "chats");

    folder.options.failWrites = null;
    await Backup.moveChatFile(folder, index, "c1", "Deleted");
    assert.ok(!folder.folders.get("chats").files.has(file));
    assert.equal(folder.folders.get("Deleted").files.get(file), original);
    assert.equal(JSON.parse(folder.files.get("backup-index.json")).chats.c1.location, "Deleted");

    index.chats.old = { updatedAt: 1, file: "missing.json" };
    await assert.rejects(Backup.moveChatFile(folder, index, "old", "Deleted"));
    assert.equal(index.chats.old.location, undefined);
  });

  await run("backup status: current, older or none", async () => {
    const index = { chats: { same: { updatedAt: 5 }, changed: { updatedAt: 4 }, nodate: { updatedAt: 5 } } };
    assert.equal(Backup.backupStatus({ id: "same", updatedAt: 5 }, index), "current");
    assert.equal(Backup.backupStatus({ id: "changed", updatedAt: 5 }, index), "older");
    assert.equal(Backup.backupStatus({ id: "nodate", updatedAt: null }, index), "older");
    assert.equal(Backup.backupStatus({ id: "new", updatedAt: 5 }, index), "none");
  });

  await run("file names are safe", async () => {
    assert.equal(Backup.safeFileName('a/b:c*"d', "id1"), "a b c d - id1.json");
    assert.equal(Backup.safeFileName("../..", "id1"), "Untitled - id1.json");
    assert.equal(Backup.safeFileName("   ", "id1"), "Untitled - id1.json");
    assert.ok(Backup.safeFileName("x".repeat(500), "id1").length < 80);
  });

  await run("content.js allows the two chat reads, and nothing broader", async () => {
    const fetches = []; let listener;
    load("content.js", {
      location: { origin: "https://chatgpt.com" },
      chrome: { runtime: { id: "me", onMessage: { addListener: (fn) => { listener = fn; } } } },
      fetch: async (url, o = {}) => {
        fetches.push({ url, o });
        if (url.endsWith("/session")) return { ok: true, status: 200, json: async () => ({}) };
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
      },
    });
    const ask = (path) => new Promise((resolve) => listener({ type: "organizer-get", path }, { id: "me" }, resolve));
    const id = "6f1c2d3e-aaaa-4bbb-8ccc-0123456789ab";
    assert.equal((await ask(`/backend-api/conversations/${id}?num_turns=10&include_has_versions=true`)).ok, true);
    assert.equal((await ask(`/backend-api/conversations/${id}/messages?before=c&num_turns=10`)).ok, true);
    for (const bad of [`/backend-api/conversations/${id}`, `/backend-api/conversations/${id}/other?before=c`, `/backend-api/conversation/id/${id}?num_turns=1`, `/backend-api/conversations/../me?num_turns=1`]) {
      assert.equal((await ask(bad)).error, "blocked", bad);
    }
    assert.ok(fetches.filter((f) => !f.url.endsWith("/session")).every((f) => f.o.method === "GET"));
  });

  // A real run in a real browser with real files, using Chrome's private test storage and fake chats.
  const fake = fs.readFileSync(`${S}/preview.html`, "utf8").match(/<script>\s*\/\/ Fake[\s\S]*?<\/script>/)[0];
  const extra = `<script>
    const realSend = chrome.tabs.sendMessage;
    const store = {};
    chrome.tabs.sendMessage = async (id, m) => {
      if (m.path && m.path.includes("/messages?before=")) return { ok: true, data: { messages: [{ id: "older", content: { parts: ["fake older"] } }], page_info: { has_previous_page: false } } };
      if (m.path && m.path.includes("?num_turns=")) return { ok: true, data: { title: "fake", messages: [{ id: "newer", content: { parts: ["fake newer"] } }], page_info: { start_cursor: "c", has_previous_page: true } } };
      return realSend(id, m);
    };
    chrome.storage = { local: { set: async (v) => Object.assign(store, v), get: async () => ({ ...store }) } };
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle("fake-backups-" + (window.runId || "x"), { create: true });
    };
  </script>`;
  const base = require("url").pathToFileURL(PROJECT + "/").href;
  const page = fs.readFileSync(`${PROJECT}/dashboard.html`, "utf8")
    .replace('href="dashboard.css"', `href="${base}dashboard.css"`)
    .replace('<script src="api.js"></script>', `${fake}${extra}<script src="${base}api.js"></script>`)
    .replace(/src="(filters|storage|health|backup|accounts|search|meaning-logic|related|dashboard)\.js"/g, `src="${base}$1.js"`)
    .replace("</body>", `<script type="module">
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (test) => { for (let i = 0; i < 200 && !test(); i++) await wait(250); };
      window.runId = String(Date.now());
      const $ = (id) => document.getElementById(id);
      $("load-button").click();
      await until(() => !$("backup-button").hidden);
      $("backup-button").click();
      await until(() => $("archive-dialog").open);
      const previewTitle = $("dialog-title").textContent;
      const previewIntro = $("dialog-intro").textContent;
      window.previewImage = null;
      $("dialog-confirm").click();
      await until(() => $("dialog-title").textContent === "Done" || $("dialog-title").textContent === "Stopped early");
      const doneTitle = $("dialog-title").textContent;
      const doneMessage = $("dialog-message").textContent;
      const root = await navigator.storage.getDirectory();
      const folder = await (await root.getDirectoryHandle("fake-backups-" + window.runId)).getDirectoryHandle("Test User");
      const index = JSON.parse(await (await (await folder.getFileHandle("backup-index.json")).getFile()).text());
      const chatsDir = await folder.getDirectoryHandle("chats");
      const files = [];
      for await (const name of chatsDir.keys()) files.push(name);
      const one = JSON.parse(await (await (await chatsDir.getFileHandle(files[0])).getFile()).text());
      $("dialog-close").click();
      $("backup-button").click();
      await until(() => $("archive-dialog").open);
      const secondTitle = $("dialog-title").textContent;
      const secondIntro = $("dialog-intro").textContent;
      const result = document.createElement("pre");
      result.id = "RESULT";
      result.textContent = "RESULT:" + JSON.stringify({ previewTitle, previewIntro, doneTitle, doneMessage, indexed: Object.keys(index.chats).length, files: files.length, sampleMessages: one.chat.messages.map((m) => m.id), messageCount: one.messageCount, secondTitle, secondIntro, log: $("log-summary").textContent });
      document.body.append(result);
    </script></body>`);
  fs.writeFileSync(`${S}/preview4.html`, page);
  console.log("ok - browser run built");
})().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
