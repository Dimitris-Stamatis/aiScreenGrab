(async () => {
    const htmltoinject = `
    <div id="__extension_aiScreen">
        <div class="__extension_aiScreen-modelUI">
            <button class="__extension_aiScreen-predict" data-for="start">Start predictions</button>
            <button class="__extension_aiScreen-drawArea">Draw Area</button>
            <button class="__extension_aiScreen-configureModel">Configure Model</button>
            <div class="__extension_aiScreen-results"></div>
        </div>
        <div class="__extension_aiScreen-overlayElements">
            <div class="__extension_aiScreen-overlay"></div>
            <div class="__extension_aiScreen-rect"></div>
            <canvas class="__extension_aiScreen-canvas"></canvas>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', htmltoinject);
    let aspectRatioLocal = null;
    const container = document.getElementById('__extension_aiScreen');
    console.log('injected');
    let rectX, rectY, rectWidth, rectHeight;
    const uiElements = {
        redrawButton: container.querySelector('.__extension_aiScreen-drawArea'),
        overlay: container.querySelector('.__extension_aiScreen-overlay'),
        rect: container.querySelector('.__extension_aiScreen-rect'),
        canvas: container.querySelector('.__extension_aiScreen-canvas'),
        modelUI: container.querySelector('.__extension_aiScreen-modelUI'),
        predictbutton: container.querySelector('.__extension_aiScreen-predict'),
        configureModel: container.querySelector('.__extension_aiScreen-configureModel'),
        video: document.createElement('video'),
        results: container.querySelector('.__extension_aiScreen-results')
    };
    console.log(uiElements);
    uiElements.redrawButton.addEventListener('click', () => {
        startDrawing(aspectRatioLocal);
        uiElements.redrawButton.classList.remove('active');
    });

    uiElements.configureModel.addEventListener('click', () => {
        chrome.runtime.sendMessage({ target: 'worker', type: 'configureModel' });
    });

    uiElements.predictbutton.addEventListener('click', (e) => {
        const action = e.target.dataset.for;
        if (action != 'start' && action != 'stop')
            return;
        chrome.runtime.sendMessage({ target: 'worker', type: 'predict', action });
        e.target.dataset.for = action === 'start' ? 'stop' : 'start';
        e.target.textContent = action === 'start' ? 'Stop predictions' : 'Start predictions';
    });

    // listen for messages from the background script
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
        console.log('message received:', message);
        switch (message.type) {
            case 'startDrawing':
                console.log('start drawing');
                startDrawing(message.aspectRatio);
                break;
            case 'predictions':
                const results = message.predictions.map(({ label, probability }) => {
                    return `<div>${label}: ${probability.toFixed(2)}</div>`;
                }).join('');
                uiElements.results.innerHTML = results;
                const reconstructedImageData = new ImageData(
                    new Uint8ClampedArray(message.imageData.data),  // Convert back to Uint8ClampedArray
                    message.imageData.width,
                    message.imageData.height
                );
                uiElements.canvas.width = message.imageData.width;
                uiElements.canvas.height = message.imageData.height;
                const ctx = uiElements.canvas.getContext('2d');
                ctx.putImageData(reconstructedImageData, 0, 0);
                break;
        }
        return true;
    });

    function startDrawing(aspectRatio = null) {
        if (aspectRatio) {
            aspectRatioLocal = aspectRatio;
        }
        if (!aspectRatioLocal) {
            aspectRatioLocal = '1x1';
        }
        uiElements.rect.classList.remove('active');
        uiElements.overlay.classList.add('active');
        // Draw a rectangular box on the screen
        let startX = 0;
        let startY = 0;
        let drawing = false;
        uiElements.overlay.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        const bodyOverflowBak = document.body.style.overflow;

        function handleMouseDown(e) {
            startX = e.clientX;
            startY = e.clientY;
            drawing = true;

            // Set initial position and size
            uiElements.rect.style.left = `${startX}px`;
            uiElements.rect.style.top = `${startY}px`;
            uiElements.rect.style.width = `0px`;
            uiElements.rect.style.height = `0px`;
            uiElements.rect.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function handleMouseMove(e) {
            if (!drawing) return;
            const currentX = e.clientX;
            const currentY = e.clientY;

            // Calculate initial rectangle dimensions
            rectWidth = Math.abs(currentX - startX);
            rectHeight = Math.abs(currentY - startY);

            if (aspectRatioLocal) { // Maintain aspect ratio while keeping the width correct
                const ratio = aspectRatioLocal.split('x').map(Number);
                const aspectRatio = ratio[1] / ratio[0];

                // Calculate height based on the aspect ratio and width
                let newHeight = rectWidth * aspectRatio;

                // Adjust height if rectangle would extend below the viewport
                if (rectY + newHeight > window.innerHeight) {
                    newHeight = window.innerHeight - rectY;
                    rectWidth = newHeight / aspectRatio; // Adjust width to maintain aspect ratio
                }

                // Adjust width if rectangle would extend beyond the viewport
                if (rectX + rectWidth > window.innerWidth) {
                    rectWidth = window.innerWidth - rectX;
                    newHeight = rectWidth * aspectRatio; // Adjust height to maintain aspect ratio
                }

                rectHeight = newHeight;
            }

            // Update rectangle position to be within viewport
            rectX = Math.min(Math.max(0, startX), window.innerWidth - rectWidth);
            rectY = Math.min(Math.max(0, startY), window.innerHeight - rectHeight);

            // Set rectangle styles based on current mouse position
            uiElements.rect.style.left = `${rectX}px`;
            uiElements.rect.style.top = `${rectY}px`;
            uiElements.rect.style.width = `${rectWidth}px`;
            uiElements.rect.style.height = `${rectHeight}px`;
        }

        function handleMouseUp(e) {
            drawing = false;
            uiElements.overlay.classList.remove('active');
            uiElements.redrawButton.classList.add('active');
            uiElements.modelUI.classList.add('active');
            document.body.style.overflow = bodyOverflowBak;
            chrome.runtime.sendMessage({
                target: 'worker',
                type: 'rectUpdate',
                rect: { x: rectX, y: rectY, width: rectWidth, height: rectHeight }
            });
        }
    }
})();