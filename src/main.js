import App from './App.vue'
import router from './router'
import { ViteSSG } from 'vite-ssg'

import { createPinia } from 'pinia'
import { useUserStore } from '@/stores/useUserStore'

import './assets/main.styl'

export const createApp = ViteSSG(
  App,
  router,
  async ({ app, router, isClient }) => {
    const pinia = createPinia()

    if (!isClient) {
      router.push('/')
    }
    app.use(router)
    app.use(pinia)

    if (isClient) {
      const userStore = useUserStore()
      await userStore.initializeUser()
    }
  }
)
