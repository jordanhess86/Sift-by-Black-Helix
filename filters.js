// Works out which loaded chats match the search box and date range.
// This all happens on your computer, with no requests to ChatGPT.
(function (root) {
  "use strict";

  // Date boxes give "YYYY-MM-DD". These use your local time zone, and the
  // range includes the whole of both the first and the last day.
  function startOfDay(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).getTime();
  }

  function endOfDay(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day + 1).getTime() - 1;
  }

  function hasActiveFilters({ keyword, from, to }) {
    return Boolean(keyword.trim() || from || to);
  }

  // Every word typed must appear in the title, in any order.
  function filterChats(chats, { keyword, dateField, from, to }) {
    const words = keyword.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const earliest = from ? startOfDay(from) : null;
    const latest = to ? endOfDay(to) : null;

    return chats.filter((chat) => {
      const title = chat.title.toLocaleLowerCase();
      if (!words.every((word) => title.includes(word))) return false;
      if (earliest === null && latest === null) return true;

      const time = chat[dateField];
      if (time === null) return false;
      if (earliest !== null && time < earliest) return false;
      if (latest !== null && time > latest) return false;
      return true;
    });
  }

  const COMPARE_TEXT = { numeric: true, sensitivity: "base" };

  // Sorts a copy of the list. Chats with no project or no date stay last in both
  // directions, and chats that tie keep newest-updated first.
  function sortChats(chats, { key, direction }, projectNameOf = () => "") {
    const sign = direction === "desc" ? -1 : 1;
    const newestFirst = (a, b) => (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity);
    return [...chats].sort((a, b) => {
      let order = 0;
      if (key === "title") {
        order = sign * a.title.localeCompare(b.title, undefined, COMPARE_TEXT);
      } else if (key === "project") {
        const nameA = projectNameOf(a);
        const nameB = projectNameOf(b);
        if (!nameA !== !nameB) return nameA ? -1 : 1;
        order = sign * nameA.localeCompare(nameB, undefined, COMPARE_TEXT);
      } else {
        const timeA = a[key] ?? null;
        const timeB = b[key] ?? null;
        if ((timeA === null) !== (timeB === null)) return timeA === null ? 1 : -1;
        if (timeA !== null) order = sign * (timeA - timeB);
      }
      return order || newestFirst(a, b);
    });
  }

  // Chats last updated more than this many days ago. Unknown dates aren't included.
  function notUpdatedSince(chats, days, now = Date.now()) {
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    return chats.filter((chat) => chat.updatedAt !== null && chat.updatedAt !== undefined && chat.updatedAt < cutoff);
  }

  // IDs of backed-up chats with some text, but no more than this many words.
  function shortChatIds(searchChats, maxWords) {
    const ids = new Set();
    for (const [id, chat] of Object.entries(searchChats)) {
      const words = chat.text.split(/\s+/).filter(Boolean).length;
      if (words > 0 && words <= maxWords) ids.add(id);
    }
    return ids;
  }

  root.OrganizerFilters = { filterChats, hasActiveFilters, sortChats, notUpdatedSince, shortChatIds };
})(globalThis);
