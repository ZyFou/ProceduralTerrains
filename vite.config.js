import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 6061,
    strictPort: true,   // fail loudly instead of silently moving to another port
    host: true,         // listen on all interfaces -> reachable on the network
  },
});
