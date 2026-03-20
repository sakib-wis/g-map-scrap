// G Map Scrap — Background Service Worker
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ gmapResults: [] });
    console.log('[G Map Scrap] Installed.');
  }
});
// NOTE: Do NOT relay messages here. Content → popup messaging works directly.
// Re-broadcasting causes duplicate log entries in the popup.
