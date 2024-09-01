<script lang="ts">
    export let stream; // Accepts the stream as a prop
    
    let videoElement: HTMLVideoElement;
  
    // Watch the stream prop and update the video element source
    $: if (videoElement && stream) {
      videoElement.srcObject = stream;
      videoElement.play();
    }
  </script>
  
  <video bind:this={videoElement} autoplay muted playsinline></video>
  
  <style>
    video {
      width: 100%;
      height: auto;
      border-radius: 8px;
    }
  </style>
  