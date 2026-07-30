import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        auth: resolve(__dirname, "auth.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        privacy: resolve(__dirname, "privacy.html")
      },
    },
  }

})
