# Sift by Black Helix

Sift is a free, unofficial Chrome extension for organizing your own ChatGPT chats and projects. You can search, archive, move, rename and delete many chats at once, and back them up to a folder on your computer first.

Version 0.20.0.

> **Sift isn't made by or affiliated with OpenAI.** It works by using the same requests the ChatGPT website uses, which OpenAI doesn't officially support. OpenAI's terms restrict automated access, so using Sift carries some risk to your account. Sift only acts when you start something, and it works in small, slow batches, but that doesn't remove the risk. ChatGPT can also change its site at any time and break Sift.
>
> Sift is provided as is, with no warranty (see `LICENSE`). Deleting a chat in ChatGPT is permanent. Sift's backups are for reading and searching, and they can't be restored into ChatGPT. Use at your own risk.

## Privacy

- **Sift only talks to chatgpt.com**, using your own logged-in browser session. There are no Sift servers, no analytics and no tracking. The page's security settings block every other address.
- **Your login stays private.** Sift reads your ChatGPT login token only to make requests, keeps it in memory and never saves it.
- **Everything else stays on your computer:** settings and the action log in Chrome, and backups in a folder you choose.
- **Related search** uses a small AI model bundled inside the extension. It runs on your computer and downloads nothing.
- **Sift asks for only two Chrome permissions:** storage for its settings and log, and access to chatgpt.com.

Keep your backup folder outside iCloud, Dropbox and similar services, or your chats will be copied to their servers.

## What Sift does

- **Lists** your chats and projects, and shows which chats are in which project.
- **Searches** chat titles straight away, and the words inside backed-up chats. Related search can also find chats by topic.
- **Filters** by date, by "not in any project", and with cleanup views for old or very short chats.
- **Archives, restores, moves, renames and deletes** chats in bulk, and creates projects.
- **Backs up** new and changed chats to your computer as JSON files.
- **Keeps an action log** of everything it changed, which you can export as a spreadsheet file (CSV).
- **Previews every change:** before anything happens, Sift shows exactly which chats will be affected and asks you to confirm.

## Install

Sift isn't in the Chrome Web Store, so you install it yourself in a few steps:

1. On this GitHub page, click **Code**, then **Download ZIP**, and unzip it. Move the unzipped folder somewhere it'll stay, such as your Documents folder, because Chrome runs Sift from there.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** at the top right.
3. Click **Load unpacked** and choose the unzipped folder, which is the one that contains `manifest.json`.
4. Log in at [chatgpt.com](https://chatgpt.com) in a Chrome tab, or reload it if it's already open.
5. Click the Sift icon in Chrome's toolbar. The puzzle-piece icon lets you pin it.

Sift needs a recent desktop version of Chrome. Opening it beside ChatGPT in Split View needs Chrome 155 or newer, and two normal tabs work in older versions.

### Updating

Download the new version, replace your folder's contents, then:

1. Go to `chrome://extensions` and click the circular arrow on the **Sift by Black Helix** card.
2. Reload your chatgpt.com tab.
3. Close any open Sift tab and click the toolbar icon again.

Chrome doesn't pick up all new code until you do this. Sift shows **Finish updating Sift** if it notices an incomplete update.

## Try it on test chats first

Before using Sift on chats you care about, make two or three throwaway chats in ChatGPT, such as `sift test 1` and `sift test 2`. Then try archiving, restoring, moving, and finally deleting them. Check the results in ChatGPT and in the action log.

## Using Sift

- **Opening:** the toolbar icon opens Sift in Chrome's Split View beside ChatGPT. To use two normal tabs instead, change **How Sift opens** in **Settings**, the button at the top right. Split View won't join a pinned or grouped ChatGPT tab, or one that's already in another split. Sift tells you if that happens and never unpins or regroups your tabs.
- **Clicking a chat title** loads it in your ChatGPT tab and keeps you in Sift. It replaces the page showing there, so send or copy anything you're typing first. Hold Command (Ctrl on Windows) to open a new tab instead.
- **Loading:** when Sift opens, it loads your project names and the chats that aren't in a project. Click a project to load its chats, or **Load all projects** for all of them. **Archived** loads when you click it. A **–** means a group isn't loaded yet. To load everything each time, change **What to load** in **Settings**. You can also turn off loading when Sift opens.
- **Sorting:** click a column heading, then click again to reverse it. Split View hides the **Project** and **Created** columns, so those sorts need a full-width window.
- **Ticking chats:** tick one chat, then hold Shift and click another to tick everything between them. Buttons for **Move…**, **Rename…**, **Archive…** and **Delete…** appear in a bar at the bottom.
- **Projects in a narrow window:** click **Projects** at the left of the list to slide the project list in.
- **Cleanup views** in the left list show chats not updated in 6 months or a year, and very short chats. Very short means 40 words or fewer in the latest backup, so it only covers backed-up chats. ChatGPT doesn't share when a chat was last opened, so the date views use when it last changed. Cleanup views only cover loaded chats.
- **Light and dark modes:** choose **Light**, **Dark** or **Match my computer** in **Settings**.
- **Setup guide:** a first-time guide walks you through choosing a backup folder, your first backup and related search. **Start the setup walkthrough** in **Settings** brings it back.

### Backups

Choose a backup folder the first time you back up. Sift makes a subfolder for each ChatGPT account, named after the account, or the part of its email before the @ if the account has no name. **Change folder…** in **Settings** picks a different folder.

Inside each account's subfolder:

| Folder | What's in it |
|---|---|
| `chats` | Your active chats |
| `Archived` | Chats you archived using Sift |
| `Deleted` | Chats you deleted using Sift |

- **Back up new and changed chats…** saves active chats only, up to 200 per run. It only covers loaded chats, so Sift offers to load your projects first.
- **Archive…** saves a fresh backup of each chat first, then archives it and moves its file to `Archived`. If a backup fails, that chat isn't archived and the run stops.
- **Back up archived chats with no backup…**, in the **Archived** view, saves archived chats that have no backup.
- Chats you archive or delete directly in ChatGPT aren't moved to these folders, because Sift doesn't see those actions.
- Backups include text and chat details, but not images or uploaded files. ChatGPT's own data export, in ChatGPT's settings, is still the most complete backup.

### Deleting

Deleting has extra safeguards:

- The preview labels each chat **Backed up**, **Older backup** (the chat has changed since) or **No backup**.
- If any chats aren't fully backed up, you must choose to **back them up first** or **delete them without a new backup**. Nothing is chosen for you.
- The red button stays off until you answer and type `DELETE`.
- One run handles at most 50 chats.
- When backing up first, Sift fetches every message, saves the file and reads it back to check it, and only then deletes. If any step fails, that chat isn't deleted and the run stops.
- Existing backup files move to `Deleted` once ChatGPT confirms. Sift never deletes a backup file.

### Archived chats

Click **Archived** in the left list. You can restore, delete or move archived chats in bulk, and rename one at a time.

### Search

Typing in the search box filters chat titles straight away. Click **Search** or press Return to search inside backed-up chats.

- A chat must contain every word you type, and `car` also finds `cars`. Use quotes for an exact phrase, such as `"brake pads"`.
- Results say whether a chat is active, archived or deleted. **Read** opens the saved copy. Deleted results are read only.
- A result that isn't loaded yet has a **Load to select** button.
- Search doesn't cover chats with no backup, messages added since the last backup, or images and files.
- The first search reads every backup file, so it's the slowest. Sift keeps a searchable copy in `search-index.json`, which you can delete at any time because it gets rebuilt.

**Related search** finds chats by topic, so `mechanic` may find a chat about brake pads. Click **Prepare related search…** first. The bundled AI model reads your backups and saves its results as `related-index.bin`, which you can also delete at any time. Related results appear below exact matches, closest first, and some may be off-topic. It covers up to about 36,000 words per chat.

## If ChatGPT changes its site

Sift checks ChatGPT's answers as it reads them, with no extra requests. If something looks different, or ChatGPT doesn't confirm a change, a banner lists the actions Sift has paused. Reading and searching keep working. **Check again** reloads your chats and clears the pause if everything looks right.

**Save diagnostic report**, in the banner or in **Settings**, saves a file to your downloads describing the shape of ChatGPT's recent answers. It contains no chat titles, messages, IDs or login details. You can attach it to a GitHub issue if you report a problem.

## Known limits

- **Chats that may be linked to a custom GPT** are skipped when moving, because moving could overwrite that link.
- **Moving a chat out of a project** has to be done in ChatGPT.
- **Some chats from a project that was shared with others** can fail with a "404" error when archiving, moving or deleting. Backups handle them.
- **The action log** lives inside Chrome and is erased if you uninstall Sift, so export it if you want to keep it.

## How well it's tested

Sift has been used on one real ChatGPT account, on a Mac with Chrome. Listing, search, archiving, restoring, moving, renaming, creating projects, backups, deleting, the design and Split View have all worked there.

**Not yet tested on a real account:**

- Version 0.20.0's on-request loading of projects. It assumes ChatGPT can leave project chats out of the main list. If it doesn't, the diagnostic report's `projectChatsInBasicList` count will be above 0.
- Account names for backup subfolders.
- Windows, other Chromium browsers, and team or business workspaces.

## For developers

- Run the automated tests with `sh tests/run-tests.sh`. They need Node.js, use made-up data only and never contact ChatGPT.
- `content.js` is the only code that talks to chatgpt.com, and it only allows a fixed list of requests.
- `tests/clean_log.py` makes a cleaned copy of a Chrome network log (HAR file). Raw network logs can contain login tokens and private chats, so never share or commit one.
- Bundled third-party files are listed in `THIRD_PARTY.md`.

## License

Sift's code is released under the MIT License, in `LICENSE`. Bundled third-party files keep their own licenses, listed in `THIRD_PARTY.md`.

The license covers the code only. The **Black Helix** name and logo aren't included and may not be used to brand other projects.
