import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  loadEnv(mode, '.', '');
  return {
    // Relative asset URLs, so the build works from a subpath or a static host
    // rather than only from the domain root.
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        // The portfolio document lives under ./data and is rewritten on every
        // save. Without this, Vite sees the write as a source change and does a
        // full page reload, throwing away whatever the user was looking at.
        ignored: ['**/data/**'],
      },
    },
  };
});
