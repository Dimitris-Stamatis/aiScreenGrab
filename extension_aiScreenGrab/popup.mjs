import { saveFile, setItemInDB, getItemFromDB } from "./utils/indexedDB.mjs";

const submitButton = document.querySelector('button[type="submit"]');
const form = document.getElementById("modelDetails");
const taskSelect = document.getElementById("inferenceTask");
const detectOpts = document.getElementById("detectionOptions");
const modelFilesInput = document.getElementById("modelFiles");
const modelFilesList = document.getElementById("modelFilesList");

// --- Performance Buttons ---
const exportPerformanceButton = document.getElementById('exportPerformanceButton');
const clearPerformanceButton = document.getElementById('clearPerformanceButton');
// --- End Performance Buttons ---


taskSelect.addEventListener("change", () => {
  detectOpts.hidden = taskSelect.value !== "detection";
});

modelFilesInput.addEventListener('change', (event) => {
    modelFilesList.innerHTML = ''; // Clear previous list
    const files = event.target.files;
    if (files && files.length > 0) {
        Array.from(files).forEach(file => {
            const li = document.createElement('li');
            li.textContent = file.name;
            modelFilesList.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = "No files selected.";
        modelFilesList.appendChild(li);
    }
});


form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = "Uploading...";

  const formData = new FormData(form);
  const selectedFiles = modelFilesInput.files;
  const modelFileObjects = Array.from(selectedFiles || []);
  let currentModelDetails = await getItemFromDB("modelDetails");
  let modelFileNames = currentModelDetails?.modelFiles || []; // Start with existing files

  if (modelFileObjects.length > 0) {
    // If new files are uploaded, replace the old list
    modelFileNames = []; 
    try {
      modelFileNames = await Promise.all(
        modelFileObjects.map(async (file) => {
          if (!(file instanceof Blob)) {
            throw new TypeError(`Invalid file type for ${file.name}`);
          }
          await saveFile(file); // from indexedDB.mjs
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
  }
  // If no new files were uploaded, modelFileNames retains the existing ones.
  // If there were no existing ones and none uploaded, it will be empty.


  const inferenceTask = formData.get("inferenceTask");
  const details = {
    modelFiles: modelFileNames,
    inputShape: formData.get("inputShape").toLowerCase() || "224x224",
    labelsFormat: formData.get("labelsFormat") || "simpletext",
    labelsSeparator: formData.get("labelsSeparator") || " ",
    inferenceTask,
    outputs: { // Provide defaults if fields are empty
      numDetections: formData.get("numDetections") || 'num_detections',
      detectionBoxes: formData.get("detectionBoxes") || 'detection_boxes',
      scores: formData.get("scores") || 'detection_scores', // Common default for TF Hub SSD Mobilenet
      classNames: formData.get("classNames") || 'detection_classes', // Common default
    },
    modelType: inferenceTask, // Align modelType with inferenceTask
  };
  

  if (inferenceTask === "detection") {
    details.scoreThreshold = parseFloat(formData.get("scoreThreshold")) || 0.5;
    details.maxDetections = parseInt(formData.get("maxDetections"), 10) || 20;
  }

  await setItemInDB("modelDetails", details);
  chrome.runtime.sendMessage({
    target: 'worker',
    type: "modelDetailsUpdated",
    modelDetails: details,
  }).catch(err => console.error("Error sending modelDetailsUpdated to worker:", err));

  submitButton.disabled = false;
  submitButton.textContent = "Save Configuration";
  alert("Configuration saved!");
  // window.close(); // Consider not closing to allow immediate performance data interaction
});

// Function to load and display existing settings
(async () => {
  const saved = await getItemFromDB("modelDetails");
  if (!saved) {
    // Set defaults for a new configuration
    taskSelect.value = "classification";
    document.getElementById("inputShape").value = "224x224";
    document.getElementById("labelsFormat").value = "simpletext";
    document.getElementById("labelsSeparator").value = " ";
    document.getElementById("scoreThreshold").value = 0.5;
    document.getElementById("maxDetections").value = 20;
    detectOpts.hidden = true; // Hide detection options if classification is default
    return;
  }

  document.getElementById("inputShape").value = saved.inputShape || "224x224";
  taskSelect.value = saved.inferenceTask || 'classification';
  taskSelect.dispatchEvent(new Event("change")); // Trigger change to show/hide detection options

  document.getElementById("labelsFormat").value = saved.labelsFormat || 'simpletext';
  document.getElementById("labelsSeparator").value = saved.labelsSeparator || ' ';
  
  if (saved.inferenceTask === "detection") {
    document.getElementById("scoreThreshold").value = saved.scoreThreshold ?? 0.5;
    document.getElementById("maxDetections").value = saved.maxDetections ?? 20;
  }
  
  // Restore output names from saved details, using placeholders if not present
  document.getElementById("numDetections").value = saved.outputs?.numDetections || '';
  document.getElementById("detectionBoxes").value = saved.outputs?.detectionBoxes || '';
  document.getElementById("scores").value = saved.outputs?.scores || '';
  document.getElementById("classNames").value = saved.outputs?.classNames || '';

  modelFilesList.innerHTML = ''; // Clear list
  if (saved.modelFiles && saved.modelFiles.length > 0) {
    saved.modelFiles.forEach((name) => {
      const li = document.createElement("li");
      li.textContent = name;
      modelFilesList.appendChild(li);
    });
  } else {
    const li = document.createElement("li");
    li.textContent = "No model files previously uploaded.";
    modelFilesList.appendChild(li);
  }
})();

// --- Performance Data Export/Clear Logic ---
function exportDataToCSV(data, filename) {
  if (!data || data.length === 0) {
    alert("No performance data to export.");
    return;
  }

  const csvRows = [];
  // Headers - dynamically create from a sample of objects to get all possible keys
  let headers = [];
  data.forEach(row => {
    Object.keys(row).forEach(key => {
      if (!headers.includes(key)) {
        headers.push(key);
      }
    });
  });
  
  // Define a preferred order, others will be appended
  const preferredOrder = [
    'datetime', 'timestamp', 'type', 'location', 'durationMs', 
    'totalFrameProcessingMs', 'fps', 'modelType', 'inputWidth', 'inputHeight', 
    'tabId', 'error', 'stack', 'message', 'messageType', 'targetComponent', 'scriptPath', 'context'
  ];
  // Sort headers: preferred first, then alphabetically for the rest
  const sortedHeaders = preferredOrder.filter(h => headers.includes(h))
                           .concat(headers.filter(h => !preferredOrder.includes(h)).sort());

  csvRows.push(sortedHeaders.join(','));

  for (const row of data) {
    const values = sortedHeaders.map(header => {
      const value = row[header] === undefined || row[header] === null ? '' : row[header];
      // Escape double quotes and ensure values containing commas are quoted
      let escaped = ('' + value).replace(/"/g, '""');
      if (escaped.includes(',')) {
          escaped = `"${escaped}"`;
      } else if (value === '' && header === sortedHeaders[0]) { // Ensure empty first cells are still quoted if needed by some CSV readers
          escaped = `""`; 
      }
      return escaped;
    });
    csvRows.push(values.join(','));
  }

  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    alert("Performance data exported as " + filename);
  } else {
    alert("CSV export not supported by your browser.");
  }
}

if (exportPerformanceButton) {
  exportPerformanceButton.addEventListener('click', async () => {
    exportPerformanceButton.disabled = true;
    exportPerformanceButton.textContent = "Exporting...";
    try {
      const response = await chrome.runtime.sendMessage({ target: 'worker', type: 'getPerformanceLog' });
      if (response && response.data) {
        exportDataToCSV(response.data, `performance_log_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`);
      } else {
        alert('No performance data to export or an error occurred.');
        console.warn("Failed to get performance data for export:", response);
      }
    } catch (error) {
      console.error('Error exporting performance data:', error);
      alert('Error exporting performance data: ' + error.message);
    } finally {
        exportPerformanceButton.disabled = false;
        exportPerformanceButton.textContent = "Export Performance Data (CSV)";
    }
  });
}

if (clearPerformanceButton) {
  clearPerformanceButton.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all recorded performance data? This action cannot be undone.')) {
      clearPerformanceButton.disabled = true;
      clearPerformanceButton.textContent = "Clearing...";
      try {
        const response = await chrome.runtime.sendMessage({ target: 'worker', type: 'clearPerformanceLog' });
        if (response && response.success) {
          alert('Performance data cleared.');
        } else {
          alert('Failed to clear performance data.');
           console.warn("Failed to clear performance data:", response);
        }
      } catch (error) {
        console.error('Error clearing performance data:', error);
        alert('Error clearing performance data: ' + error.message);
      } finally {
        clearPerformanceButton.disabled = false;
        clearPerformanceButton.textContent = "Clear Performance Data";
      }
    }
  });
}