import { saveFile } from "./utils/indexedDB.mjs";

const drawbutton = document.getElementById('drawArea');
const submitbutton = document.querySelector('button[type="submit"]');
document.getElementById('modelDetails').addEventListener('submit', (e) => {
  e.preventDefault();
  submitbutton.disabled = true;
  submitbutton.textContent = 'Uploading...';
  const formdata = new FormData(e.target);
  const selectedfiles = document.getElementById('modelFiles').files;
  let modelFiles, modelFileNames = [];
  if (selectedfiles) {
    modelFiles = Array.from(selectedfiles);
  }

  modelFiles.forEach(file => {
    saveFile(file).catch(error => {
      submitbutton.disabled = false;
      alert('Failed to save file: ' + error.message);
    });
    console.log(file);
    modelFileNames.push(file.name);
  });

  const modelDetails = {
    inputShape: formdata.get('inputShape'),
    outputShape: formdata.get('outputShape'),
    modelType: formdata.get('modelType'),
    returnType: formdata.get('returnType'),
    modelFiles: modelFileNames,
  };

  chrome.storage.sync.set({ modelDetails });
  submitbutton.disabled = false;
  submitbutton.textContent = 'Save';
});

drawbutton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'startDrawing' }, (response) => {
    if (response.success) {
      console.log('Capture started');
    } else {
      console.error('Failed to start capture:', response.error);
    }
  });
});

chrome.storage.sync.get('modelDetails', ({ modelDetails }) => {
  if (modelDetails) {
    document.getElementById('inputShape').value = modelDetails.inputShape;
    document.getElementById('outputShape').value = modelDetails.outputShape;
    document.getElementById('modelType').value = modelDetails.modelType;
    document.getElementById('returnType').value = modelDetails.returnType;
    modelDetails.modelFiles.forEach(file => {
      const fileElement = document.createElement('li');
      fileElement.textContent = file;
      document.getElementById('modelFilesList').appendChild(fileElement);
    });
  }
});
