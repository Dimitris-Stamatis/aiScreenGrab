import { getItemFromDB } from "./utils/indexedDB.mjs";

let performanceLog = [];
const activeTabs = new Set();
const INJECTED_SCRIPT_PATH = 'dist/injected.bundle.js';

// --- Performance Logging (Unchanged) ---
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed.');
  chrome.storage.local.get('performanceLog', (result) => {
    performanceLog = result.performanceLog || [];
  });
});

async function savePerformanceLog() {
  try {
    await chrome.storage.local.set({ performanceLog });
  } catch (e) {
    console.warn("Error saving performance log:", e);
  }
}

function recordPerformanceMetric(metric) {
  const enrichedMetric = {
    ...metric,
    timestamp: metric.timestamp || Date.now(),
    datetime: new Date(metric.timestamp || Date.now()).toISOString()
  };
  performanceLog.push(enrichedMetric);
  savePerformanceLog();
}

// --- Action Listener (CORRECTED LOGIC) ---
chrome.action.onClicked.addListener(async (tab) => {
    const tabId = tab.id;
    if (!tabId) return;

    // FIRST, check if the model is configured.
    const modelDetails = await getItemFromDB('modelDetails');

    if (!modelDetails) {
        // --- PATH 1: NO MODEL CONFIGURED ---
        // The only thing to do is open the configuration page. Do NOT inject the script.
        console.log("[ServiceWorker] No model configured. Opening config popup.");
        configureModel();
    } else {
        // --- PATH 2: MODEL IS CONFIGURED ---
        // Now it's safe to inject the main script.
        console.log(`[ServiceWorker] Model found. Injecting scripts into tab ${tabId}.`);
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: [INJECTED_SCRIPT_PATH]
            });
            await chrome.scripting.insertCSS({
                target: { tabId: tabId },
                files: ['injected.css']
            });
            activeTabs.add(tabId);
        } catch (e) {
            console.error(`[SW] Failed to inject scripts into tab ${tabId}:`, e);
        }
    }
});


// --- Message Listener (Unchanged from previous correct version) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'worker') {
    switch (message.type) {
      case 'recordPerformanceMetric':
        recordPerformanceMetric(message.metric);
        sendResponse({success: true});
        break;
      case 'getPerformanceLog':
        sendResponse({ data: performanceLog });
        return true;
      case 'clearPerformanceLog':
        performanceLog = [];
        savePerformanceLog().then(() => sendResponse({ success: true }));
        return true;
      case 'configureModel':
        configureModel();
        sendResponse({success: true});
        break;
      case 'modelDetailsUpdated':
        console.log("[ServiceWorker] Relaying model update to active tabs.");
        activeTabs.forEach(tabId => {
          chrome.tabs.sendMessage(tabId, { type: 'modelDetailsUpdated' })
            .catch(e => {
              console.warn(`Could not inform tab ${tabId} of model update: ${e.message}`);
              activeTabs.delete(tabId);
            });
        });
        sendResponse({success: true});
        break;
      default:
        console.warn("[ServiceWorker] Unknown message for worker:", message);
        sendResponse({success: false, error: "Unknown message type"});
    }
    return;
  }
  return false;
});


// --- Tab Lifecycle Management (Unchanged) ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && activeTabs.has(tabId) && tab.url?.startsWith('http')) {
    console.log(`[ServiceWorker] Re-injecting scripts into tab ${tabId}.`);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [INJECTED_SCRIPT_PATH] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['injected.css'] });
    } catch (e) {
      console.error(`[SW] Error re-injecting scripts into tab ${tabId}: ${e.message}`);
      activeTabs.delete(tabId);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabs.has(tabId)) {
    console.log(`[ServiceWorker] Tab ${tabId} removed. Cleaning up.`);
    activeTabs.delete(tabId);
  }
});

function configureModel() {
  chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    width: 600,
    height: 700,
  });
}