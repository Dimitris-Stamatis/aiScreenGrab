const video = document.createElement('video');
// Create an OffscreenCanvas
const offscreenCanvas = new OffscreenCanvas(0, 0); // Adjust size as needed
const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
let stream = null;
let rect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0
};
yoffset = 0;
let sendframesstatus = false;
let targetTabId = null;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'start-frameCapture':
      if (stream == null) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: message.streamId,
            },
          },
        }).catch((error) => {
          console.error('Error accessing media devices:', error);
        });
      }
      sendframesstatus = true;
      video.srcObject = stream;
      targetTabId = message.targetTabId;
      await video.play();
      break;

    case 'stop-frameCapture':
      sendframesstatus = false;
      video.pause();
      video.srcObject = null;
      break;

    case 'rectUpdate':
      rect = message.rect;
      yoffset = message.yoffset;
      offscreenCanvas.width = rect.width;
      offscreenCanvas.height = rect.height;
      break;
  }
});

video.addEventListener('play', () => {
  console.log('Video playing');
  drawToCanvas();
});


function drawToCanvas() {
  console.log('Drawing to canvas');
  if (!sendframesstatus) return;
  console.log('Drawing to canvas 2');
  // Adjust coordinates based on rectangle and viewport
  ctx.clearRect(0, 0, rect.width, rect.height);

  // Use adjusted Y coordinate
  ctx.drawImage(
    video,
    rect.x,  // X coordinate (same as before)
    rect.y + yoffset,  // Adjusted Y coordinate
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height
  );

  // Get ImageData from the offscreen canvas
  const imageData = ctx.getImageData(0, 0, rect.width, rect.height);

  // Send frame data back to the worker
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
  requestAnimationFrame(drawToCanvas);
}
