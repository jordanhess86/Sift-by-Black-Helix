const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const PROJECT = require("path").resolve(__dirname, "..");
const S = __dirname;

function load(file, extra = {}) {
  const sandbox = { URLSearchParams, ...extra };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(`${PROJECT}/${file}`, "utf8"), sandbox);
  return sandbox;
}

const { OrganizerApi: Api } = load("api.js");
const chats = (n) => Array.from({ length: n }, (_, i) => ({ id: `chat-${i}`, title: `T${i}` }));
const ok = { ok: true, data: { success: true } };

async function run(name, test) {
  await test();
  console.log("ok -", name);
}

(async () => {
  await run("archives everything with small slow batches and logs each", async () => {
    const sent = [], sleeps = [], logged = [];
    const api = Api.createApi({ archiveTransport: async (id) => { sent.push(id); return ok; }, sleep: async (ms) => sleeps.push(ms) });
    const out = await api.archiveChats(chats(11), { onResult: async (c, f) => logged.push([c.id, f]) });
    assert.equal(out.succeeded.length, 11);
    assert.equal(sent.length, 11);
    assert.equal(logged.length, 11);
    assert.equal(out.stopReason, null);
    assert.deepEqual(sleeps, [1500,1500,1500,1500,6000,1500,1500,1500,1500,6000]);
    assert.equal(Api.estimatePacedSeconds(11), 24);
    assert.equal(Api.estimatePacedSeconds(1), 0);
  });

  await run("stops at the first failure and doesn't try the rest", async () => {
    const sent = [], logged = [];
    const api = Api.createApi({
      archiveTransport: async (id) => { sent.push(id); return id === "chat-2" ? { ok: false, status: 404 } : ok; },
      sleep: async () => {},
    });
    const out = await api.archiveChats(chats(6), { onResult: async (c, f) => logged.push([c.id, f]) });
    assert.equal(sent.length, 3);
    assert.equal(out.succeeded.length, 2);
    assert.equal(out.failed.length, 1);
    assert.equal(out.notAttempted.length, 3);
    assert.ok(out.stopReason.includes("404"));
    assert.ok(logged[2][1], "failure is logged");
  });

  await run("an unconfirmed answer counts as a failure", async () => {
    const api = Api.createApi({ archiveTransport: async () => ({ ok: true, data: {} }), sleep: async () => {} });
    const out = await api.archiveChats(chats(2));
    assert.equal(out.succeeded.length, 0);
    assert.equal(out.failed.length, 1);
  });

  await run("a lost tab stops the run", async () => {
    const api = Api.createApi({ archiveTransport: async () => { throw new Error("gone"); }, sleep: async () => {} });
    const out = await api.archiveChats(chats(3));
    assert.equal(out.failed.length, 1);
    assert.equal(out.notAttempted.length, 2);
  });

  await run("the Stop button stops before the next chat", async () => {
    let stop = false; const sent = [];
    const api = Api.createApi({ archiveTransport: async (id) => { sent.push(id); stop = true; return ok; }, sleep: async () => {} });
    const out = await api.archiveChats(chats(4), { shouldStop: () => stop });
    assert.equal(sent.length, 1);
    assert.equal(out.notAttempted.length, 3);
    assert.equal(out.stopReason, "You stopped the run.");
  });

  await run("waits on 429, then stops if it continues", async () => {
    let calls = 0; const sleeps = [];
    let api = Api.createApi({
      archiveTransport: async () => (++calls === 1 ? { ok: false, status: 429, retryAfter: "9" } : ok),
      sleep: async (ms) => sleeps.push(ms),
    });
    let out = await api.archiveChats(chats(1));
    assert.equal(out.succeeded.length, 1);
    assert.deepEqual(sleeps, [9000]);

    calls = 0;
    api = Api.createApi({ archiveTransport: async () => { calls++; return { ok: false, status: 429 }; }, sleep: async () => {} });
    out = await api.archiveChats(chats(3));
    assert.equal(calls, 4);
    assert.equal(out.notAttempted.length, 2);
  });

  await run("the run stops if the log can't be saved", async () => {
    const sent = [];
    const api = Api.createApi({ archiveTransport: async (id) => { sent.push(id); return ok; }, sleep: async () => {} });
    const out = await api.archiveChats(chats(3), { onResult: async () => { throw new Error("full"); } });
    assert.equal(sent.length, 1);
    assert.ok(out.stopReason.includes("action log"));
  });

  await run("archiving with a backup: backup first, and a failed backup means no archive", async () => {
    const steps = [];
    const transport = async () => ({ ok: true, data: { title: "t", messages: [{ id: "m" }], page_info: { has_previous_page: false } } });
    const archiveTransport = async (id) => { steps.push(`archive ${id}`); return ok; };
    let api = Api.createApi({ transport, archiveTransport, sleep: async () => {} });
    let out = await api.archiveChats(chats(2), { saveBackup: async (c) => steps.push(`save ${c.id}`) });
    assert.deepEqual(steps, ["save chat-0", "archive chat-0", "save chat-1", "archive chat-1"]);
    assert.equal(out.succeeded.length, 2);

    steps.length = 0;
    out = await api.archiveChats(chats(3), { saveBackup: async () => { throw new Error("disk"); } });
    assert.deepEqual(steps, []);
    assert.equal(out.failed.length, 1);
    assert.equal(out.notAttempted.length, 2);
    assert.ok(out.stopReason.startsWith("Not changed"));

    let stop = false;
    out = await api.archiveChats(chats(2), { saveBackup: async () => { stop = true; }, shouldStop: () => stop });
    assert.deepEqual(steps, []);
    assert.equal(out.notAttempted.length, 2);

    api = Api.createApi({ transport: async () => ({ ok: true, data: { title: "t", messages: [], page_info: { has_previous_page: false } } }), archiveTransport, sleep: async () => {} });
    out = await api.archiveChats(chats(1), { saveBackup: async () => steps.push("save") });
    assert.deepEqual(steps, []);
    assert.equal(out.failed.length, 1);
  });

  await run("restoring sends only the restore request and stops on failure", async () => {
    const sent = [];
    const api = Api.createApi({ restoreTransport: async (id) => { sent.push(id); return id === "chat-1" ? { ok: false, status: 403 } : ok; }, sleep: async () => {} });
    const out = await api.restoreChats(chats(3));
    assert.deepEqual(sent, ["chat-0", "chat-1"]);
    assert.equal(out.notAttempted.length, 1);
  });

  await run("content.js archives only with the fixed request", async () => {
    const fetches = []; let listener;
    const sandbox = load("content.js", {
      location: { origin: "https://chatgpt.com" },
      chrome: { runtime: { id: "me", onMessage: { addListener: (fn) => { listener = fn; } } } },
      fetch: async (url, options = {}) => {
        fetches.push({ url, options });
        if (url.endsWith("/api/auth/session")) return { ok: true, status: 200, json: async () => ({ accessToken: "SECRET" }) };
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ success: true }) };
      },
    });
    const ask = (message) => new Promise((resolve) => {
      if (!listener(message, { id: "me" }, resolve)) resolve("ignored");
    });

    for (const bad of ["../me", "abc/def", "id/12345678", "short", "", null, 5, "a".repeat(65)]) {
      assert.equal((await ask({ type: "organizer-archive", chatId: bad })).error, "blocked", String(bad));
    }
    assert.equal(fetches.length, 0);
    assert.equal(await ask({ type: "organizer-unknown", chatId: "12345678-1234" }), "ignored");
    assert.equal((await ask({ type: "organizer-get", path: "/backend-api/conversation/id/12345678" })).error, "blocked");
    assert.equal(fetches.length, 0);

    const id = "6f1c2d3e-aaaa-4bbb-8ccc-0123456789ab";
    const reply = await ask({ type: "organizer-archive", chatId: id, is_archived: false, method: "DELETE" });
    assert.equal(reply.ok, true);
    const call = fetches.find((f) => f.url.includes("/backend-api/"));
    assert.equal(call.url, `https://chatgpt.com/backend-api/conversation/${id}`);
    assert.equal(call.options.method, "PATCH");
    assert.equal(call.options.body, '{"is_archived":true}');
    fetches.length = 0;
    assert.equal((await ask({ type: "organizer-restore", chatId: id, is_archived: true })).ok, true);
    const restore = fetches.find((f) => f.url.includes("/backend-api/"));
    assert.equal(restore.url, `https://chatgpt.com/backend-api/conversation/${id}`);
    assert.equal(restore.options.method, "PATCH");
    assert.equal(restore.options.body, '{"is_archived":false}');
    assert.equal((await ask({ type: "organizer-restore", chatId: "../x" })).error, "blocked");
    fetches.length = 0;
    assert.equal((await ask({ type: "organizer-rename", chatId: id, title: 'New "name"', is_archived: false, gizmo_id: "x" })).ok, true);
    const rename = fetches.find((f) => f.url.includes("/backend-api/"));
    assert.equal(rename.url, `https://chatgpt.com/backend-api/conversation/${id}`);
    assert.equal(rename.options.method, "PATCH");
    assert.deepEqual(JSON.parse(rename.options.body), { title: 'New "name"' });
    for (const title of ["", "   ", 5, null, "x".repeat(201)]) {
      assert.equal((await ask({ type: "organizer-rename", chatId: id, title })).error, "blocked", String(title));
    }
    assert.equal((await ask({ type: "organizer-rename", chatId: "../x", title: "ok" })).error, "blocked");
    assert.ok(!JSON.stringify(reply).includes("SECRET"));
  });

  await run("the log saves separately and exports safe CSV", async () => {
    const stored = {};
    const { OrganizerLog } = load("storage.js", {
      crypto: require("crypto"),
      chrome: { storage: { local: {
        set: async (v) => Object.assign(stored, v),
        get: async () => ({ ...stored, unrelated: 1 }),
      } } },
    });
    await OrganizerLog.addEntry({ action: "archive", result: "success", chatId: "a", title: 'He said "hi", ok', project: "", detail: "" });
    await OrganizerLog.addEntry({ action: "archive", result: "failed", chatId: "b", title: "=HYPERLINK(1)", project: "P", detail: "x" });
    const entries = await OrganizerLog.getEntries();
    assert.equal(entries.length, 2);
    const csv = OrganizerLog.toCsv(entries);
    assert.ok(csv.includes('"He said ""hi"", ok"'));
    assert.ok(csv.includes(`"'=HYPERLINK(1)"`));
    assert.ok(csv.startsWith("time,action,result,title,project,chatId,detail"));
  });

  // Build two previews from the real page, using made-up chats.
  const fake = fs.readFileSync(`${S}/preview.html`, "utf8").match(/<script>\s*\/\/ Fake[\s\S]*?<\/script>/)[0];
  const extra = `<script>
    const realSend = chrome.tabs.sendMessage;
    const store = {};
    chrome.tabs.sendMessage = async (id, m) => {
      if (m.type === "organizer-archive") {
        return window.failChat && m.chatId === window.failChat ? { ok: false, status: 403 } : { ok: true, data: { success: true } };
      }
      if (m.path && m.path.includes("?num_turns=")) return { ok: true, data: { title: "fake", messages: [{ id: "m" }], page_info: { has_previous_page: false } } };
      return realSend(id, m);
    };
    chrome.storage = { local: { set: async (v) => Object.assign(store, v), get: async () => ({ ...store }) } };
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("fake-backups", { create: true });
  </script>`;
  const base = require("url").pathToFileURL(PROJECT + "/").href;
  const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
  const build = (script) => fs.readFileSync(`${PROJECT}/dashboard.html`, "utf8")
    .replace('href="dashboard.css"', `href="${base}dashboard.css"`)
    .replace('<script src="api.js"></script>', `${fake}${extra}<script src="${base}api.js"></script>`)
    .replace('src="filters.js"', `src="${base}filters.js"`)
    .replace('src="storage.js"', `src="${base}storage.js"`)
    .replace('src="health.js"', `src="${base}health.js"`)
    .replace('src="backup.js"', `src="${base}backup.js"`)
    .replace('src="accounts.js"', `src="${base}accounts.js"`)
    .replace('src="search.js"', `src="${base}search.js"`)
    .replace('src="meaning-logic.js"', `src="${base}meaning-logic.js"`)
    .replace('src="related.js"', `src="${base}related.js"`)
    .replace('src="dashboard.js"></script>', `src="${base}dashboard.js"></script><script type="module">
      document.getElementById("load-button").click();
      ${wait(8000)}
      const boxes = document.querySelectorAll("#chat-rows input[type=checkbox]");
      [0, 1, 4].forEach((i) => boxes[i].click());
      document.getElementById("archive-button").click();
      ${wait(1000)}
      ${script}
    </script>`);
  fs.writeFileSync(`${S}/preview3a.html`, build(""));
  fs.writeFileSync(`${S}/preview3b.html`, build(`
      window.failChat = "5";
      document.getElementById("dialog-confirm").click();
      ${wait(12000)}
  `));
  console.log("ok - previews built");
})().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
