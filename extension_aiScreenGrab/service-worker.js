import { saveFile } from "./utils/indexedDB.mjs";
import * as tf from 'https://cdn.skypack.dev/pin/@tensorflow/tfjs@v4.20.0-2i3xZugZdN63AwP38wHs/mode=imports,min/optimized/@tensorflow/tfjs.js';

let injectedTabs = [];
// Listen for messages from the popup
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  const currentTab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  switch (message.type) {
    case 'startDrawing': // Send message to the injected script to start drawing
      if (!injectedTabs.includes(currentTab)) {
        injectedTabs.push(currentTab);
        chrome.scripting.executeScript({
          target: { tabId: currentTab },
          files: ['injected.js'],
        });
        chrome.scripting.insertCSS({
          target: { tabId: currentTab },
          files: ['injected.css'],
        });
        chrome.tabs.sendMessage(currentTab, { type: 'startDrawing', response: 'success' }, (response) => {
          sendResponse(response);
        });
      } else {
        chrome.tabs.sendMessage(currentTab, { type: 'startDrawing', response: 'duplicate' }, (response) => {
          sendResponse(response);
        });
      }
    case 'stopCapture':
  }
});