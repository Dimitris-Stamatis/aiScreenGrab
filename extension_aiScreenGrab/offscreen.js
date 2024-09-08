const video = document.createElement('video');
video.style="width: 100%";
// Create an OffscreenCanvas
const offscreenCanvas = new OffscreenCanvas(0, 0); // Adjust size as needed
const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
let rect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0
};
let sendframesstatus = false;
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  switch (message.type) {
    case 'start-recording':
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: message.streamId,
          },
        },
      });
      video.srcObject = stream;
      await video.play();
      break;
    case 'start-frameCapture':
      sendframesstatus = true;
      // Draw video frames onto the OffscreenCanvas at intervals
      drawToCanvas(message.targetTabId); // Start drawing frames
      break;
    case 'stop-frameCapture':
      console.log('Stopping frame capture');
      sendframesstatus = false;
      break;
    case 'rectUpdate':
      rect = message.rect;
      offscreenCanvas.width = rect.width;
      offscreenCanvas.height = rect.height;
      break;
  }
});

function drawToCanvas(targetTabId) {
  if (!sendframesstatus)
    return;
  if (!video.paused) {
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    // Send frame data back to the worker
    const imageData = ctx.getImageData(0, 0, rect.width, rect.height);
    chrome.runtime.sendMessage({
      target: 'worker',
      type: 'frameData',
      imageData: {
        data: Array.from(imageData.data),  // Convert to a regular array for serialization
        width: imageData.width,
        height: imageData.height
      },
      targetTabId
    });
  }
  setTimeout(() => {
    drawToCanvas(targetTabId);
  }, 1000 / 30); // 30 FPS
}   