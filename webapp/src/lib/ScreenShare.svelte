<script lang="ts">
  import { onDestroy } from "svelte";
  import StreamDisplay from "./StreamDisplay.svelte";

  let stream: MediaStream;

  // Function to start screen sharing
  async function startScreenShare() {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch (error) {
      console.error("Error accessing screen share:", error);
    }
  }

  // Clean up the stream when the component is destroyed
  onDestroy(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  });

  startScreenShare();
</script>

<StreamDisplay {stream} />

<button on:click={startScreenShare}>Restart Screen Share</button>
