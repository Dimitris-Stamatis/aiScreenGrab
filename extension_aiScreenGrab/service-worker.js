// service-worker.js
import { loadModel } from "./utils/modelHelpers.mjs";
import { getItemFromDB, setItemInDB } from "./utils/indexedDB.mjs";

let modelLoaded = null;
let modelDetails = {};
let streamId = null;

const activeTabs = new Set();
// Path to the bundled injected script
const INJECTED_SCRIPT_PATH = 'dist/injected.bundle.js';


// --- Performance Logging Refactor ---
let performanceLog = [];
const LOG_SAVE_ALARM_NAME = 'savePerformanceLogAlarm';
let isLogDirty = false; // A flag to avoid unnecessary writes

// Load existing logs on startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated.');

  // Load previous logs from storage into memory.
  chrome.storage.local.get('performanceLog', (result) => {
    performanceLog = result.performanceLog || [];
  });

  // Create an alarm to periodically save the logs.
  chrome.alarms.create(LOG_SAVE_ALARM_NAME, {
    periodInMinutes: 0.25 // Save every 15 seconds
  });
});

// Listener for the periodic save alarm.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === LOG_SAVE_ALARM_NAME) {
    await savePerformanceLog();
  }
});

// Optimized save function.
async function savePerformanceLog() {
  if (!isLogDirty) {
    return;
  }

  try {
    // Trim the log if it gets too large before saving.
    if (performanceLog.length > 2000) {
      console.warn("Performance log in memory is large, trimming older entries.");
      performanceLog = performanceLog.slice(performanceLog.length - 1000);
    }

    await chrome.storage.local.set({ performanceLog });
    isLogDirty = false; // Reset the dirty flag after a successful save.
    console.log('[ServiceWorker] Performance log batch-saved to storage.');
  } catch (e) {
    console.warn("Error batch-saving performance log to local storage:", e);
  }
}

// Optimized record function.
function recordPerformanceMetric(metric) {
  const enrichedMetric = {
    ...metric,
    timestamp: metric.timestamp || Date.now(),
    datetime: new Date(metric.timestamp || Date.now()).toISOString()
  };
  performanceLog.push(enrichedMetric);
  isLogDirty = true; // Mark the log as "dirty"
}
// --- End of Performance Logging Refactor ---


chrome.action.onClicked.addListener(async (tab) => {
  const currentTabId = tab.id;
  if (!currentTabId) {
    console.error("[ServiceWorker] Invalid tab ID from onClicked event.");
    recordPerformanceMetric({
      type: 'error',
      location: 'service-worker',
      error: 'Invalid tab ID from onClicked event.',
      context: 'action.onClicked initial'
    });
    return;
  }
  console.log(`[ServiceWorker] Action clicked for tab ${currentTabId}`);

  try {
    let hasOffscreen = false;
    try {
      hasOffscreen = await chrome.offscreen.hasDocument();
    } catch (e) {
      console.warn("[ServiceWorker] Error checking for offscreen document (MV3 promise API):", e);
      hasOffscreen = await new Promise(resolve => {
        chrome.offscreen.hasDocument?.({}, exists => resolve(exists !== undefined ? exists : false));
      });
    }
    console.log(`[ServiceWorker] Has offscreen document: ${hasOffscreen}`);

    if (!hasOffscreen) {
      console.log("[ServiceWorker] Attempting to create offscreen document.");
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DISPLAY_MEDIA'],
        justification: 'Capture tab stream and run model inference',
      });
      console.log("[ServiceWorker] Offscreen document created.");
    }

    const existingModelDetails = await getItemFromDB('modelDetails');
    const modelDetailsPromise = createDeferredPromise();

    if (!existingModelDetails) {
      console.log("[ServiceWorker] Model details not found in DB, opening configuration.");
      configureModel(currentTabId);
      const listener = async (message, sender) => {
        if (sender.id === chrome.runtime.id && message.type === 'modelDetailsUpdated') {
          console.log("[ServiceWorker] Received modelDetailsUpdated from popup/config.");
          modelDetails = message.modelDetails;
          const modelLoadStartTime = performance.now();
          modelLoaded = await loadModel(modelDetails.inferenceTask);
          const modelLoadEndTime = performance.now();
          if (modelLoaded) {
            recordPerformanceMetric({
              type: 'modelLoad',
              location: 'service-worker',
              durationMs: parseFloat((modelLoadEndTime - modelLoadStartTime).toFixed(2)),
              modelType: modelDetails.inferenceTask || 'unknown'
            });
          } else {
            recordPerformanceMetric({
              type: 'modelLoadError',
              location: 'service-worker',
              error: 'loadModel returned null/undefined after configuration',
              modelType: modelDetails.inferenceTask || 'unknown'
            });
          }
          modelDetailsPromise.resolve();
          chrome.runtime.onMessage.removeListener(listener);
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    } else {
      modelDetails = existingModelDetails;
      console.log("[ServiceWorker] Found existing model details:", modelDetails);
      if (!modelLoaded || (modelDetails && modelLoaded?.name !== modelDetails.inferenceTask)) {
        const modelLoadStartTime = performance.now();
        modelLoaded = await loadModel(modelDetails.inferenceTask);
        const modelLoadEndTime = performance.now();
        if (modelLoaded) {
          recordPerformanceMetric({
            type: 'modelLoad',
            location: 'service-worker',
            durationMs: parseFloat((modelLoadEndTime - modelLoadStartTime).toFixed(2)),
            modelType: modelDetails.inferenceTask || 'unknown'
          });
        } else {
          recordPerformanceMetric({
            type: 'modelLoadError',
            location: 'service-worker',
            error: 'loadModel returned null/undefined with existing details',
            modelType: modelDetails.inferenceTask || 'unknown'
          });
        }
      }
      modelDetailsPromise.resolve();
    }

    await modelDetailsPromise.promise;
    console.log("[ServiceWorker] Model details promise resolved. Current modelDetails:", modelDetails);

    if (!modelDetails || Object.keys(modelDetails).length === 0) {
      console.error("[ServiceWorker] Model details are empty after promise resolution. Aborting setup for tab", currentTabId);
      recordPerformanceMetric({
        type: 'error',
        location: 'service-worker',
        error: 'Model details are empty, cannot proceed.',
        tabId: currentTabId,
        context: 'action.onClicked after modelDetailsPromise'
      });
      return;
    }
    if (!modelLoaded) {
      console.warn("[ServiceWorker] Model not loaded by service-worker before sending to offscreen. Offscreen will attempt to load.");
      recordPerformanceMetric({
        type: 'warning',
        location: 'service-worker',
        message: 'Model was not loaded by service-worker before sending to offscreen',
        modelType: modelDetails.inferenceTask || 'unknown'
      });
    }

    try {
      console.log(`[ServiceWorker] Attempting to send 'loadModel' to offscreen for tab ${currentTabId}`);
      await chrome.runtime.sendMessage({ type: 'loadModel', target: 'offscreen', modelDetails: modelDetails });
      console.log(`[ServiceWorker] Successfully sent 'loadModel' to offscreen for tab ${currentTabId}`);
    } catch (e) {
      console.error(`[ServiceWorker] Error sending 'loadModel' to offscreen for tab ${currentTabId}:`, e);
      recordPerformanceMetric({
        type: 'messageError',
        location: 'service-worker',
        messageType: 'loadModel',
        targetComponent: 'offscreen',
        error: e.message,
        tabId: currentTabId
      });
    }

    try {
      console.log(`[ServiceWorker] Attempting to inject scripts into tab ${currentTabId}`);
      await chrome.scripting.executeScript({ target: { tabId: currentTabId }, files: [INJECTED_SCRIPT_PATH] });
      await chrome.scripting.insertCSS({ target: { tabId: currentTabId }, files: ['injected.css'] });
      console.log(`[ServiceWorker] Successfully injected scripts into tab ${currentTabId}`);
      activeTabs.add(currentTabId);
    } catch (e) {
      console.error(`[ServiceWorker] Error injecting scripts into tab ${currentTabId}:`, e);
      recordPerformanceMetric({
        type: 'scriptInjectionError',
        location: 'service-worker',
        scriptPath: INJECTED_SCRIPT_PATH,
        error: e.message,
        tabId: currentTabId
      });
      return;
    }

    if (await isTabCaptured(currentTabId)) {
      console.log(`[ServiceWorker] Tab ${currentTabId} is already captured. Releasing previous stream.`);
      try {
        await chrome.runtime.sendMessage({ type: 'releaseStream', target: 'offscreen' });
      } catch (e) {
        console.warn(`[ServiceWorker] Could not send releaseStream to offscreen: ${e.message}.`);
      }
    }

    console.log(`[ServiceWorker] Attempting to get media stream ID for tab ${currentTabId}`);
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: currentTabId });
    await chrome.storage.local.set({ streamId });
    console.log(`[ServiceWorker] Obtained stream ID ${streamId} for tab ${currentTabId}`);

    // ---- NEW COORDINATION LOGIC ----
    let viewportSize = null;
    try {
      console.log(`[ServiceWorker] Querying tab ${currentTabId} for viewport size.`);
      // Ask the content script for its dimensions and WAIT for the response
      viewportSize = await chrome.tabs.sendMessage(currentTabId, { type: 'getViewportSize' });
      if (!viewportSize || !viewportSize.width) {
        console.warn(`[ServiceWorker] Did not receive valid viewport size from tab ${currentTabId}.`);
        viewportSize = null; // Ensure it's null if the response is malformed
      } else {
        console.log(`[ServiceWorker] Received viewport size:`, viewportSize);
      }
    } catch (e) {
      console.error(`[ServiceWorker] Failed to get viewport size from content script for tab ${currentTabId}:`, e.message);
      // This can happen if the content script isn't injected or ready yet.
      // We can proceed without constraints in this case.
    }

    try {
      console.log(`[ServiceWorker] Attempting to send 'streamStart' to offscreen for tab ${currentTabId}`);
      // Send ONE message with the streamId AND the viewportSize
      await chrome.runtime.sendMessage({
        type: 'streamStart',
        target: 'offscreen',
        streamId,
        targetTabId: currentTabId,
        viewportSize // This will be the object {width, height} or null
      });
      console.log(`[ServiceWorker] Successfully sent 'streamStart' to offscreen for tab ${currentTabId}`);
    } catch (e) {
      console.error(`[ServiceWorker] Error sending 'streamStart' to offscreen for tab ${currentTabId}:`, e);
      // ... (error logging)
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      const tabInfo = await chrome.tabs.get(currentTabId);
      if (tabInfo && tabInfo.status === 'complete') {
        console.log(`[ServiceWorker] Attempting to send 'startDrawing' to tab ${currentTabId} (URL: ${tabInfo.url}, Status: ${tabInfo.status})`);
        if (!modelDetails.inputShape) {
          console.warn(`[ServiceWorker] modelDetails.inputShape is undefined for tab ${currentTabId}.`);
          recordPerformanceMetric({
            type: 'warning',
            location: 'service-worker',
            message: 'modelDetails.inputShape undefined when sending startDrawing',
            tabId: currentTabId
          });
        }
        await chrome.tabs.sendMessage(currentTabId, {
          type: 'startDrawing',
          aspectRatio: modelDetails.inputShape,
          streamId,
        });
        console.log(`[ServiceWorker] Successfully sent 'startDrawing' to tab ${currentTabId}`);
      } else {
        console.warn(`[ServiceWorker] Tab ${currentTabId} not ready or not found. Status: ${tabInfo?.status}. URL: ${tabInfo?.url}. Skipping 'startDrawing'.`);
        recordPerformanceMetric({
          type: 'messageSkip',
          location: 'service-worker',
          messageType: 'startDrawing',
          reason: `Tab not ready or not found. Status: ${tabInfo?.status}, URL: ${tabInfo?.url}`,
          tabId: currentTabId
        });
      }
    } catch (e) {
      console.error(`[ServiceWorker] Error sending 'startDrawing' to tab ${currentTabId}:`, e);
      recordPerformanceMetric({
        type: 'messageError',
        location: 'service-worker',
        messageType: 'startDrawing',
        targetComponent: 'tabContentScript',
        error: e.message,
        tabId: currentTabId
      });
    }
  } catch (error) {
    console.error(`[ServiceWorker] Critical error in onClicked handler for tab ${currentTabId}:`, error);
    recordPerformanceMetric({
      type: 'criticalError',
      location: 'service-worker',
      error: error.message,
      stack: error.stack,
      tabId: currentTabId,
      context: 'action.onClicked main try-catch'
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'worker') {
    switch (message.type) {
      case 'predict':
        if (!streamId && message.action === 'start') {
          console.warn("[ServiceWorker] 'predict' start requested but streamId is not set.");
        }
        chrome.runtime.sendMessage({
          type: message.action === 'start' ? 'start-frameCapture' : 'stop-frameCapture',
          target: 'offscreen',
          streamId,
          targetTabId: message.targetTabId,
        }).catch(e => console.error(`[ServiceWorker] Error sending frameCapture command to offscreen: ${e.message}`));
        break;

      case 'configureModel':
        configureModel(message.targetTabId);
        break;

      case 'predictions':
        if (message.targetTabId) {
          chrome.tabs.sendMessage(message.targetTabId, {
            type: 'predictions',
            predictions: message.predictions,
            fps: message.fps,
          }).catch(e => {
            if (e.message.includes("Receiving end does not exist")) {
              console.warn(`[ServiceWorker] Failed to send predictions to tab ${message.targetTabId}: Content script likely gone.`);
              activeTabs.delete(message.targetTabId);
              chrome.runtime.sendMessage({ type: 'stop-frameCaptureForTab', target: 'offscreen', targetTabId: message.targetTabId })
                .catch(err => console.warn("Could not send stop-frameCaptureForTab to offscreen", err));
            } else {
              console.error(`[ServiceWorker] Error relaying predictions to tab ${message.targetTabId}: ${e.message}`);
            }
          });
          // METRIC RECORDING REMOVED FROM HERE - This is the key fix.
        } else {
          console.warn("[ServiceWorker] Received predictions from offscreen without targetTabId.");
        }
        break;

      case 'recordPerformanceMetric':
        // This now handles both single events (like modelLoad) and aggregated reports.
        recordPerformanceMetric(message.metric);
        break;

      case 'getPerformanceLog':
        savePerformanceLog().then(() => {
          sendResponse({ data: performanceLog });
        });
        return true; // Indicates an asynchronous response.

      case 'clearPerformanceLog':
        performanceLog = [];
        isLogDirty = false;
        chrome.storage.local.set({ performanceLog }).then(() => {
          console.log('[ServiceWorker] Performance log cleared from memory and storage.');
          sendResponse({ success: true });
        }).catch(err => {
          console.error("[ServiceWorker] Failed to save cleared performance log:", err);
          sendResponse({ success: false, error: err.message });
        });
        return true; // Indicates an asynchronous response.

      default:
        return false;
    }
    return;
  }

  if (message.type === 'modelDetailsUpdated') {
    // This is handled within the onClicked flow.
  }

  return false;
});


chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && activeTabs.has(tabId)) {
    if (tab.url && (tab.url.startsWith('http:') || tab.url.startsWith('https:') || tab.url.startsWith('file:'))) {
      console.log(`[ServiceWorker] Re-injecting scripts into tab ${tabId} after reload/navigation to ${tab.url}`);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [INJECTED_SCRIPT_PATH],
        });
        await chrome.scripting.insertCSS({
          target: { tabId },
          files: ['injected.css'],
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        const { streamId: savedStreamId } = await chrome.storage.local.get('streamId');
        const currentModelDetails = await getItemFromDB('modelDetails');
        chrome.tabs.sendMessage(tabId, {
          type: 'reinjected',
          aspectRatio: currentModelDetails?.inputShape,
          streamId: savedStreamId,
        }).catch(e => console.warn(`[ServiceWorker] Error sending 'reinjected' message to tab ${tabId} after re-injection: ${e.message}`));
      } catch (e) {
        console.error(`[ServiceWorker] Error re-injecting scripts into tab ${tabId}: ${e.message}`);
        activeTabs.delete(tabId);
      }
    } else {
      console.log(`[ServiceWorker] Tab ${tabId} navigated to a restricted URL (${tab.url}). Not re-injecting.`);
      activeTabs.delete(tabId);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabs.has(tabId)) {
    console.log(`[ServiceWorker] Tab ${tabId} removed. Removing from active tabs.`);
    activeTabs.delete(tabId);
  }
});

function createDeferredPromise() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function isTabCaptured(tabId) {
  return new Promise((resolve) => {
    chrome.tabCapture.getCapturedTabs((capturedTabs) => {
      if (chrome.runtime.lastError) {
        console.warn(`[ServiceWorker] Error getting captured tabs: ${chrome.runtime.lastError.message}`);
        resolve(false);
        return;
      }
      resolve(capturedTabs.some(t => t.tabId === tabId && t.status === "active"));
    });
  });
}

function configureModel(tabIdContext) {
  chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    width: 600,
    height: 700,
  });
}