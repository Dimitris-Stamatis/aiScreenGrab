(async () => {
    const htmltoinject = `
    <div id="__extension_aiScreen">
        <div class="__extension_aiScreen-modelUI">
            <button class="__extension_aiScreen-predict">Start predictions</button>
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
        configureModel: container.querySelector('.__extension_aiScreen-configureModel'),
        video: document.createElement('video'),
    };
    console.log(uiElements);
    uiElements.redrawButton.addEventListener('click', () => {
        startDrawing(aspectRatioLocal);
        uiElements.redrawButton.classList.remove('active');
    });

    uiElements.configureModel.addEventListener('click', () => {
        chrome.runtime.sendMessage({ target: 'worker', type: 'configureModel' });
    });

    // listen for messages from the background script
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
        console.log('message received:', message);
        switch (message.type) {
            case 'startDrawing':
                console.log('start drawing');
                startDrawing(message.aspectRatio);
                sendResponse({ success: true });
                break;
            case 'stopCapture':
                console.log('stop capture');
                break;
            case 'start-recording':
                console.log('start recording');
                break;
            case 'talktocontent':
                console.log('talk to content');
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
        }

        function handleMouseMove(e) {
            if (!drawing) return;
            const currentX = e.clientX;
            const currentY = e.clientY;

            // Calculate rectangle dimensions
            rectWidth = Math.abs(currentX - startX);
            rectHeight = Math.abs(currentY - startY);

            if (aspectRatioLocal) { // Maintain aspect ratio while keeping the width correct
                const ratio = aspectRatioLocal.split('x').map(Number);
                // width should be on the X of the mouse and height should be from ascpet ratio
                const newHeight = rectWidth * (ratio[1] / ratio[0]);
                if (currentY < startY) {
                    startY = currentY;
                    rectHeight = newHeight;
                } else {
                    rectHeight = newHeight;
                }
            }

            // Set rectangle styles based on current mouse position

            rectX = Math.min(startX, currentX);
            uiElements.rect.style.left = `${rectX}px`;
            rectY = Math.min(startY, currentY);
            uiElements.rect.style.top = `${rectY}px`;
            uiElements.rect.style.width = `${rectWidth}px`;
            uiElements.rect.style.height = `${rectHeight}px`;
        }

        function handleMouseUp(e) {
            drawing = false;
            uiElements.overlay.classList.remove('active');
            uiElements.redrawButton.classList.add('active');
            uiElements.modelUI.classList.add('active');
        }
    }

    /*await chrome.runtime.sendMessage({ type: 'loadModel' }, (res) => {
        if (res.success)
            console.log('Model loaded');
        else
            console.log('Model not loaded');
    });*/
})();