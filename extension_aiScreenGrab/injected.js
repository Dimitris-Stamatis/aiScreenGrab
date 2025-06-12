// injected.js
(async () => {
  // --- Global State ---
  const AppState = {
    aspectRatio: localStorage.getItem('aspectRatio') || '1x1',
    rect: JSON.parse(localStorage.getItem('rectState')) || null,
    isPredicting: localStorage.getItem('isPredicting') === 'true',
    mainRect: null,
  };

  // --- UI Elements ---
  let UI = {};

  // --- Initial Setup ---
  _initUIAndState();

  // --- Event Listeners ---
  _setupUIEventListeners();
  _setupChromeMessageListener();

  // --- Helpers ---

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
          <div class="__extension_aiScreen-canvasContainer">
            <div class="__extension_aiScreen-fps"></div>
            <canvas class="__extension_aiScreen-canvas"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  function _createDragIcon(src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Drag';
    img.className = '__extension_aiScreen-dragIcon';
    return img;
  }

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
      canvasContainer: document.querySelector('.__extension_aiScreen-canvasContainer'),
      modelUI: document.querySelector('.__extension_aiScreen-modelUI'),
      predictButton: document.querySelector('.__extension_aiScreen-predict'),
      configureModel: document.querySelector('.__extension_aiScreen-configureModel'),
      results: document.querySelector('.__extension_aiScreen-results'),
      fps: document.querySelector('.__extension_aiScreen-fps'),
    };

    const dragIconURL = chrome.runtime.getURL('icons/drag.svg');
    document.querySelectorAll('[data-dragable="true"]').forEach(el => {
      if (!el.querySelector('.__extension_aiScreen-dragIcon')) {
        el.appendChild(_createDragIcon(dragIconURL));
      }
    });
    UI.draggers = document.querySelectorAll('.__extension_aiScreen-dragIcon');

    _restoreRect();
    _updatePredictButton(AppState.isPredicting);
  }

  function _restoreRect() {
    if (!AppState.rect || !UI.rect) return;
    const { x, y, width, height } = AppState.rect;
    Object.assign(UI.rect.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    // MODIFICATION: Sync canvas container on restore
    if (UI.canvasContainer) {
      Object.assign(UI.canvasContainer.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
    }
    UI.rect.classList.add('active');
    AppState.mainRect = { ...AppState.rect };
  }

  function _updatePredictButton(isPredicting) {
    if (!UI.predictButton) return;
    if (isPredicting) {
      UI.predictButton.dataset.for = 'stop';
      UI.predictButton.textContent = 'Stop predictions';
    } else {
      UI.predictButton.dataset.for = 'start';
      UI.predictButton.textContent = 'Start predictions';
    }
  }

  function _setupUIEventListeners() {
    if (!UI.container) {
      console.warn("UI container not found, cannot setup UI event listeners.");
      return;
    }
    UI.redrawButton?.addEventListener('click', () => _startDrawing(AppState.aspectRatio));
    UI.configureModel?.addEventListener('click', () =>
      chrome.runtime.sendMessage({ target: 'worker', type: 'configureModel' })
    );
    UI.predictButton?.addEventListener('click', _togglePredictMode);
    UI.draggers?.forEach(dragger => dragger.addEventListener('mousedown', _onDragStart));
  }

  function _setupChromeMessageListener() {
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
      console.log('[Injected] Message received:', message);
      if (message.type === 'getViewportSize') {
        sendResponse({
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight
        });
        return;
      } else if (message.type === 'startDrawing') {
        if (!UI.container || !document.getElementById('__extension_aiScreen')) {
          _initUIAndState();
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        _startDrawing(message.aspectRatio);
      } else if (message.type === 'predictions') {
        _handlePredictions(message);
      } else if (message.type === 'reinjected') {
        _initUIAndState();
        _setupUIEventListeners();
        _enableUIElements();
        if (message.aspectRatio) {
          AppState.aspectRatio = message.aspectRatio;
          localStorage.setItem('aspectRatio', AppState.aspectRatio);
        }
      }
      return true;
    });
  }

  function _enableUIElements() {
    if (!UI.overlay || !UI.rect || !UI.modelUI || !UI.canvasContainer || !UI.results || !UI.fps) {
      return;
    }
    UI.overlay.classList.remove('active');
    UI.rect.classList.add('active');
    UI.modelUI.classList.add('active');
    UI.canvasContainer.classList.add('active');
    UI.results.classList.add('active');
    UI.fps.classList.add('active');
  }

  function _startDrawing(aspectRatio = null) {
    if (!UI.rect || !UI.overlay) {
      console.error("[Injected] Cannot start drawing, UI elements missing.");
      return;
    }
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
      Object.assign(UI.rect.style, { left: `${startX}px`, top: `${startY}px`, width: '0px', height: '0px' });
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
      if (AppState.aspectRatio && AppState.aspectRatio.includes('x')) {
        const parts = AppState.aspectRatio.split('x').map(Number);
        if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
          height = width * (parts[1] / parts[0]);
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
      UI.redrawButton?.classList.add('active');
      UI.modelUI?.classList.add('active');
      document.body.style.overflow = originalOverflow;
      AppState.mainRect = { x: parseInt(UI.rect.style.left), y: parseInt(UI.rect.style.top), width: parseInt(UI.rect.style.width), height: parseInt(UI.rect.style.height) };
      _saveRectState();
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    }
  }

  function _onDragStart(e) {
    e.preventDefault();
    const parent = e.target.closest('[data-dragable="true"]');
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const offsetX = e.clientX - parentRect.left;
    const offsetY = e.clientY - parentRect.top;
    const scrollX = window.pageXOffset;
    const scrollY = window.pageYOffset;

    function handleDrag(event) {
      const x = event.clientX - offsetX;
      const y = event.clientY - offsetY;
      const maxX = window.innerWidth - parent.offsetWidth;
      const maxY = window.innerHeight - parent.offsetHeight;
      const constrainedX = Math.min(Math.max(0, x), maxX) + scrollX;
      const constrainedY = Math.min(Math.max(0, y), maxY) + scrollY;
      parent.style.left = `${constrainedX}px`;
      parent.style.top = `${constrainedY}px`;
      if (parent.classList.contains('__extension_aiScreen-rect')) {
        _updateRect(constrainedX, constrainedY, parseInt(parent.style.width), parseInt(parent.style.height));
      }
    }

    function stopDrag() {
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', stopDrag);
      if (parent.classList.contains('__extension_aiScreen-rect')) {
        AppState.mainRect = { x: parseInt(parent.style.left), y: parseInt(parent.style.top), width: parseInt(parent.style.width), height: parseInt(parent.style.height) };
        _saveRectState();
      }
    }
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
  }

  function _togglePredictMode(e) {
    const currentAction = e.target.dataset.for;
    const newAction = currentAction === 'start' ? 'stop' : 'start';
    AppState.isPredicting = newAction === 'stop';
    _updatePredictButton(AppState.isPredicting);
    localStorage.setItem('isPredicting', AppState.isPredicting.toString());
    chrome.runtime.sendMessage({ target: 'worker', type: 'predict', action: currentAction, targetTabId: chrome.devtools?.inspectedWindow?.tabId || null });
  }

  function _handlePredictions({ predictions, fps }) {
    // **** MODIFICATION HERE ****
    // If the user has clicked "Stop", ignore any late-arriving prediction messages.
    // This provides immediate visual feedback and stops expensive rendering work.
    if (!AppState.isPredicting) {
      console.log('[Injected] Ignoring stale predictions because AppState.isPredicting is false.');
      if (UI.canvas) {
        const ctx = UI.canvas.getContext('2d');
        ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
      }
      if (UI.results) UI.results.innerHTML = "Stopped.";
      if (UI.fps) UI.fps.textContent = 'FPS: 0';
      return;
    }

    if (!UI.canvas || !UI.results || !UI.fps) return;
    const ctx = UI.canvas.getContext('2d');
    const rectWidth = parseInt(UI.rect.style.width, 10);
    const rectHeight = parseInt(UI.rect.style.height, 10);

    if (!rectWidth || !rectHeight) {
      UI.fps.textContent = `FPS: ${fps || 0}`;
      return;
    }

    UI.canvas.width = rectWidth;
    UI.canvas.height = rectHeight;
    ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
    UI.results.innerHTML = '';

    if (predictions && predictions.length > 0 && predictions[0].box) {
      predictions.forEach(p => {
        const { top, left, bottom, right } = p.box;
        const x = left * UI.canvas.width;
        const y = top * UI.canvas.height;
        const width = (right - left) * UI.canvas.width;
        const height = (bottom - top) * UI.canvas.height;
        let color = p.score < 0.5 ? 'red' : (p.score < 0.75 ? 'yellow' : 'limegreen');
        _drawBoundingBox(ctx, x, y, width, height, color);
        _drawBoundingBoxText(ctx, x, y, p.label || `Class ${p.classId}`, p.score?.toFixed(2) || 'N/A', color);
      });
      UI.results.innerHTML = predictions.map(p => `<div>${p.label || `Class ${p.classId}`}: ${p.score?.toFixed(2) || 'N/A'}</div>`).join('');
    } else if (predictions && predictions.length > 0) {
      UI.results.innerHTML = predictions.map(p => `<div>${p.label}: ${p.probability?.toFixed(2) || 'N/A'}</div>`).join('');
    } else {
      UI.results.innerHTML = "No predictions.";
    }
    UI.fps.textContent = `FPS: ${fps || 0}`;
  }

  function _updateRect(x, y, width, height) {
    if (!UI.rect || !UI.canvasContainer) return;
    Object.assign(UI.rect.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    Object.assign(UI.canvasContainer.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    AppState.mainRect = { x, y, width, height };
    _saveRectState();
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'rectUpdate',
      rect: AppState.mainRect,
      layoutSize: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    }).catch(err => console.warn("Error sending rectUpdate to offscreen:", err));
  }

  function _saveRectState() {
    if (AppState.mainRect) {
      localStorage.setItem('rectState', JSON.stringify(AppState.mainRect));
    }
  }

  function _drawBoundingBox(ctx, left, top, width, height, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, width, height);
    ctx.restore();
  }

  function _drawBoundingBoxText(ctx, left, top, label, score, color) {
    ctx.save();
    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'top';
    const text = `${label}: ${score}`;
    const metrics = ctx.measureText(text);
    const padding = 4;
    const textW = metrics.width + padding * 2;
    const textH = 14 + padding * 2;
    let textX = Math.max(0, left);
    if (textX + textW > ctx.canvas.width) textX = ctx.canvas.width - textW;
    let textY = Math.max(0, top);
    if (textY + textH > ctx.canvas.height) textY = ctx.canvas.height - textH;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(textX, textY, textW, textH);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, textX + padding, textY + padding);
    ctx.restore();
  }
})();