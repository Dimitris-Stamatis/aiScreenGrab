<script lang="ts">
    import CameraFeed from '$lib/CameraFeed.svelte';
    import ScreenShare from '$lib/ScreenShare.svelte';
  
    let showCamera = true;
  </script>
  
  <div>
    <button on:click={() => showCamera = !showCamera}>
      {showCamera ? 'Switch to Screen Share' : 'Switch to Camera'}
    </button>
  
    {#if showCamera}
      <CameraFeed />
    {:else}
      <ScreenShare />
    {/if}
  </div>
  