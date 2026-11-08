// Tests the checks on ChatGPT's answers and the diagnostic report, using made-up data.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const PROJECT = path.resolve(__dirname, "..");
const source = fs.readFileSync(`${PROJECT}/health.js`, "utf8");

function fresh() {
  const sandbox = { URLSearchParams };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.OrganizerHealth;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const LIST = "/backend-api/conversations?offset=0&limit=20&order=updated&is_archived=false";
const SIDEBAR = "/backend-api/gizmos/snorlax/sidebar?limit=20&cursor=SECRETCURSOR";
const CHAT_ID = "6f1c2d3e-aaaa-4bbb-8ccc-0123456789ab";
const chat = { id: CHAT_ID, title: "SECRET TITLE", create_time: "x", update_time: "y", gizmo_id: null };
const project = { gizmo: { gizmo: { id: "g-p-SECRET", display: { name: "SECRET PROJECT" } } }, conversations: { items: [chat], cursor: null } };

function run(name, test) {
  test();
  console.log("ok -", name);
}

run("paths keep their structure and lose anything personal", () => {
  const H = fresh();
  assert.equal(H.templatePath(LIST), "/backend-api/conversations?expand".replace("?expand", "?is_archived&limit&offset&order"));
  assert.equal(H.templatePath(`/backend-api/conversations/${CHAT_ID}/messages?before=SECRET&num_turns=10`), "/backend-api/conversations/<id>/messages?before&num_turns");
  assert.equal(H.templatePath("/backend-api/gizmos/g-p-abc123/conversations?cursor=SECRET"), "/backend-api/gizmos/<id>/conversations?cursor");
  assert.equal(H.templatePath(`/backend-api/conversation/id/${CHAT_ID}`), "/backend-api/conversation/id/<id>");
  assert.equal(H.templatePath(SIDEBAR), "/backend-api/gizmos/snorlax/sidebar?cursor&limit");
});

run("shapes record field names and types, never values", () => {
  const H = fresh();
  const shape = plain(H.describeShape({ items: [chat], total: 3, none: null, list: [], [CHAT_ID]: { text: "SECRET" }, "weird key!": 1 }));
  assert.deepEqual(shape.items, [{ create_time: "string", gizmo_id: "null", id: "string", title: "string", update_time: "string" }]);
  assert.equal(shape.total, "number");
  assert.deepEqual(shape.list, ["empty"]);
  assert.equal(shape["<other fields>"], 2);
  assert.ok(!JSON.stringify(shape).includes("SECRET"));
  assert.ok(!JSON.stringify(shape).includes(CHAT_ID));
});

run("good answers pause nothing", () => {
  const H = fresh();
  H.observeRead(LIST, { ok: true, data: { items: [chat] } });
  H.observeRead(LIST, { ok: true, data: { items: [] } });
  H.observeRead(SIDEBAR, { ok: true, data: { items: [project], cursor: null } });
  H.observeRead(`/backend-api/conversations/${CHAT_ID}?num_turns=10`, { ok: true, data: { messages: [{ id: "m" }] } });
  H.observeChange("archive", `/backend-api/conversation/${CHAT_ID}`, { ok: true, data: { success: true } });
  assert.deepEqual(plain(H.problems()), []);
  assert.equal(H.isPaused("delete"), false);
});

run("a changed chat list pauses every change, and a fresh check clears it", () => {
  for (const data of [{ items: [{ conversation_id: "x" }] }, { conversations: [] }, { items: [{ id: "a", title: "t" }] }, null]) {
    const H = fresh();
    H.observeRead(LIST, { ok: true, data });
    for (const action of ["archive", "restore", "rename", "move", "createProject", "delete", "backup"]) assert.equal(H.isPaused(action), true, action);
    H.reset();
    assert.equal(H.isPaused("delete"), false);
  }
});

run("a changed project list pauses moving and deleting, but not archiving", () => {
  for (const item of [{ gizmo: { name: "x" } }, { gizmo: { gizmo: { id: "g-p-1" } }, conversations: { items: [] } }, { gizmo: { gizmo: { id: "g-p-1", display: {} } } }]) {
    const H = fresh();
    H.observeRead(SIDEBAR, { ok: true, data: { items: [item] } });
    assert.equal(H.isPaused("move"), true);
    assert.equal(H.isPaused("createProject"), true);
    assert.equal(H.isPaused("delete"), true);
    assert.equal(H.isPaused("archive"), false);
  }
});

run("a changed chat format pauses anything that relies on backups", () => {
  const H = fresh();
  H.observeRead(`/backend-api/conversations/${CHAT_ID}?num_turns=10`, { ok: true, data: { mapping: {} } });
  for (const action of ["archive", "delete", "backup"]) assert.equal(H.isPaused(action), true);
  assert.equal(H.isPaused("move"), false);
});

run("login, slow-down and one missing chat aren't treated as site changes", () => {
  const H = fresh();
  H.observeRead(LIST, { ok: false, status: 401 });
  H.observeRead(LIST, { ok: false, status: 403 });
  H.observeRead(LIST, { ok: false, status: 429 });
  H.observeRead(LIST, { ok: false, status: 500 });
  H.observeRead(LIST, { ok: false, status: 0, error: "network" });
  H.observeRead(`/backend-api/conversations/${CHAT_ID}?num_turns=10`, { ok: false, status: 404 });
  H.observeChange("delete", `/backend-api/conversation/id/${CHAT_ID}`, { ok: false, status: 404 });
  assert.deepEqual(plain(H.problems()), []);
});

run("a missing list address, or an answer that isn't data, is a site change", () => {
  let H = fresh();
  H.observeRead(LIST, { ok: false, status: 404 });
  assert.equal(H.isPaused("delete"), true);
  H = fresh();
  H.observeRead(SIDEBAR, { ok: false, status: 0, error: "not-json" });
  assert.equal(H.isPaused("move"), true);
});

run("an unconfirmed change pauses only that action", () => {
  const H = fresh();
  H.observeChange("archive", `/backend-api/conversation/${CHAT_ID}`, { ok: true, data: { done: true } });
  assert.equal(H.isPaused("archive"), true);
  assert.equal(H.isPaused("delete"), false);
  const I = fresh();
  I.observeChange("rename", `/backend-api/conversation/${CHAT_ID}`, { ok: false, status: 422 });
  assert.equal(I.isPaused("rename"), true);
  const J = fresh();
  J.observeChange("createProject", "/backend-api/projects", { ok: true, data: { resource: {} } }, (data) => typeof data?.resource?.gizmo?.id === "string");
  assert.equal(J.isPaused("createProject"), true);
});

run("the report holds no personal data, and stays small", () => {
  const H = fresh();
  H.observeRead(LIST, { ok: true, data: { items: [chat] } });
  H.observeRead(SIDEBAR, { ok: true, data: { items: [project], cursor: "SECRETCURSOR" } });
  H.observeRead(`/backend-api/conversations/${CHAT_ID}?num_turns=10`, {
    ok: true,
    data: { title: "SECRET TITLE", email: "SECRET@example.com", mapping: { [CHAT_ID]: { message: "SECRET" } }, messages: [{ id: "SECRETMESSAGEID", author: { role: "user", name: "SECRET" }, content: { parts: ["SECRET TEXT"] } }] },
  });
  H.observeChange("move", `/backend-api/conversation/${CHAT_ID}`, { ok: true, data: { success: true } });
  H.observeRead(LIST, { ok: false, status: 500, error: "SECRET ERROR" }) ;
  for (let i = 0; i < 200; i += 1) H.observeRead(`/backend-api/conversations/${CHAT_ID}?num_turns=${i}`, { ok: false, status: 500 + i });
  const report = plain(H.buildReport({ version: "1", chrome: "156" }));
  const text = JSON.stringify(report);
  assert.ok(report.answers.length <= 60);
  assert.equal(report.siftVersion, "1");
  assert.ok(!text.includes(CHAT_ID));
  assert.ok(!text.includes("g-p-"));
  assert.ok(!text.toLowerCase().includes("example.com"));
  for (const answer of report.answers) assert.ok(!JSON.stringify(answer).replace(/SECRET ERROR/g, "").includes("SECRET"), JSON.stringify(answer));
});

run("an old helper or old version isn't blamed on ChatGPT", () => {
  const H = fresh();
  H.noteOldHelper();
  assert.equal(H.hasSiteChange(), false);
  assert.equal(H.isPaused("delete"), true);
  assert.equal(H.isPaused("move"), false);
  H.noteOldVersion();
  assert.equal(H.hasSiteChange(), false);
  assert.equal(H.isPaused("move"), true);
  H.noteAccountMissing();
  assert.equal(H.hasSiteChange(), true);
  H.reset();
  assert.equal(H.hasProblem("oldVersion"), false);
});

run("health.js never uses the network", () => {
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|https?:\/\//.test(source));
});
