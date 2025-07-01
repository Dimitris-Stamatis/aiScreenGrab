// injected.js
(async () => {
  // Prevent the script from being injected multiple times
  if (window.hasInjectedAiScreenScript) {
    console.log("AI Screen script already injected. Activating UI.");
    const modelUI = document.querySelector('.__extension_aiScreen-modelUI');
    if (modelUI) modelUI.classList.add('active');
    return;
  }
  window.hasInjectedAiScreenScript = true;

  // -------------------
  // STATE OBJECTS
  // -------------------
  const AppState = {
    aspectRatio: localStorage.getItem('aspectRatio') || '1x1',
    rect: JSON.parse(localStorage.getItem('rectState')) || null,
    isPredicting: localStorage.getItem('isPredicting') === 'true',
    mainRect: null
  };

  const InferenceState = {
    modelDetails: null,
    modelLoaded: null,
    isCapturing: false,
    videoStream: null,
    videoEl: null,
    lastFrameTime: performance.now(),
    fps: 0,
    isLock: false,
    inferenceIntervalId: null
  };

  let UI = {};

  // -------------------
  // 1) Function: _getHTML
  // -------------------
  function _getHTML() {
    return `
      <div id="__extension_aiScreen">
        <div class="__extension_aiScreen-modelUI" data-dragable="true">
          <button class="__extension_aiScreen-predict" data-for="start">Start predictions</button>
          <button class="__extension_aiScreen-drawArea">Draw Area</button>
          <button class="__extension_aiScreen-configureModel">Configure Model</button>
          <div class="__extension_aiScreen-results"></div>
        </div>
        <div class="__extension_aiScreen-overlayElements">
          <div class="__extension_aiScreen-overlay"></div>
          <div class="__extension_aiScreen-rect" data-dragable="true"></div>
          <div class="__extension_aiScreen-canvasContainer" data-dragable="true">
            <div class="__extension_aiScreen-fps"></div>
            <canvas class="__extension_aiScreen-canvas"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  // -------------------
  // 2) Function: _createDragIcon
  // -------------------
  function _createDragIcon(src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Drag';
    img.className = '__extension_aiScreen-dragIcon';
    return img;
  }

  // -------------------
  // 3) Function: _restoreRect
  //    - Restores saved rectangle from AppState.rect into UI.rect
  // -------------------
  function _restoreRect() {
    if (!AppState.rect || !UI.rect) return;
    Object.assign(UI.rect.style, {
      left: `${AppState.rect.x}px`,
      top: `${AppState.rect.y}px`,
      width: `${AppState.rect.width}px`,
      height: `${AppState.rect.height}px`
    });
    UI.rect.classList.add('active');
    AppState.mainRect = { ...AppState.rect };
  }

  // -------------------
  // 4) Function: _updatePredictButton
  //    - Toggles label and data-for attribute on the Start/Stop button
  // -------------------
  function _updatePredictButton(isPredicting) {
    if (!UI.predictButton || UI.predictButton.disabled) return;
    if (isPredicting) {
      UI.predictButton.dataset.for = 'stop';
      UI.predictButton.textContent = 'Stop predictions';
    } else {
      UI.predictButton.dataset.for = 'start';
      UI.predictButton.textContent = 'Start predictions';
    }
  }

  // -------------------
  // 5) Function: _initUIAndState
  //    - Injects HTML if not present, queries UI refs, restores state, shows UI panel
  // -------------------
  function _initUIAndState() {
    if (!document.getElementById('__extension_aiScreen')) {
      document.body.insertAdjacentHTML('beforeend', _getHTML());
    }

    UI = {
      container: document.getElementById('__extension_aiScreen'),
      redrawButton: document.querySelector('.__extension_aiScreen-drawArea'),
      overlay: document.querySelector('.__extension_aiScreen-overlay'),
      rect: document.querySelector('.__extension_aiScreen-rect'),
      canvas: document.querySelector('.__extension_aiScreen-canvas'),
      modelUI: document.querySelector('.__extension_aiScreen-modelUI'),
      predictButton: document.querySelector('.__extension_aiScreen-predict'),
      configureModel: document.querySelector('.__extension_aiScreen-configureModel'),
      results: document.querySelector('.__extension_aiScreen-results'),
      fps: document.querySelector('.__extension_aiScreen-fps'),
      draggers: document.querySelectorAll('.__extension_aiScreen-dragIcon')
    };

    // Make the modelUI panel visible immediately
    if (UI.modelUI) UI.modelUI.classList.add('active');

    // Insert drag icons onto any [data-dragable="true"] elements
    const dragIconURL = chrome.runtime.getURL('icons/drag.svg');
    document.querySelectorAll('[data-dragable="true"]').forEach(el => {
      if (!el.querySelector('img.__extension_aiScreen-dragIcon')) {
        el.appendChild(_createDragIcon(dragIconURL));
      }
    });
    UI.draggers = document.querySelectorAll('.__extension_aiScreen-dragIcon');

    // Restore rectangle state from localStorage
    _restoreRect();

    // Update predict button based on stored state
    _updatePredictButton(AppState.isPredicting);
  }

  // -------------------
  // 6) Function: _setupUIEventListeners
  //    - Attach click/drag handlers to UI elements
  // -------------------
  function _setupUIEventListeners() {
    if (!UI.container) return;

    UI.redrawButton?.addEventListener('click', () => _startDrawing(AppState.aspectRatio));
    UI.configureModel?.addEventListener('click', () =>
      chrome.runtime.sendMessage({ target: 'worker', type: 'configureModel' })
    );
    UI.predictButton?.addEventListener('click', _togglePredictMode);
    UI.draggers?.forEach(dragger => dragger.addEventListener('mousedown', _onDragStart));
  }

  // -------------------
  // 7) Function: _enableUIElements
  //    - Ensures panels/canvas/results are visible (used on reinjection)
  // -------------------
  function _enableUIElements() {
    UI.overlay?.classList.remove('active');
    UI.rect?.classList.add('active');
    UI.modelUI?.classList.add('active');
    UI.canvas?.classList.add('active');
    UI.results?.classList.add('active');
    UI.fps?.classList.add('active');
  }

  // -------------------
  // 8) Function: _setupChromeMessageListener
  //    - Listens for: startDrawing, reinjected, modelDetailsUpdated
  // -------------------
  function _setupChromeMessageListener() {
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
      console.log('[Injected] Received message:', message);
      switch (message.type) {
        case 'startDrawing':
          if (!UI.container) _initUIAndState();
          _startDrawing(message.aspectRatio);
          break;

        case 'reinjected':
          // Service worker re-injection after navigation
          _initUIAndState();
          _enableUIElements();
          if (message.aspectRatio) {
            AppState.aspectRatio = message.aspectRatio;
            localStorage.setItem('aspectRatio', AppState.aspectRatio);
          }
          // Reload model in case SW reset anything
          await _initializeModels();
          if (AppState.isPredicting) {
            console.log("[Injected] Resuming prediction post-reinject.");
            const ok = await _startCapture();
            _updatePredictButton(ok);
          }
          break;

        case 'modelDetailsUpdated':
          console.log("[Injected] Model details updated. Reloading model...");
          alert("Model configuration changed; loading new model now.");
          await _initializeModels();
          break;
      }
      return true;
    });
  }

  // -------------------
  // 9) Function: _initializeModels
  //    - Dynamically imports indexedDB + modelHelpers bundles
  //    - Reads modelDetails from IndexedDB
  //    - Loads TFJS model and sends a metric
  // -------------------
  async function _initializeModels() {
    // Disable buttons while loading
    if (UI.predictButton) {
      UI.predictButton.disabled = true;
      UI.predictButton.textContent = "Loading model...";
    }
    if (UI.redrawButton) UI.redrawButton.disabled = true;

    try {
      // 1) Dynamically import the IndexedDB helper bundle
      const indexedDBModule = await import(
        chrome.runtime.getURL('dist/utils/indexedDB.bundle.js')
      );
      const { getItemFromDB } = indexedDBModule;

      // 2) Fetch modelDetails
      InferenceState.modelDetails = await getItemFromDB("modelDetails");
      if (!InferenceState.modelDetails) {
        throw new Error("Model details missing. Please configure your model.");
      }

      // 3) Dynamically import the modelHelpers bundle
      const modelHelpers = await import(
        chrome.runtime.getURL('dist/utils/modelHelpers.bundle.js')
      );
      const { loadModel } = modelHelpers;

      // 4) Load the TFJS model
      const t0 = performance.now();
      InferenceState.modelLoaded = await loadModel();
      const t1 = performance.now();
      if (!InferenceState.modelLoaded) {
        throw new Error("loadModel() returned null or undefined.");
      }
      console.log("[Injected] Model loaded successfully.");

      // 5) Send modelLoad metric back to service worker
      chrome.runtime.sendMessage({
        target: 'worker',
        type: 'recordPerformanceMetric',
        metric: {
          type: 'modelLoad',
          location: 'injected',
          durationMs: parseFloat((t1 - t0).toFixed(2)),
          modelType: InferenceState.modelDetails.inferenceTask || 'unknown'
        }
      });

      // 6) Re-enable buttons
      if (UI.predictButton) {
        UI.predictButton.disabled = false;
        _updatePredictButton(AppState.isPredicting);
      }
      if (UI.redrawButton) UI.redrawButton.disabled = false;
    }
    catch (err) {
      console.error("[Injected] Model Load Failed:", err.message);
      alert(
        `Failed to load the model. Please re-open configuration and re-upload.\nError: ${err.message}`
      );
      if (UI.predictButton) UI.predictButton.textContent = "Model Error";
    }
  }

  // -------------------
  // 10) Function: _togglePredictMode
  //     - Called when user clicks “Start predictions” / “Stop predictions”
  // -------------------
  async function _togglePredictMode(e) {
    const isStarting = e.target.dataset.for === 'start';
    if (isStarting) {
      const ok = await _startCapture();
      if (ok) {
        e.target.dataset.for = 'stop';
        e.target.textContent = 'Stop predictions';
      }
    } else {
      _stopCapture();
      e.target.dataset.for = 'start';
      e.target.textContent = 'Start predictions';
    }
    AppState.isPredicting = InferenceState.isCapturing;
    localStorage.setItem('isPredicting', AppState.isPredicting.toString());
  }

  // -------------------
  // 11) Function: _startCapture
  //     - Calls getDisplayMedia, creates hidden <video>, starts inference loop
  // -------------------
  async function _startCapture() {
    if (InferenceState.isCapturing) return false;
    InferenceState.isCapturing = true;

    try {
      if (!InferenceState.modelDetails || !InferenceState.modelLoaded) {
        throw new Error("Model not loaded.");
      }

      // 1) Ask user to share the tab
      InferenceState.videoStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always', displaySurface: 'browser', logicalSurface: true },
        audio: false
      });

      // 2) Create or reuse a hidden <video> element
      if (!InferenceState.videoEl) {
        const v = document.createElement('video');
        v.style.display = 'none';
        document.body.appendChild(v);
        InferenceState.videoEl = v;
      }
      InferenceState.videoEl.srcObject = InferenceState.videoStream;
      await InferenceState.videoEl.play();

      // 3) On loadedmetadata, start the 30 FPS loop
      InferenceState.videoEl.addEventListener('loadedmetadata', () => {
        if (!InferenceState.inferenceIntervalId) {
          InferenceState.inferenceIntervalId = setInterval(
            drawAndPredictFrame,
            1000 / 30
          );
        }
      });

      return true;
    } catch (err) {
      console.error("[Injected] _startCapture failed:", err);
      InferenceState.isCapturing = false;
      return false;
    }
  }

  // -------------------
  // 12) Function: _stopCapture
  //     - Clears interval, stops stream, clears canvas/UI
  // -------------------
  function _stopCapture() {
    if (!InferenceState.isCapturing) return;
    InferenceState.isCapturing = false;

    if (InferenceState.inferenceIntervalId) {
      clearInterval(InferenceState.inferenceIntervalId);
      InferenceState.inferenceIntervalId = null;
    }
    if (InferenceState.videoStream) {
      InferenceState.videoStream.getTracks().forEach(t => t.stop());
      InferenceState.videoStream = null;
    }
    if (UI.canvas) {
      const ctx = UI.canvas.getContext('2d');
      ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
    }
    if (UI.fps) UI.fps.textContent = '';
    if (UI.results) UI.results.innerHTML = '';
  }

  // -------------------
  // 13) Function: drawAndPredictFrame
  //     - Runs every ≈33ms: crops, infers, draws boxes/labels, sends metric
  // -------------------
  async function drawAndPredictFrame() {
    if (
      !InferenceState.isCapturing ||
      !InferenceState.modelLoaded ||
      !UI.canvas ||
      !AppState.mainRect ||
      !InferenceState.videoEl ||
      InferenceState.videoEl.videoWidth === 0
    ) {
      return;
    }

    // Prevent re-entrant calls
    if (InferenceState.isLock) return;
    InferenceState.isLock = true;

    const now = performance.now();
    const delta = now - InferenceState.lastFrameTime;
    if (delta > 0) {
      InferenceState.fps = Math.round(1000 / delta);
    }
    InferenceState.lastFrameTime = now;

    // Compute crop coords in video resolution
    const vw = InferenceState.videoEl.videoWidth;
    const vh = InferenceState.videoEl.videoHeight;
    const xRatio = AppState.mainRect.x / document.documentElement.clientWidth;
    const yRatio = AppState.mainRect.y / document.documentElement.clientHeight;
    const wRatio = AppState.mainRect.width / document.documentElement.clientWidth;
    const hRatio = AppState.mainRect.height / document.documentElement.clientHeight;
    const sx = xRatio * vw, sy = yRatio * vh;
    const sw = wRatio * vw, sh = hRatio * vh;
    if (sw <= 0 || sh <= 0) {
      InferenceState.isLock = false;
      return;
    }

    // Resize on-screen canvas for cropping
    const cw = Math.max(1, Math.floor(sw));
    const ch = Math.max(1, Math.floor(sh));
    UI.canvas.width = cw;
    UI.canvas.height = ch;

    // Draw the cropped frame
    const ctx = UI.canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    try {
      ctx.drawImage(
        InferenceState.videoEl,
        sx, sy, sw, sh,
        0, 0, cw, ch
      );
    } catch (drawErr) {
      console.error("[Injected] drawImage error:", drawErr);
      InferenceState.isLock = false;
      return;
    }

    // Extract ImageData
    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, cw, ch);
    } catch (e) {
      console.error("getImageData failed:", e);
      InferenceState.isLock = false;
      return;
    }

    // Run inference
    let predictions = [];
    const tInfStart = performance.now();
    try {
      const helpers = await import(
        chrome.runtime.getURL('dist/utils/modelHelpers.bundle.js')
      );
      if (InferenceState.modelDetails.inferenceTask === 'detection') {
        predictions = await helpers.detect(
          InferenceState.modelLoaded,
          imageData,
          InferenceState.modelDetails
        );
      } else {
        predictions = await helpers.predict(
          InferenceState.modelLoaded,
          imageData,
          InferenceState.modelDetails.inputShape,
          5
        );
      }
    } catch (err) {
      const tInfErr = performance.now();
      console.error("[Injected] Inference error:", err);
      chrome.runtime.sendMessage({
        target: 'worker',
        type: 'recordPerformanceMetric',
        metric: {
          type: 'inferenceError',
          location: 'injected',
          durationMs: parseFloat((tInfErr - tInfStart).toFixed(2)),
          error: err.message,
          fps: InferenceState.fps
        }
      });
      InferenceState.isLock = false;
      return;
    }
    const tInfEnd = performance.now();
    const infDuration = parseFloat((tInfEnd - tInfStart).toFixed(2));
    const totalFrameDuration = parseFloat((tInfEnd - now).toFixed(2));

    // Draw boxes or probabilities
    UI.results.innerHTML = '';
    if (predictions?.length > 0 && predictions[0].box) {
      // Detection
      predictions.forEach(p => {
        const { top, left, bottom, right } = p.box;
        const x = left * cw;
        const y = top * ch;
        const w = (right - left) * cw;
        const h = (bottom - top) * ch;
        const color = p.score < 0.5
          ? 'red'
          : (p.score < 0.75 ? 'yellow' : 'limegreen');
        _drawBoundingBox(ctx, x, y, w, h, color);
        _drawBoundingBoxText(
          ctx,
          x, y,
          p.label || `Class ${p.classId}`,
          (p.score || 0).toFixed(2),
          color
        );
      });
      UI.results.innerHTML = predictions
        .map(p => `<div>${p.label || `Class ${p.classId}`}: ${(p.score || 0).toFixed(2)}</div>`)
        .join('');
    } else if (predictions?.length > 0) {
      // Classification
      UI.results.innerHTML = predictions
        .map(p => `<div>${p.label}: ${p.probability.toFixed(2)}</div>`)
        .join('');
    } else {
      UI.results.innerHTML = "No predictions.";
    }

    UI.fps.textContent = `FPS: ${InferenceState.fps}`;

    // Send inference metric to service worker
    chrome.runtime.sendMessage({
      target: 'worker',
      type: 'recordPerformanceMetric',
      metric: {
        type: 'inference',
        location: 'injected',
        durationMs: infDuration,
        totalFrameProcessingMs: totalFrameDuration,
        fps: InferenceState.fps,
        modelType: InferenceState.modelDetails.inferenceTask,
        inputWidth: cw,
        inputHeight: ch
      }
    });

    InferenceState.isLock = false;
  }

  // -------------------
  // 14) Function: _drawBoundingBox
  //     - Draws a rectangular outline on the canvas
  // -------------------
  function _drawBoundingBox(ctx, left, top, width, height, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, width, height);
    ctx.restore();
  }

  // -------------------
  // 15) Function: _drawBoundingBoxText
  //     - Draws label+score background and text
  // -------------------
  function _drawBoundingBoxText(ctx, left, top, label, score, color) {
    ctx.save();
    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'top';
    const text = `${label}: ${score}`;
    const metrics = ctx.measureText(text);
    const padding = 4;
    const textW = metrics.width + padding * 2;
    const textH = 14 + padding * 2;
    let textX = left;
    let textY = top;
    if (textX + textW > ctx.canvas.width) textX = ctx.canvas.width - textW;
    if (textY + textH > ctx.canvas.height) textY = ctx.canvas.height - textH;
    textX = Math.max(0, textX);
    textY = Math.max(0, textY);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(textX, textY, textW, textH);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, textX + padding, textY + padding);
    ctx.restore();
  }

  // -------------------
  // 16) Function: _startDrawing
  //     - Enables the user to drag out a rectangle over the page
  // -------------------
  function _startDrawing(aspectRatio = null) {
    if (!UI.rect || !UI.overlay) return;
    if (aspectRatio) {
      AppState.aspectRatio = aspectRatio;
      localStorage.setItem('aspectRatio', aspectRatio);
    }
    UI.rect.classList.remove('active');
    UI.overlay.classList.add('active');

    let startX = 0, startY = 0, drawing = false;
    const originalOverflow = document.body.style.overflow;

    function handleOverlayMouseDown(e) {
      startX = e.clientX;
      startY = e.clientY;
      drawing = true;
      Object.assign(UI.rect.style, {
        left: `${startX}px`,
        top: `${startY}px`,
        width: '0px',
        height: '0px'
      });
      UI.rect.classList.add('active');
      document.body.style.overflow = 'hidden';

      document.addEventListener('mousemove', handleDocumentMouseMove);
      document.addEventListener('mouseup', handleDocumentMouseUp);
      UI.overlay.removeEventListener('mousedown', handleOverlayMouseDown);
    }
    UI.overlay.addEventListener('mousedown', handleOverlayMouseDown);

    function handleDocumentMouseMove(e) {
      if (!drawing) return;
      let width = Math.abs(e.clientX - startX);
      let height = Math.abs(e.clientY - startY);

      if (AppState.aspectRatio?.includes('x') && AppState.aspectRatio !== "0x0") {
        const [wA, hA] = AppState.aspectRatio.split('x').map(Number);
        if (wA > 0 && hA > 0) {
          height = width * (hA / wA);
        }
      }

      const rectX = e.clientX < startX ? e.clientX : startX;
      const rectY = e.clientY < startY ? e.clientY : startY;
      _updateRect(rectX, rectY, width, height);
    }

    function handleDocumentMouseUp() {
      if (!drawing) return;
      drawing = false;
      UI.overlay.classList.remove('active');
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      _saveRectState();
    }
  }

  // -------------------
  // 17) Function: _updateRect
  //     - Updates UI.rect position/size and AppState.mainRect
  // -------------------
  function _updateRect(x, y, width, height) {
    if (!UI.rect) return;
    AppState.mainRect = { x, y, width, height };
    Object.assign(UI.rect.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`
    });
  }

  // -------------------
  // 18) Function: _saveRectState
  //     - Persists AppState.mainRect into localStorage
  // -------------------
  function _saveRectState() {
    if (AppState.mainRect) {
      localStorage.setItem('rectState', JSON.stringify(AppState.mainRect));
    }
  }

  // -------------------
  // 19) Function: _onDragStart
  //     - Allows dragging any [data-dragable="true"] parent element
  // -------------------
  function _onDragStart(e) {
    e.preventDefault();
    const parent = e.target.closest('[data-dragable="true"]');
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const offsetX = e.clientX - parentRect.left;
    const offsetY = e.clientY - parentRect.top;

    function handleDrag(ev) {
      let x = ev.clientX - offsetX;
      let y = ev.clientY - offsetY;
      const maxX = window.innerWidth - parent.offsetWidth;
      const maxY = window.innerHeight - parent.offsetHeight;
      x = Math.min(Math.max(0, x), window.pageXOffset + maxX);
      y = Math.min(Math.max(0, y), window.pageYOffset + maxY);
      parent.style.left = `${x}px`;
      parent.style.top = `${y}px`;
      if (parent.classList.contains('__extension_aiScreen-rect')) {
        _updateRect(x, y, parentRect.width, parentRect.height);
      }
    }

    function stopDrag() {
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', stopDrag);
      if (parent.classList.contains('__extension_aiScreen-rect')) {
        _saveRectState();
      }
    }

    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
  }

  // -------------------
  // INITIAL INVOCATIONS
  // -------------------
  _initUIAndState();
  _setupUIEventListeners();
  _setupChromeMessageListener();
  await _initializeModels();
})();
