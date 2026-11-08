// Watches ChatGPT's answers for signs its site has changed. It adds no requests, only
// looks at answers Sift already receives, and pauses actions it can no longer trust.
// The diagnostic report records only the structure of answers, never their contents.
(function (root) {
  "use strict";

  const MAX_RECORDS = 60;
  const MAX_SHAPE_DEPTH = 6;
  const MAX_KEYS_PER_OBJECT = 40;
  const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
  const CHANGED_SITE_STATUSES = new Set([400, 405, 410, 415, 422]);
  const ALL_CHANGES = ["archive", "restore", "rename", "move", "createProject", "delete"];

  const PROBLEMS = {
    chatList: { message: "ChatGPT's chat list looks different", pauses: [...ALL_CHANGES, "backup"] },
    projects: { message: "ChatGPT's project list looks different", pauses: ["move", "createProject", "delete"] },
    chatContent: { message: "ChatGPT's chat format looks different", pauses: ["archive", "delete", "backup"] },
    account: { message: "Sift couldn't tell which ChatGPT account is logged in", pauses: ["archive", "delete", "backup"] },
    oldHelper: { message: "Your ChatGPT tab is still running an older part of Sift", pauses: ["archive", "delete", "backup"], notSiteChange: true },
    oldVersion: { message: "Chrome is still running an older version of Sift", pauses: [...ALL_CHANGES, "backup"], notSiteChange: true },
    archive: { message: "ChatGPT didn't confirm an archive", pauses: ["archive"] },
    restore: { message: "ChatGPT didn't confirm a restore", pauses: ["restore"] },
    rename: { message: "ChatGPT didn't confirm a rename", pauses: ["rename"] },
    move: { message: "ChatGPT didn't confirm a move", pauses: ["move"] },
    createProject: { message: "ChatGPT didn't confirm a new project", pauses: ["createProject"] },
    delete: { message: "ChatGPT didn't confirm a delete", pauses: ["delete"] },
  };

  const records = new Map();
  const facts = {};
  const found = new Set();

  // Replaces anything specific to a person with a placeholder.
  function templatePath(path) {
    const [address, query = ""] = String(path).split("?");
    const segments = address.split("/").map((segment) => {
      if (/^(backend-api|conversations?|gizmos|snorlax|sidebar|messages|projects|id)?$/.test(segment)) return segment;
      return "<id>";
    });
    const names = [...new URLSearchParams(query).keys()].sort();
    return segments.join("/") + (names.length ? `?${names.join("&")}` : "");
  }

  // Describes an answer's structure: field names and types, never any values.
  function describeShape(value, depth = 0) {
    if (value === null) return "null";
    if (Array.isArray(value)) {
      if (value.length === 0) return ["empty"];
      return depth >= MAX_SHAPE_DEPTH ? ["…"] : [describeShape(value[0], depth + 1)];
    }
    if (typeof value !== "object") return typeof value;
    if (depth >= MAX_SHAPE_DEPTH) return "object";
    const shape = {};
    let otherFields = 0;
    for (const key of Object.keys(value).sort().slice(0, MAX_KEYS_PER_OBJECT)) {
      if (SAFE_KEY.test(key)) shape[key] = describeShape(value[key], depth + 1);
      else otherFields += 1;
    }
    if (otherFields) shape["<other fields>"] = otherFields;
    return shape;
  }

  function looksLikeChat(item) {
    return (
      item !== null && typeof item === "object" && typeof item.id === "string" && item.id !== "" &&
      "title" in item && "update_time" in item && "create_time" in item
    );
  }

  function isChatListValid(data) {
    return Array.isArray(data?.items) && data.items.every(looksLikeChat);
  }

  function isProjectListValid(data) {
    return (
      Array.isArray(data?.items) &&
      data.items.every((item) => {
        const details = item?.gizmo?.gizmo;
        const chats = item?.conversations?.items;
        return typeof details?.id === "string" && typeof details?.display === "object" && details.display !== null &&
          Array.isArray(chats) && chats.every(looksLikeChat);
      })
    );
  }

  function isChatContentValid(data) {
    return Array.isArray(data?.messages) && data.messages.every((message) => typeof message?.id === "string");
  }

  function kindOfRead(template) {
    const address = template.split("?")[0];
    if (address === "/backend-api/conversations") return "chatList";
    if (address === "/backend-api/gizmos/snorlax/sidebar") return "projects";
    if (/^\/backend-api\/gizmos\/<id>\/conversations$/.test(address)) return "projectChats";
    if (/^\/backend-api\/conversations\/<id>(\/messages)?$/.test(address)) return "chatContent";
    return "other";
  }

  function record(label, template, result, verdict) {
    const shape = result?.ok ? describeShape(result.data) : null;
    const key = JSON.stringify([label, template, result?.status ?? null, result?.error ?? null, shape]);
    const existing = records.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = new Date().toISOString();
      existing.verdict = verdict;
      records.delete(key);
      records.set(key, existing);
    } else {
      records.set(key, {
        label,
        path: template,
        ok: Boolean(result?.ok),
        status: result?.status ?? null,
        error: typeof result?.error === "string" ? result.error : null,
        verdict,
        shape,
        count: 1,
        lastSeen: new Date().toISOString(),
      });
    }
    while (records.size > MAX_RECORDS) records.delete(records.keys().next().value);
  }

  // Checks one read. A login problem, slow-down or missing chat isn't a site change.
  function observeRead(path, result) {
    const template = templatePath(path);
    const kind = kindOfRead(template);
    const problem = { chatList: "chatList", projects: "projects", projectChats: "projects", chatContent: "chatContent" }[kind];
    let verdict = "not checked";
    if (result?.ok) {
      const valid = {
        chatList: isChatListValid,
        projects: isProjectListValid,
        projectChats: isChatListValid,
        chatContent: isChatContentValid,
      }[kind];
      if (valid) {
        verdict = valid(result.data) ? "as expected" : "unexpected";
        if (verdict === "unexpected") found.add(problem);
      }
    } else if (result?.error === "not-json" || CHANGED_SITE_STATUSES.has(result?.status) || (result?.status === 404 && kind !== "chatContent" && problem)) {
      verdict = "unexpected";
      if (problem) found.add(problem);
    }
    record(`read:${kind}`, template, result, verdict);
    return result;
  }

  // Checks one change. A 404 can be one unusual chat, so it stops the run but pauses nothing.
  function observeChange(action, path, result, isConfirmed = (data) => data?.success === true) {
    let verdict = "not confirmed";
    if (result?.ok) {
      if (isConfirmed(result.data)) verdict = "confirmed";
      else found.add(action);
    } else if (result?.error === "not-json" || CHANGED_SITE_STATUSES.has(result?.status)) {
      found.add(action);
    }
    record(`change:${action}`, templatePath(path), result, verdict);
    return result;
  }

  // Checks the account details. Without them, Sift can't choose the right backup folder.
  function observeAccount(result) {
    const verdict = result?.ok && typeof result.data?.id === "string" && result.data.id ? "as expected" : "unexpected";
    record("read:account", "/api/auth/session", result, verdict);
    return result;
  }

  function noteAccountMissing() {
    found.add("account");
  }

  function noteOldHelper() {
    found.add("oldHelper");
  }

  function noteOldVersion() {
    found.add("oldVersion");
  }

  function hasSiteChange() {
    return [...found].some((problem) => !PROBLEMS[problem].notSiteChange);
  }

  function hasProblem(code) {
    return found.has(code);
  }

  function isPaused(action) {
    return [...found].some((problem) => PROBLEMS[problem].pauses.includes(action));
  }

  function problems() {
    return [...found].map((code) => ({ code, message: PROBLEMS[code].message, pauses: PROBLEMS[code].pauses }));
  }

  function pausedActions() {
    return [...new Set(problems().flatMap((problem) => problem.pauses))];
  }

  // Forgets problems so a fresh load can check again. Earlier answers stay in the report.
  function reset() {
    found.clear();
  }

  // A number worth seeing in the report. Never anything about a person's chats.
  function noteFact(name, value) {
    facts[name] = value;
  }

  function buildReport({ version = "unknown", chrome: chromeVersion = "unknown" } = {}) {
    return {
      report: "Sift diagnostic report",
      note: "Holds only the structure of ChatGPT's answers. It has no chat titles, messages, IDs or login details.",
      createdAt: new Date().toISOString(),
      siftVersion: version,
      chromeVersion,
      problems: problems(),
      pausedActions: pausedActions(),
      facts: { ...facts },
      answers: [...records.values()],
    };
  }

  root.OrganizerHealth = {
    templatePath,
    describeShape,
    observeRead,
    observeChange,
    observeAccount,
    noteAccountMissing,
    noteOldHelper,
    noteOldVersion,
    hasSiteChange,
    hasProblem,
    noteFact,
    isPaused,
    problems,
    pausedActions,
    reset,
    buildReport,
  };
})(globalThis);
