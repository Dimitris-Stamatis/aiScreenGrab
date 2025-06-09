// offscreen.js
import { predict, loadModel, detect } from "./utils/modelHelpers.mjs";

console.log("Offscreen script loaded");

const video = document.createElement('video');
const offscreenCanvas = new OffscreenCanvas(0, 0);
const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

let stream = null;
let rect = { x: 0, y: 0, width: 0, height: 0 };
let sendframesstatus = false;
let targetTabId = null; // The tabId this offscreen document is currently serving
let isPredictingLock = false;
let modelLoaded = null;
let modelDetails = null;

let windowHeight = 720;
let windowWidth = 1280;
let layoutWidth = null;
let layoutHeight = null;
let lastFrameTime = performance.now();
let fps = 0;
let frameInterval = null;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log("[Offscreen] Message received:", message);
  if (message.target !== 'offscreen') return true; // Allow other listeners to process if not for offscreen

  switch (message.type) {
    case 'releaseStream':
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }
      video.pause();
      video.srcObject = null;
      sendframesstatus = false;
      if (frameInterval) {
        clearInterval(frameInterval);
        frameInterval = null;
      }
      console.log("[Offscreen] Stream released");
      break;

    case 'loadModel':
      if (!message.modelDetails) {
          console.error("[Offscreen] Model details not provided in 'loadModel' message.");
          modelLoaded = null;
          // Optionally send an error metric back
          return;
      }
      modelDetails = message.modelDetails;
      console.log("[Offscreen] Loading model with details:", modelDetails);
      const modelLoadStartTime = performance.now();
      try {
        // Ensure loadModel uses a consistent property like inferenceTask
        modelLoaded = await loadModel(modelDetails.inferenceTask || modelDetails.modelType);
        const modelLoadEndTime = performance.now();
        if (modelLoaded) {
          console.log("[Offscreen] Model loaded successfully");
          chrome.runtime.sendMessage({
            target: 'worker',
            type: 'recordPerformanceMetric',
            metric: {
              // timestamp: Date.now(), // SW will add this
              type: 'modelLoad',
              location: 'offscreen',
              durationMs: parseFloat((modelLoadEndTime - modelLoadStartTime).toFixed(2)),
              modelType: modelDetails.inferenceTask || 'unknown'
            }
          }).catch(e => console.warn("Error sending modelLoad metric:", e.message));
        } else {
             console.error("[Offscreen] Model loading returned null/undefined.");
             // Send error metric
             chrome.runtime.sendMessage({
                target: 'worker',
                type: 'recordPerformanceMetric',
                metric: {
                  type: 'modelLoadError',
                  location: 'offscreen',
                  error: 'Model loading returned null/undefined',
                  modelType: modelDetails.inferenceTask || 'unknown',
                }
             }).catch(e => console.warn("Error sending modelLoadError metric:", e.message));
        }
      } catch (err) {
        const modelLoadEndTime = performance.now();
        console.error("[Offscreen] Failed to load model:", err);
        modelLoaded = null;
        chrome.runtime.sendMessage({
            target: 'worker',
            type: 'recordPerformanceMetric',
            metric: {
              type: 'modelLoadError',
              location: 'offscreen',
              durationMs: parseFloat((modelLoadEndTime - modelLoadStartTime).toFixed(2)), // Time until error
              modelType: modelDetails?.inferenceTask || 'unknown',
              error: err.message
            }
          }).catch(e => console.warn("Error sending modelLoadError metric:", e.message));
      }
      break;

    case 'start-frameCapture':
      if (!modelLoaded) {
        console.warn("[Offscreen] Model not loaded. Cannot start frame capture.");
        return;
      }
      if (!stream) {
        console.warn("[Offscreen] Stream not available. Cannot start frame capture.");
        return;
      }
      // If a new frame capture is for a different tab, update targetTabId
      if (message.targetTabId && message.targetTabId !== targetTabId) {
          console.log(`[Offscreen] Frame capture targetTabId changed from ${targetTabId} to ${message.targetTabId}`);
          targetTabId = message.targetTabId; // Update the target tab
      } else if (!targetTabId && message.targetTabId) {
          targetTabId = message.targetTabId; // Set if initially null
      }


      sendframesstatus = true;
      if (video.srcObject !== stream) video.srcObject = stream;
      if (video.paused) {
          video.play().catch(e => console.error("Error playing video for frame capture:", e));
      }
      console.log("[Offscreen] Frame capture started for tab:", targetTabId);
      // Interval starting is handled by video 'play' and 'loadedmetadata' events
      // but ensure it starts if video is already playing
      if (!frameInterval && video.readyState >= video.HAVE_METADATA && !video.paused) {
        frameInterval = setInterval(drawToCanvas, 1000 / 30);
      }
      break;

    case 'stop-frameCapture':
      console.log("[Offscreen] Received stop-frameCapture. Stopping frames for current target:", targetTabId);
      sendframesstatus = false;
      if (frameInterval) {
        clearInterval(frameInterval);
        frameInterval = null;
      }
      // Don't pause video, as it might be a global stop, not tab specific.
      // The stream itself is managed by 'releaseStream' or new 'streamStart'.
      break;

    case 'stop-frameCaptureForTab': // New handler
      if (message.targetTabId && message.targetTabId === targetTabId) {
        console.log(`[Offscreen] Received stop-frameCaptureForTab for current targetTabId ${targetTabId}. Stopping frames.`);
        sendframesstatus = false; // Stop sending frames for this specific tab
        if (frameInterval) {
          clearInterval(frameInterval);
          frameInterval = null;
        }
        // We don't nullify targetTabId here, as the stream might still be for this tab,
        // but we just stop processing frames. A new 'start-frameCapture' would resume.
      } else {
        console.log(`[Offscreen] Received stop-frameCaptureForTab for tab ${message.targetTabId}, but current target is ${targetTabId}. No action.`);
      }
      break;

    case 'rectUpdate':
      rect = message.rect;
      layoutWidth = message.layoutSize?.width;
      layoutHeight = message.layoutSize?.height;
      break;

    case 'streamStart':
      console.log("[Offscreen] streamStart received for tab:", message.targetTabId);
      // This is a critical point: a new stream is starting, potentially for a new tab.
      // Stop any ongoing frame capture for the old tab.
      if (sendframesstatus || frameInterval) {
          console.log(`[Offscreen] New stream starting for tab ${message.targetTabId}. Stopping previous frame capture for tab ${targetTabId}.`);
          sendframesstatus = false;
          if (frameInterval) {
              clearInterval(frameInterval);
              frameInterval = null;
          }
      }
      targetTabId = message.targetTabId; // Update to the new target tab
      
      if (stream) { // Release any existing stream before getting a new one
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }
      
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: message.streamId,
              minWidth: windowWidth, // Consider if these defaults are always best
              minHeight: windowHeight,
              maxWidth: windowWidth,
              maxHeight: windowHeight,
            },
          },
        });
        console.log("[Offscreen] New stream acquired for tab:", targetTabId);
        video.srcObject = stream;
        // Video play will be triggered by 'start-frameCapture' or video event listeners.
        // If video was playing from an old stream, it will pause/reset here.
      } catch (error) {
        console.error('[Offscreen] Error accessing media devices for streamStart:', error);
        stream = null;
        targetTabId = null; // Reset targetTabId if stream acquisition fails
      }
      break;

    case 'windowResize':
      windowWidth = message.windowWidth;
      windowHeight = message.windowHeight;
      console.log("[Offscreen] Window resized hint from content script:", windowHeight, windowWidth);
      break;
    
    default:
      console.warn("[Offscreen] Unknown message type received:", message.type);
  }
  return true; // Keep message channel open for async responses if any specific cases need it.
});


video.addEventListener('loadedmetadata', () => {
    video.width = video.videoWidth;
    video.height = video.videoHeight;
    console.log(`[Offscreen] Video metadata loaded: ${video.videoWidth}x${video.videoHeight}`);
    if (sendframesstatus && !frameInterval && !video.paused) {
        console.log("[Offscreen] Starting frame interval after loadedmetadata (video playing).");
        frameInterval = setInterval(drawToCanvas, 1000 / 30);
    }
});

video.addEventListener('play', () => {
  if (video.videoWidth && video.videoHeight) {
      video.width = video.videoWidth;
      video.height = video.videoHeight;
  }
  console.log('[Offscreen] Video playing, dimensions:', video.width, 'x', video.height);
  if (sendframesstatus && !frameInterval) {
    frameInterval = setInterval(drawToCanvas, 1000 / 30);
    console.log('[Offscreen] Frame interval started on video play.');
  }
});

video.addEventListener('pause', () => {
  if (frameInterval) {
    clearInterval(frameInterval);
    frameInterval = null;
    console.log('[Offscreen] Video paused, frame interval cleared.');
  }
});


async function drawToCanvas() {
  if (!sendframesstatus || isPredictingLock || !modelLoaded || !modelDetails || !targetTabId ||
      !layoutWidth || !layoutHeight || !video.srcObject || video.paused || video.ended || video.videoWidth === 0) {
    // console.log("Skipping drawToCanvas due to conditions", {sendframesstatus, isPredictingLock, modelLoaded, modelDetails, targetTabId, videoReady: video.videoWidth > 0});
    return;
  }

  isPredictingLock = true;
  const frameProcessStartTime = performance.now();

  const now = performance.now();
  const delta = now - lastFrameTime;
  if (delta > 0) {
    fps = Math.round(1000 / delta);
  }
  lastFrameTime = now;

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  const xRatio = rect.x / layoutWidth;
  const yRatio = rect.y / layoutHeight;
  const widthRatio = rect.width / layoutWidth;
  const heightRatio = rect.height / layoutHeight;

  const sx = xRatio * vw;
  const sy = yRatio * vh;
  const sw = widthRatio * vw;
  const sh = heightRatio * vh;

  if (sw <= 0 || sh <= 0 || isNaN(sw) || isNaN(sh)) {
    // console.warn("[Offscreen] Skipping drawToCanvas due to invalid crop dimensions:", {sx, sy, sw, sh});
    isPredictingLock = false;
    return;
  }

  offscreenCanvas.width = Math.max(1, Math.floor(sw));
  offscreenCanvas.height = Math.max(1, Math.floor(sh));

  try {
    ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
  } catch (e) {
    console.error("[Offscreen] Error drawing video to canvas:", e, {sx, sy, sw, sh, vw, vh, cw: offscreenCanvas.width, ch: offscreenCanvas.height});
    isPredictingLock = false;
    return;
  }

  const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  let predictions;
  const inferenceStartTime = performance.now();

  try {
    if (modelDetails.inferenceTask === 'detection') {
      predictions = await detect(modelLoaded, imageData, modelDetails);
    } else { // classification
      predictions = await predict(modelLoaded, imageData, modelDetails.inputShape, 5);
    }
    const inferenceEndTime = performance.now();
    const inferenceDurationMs = parseFloat((inferenceEndTime - inferenceStartTime).toFixed(2));
    const totalFrameProcessingMs = parseFloat((inferenceEndTime - frameProcessStartTime).toFixed(2));

    // Check if we should still send predictions for this targetTabId
    if (sendframesstatus && targetTabId) {
      chrome.runtime.sendMessage({
        target: 'worker',
        type: 'recordPerformanceMetric',
        metric: {
          // timestamp: Date.now(), // SW adds this
          type: 'inference',
          location: 'offscreen',
          durationMs: inferenceDurationMs,
          totalFrameProcessingMs: totalFrameProcessingMs,
          fps: fps,
          modelType: modelDetails.inferenceTask,
          inputWidth: offscreenCanvas.width,
          inputHeight: offscreenCanvas.height,
          tabId: targetTabId // Add tabId to inference metric
        }
      }).catch(e => console.warn("Error sending inference metric:", e.message));

      chrome.runtime.sendMessage({
        type: 'predictions',
        predictions,
        imageData: { 
          data: Array.from(imageData.data), // Consider alternatives if this is a bottleneck
          width: imageData.width,
          height: imageData.height,
        },
        target: 'worker', // Relay through service worker
        targetTabId,      // Specify which tab this is for
        fps,
      }).catch(e => console.warn("Error sending predictions to worker:", e.message));
    }
  } catch (error) {
    const inferenceEndTime = performance.now();
    console.error("[Offscreen] Prediction error:", error);
    // Check if we should still send error metric
    if (targetTabId) {
        chrome.runtime.sendMessage({
            target: 'worker',
            type: 'recordPerformanceMetric',
            metric: {
            // timestamp: Date.now(), // SW adds this
            type: 'inferenceError',
            location: 'offscreen',
            durationMs: parseFloat((inferenceEndTime - inferenceStartTime).toFixed(2)),
            modelType: modelDetails.inferenceTask,
            inputWidth: offscreenCanvas.width,
            inputHeight: offscreenCanvas.height,
            error: error.message,
            stack: error.stack, // Include stack for better debugging
            fps: fps,
            tabId: targetTabId // Add tabId to error metric
            }
        }).catch(e => console.warn("Error sending inferenceError metric:", e.message));
    }
  } finally {
    isPredictingLock = false;
  }
}

console.log("[Offscreen] Script fully parsed and event listeners ready.");