// offscreen.js test
import { predict, loadModel, detect } from "./utils/modelHelpers.mjs";

console.log("Offscreen script loaded");

const video = document.createElement('video');
const offscreenCanvas = new OffscreenCanvas(0, 0); // This will hold the FINAL cropped image for the model
const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

// --- MODIFICATION: The second canvas for downscaling ---
const viewportCanvas = new OffscreenCanvas(1, 1); // This will hold the downscaled, viewport-sized stream
const viewportCtx = viewportCanvas.getContext('2d', { willReadFrequently: true });
// --- END MODIFICATION ---

// --- State Management ---
let stream = null;
let rect = { x: 0, y: 0, width: 0, height: 0 };
let modelLoaded = null;
let modelDetails = null;
let targetTabId = null;
let layoutWidth = null;
let layoutHeight = null;
let loopTimeoutId = null; // To hold the setTimeout ID
let isProcessingFrame = false; // The "lock" to prevent concurrent processing
let lastKnownViewportSize = null; // Store the last known viewport size

// --- Loop Control ---
let sendframesstatus = false;

// --- Instantaneous FPS Calculation ---
let lastFrameTime = performance.now();
let fps = 0;

// --- Performance Aggregation State ---
let performanceAggregator = {
  frameDurations: [],
  prepDurations: [],
  inferenceDurations: [],
  postProcessingDurations: [],
  framesInPeriod: 0,
  lastReportTime: performance.now(),
  reportIntervalMs: 10000
};


// --- Message Handling ---
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log("[Offscreen] Message received:", message);
  if (message.target !== 'offscreen') return true;

  switch (message.type) {
    case 'releaseStream':
      stopPredictionLoop();
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
        chrome.runtime.sendMessage({ /* ... model load metric ... */ }).catch(e => console.warn(e.message));
      } catch (err) {
        // ... error handling for model load ...
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
      startPredictionLoop();
      if (video.paused) {
        video.play().catch(e => console.error("Error playing video:", e));
      }
      break;

    case 'stop-frameCapture':
    case 'stop-frameCaptureForTab':
      console.log(`[Offscreen] Received ${message.type}. Commanding loop to stop.`);
      stopPredictionLoop();
      break;

    case 'rectUpdate':
      rect = message.rect;
      layoutWidth = message.layoutSize?.width;
      layoutHeight = message.layoutSize?.height;
      if (message.layoutSize) {
        lastKnownViewportSize = message.layoutSize;
      }
      break;

    case 'streamStart':
      console.log("[Offscreen] streamStart received for tab:", message.targetTabId);
      sendframesstatus = false;
      targetTabId = message.targetTabId;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      try {
        // We now accept the high-resolution stream and will downscale it manually.
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: message.streamId,
            },
          },
        });
        video.srcObject = stream;
        console.log("[Offscreen] New stream acquired at native resolution.");
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

function startPredictionLoop() {
  if (sendframesstatus) return; // Already running
  console.log("[Offscreen] Starting prediction loop.");
  sendframesstatus = true;
  isProcessingFrame = false; // Ensure lock is released
  performanceAggregator.lastReportTime = performance.now();
  predictionLoop(); // Kick off the loop
}

function stopPredictionLoop() {
  if (!sendframesstatus) return;
  console.log("[Offscreen] Stopping prediction loop.");
  sendframesstatus = false;
  if (loopTimeoutId) {
    clearTimeout(loopTimeoutId);
  }
  if (performanceAggregator.framesInPeriod > 0) {
    reportPerformance();
  }
}

function predictionLoop() {
  if (!sendframesstatus) {
    console.log("[Offscreen] Prediction loop has fully stopped.");
    return;
  }

  // If we are already busy with a frame, skip trying to start another one immediately.
  // The loop will restart itself once the current frame is done.
  if (isProcessingFrame) {
    return;
  }

  // Set the lock and start processing.
  isProcessingFrame = true;

  // We call processFrame and use .then() to schedule the next loop iteration
  // as soon as the current one is finished, creating a tight loop.
  processFrame().finally(() => {
    isProcessingFrame = false;
    // Schedule the next iteration of the loop to run as soon as possible.
    loopTimeoutId = setTimeout(predictionLoop, 0);
  });

  // Performance reporting is now independent of the main loop timing
  const now = performance.now();
  if (now - performanceAggregator.lastReportTime >= performanceAggregator.reportIntervalMs) {
    reportPerformance();
  }
}

async function processFrame() {
  if (!modelLoaded || !video.srcObject || video.paused || video.videoWidth === 0 || !lastKnownViewportSize) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return;
  }

  const frameProcessStartTime = performance.now();
  const now = performance.now();
  fps = Math.round(1000 / (now - lastFrameTime));
  lastFrameTime = now;

  // --- MODIFICATION: "TWO CANVAS" DOWNSCALING AND CROPPING LOGIC ---

  // 1. Ensure our viewport-sized canvas is the correct size.
  /*viewportCanvas.width = lastKnownViewportSize.width;
  viewportCanvas.height = lastKnownViewportSize.height;

  // 2. Downscale the entire high-resolution video onto the smaller viewportCanvas.
  viewportCtx.drawImage(video, 0, 0, viewportCanvas.width, viewportCanvas.height);*/

  // 3. Define the crop area based on the on-screen rectangle's pixel values.
  //    The proportional math is no longer needed as we are cropping from a source
  //    (viewportCanvas) that has the same dimensions as the on-screen layout.
  const sx = rect.x;
  const sy = rect.y;
  const sw = rect.width;
  const sh = rect.height;

  if (sw <= 1 || sh <= 1) return;

  // 4. Resize the final canvas (for the model) to the size of the on-screen selection.
  offscreenCanvas.width = Math.floor(sw);
  offscreenCanvas.height = Math.floor(sh);

  // 5. Crop FROM the viewportCanvas ONTO the final offscreenCanvas.
  const drawStartTime = performance.now();
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
  //const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  const prepareEndTime = performance.now();
  // --- END MODIFICATION ---

  const inferenceStartTime = performance.now();
  try {
    let predictions;
    if (modelDetails.inferenceTask === 'detection') {
      predictions = await detect(modelLoaded, offscreenCanvas, modelDetails);
    } else {
      predictions = await predict(modelLoaded, offscreenCanvas, modelDetails.inputShape, 5);
    }
    const inferenceEndTime = performance.now();

    if (sendframesstatus && targetTabId) {
      chrome.runtime.sendMessage({
        type: 'predictions',
        predictions,
        target: 'worker',
        targetTabId,
        fps,
      }).catch(e => {});

      const messageSentTime = performance.now();
      performanceAggregator.frameDurations.push(inferenceEndTime - frameProcessStartTime);
      performanceAggregator.prepDurations.push(prepareEndTime - drawStartTime);
      performanceAggregator.inferenceDurations.push(inferenceEndTime - inferenceStartTime);
      performanceAggregator.postProcessingDurations.push(messageSentTime - inferenceEndTime);
      performanceAggregator.framesInPeriod++;
    }
  } catch (error) {
    // ... error handling ...
  }
}

function reportPerformance() {
  if (performanceAggregator.framesInPeriod === 0) return;
  const now = performance.now();
  const totalTimeSeconds = (now - performanceAggregator.lastReportTime) / 1000;
  const avgFps = parseFloat((performanceAggregator.framesInPeriod / totalTimeSeconds).toFixed(2));
  const calculateStats = (arr) => {
    if (arr.length === 0) return { avg: 0, min: 0, max: 0 };
    const sum = arr.reduce((a, b) => a + b, 0);
    const avg = sum / arr.length;
    return { avg: parseFloat(avg.toFixed(2)), min: parseFloat(Math.min(...arr).toFixed(2)), max: parseFloat(Math.max(...arr).toFixed(2)) };
  };
  const aggregatedMetric = {
    type: 'inference_aggregated',
    location: 'offscreen',
    modelType: modelDetails.inferenceTask,
    processing: calculateStats(performanceAggregator.frameDurations),
    preparation: calculateStats(performanceAggregator.prepDurations),
    inference: calculateStats(performanceAggregator.inferenceDurations),
    postProcessing: calculateStats(performanceAggregator.postProcessingDurations),
    avgFps: avgFps,
    framesInPeriod: performanceAggregator.framesInPeriod,
    durationOfPeriodMs: parseFloat((now - performanceAggregator.lastReportTime).toFixed(2)),
    inputWidth: offscreenCanvas.width,
    inputHeight: offscreenCanvas.height,
    tabId: targetTabId
  };
  chrome.runtime.sendMessage({ target: 'worker', type: 'recordPerformanceMetric', metric: aggregatedMetric }).catch(e => console.warn(e.message));
  performanceAggregator.frameDurations = [];
  performanceAggregator.prepDurations = [];
  performanceAggregator.inferenceDurations = [];
  performanceAggregator.postProcessingDurations = [];
  performanceAggregator.framesInPeriod = 0;
  performanceAggregator.lastReportTime = now;
}

console.log("[Offscreen] Script fully parsed and ready.");