// Finds chats by topic, using related-index.bin in your backup folder. It can be
// deleted at any time and prepared again. Nothing here uses the network.
(function (root) {
  "use strict";

  const RELATED_INDEX_FILE = "related-index.bin";
  const SECTIONS_PER_REQUEST = 4;
  const SAVE_EVERY_CHATS = 100;
  const Meaning = () => root.OrganizerMeaning;

  function createEngine() {
    const worker = new Worker("meaning-worker.js", { type: "module" });
    const waiting = new Map();
    let nextId = 1;
    const failAll = (message) => {
      for (const { reject } of waiting.values()) reject(new Error(message));
      waiting.clear();
    };
    worker.addEventListener("message", ({ data }) => {
      const request = waiting.get(data.id);
      if (!request) return;
      waiting.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.vectors);
    });
    worker.addEventListener("error", (event) => failAll(event.message || "The AI model couldn't start."));
    return {
      embed: (texts) => new Promise((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        worker.postMessage({ id, texts });
      }),
    };
  }

  async function load(folder) {
    try {
      const handle = await folder.getFileHandle(RELATED_INDEX_FILE);
      return Meaning().decodeIndex(await (await handle.getFile()).arrayBuffer());
    } catch {
      return { chats: {} };
    }
  }

  async function save(folder, related) {
    const handle = await folder.getFileHandle(RELATED_INDEX_FILE, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(Meaning().encodeIndex(related.chats));
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
  }

  // Prepares chats one at a time and saves along the way, so stopping keeps the progress.
  async function prepare(folder, related, work, engine, { onProgress = () => {}, shouldStop = () => false } = {}) {
    const size = Meaning().VECTOR_SIZE;
    let done = 0;
    let stopped = false;
    for (const chat of work) {
      onProgress(done, work.length);
      const vectors = new Float32Array(chat.sections.length * size);
      for (let start = 0; start < chat.sections.length && !stopped; start += SECTIONS_PER_REQUEST) {
        if (shouldStop()) {
          stopped = true;
          break;
        }
        const batch = chat.sections.slice(start, start + SECTIONS_PER_REQUEST).map((section) => `${chat.title}. ${section}`);
        vectors.set(await engine.embed(batch), start * size);
      }
      if (stopped || shouldStop()) {
        stopped = true;
        break;
      }
      related.chats[chat.id] = { backedUpAt: chat.backedUpAt, count: chat.sections.length, vectors };
      done += 1;
      if (done % SAVE_EVERY_CHATS === 0) await save(folder, related);
    }
    await save(folder, related);
    return { done, stopped };
  }

  async function search(engine, related, query, exclude) {
    const queryVector = await engine.embed([query]);
    return Meaning().rankChats(related.chats, queryVector, { exclude });
  }

  root.OrganizerRelated = { createEngine, load, save, prepare, search };
})(globalThis);
