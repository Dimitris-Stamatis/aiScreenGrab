import { saveFile, setItemInDB, getItemFromDB } from "./utils/indexedDB.mjs";

const submitButton = document.querySelector('button[type="submit"]');
const form = document.getElementById("modelDetails");
const taskSelect = document.getElementById("inferenceTask");
const detectOpts = document.getElementById("detectionOptions");

// Toggle fields when the user switches task
taskSelect.addEventListener("change", () => {
  if (taskSelect.value === "detection") {
    detectOpts.hidden = false;
  } else {
    detectOpts.hidden = true;
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = "Uploading...";

  const formData = new FormData(form);
  const selectedFiles = document.getElementById("modelFiles").files;
  const modelFiles = Array.from(selectedFiles || []);
  let modelFileNames = [];

  // save each file into IndexedDB
  try {
    modelFileNames = await Promise.all(
      modelFiles.map(async (file) => {
        if (!(file instanceof Blob)) {
          throw new TypeError(`Invalid file type for ${file.name}`);
        }
        await saveFile(file);
        return file.name;
      })
    );
  } catch (err) {
    console.error("Error saving files:", err);
    alert("Failed to save files: " + err.message);
    submitButton.disabled = false;
    submitButton.textContent = "Save Configuration";
    return;
  }

  // assemble modelDetails based on task
  const inferenceTask = formData.get("inferenceTask");
  const details = {
    modelFiles: modelFileNames,
    inputShape: formData.get("inputShape").toLowerCase(),
    labelsFormat: formData.get("labelsFormat"),
    labelsSeparator: formData.get("labelsSeparator"),
    inferenceTask,
    outputs: {
      numDetections: formData.get("numDetections"),
      detectionBoxes: formData.get("detectionBoxes"),
      scores: formData.get("scores"),
      classNames: formData.get("classNames"),
    },
  };

  if (inferenceTask === "classification") {
  } else {
    details.scoreThreshold = parseFloat(formData.get("scoreThreshold"));
    details.maxDetections = parseInt(formData.get("maxDetections"), 10);
  }

  // save to DB + notify service worker
  await setItemInDB("modelDetails", details);
  chrome.runtime.sendMessage({
    type: "modelDetailsUpdated",
    modelDetails: details,
  });

  submitButton.disabled = false;
  submitButton.textContent = "Save Configuration";
  window.close();
});

(async () => {
  const saved = await getItemFromDB("modelDetails");
  if (!saved) return;

  // restore basic fields
  document.getElementById("inputShape").value = saved.inputShape;
  const taskSelect = document.getElementById('inferenceTask');


  taskSelect.value = saved.inferenceTask;
  taskSelect.dispatchEvent(new Event("change"));

  // restore task-specific fields
  if (saved.inferenceTask === "classification") {
  } else {
    document.getElementById("scoreThreshold").value = saved.scoreThreshold ?? 0.5;
    document.getElementById("maxDetections").value = saved.maxDetections ?? 20;
  }

  // restore file list UI
  const listEl = document.getElementById("modelFilesList");
  saved.modelFiles.forEach((name) => {
    const li = document.createElement("li");
    li.textContent = name;
    listEl.appendChild(li);
  });

  // Toggle fields based on task selection
  const detectOpts = document.getElementById('detectionOptions');

  taskSelect.addEventListener('change', () => {
    if (taskSelect.value === 'detection') {
      detectOpts.hidden = false;
    } else {
      detectOpts.hidden = true;
    }
  });

  document.getElementById("labelsFormat").value = saved.labelsFormat;
  document.getElementById("labelsSeparator").value = saved.labelsSeparator;
  document.getElementById("numDetections").value = saved.outputs['numDetections'];
  document.getElementById("detectionBoxes").value = saved.outputs['detectionBoxes'];
  document.getElementById("scores").value = saved.outputs['scores'];
  document.getElementById("classNames").value = saved.outputs['classNames'];
})();
