import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSessionOrchestrator } from '@/composables/useSessionOrchestrator'
import { hasBackendBaseUrl, requiresConfiguredBackendUrl } from '@/services/runtime/backendEndpoint'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'main',
      component: () => import('@/views/MainView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tasks',
      name: 'tasks-list',
      component: () => import('@/views/MainView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tasks/:taskId',
      name: 'tasks-card',
      component: () => import('@/views/MainView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('@/views/AdminView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
  ],
})

router.beforeEach(async (to) => {
  if (requiresConfiguredBackendUrl() && !to.meta.public && !hasBackendBaseUrl()) {
    return { name: 'login' }
  }

  if (to.meta.public) return true

  const auth = useAuthStore()

  // Already authenticated in memory
  if (auth.authState !== 'AUTHENTICATED') {
    const isAuthenticated = () => auth.authState === 'AUTHENTICATED'
    // Try restoring from persisted refresh token
    if (auth.loadPersistedRefreshToken()) {
      const orchestrator = useSessionOrchestrator()
      const recovered = await orchestrator.tryRestoreSession()
      if (!recovered && !isAuthenticated()) {
        return { name: 'login' }
      }
    } else {
      return { name: 'login' }
    }
  }

  // Admin guard
  if (to.meta.requiresAdmin) {
    const role = auth.effectiveRole
    if (role !== 'admin' && role !== 'owner') {
      return { name: 'main' }
    }
  }

  return true
})

export default router
