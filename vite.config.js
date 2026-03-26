import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const createSPAPlugin = () => {
  return {
    name: 'create-spa-app',
    apply: 'build',
    closeBundle () {
      const indexPath = path.resolve(__dirname, 'dist/index.html')
      const appPath = path.resolve(__dirname, 'dist/app.html')
      if (fs.existsSync(indexPath)) {
        fs.copyFileSync(indexPath, appPath)
      }
    }
  }
}

export default defineConfig(() => {
  return {
    ssgOptions: {
      entry: 'src/main.js',
      includedRoutes () {
        return ['/', '/about']
      }
    },
    test: {
      environment: 'jsdom'
    },
    optimizeDeps: {
      include: ['pinia']
    },
    ssr: {
      noExternal: ['macrolight']
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    plugins: [
      vue({ ssr: false }),
      createSPAPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        strategies: 'generateSW',
        manifest: {
          name: 'Kinopio Selfhost',
          short_name: 'Kinopio',
          start_url: '/app',
          display: 'standalone'
        },
        workbox: {
          navigateFallback: '/app.html',
          globPatterns: ['**/*.{js,css,html,svg,png,gif,woff2,ico,jpg,jpeg,webp}']
        }
      })
    ],
    preview: {
      host: '0.0.0.0'
    },
    server: {
      port: 8080,
      host: '0.0.0.0'
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        onwarn (warning, warn) {
          if (
            warning.message.includes('onUnmounted') ||
            warning.message.includes('/*#__PURE__*/')
          ) {
            return
          }
          warn(warning)
        }
      }
    }
  }
})
