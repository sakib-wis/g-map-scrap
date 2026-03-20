// G Map Scrap — Background Service Worker
// Handles install events and cross-tab messaging relay.

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[G Map Scrap] Installed successfully.');
    chrome.storage.local.set({ gmapResults: [] });
  }
});

// Relay messages from content scripts to popup (if open)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Pass through to popup
  chrome.runtime.sendMessage(msg).catch(() => {
    // Popup may not be open; ignore error
  });
  return false;
});
