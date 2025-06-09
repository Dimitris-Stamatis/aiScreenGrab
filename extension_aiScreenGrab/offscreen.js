// offscreen.js
import { predict, loadModel, detect } from "./utils/modelHelpers.mjs";

console.log("Offscreen script loaded");

const video = document.createElement('video');
const offscreenCanvas = new OffscreenCanvas(0, 0);
const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

// --- State Management ---
let stream = null;
let rect = { x: 0, y: 0, width: 0, height: 0 };
let modelLoaded = null;
let modelDetails = null;
let targetTabId = null;

// --- Loop Control ---
let sendframesstatus = false; // Master switch to enable/disable the loop
let isLoopRunning = false;  // A lock to prevent multiple loops from starting

let windowHeight = 720;
let windowWidth = 1280;
let layoutWidth = null;
let layoutHeight = null;
let lastFrameTime = performance.now();
let fps = 0;

// --- Message Handling ---
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log("[Offscreen] Message received:", message);
  if (message.target !== 'offscreen') return true;

  switch (message.type) {
    case 'releaseStream':
      sendframesstatus = false; // Command the loop to stop
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }
      video.pause();
      video.srcObject = null;
      console.log("[Offscreen] Stream released");
      break;

    case 'loadModel':
      modelDetails = message.modelDetails;
      if (!modelDetails) {
          console.error("[Offscreen] Model details not provided.");
          modelLoaded = null;
          return;
      }
      console.log("[Offscreen] Loading model:", modelDetails);
      const modelLoadStartTime = performance.now();
      try {
        modelLoaded = await loadModel(modelDetails.inferenceTask || modelDetails.modelType);
        const modelLoadEndTime = performance.now();
        console.log("[Offscreen] Model loaded successfully.");
        // **** MODIFICATION: Send model load metric from here ****
        chrome.runtime.sendMessage({
          target: 'worker',
          type: 'recordPerformanceMetric',
          metric: {
            type: 'modelLoad',
            location: 'offscreen',
            durationMs: parseFloat((modelLoadEndTime - modelLoadStartTime).toFixed(2)),
            modelType: modelDetails.inferenceTask || 'unknown'
          }
        }).catch(e => console.warn("Error sending modelLoad metric:", e.message));
      } catch (err) {
        const modelLoadEndTime = performance.now();
        console.error("[Offscreen] Failed to load model:", err);
        chrome.runtime.sendMessage({
            target: 'worker',
            type: 'recordPerformanceMetric',
            metric: {
              type: 'modelLoadError',
              location: 'offscreen',
              durationMs: parseFloat((modelLoadEndTime - modelLoadStartTime).toFixed(2)),
              modelType: modelDetails?.inferenceTask || 'unknown',
              error: err.message
            }
          }).catch(e => console.warn("Error sending modelLoadError metric:", e.message));
        modelLoaded = null;
      }
      break;

    case 'start-frameCapture':
      if (!modelLoaded || !stream) {
        console.warn("[Offscreen] Cannot start: Model or stream not ready.");
        return;
      }
      if (message.targetTabId) {
        targetTabId = message.targetTabId;
      }
      
      sendframesstatus = true; // Enable the loop
      
      console.log("[Offscreen] Frame capture requested for tab:", targetTabId);
      if (!isLoopRunning) {
        predictionLoop();
      }

      if (video.paused) {
          video.play().catch(e => console.error("Error playing video:", e));
      }
      break;

    case 'stop-frameCapture':
    case 'stop-frameCaptureForTab':
      console.log(`[Offscreen] Received ${message.type}. Commanding loop to stop.`);
      sendframesstatus = false;
      break;

    case 'rectUpdate':
      rect = message.rect;
      layoutWidth = message.layoutSize?.width;
      layoutHeight = message.layoutSize?.height;
      break;

    case 'streamStart':
      console.log("[Offscreen] streamStart received for tab:", message.targetTabId);
      sendframesstatus = false; 
      targetTabId = message.targetTabId;
      
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: message.streamId,
            },
          },
        });
        video.srcObject = stream;
        console.log("[Offscreen] New stream acquired.");
      } catch (error) {
        console.error('[Offscreen] Error getting new stream:', error);
        stream = null;
        targetTabId = null;
      }
      break;
    
    default:
      console.warn("[Offscreen] Unknown message type:", message.type);
  }
  return true;
});


// --- Video Event Listeners ---
video.addEventListener('loadedmetadata', () => {
    video.width = video.videoWidth;
    video.height = video.videoHeight;
    console.log(`[Offscreen] Video metadata: ${video.width}x${video.height}`);
});

video.addEventListener('pause', () => {
  console.log('[Offscreen] Video paused, ensuring prediction loop stops.');
  sendframesstatus = false;
});


// --- Core Prediction Loop ---

async function predictionLoop() {
  console.log("[Offscreen] Prediction loop starting.");
  isLoopRunning = true;

  try {
    while (sendframesstatus) {
      await processFrame();
    }
  } catch (error) {
    console.error("[Offscreen] A critical error occurred in the prediction loop:", error);
  } finally {
    isLoopRunning = false;
    console.log("[Offscreen] Prediction loop has fully stopped.");
  }
}

async function processFrame() {
  if (!modelLoaded || !video.srcObject || video.paused || video.videoWidth === 0) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return;
  }
  
  // --- Performance Timers ---
  const frameProcessStartTime = performance.now();

  const now = performance.now();
  fps = Math.round(1000 / (now - lastFrameTime));
  lastFrameTime = now;

  // --- Canvas & Cropping Logic ---
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sx = (rect.x / layoutWidth) * vw;
  const sy = (rect.y / layoutHeight) * vh;
  const sw = (rect.width / layoutWidth) * vw;
  const sh = (rect.height / layoutHeight) * vh;

  if (sw <= 1 || sh <= 1) return;

  offscreenCanvas.width = Math.floor(sw);
  offscreenCanvas.height = Math.floor(sh);

  const drawStartTime = performance.now();
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
  const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  const prepareEndTime = performance.now();
  
  // --- Model Prediction ---
  const inferenceStartTime = performance.now();
  try {
    let predictions;
    if (modelDetails.inferenceTask === 'detection') {
      predictions = await detect(modelLoaded, imageData, modelDetails);
    } else {
      predictions = await predict(modelLoaded, imageData, modelDetails.inputShape, 5);
    }
    const inferenceEndTime = performance.now();

    if (sendframesstatus && targetTabId) {
      // **** MODIFICATION: Granular performance metrics ****
      const framePreparationMs = parseFloat((prepareEndTime - drawStartTime).toFixed(2));
      const inferenceDurationMs = parseFloat((inferenceEndTime - inferenceStartTime).toFixed(2));
      
      // Send predictions to the content script
      chrome.runtime.sendMessage({
        type: 'predictions',
        predictions,
        target: 'worker',
        targetTabId,
        fps,
      }).catch(e => { /* Ignore errors if the receiver is gone */ });
      
      const messageSentTime = performance.now();
      const totalFrameProcessingMs = parseFloat((messageSentTime - frameProcessStartTime).toFixed(2));
      const postProcessingMs = parseFloat((messageSentTime - inferenceEndTime).toFixed(2));

      // Send detailed metrics to the service worker for logging
      chrome.runtime.sendMessage({
        target: 'worker',
        type: 'recordPerformanceMetric',
        metric: {
          type: 'inference',
          location: 'offscreen',
          modelType: modelDetails.inferenceTask,
          // Granular Timings
          totalFrameProcessingMs,
          framePreparationMs,
          inferenceDurationMs,
          postProcessingMs,
          // Context
          inputWidth: offscreenCanvas.width,
          inputHeight: offscreenCanvas.height,
          fps: fps,
          tabId: targetTabId
        }
      }).catch(e => console.warn("Error sending inference metric:", e.message));
    }
  } catch (error) {
    const errorTime = performance.now();
    console.error("[Offscreen] Prediction error on a frame:", error);
    // **** MODIFICATION: Send detailed error metric ****
    chrome.runtime.sendMessage({
      target: 'worker',
      type: 'recordPerformanceMetric',
      metric: {
        type: 'inferenceError',
        location: 'offscreen',
        modelType: modelDetails.inferenceTask,
        durationUntilErrorMs: parseFloat((errorTime - inferenceStartTime).toFixed(2)),
        error: error.message,
        stack: error.stack,
        inputWidth: offscreenCanvas.width,
        inputHeight: offscreenCanvas.height,
        fps: fps,
        tabId: targetTabId
      }
    }).catch(e => console.warn("Error sending inferenceError metric:", e.message));
  }
}

console.log("[Offscreen] Script fully parsed and ready.");