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
    
    let aspectRatioLocal = localStorage.getItem('aspectRatio') || null;
    let rectState = JSON.parse(localStorage.getItem('rectState')) || null;
    let isPredicting = localStorage.getItem('isPredicting') === 'true';
    
    const container = document.getElementById('__extension_aiScreen');
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
    
    if (rectState) {
        // Restore rectangle if saved in localStorage
        rectX = rectState.x;
        rectY = rectState.y;
        rectWidth = rectState.width;
        rectHeight = rectState.height;
        uiElements.rect.style.left = `${rectX}px`;
        uiElements.rect.style.top = `${rectY}px`;
        uiElements.rect.style.width = `${rectWidth}px`;
        uiElements.rect.style.height = `${rectHeight}px`;
        uiElements.rect.classList.add('active');
    }
    
    if (isPredicting) {
        uiElements.predictbutton.dataset.for = 'stop';
        uiElements.predictbutton.textContent = 'Stop predictions';
    }
    
    uiElements.redrawButton.addEventListener('click', () => {
        startDrawing(aspectRatioLocal);
        uiElements.redrawButton.classList.remove('active');
    });

    uiElements.configureModel.addEventListener('click', () => {
        chrome.runtime.sendMessage({ target: 'worker', type: 'configureModel' });
    });

    uiElements.predictbutton.addEventListener('click', (e) => {
        const action = e.target.dataset.for;
        if (action != 'start' && action != 'stop') return;
        chrome.runtime.sendMessage({ target: 'worker', type: 'predict', action });
        e.target.dataset.for = action === 'start' ? 'stop' : 'start';
        e.target.textContent = action === 'start' ? 'Stop predictions' : 'Start predictions';
        localStorage.setItem('isPredicting', action === 'start');
    });

    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
        console.log('message received:', message);
        switch (message.type) {
            case 'startDrawing':
                startDrawing(message.aspectRatio);
                break;
            case 'predictions':
                const results = message.predictions.map(({ label, probability }) => {
                    return `<div>${label}: ${probability.toFixed(2)}</div>`;
                }).join('');
                uiElements.results.innerHTML = results;
                const reconstructedImageData = new ImageData(
                    new Uint8ClampedArray(message.imageData.data),
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
            localStorage.setItem('aspectRatio', aspectRatio);
        }
        if (!aspectRatioLocal) {
            aspectRatioLocal = '1x1';
        }
        uiElements.rect.classList.remove('active');
        uiElements.overlay.classList.add('active');
        
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

            rectWidth = Math.abs(currentX - startX);
            rectHeight = Math.abs(currentY - startY);

            if (aspectRatioLocal) {
                const ratio = aspectRatioLocal.split('x').map(Number);
                const aspectRatio = ratio[1] / ratio[0];

                let newHeight = rectWidth * aspectRatio;

                if (rectY + newHeight > window.innerHeight) {
                    newHeight = window.innerHeight - rectY;
                    rectWidth = newHeight / aspectRatio;
                }

                if (rectX + rectWidth > window.innerWidth) {
                    rectWidth = window.innerWidth - rectX;
                    newHeight = rectWidth * aspectRatio;
                }

                rectHeight = newHeight;
            }

            rectX = Math.min(Math.max(0, startX), window.innerWidth - rectWidth);
            rectY = Math.min(Math.max(0, startY), window.innerHeight - rectHeight);

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
            
            const rect = { x: rectX, y: rectY, width: rectWidth, height: rectHeight };
            localStorage.setItem('rectState', JSON.stringify(rect));
            
            chrome.runtime.sendMessage({
                target: 'worker',
                type: 'rectUpdate',
                rect
            });
        }
    }
})();
