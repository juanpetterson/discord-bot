import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['cjs', 'esm'],
  target: 'es2020',
  loader: {
    '.mpeg': 'file',
    '.json': 'json',
  },
});