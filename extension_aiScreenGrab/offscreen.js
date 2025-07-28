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
let isLoopRunning = false; // A single flag to control the loop
let lastKnownViewportSize = null; // Store the last known viewport size

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
      try {
        modelLoaded = await loadModel(modelDetails.inferenceTask || modelDetails.modelType);
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
      offscreenCanvas.width = Math.floor(rect.width);
      offscreenCanvas.height = Math.floor(rect.height);
      break;

    case 'streamStart':
      console.log("[Offscreen] streamStart received for tab:", message.targetTabId);
      isLoopRunning = false;
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
              width: { ideal: 960 }, // Adjust as needed
              height: { ideal: 540 }, // Adjust as needed
              frameRate: { ideal: 30 }, // Adjust as needed
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
  stopPredictionLoop();
});


// --- OPTIMIZED Core Prediction Loop ---

function startPredictionLoop() {
  if (isLoopRunning) {
    console.log("[Offscreen] Prediction loop is already running.");
    return;
  }
  console.log("[Offscreen] Starting prediction loop.");
  isLoopRunning = true;
  performanceAggregator.lastReportTime = performance.now();
  predictionLoop(); // Kick off the async while loop
}

function stopPredictionLoop() {
  if (!isLoopRunning) return;
  console.log("[Offscreen] Stopping prediction loop.");
  isLoopRunning = false;
  // No need to clear timeouts as the loop will naturally exit.
  // Report any remaining performance data.
  if (performanceAggregator.framesInPeriod > 0) {
    reportPerformance();
  }
}

async function predictionLoop() {
  // The loop continues as long as this flag is true.
  // The flag is controlled by start/stopPredictionLoop functions.
  while (isLoopRunning) {
    // Awaiting a promise that resolves on the next microtask allows the event loop
    // to process other tasks, preventing the offscreen document from freezing.
    //await new Promise(resolve => setTimeout(resolve, 0));

    const frameProcessStartTime = performance.now();
    const now = performance.now();
    fps = Math.round(1000 / (now - lastFrameTime));
    lastFrameTime = now;

    // --- "TWO CANVAS" DOWNSCALING AND CROPPING LOGIC ---
    const sx = rect.x;
    const sy = rect.y;
    const sw = rect.width;
    const sh = rect.height;

    const drawStartTime = performance.now();
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
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

      // Check the loop status again before sending the message
      if (isLoopRunning && targetTabId) {
        chrome.runtime.sendMessage({
          type: 'predictions',
          predictions,
          target: 'worker',
          targetTabId,
          fps,
        }).catch(e => { /* Potentially handle message sending failure */ });

        const messageSentTime = performance.now();
        performanceAggregator.frameDurations.push(inferenceEndTime - frameProcessStartTime);
        performanceAggregator.prepDurations.push(prepareEndTime - drawStartTime);
        performanceAggregator.inferenceDurations.push(inferenceEndTime - inferenceStartTime);
        performanceAggregator.postProcessingDurations.push(messageSentTime - inferenceEndTime);
        performanceAggregator.framesInPeriod++;
      }
    } catch (error) {
      console.error("[Offscreen] Error during model inference:", error);
    }

    // Performance reporting
    const reportingNow = performance.now();
    if (reportingNow - performanceAggregator.lastReportTime >= performanceAggregator.reportIntervalMs) {
      reportPerformance();
    }
  }
  console.log("[Offscreen] Prediction loop has fully stopped.");
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