let currentStream = null;

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'startCapture':
      openWebAppInBackground().then(tab => {
        console.log(tab);
        return startCapture(tab);
      }).then(stream => {
        currentStream = stream;
        sendResponse({ success: true });
      }).catch(error => {
        console.error('Failed to start capture:', error);
        sendResponse({ success: false, error: error.message });
      });
      return true; // Indicates that sendResponse will be called asynchronously

    case 'stopCapture':
      stopCapture();
      sendResponse({ success: true });
      return true;
  }
});

function startCapture(tab) {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], tab, (sourceId, options) => {
      if (chrome.runtime.lastError || !sourceId) {
        return reject(new Error(chrome.runtime.lastError.message || 'No source ID selected'));
      }

      chrome.tabCapture.capture({ audio: false, video: true, videoConstraints: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } }, (stream) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(stream);
      });
    });
  });
}

function stopCapture() {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }
}

function openWebAppInBackground() {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({url: "test.html", active: false}, tab => {
        if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(tab);
        }
    )
  });
}
