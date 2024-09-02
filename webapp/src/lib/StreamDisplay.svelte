<script lang="ts">
  import TensorModelLoad from "./TensorModelLoad.svelte";

  export let stream: MediaStream; // Accepts the stream as a prop

  let videoElement: HTMLVideoElement;

  // Watch the stream prop and update the video element source
  $: if (videoElement && stream) {
    videoElement.srcObject = stream;
    videoElement.play();
  }
</script>

{#if stream}
  <TensorModelLoad {stream} />
{/if}
