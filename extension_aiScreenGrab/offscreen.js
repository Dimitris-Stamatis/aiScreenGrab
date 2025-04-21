import { predict, loadModel } from "./utils/modelHelpers.mjs";
import { getItemFromDB } from "./utils/indexedDB.mjs";

console.log("Offscreen script loaded");

const video = document.createElement('video');
const offscreenCanvas = new OffscreenCanvas(0, 0);
const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

let stream = null;
let rect = { x: 0, y: 0, width: 0, height: 0 };
let yoffset = 0;
let sendframesstatus = false;
let targetTabId = null;
let isPredicting = false;
let modelLoaded = null;
let modelDetails = null;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log("[Offscreen] Message received:", message);
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'releaseStream':
      stream = null;
      video.pause();
      video.srcObject = null;
      break;

    case 'loadModel':
      modelDetails = message.modelDetails || await getItemFromDB('modelDetails');
      console.log("[Offscreen] Loading model with details:", modelDetails);

      try {
        modelLoaded = await loadModel(modelDetails.modelType);
        console.log("[Offscreen] Model loaded successfully");
      } catch (err) {
        console.error("[Offscreen] Failed to load model:", err);
      }
      break;

    case 'start-frameCapture':
      sendframesstatus = true;
      video.srcObject = stream;
      await video.play();
      break;

    case 'stop-frameCapture':
      sendframesstatus = false;
      video.pause();
      video.srcObject = null;
      break;

    case 'rectUpdate':
      rect = message.rect;
      yoffset = message.yoffset;
      offscreenCanvas.width = rect.width;
      offscreenCanvas.height = rect.height;
      break;
    case 'streamStart':
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: "tab",
                chromeMediaSourceId: message.streamId,
              },
            },
          });
        } catch (error) {
          console.error('Error accessing media devices:', error);
          return;
        }
      }
      video.srcObject = stream;
      video.play();
      targetTabId = message.targetTabId;
      console.log("[Offscreen] Stream started for tab:", targetTabId);
      break;
  }
});

let frameInterval = null;

video.addEventListener('play', () => {
  console.log('Video playing');
  if (!frameInterval) {
    frameInterval = setInterval(drawToCanvas, 1000 / 30);
  }
});

video.addEventListener('pause', () => {
  if (frameInterval) {
    clearInterval(frameInterval);
    frameInterval = null;
  }
});

let previousImageDataHash = null;

async function drawToCanvas() {
  console.log("[Offscreen] Drawing to canvas");
  if (!sendframesstatus || isPredicting || !modelLoaded) return;

  isPredicting = true;

  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.drawImage(
    video,
    rect.x,
    rect.y + yoffset,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height
  );

  const imageData = ctx.getImageData(0, 0, rect.width, rect.height);
  const currentImageDataHash = hashImageData(imageData.data);

  if (currentImageDataHash === previousImageDataHash) {
    isPredicting = false;
    return;
  }

  console.log("[Offscreen] Image data hash changed:", currentImageDataHash);
  previousImageDataHash = currentImageDataHash;

  try {
    const predictions = await predict(modelLoaded, imageData, modelDetails.inputShape, 5);
    console.log("[Offscreen] Predictions:", predictions);
    chrome.runtime.sendMessage({
      type: 'predictions',
      predictions,
      imageData: {
        data: Array.from(imageData.data),
        width: imageData.width,
        height: imageData.height,
      },
      target: 'worker',
      targetTabId
    });
  } catch (error) {
    console.error("[Offscreen] Prediction error:", error);
  }

  isPredicting = false;
}

function hashImageData(data) {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0;
  }
  return hash;
}
