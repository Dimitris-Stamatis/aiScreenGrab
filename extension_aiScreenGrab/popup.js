document.getElementById('startCapture').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'startCapture' }, (response) => {
      if (response.success) {
        console.log('Capture started');
      } else {
        console.error('Failed to start capture:', response.error);
      }
    });
  });
  
  document.getElementById('stopCapture').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'stopCapture' }, (response) => {
      if (response.success) {
        console.log('Capture stopped');
      } else {
        console.error('Failed to stop capture:', response.error);
      }
    });
  });
  