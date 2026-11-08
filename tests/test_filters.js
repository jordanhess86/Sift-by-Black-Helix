const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const PROJECT = require("path").resolve(__dirname, "..");
const S = __dirname;

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(`${PROJECT}/filters.js`, "utf8"), sandbox);
const { filterChats, hasActiveFilters, sortChats, notUpdatedSince, shortChatIds } = sandbox.OrganizerFilters;

const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const chats = [
  { id: "a", title: "Budget for NEW cabinets", updatedAt: local(2026, 3, 10), createdAt: local(2026, 1, 1) },
  { id: "b", title: "Cover letter help", updatedAt: local(2026, 3, 11, 23, 59), createdAt: local(2026, 3, 11, 0, 0) },
  { id: "c", title: "Cabinet colors", updatedAt: null, createdAt: null },
];
const ids = (f) => filterChats(chats, { keyword: "", dateField: "updatedAt", from: "", to: "", ...f }).map((c) => c.id).join("");

const sortList = [
  { id: "a", title: "banana", updatedAt: 3, createdAt: 1, p: "Zoo" },
  { id: "b", title: "Apple", updatedAt: 1, createdAt: 3, p: "" },
  { id: "c", title: "chat 10", updatedAt: 2, createdAt: null, p: "alpha" },
  { id: "d", title: "chat 2", updatedAt: null, createdAt: 2, p: "" },
];
const sorted = (key, direction) => sortChats(sortList, { key, direction }, (c) => c.p).map((c) => c.id).join("");
assert.equal(sorted("updatedAt", "desc"), "acbd", "newest first, and no date stays last");
assert.equal(sorted("updatedAt", "asc"), "bcad", "oldest first, and no date stays last");
assert.equal(sorted("createdAt", "desc"), "bdac");
assert.equal(sorted("title", "asc"), "badc", "A to Z ignores case, and 2 comes before 10");
assert.equal(sorted("title", "desc"), "cdab");
assert.equal(sorted("project", "asc"), "cabd", "no project stays last, and ties go newest first");
assert.equal(sorted("project", "desc"), "acbd", "no project stays last going Z to A too");
assert.equal(sortList[0].id, "a", "the original list isn't changed");

const DAY = 24 * 60 * 60 * 1000;
const now = local(2026, 11, 5);
const ages = [{ id: "new", updatedAt: now - DAY }, { id: "edge", updatedAt: now - 182 * DAY }, { id: "old", updatedAt: now - 183 * DAY }, { id: "none", updatedAt: null }];
assert.equal(notUpdatedSince(ages, 182, now).map((c) => c.id).join(), "old", "exact edge and unknown dates are left out");
assert.deepEqual([...shortChatIds({ a: { text: "one two three" }, b: { text: "" }, c: { text: "w ".repeat(41) }, d: { text: "w ".repeat(40) } }, 40)], ["a", "d"], "empty and longer chats are left out");

assert.equal(ids({}), "abc");
assert.equal(ids({ keyword: "  " }), "abc");
assert.equal(ids({ keyword: "cabinet" }), "ac");
assert.equal(ids({ keyword: "cabinets new" }), "a", "any word order, any case");
assert.equal(ids({ keyword: "nothing" }), "");
assert.equal(ids({ from: "2026-03-11" }), "b", "from includes that day; unknown dates excluded");
assert.equal(ids({ to: "2026-03-11" }), "ab", "to includes the whole last day");
assert.equal(ids({ from: "2026-03-11", to: "2026-03-11" }), "b");
assert.equal(ids({ from: "2026-03-12", to: "2026-03-01" }), "", "backwards range shows nothing");
assert.equal(ids({ dateField: "createdAt", to: "2026-01-31" }), "a");
assert.equal(ids({ dateField: "createdAt", from: "2026-03-11", to: "2026-03-11" }), "b", "start of day included");
assert.equal(ids({ keyword: "cabinet", from: "2026-03-01" }), "a", "filters combine");
assert.equal(hasActiveFilters({ keyword: " ", from: "", to: "" }), false);
assert.equal(hasActiveFilters({ keyword: "", from: "2026-01-01", to: "" }), true);
console.log("ok - filter logic");

// Build a preview from the real page, with the fake Chrome API from the earlier preview.
const fake = fs.readFileSync(`${S}/preview.html`, "utf8").match(/<script>\s*\/\/ Fake[\s\S]*?<\/script>/)[0];
const base = require("url").pathToFileURL(PROJECT + "/").href;
const page = fs.readFileSync(`${PROJECT}/dashboard.html`, "utf8")
  .replace('href="dashboard.css"', `href="${base}dashboard.css"`)
  .replace('<script src="api.js"></script>', `${fake}<script src="${base}api.js"></script>`)
  .replace('src="filters.js"', `src="${base}filters.js"`)
  .replace('src="dashboard.js"></script>', `src="${base}dashboard.js"></script>
    <script>
      document.getElementById("content-search-input").value = "cabinets";
      document.getElementById("filter-from").value = "2026-10-01";
      document.getElementById("load-button").click();
    </script>`);
fs.writeFileSync(`${S}/preview2.html`, page);
