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
async function run(name, test) { await test(); console.log("ok -", name); }

(async () => {
  const { OrganizerApi: Api } = load("api.js");

  await run("moves in slow batches to the chosen project and stops on failure", async () => {
    const sent = [], sleeps = [];
    let api = Api.createApi({ moveTransport: async (c, p) => { sent.push([c, p]); return { ok: true, data: { success: true } }; }, sleep: async (ms) => sleeps.push(ms) });
    let out = await api.moveChats(Array.from({ length: 6 }, (_, i) => ({ id: `c${i}` })), "g-p-1");
    assert.equal(out.succeeded.length, 6);
    assert.ok(sent.every(([, p]) => p === "g-p-1"));
    assert.deepEqual(sleeps, [1500, 1500, 1500, 1500, 6000]);

    api = Api.createApi({ moveTransport: async (c) => (c === "c1" ? { ok: false, status: 403 } : { ok: true, data: { success: true } }), sleep: async () => {} });
    out = await api.moveChats([{ id: "c0" }, { id: "c1" }, { id: "c2" }], "g-p-1");
    assert.equal(out.succeeded.length, 1);
    assert.equal(out.failed.length, 1);
    assert.equal(out.notAttempted.length, 1);
  });

  await run("content.js sends only the project ID and rejects anything else", async () => {
    const fetches = []; let listener;
    load("content.js", {
      location: { origin: "https://chatgpt.com" },
      chrome: { runtime: { id: "me", onMessage: { addListener: (fn) => { listener = fn; } } } },
      fetch: async (url, o = {}) => {
        fetches.push({ url, o });
        if (url.endsWith("/session")) return { ok: true, status: 200, json: async () => ({}) };
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ success: true }) };
      },
    });
    const ask = (m) => new Promise((resolve) => listener({ type: "organizer-move", ...m }, { id: "me" }, resolve));
    const id = "6f1c2d3e-aaaa-4bbb-8ccc-0123456789ab";
    for (const projectId of ["g-abc123", "", null, 5, "g-p-a/b", "g-p-x\"y", "../g-p-1"]) {
      assert.equal((await ask({ chatId: id, projectId })).error, "blocked", String(projectId));
    }
    assert.equal((await ask({ chatId: "../x", projectId: "g-p-1" })).error, "blocked");
    assert.equal(fetches.length, 0);

    assert.equal((await ask({ chatId: id, projectId: "g-p-abc_1-2", is_archived: true })).ok, true);
    const call = fetches.find((f) => f.url.includes("/backend-api/"));
    assert.equal(call.url, `https://chatgpt.com/backend-api/conversation/${id}`);
    assert.equal(call.o.method, "PATCH");
    assert.equal(call.o.body, '{"gizmo_id":"g-p-abc_1-2"}');
  });

  // A real run of the page in a browser, using made-up chats.
  const fake = fs.readFileSync(`${S}/preview.html`, "utf8").match(/<script>\s*\/\/ Fake[\s\S]*?<\/script>/)[0];
  const extra = `<script>
    const realSend = chrome.tabs.sendMessage;
    const store = {};
    window.moves = [];
    chrome.tabs.sendMessage = async (id, m) => {
      if (m.type === "organizer-move") { window.moves.push([m.chatId, m.projectId]); return { ok: true, data: { success: true } }; }
      return realSend(id, m);
    };
    chrome.storage = { local: { set: async (v) => Object.assign(store, v), get: async () => ({ ...store }) } };
  </script>`;
  const body = fs.readFileSync(`${PROJECT}/dashboard.html`, "utf8").replace('<script src="api.js"></script>', `${fake}${extra}<script src="api.js"></script>`);
  const steps = `
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (test) => { for (let i = 0; i < 240 && !test(); i++) await wait(250); };
      const $ = (id) => document.getElementById(id);
      $("load-button").click();
      await until(() => !$("backup-button").hidden);
      const buttonBefore = $("move-button").disabled;
      const boxes = document.querySelectorAll("#chat-rows input[type=checkbox]");
      [0, 1, 3, 4].forEach((i) => boxes[i].click());
      const stillDisabledWithoutTarget = $("move-button").disabled;
      $("move-target").value = "g-p-2";
      $("move-target").dispatchEvent(new Event("change"));
      const options = [...$("move-target").options].map((o) => o.textContent);
      $("move-button").click();`;
  fs.writeFileSync(`${S}/web/move.html`, body.replace("</body>", `<script type="module">
      ${steps}
      const previewTitle = $("dialog-title").textContent;
      const previewIntro = $("dialog-intro").textContent;
      const previewList = [...$("dialog-list").children].map((li) => li.textContent);
      $("dialog-confirm").click();
      await until(() => $("dialog-title").textContent === "Done" || $("dialog-title").textContent === "Stopped early");
      const groups = [...document.querySelectorAll(".group-button")].map((b) => b.textContent);
      await until(() => $("log-summary").textContent !== "Action log (0)");
      const result = { buttonBefore, stillDisabledWithoutTarget, options, previewTitle, previewIntro, previewList, doneTitle: $("dialog-title").textContent, doneMessage: $("dialog-message").textContent, listAfter: [...$("dialog-list").children].map((li) => li.textContent), moves: window.moves, groups, log: $("log-summary").textContent, logRow: $("log-rows").rows[0] && [...$("log-rows").rows[0].cells].slice(1).map((c) => c.textContent) };
      fetch("/result", { method: "POST", body: JSON.stringify(result) });
    </script></body>`));
  fs.writeFileSync(`${S}/web/move-shot.html`, body.replace("</body>", `<script type="module">
      ${steps}
    </script></body>`));
  console.log("ok - browser run built");
})().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
