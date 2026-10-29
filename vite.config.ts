import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
  /**
   * Solo afecta a `vite dev`; no entra en el build de producción.
   *
   * POR QUÉ: en localhost api-base.ts deja API_ORIGIN = '' , o sea que el front
   * llama a /api del propio host. Sin este proxy el servidor de desarrollo no
   * tiene backend y el panel de admin abre vacío (sin órdenes, sin productos, sin
   * financiaciones), que es justo lo que hay que mirar para ajustar el móvil.
   */
  server: {
    proxy: {
      '/api': {
        target: 'https://xiaomictg-backend-production-66f6.up.railway.app',
        changeOrigin: true,
        secure: true,
      },
      '/socket.io': {
        target: 'https://xiaomictg-backend-production-66f6.up.railway.app',
        changeOrigin: true,
        secure: true,
        ws: true,
      },
    },
  },
  build: {
    // Divide el bundle enorme en chunks cacheables separados
    rollupOptions: {
      output: {
        manualChunks: {
          'react-core': ['react', 'react-dom'],
          'router': ['react-router'],
          'radix-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-accordion',
            '@radix-ui/react-tooltip',
          ],
          'charts': ['recharts'],
          'dnd': ['react-dnd', 'react-dnd-html5-backend'],
        },
      },
    },
    // Compresión máxima
    minify: 'esbuild',
    // Advertencia a 700KB en vez de 500KB para evitar el warning
    chunkSizeWarningLimit: 700,
  },
})
