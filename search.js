// Searches the words inside your backed-up chats. It only reads files in your
// backup folder and never uses the network. search-index.json holds a searchable
// copy of each chat's text, and can be deleted at any time because it gets rebuilt.
(function (root) {
  "use strict";

  const SEARCH_INDEX_FILE = "search-index.json";
  const HIDDEN_CONTENT_TYPES = new Set(["thoughts", "reasoning_recap", "model_editable_context"]);
  const HIDDEN_ROLES = new Set(["system", "tool"]);
  const MAX_SEARCH_TERMS = 20;
  const SNIPPET_CHARACTERS = 90;
  const YIELD_EVERY_FILES = 10;

  // Returns the words a person would see in one message, skipping ChatGPT's
  // behind-the-scenes messages. Images and files have no text here, so they add nothing.
  function messageText(message) {
    const role = message?.author?.role;
    if (HIDDEN_ROLES.has(role)) return "";
    if (message?.metadata?.is_visually_hidden_from_conversation) return "";
    const content = message?.content;
    if (!content || HIDDEN_CONTENT_TYPES.has(content.content_type)) return "";
    const pieces = [];
    if (Array.isArray(content.parts)) {
      for (const part of content.parts) {
        if (typeof part === "string") pieces.push(part);
        else if (typeof part?.text === "string") pieces.push(part.text);
      }
    }
    if (typeof content.text === "string") pieces.push(content.text);
    return pieces.join("\n").trim();
  }

  function chatText(saved) {
    return (saved?.chat?.messages || []).map(messageText).filter(Boolean).join("\n\n");
  }

  // The whole chat as readable text, with who said what.
  function formatForReading(saved) {
    const blocks = [];
    for (const message of saved?.chat?.messages || []) {
      const text = messageText(message);
      if (!text) continue;
      const speaker = message?.author?.role === "user" ? "You" : "ChatGPT";
      blocks.push(`${speaker}:\n${text}`);
    }
    return blocks.join("\n\n");
  }

  async function loadIndex(folder) {
    try {
      const handle = await folder.getFileHandle(SEARCH_INDEX_FILE);
      const index = JSON.parse(await (await handle.getFile()).text());
      if (index && typeof index.chats === "object" && index.chats !== null) return index;
    } catch {
      // Missing or damaged. It's safe to rebuild from the backups.
    }
    return { version: 1, chats: {} };
  }

  // Brings the search index up to date with the backup index. Only new or
  // re-saved files get read, so later searches start much faster.
  async function updateIndex(folder, backupIndex, onProgress = () => {}) {
    const searchIndex = await loadIndex(folder);
    let changed = false;
    for (const id of Object.keys(searchIndex.chats)) {
      if (!backupIndex.chats[id]) {
        delete searchIndex.chats[id];
        changed = true;
      }
    }
    const toRead = Object.keys(backupIndex.chats).filter(
      (id) => searchIndex.chats[id]?.backedUpAt !== backupIndex.chats[id].backedUpAt
    );
    const unreadable = [];
    for (const [position, id] of toRead.entries()) {
      if (position % YIELD_EVERY_FILES === 0) {
        onProgress(position, toRead.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      try {
        const saved = await root.OrganizerBackup.readSavedChat(folder, backupIndex.chats[id]);
        searchIndex.chats[id] = {
          backedUpAt: backupIndex.chats[id].backedUpAt,
          title: saved?.chat?.title || backupIndex.chats[id].file.replace(/ - [^ ]+\.json$/, ""),
          text: chatText(saved),
        };
        changed = true;
      } catch {
        unreadable.push(id);
      }
    }
    if (changed) await root.OrganizerBackup.writeJson(folder, SEARCH_INDEX_FILE, searchIndex);
    return { searchIndex, unreadable };
  }

  function escapeForPattern(text) {
    return text.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
  }

  // Words find close forms ("car" also finds "cars"). "Words in quotes" must match exactly.
  function parseQuery(query) {
    const terms = [];
    for (const match of String(query).matchAll(/"([^"]+)"|(\S+)/g)) {
      const isExact = match[1] !== undefined;
      const text = (match[1] ?? match[2]).replace(/"/g, "").trim();
      if (!text) continue;
      const pieces = text.split(/\s+/).map(escapeForPattern).join("\\s+");
      let body = pieces;
      if (!isExact) {
        const stem = text.length > 3 && /[^s]s$/i.test(text) ? pieces.slice(0, -1) : pieces;
        body = `${stem}(?:s|es)?`;
      }
      terms.push(new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu"));
      if (terms.length === MAX_SEARCH_TERMS) break;
    }
    return terms;
  }

  // Splits text around the first match, so the page can highlight it without using HTML.
  function makeSnippet(text, pattern) {
    pattern.lastIndex = 0;
    const found = pattern.exec(text);
    if (!found) {
      const start = text.slice(0, SNIPPET_CHARACTERS * 2).replace(/\s+/g, " ");
      return { before: start + (text.length > SNIPPET_CHARACTERS * 2 ? "…" : ""), match: "", after: "" };
    }
    const beginning = Math.max(found.index - SNIPPET_CHARACTERS, 0);
    const ending = found.index + found[0].length;
    return {
      before: (beginning > 0 ? "…" : "") + text.slice(beginning, found.index).replace(/\s+/g, " "),
      match: found[0],
      after: text.slice(ending, ending + SNIPPET_CHARACTERS).replace(/\s+/g, " ") + (ending + SNIPPET_CHARACTERS < text.length ? "…" : ""),
    };
  }

  function countMatches(text, pattern) {
    pattern.lastIndex = 0;
    let count = 0;
    while (pattern.exec(text)) count += 1;
    return count;
  }

  // Finds chats containing every term. Chats with the most matches come first.
  function search(chats, query, titleOf = (id, chat) => chat.title) {
    const terms = parseQuery(query);
    if (terms.length === 0) return [];
    const results = [];
    for (const [id, chat] of Object.entries(chats)) {
      const title = titleOf(id, chat) || "";
      const counts = terms.map((pattern) => countMatches(chat.text, pattern));
      const titleCounts = terms.map((pattern) => countMatches(title, pattern));
      if (counts.some((count, position) => count + titleCounts[position] === 0)) continue;
      const firstInText = terms.find((_, position) => counts[position] > 0);
      results.push({
        id,
        title,
        score: counts.reduce((sum, count) => sum + count, 0) + titleCounts.reduce((sum, count) => sum + count, 0) * 5,
        snippet: makeSnippet(chat.text, firstInText || terms[0]),
      });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  root.OrganizerSearch = { messageText, chatText, formatForReading, updateIndex, search };
})(globalThis);
