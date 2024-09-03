<script lang="ts">
  import StreamHandler from "$lib/StreamHandler.svelte";
    import TensorModelLoad from "$lib/TensorModelLoad.svelte";
  import { modelStore } from "../../stores";

  let showCamera = true;
  let showFeed = false;
  let runModel = false;

  if ( typeof window !== "undefined" && $modelStore.modelFiles.length === 0 ) {
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
      <StreamHandler type="screen"/>
    {/if}
  {/if}
  <button on:click={() => {runModel = !runModel;}}>
    {runModel ? "Stop Model" : "Run Model"}
    </button>
  <TensorModelLoad {runModel}/>
</div>

<style>
  :global(button) {
    margin: 10px;
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    background-color: #007bff;
    color: #fff;
    cursor: pointer;
  }

  :global(button:hover) {
    background-color: #0056b3;
  }
</style>