import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/functions/v1/app': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
