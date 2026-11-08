// Tests the search inside chats, using made-up chats and an in-memory folder.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const PROJECT = path.resolve(__dirname, "..");

const sandbox = { setTimeout, JSON, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ["backup.js", "search.js"]) vm.runInContext(fs.readFileSync(`${PROJECT}/${file}`, "utf8"), sandbox);
const Search = sandbox.OrganizerSearch;
const Backup = sandbox.OrganizerBackup;
const plain = (value) => JSON.parse(JSON.stringify(value));

async function run(name, test) {
  await test();
  console.log("ok -", name);
}

function fakeFolder() {
  const files = new Map();
  const folders = new Map();
  const reads = [];
  return {
    files, folders, reads,
    async getDirectoryHandle(name, { create } = {}) {
      if (!folders.has(name)) {
        if (!create) throw Object.assign(new Error("none"), { name: "NotFoundError" });
        folders.set(name, fakeFolder());
      }
      return folders.get(name);
    },
    async getFileHandle(name, { create } = {}) {
      if (!files.has(name) && !create) throw Object.assign(new Error("none"), { name: "NotFoundError" });
      return {
        getFile: async () => ({ text: async () => { reads.push(name); return files.get(name); } }),
        createWritable: async () => ({ write: async (text) => files.set(name, text), close: async () => {}, abort: async () => {} }),
      };
    },
    async removeEntry(name) { files.delete(name); },
  };
}

const message = (role, text, extra = {}) => ({ id: text, author: { role }, content: { content_type: "text", parts: [text] }, ...extra });

(async () => {
  await run("only text a person would see gets indexed", async () => {
    assert.equal(Search.messageText(message("user", "hello")), "hello");
    assert.equal(Search.messageText(message("system", "secret prompt")), "");
    assert.equal(Search.messageText(message("tool", "tool output")), "");
    assert.equal(Search.messageText({ author: { role: "assistant" }, content: { content_type: "thoughts", thoughts: [{ content: "hmm" }] } }), "");
    assert.equal(Search.messageText({ author: { role: "assistant" }, content: { content_type: "reasoning_recap", content: "x" } }), "");
    assert.equal(Search.messageText({ author: { role: "user" }, content: { content_type: "multimodal_text", parts: [{ asset_pointer: "file" }, "see this"] } }), "see this");
    assert.equal(Search.messageText({ author: { role: "assistant" }, content: { content_type: "code", text: "print(1)" } }), "print(1)");
    assert.equal(Search.messageText(message("assistant", "hidden", { metadata: { is_visually_hidden_from_conversation: true } })), "");
    assert.equal(Search.messageText(null), "");
    assert.equal(Search.messageText({ author: { role: "user" } }), "");
  });

  await run("the reading view says who said what", async () => {
    const saved = { chat: { messages: [message("user", "Hi"), message("system", "no"), message("assistant", "Hello")] } };
    assert.equal(Search.formatForReading(saved), "You:\nHi\n\nChatGPT:\nHello");
  });

  const chats = {
    a: { title: "Brakes", text: "My car makes a grinding noise. Is the car safe? The cars nearby were fine." },
    b: { title: "Recipes", text: "A scar on the cutting board, and carpet stains." },
    c: { title: "Car insurance", text: "How do quotes work?" },
    d: { title: "Mixed", text: "The car needed new brake pads, said the mechanic." },
    e: { title: "Costs", text: "It cost $5.00 (roughly) for C++ and a/b." },
    f: { title: "", text: "" },
  };

  await run("whole words match, including simple plurals, but not parts of other words", async () => {
    const ids = plain(Search.search(chats, "car")).map((r) => r.id);
    assert.deepEqual([...ids].sort(), ["a", "c", "d"]);
    assert.deepEqual(plain(Search.search(chats, "cars")).map((r) => r.id).sort(), ["a", "c", "d"]);
    assert.deepEqual(plain(Search.search(chats, "CAR")).map((r) => r.id).sort(), ["a", "c", "d"]);
    assert.deepEqual(plain(Search.search(chats, "carpet")).map((r) => r.id), ["b"]);
  });

  await run("every word must appear, and quotes match exactly", async () => {
    assert.deepEqual(plain(Search.search(chats, "car mechanic")).map((r) => r.id), ["d"]);
    assert.deepEqual(plain(Search.search(chats, "car dragon")), []);
    assert.deepEqual(plain(Search.search(chats, '"brake pads"')).map((r) => r.id), ["d"]);
    assert.deepEqual(plain(Search.search(chats, '"pads brake"')), []);
    assert.deepEqual(plain(Search.search(chats, '"car"')).map((r) => r.id).sort(), ["a", "c", "d"]);
    assert.deepEqual(plain(Search.search(chats, '"cars"')).map((r) => r.id), ["a"]);
  });

  await run("special characters are treated as plain text", async () => {
    assert.deepEqual(plain(Search.search(chats, "$5.00")).map((r) => r.id), ["e"]);
    assert.deepEqual(plain(Search.search(chats, "(roughly)")).map((r) => r.id), ["e"]);
    assert.deepEqual(plain(Search.search(chats, "roughly")).map((r) => r.id), ["e"]);
    assert.deepEqual(plain(Search.search(chats, "C++")).map((r) => r.id), ["e"]);
    assert.deepEqual(plain(Search.search({ h: { title: "", text: "A check-engine light" } }, "check-engine")).map((r) => r.id), ["h"]);
    assert.deepEqual(plain(Search.search(chats, ".*")), []);
    assert.deepEqual(plain(Search.search(chats, "[a-z]+")), []);
    assert.deepEqual(plain(Search.search(chats, "   ")), []);
    assert.deepEqual(plain(Search.search(chats, '""')), []);
  });

  await run("more matches rank higher, a title match counts, and snippets show the match", async () => {
    const results = plain(Search.search(chats, "car"));
    assert.equal(results[0].id, "c", "a title match ranks highest");
    const a = results.find((r) => r.id === "a");
    assert.equal(a.snippet.match, "car");
    assert.ok(a.snippet.before.endsWith("My "));
    assert.ok(a.snippet.after.startsWith(" makes a grinding"));
    const c = results.find((r) => r.id === "c");
    assert.equal(c.snippet.match, "", "the match was only in the title");
    assert.ok(c.snippet.before.startsWith("How do quotes"));
  });

  await run("a renamed chat is searched by its current name", async () => {
    const results = plain(Search.search(chats, "quotes", (id, chat) => chat.title));
    assert.equal(results[0].title, "Car insurance");
    const renamed = plain(Search.search(chats, "motorbike", (id, chat) => (id === "b" ? "Motorbike" : chat.title)));
    assert.deepEqual(renamed.map((r) => r.id), ["b"]);
  });

  await run("long chats get a short snippet, with marks showing cut text", async () => {
    const long = { x: { title: "L", text: `${"word ".repeat(500)}needle ${"word ".repeat(500)}` } };
    const { snippet } = plain(Search.search(long, "needle"))[0];
    assert.equal(snippet.match, "needle");
    assert.ok(snippet.before.startsWith("…") && snippet.after.endsWith("…"));
    assert.ok(snippet.before.length + snippet.after.length < 250);
  });

  await run("the index only reads new or re-saved files, and covers every folder", async () => {
    const folder = fakeFolder();
    const index = { chats: {} };
    const active = { id: "c1", title: "Active one", updatedAt: 1 };
    const archived = { id: "c2", title: "Archived one", updatedAt: 1, isArchived: true };
    const gone = { id: "c3", title: "Deleted one", updatedAt: 1 };
    await Backup.saveChat(folder, index, active, { title: "Active one", messages: [message("user", "alpha")] });
    await Backup.saveChat(folder, index, archived, { title: "Archived one", messages: [message("user", "beta")] });
    await Backup.saveChat(folder, index, gone, { title: "Deleted one", messages: [message("user", "gamma")] });
    await Backup.moveChatFile(folder, index, "c3", "Deleted");

    const first = await Search.updateIndex(folder, index);
    assert.deepEqual(Object.keys(first.searchIndex.chats).sort(), ["c1", "c2", "c3"]);
    assert.equal(first.searchIndex.chats.c3.text, "gamma");
    assert.equal(first.searchIndex.chats.c3.title, "Deleted one");

    // With no title saved inside the file, the file name stands in.
    const untitled = { id: "c4", title: "Named by file", updatedAt: 1 };
    await Backup.saveChat(folder, index, untitled, { messages: [message("user", "epsilon")] });
    assert.equal((await Search.updateIndex(folder, index)).searchIndex.chats.c4.title, "Named by file");
    delete index.chats.c4;
    await Search.updateIndex(folder, index);
    assert.ok(folder.files.has("search-index.json"));

    folder.folders.get("chats").reads.length = 0;
    const before = folder.files.get("search-index.json");
    await Search.updateIndex(folder, index);
    assert.equal(folder.folders.get("chats").reads.length, 0, "unchanged files aren't read again");
    assert.equal(folder.files.get("search-index.json"), before);

    // Moving a file doesn't need a new read, and a re-saved chat does get one.
    await Backup.moveChatFile(folder, index, "c1", "Archived");
    folder.folders.get("Archived").reads.length = 0;
    await Search.updateIndex(folder, index);
    assert.equal(folder.folders.get("Archived").reads.length, 0);

    await new Promise((resolve) => setTimeout(resolve, 2));
    await Backup.saveChat(folder, index, { ...active, updatedAt: 2 }, { title: "Active one", messages: [message("user", "alpha delta")] });
    const third = await Search.updateIndex(folder, index);
    assert.equal(third.searchIndex.chats.c1.text, "alpha delta");

    delete index.chats.c2;
    const fourth = await Search.updateIndex(folder, index);
    assert.equal(fourth.searchIndex.chats.c2, undefined);
  });

  await run("an unreadable file or damaged index doesn't stop the search", async () => {
    const folder = fakeFolder();
    const index = { chats: {} };
    const file = await Backup.saveChat(folder, index, { id: "c1", title: "T", updatedAt: 1 }, { messages: [message("user", "fine")] });
    await Backup.saveChat(folder, index, { id: "c2", title: "U", updatedAt: 1 }, { messages: [message("user", "hello")] });
    folder.files.set("search-index.json", "{ damaged");
    folder.folders.get("chats").files.set(file, "{ also damaged");
    const { searchIndex, unreadable } = await Search.updateIndex(folder, index);
    assert.deepEqual(plain(unreadable), ["c1"]);
    assert.equal(searchIndex.chats.c2.text, "hello");
    assert.ok(JSON.parse(folder.files.get("search-index.json")).chats.c2);
  });

  const meaning = { TextEncoder, TextDecoder, Float32Array, Uint8Array, DataView, ArrayBuffer };
  meaning.globalThis = meaning;
  vm.createContext(meaning);
  vm.runInContext(fs.readFileSync(`${PROJECT}/meaning-logic.js`, "utf8"), meaning);
  const M = meaning.OrganizerMeaning;
  const vector = (...values) => { const v = new Float32Array(M.VECTOR_SIZE); values.forEach((x, i) => { v[i] = x; }); return v; };

  await run("long chats split into sections, up to a limit", async () => {
    assert.deepEqual(plain(M.splitIntoSections("")), []);
    assert.deepEqual(plain(M.splitIntoSections("  one   two ")), ["one two"]);
    const parts = plain(M.splitIntoSections("word ".repeat(400)));
    assert.equal(parts.length, 3);
    assert.equal(parts[0].split(" ").length, 180);
    assert.equal(parts[2].split(" ").length, 40);
    assert.equal(M.splitIntoSections("word ".repeat(100000)).length, M.MAX_SECTIONS_PER_CHAT);
  });

  await run("only new or re-saved chats get prepared, and gone chats are forgotten", async () => {
    const related = { chats: { same: { backedUpAt: "a", count: 1, vectors: vector(1) }, old: { backedUpAt: "a", count: 1, vectors: vector(1) }, gone: { backedUpAt: "a", count: 1, vectors: vector(1) } } };
    const plan = M.planPreparation({
      same: { title: "S", text: "x", backedUpAt: "a" }, old: { title: "O", text: "new words", backedUpAt: "b" },
      fresh: { title: "F", text: "y", backedUpAt: "c" }, empty: { title: "E", text: "", backedUpAt: "d" },
    }, related);
    assert.deepEqual(plain(plan.work).map((c) => c.id), ["fresh", "old"]);
    assert.equal(plan.prepared, 1);
    assert.equal(plan.withText, 3);
    assert.equal(plan.sectionCount, 2);
    assert.equal(related.chats.gone, undefined);
  });

  await run("each chat ranks by its closest section, leaving out exact and clearly unrelated chats", async () => {
    const twoSections = new Float32Array(M.VECTOR_SIZE * 2);
    twoSections[0] = 0.2; twoSections[M.VECTOR_SIZE] = 0.9;
    const chats = {
      a: { count: 2, vectors: twoSections }, b: { count: 1, vectors: vector(0.5) },
      c: { count: 1, vectors: vector(0.05) }, d: { count: 1, vectors: vector(0.95) }, e: { count: 0, vectors: vector() },
    };
    const ranked = plain(M.rankChats(chats, vector(1), { exclude: new Set(["d"]) }));
    assert.deepEqual(ranked.map((r) => [r.id, r.section]), [["a", 1], ["b", 0]]);
    assert.equal(M.rankChats(chats, vector(1), { limit: 1 }).length, 1);
  });

  await run("the saved file round-trips, and a damaged one is safely ignored", async () => {
    const two = new Float32Array(M.VECTOR_SIZE * 2);
    two[0] = 0.25; two[M.VECTOR_SIZE + 383] = 0.75;
    const bytes = M.encodeIndex({ a: { backedUpAt: "t1", count: 2, vectors: two }, "é": { backedUpAt: "t2", count: 1, vectors: vector(0.5) } });
    const buffer = bytes.buffer;
    const decoded = M.decodeIndex(buffer);
    assert.deepEqual(Array.from(Object.keys(decoded.chats)), ["a", "é"]);
    assert.equal(decoded.chats.a.vectors[0], 0.25);
    assert.equal(decoded.chats.a.vectors[M.VECTOR_SIZE + 383], 0.75);
    assert.equal(decoded.chats["é"].count, 1);
    assert.equal(decoded.chats["é"].backedUpAt, "t2");
    assert.deepEqual(plain(M.decodeIndex(buffer.slice(0, buffer.byteLength - 4))), { chats: {} });
    assert.deepEqual(plain(M.decodeIndex(new ArrayBuffer(2))), { chats: {} });
    assert.deepEqual(plain(M.decodeIndex(new ArrayBuffer(0))), { chats: {} });
    assert.deepEqual(plain(M.decodeIndex(new Uint8Array([9, 0, 0, 0, 1, 2]).buffer)), { chats: {} });
  });

  await run("the security policy blocks every outside address", async () => {
    const manifest = JSON.parse(fs.readFileSync(`${PROJECT}/manifest.json`, "utf8"));
    const policy = manifest.content_security_policy.extension_pages;
    assert.equal(policy, "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self'");
    assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*"]);
    assert.deepEqual(manifest.permissions, ["storage"]);
    assert.ok(fs.readFileSync(`${PROJECT}/meaning-worker.js`, "utf8").includes("env.allowRemoteModels = false"));
    for (const file of ["meaning-worker.js", "meaning-logic.js", "related.js"]) {
      const source = fs.readFileSync(`${PROJECT}/${file}`, "utf8");
      assert.ok(!/fetch\(|importScripts|XMLHttpRequest|sendBeacon|WebSocket|https?:\/\//.test(source), file);
    }
  });

  await run("search.js never uses the network", async () => {
    const source = fs.readFileSync(`${PROJECT}/search.js`, "utf8");
    for (const banned of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "http://", "https://"]) {
      assert.ok(!source.includes(banned), banned);
    }
  });
})().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
