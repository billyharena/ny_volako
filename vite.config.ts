import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { assertPublicKeys } from './src/config/environment.ts'

export default defineConfig({
  plugins: [
    {
      name: 'public-environment-guard',
      config(_config, { mode }) {
        assertPublicKeys(loadEnv(mode, process.cwd(), 'VITE_'))
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest', srcDir: 'src/pwa', filename: 'sw.js', injectRegister: false,
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
      manifest: {
        id: '/', name: 'Ny Volako · Mon carnet de dépenses', short_name: 'Ny Volako',
        description: 'Vos dépenses et budgets, même hors ligne après une première connexion.',
        lang: 'fr', start_url: '/', scope: '/', display: 'standalone',
        theme_color: '#173f35', background_color: '#f6f7f3',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022' },
})
