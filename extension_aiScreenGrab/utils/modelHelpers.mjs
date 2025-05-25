import { tfIndexedDBLoader } from "./customIOHandler.mjs";
import * as tf from "@tensorflow/tfjs";
import { getItemFromDB } from "./indexedDB.mjs";

/*
 * Load a model from IndexedDB using the appropriate TensorFlow.js API.
 * Supports three model types:
 *  - "layers"     → tf.loadLayersModel
 *  - "graph"      → tf.loadGraphModel (classification)
 *  - "detector"   → tf.loadGraphModel (object-detection)
 */

let labels = null;
export async function loadModel() {
    try {
        console.log(`[Model Loader] Loading model...`);
        let model;
        // graph & detector both use GraphModel loader
        model = await tf.loadGraphModel(tfIndexedDBLoader);
        console.log("[Model Loader] Model outputs:", model.outputNodes);
        console.log(model);
        console.log("[Model Loader] Model loaded successfully.");
        labels = await getItemFromDB("labels");
        return model;
    } catch (error) {
        console.error("[Model Loader] Error loading model:", error);
        throw error;
    }
}

/**
 * Run classification inference and return Top-K label probabilities.
 * @param {tf.LayersModel|tf.GraphModel} model The TensorFlow.js model.
 * @param {ImageData|HTMLImageElement|HTMLCanvasElement} imageData The input image.
 * @param {string} inputShape Input shape as "HxW" (e.g., "224x224").
 * @param {string[]} labels Array of class labels, indexed by the model's output.
 * @param {number} [topK=5] How many top results to return.
 */
export async function predict(model, imageData, inputShape, topK = 5) {
    if (!model) {
        console.error("[Predict] Model not loaded.");
        return [];
    }
    if (!inputShape || !/^\d+x\d+$/.test(inputShape)) {
        console.error("[Predict] Invalid input shape. Expected 'HxW'.");
        return [];
    }

    const [inH, inW] = inputShape.split("x").map(Number);

    const probabilityTensor = tf.tidy(() => {
        const imgTensor = tf.browser
            .fromPixels(imageData)
            .resizeBilinear([inH, inW])
            .toFloat();

        // Normalize the image tensor. Common is 0-1 (div 255.0).
        // IMPORTANT: This MUST match your model's training preprocessing.
        // Some models expect -1 to 1 (e.g., `imgTensor.sub(127.5).div(127.5)`).
        const normalizedTensor = imgTensor.div(255.0);

        const reshapedTensor = normalizedTensor.reshape([1, inH, inW, 3]);

        // Get model predictions (logits)
        const logits = model.predict(reshapedTensor);

        // Apply Softmax to convert logits to probabilities.
        // This is necessary if the model's last layer isn't already softmax.
        let probabilities;
        if (Array.isArray(logits)) {
            // Handle models with multiple output tensors (use the first for classification)
            probabilities = tf.softmax(logits[0]);
        } else if (typeof logits === 'object' && logits.rank === undefined && Object.keys(logits).length > 0) {
            // Handle GraphModel named outputs (e.g., { "output_name": tensor })
            // Assumes the first output tensor found is the classification output.
            const outputLayerName = Object.keys(logits).find(key => logits[key] && logits[key].rank !== undefined);
            if (outputLayerName) {
                probabilities = tf.softmax(logits[outputLayerName]);
            } else {
                console.error("[Predict] Could not find a valid tensor in GraphModel output:", logits);
                return tf.tensor([]); // Return empty to prevent further errors
            }
        } else if (logits.rank !== undefined) {
            // Standard case: logits is a single Tensor
            probabilities = tf.softmax(logits);
        } else {
             console.error("[Predict] Unexpected model output structure:", logits);
             return tf.tensor([]);
        }
        return probabilities;
    });

    const data = await probabilityTensor.data();
    probabilityTensor.dispose();

    if (data.length === 0) {
        return []; // Softmax or model output handling failed
    }

    const results = Array.from(data).map((prob, i) => ({
        label: labels[i] ?? `Class ${i}`,
        probability: prob,
    }));
    results.sort((a, b) => b.probability - a.probability);

    return results.slice(0, topK);
}

/**
 * Run object detection inference for MobileNet SSD v2 (no batching).
 */
export async function detect(
    model,
    imageData,
    modelDetails
) {
    if (!model) throw new Error("detect(): model is required");
    if (!/^\d+x\d+$/.test(modelDetails.inputShape)) {
        throw new Error("detect(): invalid inputShape, expected 'HxW'");
    }
    try {
        const [inH, inW] = modelDetails.inputShape.split("x").map(Number);

        // 1) Preprocess into [1,H,W,3]
        const batched = tf.tidy(() =>
            tf.browser
                .fromPixels(imageData)
                .resizeBilinear([inH, inW])
                //.toFloat()
                //.div(255)
                //.reshape([1, inH, inW, 3])
                .cast("int32")
                .expandDims(0)
        );
        const sig = model.signature;
        const input = sig.inputs['input_tensor'].name;

        // Map the logical outputs to the correct Identity names:
        const numName = sig.outputs['num_detections'].name;
        const boxName = sig.outputs['detection_boxes'].name;
        const scoreName = sig.outputs['Identity_4:0'].name;
        const className = sig.outputs['Identity_2:0'].name;

        const [numT, boxesT, scoresT, classesT] = await model.executeAsync(
            { [input]: batched },
            [numName, boxName, scoreName, className]
        );

        const [numArr, boxesArr, scoresArr, classesArr] = await Promise.all([
            numT.data(),    // Float32Array([N])
            boxesT.array(), // [[ymin,xmin,ymax,xmax],…]
            scoresT.data(), // Float32Array([…])   ← these are your detection_scores
            classesT.data() // Float32Array([…])   ← these are your detection_classes
        ]);

        // clean up
        tf.dispose([numT, boxesT, scoresT, classesT]);
        batched.dispose();

        // drop the batch axis:
        const rawBoxes = boxesArr[0];   // shape: [numDetections][4]
        const numDetections = numArr[0];
        const results = [];
        console.log(labels);

        for (let i = 0; i < numDetections; i++) {
            const score = scoresArr[i];
            if (score < modelDetails.scoreThreshold) continue;

            const [yMin, xMin, yMax, xMax] = rawBoxes[i];
            const classId = classesArr[i];

            results.push({
                classId,
                label: labels[classId] ?? `Class ${classId}`,
                score,
                box: { top: yMin, left: xMin, bottom: yMax, right: xMax },
            });
        }
        results.sort((a, b) => b.score - a.score);
        console.log("[Model] Detection results sorted:", results);
        return results.slice(0, modelDetails.maxDetections);
    }
    catch (err) {
        console.error("[Model] Error during detection:", err);
        tf.dispose([numT, boxesT, scoresT, classesT]);
        if (batched) batched.dispose();
        throw err;
    }
}
