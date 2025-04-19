import { getAllFiles, getFile } from "./indexedDB.mjs";

export const tfIndexedDBLoader = {
    async load() {
        console.log("[Model Loader] Loading files from IndexedDB...");
        const files = await getAllFiles();
        console.log("[Model Loader] Files retrieved:", files);

        const normalizedFiles = files.map(file => ({
            ...file,
            name: file.name?.toLowerCase?.() || file.id?.toLowerCase?.(),
        }));

        const modelJsonMeta = normalizedFiles.find(file =>
            file.name?.endsWith("model.json")
        );

        const weightFileMetas = normalizedFiles
            .filter(file => file.name?.endsWith(".bin"))
            .sort((a, b) => a.name.localeCompare(b.name));

        const labelsFileMeta = normalizedFiles.find(file =>
            file.name?.endsWith("labels.json")
        );

        if (!modelJsonMeta) {
            throw new Error("Model JSON file not found in IndexedDB.");
        }

        const modelJsonBlob = await ensureBlob(modelJsonMeta);
        const modelJsonContent = await fileToString(modelJsonBlob);

        let modelJson;
        try {
            modelJson = JSON.parse(modelJsonContent);
            console.log("[Model Loader] Model JSON parsed successfully.");
        } catch (error) {
            console.error("Error parsing model JSON:", error);
            throw new Error("Invalid JSON in model.json");
        }

        if (labelsFileMeta) {
            try {
                const labelsBlob = await ensureBlob(labelsFileMeta);
                const labelsText = await fileToString(labelsBlob);
                const labels = JSON.parse(labelsText);
                console.log("[Model Loader] Labels parsed:", labels);
                if (chrome?.storage?.local) {
                    chrome.storage.local.set({ labels }, () => {
                        console.log("[Model Loader] Labels saved to Chrome storage.");
                    });
                }
            } catch (error) {
                console.error("Error parsing labels JSON:", error);
                throw new Error("Invalid JSON in labels.json");
            }
        }

        const weightBlobs = await Promise.all(weightFileMetas.map(ensureBlob));
        const weightData = await concatenateArrayBuffers(weightBlobs);

        const allWeightSpecs = modelJson.weightsManifest.flatMap(manifest => manifest.weights);

        console.log("[Model Loader] Model loaded successfully.");

        return {
            modelTopology: modelJson.modelTopology,
            weightSpecs: allWeightSpecs,
            weightData,
        };
    },
};

// =====================
// Helper functions
// =====================

async function fileToString(fileBlob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(fileBlob);
    });
}

async function fileToArrayBuffer(fileBlob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(fileBlob);
    });
}

async function concatenateArrayBuffers(files) {
    const buffers = await Promise.all(files.map(fileToArrayBuffer));
    const totalLength = buffers.reduce((acc, buffer) => acc + buffer.byteLength, 0);
    const concatenated = new Uint8Array(totalLength);

    let offset = 0;
    for (const buffer of buffers) {
        concatenated.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }

    return concatenated;
}

// New: Ensure we always get a Blob
async function ensureBlob(fileOrObject) {
    if (fileOrObject instanceof Blob) {
        return fileOrObject;
    }
    if (fileOrObject?.file instanceof Blob) {
        return fileOrObject.file;
    }
    if (fileOrObject?.name) {
        const blob = await getFile(fileOrObject.name);
        if (!blob) {
            throw new Error(`Could not find file in IndexedDB: ${fileOrObject.name}`);
        }
        return blob;
    }
    throw new TypeError("Expected a Blob or object with a file name.");
}
