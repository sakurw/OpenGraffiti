import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === '1' ? '/OpenGraffiti/' : '/',
  publicDir: process.env.GITHUB_PAGES === '1' ? false : 'public',
  server: { host: '127.0.0.1', port: Number(process.env.VITE_PORT || 5173), strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.PORT || 3100}`, '/images': `http://127.0.0.1:${process.env.PORT || 3100}` } },
  build: { rollupOptions: { output: { manualChunks: (id: string) => id.includes('/three/') ? 'three' : undefined } } }
});
