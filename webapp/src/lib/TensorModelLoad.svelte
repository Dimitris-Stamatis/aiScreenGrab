<script lang="ts">
    import { onMount } from 'svelte';
    import * as tf from '@tensorflow/tfjs';

    export let stream: MediaStream;
    let videoElement: HTMLVideoElement;
    let worker: Worker;
    let cropRegion = { x: 0, y: 0, width: 0, height: 0 };
  
    onMount(() => {
        videoElement.srcObject = stream;
        videoElement.play();
      worker = new Worker('worker.js');
  
      worker.onmessage = (e) => {
        if (e.data.status === 'modelLoaded') {
          console.log('Model loaded successfully in worker');
        } else if (e.data.status === 'prediction') {
          console.log('Prediction result:', e.data.data);
        }
      };
      
      startProcessing();
    });
  
    async function handleModelUpload(event: any) {
      const userFile = event.target.files[0];
      if (userFile) {
        worker.postMessage({ action: 'loadModel', file: userFile });
      }
    }
  
    function startProcessing() {
        videoElement.requestVideoFrameCallback(processFrame);
    }
  
    function processFrame(now: DOMHighResTimeStamp, metadata: any) {
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
  
      // Post the image tensor to the web worker
      worker.postMessage({ action: 'processFrame', imageTensor: preprocessedImage });
  
      videoElement.requestVideoFrameCallback(processFrame);
    }
  
    function preprocessImage(imageTensor: tf.Tensor3D) {
      return imageTensor.expandDims(0);
    }
  </script>
  
  <input type="file" accept=".h5" on:change={handleModelUpload} />
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={videoElement} autoplay></video>
  <style>
    video {
      width: 100%;
      height: auto;
      border-radius: 8px;
    }
  </style>