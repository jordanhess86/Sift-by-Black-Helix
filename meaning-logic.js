// The arithmetic and file format for related-word search. No network and no AI model here.
(function (root) {
  "use strict";

  const VECTOR_SIZE = 384;
  const WORDS_PER_SECTION = 180;
  const MAX_SECTIONS_PER_CHAT = 200;
  const FORMAT_VERSION = 1;

  // Long chats get split into sections, because the model only reads about 250 words at a time.
  function splitIntoSections(text) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const sections = [];
    for (let start = 0; start < words.length && sections.length < MAX_SECTIONS_PER_CHAT; start += WORDS_PER_SECTION) {
      sections.push(words.slice(start, start + WORDS_PER_SECTION).join(" "));
    }
    return sections;
  }

  // Forgets chats with no backup any more, and lists chats that are new or re-saved, newest first.
  function planPreparation(searchChats, related) {
    for (const id of Object.keys(related.chats)) {
      if (!searchChats[id]) delete related.chats[id];
    }
    const work = [];
    let prepared = 0;
    let withText = 0;
    for (const [id, chat] of Object.entries(searchChats)) {
      if (!chat.text) continue;
      withText += 1;
      if (related.chats[id]?.backedUpAt === chat.backedUpAt) prepared += 1;
      else work.push({ id, title: chat.title, text: chat.text, backedUpAt: chat.backedUpAt, sections: splitIntoSections(chat.text) });
    }
    work.sort((a, b) => String(b.backedUpAt).localeCompare(String(a.backedUpAt)));
    return { work, prepared, withText, sectionCount: work.reduce((sum, chat) => sum + chat.sections.length, 0) };
  }

  // Ranks chats by their closest section, so a long chat isn't favored just for being long.
  // Clearly unrelated chats are left out, but low scores can still be useful, so the bar is low.
  function rankChats(chats, queryVector, { exclude = new Set(), limit = 10, minimum = 0.1 } = {}) {
    const results = [];
    for (const [id, chat] of Object.entries(chats)) {
      if (exclude.has(id)) continue;
      let best = -Infinity;
      let bestSection = 0;
      for (let section = 0; section < chat.count; section += 1) {
        const offset = section * VECTOR_SIZE;
        let score = 0;
        for (let i = 0; i < VECTOR_SIZE; i += 1) score += chat.vectors[offset + i] * queryVector[i];
        if (score > best) {
          best = score;
          bestSection = section;
        }
      }
      if (chat.count > 0 && best >= minimum) results.push({ id, score: best, section: bestSection });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // One file holds a short description followed by the numbers, so it can't get out of step.
  function encodeIndex(chats) {
    const entries = Object.entries(chats);
    const header = new TextEncoder().encode(JSON.stringify({
      version: FORMAT_VERSION,
      vectorSize: VECTOR_SIZE,
      chats: entries.map(([id, chat]) => ({ id, backedUpAt: chat.backedUpAt, count: chat.count })),
    }));
    const total = entries.reduce((sum, [, chat]) => sum + chat.count, 0);
    const start = 4 + header.length;
    const bytes = new Uint8Array(start + total * VECTOR_SIZE * 4);
    new DataView(bytes.buffer).setUint32(0, header.length, true);
    bytes.set(header, 4);
    let position = start;
    for (const [, chat] of entries) {
      bytes.set(new Uint8Array(chat.vectors.buffer, chat.vectors.byteOffset, chat.count * VECTOR_SIZE * 4), position);
      position += chat.count * VECTOR_SIZE * 4;
    }
    return bytes;
  }

  // Anything unexpected gives an empty index, because it can simply be prepared again.
  function decodeIndex(buffer) {
    const empty = { chats: {} };
    try {
      const headerLength = new DataView(buffer).getUint32(0, true);
      const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
      if (header.version !== FORMAT_VERSION || header.vectorSize !== VECTOR_SIZE || !Array.isArray(header.chats)) return empty;
      const total = header.chats.reduce((sum, chat) => sum + chat.count, 0);
      let position = 4 + headerLength;
      if (buffer.byteLength !== position + total * VECTOR_SIZE * 4) return empty;
      const chats = {};
      for (const { id, backedUpAt, count } of header.chats) {
        const length = count * VECTOR_SIZE * 4;
        chats[id] = { backedUpAt, count, vectors: new Float32Array(buffer.slice(position, position + length)) };
        position += length;
      }
      return { chats };
    } catch {
      return empty;
    }
  }

  root.OrganizerMeaning = { VECTOR_SIZE, MAX_SECTIONS_PER_CHAT, splitIntoSections, planPreparation, rankChats, encodeIndex, decodeIndex };
})(globalThis);
