// build.mjs
import { build } from 'esbuild';

const sharedOptions = {
  bundle: true,
  minify: false, // Set to true for production releases
  platform: 'browser',
  target: ['es2020'],
  // esbuild needs to know how to handle .mjs files when imported from .js
  loader: { '.mjs': 'js' }, 
};

Promise.all([
  build({
    ...sharedOptions,
    entryPoints: ['service-worker.js'],
    outfile: 'dist/service-worker.bundle.js',
    format: 'esm',
  }),
  build({
    ...sharedOptions,
    entryPoints: ['injected.js'],
    outfile: 'dist/injected.bundle.js',
    // IIFE is best for content scripts to avoid polluting global scope
    // and to allow top-level await in the main async function.
    format: 'iife', 
  })
]).then(() => {
  console.log('✅ All builds complete (service-worker, injected)');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});