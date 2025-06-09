(async () => {
  // --- Global State ---
  const AppState = {
    aspectRatio: localStorage.getItem('aspectRatio') || '1x1',
    rect: JSON.parse(localStorage.getItem('rectState')) || null,
    isPredicting: localStorage.getItem('isPredicting') === 'true',
    mainRect: null,
    resizeTimeout: null,
  };

  // --- UI Elements (will be populated by _initUI) ---
  let UI = {}; // Initialize as an empty object

  // --- Initial Setup ---
  _initUIAndState(); // New function to handle initial setup

  // --- Event Listeners ---
  _setupUIEventListeners();
  _setupChromeMessageListener();
  _setupWindowResizeListener();

  // --- Helpers ---

  function _getHTML() { // Moved _getHTML up as it's needed by _initUI
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

  function _createDragIcon(src) { // Moved _createDragIcon up as it's needed by _initUI
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Drag';
    img.className = '__extension_aiScreen-dragIcon';
    return img;
  }

  function _initUIAndState() {
    // 1. Inject HTML first
    // Check if UI already exists to prevent multiple injections on re-injection
    if (document.getElementById('__extension_aiScreen')) {
        console.log("AI Screen UI already exists. Skipping HTML injection.");
    } else {
        document.body.insertAdjacentHTML('beforeend', _getHTML());
    }

    // 2. Now that HTML is in the DOM, select the elements
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
      draggers: document.querySelectorAll('.__extension_aiScreen-dragIcon'), // Will be empty until icons added
      fps: document.querySelector('.__extension_aiScreen-fps'),
    };

    // 3. Add drag icons (now that UI elements are selected)
    const dragIconURL = chrome.runtime.getURL('icons/drag.svg');
    // Ensure UI.modelUI and UI.rect are valid before trying to append children
    // This needs to target elements marked as data-dragable AFTER they are in UI object
    document.querySelectorAll('[data-dragable="true"]').forEach(el => {
        // Check if icon already exists for this element to prevent duplicates on re-injection
        if (!el.querySelector('.__extension_aiScreen-dragIcon')) {
            el.appendChild(_createDragIcon(dragIconURL));
        }
    });
    // Re-query for draggers after adding them
    UI.draggers = document.querySelectorAll('.__extension_aiScreen-dragIcon');


    // 4. Restore previous state
    _restoreRect();
    _updatePredictButton(AppState.isPredicting);
  }


  function _restoreRect() {
    if (!AppState.rect || !UI.rect) return; // Check if UI.rect exists
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
    if (!UI.predictButton) return; // Check if UI.predictButton exists
    if (isPredicting) {
      UI.predictButton.dataset.for = 'stop';
      UI.predictButton.textContent = 'Stop predictions';
    } else {
      UI.predictButton.dataset.for = 'start';
      UI.predictButton.textContent = 'Start predictions';
    }
  }

  function _setupUIEventListeners() {
    // Ensure UI elements exist before adding listeners
    // This is important if the script is re-injected and _initUIAndState might not have fully run
    // or if an error occurred during its execution.
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
      if (message.type === 'startDrawing') {
        // If UI is not fully initialized (e.g. on first load after config), ensure it is
        if (!UI.container || !document.getElementById('__extension_aiScreen')) {
            console.log("[Injected] UI not ready for startDrawing, re-initializing.");
            _initUIAndState(); // Re-initialize if needed
            // Might need a small delay for DOM updates after _initUIAndState if it injects HTML
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        _startDrawing(message.aspectRatio);
      } else if (message.type === 'predictions') {
        _handlePredictions(message);
      } else if (message.type === 'reinjected') {
        console.log("[Injected] 'reinjected' message received. Ensuring UI is up.");
        // UI might have been cleared or tab reloaded. Re-initialize.
        _initUIAndState();
        // After re-init, ensure event listeners are also re-attached if they were lost
        _setupUIEventListeners();
        _enableUIElements(); // Ensure UI is visible
         // If aspect ratio is sent with reinjected message, apply it
        if (message.aspectRatio) {
            AppState.aspectRatio = message.aspectRatio;
            localStorage.setItem('aspectRatio', AppState.aspectRatio);
        }
      }
      return true; // Keep channel open for async response if any
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
    if (!UI.overlay || !UI.rect || !UI.modelUI || !UI.canvas || !UI.results || !UI.fps) {
        console.warn("[Injected] Some UI elements missing, cannot fully enable UI.");
        return;
    }
    UI.overlay.classList.remove('active');
    UI.rect.classList.add('active');
    UI.modelUI.classList.add('active');
    UI.canvas.classList.add('active');
    UI.results.classList.add('active');
    UI.fps.classList.add('active');
  }

  // --- UI Logic ---
  function _startDrawing(aspectRatio = null) {
    // Ensure UI is ready
    if (!UI.rect || !UI.overlay) {
        console.warn("[Injected] Drawing UI not ready, attempting re-initialization for _startDrawing.");
        _initUIAndState(); // Try to re-initialize
         // If UI is still not ready after re-init, bail.
        if (!UI.rect || !UI.overlay) {
            console.error("[Injected] Cannot start drawing, UI elements (rect/overlay) missing after re-init.");
            return;
        }
    }

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

    // Use a named function for the event listener to allow for proper removal
    function handleOverlayMouseDown(e) {
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
      document.body.style.overflow = 'hidden'; // Prevent scrolling while drawing
      
      // Add mousemove and mouseup listeners to document for broader capture
      document.addEventListener('mousemove', handleDocumentMouseMove);
      document.addEventListener('mouseup', handleDocumentMouseUp);

      // Remove this mousedown listener after it has run once
      UI.overlay.removeEventListener('mousedown', handleOverlayMouseDown);
    }
    
    // Remove any existing listener before adding a new one to prevent duplicates
    // This requires handleOverlayMouseDown to be a stable function reference if _startDrawing can be called multiple times
    // For simplicity here, assuming this setup path is clean or UI.overlay is fresh.
    // If _startDrawing can be re-entrant with existing listeners, more careful management is needed.
    UI.overlay.addEventListener('mousedown', handleOverlayMouseDown);


    function handleDocumentMouseMove(e) {
      if (!drawing) return;
      let currentX = e.clientX,
        currentY = e.clientY;
      let width = Math.abs(currentX - startX),
        height = Math.abs(currentY - startY);

      if (AppState.aspectRatio && AppState.aspectRatio !== "0x0" && AppState.aspectRatio.includes('x')) { // check for valid aspect ratio string
        const parts = AppState.aspectRatio.split('x').map(Number);
        if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
            const [w, h] = parts;
            const ratio = h / w;
            height = width * ratio;
        }
      }


      // Adjust for drawing direction
      const rectX = currentX < startX ? currentX : startX;
      const rectY = currentY < startY ? currentY : startY;

      _updateRect(rectX, rectY, width, height);
    }

    function handleDocumentMouseUp() {
      if (!drawing) return; // Ensure this only runs if drawing was active
      drawing = false;
      UI.overlay.classList.remove('active');
      UI.redrawButton?.classList.add('active'); // Check if redrawButton exists
      UI.modelUI?.classList.add('active');    // Check if modelUI exists
      document.body.style.overflow = originalOverflow; // Restore original overflow

      AppState.mainRect = {
        x: parseInt(UI.rect.style.left),
        y: parseInt(UI.rect.style.top),
        width: parseInt(UI.rect.style.width),
        height: parseInt(UI.rect.style.height),
      };
      _saveRectState();
      
      // Clean up document-level listeners
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);

      // Re-add the mousedown listener to the overlay for the next drawing session
      // if you want the user to be able to immediately redraw without clicking "Draw Area" again.
      // Or, rely on the "Draw Area" button to call _startDrawing() again.
      // For now, let's assume "Draw Area" button is the way to re-initiate.
    }
  }

  function _onDragStart(e) {
    e.preventDefault();
    const parent = e.target.closest('[data-dragable="true"]'); // Use closest to get the draggable parent
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const offsetX = e.clientX - parentRect.left;
    const offsetY = e.clientY - parentRect.top;
    
    // Max coordinates should account for the scroll position of the page
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;


    function handleDrag(event) {
      const x = event.clientX - offsetX;
      const y = event.clientY - offsetY;

      // Boundary checks against viewport dimensions
      const maxX = window.innerWidth - parent.offsetWidth;
      const maxY = window.innerHeight - parent.offsetHeight;

      const constrainedX = Math.min(Math.max(0, x), maxX) + scrollX;
      const constrainedY = Math.min(Math.max(0, y), maxY) + scrollY;

      parent.style.left = `${constrainedX}px`;
      parent.style.top = `${constrainedY}px`;

      if (parent.classList.contains('__extension_aiScreen-rect') && AppState.mainRect) {
        _updateRect(constrainedX, constrainedY, AppState.mainRect.width, AppState.mainRect.height);
      }
    }

    function stopDrag() {
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', stopDrag);
      // If dragging the main rect, save its final position
      if (parent.classList.contains('__extension_aiScreen-rect')) {
        AppState.mainRect = {
            x: parseInt(parent.style.left),
            y: parseInt(parent.style.top),
            width: parseInt(parent.style.width),
            height: parseInt(parent.style.height),
        };
        _saveRectState();
      }
    }

    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
  }

  function _togglePredictMode(e) {
    if (!e.target) return;
    const currentAction = e.target.dataset.for;
    if (!['start', 'stop'].includes(currentAction)) return;

    const newAction = currentAction === 'start' ? 'stop' : 'start';
    e.target.dataset.for = newAction;
    e.target.textContent = newAction === 'start' ? 'Start predictions' : 'Stop predictions';

    chrome.runtime.sendMessage({
      target: 'worker',
      type: 'predict',
      action: currentAction,
      targetTabId: chrome.devtools?.inspectedWindow?.tabId || null // Best effort for tabId, might not be available
    }).catch(err => console.error("Error sending predict message:", err));

    AppState.isPredicting = newAction === 'stop'; // Update AppState based on the NEW state
    localStorage.setItem('isPredicting', AppState.isPredicting.toString());
  }


  function _handlePredictions({ predictions, imageData, fps }) {
    if (!UI.canvas || !UI.results || !UI.fps) {
        console.warn("[Injected] UI elements for predictions not ready.");
        return;
    }
    const ctx = UI.canvas.getContext('2d');
    if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
        console.warn("[Injected] Invalid imageData received for predictions.");
        UI.fps.textContent = `FPS: ${fps || 0}`; // Still update FPS
        return;
    }

    const reconstructed = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
    UI.canvas.width = imageData.width;
    UI.canvas.height = imageData.height;
    ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height); // Clear before drawing
    ctx.putImageData(reconstructed, 0, 0);

    UI.results.innerHTML = '';

    if (predictions && predictions.length > 0 && predictions[0].box) {
      predictions.forEach(p => {
        const { top, left, bottom, right } = p.box;
        const x = left * UI.canvas.width;
        const y = top * UI.canvas.height;
        const width = (right - left) * UI.canvas.width;
        const height = (bottom - top) * UI.canvas.height;
        
        let color = 'yellow'; // Default color
        if (p.score) { // Check if score exists
            if (p.score < 0.5) color = 'red';
            else if (p.score < 0.75) color = 'yellow';
            else color = 'limegreen';
        }

        _drawBoundingBox(ctx, x, y, width, height, color);
        _drawBoundingBoxText(ctx, x, y, p.label || `Class ${p.classId}`, p.score?.toFixed(2) || 'N/A', color);
      });
      UI.results.innerHTML = predictions
        .map(p => `<div>${p.label || `Class ${p.classId}`}: ${p.score?.toFixed(2) || 'N/A'}</div>`)
        .join('');
    } else if (predictions && predictions.length > 0) {
      UI.results.innerHTML = predictions
        .map(p => `<div>${p.label}: ${p.probability?.toFixed(2) || 'N/A'}</div>`)
        .join('');
    } else {
        UI.results.innerHTML = "No predictions.";
    }

    UI.fps.textContent = `FPS: ${fps || 0}`;
  }

  function _updateRect(x, y, width, height) {
    if (!UI.rect) return;
    Object.assign(UI.rect.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    AppState.mainRect = { x, y, width, height };
    _saveRectState(); // Save immediately on update

    // Debounce sending rect updates to offscreen if needed, or send directly
    // For simplicity, sending directly here.
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'rectUpdate',
      rect: AppState.mainRect,
      layoutSize: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
    }).catch(err => console.warn("Error sending rectUpdate to offscreen:", err));
  }

  function _saveRectState() {
    if (AppState.mainRect) {
      localStorage.setItem('rectState', JSON.stringify(AppState.mainRect));
    }
  }

  function _sendWindowSizeToOffscreen() {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'windowResize',
      windowWidth: document.documentElement.clientWidth, // Viewport width
      windowHeight: document.documentElement.clientHeight, // Viewport height
      devicePixelRatio: window.devicePixelRatio,
    }).catch(err => console.warn("Error sending windowResize to offscreen:", err));
  }


  function _drawBoundingBox(ctx, left, top, width, height, color) {
    ctx.save();
    // console.log("Drawing bounding box", { left, top, width, height }); // Can be noisy
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, width, height);
    ctx.restore(); // Restore context state
  }

  function _drawBoundingBoxText(ctx, left, top, label, score, color) {
    ctx.save(); // Save context state
    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'top';
    const text = `${label}: ${score}`;
    const metrics = ctx.measureText(text);
    const padding = 4;
    const textW = metrics.width + padding * 2;
    const textH = 14 + padding * 2; // Approximate height for 14px font

    // Ensure text box doesn't go off-canvas to the right
    let textX = left;
    if (textX + textW > ctx.canvas.width) {
        textX = ctx.canvas.width - textW;
    }
    // Ensure text box doesn't go off-canvas to the bottom (less common for top alignment)
    let textY = top;
    if (textY + textH > ctx.canvas.height) {
        textY = ctx.canvas.height - textH;
    }
    // Ensure text box doesn't go off-canvas to the left/top (if rect is at edge)
    textX = Math.max(0, textX);
    textY = Math.max(0, textY);


    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; // Slightly more opaque background
    ctx.fillRect(textX, textY, textW, textH);
    
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, textX + padding, textY + padding);
    ctx.restore(); // Restore context state
  }

})();