// utils/indexedDB.mjs
async function openKVStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(chrome.runtime.id + "_kv", 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv", { keyPath: "key" });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}
async function getItemFromDB(key) {
  const db = await openKVStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const store = tx.objectStore("kv");
    const request = store.get(key);
    request.onsuccess = () => {
      resolve(request.result?.value);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

// service-worker.js
var performanceLog = [];
var activeTabs = /* @__PURE__ */ new Set();
var INJECTED_SCRIPT_PATH = "dist/injected.bundle.js";
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed.");
  chrome.storage.local.get("performanceLog", (result) => {
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
chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  if (!tabId) return;
  const modelDetails = await getItemFromDB("modelDetails");
  if (!modelDetails) {
    console.log("[ServiceWorker] No model configured. Opening config popup.");
    configureModel();
  } else {
    console.log(`[ServiceWorker] Model found. Injecting scripts into tab ${tabId}.`);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [INJECTED_SCRIPT_PATH]
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["injected.css"]
      });
      activeTabs.add(tabId);
    } catch (e) {
      console.error(`[SW] Failed to inject scripts into tab ${tabId}:`, e);
    }
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "worker") {
    switch (message.type) {
      case "recordPerformanceMetric":
        recordPerformanceMetric(message.metric);
        sendResponse({ success: true });
        break;
      case "getPerformanceLog":
        sendResponse({ data: performanceLog });
        return true;
      case "clearPerformanceLog":
        performanceLog = [];
        savePerformanceLog().then(() => sendResponse({ success: true }));
        return true;
      case "configureModel":
        configureModel();
        sendResponse({ success: true });
        break;
      case "modelDetailsUpdated":
        console.log("[ServiceWorker] Relaying model update to active tabs.");
        activeTabs.forEach((tabId) => {
          chrome.tabs.sendMessage(tabId, { type: "modelDetailsUpdated" }).catch((e) => {
            console.warn(`Could not inform tab ${tabId} of model update: ${e.message}`);
            activeTabs.delete(tabId);
          });
        });
        sendResponse({ success: true });
        break;
      default:
        console.warn("[ServiceWorker] Unknown message for worker:", message);
        sendResponse({ success: false, error: "Unknown message type" });
    }
    return;
  }
  return false;
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && activeTabs.has(tabId) && tab.url?.startsWith("http")) {
    console.log(`[ServiceWorker] Re-injecting scripts into tab ${tabId}.`);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [INJECTED_SCRIPT_PATH] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["injected.css"] });
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
    url: "popup.html",
    type: "popup",
    width: 600,
    height: 700
  });
}
