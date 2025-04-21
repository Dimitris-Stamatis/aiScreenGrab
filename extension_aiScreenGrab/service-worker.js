import { loadModel } from "./utils/modelHelpers.mjs";
import { getItemFromDB, setItemInDB } from "./utils/indexedDB.mjs";

let modelLoaded = null;
let modelDetails = {};
let streamId = null;

chrome.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed.');
});

chrome.action.onClicked.addListener(async (tab) => {
  // Create offscreen document
  chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DISPLAY_MEDIA'],
    justification: 'Capture tab stream and run model inference',
  });
  // Go full screen
  //await chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { state: 'fullscreen' });
  modelDetails = await getItemFromDB('modelDetails');
  const modelDetailsPromise = createDeferredPromise();

  if (!modelDetails) {
    configureModel();

    const listener = async (message, sender, sendResponse) => {
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

  chrome.runtime.sendMessage({
    type: 'loadModel',
    target: 'offscreen',
  });
  const currentTab = tab.id;
  await chrome.scripting.executeScript({
    target: { tabId: currentTab },
    files: ['injected.js'],
  });
  chrome.scripting.insertCSS({
    target: { tabId: currentTab },
    files: ['injected.css'],
  });

  const aspectRatio = modelDetails.inputShape;

  // Check if the tab is already captured
  if (await isTabCaptured(tab.id)) {
    chrome.runtime.sendMessage({
      type: 'releaseStream',
      target: 'offscreen',
    });
  }
  streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await chrome.storage.local.set({ streamId });
  chrome.storage.local.set({ streamId });
  chrome.runtime.sendMessage({
    type: 'streamStart',
    target: 'offscreen',
    streamId,
    targetTabId: tab.id,
  });
  chrome.tabs.sendMessage(currentTab, {
    type: 'startDrawing',
    aspectRatio,
    streamId,
  });
});

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.target !== 'worker') return;
  console.log(message);
  switch (message.type) {
    case 'predict':
      if (message.action === 'start') {
        chrome.runtime.sendMessage({
          type: 'start-frameCapture',
          target: 'offscreen',
          streamId: streamId,
          targetTabId: message.targetTabId,
        });
        chrome.windows.getCurrent((window) => {
          if (window.state === 'fullscreen')
            return;
          //chrome.windows.update(window.id, { state: 'fullscreen' });
        });
      } else {
        chrome.runtime.sendMessage({
          type: 'stop-frameCapture',
          target: 'offscreen',
        });
        chrome.windows.getCurrent((window) => {
          chrome.windows.update(window.id, { state: 'normal' });
        });
      }
      break;
    case 'configureModel':
      configureModel();
      break;
    case 'predictions':
      // forward the predictions to the content script
      chrome.tabs.sendMessage(message.targetTabId, {
        type: 'predictions',
        predictions: message.predictions,
        imageData: message.imageData,
      });
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
      //console.log(capturedTabs);
      //console.log(tabId);
      // Check if any of the captured tabs matches the target tabId
      const isCaptured = capturedTabs.some((capturedTab) => capturedTab.tabId === tabId);
      resolve(isCaptured);
    });
  });
}

function configureModel() {
  chrome.windows.create({ url: 'popup.html', type: 'popup', width: 600, height: 600 });
}