import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/events': {
        target: 'http://localhost:3001',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Accept-Encoding', 'identity')
          })
        },
      },
      '/proxy': 'http://localhost:3001',
      '/api':   'http://localhost:3001',
    },
  },
})
