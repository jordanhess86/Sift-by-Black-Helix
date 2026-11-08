// The action log. It's saved inside Chrome on this computer and is never sent
// anywhere. Chrome erases it if the extension is uninstalled, so the organizer
// page has a button to export it to a file you can keep.
(function (root) {
  "use strict";

  const KEY_PREFIX = "log:";
  const CSV_COLUMNS = ["time", "action", "result", "title", "project", "chatId", "detail", "account"];
  let accountName = "";

  function setAccount(name) {
    accountName = name || "";
  }

  // Each entry gets its own key, so two open organizer tabs can't overwrite each other.
  async function addEntry(entry) {
    const time = new Date().toISOString();
    const key = `${KEY_PREFIX}${time}:${crypto.randomUUID()}`;
    await chrome.storage.local.set({ [key]: { time, account: accountName, ...entry } });
  }

  async function getEntries() {
    const everything = await chrome.storage.local.get(null);
    return Object.keys(everything)
      .filter((key) => key.startsWith(KEY_PREFIX))
      .sort()
      .map((key) => everything[key]);
  }

  function csvCell(value) {
    let text = value === undefined || value === null ? "" : String(value);
    // Stops a spreadsheet app from running a chat title as a formula.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function toCsv(entries) {
    const rows = entries.map((entry) => CSV_COLUMNS.map((column) => csvCell(entry[column])).join(","));
    return [CSV_COLUMNS.join(","), ...rows].join("\r\n");
  }

  root.OrganizerLog = { addEntry, getEntries, toCsv, setAccount };

  // Your choices for appearance, sorting and windows, kept on this computer.
  const SETTINGS_KEY = "settings";

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      return stored[SETTINGS_KEY] || {};
    } catch {
      return {};
    }
  }

  async function saveSettings(settings) {
    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    } catch {
      // The choice still applies until this page closes.
    }
  }

  root.OrganizerSettings = { loadSettings, saveSettings };
})(globalThis);
