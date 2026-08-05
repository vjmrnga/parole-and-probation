import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Lives at the project root (not inside renderer/) so plain `vite`/`vite
// build` — run from the project root by the npm scripts — finds it without
// extra flags. `root: 'renderer'` points Vite at the actual app source;
// base: './' is required since the production build is loaded over
// file:// by Electron, and Vite's default absolute asset paths
// ('/assets/...') don't resolve there.
export default defineConfig({
  root: path.resolve(__dirname, 'renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'renderer/dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
