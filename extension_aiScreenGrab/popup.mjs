import { saveFile, setItemInDB, getItemFromDB } from "./utils/indexedDB.mjs";

const submitButton = document.querySelector('button[type="submit"]');
const form = document.getElementById("modelDetails");
const taskSelect = document.getElementById("inferenceTask");
const detectOpts = document.getElementById("detectionOptions");
const outShapeContainer = document.getElementById("outputShapeContainer");

// Toggle fields when the user switches task
taskSelect.addEventListener("change", () => {
  if (taskSelect.value === "detection") {
    detectOpts.hidden = false;
    outShapeContainer.hidden = true;
  } else {
    detectOpts.hidden = true;
    outShapeContainer.hidden = false;
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
        console.log("Saved file:", file.name);
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
    modelType: formData.get("modelType"),
    inputShape: formData.get("inputShape").toLowerCase(),
    inferenceTask,
  };

  if (inferenceTask === "classification") {
    details.outputShape = formData.get("outputShape").toLowerCase();
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
  document.getElementById("modelType").value = saved.modelType;
  taskSelect.value = saved.inferenceTask;
  taskSelect.dispatchEvent(new Event("change"));

  // restore task-specific fields
  if (saved.inferenceTask === "classification") {
    document.getElementById("outputShape").value = saved.outputShape || "";
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
})();
