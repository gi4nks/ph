import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  bundle: true,
  minify: false,
  sourcemap: true,
  external: ['@lydell/node-pty', 'better-sqlite3'],
});
