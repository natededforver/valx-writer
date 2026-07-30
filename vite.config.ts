import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // Relative base so the built app works when loaded via file:// in Electron
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // `tauri android dev` serves this to a phone, which cannot reach the
      // host's loopback — the CLI picks the machine's LAN address, puts it in
      // devUrl, and hands it to us as TAURI_DEV_HOST. Binding to it is what
      // makes the device able to load the page at all; unset (every desktop
      // and browser run) this stays on Vite's localhost default.
      host: process.env.TAURI_DEV_HOST || false,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
