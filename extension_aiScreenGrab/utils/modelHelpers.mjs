import { tfIndexedDBLoader } from "./customIOHandler.mjs";
import * as tf from "@tensorflow/tfjs"

let labels = [];

/**
 * Load a model from IndexedDB using the appropriate TensorFlow.js API.
 * Supports both Graph and Layers models.
 */
export async function loadModel(modelType) {
    try {
        console.log(`[Model Loader] Loading ${modelType} model...`);
        const model = modelType === "graph"
            ? await tf.loadGraphModel(tfIndexedDBLoader)
            : await tf.loadLayersModel(tfIndexedDBLoader);

        const labelResult = await chrome.storage.local.get('labels');
        labels = labelResult?.labels || [];
        if (!labels.length) {
            console.warn("[Model Loader] No labels found in storage.");
        } else {
            console.log("[Model Loader] Labels loaded:", labels);
        }

        console.log("[Model Loader] Model loaded successfully.");
        return model;
    } catch (error) {
        console.error("Error loading model:", error);
        throw error;
    }
}

/**
 * Run prediction on input image data and return Top-K label probabilities.
 * @param {*} model - Loaded TensorFlow.js model
 * @param {*} imageData - Image or canvas input
 * @param {*} inputShape - Expected input shape as string (e.g., "224x224")
 * @param {*} topK - Optional number of top predictions to return
 */
export async function predict(model, imageData, inputShape, topK) {
    if (!model) {
        console.error("Model not loaded.");
        return [];
    }

    if (!inputShape || !/^\d+x\d+$/.test(inputShape)) {
        console.error("Invalid input shape format. Expected 'HxW' (e.g., '224x224').");
        return [];
    }

    const [inH, inW] = inputShape.split("x").map(Number);

    const logits = tf.tidy(() => {
        const tensor = tf.browser
            .fromPixels(imageData)
            .resizeBilinear([inH, inW])
            .toFloat();
        const normalized = tensor.div(255);
        const batched = normalized.reshape([1, inH, inW, 3]);

        return model.predict(batched);
    });

    const data = await logits.data();

    const results = Array.from(data).map((probability, index) => ({
        label: labels[index] || `Class ${index}`,
        probability,
    }));

    results.sort((a, b) => b.probability - a.probability);

    if (topK && Number.isInteger(topK) && topK > 0) {
        return results.slice(0, topK);
    }

    return results;
}
