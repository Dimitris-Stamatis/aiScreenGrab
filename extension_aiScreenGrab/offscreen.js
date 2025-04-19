import { model } from "@tensorflow/tfjs-layers";
import { predict, loadModel } from "./utils/modelHelpers.mjs";
import { startForAxis } from "@tensorflow/tfjs-core/dist/ops/slice_util";

const video = document.createElement('video');
// Create an OffscreenCanvas
const offscreenCanvas = new OffscreenCanvas(0, 0); // Adjust size as needed
const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
let stream = null;
let rect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0
};
let yoffset = 0;
let sendframesstatus = false;
let targetTabId = null;
let isPredicting = false;
let modelLoaded = null;
let modelDetails = null;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  switch (message.type) {
    case 'releaseStream':
      stream = null;
      video.pause();
      video.srcObject = null;
      break;
    case 'loadModel':
      modelDetails = message.modelDetails;
      modelLoaded = message.modelLoaded;
      console.log('Model loaded:', modelLoaded);
      break;
    case 'start-frameCapture':
      if (stream == null) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: message.streamId,
            },
          },
        }).catch((error) => {
          console.error('Error accessing media devices:', error);
        });
      }
      sendframesstatus = true;
      video.srcObject = stream;
      targetTabId = message.targetTabId;
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
  }
});

let frameInterval = null;

video.addEventListener('play', () => {
  console.log('Video playing');
  if (!frameInterval) {
    frameInterval = setInterval(drawToCanvas, 1000 / 30); // max 30 FPS
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
  if (!sendframesstatus) return;
  if (isPredicting) return; // Prevent overlapping predictions
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
    // Frame hasn't changed; skip sending
    isPredicting = false;
    return;
  }

  previousImageDataHash = currentImageDataHash;

  let predictions = await predict(modelLoaded, imageData, modelDetails.inputShape);
  isPredicting = false;
  console.log(predictions);
  chrome.tabs.sendMessage(targetTabId, {
    type: 'predictions',
    predictions,
    imageData: {
      data: Array.from(imageData.data),
      width: imageData.width,
      height: imageData.height,
    },
  });
}

// --- Utility: Simple Hash Function for Image Data ---
function hashImageData(data) {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}