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
