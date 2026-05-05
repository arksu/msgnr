<template>
  <div class="relative inline-flex shrink-0" :class="wrapperClass" :title="avatarTitle">
    <img
      v-if="showImage"
      :src="avatarUrl"
      :alt="displayLabel"
      class="h-full w-full rounded-full object-cover"
      @error="onImageError"
    >
    <div
      v-else
      class="flex h-full w-full items-center justify-center rounded-full text-white font-semibold select-none"
      :style="{ backgroundColor: fallbackColor }"
    >
      {{ initial }}
    </div>

    <span
      v-if="presence"
      class="absolute right-0 bottom-0 block rounded-full border-2 border-chat-header"
      :class="presenceClass"
    />
    <span
      v-if="activeCustomStatus"
      class="absolute -right-1 -top-1 inline-flex items-center justify-center rounded-full border border-chat-header bg-chat-panel text-white shadow-sm"
      :class="statusBadgeClass"
      :title="customStatusTitle"
      :aria-label="customStatusTitle"
    >
      {{ statusIndicator }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getActivePinia } from 'pinia'
import { resolveApiBaseUrl } from '@/services/runtime/backendEndpoint'
import { isTauriRuntime } from '@/platform/runtime'
import { useChatStore } from '@/stores/chat'
import {
  formatUserCustomStatusTitle,
  isUserCustomStatusActive,
  type UserCustomStatus,
} from '@/types/userStatus'

const props = withDefaults(defineProps<{
  userId: string
  displayName?: string
  avatarUrl?: string
  customStatus?: UserCustomStatus | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  presence?: 'online' | 'away' | 'offline'
}>(), {
  displayName: '',
  avatarUrl: '',
  customStatus: undefined,
  size: 'md',
  presence: undefined,
})

type AvatarSize = NonNullable<(typeof props)['size']>
type AvatarPresence = NonNullable<(typeof props)['presence']>

const errored = ref(false)
const nowMs = ref(Date.now())
let expiryTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.avatarUrl, () => {
  errored.value = false
})

const displayLabel = computed(() => {
  const name = (props.displayName ?? '').trim()
  return name || 'Unknown user'
})

const chatStore = computed(() => {
  if (import.meta.env.MODE === 'test') return null
  return getActivePinia() ? useChatStore() : null
})

const resolvedCustomStatus = computed(() => {
  if (props.customStatus !== undefined) return props.customStatus
  return chatStore.value?.resolveUserCustomStatus(props.userId) ?? null
})

const activeCustomStatus = computed(() => {
  const status = resolvedCustomStatus.value
  return isUserCustomStatusActive(status, nowMs.value) ? status : null
})

const customStatusTitle = computed(() => {
  const status = activeCustomStatus.value
  return status ? formatUserCustomStatusTitle(status) : ''
})

const avatarTitle = computed(() => {
  const status = customStatusTitle.value
  return status ? `${displayLabel.value}: ${status}` : displayLabel.value
})

const avatarUrl = computed(() => {
  const raw = (props.avatarUrl ?? '').trim()
  if (!raw) return ''
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw) || raw.startsWith('//')) return raw
  if (!isTauriRuntime()) return raw

  const base = resolveApiBaseUrl().trim()
  if (!base || base === '/') return raw

  try {
    return new URL(raw, `${base.replace(/\/+$/, '')}/`).toString()
  } catch {
    return raw
  }
})

const showImage = computed(() => {
  const url = avatarUrl.value
  return url.length > 0 && !errored.value
})

const initial = computed(() => {
  const source = displayLabel.value
  return source.charAt(0).toUpperCase() || '?'
})

const avatarSizeClasses: Record<AvatarSize, string> = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
  xl: 'h-14 w-14 text-xl',
}

const statusBadgeClasses: Record<AvatarSize, string> = {
  xs: 'h-3 min-w-3 px-0.5 text-[8px]',
  sm: 'h-4 min-w-4 px-0.5 text-[10px]',
  md: 'h-4 min-w-4 px-0.5 text-[10px]',
  lg: 'h-5 min-w-5 px-1 text-xs',
  xl: 'h-6 min-w-6 px-1 text-sm',
}

const presenceStateClasses: Record<AvatarPresence, string> = {
  online: 'h-2.5 w-2.5 bg-green-400',
  away: 'h-2.5 w-2.5 bg-amber-400',
  offline: 'h-2.5 w-2.5 bg-gray-500',
}

const wrapperClass = computed(() => avatarSizeClasses[props.size])

const presenceClass = computed(() => {
  if (!props.presence) return ''
  return presenceStateClasses[props.presence]
})

const statusBadgeClass = computed(() => statusBadgeClasses[props.size])

const statusIndicator = computed(() => activeCustomStatus.value?.emoji?.trim() || '!')

const palette = [
  '#E8912D', '#D9B51C', '#3AA3A0', '#EC4899',
  '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B',
]

const fallbackColor = computed(() => {
  const key = (props.userId || displayLabel.value).trim()
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0
  }
  return palette[Math.abs(hash) % palette.length]
})

function onImageError() {
  errored.value = true
}

function clearExpiryTimer() {
  if (!expiryTimer) return
  clearTimeout(expiryTimer)
  expiryTimer = null
}

function scheduleExpiryTimer() {
  clearExpiryTimer()
  const status = activeCustomStatus.value
  if (!status) return
  const expiresMs = Date.parse(status.expiresAt)
  if (!Number.isFinite(expiresMs)) return
  const delay = Math.max(0, Math.min(expiresMs - Date.now() + 250, 2_147_483_647))
  expiryTimer = setTimeout(() => {
    nowMs.value = Date.now()
    scheduleExpiryTimer()
  }, delay)
}

watch(() => activeCustomStatus.value?.expiresAt ?? '', scheduleExpiryTimer, { immediate: true })

onBeforeUnmount(clearExpiryTimer)
</script>
