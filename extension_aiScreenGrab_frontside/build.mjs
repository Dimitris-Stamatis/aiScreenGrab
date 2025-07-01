// build.mjs
import { build } from 'esbuild';

const shared = {
  bundle: true,
  minify: false,
  platform: 'browser',
  target: ['es2020']
};

Promise.all([
  // 1) Bundle indexedDB.mjs
  build({
    entryPoints: ['utils/indexedDB.mjs'],
    outfile: 'dist/utils/indexedDB.bundle.js',
    format: 'esm',
    ...shared
  }),

  // 2) Bundle modelHelpers.mjs
  build({
    entryPoints: ['utils/modelHelpers.mjs'],
    outfile: 'dist/utils/modelHelpers.bundle.js',
    format: 'esm',
    ...shared
  }),

  // 3) Bundle the injected script itself (it will no longer have static imports to utils)
  build({
    entryPoints: ['injected.js'],
    outfile: 'dist/injected.bundle.js',
    format: 'iife',
    ...shared
  })
])
  .then(() => console.log('✅ Build complete'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
