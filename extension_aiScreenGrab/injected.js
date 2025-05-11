(async () => {
  // --- Global State ---
  const AppState = {
    aspectRatio: localStorage.getItem('aspectRatio') || '1x1',
    rect: JSON.parse(localStorage.getItem('rectState')) || null,
    isPredicting: localStorage.getItem('isPredicting') === 'true',
    mainRect: null,
    resizeTimeout: null,
  };

  // --- UI Elements ---
  const UI = _initUI();
  _restoreRect();
  _updatePredictButton(AppState.isPredicting);

  // --- Event Listeners ---
  _setupUIEventListeners();
  _setupChromeMessageListener();
  _setupWindowResizeListener();

  // --- Helpers ---
  function _initUI() {
    document.body.insertAdjacentHTML('beforeend', _getHTML());
    const dragIconURL = chrome.runtime.getURL('icons/drag.svg');
    document.querySelectorAll('[data-dragable="true"]').forEach(el => {
      el.appendChild(_createDragIcon(dragIconURL));
    });
    return {
      container: document.getElementById('__extension_aiScreen'),
      redrawButton: document.querySelector('.__extension_aiScreen-drawArea'),
      overlay: document.querySelector('.__extension_aiScreen-overlay'),
      rect: document.querySelector('.__extension_aiScreen-rect'),
      canvas: document.querySelector('.__extension_aiScreen-canvas'),
      modelUI: document.querySelector('.__extension_aiScreen-modelUI'),
      predictButton: document.querySelector('.__extension_aiScreen-predict'),
      configureModel: document.querySelector('.__extension_aiScreen-configureModel'),
      results: document.querySelector('.__extension_aiScreen-results'),
      draggers: document.querySelectorAll('.__extension_aiScreen-dragIcon'),
      fps: document.querySelector('.__extension_aiScreen-fps'),
    };
  }

  function _restoreRect() {
    if (!AppState.rect) return;
    Object.assign(UI.rect.style, {
      left: `${AppState.rect.x}px`,
      top: `${AppState.rect.y}px`,
      width: `${AppState.rect.width}px`,
      height: `${AppState.rect.height}px`,
    });
    UI.rect.classList.add('active');
    AppState.mainRect = { ...AppState.rect };
  }

  function _updatePredictButton(isPredicting) {
    if (isPredicting) {
      UI.predictButton.dataset.for = 'stop';
      UI.predictButton.textContent = 'Stop predictions';
    }
  }

  function _setupUIEventListeners() {
    UI.redrawButton.addEventListener('click', () => _startDrawing(AppState.aspectRatio));
    UI.configureModel.addEventListener('click', () =>
      chrome.runtime.sendMessage({ target: 'worker', type: 'configureModel' })
    );
    UI.predictButton.addEventListener('click', _togglePredictMode);
    UI.draggers.forEach(dragger => dragger.addEventListener('mousedown', _onDragStart));
  }

  function _setupChromeMessageListener() {
    chrome.runtime.onMessage.addListener(async message => {
      console.log('Message received:', message);
      if (message.type === 'startDrawing') {
        _startDrawing(message.aspectRatio);
      } else if (message.type === 'predictions') {
        _handlePredictions(message);
      } else if (message.type === 'reinjected') {
        _enableUIElements();
      }
      return true;
    });
  }

  function _setupWindowResizeListener() {
    window.addEventListener('resize', () => {
      clearTimeout(AppState.resizeTimeout);
      AppState.resizeTimeout = setTimeout(_sendWindowSizeToOffscreen, 200);
    });
    _sendWindowSizeToOffscreen(); // Initial send
  }

  function _enableUIElements() {
    UI.overlay.classList.remove('active');
    UI.rect.classList.add('active');
    UI.modelUI.classList.add('active');
    UI.canvas.classList.add('active');
    UI.results.classList.add('active');
    UI.fps.classList.add('active');
  }

  // --- UI Logic ---
  function _startDrawing(aspectRatio = null) {
    if (aspectRatio) {
      AppState.aspectRatio = aspectRatio;
      localStorage.setItem('aspectRatio', aspectRatio);
    }
    UI.rect.classList.remove('active');
    UI.overlay.classList.add('active');

    let startX = 0,
      startY = 0,
      drawing = false;
    const originalOverflow = document.body.style.overflow;

    UI.overlay.addEventListener(
      'mousedown',
      function handleMouseDown(e) {
        startX = e.clientX;
        startY = e.clientY;
        drawing = true;
        Object.assign(UI.rect.style, {
          left: `${startX}px`,
          top: `${startY}px`,
          width: '0px',
          height: '0px',
        });
        UI.rect.classList.add('active');
        document.body.style.overflow = 'hidden';
        UI.overlay.removeEventListener('mousedown', handleMouseDown);
      },
      { once: true }
    );

    function handleMouseMove(e) {
      if (!drawing) return;
      let currentX = e.clientX,
        currentY = e.clientY;
      let width = Math.abs(currentX - startX),
        height = Math.abs(currentY - startY);

      if (AppState.aspectRatio) {
        const [w, h] = AppState.aspectRatio.split('x').map(Number);
        const ratio = h / w;
        height = width * ratio;
      }

      const rectX = Math.min(startX, startX + width),
        rectY = Math.min(startY, startY + height);

      _updateRect(rectX, rectY, width, height);
    }

    function handleMouseUp() {
      drawing = false;
      UI.overlay.classList.remove('active');
      UI.redrawButton.classList.add('active');
      UI.modelUI.classList.add('active');
      document.body.style.overflow = originalOverflow;

      AppState.mainRect = {
        x: parseInt(UI.rect.style.left),
        y: parseInt(UI.rect.style.top),
        width: parseInt(UI.rect.style.width),
        height: parseInt(UI.rect.style.height),
      };
      _saveRectState();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  function _onDragStart(e) {
    e.preventDefault();
    const parent = e.target.parentElement;
    const offsetX = e.clientX - parent.getBoundingClientRect().left;
    const offsetY = e.clientY - parent.getBoundingClientRect().top;
    const maxX = window.innerWidth - parent.offsetWidth;
    const maxY = window.innerHeight - parent.offsetHeight;

    function handleDrag(event) {
      const x = Math.min(Math.max(0, event.clientX - offsetX), maxX);
      const y = Math.min(Math.max(0, event.clientY - offsetY), maxY);
      parent.style.left = `${x}px`;
      parent.style.top = `${y}px`;

      if (parent.classList.contains('__extension_aiScreen-rect')) {
        _updateRect(x, y, AppState.mainRect.width, AppState.mainRect.height);
      }
    }

    function stopDrag() {
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', stopDrag);
    }

    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
  }

  function _togglePredictMode(e) {
    const currentAction = e.target.dataset.for;
    if (!['start', 'stop'].includes(currentAction)) return;

    const newAction = currentAction === 'start' ? 'stop' : 'start';
    e.target.dataset.for = newAction;
    e.target.textContent = newAction === 'start' ? 'Start predictions' : 'Stop predictions';

    // include action so the worker can decide task type from IndexedDB modelDetails
    chrome.runtime.sendMessage({
      target: 'worker',
      type: 'predict',
      action: currentAction, // 'start' or 'stop'
    });
    localStorage.setItem('isPredicting', newAction === 'stop');
  }

  /**
   * Handle both classification & detection:
   *  - classification: array of {label, probability}
   *  - detection:      array of {box:{bottom, left, right, top}, class, score, label}
   */
  function _handlePredictions({ predictions, imageData, fps }) {
    const ctx = UI.canvas.getContext('2d');
    const reconstructed = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
    UI.canvas.width = imageData.width;
    UI.canvas.height = imageData.height;
    ctx.restore();
    ctx.putImageData(reconstructed, 0, 0);

    UI.results.innerHTML = ''; // clear old

    if (predictions.length && predictions[0].box) {
      // Object Detection
      predictions.forEach(p => {
        // unpack box coords
        const { top, left, bottom, right } = p.box;

        // 2) convert to pixels
        const x      = left   * UI.canvas.width;
        const y      = top    * UI.canvas.height;
        const width  = (right  - left)   * UI.canvas.width;
        const height = (bottom - top)    * UI.canvas.height;
        // pick color by score
        let color;
        if (p.score < 0.5) color = 'red';
        else if (p.score < 0.75) color = 'yellow';
        else color = 'limegreen';
        // draw on the image canvas
        _drawBoundingBox(ctx, x, y, width, height, color);
        _drawBoundingBoxText(ctx, x, y, p.label, p.score.toFixed(2), color);
      });
      UI.results.innerHTML = predictions
        .map(p => `<div>${p.label}: ${p.score.toFixed(2)}</div>`)
        .join('');
    } else {
      // Image Classification (existing logic)
      UI.results.innerHTML = predictions
        .map(p => `<div>${p.label}: ${p.probability.toFixed(2)}</div>`)
        .join('');
    }

    UI.fps.textContent = `FPS: ${fps}`;
  }

  function _updateRect(x, y, width, height) {
    Object.assign(UI.rect.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    AppState.mainRect = { x, y, width, height };
    _saveRectState();
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'rectUpdate',
      rect: AppState.mainRect,
      layoutSize: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
    });
  }

  function _saveRectState() {
    localStorage.setItem('rectState', JSON.stringify(AppState.mainRect));
  }

  function _sendWindowSizeToOffscreen() {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'windowResize',
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
    });
  }

  function _createDragIcon(src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Drag';
    img.className = '__extension_aiScreen-dragIcon';
    return img;
  }

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

  function _drawBoundingBox(ctx, left, top, width, height, color) {
    ctx.save();
    console.log("Drawing bounding box", { left, top, width, height });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, width, height);
  }

  function _drawBoundingBoxText(ctx, left, top, label, score, color) {
    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'top';
    // measure text
    const text = `${label}: ${score}`;
    const metrics = ctx.measureText(text);
    const padding = 4;
    const textW = metrics.width + padding * 2;
    const textH = 14 + padding * 2;
    // draw background box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(left, top, textW, textH);
    // draw text
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, left + padding, top + padding);
  }
})();
