(() => {
    let overlay = null;
    let rect = document.createElement('div');
    rect.classList.add('aiScreen-rect');
    console.log('injected');
    // listen for messages from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('message', message);
        console.log('sender', sender);
        switch (message.type) {
            case 'startDrawing':
                console.log('start drawing');
                buildOverlay();
                startDrawing();
                sendResponse({ success: true });
                break;
            case 'stopCapture':
                console.log('stop capture');
                break;
        }
    });

    function buildOverlay() {
        overlay = document.createElement('div');
        overlay.classList.add('aiScreen-overlay', 'active');
        document.body.appendChild(overlay);
    }

    function startDrawing() {
        // Draw a rectangular box on the screen
        let startX = 0;
        let startY = 0;
        let endX = 0;
        let endY = 0;
        let drawing = false;
        overlay.addEventListener('mousedown', (e) => {
            startX = e.clientX;
            startY = e.clientY;
            drawing = true;
            document.body.appendChild(rect);
        });
        overlay.addEventListener('mousemove', (e) => {
            if (drawing) {
                endX = e.clientX;
                endY = e.clientY;
                drawRect(startX, startY, endX, endY);
            }
        });
        overlay.addEventListener('mouseup', (e) => {
            drawing = false;
            overlay.remove();
        });
    }

    drawRect = (startX, startY, endX, endY) => {
        rect.style.left = `${startX}px`;
        rect.style.top = `${startY}px`;
        rect.style.width = `${endX - startX}px`;
        rect.style.height = `${endY - startY}px`;
    }

})();