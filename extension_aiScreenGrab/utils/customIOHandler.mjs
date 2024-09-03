// Custom TensorFlow.js I/O handler for IndexedDB
export const indexedDBIOHandler = {
    async load() {
        const files = await getAllFiles();
        const modelJsonFile = files.find((file) =>
            file.name.endsWith("model.json"),
        );
        const weightFiles = files.filter((file) =>
            file.name.endsWith(".bin"),
        );
        const labelsFile = files.find((file) =>
            file.name.endsWith("labels.json"),
        );

        if (!modelJsonFile) {
            throw new Error("Model JSON file not found in IndexedDB.");
        }

        const modelJsonContent = await fileToString(modelJsonFile);
        let modelJson;
        try {
            modelJson = JSON.parse(modelJsonContent);
        } catch (error) {
            console.error("Error parsing model JSON:", error);
            throw new Error("Invalid JSON in model.json");
        }

        if (labelsFile) {
            const labelsText = await fileToString(labelsFile);
            try {
                labels = JSON.parse(labelsText);
            } catch (error) {
                console.error("Error parsing labels JSON:", error);
                throw new Error("Invalid JSON in labels.json");
            }
        }

        const weightData = await concatenateArrayBuffers(weightFiles);

        return {
            modelTopology: modelJson.modelTopology,
            weightSpecs: modelJson.weightsManifest[0].weights,
            weightData: weightData,
        };
    },
};

async function fileToString(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

async function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

async function concatenateArrayBuffers(files) {
    const buffers = await Promise.all(files.map(fileToArrayBuffer));
    const totalLength = buffers.reduce(
        (acc, buffer) => acc + buffer.byteLength,
        0,
    );
    const concatenatedArray = new Uint8Array(totalLength);
    let offset = 0;

    for (const buffer of buffers) {
        concatenatedArray.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }

    return concatenatedArray;
}