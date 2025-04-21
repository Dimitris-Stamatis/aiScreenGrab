(async () => {
    // --- Inject the Extension UI ---
    const extensionHTML = `
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
          <canvas class="__extension_aiScreen-canvas"></canvas>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', extensionHTML);

    // --- Create and Append Drag Icon ---
    const dragIconURL = chrome.runtime.getURL('icons/drag.svg');
    const createDragIcon = () => {
        const icon = document.createElement('img');
        icon.src = dragIconURL;
        icon.alt = 'Drag';
        icon.classList.add('__extension_aiScreen-dragIcon');
        return icon;
    };

    document.querySelectorAll('#__extension_aiScreen [data-dragable="true"]').forEach((element) => {
        element.appendChild(createDragIcon());
    });

    // --- Initialize State from localStorage ---
    let aspectRatioLocal = localStorage.getItem('aspectRatio') || null;
    const rectState = JSON.parse(localStorage.getItem('rectState')) || null;
    const isPredicting = localStorage.getItem('isPredicting') === 'true';
    let mainRect = null;
    let rectX, rectY, rectWidth, rectHeight;

    // --- Cache UI Elements ---
    const container = document.getElementById('__extension_aiScreen');
    const ui = {
        redrawButton: container.querySelector('.__extension_aiScreen-drawArea'),
        overlay: container.querySelector('.__extension_aiScreen-overlay'),
        rect: container.querySelector('.__extension_aiScreen-rect'),
        canvas: container.querySelector('.__extension_aiScreen-canvas'),
        modelUI: container.querySelector('.__extension_aiScreen-modelUI'),
        predictButton: container.querySelector('.__extension_aiScreen-predict'),
        configureModel: container.querySelector('.__extension_aiScreen-configureModel'),
        results: container.querySelector('.__extension_aiScreen-results'),
        draggers: container.querySelectorAll('.__extension_aiScreen-dragIcon')
    };
    const videoElement = document.createElement('video');

    // --- Restore Saved Rectangle (if any) ---
    if (rectState) {
        ({ x: rectX, y: rectY, width: rectWidth, height: rectHeight } = rectState);
        Object.assign(ui.rect.style, {
            left: `${rectX}px`,
            top: `${rectY}px`,
            width: `${rectWidth}px`,
            height: `${rectHeight}px`
        });
        ui.rect.classList.add('active');
        mainRect = { x: rectX, y: rectY, width: rectWidth, height: rectHeight };
    }

    // --- Update Prediction Button if Already Active ---
    if (isPredicting) {
        ui.predictButton.dataset.for = 'stop';
        ui.predictButton.textContent = 'Stop predictions';
    }

    // --- UI Button Event Listeners ---
    ui.redrawButton.addEventListener('click', () => {
        startDrawing(aspectRatioLocal);
        ui.redrawButton.classList.remove('active');
    });

    ui.configureModel.addEventListener('click', () => {
        chrome.runtime.sendMessage({ target: 'worker', type: 'configureModel' });
    });

    // --- Listen for Messages from Background/Worker ---
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
        console.log('Message received:', message);
        switch (message.type) {
            case 'startDrawing': {
                console.log('Received startDrawing message:', message);
                startDrawing(message.aspectRatio);
                break;
            }
            case 'predictions': {
                const predictionsHTML = message.predictions
                    .map(({ label, probability }) => `<div>${label}: ${probability.toFixed(2)}</div>`)
                    .join('');
                ui.results.innerHTML = predictionsHTML;
                // update canvas with imagedata
                const reconstructedImageData = new ImageData(
                    new Uint8ClampedArray(message.imageData.data),
                    message.imageData.width,
                    message.imageData.height
                );
                const canvas = ui.canvas;
                const context = canvas.getContext('2d');
                canvas.width = message.imageData.width;
                canvas.height = message.imageData.height;
                context.putImageData(reconstructedImageData, 0, 0);
                break;
            }
        }
        return true;
    });

    // --- Drawing Functionality ---
    function startDrawing(aspectRatio = null) {
        if (aspectRatio) {
            aspectRatioLocal = aspectRatio;
            localStorage.setItem('aspectRatio', aspectRatio);
        }
        if (!aspectRatioLocal) {
            aspectRatioLocal = '1x1';
        }

        ui.rect.classList.remove('active');
        ui.overlay.classList.add('active');

        let startX = 0;
        let startY = 0;
        let drawing = false;
        const originalBodyOverflow = document.body.style.overflow;

        const handleMouseDown = (e) => {
            startX = e.clientX;
            startY = e.clientY + window.scrollY;
            drawing = true;

            Object.assign(ui.rect.style, {
                left: `${startX}px`,
                top: `${startY}px`,
                width: '0px',
                height: '0px'
            });
            ui.rect.classList.add('active');
            document.body.style.overflow = 'hidden';
            ui.overlay.removeEventListener('mousedown', handleMouseDown);
        };

        const handleMouseMove = (e) => {
            if (!drawing) return;
            const currentX = e.clientX;
            const currentY = e.clientY + window.scrollY;

            rectWidth = Math.abs(currentX - startX);
            rectHeight = Math.abs(currentY - startY);

            if (aspectRatioLocal) {
                const [w, h] = aspectRatioLocal.split('x').map(Number);
                const ratio = h / w;
                let adjustedHeight = rectWidth * ratio;

                if (startY + adjustedHeight > window.innerHeight) {
                    adjustedHeight = window.innerHeight - startY;
                    rectWidth = adjustedHeight / ratio;
                }
                if (startX + rectWidth > window.innerWidth) {
                    rectWidth = window.innerWidth - startX;
                    adjustedHeight = rectWidth * ratio;
                }
                rectHeight = adjustedHeight;
            }

            rectX = Math.min(startX, startX + rectWidth);
            rectY = Math.min(startY, startY + rectHeight);

            updateRectStyle(rectX, rectY, rectWidth, rectHeight);
        };

        const handleMouseUp = () => {
            drawing = false;
            ui.overlay.classList.remove('active');
            ui.redrawButton.classList.add('active');
            ui.modelUI.classList.add('active');
            document.body.style.overflow = originalBodyOverflow;

            mainRect = { x: rectX, y: rectY, width: rectWidth, height: rectHeight };
            updateRectStyle(rectX, rectY, rectWidth, rectHeight);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        ui.overlay.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    // --- Draggable Elements ---
    ui.draggers.forEach((dragger) => {
        dragger.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const parentElement = e.target.parentElement;
            const parentRect = parentElement.getBoundingClientRect();
            const offsetX = e.clientX - parentRect.left;
            const offsetY = e.clientY - parentRect.top;
            const maxX = window.innerWidth - parentRect.width;
            const maxY = window.innerHeight - parentRect.height;
            // Track the initial position
            let dragX = parentRect.left;
            let dragY = parentRect.top;

            const handleDrag = (event) => {
                dragX = Math.min(Math.max(0, event.clientX - offsetX), maxX);
                dragY = Math.min(Math.max(0, event.clientY - offsetY), maxY);
                parentElement.style.left = `${dragX}px`;
                parentElement.style.top = `${dragY}px`;
            };

            const stopDrag = () => {
                document.removeEventListener('mousemove', handleDrag);
                document.removeEventListener('mouseup', stopDrag);
                // Update the main rectangle's position if this is the main draggable element
                if (parentElement.classList.contains('__extension_aiScreen-rect')) {
                    updateRectStyle(dragX, dragY, rectWidth, rectHeight);
                }
            };

            document.addEventListener('mousemove', handleDrag);
            document.addEventListener('mouseup', stopDrag);
        });
    });

    // --- Update Rectangle Style and Save State ---
    function updateRectStyle(x, y, width, height) {
        ui.rect.style.left = `${x}px`;
        ui.rect.style.top = `${y}px`;
        ui.rect.style.width = `${width}px`;
        ui.rect.style.height = `${height}px`;

        mainRect = { x, y, width, height };
        localStorage.setItem('rectState', JSON.stringify(mainRect));
        chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'rectUpdate',
            rect: mainRect,
            yoffset: window.scrollY,
            windowSize: {
                width: window.innerWidth,
                height: window.innerHeight
            }
        });
    }

    // --- Toggle Prediction Mode ---
    ui.predictButton.addEventListener('click', async (e) => {
        const currentAction = e.target.dataset.for;
        if (currentAction !== 'start' && currentAction !== 'stop') return;

        const newAction = currentAction === 'start' ? 'stop' : 'start';
        e.target.dataset.for = newAction;
        e.target.textContent = newAction === 'start' ? 'Start predictions' : 'Stop predictions';

        chrome.runtime.sendMessage({ target: 'worker', type: 'predict', action: currentAction });
        localStorage.setItem('isPredicting', currentAction === 'start');
    });


    window.addEventListener('resize', () => {
        sendWindowSizeToOffscren();
    });

    function sendWindowSizeToOffscren() {
        // send window width and height to the offscreen document
        chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'windowResize',
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight
        });
    }
    sendWindowSizeToOffscren();
})();
