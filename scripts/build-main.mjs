// Bundles the Electron main process, preload and worker threads with esbuild.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
  outdir: 'dist/main',
  // The YouTube Music helper (Python) is embedded as text: a file inside app.asar cannot be run by Python.
  loader: { '.py': 'text' },
  logLevel: 'info',
};
const entries = {
  main: 'src/main/main.ts',
  preload: 'src/preload/preload.ts',
  workers: 'src/main/workers.ts',
};
const opts = { ...common, entryPoints: entries };
if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
}
