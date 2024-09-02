<script lang="ts">
  import StreamHandler from "$lib/StreamHandler.svelte";
  import { modelStore } from "../../stores";

  $: showCamera = true;
  let showFeed = false;

  if ( $modelStore.modelFiles.length === 0 ) {
    alert("Please upload a model file first.");
    location.href = "/model-setup";
  }

</script>

<div>
  <button on:click={() => {showCamera = !showCamera; showFeed = true;}}>
    {showCamera ? "Switch to Screen Share" : "Switch to Camera"}
  </button>
  <button on:click={() => (showFeed = !showFeed)}>
    {showFeed ? "Hide Feed" : "Show Feed"}
  </button>
  {#if showFeed}
    {#if showCamera}
      <StreamHandler type="camera" />
    {:else}
      <StreamHandler type="screen" />
    {/if}
  {/if}
</div>
