// offscreen.js (minor changes for clarity, core logic remains for offscreen mode)
import { predict, loadModel, detect } from "./utils/modelHelpers.mjs";
import { getItemFromDB } from "./utils/indexedDB.mjs";

console.log("Offscreen script loaded");

const video = document.createElement('video');
const offscreenCanvas = new OffscreenCanvas(0, 0); // Initialize with 0,0
const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

let stream = null;
let rect = { x: 0, y: 0, width: 0, height: 0 };
let sendframesstatus = false;
let targetTabId = null;
let isPredicting = false;
let modelLoaded = null;
let modelDetails = null; // Will be fetched from IndexedDB

// Default window dimensions, will be updated
let windowHeight = 720; 
let windowWidth = 1280;
let layoutWidth = null;
let layoutHeight = null;
let lastFrameTime = performance.now();
let fps = 0;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log("[Offscreen] Message received:", message);
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'releaseStream':
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }
      video.pause();
      video.srcObject = null;
      sendframesstatus = false; // Stop frame capture as well
      console.log("[Offscreen] Stream released");
      break;

    case 'loadModel':
      // Always fetch the latest model details from DB when asked to load
      modelDetails = await getItemFromDB('modelDetails');
      if (!modelDetails) {
        console.error("[Offscreen] Model details not found in DB. Cannot load model.");
        modelLoaded = null;
        return;
      }
      console.log("[Offscreen] Loading model with details:", modelDetails);
      try {
        modelLoaded = await loadModel(modelDetails.modelType); // Pass modelType if your loadModel needs it
        console.log("[Offscreen] Model loaded successfully");
      } catch (err) {
        console.error("[Offscreen] Failed to load model:", err);
        modelLoaded = null;
      }
      break;

    case 'start-frameCapture':
      if (!modelLoaded) {
        console.warn("[Offscreen] Model not loaded. Cannot start frame capture.");
        // Optionally, try to load it now
        // await new Promise(resolve => chrome.runtime.sendMessage({type: 'loadModel', target: 'offscreen'}, resolve));
        // if (!modelLoaded) return; // if still not loaded, exit
        return;
      }
      if (!stream) {
        console.warn("[Offscreen] Stream not available. Cannot start frame capture.");
        return;
      }
      sendframesstatus = true;
      video.srcObject = stream; // Ensure srcObject is set if it was cleared
      await video.play().catch(e => console.error("Error playing video:", e));
      console.log("[Offscreen] Frame capture started.");
      break;

    case 'stop-frameCapture':
      sendframesstatus = false;
      // video.pause(); // Don't pause, stream might still be needed for other tabs
      // video.srcObject = null; // Don't nullify, stream might be active
      console.log("[Offscreen] Frame capture stopped.");
      break;

    case 'rectUpdate':
      rect = message.rect;
      layoutWidth = message.layoutSize?.width;
      layoutHeight = message.layoutSize?.height;
      break;

    case 'streamStart':
      console.log("[Offscreen] streamStart received for tab:", message.targetTabId);
      targetTabId = message.targetTabId; // Keep track of which tab this stream is for
      
      // Release previous stream if any
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      
      try {
        // GetUserMedia with a streamId can only be called from an offscreen document
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: message.streamId,
              minWidth: windowWidth, // Use captured window dimensions
              minHeight: windowHeight,
              maxWidth: windowWidth,
              maxHeight: windowHeight,
            },
          },
        });
        console.log("[Offscreen] New stream acquired for tab:", targetTabId);
        video.srcObject = stream;
        await video.play().catch(e => console.error("Error playing video:", e));
        // Do not automatically start frame capture here; wait for 'start-frameCapture'
      } catch (error) {
        console.error('[Offscreen] Error accessing media devices for streamStart:', error);
        stream = null; // Ensure stream is null if it failed
        return;
      }
      break;

    case 'windowResize': // These are from the content script of the target tab
      windowHeight = message.windowHeight;
      windowWidth = message.windowWidth;
      // Update video element dimensions if it's playing from this stream
      if (video.srcObject === stream && stream) { // check if current stream is active on video
        video.width = video.videoWidth > 0 ? video.videoWidth : windowWidth;
        video.height = video.videoHeight > 0 ? video.videoHeight : windowHeight;
      }
      console.log("[Offscreen] Window resized from content script:", windowHeight, windowWidth);
      break;
  }
});

let frameInterval = null;

video.addEventListener('loadedmetadata', () => {
    // Set canvas dimensions once metadata is loaded
    video.width = video.videoWidth;
    video.height = video.videoHeight;
    console.log(`[Offscreen] Video metadata loaded: ${video.videoWidth}x${video.videoHeight}`);
});

video.addEventListener('play', () => {
  if (video.videoWidth && video.videoHeight) {
      video.width = video.videoWidth;
      video.height = video.videoHeight;
  } else {
      // Fallback if metadata not yet loaded, though 'loadedmetadata' should handle this
      video.width = windowWidth; 
      video.height = windowHeight;
  }
  console.log('[Offscreen] Video playing, dimensions:', video.width, 'x', video.height);
  if (!frameInterval) {
    frameInterval = setInterval(drawToCanvas, 1000 / 30); // Target 30 FPS
  }
});

video.addEventListener('pause', () => {
  if (frameInterval) {
    clearInterval(frameInterval);
    frameInterval = null;
    console.log('[Offscreen] Video paused, frame interval cleared.');
  }
});

// let previousImageDataHash = null; // Hashing can be performance intensive

async function drawToCanvas() {
  if (!sendframesstatus || isPredicting || !modelLoaded || !layoutWidth || !layoutHeight || !video.srcObject || video.paused || video.ended || video.videoWidth === 0) {
    // console.log("Skipping drawToCanvas", {sendframesstatus, isPredicting, modelLoaded, layoutWidth, layoutHeight, srcObject: video.srcObject, paused: video.paused, ended: video.ended, videoWidth: video.videoWidth});
    return;
  }

  const now = performance.now();
  const delta = now - lastFrameTime;
  if (delta > 0) {
    fps = Math.round(1000 / delta);
  }
  lastFrameTime = now;
  isPredicting = true;

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  // Scale DOM rect into normalized % coordinates based on content script's layout size
  const xRatio = rect.x / layoutWidth;
  const yRatio = rect.y / layoutHeight;
  const widthRatio = rect.width / layoutWidth;
  const heightRatio = rect.height / layoutHeight;

  // Map those %s into video coordinates
  const sx = xRatio * vw;
  const sy = yRatio * vh;
  const sw = widthRatio * vw;
  const sh = heightRatio * vh;

  if (sw <= 0 || sh <= 0) {
    // console.warn("[Offscreen] Skipping due to zero/negative crop size", {sx, sy, sw, sh});
    isPredicting = false;
    return;
  }

  offscreenCanvas.width = Math.max(1, Math.floor(sw));
  offscreenCanvas.height = Math.max(1, Math.floor(sh));

  try {
    ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
  } catch (e) {
    console.error("[Offscreen] Error drawing video to canvas:", e, {sx, sy, sw, sh, vw, vh, cw: offscreenCanvas.width, ch: offscreenCanvas.height});
    isPredicting = false;
    return;
  }


  const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);

  try {
    let predictions;
    if (modelDetails.inferenceTask === 'detection') {
      // console.log("[Offscreen] Running detection");
      predictions = await detect(modelLoaded, imageData, modelDetails);
    } else {
      // classification
      predictions = await predict(modelLoaded, imageData, modelDetails.inputShape, 5);
    }
    
    // Only send if we still have a targetTabId (e.g., tab wasn't closed)
    if (targetTabId) {
        chrome.runtime.sendMessage({
          type: 'predictions',
          predictions,
          imageData: { // Sending raw data can be slow, consider alternatives if perf is an issue
            data: Array.from(imageData.data),
            width: imageData.width,
            height: imageData.height,
          },
          target: 'worker', // Send to service worker to relay
          targetTabId,
          fps,
        });
    }
  } catch (error) {
    console.error("[Offscreen] Prediction error:", error);
  }

  isPredicting = false;
}

// Hashing function (optional, can be resource-intensive)
/*
function hashImageData(data) {
  let hash = 0;
  for (let i = 0; i < data.length; i+=400) { // Sample pixels for performance
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0;
  }
  return hash;
}
*/
console.log("[Offscreen] Script fully parsed and event listeners ready.");