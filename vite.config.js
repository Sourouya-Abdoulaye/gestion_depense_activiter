import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: true, // 0.0.0.0 : accessible depuis le réseau local (téléphone, autre PC)
    strictPort: false,
  },
  preview: {
    port: 4173,
    host: true, // idem pour `npm run preview`
    strictPort: false,
  },
});
