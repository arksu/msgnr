<template>
  <router-view />

  <PwaUpdateBanner v-if="showPwaBanner" />

  <Teleport to="body">
    <div
      v-if="showStartupLoader"
      class="fixed inset-0 z-[9998] flex items-center justify-center bg-sidebar-bg/95 p-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="flex flex-col items-center gap-3 rounded-xl border border-chat-border bg-chat-header/95 px-6 py-5 text-center shadow-2xl backdrop-blur">
        <svg class="h-7 w-7 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" class="opacity-30" stroke="currentColor" stroke-width="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
        <div class="text-sm font-semibold text-white">{{ startupLoaderMessage }}</div>
        <div class="text-xs text-gray-400">Slow connection detected. Please wait.</div>
      </div>
    </div>
  </Teleport>

  <!-- Mandatory password change dialog — shown on any route after login -->
  <Teleport to="body">
    <div
      v-if="authStore.needChangePassword"
      class="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4"
    >
      <div class="bg-[#222529] border border-chat-border rounded-xl shadow-2xl w-full max-w-sm p-6">
        <h3 class="text-lg font-bold text-white mb-1">Change your password</h3>
        <p class="text-sm text-gray-400 mb-4">
          You must set a new password before continuing.
        </p>
        <div class="space-y-3">
          <div>
            <label class="block text-sm text-gray-400 mb-1">New password</label>
            <input
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              class="w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent"
              placeholder="••••••••"
              @keyup.enter="submitChangePassword"
            />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Confirm password</label>
            <input
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              class="w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent"
              placeholder="••••••••"
              @keyup.enter="submitChangePassword"
            />
          </div>
        </div>
        <div v-if="changeError" class="text-red-400 text-sm mt-3">{{ changeError }}</div>
        <div class="mt-5">
          <button
            class="w-full py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-50"
            :disabled="changeLoading"
            @click="submitChangePassword"
          >
            {{ changeLoading ? 'Saving...' : 'Set new password' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { AuthApiError } from '@/services/http/authApi'
import { useSessionOrchestrator } from '@/composables/useSessionOrchestrator'
import PwaUpdateBanner from '@/components/PwaUpdateBanner.vue'
import { isTauriRuntime } from '@/platform/runtime'

const router = useRouter()
const authStore = useAuthStore()
const { isStartupLoading, startupMessage } = useSessionOrchestrator()
const routerReady = ref(false)
const showPwaBanner = !isTauriRuntime()

onMounted(() => {
  router.isReady().finally(() => {
    routerReady.value = true
  })
})

const showStartupLoader = computed(() => !routerReady.value || isStartupLoading.value)
const startupLoaderMessage = computed(() => {
  if (!routerReady.value) return 'Loading application...'
  return startupMessage.value || 'Loading...'
})

const newPassword = ref('')
const confirmPassword = ref('')
const changeLoading = ref(false)
const changeError = ref<string | null>(null)

async function submitChangePassword() {
  changeError.value = null

  if (!newPassword.value) {
    changeError.value = 'Please enter a new password.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    changeError.value = 'Passwords do not match.'
    return
  }

  changeLoading.value = true
  try {
    await authStore.changePassword(newPassword.value)
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e) {
    changeError.value = e instanceof AuthApiError ? e.message : 'Failed to change password.'
  } finally {
    changeLoading.value = false
  }
}
</script>
