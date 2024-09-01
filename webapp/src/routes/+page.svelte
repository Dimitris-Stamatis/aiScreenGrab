<script lang="ts">
    import { onMount } from "svelte";

    let videoStream: MediaStream | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let captureArea = { x: 0, y: 0, width: 0, height: 0 };
    let isDrawing = false;
    let startX = 0;
    let startY = 0;

    onMount(() => {
        if (canvas) {
            setupCanvas();
        }
        window.addEventListener("message", (event) => {
            console.log("Received message:", event.data);
            if (event.data.type === "streamId") {
                const streamId = event.data.streamId;
                // Handle the stream ID, e.g., start capturing with it
                startCaptureWithStreamId(streamId);
            }
        });
    });

    async function startCapture() {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
            });
            videoStream = stream;
            const video = document.createElement("video");
            video.srcObject = stream;
            video.play();

            video.addEventListener("loadeddata", () => {
                setupCanvas();
            });
        } catch (err) {
            console.error("Error capturing screen:", err);
        }
    }

    function setupCanvas() {
        if (canvas) {
            const ctx = canvas.getContext("2d");
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            canvas.addEventListener("mousedown", (e: MouseEvent) => {
                isDrawing = true;
                startX = e.offsetX;
                startY = e.offsetY;
            });

            canvas.addEventListener("mousemove", (e: MouseEvent) => {
                if (isDrawing) {
                    captureArea = {
                        x: Math.min(startX, e.offsetX),
                        y: Math.min(startY, e.offsetY),
                        width: Math.abs(e.offsetX - startX),
                        height: Math.abs(e.offsetY - startY),
                    };
                }
            });

            canvas.addEventListener("mouseup", () => {
                isDrawing = false;
                processCapturedArea();
            });
        }
    }

    function processCapturedArea() {
        if (videoStream && canvas) {
            const video = document.createElement("video");
            video.srcObject = videoStream;
            video.play();

            video.addEventListener("loadeddata", () => {
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    canvas.width = captureArea.width;
                    canvas.height = captureArea.height;
                    ctx.drawImage(
                        video,
                        captureArea.x,
                        captureArea.y,
                        captureArea.width,
                        captureArea.height,
                        0,
                        0,
                        canvas.width,
                        canvas.height,
                    );

                    canvas.toBlob((blob) => {
                        if (blob) {
                            console.log("Cropped image Blob:", blob);
                            runInference(blob);
                        }
                    }, "image/png");
                }
            });
        }
    }

    async function runInference(imageBlob: Blob) {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(imageBlob);
        img.onload = async () => {
            // Load TensorFlow.js or another AI library
            const { default: tf } = await import("@tensorflow/tfjs");
            const model = await tf.loadLayersModel("/path/to/your/model.json");
            const imgTensor = tf.browser.fromPixels(img);
            const prediction = model.predict(imgTensor.expandDims(0));
            prediction.print(); // Handle predictions as needed
        };
    }

    function startCaptureWithStreamId(streamId: string) {
        console.log("Received stream ID:", streamId);
        // Your logic to handle the stream ID and start capturing
    }
</script>

<button on:click={startCapture}>Start Screen Capture</button>

<canvas bind:this={canvas} id="canvas"></canvas>

{#if captureArea.width && captureArea.height}
    <div
        style="
        position: absolute;
        border: 2px dashed red;
        left: {captureArea.x}px;
        top: {captureArea.y}px;
        width: {captureArea.width}px;
        height: {captureArea.height}px;
      "
    ></div>
{/if}

<style>
    #canvas {
        border: 2px solid black;
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none;
    }
</style>
