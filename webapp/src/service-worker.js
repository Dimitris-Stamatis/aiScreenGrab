/*import { build, files, version } from '$service-worker';
//importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
import * as tf from 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs';
//import * as tf from '@tensorflow/tfjs';

const CACHE = `sw-v${version}`;

const ASSETS = [
    ...files,
    ...build,
];

self.addEventListener('install', (event) => {
    async function preCache() {
        const cache = await caches.open(CACHE);
        await cache.addAll(ASSETS);
    }
    event.waitUntil(preCache());
});

self.addEventListener('activate', (event) => {
    async function clearCache() {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => {
            if (key !== CACHE) {
                return caches.delete(key);
            }
        }));
    }
    event.waitUntil(clearCache());
});

let model = null;

self.onmessage = async (event) => {
    if (event.data.action === 'load') {
        const userFile = event.data.file;
        model = await tf.loadLayersModel(tf.io.browserFiles([userFile]));
        self.postMessage({ status: 'loaded' });
    } else if (event.data.action === 'predict') {
        const imageTensor = event.data.imageTensor;
        const prediction = model.predict(imageTensor);

        const formattedPrediction = formatPredictions(prediction);
        self.postMessage({ status: 'predicted', data: formattedPrediction });
    }
};

function formatPredictions(prediction) {
    return [
        // Example: Mocked-up predictions
    { x: 100, y: 150, width: 200, height: 100, label: 'Object 1' },
    { x: 300, y: 250, width: 100, height: 200, label: 'Object 2' }
    ];
}*/