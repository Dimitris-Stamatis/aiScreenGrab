document.getElementById('startCapture').addEventListener('click', async () => {
    try {
        chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], (streamId) => {
            if (streamId == '')
                return;
            chrome.tabs.create({ url: "https://your-client-website.com" }, (tab) => {
                chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                    if (tabId === tab.id && changeInfo.status === 'complete') {
                        // Send the stream ID to the client website
                        chrome.tabs.sendMessage(tabId, { type: 'streamId', streamId: streamId });
                        chrome.tabs.onUpdated.removeListener(listener);
                    }
                });
            });
        });
    } catch (err) {
        console.error("Error starting capture: " + err);
    }
});
