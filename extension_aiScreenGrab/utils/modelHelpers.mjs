import { indexedDBIOHandler } from "./customIOHandler.mjs";
export async function loadModel() {
    try {
        if ($modelStore.modelType == "graph") {
            model = await tf.loadGraphModel(indexedDBIOHandler);
        } else {
            model = await tf.loadLayersModel(indexedDBIOHandler);
        }
        return model;
    } catch (error) {
        console.error("Error loading model:", error);
    }
}

export async function predict(imageData) {
    if (!model) {
        console.error("Model not loaded.");
        return;
    }

    const logits = tf.tidy(() => {

    const tensor = tf.browser
        .fromPixels(imageData)
        .resizeBilinear([inH, inW])
        .toFloat();
    const offset = tf.scalar(255);
    const normalized = tensor.div(offset);
    const batched = normalized.reshape([1, inH, inW, 3]);

    // print the image to the ui for debugging purposes
    const debugContext = debugCanvas.getContext("2d");
    // clear debug canvas
    debugContext?.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    debugContext?.putImageData(imageData, 0, 0);

    return model?.predict(batched);
    });
    const data = await logits.data();
    const results = Array.from(data).map((probability, index) => ({
        label: labels[index] || `Class ${index}`,
        probability,
    }));

    results.sort((a, b) => b.probability - a.probability);
    return results;
}