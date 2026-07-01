import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import surfaceMaterialsApi from './vite-plugins/surfaceMaterialsApi.js';

export default defineConfig({
  plugins: [react(), surfaceMaterialsApi()],
  server: {
    port: 6061,
    strictPort: false,  // allow port shifting if 6061 is in use
    host: true,         // listen on all interfaces -> reachable on the network
  },
  build: {
    // Split the rarely-changing heavy deps (three, react) into their own hashed
    // chunks so the browser keeps them in HTTP cache across app updates — only
    // the small app chunk re-downloads when our code changes.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
