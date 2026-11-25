import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: '/home/hermes/contable-m-a-listo-para-liquidar/apps/web', plugins: [react()], server: { host: '127.0.0.1', port: 4398, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3398', changeOrigin: true } } } });
