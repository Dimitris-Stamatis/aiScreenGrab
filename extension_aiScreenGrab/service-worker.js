import { loadModel, predict } from "./utils/modelHelpers.mjs";

let modelLoaded = null;
let modelDetails = {};
let streamId = null;

chrome.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed.');
});

chrome.action.onClicked.addListener(async (tab) => {
  // Go full screen
  //await chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { state: 'fullscreen' });
  modelDetails = (await chrome.storage.local.get('modelDetails'))?.modelDetails;
  const modelDetailsPromise = createDeferredPromise();
  if (!modelDetails) {
    // open "popup.html" in a new tab
    configureModel();
    // wait for the model details to be saved
    await chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName === 'local' && changes.modelDetails) {
        modelDetails = changes.modelDetails.newValue;
        modelLoaded = await loadModel(modelDetails.modelType);
        console.log('Model loaded:', modelLoaded);
        modelDetailsPromise.resolve();
        chrome.storage.onChanged.removeListener();
      }
    });
  } else {
    modelDetailsPromise.resolve();
  }
  await modelDetailsPromise.promise;
  modelLoaded = await loadModel(modelDetails.modelType);
  console.log('Model loaded:', modelLoaded);
  const currentTab = tab.id;
  await chrome.scripting.executeScript({
    target: { tabId: currentTab },
    files: ['injected.js'],
  });
  chrome.scripting.insertCSS({
    target: { tabId: currentTab },
    files: ['injected.css'],
  });
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

  const aspectRatio = modelDetails.inputShape;
  if ((await isTabCaptured(currentTab))) {
    console.log('Tab is already being captured.');
  } else {
    streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
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
    case 'predict':
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: `${message.action}-frameCapture`,
        targetTabId: sender.tab.id,
        streamId,
      });
      if (message.action === 'start') {
        chrome.windows.getCurrent((window) => {
          chrome.windows.update(window.id, { state: 'fullscreen' });
        });
      } else {
        chrome.windows.getCurrent((window) => {
          chrome.windows.update(window.id, { state: 'normal' });
        });
      }
      break;
    case 'frameData':
      console.log('Frame data received:', message.imageData);
      console.log(typeof message.imageData);
      // Check if the received message has the expected properties
      if (message.imageData && message.imageData.data && message.imageData.width && message.imageData.height) {
        // Reconstruct the ImageData object
        const reconstructedImageData = new ImageData(
          new Uint8ClampedArray(message.imageData.data),  // Convert back to Uint8ClampedArray
          message.imageData.width,
          message.imageData.height
        );
        let predictions = await predict(modelLoaded, reconstructedImageData, modelDetails.inputShape);
        // keep only the top 5 predictions
        predictions = predictions.slice(0, 5);
        console.log(predictions);
        
        chrome.tabs.sendMessage(message.targetTabId, {
          type: 'predictions',
          predictions,
          imageData: message.imageData
        });
      } else {
        console.error("Invalid image data received.");
      }
      break;
    case 'configureModel':
      configureModel();
      break;
    case 'rectUpdate':
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'rectUpdate',
        rect: message.rect,
        yoffset: message.yoffset,
        tabid: sender.tab.id
      });
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