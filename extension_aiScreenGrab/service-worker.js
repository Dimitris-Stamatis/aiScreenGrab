import { saveFile } from "./utils/indexedDB.mjs";
import { loadModel, predict } from "./utils/modelHelpers.mjs";

let injectedTabs = [];
let model = null;

chrome.action.onClicked.addListener(async (tab) => {
  let modelDetails = await chrome.storage.local.get('modelDetails');
  modelDetails = modelDetails.modelDetails;
  const modelDetailsPromise = createDeferredPromise();
  if (!modelDetails) {
    // open "popup.html" in a new tab
    chrome.tabs.create({ url: 'popup.html' });
    // wait for the model details to be saved
    await chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.modelDetails) {
        modelDetails = changes.modelDetails.newValue;
        modelDetailsPromise.resolve();
        chrome.storage.onChanged.removeListener();
      }
    });
  } else {
    modelDetailsPromise.resolve();
  }
  await modelDetailsPromise.promise;
  const currentTab = tab.id;
  if (!injectedTabs.includes(currentTab)) {
    injectedTabs.push(currentTab);
    await chrome.scripting.executeScript({
      target: { tabId: currentTab },
      files: ['injected.js'],
    });
    chrome.scripting.insertCSS({
      target: { tabId: currentTab },
      files: ['injected.css'],
    });
  }
  const existingContexts = await chrome.runtime.getContexts({});

  const offscreenDocument = existingContexts.find(
    (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
  );

  if (!offscreenDocument) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Recording from chrome.tabCapture API',
    });
  }

  const aspectRatio = modelDetails.inputShape.toLowerCase();
  if (isTabCaptured(currentTab)) {
    console.log('Tab is already being captured.');
  } else {
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });

    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'start-recording',
      streamId: streamId,
      aspectRatio
    });
  }

  chrome.tabs.sendMessage(currentTab, {
    type: 'startDrawing',
    aspectRatio
  });
});

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.target !== 'worker') return;
  console.log(message);
  switch (message.type) {
    case 'loadModel':
      try {
        modelLoaded = await loadModel(modelDetails.modelType);
      } catch (error) {
        sendResponse({ success: false, error: 'Error loading model.' });
        return;
      }
      sendResponse({ success: true });
      break;
    case 'predict':
      const predictions = await predict(modelLoaded, message.imageData);
      sendResponse(predictions);
      break;
    case 'frameData':
      console.log('Frame data received:', message.imageData);
      break;
  }
  return true;
});


function createDeferredPromise() {
  let resolve, reject;

  // Create a new promise and store the resolve and reject functions
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // Return an object with the promise and its resolve and reject functions
  return { promise, resolve, reject };
}

async function isTabCaptured(tabId) {
  return new Promise((resolve) => {
    chrome.tabCapture.getCapturedTabs((capturedTabs) => {
      // Check if any of the captured tabs matches the target tabId
      const isCaptured = capturedTabs.some((capturedTab) => capturedTab.tabId === tabId);
      resolve(isCaptured);
    });
  });
}