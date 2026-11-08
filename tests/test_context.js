const assert = require("assert"); const fs = require("fs"); const vm = require("vm");
const PROJECT = require("path").resolve(__dirname, "..");
function load(file, extra = {}) { const s = { URLSearchParams, encodeURIComponent, ...extra }; s.globalThis = s; vm.createContext(s); vm.runInContext(fs.readFileSync(`${PROJECT}/${file}`, "utf8"), s); return s; }
(async () => {
  const { OrganizerApi: Api } = load("api.js");
  const calls = [];
  const transport = async (path, ctx) => {
    calls.push([path, ctx]);
    if (!ctx) return { ok: false, status: 404 };
    if (path.includes("/messages?")) return { ok: true, data: { messages: [{ id: "old" }], page_info: { has_previous_page: false } } };
    return { ok: true, data: { messages: [{ id: "new" }], page_info: { start_cursor: "c", has_previous_page: true } } };
  };
  let api = Api.createApi({ transport, sleep: async () => {} });
  const chat = await api.fetchFullChat({ id: "c1", projectId: "g-p-1", ownerId: "user-1" });
  assert.deepEqual(Array.from(chat.messages, (m) => m.id), ["old", "new"]);
  assert.equal(calls.length, 3); assert.equal(calls[0][1], undefined);
  assert.equal(calls[1][1].projectId, "g-p-1"); assert.equal(calls[2][1].ownerId, "user-1");
  console.log("ok - 404 retries once with project and owner, including older pages");

  calls.length = 0;
  await assert.rejects(api.fetchFullChat({ id: "c1", projectId: null, ownerId: null }), (e) => e.status === 404);
  assert.equal(calls.length, 1);
  console.log("ok - a chat outside a project doesn't retry");

  let n = 0;
  api = Api.createApi({ transport: async () => { n++; return { ok: false, status: 404 }; }, sleep: async () => {} });
  await assert.rejects(api.fetchFullChat({ id: "c1", projectId: "g-p-1", ownerId: "user-1" }), (e) => e.status === 404);
  assert.equal(n, 2);
  console.log("ok - a second 404 fails after one retry");

  n = 0;
  api = Api.createApi({ transport: async () => { n++; return { ok: false, status: 403 }; }, sleep: async () => {} });
  await assert.rejects(api.fetchFullChat({ id: "c1", projectId: "g-p-1", ownerId: "user-1" }), (e) => e.status === 403);
  assert.equal(n, 1);
  console.log("ok - other errors don't retry");

  const fetches = []; let listener;
  load("content.js", { location: { origin: "https://chatgpt.com" },
    chrome: { runtime: { id: "me", onMessage: { addListener: (f) => { listener = f; } } } },
    fetch: async (url, o = {}) => { fetches.push({ url, o }); if (url.endsWith("/session")) return { ok: true, status: 200, json: async () => ({}) }; return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; } });
  const ask = (path, chatContext) => new Promise((r) => listener({ type: "organizer-get", path, chatContext }, { id: "me" }, r));
  const id = "6f1c2d3e-aaaa-4bbb-8ccc-0123456789ab"; const good = { projectId: "g-p-abc", ownerId: "user-abc" };
  for (const [path, ctx] of [
    [`/backend-api/conversations?limit=20`, good],
    [`/backend-api/conversations/${id}?num_turns=10`, { projectId: "g-abc", ownerId: "user-abc" }],
    [`/backend-api/conversations/${id}?num_turns=10`, { projectId: "g-p-abc", ownerId: "evil\r\nx: y" }],
    [`/backend-api/conversations/${id}?num_turns=10`, {}],
  ]) assert.equal((await ask(path, ctx)).error, "blocked", path);
  assert.equal(fetches.length, 0);
  assert.equal((await ask(`/backend-api/conversations/${id}/messages?before=c`, good)).ok, true);
  const h = fetches.find((f) => f.url.includes("/messages?")).o.headers;
  assert.equal(h["chatgpt-project-id"], "g-p-abc"); assert.equal(h["chatgpt-conv-owner-id"], "user-abc");
  fetches.length = 0;
  await ask(`/backend-api/conversations/${id}?num_turns=10`);
  assert.equal(fetches.find((f) => f.url.includes("/conversations/")).o.headers["chatgpt-project-id"], undefined);
  console.log("ok - content.js only adds validated headers to single-chat reads");
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
