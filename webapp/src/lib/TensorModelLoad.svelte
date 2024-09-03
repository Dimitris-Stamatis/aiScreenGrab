<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { modelStore, stream } from "../stores";
    import * as tf from "@tensorflow/tfjs";
    import { getAllFiles } from "../utils/indexedDB";
    import ResizableRectangle from "./ResizableRectangle.svelte";

    export let runModel = false;

    let model: tf.GraphModel | tf.LayersModel | null = null;
    let modelLoaded = false;
    let inW: number, inH: number, outW: number, outH: number;
    let labels: string[] = [];
    let results: { label: string; probability: number }[] | undefined = [];
    let videoElement: HTMLVideoElement;
    let canvas: HTMLCanvasElement;
    let debugCanvas: HTMLCanvasElement;

    const dimensionsIn = $modelStore.modelParameters.inputShape;
    [inW, inH] = dimensionsIn.split("x").map(Number);
    const dimensionsOut = $modelStore.modelParameters.outputShape;
    [outW, outH] = dimensionsOut.split("x").map(Number);


    let rectX = 0,
        rectY = 0; // Rectangle position fixed for simplicity
    let rectWidth = inW,
        rectHeight = inH; // Rectangle dimensions from model store
    let videoScaleX = 1, videoScaleY = 1;

    function updateVideoScale() {
        if (videoElement) {
            // Calculate the scale factors of the video element based on its rendered size
            videoScaleX = videoElement.clientWidth / videoElement.videoWidth;
            videoScaleY = videoElement.clientHeight / videoElement.videoHeight;
        }
        rectX = videoElement.clientWidth / 2 - inW / 2;
        rectY = videoElement.clientHeight / 2 - inH / 2;
        rectWidth = inW;
        rectHeight = inH;
    }

    // Custom TensorFlow.js I/O handler for IndexedDB
    const indexedDBIOHandler: tf.io.IOHandler = {
        async load() {
            const files = await getAllFiles();
            const modelJsonFile = files.find((file) =>
                file.name.endsWith("model.json"),
            );
            const weightFiles = files.filter((file) =>
                file.name.endsWith(".bin"),
            );
            const labelsFile = files.find((file) =>
                file.name.endsWith("labels.json"),
            );

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
        const totalLength = buffers.reduce(
            (acc, buffer) => acc + buffer.byteLength,
            0,
        );
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
            if ($modelStore.modelType == "graph") {
                model = await tf.loadGraphModel(indexedDBIOHandler);
            } else {
                model = await tf.loadLayersModel(indexedDBIOHandler);
            }
            modelLoaded = true;
        } catch (error) {
            console.error("Error loading model:", error);
        }
    }

    async function predict(imageData: ImageData) {
        if (!model) {
            console.error("Model not loaded.");
            return;
        }

        const logits = tf.tidy(() => {

        const tensor = tf.browser
            .fromPixels(imageData)
            .resizeBilinear([inH, inW])
            .toFloat();
        const offset = tf.scalar(255);
        const normalized = tensor.div(offset);
        const batched = normalized.reshape([1, inH, inW, 3]);

        // print the image to the ui for debugging purposes
        const debugContext = debugCanvas.getContext("2d");
        // clear debug canvas
        debugContext?.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
        debugContext?.putImageData(imageData, 0, 0);

        return model?.predict(batched) as tf.Tensor;
        });
        const data = await logits.data();
        const results = Array.from(data).map((probability, index) => ({
            label: labels[index] || `Class ${index}`,
            probability,
        }));

        results.sort((a, b) => b.probability - a.probability);
        return results;
    }

    function processFrame() {
        if (!modelLoaded) {
            return null;
        }

        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!videoElement || !context) {
            console.error("Video or canvas context not available.");
            return null;
        }

        if (videoElement.readyState < 2) {
            console.warn("Video is not ready for processing.");
            return null;
        }

        // Clear the canvas before drawing a new frame
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Draw the video frame onto the canvas, cropping to the rectangle's area
        context.drawImage(
            videoElement,
            rectX / videoScaleX, // Adjust for scale
            rectY / videoScaleY, // Adjust for scale
            rectWidth / videoScaleX, // Adjust for scale
            rectHeight / videoScaleY, // Adjust for scale
            0,
            0,
            canvas.width,
            canvas.height,
        );

        // Get the cropped image data based on the rectangle's size
        let imageData = context.getImageData(0, 0, rectWidth, rectHeight);
        return imageData; // Return image data for prediction
    }
    function processLoop() {
        if (!$stream) {
            requestAnimationFrame(processLoop);
            return;
        }
        const imageData = processFrame(); // Get the image data from the current frame

        if (imageData && runModel) {
            predict(imageData)
                .then((res) => {
                    // Handle prediction results here (if needed)
                    results = res;
                })
                .catch((error) => {
                    console.error("Error during prediction:", error);
                });
        }
        // Request the next frame to be processed
        requestAnimationFrame(processLoop);
    }
    onMount(() => {
        canvas.width = inW;
        canvas.height = inH;
        stream.subscribe((value) => {
            if (value) {
                if (!videoElement)
                    videoElement = document.createElement("video");
                videoElement.srcObject = value;
                videoElement.play();
                videoElement.onloadedmetadata = updateVideoScale; // Update scale when video metadata is loaded
                rectX = videoElement.clientWidth / 2 - inW / 2;
                rectY = videoElement.clientHeight / 2 - inH / 2;
            }
        });
        if (!debugCanvas)
            debugCanvas = document.createElement("canvas");
        debugCanvas.width = inW;
        debugCanvas.height = inH;
        loadModel();
        processLoop();

    });

    onDestroy(() => {
        model?.dispose();
        canvas?.remove(); // Clean up the canvas element
    });
</script>

<div class="videoContainer">
    <video bind:this={videoElement} autoplay muted playsinline></video>
    <ResizableRectangle
        bind:rectX
        bind:rectY
        bind:rectWidth
        bind:rectHeight
        bind:videoElement
    />
</div>
<canvas bind:this={canvas}></canvas>

{#if modelLoaded && !runModel}
    <p>Model loaded successfully!</p>
{:else if modelLoaded && runModel}
    <p>Model running</p>
{:else if !modelLoaded}
    <p>Loading model...</p>
{/if}
<canvas bind:this={debugCanvas} class="debugCanvas"></canvas>
{#if runModel}
    <div class="results">
        {#if results && results.length > 0}
            {#each results as result}
                <p>{result.label}: {result.probability.toFixed(2)}</p>
            {/each}
        {/if}
    </div>
{/if}

<style>
    .videoContainer {
        position: relative;
        width: fit-content;
        margin: 0 auto;
    }

    .videoContainer video {
        width: 100%;
        height: auto;
        max-height: 600px;
    }
    .results {
        margin-top: 10px;
        padding: 10px;
    }

    .results p {
        margin: 0;
    }

    .debugCanvas {
        position: absolute;
        top: 0;
        right: 0;
    }
</style>
