import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import surfaceMaterialsApi from './vite-plugins/surfaceMaterialsApi.js';

export default defineConfig({
  // Be explicit here: without the automatic runtime, JSX is compiled to
  // React.createElement and every JSX module must import a `React` binding.
  // The application uses the modern runtime throughout its components.
  esbuild: {
    jsx: 'automatic',
  },
  plugins: [react({ jsxRuntime: 'automatic' }), surfaceMaterialsApi()],
  server: {
    port: 6061,
    strictPort: false,  // allow port shifting if 6061 is in use
    host: true,         // listen on all interfaces -> reachable on the network
    // Keep browser requests same-origin during local development. The auth
    // client uses /api/v1 in production too, so this also exercises the same
    // deployment shape locally instead of relying on a second CORS path.
    proxy: {
      '/api': {
        target: 'http://localhost:6062',
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:6062',
        changeOrigin: true,
      },
    },
  },
  test: {
    // The API owns its Node test runner. Keep Vitest focused on browser-side
    // terrain/editor modules instead of collecting api/tests/*.test.js.
    exclude: ['node_modules/**', 'dist/**', 'api/**'],
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
