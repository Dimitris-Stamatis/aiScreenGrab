const video = document.createElement('video');
// Create an OffscreenCanvas
const offscreenCanvas = new OffscreenCanvas(640, 480); // Adjust size as needed
const ctx = offscreenCanvas.getContext('2d');
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return;

    if (message.type === 'start-recording') {
        console.log('streamId:', message.streamId);
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: "tab",
                    chromeMediaSourceId: message.streamId,
                },
            },
        });
        console.log('Recording started:', stream);
        video.srcObject = stream;
        await video.play();

        // Draw video frames onto the OffscreenCanvas at intervals
        function drawToCanvas() {
          ctx.drawImage(video, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
          // Send frame data back to the worker
          const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
          chrome.runtime.sendMessage({
            target: 'worker',
            type: 'frameData',
            imageData
          });
          setTimeout(() => {
            requestAnimationFrame(drawToCanvas);
          }, 1000 / 30); // 30 FPS
        }
    
        drawToCanvas(); // Start drawing frames
      }
});