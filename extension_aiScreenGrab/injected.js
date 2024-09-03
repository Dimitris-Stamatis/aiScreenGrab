console.log('injected');
// listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('message', message);
    console.log('sender', sender);
    switch (message.type) {
        case 'startDrawing':
            console.log('start drawing');
            break;
        case 'stopCapture':
            console.log('stop capture');
            break;
    }
});