import { saveFile, setItemInDB, getItemFromDB } from "./utils/indexedDB.mjs";

const submitbutton = document.querySelector('button[type="submit"]');

document.getElementById('modelDetails').addEventListener('submit', async (e) => {
  e.preventDefault();
  submitbutton.disabled = true;
  submitbutton.textContent = 'Uploading...';

  const formdata = new FormData(e.target);
  const selectedfiles = document.getElementById('modelFiles').files;

  let modelFiles = [], modelFileNames = [];
  if (selectedfiles) {
    modelFiles = Array.from(selectedfiles);
  }

  try {
    const savePromises = modelFiles.map(async (file) => {
      if (!(file instanceof Blob)) {
        throw new TypeError(`Invalid file type for ${file.name}`);
      }
      await saveFile(file);
      console.log("Saved file:", file.name);
      return file.name;
    });

    modelFileNames = await Promise.all(savePromises);
  } catch (error) {
    console.error("One or more files failed to save:", error);
    alert('Failed to save file: ' + error.message);
    submitbutton.disabled = false;
    submitbutton.textContent = 'Save';
    return;
  }

  const modelDetails = {
    inputShape: formdata.get('inputShape').toLowerCase(),
    outputShape: formdata.get('outputShape').toLowerCase(),
    modelType: formdata.get('modelType'),
    returnType: formdata.get('returnType'),
    modelFiles: modelFileNames,
  };

  await setItemInDB('modelDetails', modelDetails);

  // Notify the service worker
  chrome.runtime.sendMessage({
    type: 'modelDetailsUpdated',
    modelDetails,
  });

  submitbutton.disabled = false;
  submitbutton.textContent = 'Save';
  window.close(); // optional
});

(async () => {
  const modelDetails = await getItemFromDB('modelDetails');
  if (!modelDetails) return;

  document.getElementById('inputShape').value = modelDetails.inputShape;
  document.getElementById('outputShape').value = modelDetails.outputShape;
  document.getElementById('modelType').value = modelDetails.modelType;
  document.getElementById('returnType').value = modelDetails.returnType;

  modelDetails.modelFiles.forEach(file => {
    const fileElement = document.createElement('li');
    fileElement.textContent = file;
    document.getElementById('modelFilesList').appendChild(fileElement);
  });
})();
