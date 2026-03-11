<template>
  <div class="relative inline-flex shrink-0" :class="wrapperClass" :title="displayLabel">
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  userId: string
  displayName?: string
  avatarUrl?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  presence?: 'online' | 'away' | 'offline'
}>(), {
  displayName: '',
  avatarUrl: '',
  size: 'md',
  presence: undefined,
})

type AvatarSize = NonNullable<(typeof props)['size']>
type AvatarPresence = NonNullable<(typeof props)['presence']>

const errored = ref(false)

watch(() => props.avatarUrl, () => {
  errored.value = false
})

const displayLabel = computed(() => {
  const name = (props.displayName ?? '').trim()
  return name || 'Unknown user'
})

const showImage = computed(() => {
  const url = (props.avatarUrl ?? '').trim()
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
</script>
