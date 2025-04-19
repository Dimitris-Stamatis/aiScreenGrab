import { build } from 'esbuild';

const sharedOptions = {
  bundle: true,
  format: 'esm',
  minify: true,
  external: [],
  platform: 'browser',
  target: ['es2020']
};

Promise.all([
  build({
    entryPoints: ['offscreen.js'],
    outfile: 'dist/offscreen.bundle.js',
    ...sharedOptions
  }),
  build({
    entryPoints: ['service-worker.js'],
    outfile: 'dist/service-worker.bundle.js',
    ...sharedOptions
  })
]).then(() => {
  console.log('✅ Both builds complete');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
