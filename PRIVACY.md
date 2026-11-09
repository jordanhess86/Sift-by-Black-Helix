# Sift privacy policy

Last updated: November 8, 2026

Sift by Black Helix is a free Chrome extension for organizing your own ChatGPT chats. This policy explains what it handles and where that information goes.

## The short version

Sift has no servers. It doesn't send your information to Black Helix or anyone else. It only talks to chatgpt.com, using your own logged-in browser, and keeps everything else on your computer.

## What Sift handles, and why

| Information | Why Sift uses it | Where it's kept |
|---|---|---|
| Chat titles, dates and project names | To list, filter, sort and organize your chats | In the open Sift page while you use it, and in the action log described below |
| Chat messages | To back up chats before changing them, and to search inside them | Only in backup files in a folder you choose on your computer |
| Your ChatGPT account ID, name and email address | To keep each account's backups in its own folder and to show which account is in use | The account name, or the part of the email before the @ if there's no name, labels the backup folder and the action log. The account ID is saved with that name in a small label file in the backup folder. The full email address is never saved. |
| Your ChatGPT login token | To make requests to chatgpt.com on your behalf | In memory only, inside the chatgpt.com tab. It is never saved or sent anywhere except chatgpt.com. |
| Settings and the action log (what was archived, moved, renamed or deleted, with chat titles and IDs) | To remember your choices and keep a record of changes | In Chrome's local storage for the extension, on your computer |
| Which backup folder you chose | So you don't have to choose it every time | In the extension's own browser storage, on your computer |

## What Sift doesn't do

- It doesn't send any information to Black Helix or any third party.
- It doesn't use analytics, tracking, advertising or cookies of its own.
- It doesn't sell or share your information, or use it for anything other than the features described above.
- It doesn't download code or AI models while running. The related search model is included in the extension and runs on your computer.

## Network requests

Sift's only network requests go to `https://chatgpt.com`, to read your chats and projects, and to make changes you preview and confirm. Its security settings block requests to every other address.

## Your control

- **Delete backups** by deleting the files in your backup folder.
- **Erase the action log and settings** by uninstalling Sift.
- **Export the action log** with **Export log as a spreadsheet file (CSV)** in Sift.
- **Keep your backup folder** outside cloud-synced folders such as iCloud or Dropbox if you want your chats to stay only on your computer.

## Changes and contact

If this policy changes, the new version will be posted at the same address with a new date. For questions, open an issue at https://github.com/jordanhess86/Sift-by-Black-Helix/issues.

Sift is unofficial and isn't affiliated with or endorsed by OpenAI.
