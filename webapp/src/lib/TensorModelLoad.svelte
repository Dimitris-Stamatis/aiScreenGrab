<script lang="ts">
  import { onMount } from 'svelte';
  import * as tf from '@tensorflow/tfjs';

  export let stream: MediaStream;
  let videoElement: HTMLVideoElement;
  let worker: Worker;
  let cropRegion = { x: 0, y: 0, width: 0, height: 0 };
  let model: tf.GraphModel;

  onMount(() => {
    videoElement.srcObject = stream;
    videoElement.play();
    
    worker = new Worker('service-worker.js');

    worker.onmessage = (e) => {
      if (e.data.status === 'modelLoaded') {
        console.log('Model loaded successfully in worker');
      } else if (e.data.status === 'prediction') {
        console.log('Prediction result:', e.data.data);
      }
    };
  });

  async function handleModelUpload(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    if (!files || files.length === 0) {
      alert('Please upload model files (model.json and .bin files).');
      return;
    }

    // Create an in-memory file mapping for the uploaded files
    const fileMap = new Map<string, File>();
    for (const file of files) {
      fileMap.set(file.name, file);
    }

    // Find and load the model.json file
    const modelFile = fileMap.get('model.json');
    if (!modelFile) {
      alert('model.json file not found. Please upload the correct files.');
      return;
    }

    // Create a custom I/O handler for loading the model
    const customLoader = {
      async load() {
        const modelJson = JSON.parse(await modelFile.text());

        const weightDataPromises = modelJson.weightsManifest[0].paths.map(async (path: string) => {
          const weightFileName = path.split('/').pop();
          console.log(weightFileName);
          if (!weightFileName) {
            throw new Error(`Invalid weight file path: ${path}`);
          }
          const weightFile = fileMap.get(weightFileName);
          if (!weightFile) {
            throw new Error(`Weight file ${weightFileName} not found.`);
          }
          return new Uint8Array(await weightFile.arrayBuffer());
        });

        const weightDataArray = await Promise.all(weightDataPromises);
        const weightData = weightDataArray.reduce((acc, val) => {
          const mergedArray = new Uint8Array(acc.byteLength + val.byteLength);
          mergedArray.set(new Uint8Array(acc), 0);
          mergedArray.set(new Uint8Array(val), acc.byteLength);
          return mergedArray.buffer;
        });

        const ret = {
          modelTopology: modelJson.modelTopology,
          weightSpecs: modelJson.weightsManifest[0].weights,
          weightData: weightData
        };
        console.log(ret);
        return ret;
      }
    };

    try {
      // Load the model using the custom loader
      model = await tf.loadGraphModel(customLoader);
      console.log('Model loaded successfully');

      startProcessing();
    } catch (error) {
      console.error('Error loading model:', error);
      alert('Error loading model. Please check the files and try again.');
    }
  }

  function startProcessing() {
    videoElement.requestVideoFrameCallback(processFrame);
  }

  async function processFrame(now: DOMHighResTimeStamp, metadata: any) {
    const canvas = document.createElement('canvas');
    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');

    canvas.width = cropRegion.width;
    canvas.height = cropRegion.height;

    ctx?.drawImage(
      videoElement,
      cropRegion.x,
      cropRegion.y,
      cropRegion.width,
      cropRegion.height,
      0,
      0,
      cropRegion.width,
      cropRegion.height
    );

    const imageTensor = tf.browser.fromPixels(canvas);
    const preprocessedImage = preprocessImage(imageTensor);

    // Run prediction with the loaded model
    const prediction = model.predict(preprocessedImage);

    console.log('Prediction result:', await prediction);

    // Continue the frame processing
    videoElement.requestVideoFrameCallback(processFrame);
  }

  function preprocessImage(imageTensor: tf.Tensor3D) {
    // Adjust preprocessing as needed (resize, normalize, etc.)
    return imageTensor.expandDims(0);
  }
</script>

<!-- Updated file input to accept both model.json and .bin files -->
<input type="file" accept=".json,.bin,.config" multiple on:change={handleModelUpload} />
<!-- svelte-ignore a11y_media_has_caption -->
<video bind:this={videoElement} autoplay></video>

<style>
  video {
    width: 100%;
    height: auto;
    border-radius: 8px;
  }
</style>
