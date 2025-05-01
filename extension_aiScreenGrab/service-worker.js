import { loadModel } from "./utils/modelHelpers.mjs";
import { getItemFromDB, setItemInDB } from "./utils/indexedDB.mjs";

let modelLoaded = null;
let modelDetails = {};
let streamId = null;

// Keep track of all tabs where we've injected our UI
const activeTabs = new Set();

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed.');
});

chrome.action.onClicked.addListener(async (tab) => {
  const currentTab = tab.id;

  // Only create an offscreen page if one doesn't already exist
  let hasOffscreen = false;
  try {
    // MV3 promise-based API
    hasOffscreen = await chrome.offscreen.hasDocument();
  } catch {
    // fallback for callback-based
    hasOffscreen = await new Promise(resolve => {
      chrome.offscreen.hasDocument?.({}, exists => resolve(exists));
    });
  }

  if (!hasOffscreen) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DISPLAY_MEDIA'],
      justification: 'Capture tab stream and run model inference',
    });
  }

  // Load or configure the model
  modelDetails = await getItemFromDB('modelDetails');
  const modelDetailsPromise = createDeferredPromise();

  if (!modelDetails) {
    configureModel();
    const listener = async (message, sender) => {
      if (message.type === 'modelDetailsUpdated') {
        modelDetails = message.modelDetails;
        await setItemInDB('modelDetails', modelDetails);
        modelLoaded = await loadModel(modelDetails.modelType);
        modelDetailsPromise.resolve();
        chrome.runtime.onMessage.removeListener(listener);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  } else {
    modelDetailsPromise.resolve();
  }

  await modelDetailsPromise.promise;
  modelLoaded = await loadModel(modelDetails.modelType);

  // Tell offscreen to load the model
  chrome.runtime.sendMessage({ type: 'loadModel', target: 'offscreen' });

  // Inject our UI into the tab
  await chrome.scripting.executeScript({
    target: { tabId: currentTab },
    files: ['injected.js'],
  });
  await chrome.scripting.insertCSS({
    target: { tabId: currentTab },
    files: ['injected.css'],
  });

  // Remember this tab so we can re-inject on reload/navigation
  activeTabs.add(currentTab);

  // Start tab-capture if needed
  if (await isTabCaptured(currentTab)) {
    chrome.runtime.sendMessage({ type: 'releaseStream', target: 'offscreen' });
  }
  streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: currentTab });
  await chrome.storage.local.set({ streamId });

  chrome.runtime.sendMessage({
    type: 'streamStart',
    target: 'offscreen',
    streamId,
    targetTabId: currentTab,
  });

  // Tell our UI to start drawing
  chrome.tabs.sendMessage(currentTab, {
    type: 'startDrawing',
    aspectRatio: modelDetails.inputShape,
    streamId,
  });
});

chrome.runtime.onMessage.addListener(async (message, sender) => {
  if (message.target !== 'worker') return;
  switch (message.type) {
    case 'predict':
      if (message.action === 'start') {
        chrome.runtime.sendMessage({
          type: 'start-frameCapture',
          target: 'offscreen',
          streamId,
          targetTabId: message.targetTabId,
        });
      } else {
        chrome.runtime.sendMessage({ type: 'stop-frameCapture', target: 'offscreen' });
      }
      break;

    case 'configureModel':
      configureModel();
      break;

    case 'predictions':
      chrome.tabs.sendMessage(message.targetTabId, {
        type: 'predictions',
        predictions: message.predictions,
        imageData: message.imageData,
        fps: message.fps,
      });
      break;
  }
  return true;
});

// Re-inject on reload/navigation
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && activeTabs.has(tabId)) {
    console.log(`Re-injecting into tab ${tabId} after reload/navigation`);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['injected.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['injected.css'],
    });
    const { streamId: savedStreamId } = await chrome.storage.local.get('streamId');
    chrome.tabs.sendMessage(tabId, {
      type: 'reinjected',
      aspectRatio: modelDetails.inputShape,
      streamId: savedStreamId,
    });
  }
});

// Clean up when a tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
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
      resolve(capturedTabs.some(t => t.tabId === tabId));
    });
  });
}

function configureModel() {
  chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    width: 600,
    height: 600,
  });
}
