import { tfIndexedDBLoader } from "./customIOHandler.mjs";
import { getItemFromDB } from "./indexedDB.mjs";
import * as tf from "@tensorflow/tfjs";

let labels = [];

/**
 * Load a model from IndexedDB using the appropriate TensorFlow.js API.
 * Supports three model types:
 *  - "layers"     → tf.loadLayersModel
 *  - "graph"      → tf.loadGraphModel (classification)
 *  - "detector"   → tf.loadGraphModel (object-detection)
 */
export async function loadModel(modelType) {
    try {
        console.log(`[Model Loader] Loading ${modelType} model...`);

        let model;
        if (modelType === "layers") {
            model = await tf.loadLayersModel(tfIndexedDBLoader);
        } else {
            // graph & detector both use GraphModel loader
            model = await tf.loadGraphModel(tfIndexedDBLoader);
            console.log("[Model Loader] Model outputs:", model.outputNodes);
            console.log(model);
        }

        labels = (await getItemFromDB("labels")) || [];
        if (!labels.length) {
            console.warn("[Model Loader] No labels found in storage.");
        } else {
            console.log("[Model Loader] Labels loaded:", labels);
        }

        console.log("[Model Loader] Model loaded successfully.");
        return model;
    } catch (error) {
        console.error("[Model Loader] Error loading model:", error);
        throw error;
    }
}

/**
 * Run classification inference and return Top-K label probabilities.
 * @param {tf.LayersModel|tf.GraphModel} model 
 * @param {ImageData|HTMLImageElement|HTMLCanvasElement} imageData 
 * @param {string} inputShape as "HxW" (e.g. "224x224")
 * @param {number} topK how many results to return
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

    const logits = tf.tidy(() => {
        const tensor = tf.browser
            .fromPixels(imageData)
            .resizeBilinear([inH, inW])
            .toFloat()
            .div(255)
            .reshape([1, inH, inW, 3]);

        return model.predict(tensor);
    });

    const data = await logits.data();
    logits.dispose();

    // build and sort results
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
    inputShape,
    { scoreThreshold = 0.5, maxDetections = 20 } = {}
) {
    if (!model) throw new Error("detect(): model is required");
    if (!/^\d+x\d+$/.test(inputShape)) {
        throw new Error("detect(): invalid inputShape, expected 'HxW'");
    }
    try {
        const [inH, inW] = inputShape.split("x").map(Number);

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
        // 2) Run inference
        const outputs = await model.executeAsync(batched, ["detection_boxes", "raw_detection_scores", "num_detections"]);
        console.log("[Model] Detection outputs:", outputs);

        // Unpack (might be single tensor if only one name)
        const [boxesT, scoresT, namesT] = Array.isArray(outputs) ? outputs : [outputs];

        // 3) Convert to JS arrays
        const [boxesArr, scoresArr, namesArr] = await Promise.all([
            boxesT.array(),   // [N,4]
            scoresT.array(),  // [N]
            namesT.array(),   // [N]
        ]);

        console.log("[Model] Detection outputs:", {
            boxes: boxesArr,
            scores: scoresArr,
            names: namesArr,
        });

        // clean up
        tf.dispose([boxesT, scoresT, namesT]);
        batched.dispose();

        // 4) Build results up to maxDetections
        const results = [];
        const count = Math.min(boxesArr.length, maxDetections);
        const W = imageData.width, H = imageData.height;

        for (let i = 0; i < count; i++) {
            const score = scoresArr[i];
            if (score < scoreThreshold) continue;
            const [ymin, xmin, ymax, xmax] = boxesArr[i];
            results.push({
                bbox: {
                    x: xmin * W,
                    y: ymin * H,
                    width: (xmax - xmin) * W,
                    height: (ymax - ymin) * H,
                },
                className: namesArr[i],
                score,
            });
        }
        console.log("[Model] Detection results:", results);
        return results;
    } catch (err) {
        console.error("[Model] Error during detection:", err);
        tf.dispose([boxesT, scoresT, namesT]);
        throw err;
    }
}
