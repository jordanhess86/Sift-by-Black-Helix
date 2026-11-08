// Saves chat backups into a folder you choose on this computer. Nothing here
// uses the network. Each chat becomes one file, and backup-index.json remembers
// what's saved, so later runs skip unchanged chats. Files live in one of three
// folders: "chats" (active), "Archived" or "Deleted". A chat's file moves to
// "Archived" or "Deleted" when you archive or delete it using this extension.
(function (root) {
  "use strict";

  const INDEX_FILE = "backup-index.json";
  const CHATS_FOLDER = "chats";
  const ARCHIVED_FOLDER = "Archived";
  const DELETED_FOLDER = "Deleted";
  const DB_NAME = "chatgpt-organizer";
  const DB_STORE = "handles";
  const FOLDER_KEY = "backupFolder";
  const MAX_TITLE_LENGTH = 60;

  // Chrome can remember your chosen folder, but only inside this small database.
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Each account remembers its own main folder. A new account starts with the
  // main folder chosen most recently.
  async function getSavedFolder(accountKey) {
    const database = await openDatabase();
    const read = (key) => new Promise((resolve, reject) => {
      const request = database.transaction(DB_STORE).objectStore(DB_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    return (accountKey && (await read(`${FOLDER_KEY}:${accountKey}`))) || read(FOLDER_KEY);
  }

  async function saveFolder(folder, accountKey) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DB_STORE, "readwrite");
      transaction.objectStore(DB_STORE).put(folder, FOLDER_KEY);
      if (accountKey) transaction.objectStore(DB_STORE).put(folder, `${FOLDER_KEY}:${accountKey}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Chrome asks you to re-approve folder access after it restarts.
  async function ensurePermission(folder) {
    const options = { mode: "readwrite" };
    if ((await folder.queryPermission(options)) === "granted") return true;
    return (await folder.requestPermission(options)) === "granted";
  }

  async function readIndex(folder) {
    let text;
    try {
      const handle = await folder.getFileHandle(INDEX_FILE);
      text = await (await handle.getFile()).text();
    } catch (error) {
      if (error.name === "NotFoundError") return { version: 1, chats: {} };
      throw error;
    }
    const index = JSON.parse(text);
    if (!index || typeof index.chats !== "object" || index.chats === null) {
      throw new Error("The backup index isn't in the expected format.");
    }
    return index;
  }

  // Chrome only replaces the old file once the new one has fully finished, so
  // a failed save can't damage an existing backup.
  async function writeText(folder, name, text) {
    const handle = await folder.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
  }

  function writeJson(folder, name, value) {
    return writeText(folder, name, JSON.stringify(value, null, 2));
  }

  // Older index entries have no location, because those files are all in "chats".
  function locationOf(entry) {
    return entry.location || CHATS_FOLDER;
  }

  function expectedLocation(chat) {
    return chat.isArchived ? ARCHIVED_FOLDER : CHATS_FOLDER;
  }

  function backupPath(index, chatId) {
    const entry = index.chats[chatId];
    return `${locationOf(entry)}/${entry.file}`;
  }

  // Only used once the new copy is safely saved. A leftover old copy does no harm.
  async function removeOldCopy(folder, location, file) {
    try {
      const oldFolder = await folder.getDirectoryHandle(location);
      await oldFolder.removeEntry(file);
    } catch {
      // Nothing more to do.
    }
  }

  function safeFileName(title, id) {
    const cleaned = Array.from(String(title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, " "))
      .slice(0, MAX_TITLE_LENGTH)
      .join("")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "");
    return `${cleaned || "Untitled"} - ${id}.json`;
  }

  // "current" means the saved copy matches the chat list, "older" means the chat has
  // changed since (or its date is unknown), and "none" means it has no saved copy.
  function backupStatus(chat, index) {
    const saved = index.chats[chat.id];
    if (!saved) return "none";
    return chat.updatedAt !== null && chat.updatedAt !== undefined && saved.updatedAt === chat.updatedAt ? "current" : "older";
  }

  // Works out what needs saving, newest first, up to the limit for one run, and
  // which saved files only need moving back to their usual folder.
  function planBackup(chats, index, limit) {
    const needed = [];
    const moves = [];
    let upToDate = 0;
    for (const chat of chats) {
      const saved = index.chats[chat.id];
      if (!saved) needed.push({ chat, reason: "new" });
      else if (chat.updatedAt !== null && saved.updatedAt !== chat.updatedAt) needed.push({ chat, reason: "changed" });
      else if (locationOf(saved) !== expectedLocation(chat)) moves.push({ id: chat.id, title: chat.title, to: expectedLocation(chat) });
      else upToDate += 1;
    }
    return {
      items: needed.slice(0, limit),
      moves,
      newCount: needed.filter((item) => item.reason === "new").length,
      changedCount: needed.filter((item) => item.reason === "changed").length,
      upToDate,
      beyondLimit: Math.max(needed.length - limit, 0),
    };
  }

  // The index is saved after every chat, so a stopped run can pick up where it left off.
  async function saveChat(folder, index, chat, fullChat) {
    const previous = index.chats[chat.id];
    const location = expectedLocation(chat);
    const targetFolder = await folder.getDirectoryHandle(location, { create: true });
    const backedUpAt = new Date().toISOString();
    // An existing chat keeps its file name, so a renamed chat replaces its old copy.
    const file = previous?.file || safeFileName(chat.title, chat.id);
    await writeJson(targetFolder, file, {
      backupFormat: 1,
      backedUpAt,
      messageCount: fullChat.messages.length,
      chat: fullChat,
    });
    index.chats[chat.id] = { updatedAt: chat.updatedAt, file, backedUpAt, location };
    await writeJson(folder, INDEX_FILE, index);
    if (previous && locationOf(previous) !== location) await removeOldCopy(folder, locationOf(previous), file);
    return file;
  }

  // Moves a saved file to another folder: copy it, check the copy, update the
  // index, and only then remove the original.
  async function moveChatFile(folder, index, chatId, location) {
    const entry = index.chats[chatId];
    if (!entry) throw new Error("This chat isn't in the backup index.");
    const from = locationOf(entry);
    if (from === location) return;

    const sourceFolder = await folder.getDirectoryHandle(from);
    const text = await (await (await sourceFolder.getFileHandle(entry.file)).getFile()).text();
    const targetFolder = await folder.getDirectoryHandle(location, { create: true });
    await writeText(targetFolder, entry.file, text);
    const copy = await (await (await targetFolder.getFileHandle(entry.file)).getFile()).text();
    if (copy !== text) throw new Error("The moved copy didn't match the original.");

    index.chats[chatId] = { ...entry, location };
    try {
      await writeJson(folder, INDEX_FILE, index);
    } catch (error) {
      index.chats[chatId] = entry;
      throw error;
    }
    await removeOldCopy(folder, from, entry.file);
  }

  async function readSavedChat(folder, entry) {
    const savedFolder = await folder.getDirectoryHandle(locationOf(entry));
    const handle = await savedFolder.getFileHandle(entry.file);
    return JSON.parse(await (await handle.getFile()).text());
  }

  // Reads a saved backup back from disk and checks that it holds every message.
  // Deleting relies on this, so any doubt counts as a failure.
  async function verifySavedChat(folder, index, chatId, fullChat) {
    const fail = () => {
      const error = new Error("The saved backup didn't match the chat when it was checked.");
      error.name = "BackupVerificationError";
      return error;
    };
    let saved;
    try {
      saved = await readSavedChat(folder, index.chats[chatId]);
    } catch {
      throw fail();
    }
    const savedIds = (saved?.chat?.messages || []).map((message) => message.id);
    const expectedIds = fullChat.messages.map((message) => message.id);
    if (
      saved?.messageCount !== expectedIds.length ||
      savedIds.length !== expectedIds.length ||
      savedIds.some((id, position) => id !== expectedIds[position])
    ) {
      throw fail();
    }
  }

  root.OrganizerBackup = {
    getSavedFolder,
    saveFolder,
    ensurePermission,
    readIndex,
    safeFileName,
    planBackup,
    backupStatus,
    saveChat,
    moveChatFile,
    readSavedChat,
    locationOf,
    writeJson,
    backupPath,
    verifySavedChat,
    CHATS_FOLDER,
    ARCHIVED_FOLDER,
    DELETED_FOLDER,
  };
})(globalThis);
