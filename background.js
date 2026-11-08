// Runs behind the scenes. It opens Sift when you click the toolbar icon. If Sift
// is already open, that page answers and comes forward instead of opening another.
chrome.action.onClicked.addListener(async () => {
  const answer = await chrome.runtime.sendMessage({ type: "sift-show" }).catch(() => null);
  if (answer?.shown) return;
  await chrome.tabs.create({ url: `${chrome.runtime.getURL("dashboard.html")}?layout=1` });
});
