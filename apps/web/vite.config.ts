import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // The public, read-only viewer for iframes: no React, no editor
        embed: resolve(__dirname, 'embed.html'),
      },
    },
  },
});
