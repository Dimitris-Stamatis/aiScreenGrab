<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { modelStore, stream } from "../stores";
  import * as tf from "@tensorflow/tfjs";
  import { getAllFiles } from "../utils/indexedDB";

  let model: tf.GraphModel | null = null;
  let modelLoaded = false;
  let inW: number, inH: number, outW: number, outH: number;
  let labels: string[] = [];
  let results: { label: any; probability: number }[] | undefined = [];
  let videoElement: HTMLVideoElement;
  let canvas: HTMLCanvasElement;
  let rect: HTMLDivElement;
  let resizeHandle: HTMLDivElement;

  const dimensionsIn = $modelStore.modelParameters.inputShape;
  [inW, inH] = dimensionsIn.split("x").map(Number);
  const dimensionsOut = $modelStore.modelParameters.outputShape;
  [outW, outH] = dimensionsOut.split("x").map(Number);

  let rectX = 50, rectY = 50; // Rectangle position fixed for simplicity
  const rectWidth = inW, rectHeight = inH; // Rectangle dimensions from model store

  let videoWidth = 640, videoHeight = 480; // Initial video dimensions

  // Custom TensorFlow.js I/O handler for IndexedDB
  const indexedDBIOHandler: tf.io.IOHandler = {
    async load() {
      const files = await getAllFiles();
      const modelJsonFile = files.find((file) =>
        file.name.endsWith("model.json")
      );
      const weightFiles = files.filter((file) => file.name.endsWith(".bin"));
      const labelsFile = files.find((file) => file.name.endsWith("labels.json"));

      if (!modelJsonFile) {
        throw new Error("Model JSON file not found in IndexedDB.");
      }

      const modelJsonContent = await fileToString(modelJsonFile);
      let modelJson;
      try {
        modelJson = JSON.parse(modelJsonContent);
      } catch (error) {
        console.error("Error parsing model JSON:", error);
        throw new Error("Invalid JSON in model.json");
      }

      if (labelsFile) {
        const labelsText = await fileToString(labelsFile);
        try {
          labels = JSON.parse(labelsText);
        } catch (error) {
          console.error("Error parsing labels JSON:", error);
          throw new Error("Invalid JSON in labels.json");
        }
      }

      const weightData = await concatenateArrayBuffers(weightFiles);

      return {
        modelTopology: modelJson.modelTopology,
        weightSpecs: modelJson.weightsManifest[0].weights,
        weightData: weightData,
      };
    },
  };

  async function fileToString(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  async function concatenateArrayBuffers(files: File[]): Promise<Uint8Array> {
    const buffers = await Promise.all(files.map(fileToArrayBuffer));
    const totalLength = buffers.reduce((acc, buffer) => acc + buffer.byteLength, 0);
    const concatenatedArray = new Uint8Array(totalLength);
    let offset = 0;

    for (const buffer of buffers) {
      concatenatedArray.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    }

    return concatenatedArray;
  }

  async function loadModel() {
    try {
      model = await tf.loadGraphModel(indexedDBIOHandler);
      modelLoaded = true;
    } catch (error) {
      console.error("Error loading model:", error);
    }
  }

  async function predict() {
    if (!model) {
      console.error("Model not loaded.");
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      console.error("Failed to get canvas context.");
      return;
    }

    // Crop the image data to the area defined by the rectangle
    const imageData = context.getImageData(rectX, rectY, rectWidth, rectHeight);
    const tensor = tf.browser.fromPixels(imageData)
      .resizeNearestNeighbor([inW, inH])
      .toFloat()
      .expandDims();

    const predictions = model.predict(tensor) as tf.Tensor;
    const data = await predictions.data();
    results = Array.from(data).map((probability, index) => ({
      label: labels[index] || `Class ${index}`,
      probability,
    }));

    results.sort((a, b) => b.probability - a.probability);

    tensor.dispose();
    predictions.dispose(); // Dispose the predictions tensor

    return results;
  }

  function processFrame() {
    if (!modelLoaded) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!videoElement || !context) {
      console.error("Video or canvas context not available.");
      return;
    }

    if (videoElement.readyState < 2) {
      console.warn("Video is not ready for processing.");
      requestAnimationFrame(processFrame);
      return;
    }

    // Set canvas size to rectangle size
    canvas.width = rectWidth;
    canvas.height = rectHeight;

    // Clear canvas before drawing new frame
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Draw the video frame onto the canvas, cropping to the rectangle's area
    context.drawImage(videoElement, rectX, rectY, rectWidth, rectHeight, 0, 0, canvas.width, canvas.height);

    // Perform prediction
    predict().then(() => {
      requestAnimationFrame(processFrame); // Continue processing frames
    }).catch(error => {
      console.error("Error during prediction:", error);
      requestAnimationFrame(processFrame); // Continue processing frames
    });
  }

  function handleMouseDown(event: MouseEvent) {
    const startX = event.clientX;
    const startY = event.clientY;

    const rectRect = rect.getBoundingClientRect();
    const offsetX = startX - rectRect.left;
    const offsetY = startY - rectRect.top;

    function handleMouseMove(event: MouseEvent) {
      const newX = event.clientX - offsetX;
      const newY = event.clientY - offsetY;

      rect.style.left = `${Math.max(0, Math.min(newX, videoElement.clientWidth - rectWidth))}px`;
      rect.style.top = `${Math.max(0, Math.min(newY, videoElement.clientHeight - rectHeight))}px`;

      rectX = parseInt(rect.style.left, 10);
      rectY = parseInt(rect.style.top, 10);

      event.preventDefault();
    }

    function handleMouseUp() {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  function handleResizeMouseDown(event: MouseEvent) {
    let startX = event.clientX;
    let startY = event.clientY;

    function handleMouseMove(event: MouseEvent) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      videoWidth = Math.max(100, videoWidth + dx);
      videoHeight = Math.max(100, videoHeight + dy);

      videoElement.style.width = `${videoWidth}px`;
      videoElement.style.height = `${videoHeight}px`;

      startX = event.clientX;
      startY = event.clientY;

      event.preventDefault();
    }

    function handleMouseUp() {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  stream.subscribe((value) => {
    if (value) {
      videoElement.srcObject = value;
      videoElement.play();
    }
    processFrame(); // Start processing frames
  });

  loadModel();

  onMount(() => {
    // Initialize rectangle
    rect.style.width = `${rectWidth}px`;
    rect.style.height = `${rectHeight}px`;
    resizeHandle.style.width = `20px`; // Handle size
    resizeHandle.style.height = `20px`;
  });

  onDestroy(() => {
    model?.dispose();
    canvas?.remove(); // Clean up the canvas element
  });
</script>

<div class="videoContainer">
  <video bind:this={videoElement} autoplay muted playsinline></video>
  <div class="resizeHandle" bind:this={resizeHandle} on:mousedown={handleResizeMouseDown} aria-hidden="true"></div>
  <div class="rectangle" bind:this={rect} on:mousedown={handleMouseDown} aria-hidden="true"></div>
  
</div>
<canvas bind:this={canvas}></canvas>

{#if modelLoaded}
  <p>Model loaded successfully!</p>
{:else}
  <p>Loading model...</p>
{/if}

<div class="results">
  {#if results && results.length > 0}
    {#each results as result}
      <p>{result.label}: {result.probability.toFixed(2)}</p>
    {/each}
  {/if}
</div>

<style>
.videoContainer {
  position: relative;
  width: 640px; /* Adjust as needed */
  height: 480px; /* Adjust as needed */
}

.videoContainer video {
  position: absolute;
  top: 0px;
  left: 0px;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rectangle {
  position: absolute;
  border: 2px solid red; /* Color and style of the rectangle border */
  background-color: rgba(255, 0, 0, 0.3); /* Background color with transparency */
  cursor: move; /* Cursor style when hovering over the rectangle */
  top: 50%;
  left: 50%;
}

.resizeHandle {
  position: absolute;
  width: 20px; /* Adjust handle size as needed */
  height: 20px; /* Adjust handle size as needed */
  background-color: red; /* Handle color */
  cursor: nwse-resize; /* Cursor style for resizing */
  right: 0;
  bottom: 0;
}

.results {
  margin-top: 10px;
  padding: 10px;
}

.results p {
  margin: 0;
}

.videoContainer canvas {
  position: absolute;
  top: 0;
  left: 0; /* Ensure the canvas aligns with the video */
}
</style>
