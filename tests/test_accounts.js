// Tests per-account backup folders with made-up accounts and an in-memory folder.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const PROJECT = path.resolve(__dirname, "..");

const sandbox = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ["backup.js", "accounts.js"]) vm.runInContext(fs.readFileSync(`${PROJECT}/${file}`, "utf8"), sandbox);
const { OrganizerAccounts: A, OrganizerBackup: B } = sandbox;

function fakeFolder(name = "main") {
  const files = new Map();
  const folders = new Map();
  const folder = {
    name, files, folders, kind: "directory", failWrites: null,
    async getDirectoryHandle(child, { create } = {}) {
      if (!folders.has(child)) {
        if (!create) throw Object.assign(new Error("none"), { name: "NotFoundError" });
        const made = fakeFolder(child);
        made.parent = folder;
        folders.set(child, made);
      }
      return folders.get(child);
    },
    async getFileHandle(child, { create } = {}) {
      if (!files.has(child) && !create) throw Object.assign(new Error("none"), { name: "NotFoundError" });
      return {
        kind: "file",
        getFile: async () => {
          const value = files.get(child);
          const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
          return { text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
        },
        createWritable: async () => ({
          write: async (data) => { if (folder.root?.failWrites === child || folder.failWrites === child) throw new Error("disk full"); files.set(child, data); },
          close: async () => {}, abort: async () => {},
        }),
      };
    },
    async removeEntry(child) {
      if (files.has(child)) files.delete(child);
      else if (folders.has(child)) {
        if (folders.get(child).files.size) throw new Error("not empty");
        folders.delete(child);
      } else throw Object.assign(new Error("none"), { name: "NotFoundError" });
    },
    async *entries() {
      for (const [n, f] of folders) yield [n, f];
      for (const n of files.keys()) yield [n, { kind: "file" }];
    },
  };
  return folder;
}

async function run(name, test) {
  await test();
  console.log("ok -", name);
}

(async () => {
  await run("the folder uses the account's name, otherwise the part before the @", async () => {
    assert.equal(A.displayName({ name: "Jordan Hess", email: "jordan@example.com" }), "Jordan Hess");
    assert.equal(A.displayName({ name: "", email: "jordan.hess@example.com" }), "jordan.hess");
    assert.equal(A.displayName({ name: "   ", email: "x@y.z" }), "x");
    assert.equal(A.displayName({ name: "me@work.com", email: "other@y.z" }), "me");
    assert.equal(A.displayName({}), "ChatGPT account");
    assert.equal(A.folderName('a/b:c*"d'), "a b c d");
    assert.equal(A.folderName("../.."), "ChatGPT account");
    assert.equal(A.folderName(""), "ChatGPT account");
    assert.ok(A.folderName("x".repeat(500)).length <= 60);
  });

  await run("accounts need an ID, and workspaces are kept apart", async () => {
    assert.equal(A.accountKey({ id: "user-1", workspaceId: "" }), "user-1");
    assert.equal(A.accountKey({ id: "user-1", workspaceId: "w" }), "user-1:w");
    assert.equal(A.accountKey({ id: "" }), null);
    assert.equal(A.accountKey({}), null);
  });

  await run("each account gets its own folder, and keeps it after a rename", async () => {
    const main = fakeFolder();
    const one = await A.resolveFolder(main, { key: "u1", name: "Jordan" });
    assert.equal(one.name, "Jordan");
    assert.ok(one.files.has("sift-account.json"));
    assert.equal((await A.resolveFolder(main, { key: "u1", name: "Jordan" })).name, "Jordan");
    assert.equal(main.folders.size, 1);
    const two = await A.resolveFolder(main, { key: "u2", name: "Sam" });
    assert.equal(two.name, "Sam");
    assert.equal((await A.resolveFolder(main, { key: "u1", name: "New name" })).name, "Jordan", "a renamed account keeps its folder");
  });

  await run("two accounts with one name never share a folder", async () => {
    const main = fakeFolder();
    const one = await A.resolveFolder(main, { key: "u1", name: "Jordan" });
    const two = await A.resolveFolder(main, { key: "u2", name: "JORDAN" });
    assert.notEqual(one, two);
    assert.equal(two.name, "JORDAN (2)");
    assert.equal(A.folderName("chats"), "chats");
    const reserved = await A.resolveFolder(main, { key: "u3", name: "Archived" });
    assert.equal(reserved.name, "Archived (2)", "an account can't use a backup folder's name");
    await main.getDirectoryHandle("Holiday photos", { create: true });
    assert.equal((await A.resolveFolder(main, { key: "u4", name: "holiday photos" })).name, "holiday photos (2)", "someone's own folder is left alone");
  });

  const seedOld = async (main, ids) => {
    const index = { chats: {} };
    for (const id of ids) {
      const dir = await main.getDirectoryHandle(id === "z" ? "Archived" : "chats", { create: true });
      dir.files.set(`${id}.json`, `{"id":"${id}"}`);
      index.chats[id] = { file: `${id}.json`, updatedAt: 1 };
    }
    main.files.set("backup-index.json", JSON.stringify(index));
    main.files.set("search-index.json", '{"chats":{}}');
    main.files.set("related-index.bin", new Uint8Array([1, 2, 3]).buffer);
  };

  await run("old backups are only offered to an account they match", async () => {
    const main = fakeFolder();
    await seedOld(main, ["a", "b", "z"]);
    const mine = await A.resolveFolder(main, { key: "u1", name: "Me" });
    const other = await A.resolveFolder(main, { key: "u2", name: "Other" });
    const found = await A.findOldBackups(main, mine, new Set(["a", "b"]));
    assert.equal(found.total, 3);
    assert.equal(found.matching, 2);
    assert.equal(await A.findOldBackups(main, other, new Set(["q"])), null);
    mine.files.set("backup-index.json", "{}");
    assert.equal(await A.findOldBackups(main, mine, new Set(["a"])), null, "not once the account has its own backups");
    assert.equal(await A.findOldBackups(fakeFolder(), mine, new Set(["a"])), null);
  });

  await run("moving old backups copies everything, then removes the originals", async () => {
    const main = fakeFolder();
    await seedOld(main, ["a", "b", "z"]);
    const mine = await A.resolveFolder(main, { key: "u1", name: "Me" });
    const moved = await A.moveOldBackups(main, mine);
    assert.equal(moved, 6);
    assert.ok(mine.folders.get("chats").files.has("a.json"));
    assert.ok(mine.folders.get("Archived").files.has("z.json"));
    assert.deepEqual(Object.keys(JSON.parse(new TextDecoder().decode(new Uint8Array(mine.files.get("backup-index.json")))).chats).sort(), ["a", "b", "z"]);
    assert.equal(new Uint8Array(mine.files.get("related-index.bin"))[2], 3);
    assert.ok(!main.files.has("backup-index.json"));
    assert.ok(!main.files.has("related-index.bin"));
    assert.ok(!main.folders.has("chats"));
    assert.ok(!main.folders.has("Archived"));
    assert.ok(main.folders.has("Me"), "the account's own folder stays");
  });

  await run("a failed copy removes nothing, and the move can run again", async () => {
    const main = fakeFolder();
    await seedOld(main, ["a", "b"]);
    const mine = await A.resolveFolder(main, { key: "u1", name: "Me" });
    mine.failWrites = "backup-index.json";
    await assert.rejects(A.moveOldBackups(main, mine));
    assert.ok(main.files.has("backup-index.json"));
    assert.ok(main.folders.get("chats").files.has("a.json"));
    assert.ok(main.folders.get("chats").files.has("b.json"));
    assert.ok(await A.findOldBackups(main, mine, new Set(["a"])));
    mine.failWrites = null;
    await A.moveOldBackups(main, mine);
    assert.ok(!main.files.has("backup-index.json"));
    assert.ok(mine.files.has("backup-index.json"));
  });

  await run("content.js gives only the four account details, never the login token", async () => {
    let listener;
    const context = {
      location: { origin: "https://chatgpt.com" },
      chrome: { runtime: { id: "me", onMessage: { addListener: (fn) => { listener = fn; } } } },
      fetch: async () => ({
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ accessToken: "SECRET-TOKEN", sessionToken: "SECRET-2", expires: "x", user: { id: "user-1", name: "Jordan", email: "j@e.com", picture: "p", mfa: true }, account: { id: "acc", planType: "plus" } }),
      }),
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(`${PROJECT}/content.js`, "utf8"), context);
    const reply = await new Promise((resolve) => listener({ type: "organizer-account" }, { id: "me" }, resolve));
    assert.equal(reply.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(reply.data)), { id: "user-1", workspaceId: "acc", name: "Jordan", email: "j@e.com" });
    assert.ok(!JSON.stringify(reply).includes("SECRET"));
    assert.equal(await new Promise((resolve) => { const handled = listener({ type: "organizer-account" }, { id: "someone-else" }, resolve); if (!handled) resolve("ignored"); }), "ignored");
  });
})().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
