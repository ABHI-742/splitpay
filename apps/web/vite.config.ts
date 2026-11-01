import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In Docker Compose the API is reachable as http://api:4000.
const target = process.env.API_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target, rewrite: (path) => path.replace(/^\/api/, '') },
      '/socket.io': { target, ws: true },
    },
  },
});
