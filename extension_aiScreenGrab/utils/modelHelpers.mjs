import { indexedDBIOHandler } from "./customIOHandler.mjs";
import * as tf from 'https://cdn.skypack.dev/pin/@tensorflow/tfjs@v4.20.0-2i3xZugZdN63AwP38wHs/mode=imports,min/optimized/@tensorflow/tfjs.js';

let labels = [];
export async function loadModel(modelType) {
    try {
        let model = null;
        if (modelType == "graph") {
            model =  await tf.loadGraphModel(indexedDBIOHandler);
        } else {
            model = await tf.loadLayersModel(indexedDBIOHandler);
        }
        labels = (await chrome.storage.local.get('labels'))?.labels;
        return model;
    } catch (error) {
        console.error("Error loading model:", error);
    }

}

export async function predict(model, imageData, inputShape) {
    if (!model) {
        console.error("Model not loaded.");
        return;
    }

    const [inH, inW] = inputShape.split("x").map(Number);

    const logits = tf.tidy(() => {

    const tensor = tf.browser
        .fromPixels(imageData)
        .resizeBilinear([inH, inW])
        .toFloat();
    const offset = tf.scalar(255);
    const normalized = tensor.div(offset);
    const batched = normalized.reshape([1, inH, inW, 3]);

    return model.predict(batched);
    });
    const data = await logits.data();
    const results = Array.from(data).map((probability, index) => ({
        label: labels[index] || `Class ${index}`,
        probability,
    }));

    results.sort((a, b) => b.probability - a.probability);
    return results;
}