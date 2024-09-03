<script lang="ts">
    import { onMount } from "svelte";

    export let rectX: number;
    export let rectY: number;
    export let rectWidth: number;
    export let rectHeight: number;
    export let inW: number;
    export let inH: number;
    export let videoElement: HTMLVideoElement;

    let rect: HTMLDivElement;
    let resizeHandle: HTMLDivElement;
    let resizing = false;

    function handleMouseDown(event: MouseEvent) {
        if (resizing)
            return;
        const startX = event.clientX;
        const startY = event.clientY;

        const rectRect = rect.getBoundingClientRect();
        const offsetX = startX - rectRect.left;
        const offsetY = startY - rectRect.top;

        function handleMouseMove(event: MouseEvent) {
            if (resizing)
                return;
            const newX = event.clientX - offsetX;
            const newY = event.clientY - offsetY;

            // Update the rectangle's position within video bounds
            const maxX = videoElement.clientWidth - rectWidth;
            const maxY = videoElement.clientHeight - rectHeight;

            rectX = Math.max(0, Math.min(newX, maxX));
            rectY = Math.max(0, Math.min(newY, maxY));

            event.preventDefault();
        }

        function handleMouseUp() {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        }

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    }

    function handleResizeMouseDown(event: MouseEvent) {
        let startX = event.clientX;
        let startY = event.clientY;

        const aspectRatio = rectWidth / rectHeight; // Preserve the aspect ratio

        function handleMouseMove(event: MouseEvent) {
            resizing = true;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;

            let newWidth = rectWidth + dx;
            let newHeight = rectHeight + dy;

            // Preserve aspect ratio and adjust both dimensions
            if (Math.abs(dx) > Math.abs(dy)) {
                newWidth = Math.max(50, Math.min(newWidth, videoElement.clientWidth - rectX));
                newHeight = newWidth / aspectRatio;
            } else {
                newHeight = Math.max(50, Math.min(newHeight, videoElement.clientHeight - rectY));
                newWidth = newHeight * aspectRatio;
            }

            if (newWidth > videoElement.clientWidth - rectX) {
                newWidth = videoElement.clientWidth - rectX;
                newHeight = newWidth / aspectRatio;
            }

            if (newHeight > videoElement.clientHeight - rectY) {
                newHeight = videoElement.clientHeight - rectY;
                newWidth = newHeight * aspectRatio;
            }

            rectWidth = newWidth;
            rectHeight = newHeight;

            event.preventDefault();
        }

        function handleMouseUp() {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            resizing = false;
        }

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    }
</script>

<div
    class="rectangle"
    bind:this={rect}
    style="{`left: ${rectX}px; top: ${rectY}px; width: ${rectWidth}px; height: ${rectHeight}px;`}"
    on:mousedown={handleMouseDown}
    aria-hidden="true"
>
    <div
        class="resizeHandle"
        bind:this={resizeHandle}
        on:mousedown={handleResizeMouseDown}
        aria-hidden="true"
    ></div>
</div>

<style>
    .rectangle {
        position: absolute;
        border: 2px solid red; /* Rectangle border style */
        background-color: rgba(255, 0, 0, 0.3); /* Background color with transparency */
        cursor: move; /* Cursor style for moving */
        box-sizing: border-box; /* Include padding and border in the element's total size */
    }

    .resizeHandle {
        position: absolute;
        width: 20px; /* Handle size */
        height: 20px; /* Handle size */
        background-color: red; /* Handle color */
        cursor: nwse-resize; /* Cursor style for resizing */
        right: 0;
        bottom: 0;
    }
</style>
