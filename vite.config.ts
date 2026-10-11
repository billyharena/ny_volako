import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
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
  ],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022' },
})
