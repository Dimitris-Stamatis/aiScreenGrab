<script lang="ts">
    import { onDestroy } from 'svelte';
    import StreamDisplay from './StreamDisplay.svelte';
  
    let stream: MediaStream;
  
    // Function to initialize the camera feed
    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (error) {
        console.error('Error accessing camera:', error);
      }
    }
  
    // Clean up the stream when the component is destroyed
    onDestroy(() => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    });
  
    startCamera();
  </script>
  
  <StreamDisplay {stream} />
  
  <button on:click={startCamera}>Restart Camera</button>
  