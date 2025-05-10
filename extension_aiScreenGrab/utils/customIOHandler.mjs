import { getAllFiles, getFile, setItemInDB } from "./indexedDB.mjs";

export const tfIndexedDBLoader = {
  async load() {
    console.log("[Model Loader] Loading files from IndexedDB...");
    const files = await getAllFiles();
    console.log("[Model Loader] Files retrieved:", files);

    // normalize names to lower-case for matching
    const normalizedFiles = files.map(f => ({
      ...f,
      name: (f.name || f.id || "").toLowerCase(),
    }));

    // find model.json
    const modelJsonMeta = normalizedFiles.find(
      f => f.name.endsWith("model.json")
    );
    if (!modelJsonMeta) {
      throw new Error("Model JSON file not found in IndexedDB.");
    }

    // load and parse model.json
    const modelJsonBlob = await ensureBlob(modelJsonMeta);
    const modelJson = JSON.parse(await fileToString(modelJsonBlob));
    console.log("[Model Loader] Model JSON parsed.");

    // optional: load labels.json
    const labelsMeta = normalizedFiles.find(f => f.name.endsWith("labels.json"));
    if (labelsMeta) {
      const labels = JSON.parse(await fileToString(await ensureBlob(labelsMeta)));
      await setItemInDB("labels", labels);
      console.log("[Model Loader] Labels saved to IndexedDB.");
    }

    const signature = modelJson.signature || null;

    // **NEW**: use exactly the shard filenames from your weightsManifest
    const weightPaths = modelJson.weightsManifest
      .flatMap(manifest => manifest.paths)
      .map(p => p.toLowerCase());

    // find each shard by name (no “.bin” suffix assumption)
    const weightFileMetas = weightPaths.map(path => {
      const fileMeta = normalizedFiles.find(f => f.name === path);
      if (!fileMeta) {
        throw new Error(`Missing weight shard in IndexedDB: ${path}`);
      }
      return fileMeta;
    });

    // load all shards and concatenate
    const blobs = await Promise.all(weightFileMetas.map(ensureBlob));
    const weightData = await concatenateArrayBuffers(blobs);

    // flatten weight specs
    const weightSpecs = modelJson.weightsManifest
      .flatMap(manifest => manifest.weights);

    console.log("[Model Loader] Model loaded successfully.");
    return {
      modelTopology: modelJson.modelTopology,
      weightSpecs,
      weightData,
      signature,
    };
  },
};

// =====================
// helper functions (unchanged)
// =====================

async function fileToString(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(blob);
  });
}

async function fileToArrayBuffer(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(blob);
  });
}

async function concatenateArrayBuffers(files) {
  const bufs = await Promise.all(files.map(fileToArrayBuffer));
  const total = bufs.reduce((sum, b) => sum + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of bufs) {
    out.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return out.buffer;
}

async function ensureBlob(fileMeta) {
  // if it's already a Blob
  if (fileMeta instanceof Blob) return fileMeta;
  // if getAllFiles gave us a {file: Blob} wrapper
  if (fileMeta.file instanceof Blob) return fileMeta.file;
  // otherwise look it up by name
  const blob = await getFile(fileMeta.name);
  if (!blob) throw new Error(`Could not find file: ${fileMeta.name}`);
  return blob;
}
