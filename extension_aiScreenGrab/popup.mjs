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
  let modelFileNames = currentModelDetails?.modelFiles || [];

  if (modelFileObjects.length > 0) {
    modelFileNames = []; 
    try {
      modelFileNames = await Promise.all(
        modelFileObjects.map(async (file) => {
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
  }

  const inferenceTask = formData.get("inferenceTask");
  const details = {
    modelFiles: modelFileNames,
    inputShape: formData.get("inputShape").toLowerCase() || "224x224",
    labelsFormat: formData.get("labelsFormat") || "simpletext",
    labelsSeparator: formData.get("labelsSeparator") || " ",
    inferenceTask,
    outputs: { 
      numDetections: formData.get("numDetections") || 'num_detections',
      detectionBoxes: formData.get("detectionBoxes") || 'detection_boxes',
      scores: formData.get("scores") || 'detection_scores',
      classNames: formData.get("classNames") || 'detection_classes',
    },
    modelType: inferenceTask,
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
});

// Function to load and display existing settings
(async () => {
  const saved = await getItemFromDB("modelDetails");
  if (!saved) {
    taskSelect.value = "classification";
    document.getElementById("inputShape").value = "224x224";
    document.getElementById("labelsFormat").value = "simpletext";
    document.getElementById("labelsSeparator").value = " ";
    document.getElementById("scoreThreshold").value = 0.5;
    document.getElementById("maxDetections").value = 20;
    detectOpts.hidden = true;
    return;
  }

  document.getElementById("inputShape").value = saved.inputShape || "224x224";
  taskSelect.value = saved.inferenceTask || 'classification';
  taskSelect.dispatchEvent(new Event("change"));

  document.getElementById("labelsFormat").value = saved.labelsFormat || 'simpletext';
  document.getElementById("labelsSeparator").value = saved.labelsSeparator || ' ';
  
  if (saved.inferenceTask === "detection") {
    document.getElementById("scoreThreshold").value = saved.scoreThreshold ?? 0.5;
    document.getElementById("maxDetections").value = saved.maxDetections ?? 20;
  }
  
  document.getElementById("numDetections").value = saved.outputs?.numDetections || '';
  document.getElementById("detectionBoxes").value = saved.outputs?.detectionBoxes || '';
  document.getElementById("scores").value = saved.outputs?.scores || '';
  document.getElementById("classNames").value = saved.outputs?.classNames || '';

  modelFilesList.innerHTML = '';
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

// --- REWRITTEN Performance Data Export/Clear Logic ---
function exportDataToCSV(data, filename) {
  if (!data || data.length === 0) {
    alert("No performance data to export.");
    return;
  }

  const csvRows = [];

  // Helper to flatten nested metric objects (e.g., { processing: { avg: 10 } } -> { processing_avg: 10 })
  const flattenObject = (obj, prefix = '') =>
    Object.keys(obj).reduce((acc, k) => {
      const pre = prefix.length ? prefix + '_' : '';
      if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
        Object.assign(acc, flattenObject(obj[k], pre + k));
      } else {
        acc[pre + k] = obj[k];
      }
      return acc;
    }, {});

  const flattenedData = data.map(row => flattenObject(row));

  // Dynamically create headers from all keys in the flattened data
  const headers = [...new Set(flattenedData.flatMap(row => Object.keys(row)))];
  
  // Define a preferred order for CSV columns; others will be appended alphabetically
  const preferredOrder = [
    'datetime', 'timestamp', 'type', 'location', 
    // Aggregated stats
    'avgFps', 'framesInPeriod', 'durationOfPeriodMs',
    'processing_avg', 'processing_min', 'processing_max',
    'inference_avg', 'inference_min', 'inference_max',
    'preparation_avg', 'preparation_min', 'preparation_max',
    'postProcessing_avg', 'postProcessing_min', 'postProcessing_max',
    // Original per-frame metrics (for legacy data)
    'totalFrameProcessingMs', 'inferenceDurationMs', 'framePreparationMs', 'postProcessingMs', 'fps',
    // General context
    'modelType', 'inputWidth', 'inputHeight', 'tabId', 
    // Errors/Info
    'durationMs', 'error', 'stack', 'message', 'messageType', 'targetComponent', 'scriptPath', 'context'
  ];
  
  const sortedHeaders = preferredOrder.filter(h => headers.includes(h))
                           .concat(headers.filter(h => !preferredOrder.includes(h)).sort());

  csvRows.push(sortedHeaders.join(','));

  for (const row of flattenedData) {
    const values = sortedHeaders.map(header => {
      const value = row[header] === undefined || row[header] === null ? '' : row[header];
      let escaped = ('' + value).replace(/"/g, '""');
      if (escaped.includes(',')) {
          escaped = `"${escaped}"`;
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