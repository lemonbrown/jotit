import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/proxy': 'http://localhost:3001',
      '/api':   'http://localhost:3001',
      '/b':     'http://localhost:3001',
      '/n/':    'http://localhost:3001',
    },
  },
})
