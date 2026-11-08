const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const PROJECT = require("path").resolve(__dirname, "..");

const chat = (id, extra = {}) => ({
  id, title: `Title ${id}`, create_time: "2026-01-02T03:04:05Z",
  update_time: "2026-02-03T04:05:06Z", gizmo_id: null, is_archived: false, ...extra,
});

function loadApi() {
  const sandbox = { URLSearchParams, Date, Number, Math, Set, Map, Array, parseInt };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(`${PROJECT}/api.js`, "utf8"), sandbox);
  return sandbox.OrganizerApi;
}

function fakeServer(overrides = {}) {
  const calls = [];
  const active = Array.from({ length: 45 }, (_, i) => chat(`a${i}`));
  active[0].gizmo_id = "g-p-one";
  active[1].gizmo_id = "g-custom";
  const transport = async (path) => {
    calls.push(path);
    const url = new URL(path, "https://chatgpt.com");
    if (overrides[url.pathname]) {
      const result = overrides[url.pathname](url);
      if (result) return result;
    }
    if (url.pathname === "/backend-api/gizmos/snorlax/sidebar") {
      return { ok: true, data: { cursor: null, items: [
        { gizmo: { gizmo: { id: "g-p-one", display: { name: "One" } } },
          conversations: { items: [chat("p1", { gizmo_id: "g-p-one" })], cursor: "next1" } },
        { gizmo: { gizmo: { id: "g-p-two", display: { name: "Two" } } },
          conversations: { items: [], cursor: null } },
      ] } };
    }
    if (url.pathname === "/backend-api/gizmos/g-p-one/conversations") {
      assert.equal(url.searchParams.get("cursor"), "next1");
      return { ok: true, data: { items: [chat("p2", { gizmo_id: "g-p-one" })], cursor: null } };
    }
    if (url.pathname === "/backend-api/conversations") {
      const offset = Number(url.searchParams.get("offset"));
      const source = url.searchParams.get("is_archived") === "true"
        ? [chat("x1", { is_archived: true })] : active;
      return { ok: true, data: { items: source.slice(offset, offset + 20) } };
    }
    throw new Error(`Unexpected path ${path}`);
  };
  return { transport, calls };
}

async function run(name, test) {
  await test();
  console.log("ok -", name);
}

(async () => {
  const Api = loadApi();

  await run("merges chats, projects and archived correctly, with pauses", async () => {
    const { transport, calls } = fakeServer();
    const sleeps = [];
    const lib = await Api.createApi({ transport, sleep: async (ms) => sleeps.push(ms) }).loadLibrary();
    const byId = new Map(lib.chats.map((c) => [c.id, c]));
    assert.equal(lib.chats.length, 48);
    assert.equal(lib.warnings.length, 0);
    assert.equal(byId.get("p2").projectId, "g-p-one");
    assert.equal(byId.get("a0").projectId, "g-p-one");
    assert.equal(byId.get("a1").projectId, null);
    assert.equal(byId.get("a1").hasOtherGizmo, true);
    assert.equal(byId.get("x1").isArchived, true);
    assert.equal(byId.get("a2").createdAt, Date.parse("2026-01-02T03:04:05Z"));
    assert.equal(sleeps.length, calls.length - 1);
    assert.ok(sleeps.every((ms) => ms >= 1500));
    assert.ok(!calls.some((p) => p.includes("/gizmos/g-p-two/")), "no extra request for a complete project");
  });

  await run("waits on 429 and then succeeds", async () => {
    let limited = false;
    const { transport } = fakeServer({
      "/backend-api/conversations": () => {
        if (!limited) { limited = true; return { ok: false, status: 429, retryAfter: "7" }; }
      },
    });
    const sleeps = [];
    const lib = await Api.createApi({ transport, sleep: async (ms) => sleeps.push(ms) }).loadLibrary();
    assert.ok(sleeps.includes(7000));
    assert.equal(lib.chats.length, 48);
  });

  await run("stops all requests when 429 continues", async () => {
    const { transport, calls } = fakeServer({
      "/backend-api/conversations": () => ({ ok: false, status: 429 }),
    });
    const api = Api.createApi({ transport, sleep: async () => {} });
    await assert.rejects(api.loadLibrary(), (e) => e.status === 429);
    assert.equal(calls.filter((p) => p.startsWith("/backend-api/conversations")).length, 4);
  });

  await run("project failure becomes a warning and chats still load", async () => {
    const { transport } = fakeServer({
      "/backend-api/gizmos/snorlax/sidebar": () => ({ ok: false, status: 404 }),
    });
    const lib = await Api.createApi({ transport, sleep: async () => {} }).loadLibrary();
    assert.equal(lib.projects.length, 0);
    assert.equal(lib.chats.length, 46);
    assert.equal(lib.warnings.length, 1);
  });

  await run("repeating pages cannot loop forever", async () => {
    const { transport, calls } = fakeServer({
      "/backend-api/conversations": () => ({ ok: true, data: { items: [chat("same")] } }),
    });
    await Api.createApi({ transport, sleep: async () => {} }).loadLibrary();
    assert.ok(calls.length < 20);
  });

  await run("content.js is read-only and keeps the token private", async () => {
    const fetches = [];
    let listener;
    const sandbox = {
      location: { origin: "https://chatgpt.com" },
      chrome: { runtime: { id: "me", onMessage: { addListener: (fn) => { listener = fn; } } } },
      fetch: async (url, options = {}) => {
        fetches.push({ url, options });
        if (url.endsWith("/api/auth/session")) {
          return { ok: true, status: 200, json: async () => ({ accessToken: "SECRET" }) };
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ items: [] }) };
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(`${PROJECT}/content.js`, "utf8"), sandbox);
    const ask = (path, sender = { id: "me" }) => new Promise((resolve) => {
      const pending = listener({ type: "organizer-get", path }, sender, resolve);
      if (!pending) resolve("ignored");
    });

    for (const bad of [
      "/backend-api/conversation/abc", "/backend-api/conversations/abc?x=1",
      "/api/auth/session", "/backend-api/me?x=1",
      "/backend-api/gizmos/a/b/conversations?x=1",
      "//evil.example/backend-api/conversations?x=1",
    ]) {
      assert.equal((await ask(bad)).error, "blocked", bad);
    }
    assert.equal(fetches.length, 0, "blocked paths make no requests");

    assert.equal(await ask("/backend-api/conversations?limit=20", { id: "other" }), "ignored");
    assert.equal(await ask("/backend-api/conversations?limit=20", { id: "me", tab: {} }), "ignored");

    const good = await ask("/backend-api/conversations?limit=20");
    assert.equal(good.ok, true);
    assert.ok(!JSON.stringify(good).includes("SECRET"), "token not returned");
    const dataCall = fetches.find((f) => f.url.includes("/backend-api/"));
    assert.equal(dataCall.options.method, "GET");
    assert.equal(dataCall.options.headers.Authorization, "Bearer SECRET");
    assert.ok(fetches.every((f) => f.url.startsWith("https://chatgpt.com/")));
  });

  JSON.parse(fs.readFileSync(`${PROJECT}/manifest.json`, "utf8"));
  console.log("ok - manifest.json is valid JSON");
})().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
