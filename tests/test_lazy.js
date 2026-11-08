// Tests loading project and archived chats only when asked, using made-up data.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const PROJECT = path.resolve(__dirname, "..");
const sandbox = { URLSearchParams, encodeURIComponent };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(`${PROJECT}/api.js`, "utf8"), sandbox);
const Api = sandbox.OrganizerApi;
const plain = (v) => JSON.parse(JSON.stringify(v));
const chat = (id, extra = {}) => ({ id, title: id, create_time: "2026-01-01T00:00:00Z", update_time: "2026-01-02T00:00:00Z", gizmo_id: null, is_archived: false, ...extra });

function fake({ ignoreHide = false } = {}) {
  const asked = [];
  const transport = async (p) => {
    asked.push(p);
    const url = new URL(p, "https://x");
    if (url.pathname.endsWith("/sidebar")) {
      return { ok: true, data: { cursor: null, items: [
        { gizmo: { gizmo: { id: "g-p-1", display: { name: "Small" } } }, conversations: { cursor: null, items: [chat("s1", { gizmo_id: "g-p-1" })] } },
        { gizmo: { gizmo: { id: "g-p-2", display: { name: "Big" } } }, conversations: { cursor: "c1", items: [chat("b1", { gizmo_id: "g-p-2" })] } },
      ] } };
    }
    if (url.pathname.includes("/gizmos/g-p-2/")) return { ok: true, data: { cursor: null, items: [chat("b2", { gizmo_id: "g-p-2" })] } };
    if (url.searchParams.get("offset") !== "0") return { ok: true, data: { items: [] } };
    if (url.searchParams.get("is_archived") === "true") return { ok: true, data: { items: [chat("x1", { is_archived: true })] } };
    const items = [chat("n1"), chat("gpt", { gizmo_id: "g-custom" })];
    if (ignoreHide || url.searchParams.get("hide_snorlax") === "false") items.push(chat("b1", { gizmo_id: "g-p-2" }));
    return { ok: true, data: { items } };
  };
  return { asked, api: Api.createApi({ transport, sleep: async () => {} }) };
}

async function run(name, test) {
  await test();
  console.log("ok -", name);
}

(async () => {
  await run("basics load project names and non-project chats, and nothing else", async () => {
    const { api, asked } = fake();
    const out = await api.loadBasics();
    assert.deepEqual(plain(out.projects), [{ id: "g-p-1", name: "Small" }, { id: "g-p-2", name: "Big" }]);
    assert.deepEqual(plain(out.chats).map((c) => c.id).sort(), ["gpt", "n1"]);
    assert.equal(out.projectChatsSkipped, 0);
    assert.ok(asked.every((p) => !p.includes("is_archived=true")), "no archived list");
    assert.ok(asked.every((p) => !p.includes("/g-p-")), "no project chat lists");
    assert.ok(asked.filter((p) => p.includes("/conversations?")).every((p) => p.includes("hide_snorlax=true")));
    assert.equal(plain(out.chats).find((c) => c.id === "gpt").hasOtherGizmo, true, "a custom GPT chat stays labelled");
  });

  await run("if ChatGPT sends project chats anyway, they wait for their project and get counted", async () => {
    const { api } = fake({ ignoreHide: true });
    const out = await api.loadBasics();
    assert.ok(!plain(out.chats).some((c) => c.id === "b1"));
    assert.equal(out.projectChatsSkipped, 1);
  });

  await run("a small project needs no request, and a big one asks for the rest", async () => {
    const { api, asked } = fake();
    const { projectSeeds } = await api.loadBasics();
    asked.length = 0;
    const small = plain(await api.loadProjectChats(projectSeeds[0]));
    assert.equal(asked.length, 0);
    assert.deepEqual(small.map((c) => [c.id, c.projectId, c.hasOtherGizmo]), [["s1", "g-p-1", false]]);
    const big = plain(await api.loadProjectChats(projectSeeds[1]));
    assert.equal(asked.length, 1);
    assert.deepEqual(big.map((c) => [c.id, c.projectId]), [["b1", "g-p-2"], ["b2", "g-p-2"]]);
  });

  await run("archived chats load on their own", async () => {
    const { api } = fake();
    assert.deepEqual(plain(await api.loadArchivedChats(["g-p-1"])).map((c) => [c.id, c.isArchived]), [["x1", true]]);
  });

  await run("loading everything still works as before", async () => {
    const { api, asked } = fake();
    const out = await api.loadLibrary();
    assert.deepEqual(plain(out.chats).map((c) => c.id).sort(), ["b1", "b2", "gpt", "n1", "s1", "x1"]);
    assert.ok(asked.some((p) => p.includes("hide_snorlax=false")));
  });

  await run("a failed project list keeps the chats and warns", async () => {
    const api = Api.createApi({
      transport: async (p) => (p.includes("/sidebar") ? { ok: false, status: 500 } : { ok: true, data: { items: new URL(p, "https://x").searchParams.get("offset") === "0" ? [chat("n1")] : [] } }),
      sleep: async () => {},
    });
    const out = await api.loadBasics();
    assert.equal(out.chats.length, 1);
    assert.equal(out.warnings.length, 1);
  });
})().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
