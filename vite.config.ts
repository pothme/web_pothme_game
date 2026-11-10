import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
});
