<script lang="ts">
  import { onDestroy } from "svelte";
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
  const dimensionsIn = $modelStore.modelParameters.inputShape;
  [inW, inH] = dimensionsIn.split("x").map(Number);
  const dimensionsOut = $modelStore.modelParameters.outputShape;
  [outW, outH] = dimensionsOut.split("x").map(Number);

  let rectX = 50, rectY = 50, rectWidth = inW, rectHeight = inH; // Initial rectangle dimensions

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

      // Read and log model.json file content
      const modelJsonContent = await fileToString(modelJsonFile);
      console.log("Model JSON Content:", modelJsonContent);

      let modelJson;
      try {
        modelJson = JSON.parse(modelJsonContent);
      } catch (error) {
        console.error("Error parsing model JSON:", error);
        throw new Error("Invalid JSON in model.json");
      }

      if (labelsFile) {
        const labelsText = await fileToString(labelsFile);
        console.log("Labels JSON Content:", labelsText);
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

  async function predict(image: HTMLImageElement) {
    if (!model) {
      console.error("Model not loaded.");
      return;
    }

    // Adjust prediction area based on the rectangle
    const tensor = tf.browser
      .fromPixels(image)
      .slice([rectY, rectX, 0], [rectHeight, rectWidth, 3]) // Use slice to crop the image
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

    canvas.width = inW;
    canvas.height = inH;
    context.drawImage(videoElement, 0, 0, inW, inH);

    const image = new Image();
    image.onload = async () => {
      results = await predict(image);
      requestAnimationFrame(processFrame); // Continue processing frames
    };
    image.src = canvas.toDataURL();
  }

  function handleMouseDown(event: MouseEvent) {
  // Start dragging logic
  const startX = event.clientX;
  const startY = event.clientY;

  // Calculate initial rectangle position relative to mouse position
  const rectRect = rect.getBoundingClientRect();
  const offsetX = startX - rectRect.left;
  const offsetY = startY - rectRect.top;

  function handleMouseMove(event: MouseEvent) {
    // Update rectangle position based on current mouse position
    const newX = event.clientX - offsetX;
    const newY = event.clientY - offsetY;

    // Apply new position
    rect.style.left = `${newX}px`;
    rect.style.top = `${newY}px`;
    rect.style.width = `${rectWidth}px`;
    rect.style.height = `${rectHeight}px`;
    
    event.preventDefault();
  }

  function handleMouseUp() {
    // Remove event listeners when mouse button is released
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }

  // Add event listeners for mouse movement and release
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

  onDestroy(() => {
    model?.dispose();
  });
</script>

<div class="videoContainer" >
  <video bind:this={videoElement} autoplay muted playsinline></video>
  <canvas bind:this={canvas} id="output"></canvas>
  <div class="rectangle" bind:this={rect} on:mousedown={handleMouseDown} aria-hidden="true"></div>
</div>

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
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.videoContainer canvas#output {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.rectangle {
  position: absolute;
  border: 2px solid red; /* Color and style of the rectangle border */
  background-color: rgba(255, 0, 0, 0.3); /* Background color with transparency */
  cursor: move; /* Cursor style when hovering over the rectangle */
}

.results {
  margin-top: 10px;
  padding: 10px;
}

.results p {
  margin: 0;
}

</style>