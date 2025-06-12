// injected.js
// This script combines the logic of the original injected script, the popup, and the offscreen document.
// It now includes a 1-to-1 implementation of the offscreen document's performance aggregation system.

import * as tf from "@tensorflow/tfjs";
import { loadModel, predict, detect } from "./utils/modelHelpers.mjs";
import { setItemInDB, getItemFromDB, saveFile } from "./utils/indexedDB.mjs";

(async () => {
  // Avoid re-injecting if the UI already exists.
  if (document.getElementById('__extension_aiScreen')) {
    console.log("AI Screen UI already present. Aborting injection.");
    return;
  }

  // --- Global State ---
  const AppState = {
    model: null,
    modelDetails: null,
    stream: null,
    videoElement: document.createElement('video'),
    isPredicting: false,
    isDrawing: false,
    mainRect: null,
    inferenceLoopId: null,
    performanceLog: [],
    offscreenCanvas: new OffscreenCanvas(1, 1),
    saveLogTimeout: null,
    // --- NEW: Performance Aggregation State (1-to-1 with offscreen.js) ---
    performanceAggregator: {
      frameDurations: [],
      prepDurations: [],
      inferenceDurations: [],
      postProcessingDurations: [],
      framesInPeriod: 0,
      lastReportTime: performance.now(),
      reportIntervalMs: 10000 // Send a report every 1 second
    },
  };

  // --- UI Element References ---
  const UI = {};

  // --- Main Initializer ---
  function _init() {
    console.log("AI In-Page: Initializing...");
    _injectUI();
    _queryUIElements();
    _bindEventListeners();
    _loadInitialState();
    _checkForExistingModel();
  }

  // --- UI and HTML Injection ---
  function _getHTML() {
        return `
        <div id="__extension_aiScreen">
            <div class="__extension_aiScreen-modelUI" data-dragable="true">
                <h3>AI Controls</h3>
                <button class="__extension_aiScreen-predict" data-for="start">Start Predictions</button>
                <button class="__extension_aiScreen-drawArea">Draw Area</button>
                <button class="__extension_aiScreen-showConfig">Configure Model</button>
                <div class="__extension_aiScreen-results"></div>
            </div>

            <div class="__extension_aiScreen-overlayElements">
                <div class="__extension_aiScreen-overlay"></div>
                <div class="__extension_aiScreen-rect" data-dragable="true"></div>
                <div class="__extension_aiScreen-canvasContainer" data-dragable="true">
                    <div class="__extension_aiScreen-fps">FPS: 0</div>
                    <canvas class="__extension_aiScreen-canvas"></canvas>
                </div>
            </div>

            <div id="__extension_aiConfigPanel" class="hidden">
                <div class="config-content">
                    <button id="configCloseButton">×</button>
                    <h1>AI Model Configuration</h1>
                    <form id="modelDetailsForm">
                        <fieldset>
                            <legend>1. Upload Model</legend>
                            <label>Model files (.json, .bin, .txt)
                                <input type="file" id="modelFiles" name="modelFiles" multiple />
                            </label>
                            <ul id="modelFilesList"></ul>
                        </fieldset>
                        <fieldset>
                            <legend>2. Configuration</legend>
                            <label>Inference task
                                <select id="inferenceTask" name="inferenceTask">
                                    <option value="classification">Classification</option>
                                    <option value="detection">Detection</option>
                                </select>
                            </label>
                            <label>Labels format
                                <select id="labelsFormat" name="labelsFormat">
                                    <option value="simpletext">Line by line text</option>
                                    <option value="simpletextwithindex">Text with indexes</option>
                                    <option value="json">JSON</option>
                                </select>
                            </label>
                            <label>Labels Separator
                                <input type="text" id="labelsSeparator" name="labelsSeparator" value=" "/>
                            </label>
                        </fieldset>
                        <fieldset>
                            <legend>3. Input</legend>
                            <label>Input shape (Height x Width)
                                <input type="text" id="inputShape" name="inputShape" placeholder="e.g. 224x224" required />
                            </label>
                        </fieldset>
                        <fieldset id="detectionOptions" class="hidden">
                            <legend>4. Detection Settings</legend>
                            <label>Score threshold
                                <input type="number" id="scoreThreshold" name="scoreThreshold" min="0" max="1" step="0.01" value="0.5" />
                            </label>
                            <label>Max detections
                                <input type="number" id="maxDetections" name="maxDetections" min="1" step="1" value="20" />
                            </label>
                        </fieldset>
                        <button type="submit" id="saveConfigBtn">Save Configuration</button>
                    </form>
                    <fieldset>
                        <legend>Performance Data</legend>
                        <button type="button" id="exportPerformanceButton">Export CSV</button>
                        <button type="button" id="clearPerformanceButton">Clear Data</button>
                    </fieldset>
                </div>
            </div>
        </div>`;
  }

  function _injectUI() {
    document.body.insertAdjacentHTML('beforeend', _getHTML());
    const dragIconURL = chrome.runtime.getURL('icons/drag.svg');
    document.querySelectorAll('[data-dragable="true"]').forEach(el => {
      if (!el.querySelector('.__extension_aiScreen-dragIcon')) {
        const img = document.createElement('img');
        img.src = dragIconURL;
        img.className = '__extension_aiScreen-dragIcon';
        el.appendChild(img);
      }
    });
  }

  function _queryUIElements() {
    const sel = (selector) => document.querySelector(selector);
    Object.assign(UI, {
      container: sel('#__extension_aiScreen'),
      predictButton: sel('.__extension_aiScreen-predict'),
      drawAreaButton: sel('.__extension_aiScreen-drawArea'),
      showConfigButton: sel('.__extension_aiScreen-showConfig'),
      results: sel('.__extension_aiScreen-results'),
      overlay: sel('.__extension_aiScreen-overlay'),
      rect: sel('.__extension_aiScreen-rect'),
      canvasContainer: sel('.__extension_aiScreen-canvasContainer'),
      canvas: sel('.__extension_aiScreen-canvas'),
      fps: sel('.__extension_aiScreen-fps'),
      configPanel: sel('#__extension_aiConfigPanel'),
      configForm: sel('#modelDetailsForm'),
      configCloseButton: sel('#configCloseButton'),
      saveConfigBtn: sel('#saveConfigBtn'),
      modelFilesInput: sel('#modelFiles'),
      modelFilesList: sel('#modelFilesList'),
      inferenceTask: sel('#inferenceTask'),
      detectionOptions: sel('#detectionOptions'),
      draggers: document.querySelectorAll('.__extension_aiScreen-dragIcon'),
      exportPerfButton: sel('#exportPerformanceButton'),
      clearPerfButton: sel('#clearPerformanceButton'),
    });
  }

  async function _loadInitialState() {
    const savedRect = JSON.parse(localStorage.getItem('rectState'));
    if (savedRect) {
      AppState.mainRect = savedRect;
      _updateRectUI(savedRect.x, savedRect.y, savedRect.width, savedRect.height);
      UI.rect.classList.add('active');
    }
    const result = await chrome.storage.local.get('performanceLog');
    AppState.performanceLog = result?.performanceLog || [];
  }

  function _bindEventListeners() {
    UI.predictButton.addEventListener('click', _togglePredictMode);
    UI.drawAreaButton.addEventListener('click', () => _startDrawing());
    UI.showConfigButton.addEventListener('click', () => _toggleConfigPanel(true));
    UI.configCloseButton.addEventListener('click', () => _toggleConfigPanel(false));
    UI.configForm.addEventListener('submit', _handleConfigFormSubmit);
    UI.inferenceTask.addEventListener("change", () => {
      UI.detectionOptions.classList.toggle('hidden', UI.inferenceTask.value !== "detection");
    });
    UI.draggers.forEach(dragger => dragger.addEventListener('mousedown', _onDragStart));
    UI.exportPerfButton.addEventListener('click', _exportPerformanceData);
    UI.clearPerfButton.addEventListener('click', _clearPerformanceData);
  }

  function _updateControlState(enabled, reason = '') {
    UI.predictButton.disabled = !enabled;
    UI.drawAreaButton.disabled = !enabled;
    UI.predictButton.title = enabled ? '' : reason;
    UI.drawAreaButton.title = enabled ? '' : reason;
  }

  // --- Configuration Logic ---
  async function _checkForExistingModel() {
    _updateControlState(false, "Initializing...");
    AppState.modelDetails = await getItemFromDB("modelDetails");
    if (AppState.modelDetails) {
      console.log("Found existing model configuration. Loading...");
      _populateConfigForm();
      await _loadModelFromConfig();
    } else {
      console.log("No model configuration found. Please configure a model.");
      _updateControlState(false, "Model is not configured.");
      _toggleConfigPanel(true);
    }
  }

  function _populateConfigForm() {
    if (!AppState.modelDetails) return;
    const form = UI.configForm;
    form.querySelector('#inputShape').value = AppState.modelDetails.inputShape || "224x224";
    form.querySelector('#inferenceTask').value = AppState.modelDetails.inferenceTask || 'classification';
    form.querySelector('#labelsFormat').value = AppState.modelDetails.labelsFormat || 'simpletext';
    form.querySelector('#labelsSeparator').value = AppState.modelDetails.labelsSeparator || ' ';
    if (AppState.modelDetails.inferenceTask === "detection") {
      form.querySelector('#scoreThreshold').value = AppState.modelDetails.scoreThreshold ?? 0.5;
      form.querySelector('#maxDetections').value = AppState.modelDetails.maxDetections ?? 20;
    }
    UI.detectionOptions.classList.toggle('hidden', AppState.modelDetails.inferenceTask !== 'detection');
    UI.modelFilesList.innerHTML = (AppState.modelDetails.modelFiles || []).map(name => `<li>${name}</li>`).join('');
  }

  async function _handleConfigFormSubmit(e) {
    e.preventDefault();
    UI.saveConfigBtn.disabled = true;
    UI.saveConfigBtn.textContent = "Processing...";

    const formData = new FormData(UI.configForm);
    const selectedFiles = UI.modelFilesInput.files;

    try {
      let modelFileNames = AppState.modelDetails?.modelFiles || [];
      if (selectedFiles.length > 0) {
        modelFileNames = await Promise.all(
          Array.from(selectedFiles).map(async (file) => {
            await saveFile(file);
            return file.name;
          })
        );
      }

      const inferenceTask = formData.get("inferenceTask");
      const details = {
        modelFiles: modelFileNames,
        inputShape: formData.get("inputShape").toLowerCase() || "224x224",
        labelsFormat: formData.get("labelsFormat") || "simpletext",
        labelsSeparator: formData.get("labelsSeparator") || " ",
        inferenceTask,
      };
      if (inferenceTask === "detection") {
        details.scoreThreshold = parseFloat(formData.get("scoreThreshold")) || 0.5;
        details.maxDetections = parseInt(formData.get("maxDetections"), 10) || 20;
      }
      AppState.modelDetails = details;
      await setItemInDB("modelDetails", details);

      const isLoaded = await _loadModelFromConfig();
      if (isLoaded) {
        _toggleConfigPanel(false);
      }

    } catch (err) {
      console.error("Error saving configuration:", err);
      alert("Failed to save configuration: " + err.message);
    } finally {
      UI.saveConfigBtn.disabled = false;
      UI.saveConfigBtn.textContent = "Save Configuration";
    }
  }

  async function _loadModelFromConfig() {
    if (!AppState.modelDetails) {
      _updateControlState(false, "Model configuration is missing.");
      return false;
    }
    try {
      _updateControlState(false, "Loading model...");
      const modelLoadStart = performance.now();
      AppState.model = await loadModel();
      const modelLoadEnd = performance.now();
      _recordPerformanceMetric({
        type: 'modelLoad',
        location: 'injected',
        durationMs: parseFloat((modelLoadEnd - modelLoadStart).toFixed(2)),
        modelType: AppState.modelDetails.inferenceTask
      });
      console.log("Model loaded successfully.");
      alert("Model loaded successfully!");
      _updateControlState(true);
      return true;
    } catch (error) {
      console.error("Failed to load model:", error);
      alert(`Error loading model: ${error.message}`);
      _recordPerformanceMetric({ type: 'modelLoadError', location: 'injected', error: error.message, modelType: AppState.modelDetails?.inferenceTask });
      AppState.model = null;
      _updateControlState(false, "Failed to load model.");
      return false;
    }
  }

  function _toggleConfigPanel(show) {
    UI.configPanel.classList.toggle('hidden', !show);
  }

  // --- Stream, Inference, and Prediction Logic ---

    function nextFrame() {
        return new Promise(resolve => {
            AppState.inferenceLoopId = requestAnimationFrame(resolve);
        });
    }

    async function _togglePredictMode() {
        if (AppState.isPredicting) {
            _stopPrediction();
        } else {
            await _startPrediction();
        }
    }

    async function _startPrediction() {
        if (!AppState.model) {
            alert("Please configure and load a model first.");
            _toggleConfigPanel(true);
            return;
        }
        if (!AppState.mainRect) {
            alert("Please draw an area first.");
            return;
        }

        try {
            AppState.stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "never" },
                preferCurrentTab: true,
                audio: false
            });

            AppState.stream.getVideoTracks()[0].onended = () => {
                _stopPrediction();
            };

            const video = AppState.videoElement;
            video.srcObject = AppState.stream;
            
            await video.play();
            
            AppState.isPredicting = true;
            UI.predictButton.textContent = 'Stop Predictions';
            UI.predictButton.dataset.for = 'stop';

            // Reset performance aggregator on start
            AppState.performanceAggregator.lastReportTime = performance.now();
            _inferenceLoop();

        } catch (err) {
            if (err.name === 'NotAllowedError') {
                 alert("Screen capture permission was denied.");
            } else {
                alert("Could not start screen capture.");
            }
            _stopPrediction(); // Ensure cleanup happens
        }
    }

    function _stopPrediction() {
        if (!AppState.isPredicting) return; // Prevent multiple calls
        
        AppState.isPredicting = false;
        
        // Flush any remaining performance metrics
        if (AppState.performanceAggregator.framesInPeriod > 0) {
            _reportPerformance();
        }
        
        if (AppState.stream) {
            AppState.stream.getTracks().forEach(track => track.stop());
            AppState.stream = null;
        }
        if (AppState.inferenceLoopId) {
            cancelAnimationFrame(AppState.inferenceLoopId);
            AppState.inferenceLoopId = null;
        }
        UI.predictButton.textContent = 'Start Predictions';
        UI.predictButton.dataset.for = 'start';
    }

    async function _inferenceLoop() {
        let lastFpsTimestamp = performance.now();
        let frameCountForDisplay = 0;
        
        while (AppState.isPredicting) {
            const frameProcessStartTime = performance.now();
            
            // --- Instantaneous FPS for UI display ---
            frameCountForDisplay++;
            if (frameProcessStartTime - lastFpsTimestamp >= 1000) {
                UI.fps.textContent = `FPS: ${frameCountForDisplay}`;
                lastFpsTimestamp = frameProcessStartTime;
                frameCountForDisplay = 0;
            }

            const vW = AppState.videoElement.videoWidth;
            const vH = AppState.videoElement.videoHeight;
            
            if (vW === 0 || vH === 0) {
                await nextFrame();
                continue;
            }
            
            // --- Frame Preparation ---
            const viewportW = document.documentElement.clientWidth;
            const viewportH = document.documentElement.clientHeight;
            const rectX_relative = AppState.mainRect.x - window.scrollX;
            const rectY_relative = AppState.mainRect.y - window.scrollY;
            const xRatio = rectX_relative / viewportW;
            const yRatio = rectY_relative / viewportH;
            const widthRatio = AppState.mainRect.width / viewportW;
            const heightRatio = AppState.mainRect.height / viewportH;
            const sx = xRatio * vW;
            const sy = yRatio * vH;
            const sw = widthRatio * vW;
            const sh = heightRatio * vH;
            
            if (sw <= 1 || sh <= 1) {
                await nextFrame();
                continue;
            };

            AppState.offscreenCanvas.width = sw;
            AppState.offscreenCanvas.height = sh;
            
            const drawStartTime = performance.now();
            const ctx = AppState.offscreenCanvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(AppState.videoElement, sx, sy, sw, sh, 0, 0, sw, sh);
            const imageData = ctx.getImageData(0, 0, sw, sh);
            const prepareEndTime = performance.now();

            // --- Model Inference ---
            const inferenceStartTime = performance.now();
            try {
                let predictions;
                if (AppState.modelDetails.inferenceTask === 'detection') {
                    predictions = await detect(AppState.model, imageData, AppState.modelDetails);
                } else {
                    predictions = await predict(AppState.model, imageData, AppState.modelDetails.inputShape);
                }
                const inferenceEndTime = performance.now();

                // --- Handle predictions for UI ---
                _handlePredictions(predictions, imageData);

                // --- AGGREGATE PERFORMANCE METRICS (No immediate sending) ---
                const postProcessingStartTime = performance.now();
                const totalFrameMs = inferenceEndTime - frameProcessStartTime;
                const prepMs = prepareEndTime - drawStartTime;
                const inferenceMs = inferenceEndTime - inferenceStartTime;
                const postProcessingMs = postProcessingStartTime - inferenceEndTime;

                AppState.performanceAggregator.frameDurations.push(totalFrameMs);
                AppState.performanceAggregator.prepDurations.push(prepMs);
                AppState.performanceAggregator.inferenceDurations.push(inferenceMs);
                AppState.performanceAggregator.postProcessingDurations.push(postProcessingMs);
                AppState.performanceAggregator.framesInPeriod++;

            } catch (error) {
                console.error("Inference failed:", error);
                _recordPerformanceMetric({
                    type: 'inferenceError',
                    location: 'injected',
                    modelType: AppState.modelDetails.inferenceTask,
                    durationUntilErrorMs: parseFloat((performance.now() - inferenceStartTime).toFixed(2)),
                    error: error.message,
                    stack: error.stack,
                    inputWidth: Math.round(sw),
                    inputHeight: Math.round(sh),
                });
                alert("An error occurred during model inference. Stopping prediction.");
                _stopPrediction();
                break; // Exit the loop
            }
            
            // --- Check if it's time to send the aggregated report ---
            const now = performance.now();
            if (now - AppState.performanceAggregator.lastReportTime >= AppState.performanceAggregator.reportIntervalMs) {
                _reportPerformance();
            }

            await nextFrame();
        }
    }
  
    function _handlePredictions(predictions, imageData) {
        const ctx = UI.canvas.getContext('2d');
        UI.canvas.width = imageData.width;
        UI.canvas.height = imageData.height;
        ctx.putImageData(imageData, 0, 0);
        UI.results.innerHTML = '';

        if (!predictions || predictions.length === 0) return;

        if (predictions[0].box) { // Detection
            predictions.forEach(p => {
                const { top, left, bottom, right } = p.box;
                const x = left * UI.canvas.width;
                const y = top * UI.canvas.height;
                const w = (right - left) * UI.canvas.width;
                const h = (bottom - top) * UI.canvas.height;
                _drawBoundingBox(ctx, x, y, w, h, p.label, p.score);
            });
            UI.results.innerHTML = predictions.map(p => `<div>${p.label}: ${p.score.toFixed(2)}</div>`).join('');
        } else { // Classification
            UI.results.innerHTML = predictions.map(p => `<div>${p.label}: ${p.probability.toFixed(2)}</div>`).join('');
        }
    }

    // --- Drawing and UI Interaction Logic ---
    function _startDrawing() {
        UI.rect.classList.remove('active');
        UI.overlay.classList.add('active');
        let startX = 0, startY = 0;

        function onMouseDown(e) {
            AppState.isDrawing = true;
            startX = e.clientX + window.scrollX;
            startY = e.clientY + window.scrollY;
            _updateRectState(startX, startY, 0, 0);
            _updateRectUI(startX, startY, 0, 0);
            UI.rect.classList.add('active');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }

        function onMouseMove(e) {
            if (!AppState.isDrawing) return;
            let width = (e.clientX + window.scrollX) - startX;
            let height = (e.clientY + window.scrollY) - startY;
            _updateRectState(startX, startY, width, height);
            _updateRectUI(startX, startY, width, height);
        }

        function onMouseUp() {
            AppState.isDrawing = false;
            UI.overlay.classList.remove('active');
            localStorage.setItem('rectState', JSON.stringify(AppState.mainRect));
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            UI.overlay.removeEventListener('mousedown', onMouseDown);
        }
        UI.overlay.addEventListener('mousedown', onMouseDown);
    }

    function _updateRectState(x, y, w, h) { AppState.mainRect = { x, y, width: w, height: h }; }
    function _updateRectUI(x, y, w, h) { Object.assign(UI.rect.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }); }

    function _onDragStart(e) {
        e.preventDefault();
        const parent = e.target.closest('[data-dragable="true"]');
        if (!parent) return;

        const parentRect = parent.getBoundingClientRect();
        const offsetX = e.clientX - parentRect.left;
        const offsetY = e.clientY - parentRect.top;

        function handleDrag(event) {
            let x = event.clientX - offsetX;
            let y = event.clientY - offsetY;
            const maxX = window.innerWidth - parent.offsetWidth;
            const maxY = window.innerHeight - parent.offsetHeight;
            x = Math.max(0, Math.min(x, maxX));
            y = Math.max(0, Math.min(y, maxY));
            const absoluteX = x + window.scrollX;
            const absoluteY = y + window.scrollY;
            parent.style.left = `${absoluteX}px`;
            parent.style.top = `${absoluteY}px`;
            if (parent.classList.contains('__extension_aiScreen-rect')) {
                _updateRectState(absoluteX, absoluteY, parent.offsetWidth, parent.offsetHeight);
            }
        }

        function stopDrag() {
            document.removeEventListener('mousemove', handleDrag);
            document.removeEventListener('mouseup', stopDrag);
            if (parent.classList.contains('__extension_aiScreen-rect')) {
                localStorage.setItem('rectState', JSON.stringify(AppState.mainRect));
            }
        }
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', stopDrag);
    }

    function _drawBoundingBox(ctx, left, top, width, height, label, score) {
        ctx.save();
        let color = score < 0.5 ? 'red' : (score >= 0.75 ? 'limegreen' : 'yellow');
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(left, top, width, height);
        ctx.font = '14px sans-serif';
        const text = `${label}: ${score.toFixed(2)}`;
        const textMetrics = ctx.measureText(text);
        const textHeight = 14, padding = 4;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(left, top - (textHeight + padding * 2), textMetrics.width + padding * 2, textHeight + padding * 2);
        ctx.fillStyle = color;
        ctx.fillText(text, left + padding, top - padding);
        ctx.restore();
    }

  // --- Performance Logging & Reporting (1-to-1 with offscreen.js) ---

  function _recordPerformanceMetric(metric) {
      const enrichedMetric = { ...metric,
          timestamp: Date.now(),
          datetime: new Date().toISOString()
      };
      AppState.performanceLog.push(enrichedMetric);
      // Debounce saving to storage to avoid excessive writes
      clearTimeout(AppState.saveLogTimeout);
      AppState.saveLogTimeout = setTimeout(() => chrome.storage.local.set({
          performanceLog: AppState.performanceLog
      }), 5000);
  }
  
  function _reportPerformance() {
      const aggregator = AppState.performanceAggregator;
      if (aggregator.framesInPeriod === 0) return;

      const now = performance.now();
      const totalTimeSeconds = (now - aggregator.lastReportTime) / 1000;
      const avgFps = parseFloat((aggregator.framesInPeriod / totalTimeSeconds).toFixed(2));

      const calculateStats = (arr) => {
          if (arr.length === 0) return { avg: 0, min: 0, max: 0 };
          const sum = arr.reduce((a, b) => a + b, 0);
          const avg = sum / arr.length;
          return {
              avg: parseFloat(avg.toFixed(2)),
              min: parseFloat(Math.min(...arr).toFixed(2)),
              max: parseFloat(Math.max(...arr).toFixed(2)),
          };
      };

      const aggregatedMetric = {
          type: 'inference_aggregated',
          location: 'injected',
          modelType: AppState.modelDetails.inferenceTask,
          processing: calculateStats(aggregator.frameDurations),
          preparation: calculateStats(aggregator.prepDurations),
          inference: calculateStats(aggregator.inferenceDurations),
          postProcessing: calculateStats(aggregator.postProcessingDurations),
          avgFps: avgFps,
          framesInPeriod: aggregator.framesInPeriod,
          durationOfPeriodMs: parseFloat((now - aggregator.lastReportTime).toFixed(2)),
          inputWidth: AppState.offscreenCanvas.width,
          inputHeight: AppState.offscreenCanvas.height,
      };

      _recordPerformanceMetric(aggregatedMetric);

      // Reset aggregator for the next period
      aggregator.frameDurations = [];
      aggregator.prepDurations = [];
      aggregator.inferenceDurations = [];
      aggregator.postProcessingDurations = [];
      aggregator.framesInPeriod = 0;
      aggregator.lastReportTime = now;
  }

  function _exportPerformanceData() {
      if (!AppState.performanceLog || AppState.performanceLog.length === 0) {
          alert("No performance data to export.");
          return;
      }
      
      // Use the robust flattening logic from the other extension for 1-to-1 comparable CSVs
      const flattenObject = (obj, prefix = '') =>
          Object.keys(obj).reduce((acc, k) => {
              const pre = prefix.length ? prefix + '_' : '';
              if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
                  Object.assign(acc, flattenObject(obj[k], pre + k));
              } else {
                  acc[pre + k] = obj[k];
              }
              return acc;
          }, {});

      const flattenedData = AppState.performanceLog.map(row => flattenObject(row));
      const headers = [...new Set(flattenedData.flatMap(row => Object.keys(row)))];
      const preferredOrder = [
        'datetime', 'timestamp', 'type', 'location', 
        'avgFps', 'framesInPeriod', 'durationOfPeriodMs',
        'processing_avg', 'processing_min', 'processing_max',
        'inference_avg', 'inference_min', 'inference_max',
        'preparation_avg', 'preparation_min', 'preparation_max',
        'postProcessing_avg', 'postProcessing_min', 'postProcessing_max',
        'durationMs', 'modelType', 'inputWidth', 'inputHeight',
        'error', 'stack',
      ];
      const sortedHeaders = preferredOrder.filter(h => headers.includes(h))
                               .concat(headers.filter(h => !preferredOrder.includes(h)).sort());
      
      const csvRows = [sortedHeaders.join(',')];
      for (const row of flattenedData) {
          const values = sortedHeaders.map(header => {
              const value = row[header] === undefined || row[header] === null ? '' : row[header];
              let escaped = ('' + value).replace(/"/g, '""');
              if (escaped.includes(',')) {
                  escaped = `"${escaped}"`;
              }
              return escaped;
          });
          csvRows.push(values.join(','));
      }

      const csvString = csvRows.join('\n');
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `performance_log_injected_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      alert("Performance data exported.");
  }

  async function _clearPerformanceData() {
      if (confirm('Are you sure you want to clear all performance data? This action cannot be undone.')) {
          AppState.performanceLog = [];
          await chrome.storage.local.remove('performanceLog');
          alert('Performance data cleared.');
      }
  }

  // --- Start the script ---
  _init();
})();