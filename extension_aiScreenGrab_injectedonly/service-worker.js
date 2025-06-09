// service-worker.js
// This service worker has a minimal role: injecting the content script
// and its CSS when the user clicks the extension action button.

const INJECTED_SCRIPT_PATH = 'dist/injected.bundle.js';
const INJECTED_CSS_PATH = 'injected.css';

// Listen for the extension's action button to be clicked.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    console.error("Invalid tab ID.");
    return;
  }

  console.log(`[ServiceWorker] Action clicked for tab ${tab.id}. Injecting script.`);

  try {
    // Execute the main script in the active tab.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [INJECTED_SCRIPT_PATH]
    });
    // Inject the CSS for the UI.
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: [INJECTED_CSS_PATH]
    });
  } catch (e) {
    console.error(`[ServiceWorker] Error injecting script into tab ${tab.id}:`, e);
    // This can happen on restricted pages (e.g., chrome:// URLs, extension web store).
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed. The service worker is ready to inject the content script on action click.');
});