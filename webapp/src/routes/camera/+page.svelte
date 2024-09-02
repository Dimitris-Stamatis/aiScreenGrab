<script lang="ts">
  import CameraFeed from "$lib/CameraFeed.svelte";
  import ScreenShare from "$lib/ScreenShare.svelte";

  let showCamera = true;
  let showFeed = false;
</script>

<div>
  <button on:click={() => (showCamera = !showCamera)}>
    {showCamera ? "Switch to Screen Share" : "Switch to Camera"}
  </button>
  <button on:click={() => (showFeed = !showFeed)}>
    {showFeed ? "Hide Feed" : "Show Feed"}
  </button>
  {#if showFeed}
    {#if showCamera}
      <CameraFeed />
    {:else}
      <ScreenShare />
    {/if}
  {/if}
</div>
