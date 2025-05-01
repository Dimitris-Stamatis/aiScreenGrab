import { predict, loadModel, detect } from "./utils/modelHelpers.mjs";
import { getItemFromDB } from "./utils/indexedDB.mjs";

console.log("Offscreen script loaded");

const video = document.createElement('video');
const offscreenCanvas = new OffscreenCanvas(0, 0);
const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

let stream = null;
let rect = { x: 0, y: 0, width: 0, height: 0 };
let sendframesstatus = false;
let targetTabId = null;
let isPredicting = false;
let modelLoaded = null;
let modelDetails = null;
let windowHeight = null;
let windowWidth = null;
let layoutWidth = null;
let layoutHeight = null;
let lastFrameTime = performance.now();
let fps = 0;

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
      layoutWidth = message.layoutSize?.width;
      layoutHeight = message.layoutSize?.height;
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
                minWidth: windowWidth,
                minHeight: windowHeight,
                height: windowHeight,
                width: windowWidth,
                maxWidth: windowWidth,
                maxHeight: windowHeight,
              },
            },
          });
          console.log("[Offscreen] minWidth:", windowWidth);
          console.log("[Offscreen] minHeight:", windowHeight);
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
    case 'windowResize':
      windowHeight = message.windowHeight;
      windowWidth = message.windowWidth;
      console.log("[Offscreen] Window resized:", windowHeight, windowWidth);
      break;
  }
});

let frameInterval = null;

video.addEventListener('play', () => {
  video.width = windowWidth;
  video.height = windowHeight;
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
  if (!sendframesstatus || isPredicting || !modelLoaded || !layoutWidth || !layoutHeight) return;

  const now = performance.now();
  fps = Math.round(1000 / (now - lastFrameTime));
  lastFrameTime = now;
  isPredicting = true;

  // Scale DOM rect into normalized % coordinates
  const xRatio = rect.x / layoutWidth;
  const yRatio = (rect.y) / layoutHeight;
  const widthRatio = rect.width / layoutWidth;
  const heightRatio = rect.height / layoutHeight;

  // Map those %s into video coordinates
  const sx = xRatio * video.videoWidth;
  const sy = yRatio * video.videoHeight;
  const sw = widthRatio * video.videoWidth;
  const sh = heightRatio * video.videoHeight;

  if (sw <= 0 || sh <= 0) {
    console.warn("[Offscreen] Skipping due to zero size", sw, sh);
    isPredicting = false;
    return;
  }

  offscreenCanvas.width = sw;
  offscreenCanvas.height = sh;

  ctx.clearRect(0, 0, sw, sh);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

  const imageData = ctx.getImageData(0, 0, sw, sh);

  console.log("[Offscreen] Layout size:", layoutWidth, layoutHeight);
  console.log("[Offscreen] Video size:", video.videoWidth, video.videoHeight);
  console.log("[Offscreen] Cropping video at:", sx, sy, sw, sh);

  const currentImageDataHash = hashImageData(imageData.data);
  if (currentImageDataHash === previousImageDataHash) {
    isPredicting = false;
    return;
  }
  previousImageDataHash = currentImageDataHash;

  try {
    let predictions;
    if (modelDetails.inferenceTask === 'detection') {
      console.log("[Offscreen] Running detection");
      predictions = await detect(
        modelLoaded,
        imageData,
        modelDetails.inputShape,
        {
          scoreThreshold: modelDetails.scoreThreshold,
          maxDetections: modelDetails.maxDetections
        }
      );
    } else {
      // classification
      predictions = await predict(modelLoaded, imageData, modelDetails.inputShape, 5);
    }
    chrome.runtime.sendMessage({
      type: 'predictions',
      predictions,
      imageData: {
        data: Array.from(imageData.data),
        width: imageData.width,
        height: imageData.height,
      },
      target: 'worker',
      targetTabId,
      fps,
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
