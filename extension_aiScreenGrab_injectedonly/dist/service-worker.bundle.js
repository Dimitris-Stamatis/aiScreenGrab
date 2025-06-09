// service-worker.js
var INJECTED_SCRIPT_PATH = "dist/injected.bundle.js";
var INJECTED_CSS_PATH = "injected.css";
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    console.error("Invalid tab ID.");
    return;
  }
  console.log(`[ServiceWorker] Action clicked for tab ${tab.id}. Injecting script.`);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [INJECTED_SCRIPT_PATH]
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: [INJECTED_CSS_PATH]
    });
  } catch (e) {
    console.error(`[ServiceWorker] Error injecting script into tab ${tab.id}:`, e);
  }
});
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed. The service worker is ready to inject the content script on action click.");
});
