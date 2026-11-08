// Keeps each ChatGPT account's backups in its own subfolder of your backup folder,
// so accounts never mix. Everything here stays on this computer.
(function (root) {
  "use strict";

  const LABEL_FILE = "sift-account.json";
  const CONTENT_FOLDERS = ["chats", "Archived", "Deleted"];
  const INDEX_FILES = ["search-index.json", "related-index.bin", "backup-index.json"];
  const RESERVED_NAMES = new Set(["chats", "archived", "deleted"]);
  const MAX_NAME_LENGTH = 60;

  // An account's name if it has one, otherwise the part of its email before the @.
  function displayName({ name, email } = {}) {
    const beforeAt = (text) => String(text).split("@")[0].trim();
    if (typeof name === "string" && name.trim()) return beforeAt(name.trim()) || "ChatGPT account";
    if (typeof email === "string" && email.trim()) return beforeAt(email) || "ChatGPT account";
    return "ChatGPT account";
  }

  function folderName(name) {
    const cleaned = Array.from(String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, " "))
      .slice(0, MAX_NAME_LENGTH)
      .join("")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "");
    return cleaned || "ChatGPT account";
  }

  // One login can belong to several workspaces, and each keeps separate chats.
  function accountKey({ id, workspaceId } = {}) {
    if (typeof id !== "string" || !id) return null;
    return workspaceId ? `${id}:${workspaceId}` : id;
  }

  async function readLabel(folder) {
    try {
      const handle = await folder.getFileHandle(LABEL_FILE);
      return JSON.parse(await (await handle.getFile()).text());
    } catch {
      return null;
    }
  }

  // Finds this account's subfolder by its label, so a renamed account keeps its folder.
  // A new account gets a new subfolder, and never one that belongs to someone else.
  async function resolveFolder(main, account) {
    const subfolders = new Set();
    for await (const [name, handle] of main.entries()) {
      if (handle.kind !== "directory") continue;
      subfolders.add(name.toLocaleLowerCase());
      if ((await readLabel(handle))?.accountKey === account.key) return handle;
    }
    const base = folderName(account.name);
    for (let attempt = 1; attempt < 1000; attempt += 1) {
      const name = attempt === 1 ? base : `${base} (${attempt})`;
      const lower = name.toLocaleLowerCase();
      if (RESERVED_NAMES.has(lower) || subfolders.has(lower)) continue;
      const folder = await main.getDirectoryHandle(name, { create: true });
      await root.OrganizerBackup.writeJson(folder, LABEL_FILE, { accountKey: account.key, name: account.name });
      return folder;
    }
    throw new Error("Couldn't make a folder for this account.");
  }

  async function hasFile(folder, name) {
    try {
      await folder.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  // Looks for backups from before accounts had subfolders. They only count as this
  // account's if some of them match its chats and it has no backups of its own yet.
  async function findOldBackups(main, accountFolder, chatIds) {
    if (await hasFile(accountFolder, "backup-index.json")) return null;
    if (!(await hasFile(main, "backup-index.json"))) return null;
    const index = await root.OrganizerBackup.readIndex(main);
    const saved = Object.keys(index.chats);
    const matching = saved.filter((id) => chatIds.has(id)).length;
    return matching > 0 ? { total: saved.length, matching } : null;
  }

  async function copyFile(fromFolder, toFolder, name) {
    const from = await (await (await fromFolder.getFileHandle(name)).getFile()).arrayBuffer();
    const handle = await toFolder.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(from);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    const copy = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    const original = new Uint8Array(from);
    if (copy.length !== original.length || copy.some((byte, position) => byte !== original[position])) {
      throw new Error("A copied file didn't match its original.");
    }
  }

  // Copies and checks everything first. Originals are only removed once every copy is
  // good, with the old backup index removed last, so a stopped move can simply run again.
  async function moveOldBackups(main, accountFolder, onProgress = () => {}) {
    const files = [];
    for (const name of CONTENT_FOLDERS) {
      let folder;
      try {
        folder = await main.getDirectoryHandle(name);
      } catch {
        continue;
      }
      const target = await accountFolder.getDirectoryHandle(name, { create: true });
      for await (const [fileName, handle] of folder.entries()) {
        if (handle.kind === "file") files.push({ from: folder, to: target, name: fileName });
      }
    }
    for (const name of INDEX_FILES) {
      if (await hasFile(main, name)) files.push({ from: main, to: accountFolder, name });
    }

    for (const [position, file] of files.entries()) {
      onProgress(position, files.length);
      await copyFile(file.from, file.to, file.name);
    }
    for (const file of files) await file.from.removeEntry(file.name);
    for (const name of CONTENT_FOLDERS) await main.removeEntry(name).catch(() => {});
    return files.length;
  }

  root.OrganizerAccounts = { displayName, folderName, accountKey, resolveFolder, findOldBackups, moveOldBackups };
})(globalThis);
