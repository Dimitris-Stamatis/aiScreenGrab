// --build.mjs--
import { build } from 'esbuild';

const sharedOptions = {
  bundle: true,
  format: 'iife', // Changed to iife for content scripts if they are not modules themselves
  // minify: true, // Keep commented for easier debugging for now
  external: [], // Typically no externals for content scripts unless carefully managed
  platform: 'browser',
  target: ['es2020']
};

Promise.all([
  build({
    entryPoints: ['offscreen.js'],
    outfile: 'dist/offscreen.bundle.js',
    ...sharedOptions,
    format: 'esm', // Offscreen and SW can remain ESM
  }),
  build({
    entryPoints: ['service-worker.js'],
    outfile: 'dist/service-worker.bundle.js',
    ...sharedOptions,
    format: 'esm', // Offscreen and SW can remain ESM
  }),
  build({ // Add new build target for injected.js
    entryPoints: ['injected.js'],
    outfile: 'dist/injected.bundle.js',
    ...sharedOptions, // 'iife' format from sharedOptions is good here
  })
]).then(() => {
  console.log('✅ All builds complete (service-worker, offscreen, injected)');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});