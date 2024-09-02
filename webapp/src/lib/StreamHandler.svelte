<script lang="ts">

    export let type: "camera" | "screen" = "camera";

    import { onDestroy } from "svelte";
    import { stream } from "../stores";


    let videoElement: HTMLVideoElement;
    async function startStream() {
        try {
            if (type === "camera") {
                stream.set(await navigator.mediaDevices.getUserMedia({
                    video: true,
                }));
            } else {
                stream.set(await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                }));
            }
            videoElement.srcObject = $stream;
        } catch (error) {
            console.error(`Error accessing ${type}:`, error);
        }
    }

    function stopStream() {
        if ($stream) {
            $stream.getTracks().forEach((track) => track.stop());
        }
    }

    startStream();
    onDestroy(stopStream);
</script>

<video bind:this={videoElement} autoplay muted playsinline></video>