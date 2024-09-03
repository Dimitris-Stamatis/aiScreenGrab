<script lang="ts">
    export let type: "camera" | "screen" = "camera";

    import { onDestroy } from "svelte";
    import { stream } from "../stores";

    async function startStream() {
        try {
            if (type === "camera") {
                stream.set(
                    await navigator.mediaDevices.getUserMedia({
                        video: true,
                    }),
                );
            } else {
                stream.set(
                    await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                    }),
                );
            }
        } catch (error) {
            console.error(`Error accessing ${type}:`, error);
        }
    }

    function switchScreenShare() {
        // switch input source of screen share
        stream.set(null);
        startStream();
    }

    function stopStream() {
        if ($stream) {
            $stream.getTracks().forEach((track) => track.stop());
        }
    }

    startStream();
    onDestroy(stopStream);
</script>
{#if type == "screen" && $stream}
<button on:click={() => {switchScreenShare();}}>
  Switch Screen Share
</button>
{/if}
<style>

</style>