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
        const sig = model.signature;
        const input = sig.inputs['input_tensor'].name;

        // Map the logical outputs to the correct Identity names:
        const numName = sig.outputs['num_detections'].name;     // "Identity_5:0"
        const boxName = sig.outputs['detection_boxes'].name;    // "Identity_1:0"
        const scoreName = sig.outputs['Identity_4:0'].name;       // detection_scores
        const className = sig.outputs['Identity_2:0'].name;       // detection_classes

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

        for (let i = 0; i < numDetections; i++) {
            const score = scoresArr[i];
            if (score < scoreThreshold) continue;

            const [yMin, xMin, yMax, xMax] = rawBoxes[i];
            const classId = classesArr[i];

            results.push({
                classId,
                label: labels[classId-1] ?? `Class ${classId}`,
                score,
                box: { top: yMin, left: xMin, bottom: yMax, right: xMax },
            });
        }
        results.sort((a, b) => b.score - a.score);
        console.log("[Model] Detection results sorted:", results);
        return results.slice(0, maxDetections);
    }
    catch (err) {
        console.error("[Model] Error during detection:", err);
        tf.dispose([numT, boxesT, scoresT, classesT]);
        if (batched) batched.dispose();
        throw err;
    }
}
