<template>
  <div class="flex h-screen overflow-hidden">
    <aside class="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-white/10 bg-sidebar-bg py-3">
      <div class="group relative">
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
          :class="appMode === 'chat' ? 'bg-sidebar-active text-white' : 'text-sidebar-textMuted hover:bg-sidebar-hover hover:text-sidebar-text'"
          title="Chat"
          aria-label="Chat"
          data-testid="mode-chat"
          @click="goToChatMode"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          </svg>
        </button>
        <span class="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 rounded border border-chat-border bg-chat-header px-2 py-1 text-xs text-gray-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          Chat
        </span>
      </div>
      <div class="group relative">
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
          :class="appMode === 'task-tracker' ? 'bg-sidebar-active text-white' : 'text-sidebar-textMuted hover:bg-sidebar-hover hover:text-sidebar-text'"
          title="Task tracker"
          aria-label="Task tracker"
          data-testid="mode-task-tracker"
          @click="goToTaskTrackerMode"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11 11 13 15 9" />
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        </button>
        <span class="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-chat-border bg-chat-header px-2 py-1 text-xs text-gray-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          Task tracker
        </span>
      </div>
    </aside>
    <AppSidebar v-if="appMode === 'chat'" @profile="openSettings" @settings="openAudioSettings" />
    <main class="flex-1 min-w-0">
      <div
        v-if="showServerUnavailableAlert"
        class="mx-4 mt-4 flex items-center gap-3 rounded-md border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
        role="alert"
      >
        <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" class="opacity-30" stroke="currentColor" stroke-width="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
        <span class="flex-1">Server is unavailable</span>
        <button
          type="button"
          data-testid="server-unavailable-logout"
          class="rounded border border-amber-200/60 px-2 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-200/20"
          @click="handleLogout"
        >
          Logout
        </button>
      </div>
      <ChatArea v-if="appMode === 'chat'" />
      <template v-else>
        <div class="flex h-full overflow-hidden bg-chat-bg" data-testid="task-tracker">
          <TaskTrackerSidebar
            :model-value="selectedTemplateFilter"
            @update:modelValue="onTaskTrackerFilterChange"
          />
          <main class="flex-1 min-w-0 overflow-hidden">
            <TaskListView
              v-if="!isTaskCardRoute"
              :template-filter="selectedTemplateFilter"
              @open-task="openTask"
            />
            <TaskCard
              v-else
              :template-filter="selectedTemplateFilter"
              @back="backToList"
            />
          </main>
        </div>
        <TaskCreateDialog />
      </template>
    </main>
    <div
      v-if="chatStore.toast"
      class="pointer-events-none fixed right-4 bottom-4 z-50 rounded-md border border-red-300/40 bg-red-500/90 px-3 py-2 text-sm text-white shadow-lg"
      role="status"
      aria-live="polite"
    >
      {{ chatStore.toast.message }}
    </div>

    <Teleport to="body">
      <div
        v-if="settingsOpen"
        class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
        @click.self="closeSettings"
      >
        <div class="w-full max-w-md rounded-xl border border-chat-border bg-chat-header px-6 py-5 shadow-2xl">
          <h2 class="text-lg font-semibold text-white mb-4">Profile</h2>

          <div class="space-y-3">
            <div class="rounded border border-chat-border bg-chat-input/60 p-3">
              <div class="flex items-center gap-3">
                <UserAvatar
                  :user-id="authStore.user?.id ?? chatStore.workspace?.selfUserId ?? ''"
                  :display-name="settingsDisplayName || settingsEmail || 'User'"
                  :avatar-url="authStore.user?.avatarUrl ?? chatStore.workspace?.selfAvatarUrl ?? ''"
                  size="xl"
                />
                <div class="flex flex-col gap-2">
                  <input
                    ref="profileAvatarInput"
                    type="file"
                    class="hidden"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    @change="onProfileAvatarSelected"
                  >
                  <button
                    type="button"
                    class="rounded border border-chat-border px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50"
                    :disabled="settingsAvatarLoading"
                    @click="openProfileAvatarPicker"
                  >
                    {{ settingsAvatarLoading ? 'Uploading...' : 'Upload avatar' }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-chat-border px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50"
                    :disabled="settingsAvatarLoading || !(authStore.user?.avatarUrl ?? '').trim()"
                    @click="removeProfileAvatar"
                  >
                    Remove avatar
                  </button>
                </div>
              </div>
              <p class="mt-2 text-[11px] text-gray-500">Max 5 MB. JPG, PNG, WEBP, GIF.</p>
            </div>

            <div>
              <label class="block text-sm text-gray-400 mb-1">Display name</label>
              <input
                v-model="settingsDisplayName"
                type="text"
                class="w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent"
                placeholder="Display name"
              />
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Email</label>
              <input
                v-model="settingsEmail"
                type="email"
                class="w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent"
                placeholder="you@example.com"
              />
            </div>
          </div>

          <div v-if="settingsError" class="text-red-400 text-sm mt-3">
            {{ settingsError }}
          </div>
          <div v-if="settingsAvatarError" class="text-red-400 text-sm mt-3">
            {{ settingsAvatarError }}
          </div>
          <div v-if="settingsSuccess" class="text-emerald-300 text-sm mt-3">
            {{ settingsSuccess }}
          </div>

          <div class="flex gap-3 mt-5">
            <button
              class="flex-1 py-2 rounded bg-white/10 hover:bg-white/20 text-gray-200 text-sm transition-colors"
              :disabled="settingsLoading"
              @click="closeSettings"
            >
              Cancel
            </button>
            <button
              class="flex-1 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canSaveSettings || settingsLoading"
              @click="saveSettings"
            >
              {{ settingsLoading ? 'Saving...' : 'Save' }}
            </button>
          </div>

          <!-- Change password section -->
          <div class="border-t border-chat-border mt-6 pt-5">
            <h3 class="text-sm font-semibold text-white mb-3">Change password</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-sm text-gray-400 mb-1">New password</label>
                <input
                  v-model="settingsNewPassword"
                  type="password"
                  autocomplete="new-password"
                  class="w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent"
                  placeholder="••••••••"
                  @keyup.enter="savePassword"
                />
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Confirm new password</label>
                <input
                  v-model="settingsConfirmPassword"
                  type="password"
                  autocomplete="new-password"
                  class="w-full bg-chat-input border border-chat-border rounded px-3 py-2 text-white text-sm outline-none focus:border-accent"
                  placeholder="••••••••"
                  @keyup.enter="savePassword"
                />
              </div>
            </div>
            <div v-if="settingsPasswordError" class="text-red-400 text-sm mt-3">
              {{ settingsPasswordError }}
            </div>
            <div v-if="settingsPasswordSuccess" class="text-emerald-300 text-sm mt-3">
              {{ settingsPasswordSuccess }}
            </div>
            <div class="flex justify-end mt-4">
              <button
                class="px-4 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="settingsPasswordLoading || (!settingsNewPassword && !settingsConfirmPassword)"
                @click="savePassword"
              >
                {{ settingsPasswordLoading ? 'Changing...' : 'Change password' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <SettingsDialog :open="audioSettingsOpen" @close="audioSettingsOpen = false" />

    <div
      v-if="incomingInvite"
      class="fixed top-5 left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 rounded-xl border border-chat-border bg-chat-header/95 p-4 text-white shadow-2xl backdrop-blur"
      role="dialog"
      aria-live="polite"
    >
      <div class="text-sm font-semibold">Incoming call</div>
      <div class="mt-1 text-sm text-gray-200">
        {{ incomingInviteCaller }} is calling in {{ incomingInviteConversationTitle }}.
      </div>
      <div v-if="incomingInviteError" class="mt-2 rounded border border-red-400/40 bg-red-500/10 px-2 py-1 text-xs text-red-200">
        {{ incomingInviteError }}
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <button
          type="button"
          class="rounded border border-chat-border px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50"
          :disabled="handlingIncomingInvite"
          @click="rejectIncomingInvite"
        >
          Reject
        </button>
        <button
          type="button"
          class="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
          :disabled="handlingIncomingInvite"
          @click="acceptIncomingInvite"
        >
          {{ handlingIncomingInvite ? 'Joining...' : 'Accept' }}
        </button>
      </div>
    </div>
    <CallDock />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PresenceStatus } from '@/shared/proto/packets_pb'
import { useWsStore } from '@/stores/ws'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { useSessionOrchestrator } from '@/composables/useSessionOrchestrator'
import { useOfflineQueue } from '@/composables/useOfflineQueue'
import { usePushNotifications, pushSupported } from '@/composables/usePushNotifications'
import { loadPushEndpoint } from '@/services/storage/pushStorage'
import { loadManualPresencePreference } from '@/services/storage/manualPresenceStorage'
import { useNotificationSoundEngine } from '@/services/sound'
import {
  loadLastOpenedTaskId,
  saveLastOpenedTaskId,
  clearLastOpenedTaskId,
} from '@/services/storage/lastTaskRouteStorage'
import AppSidebar from '@/components/AppSidebar.vue'
import ChatArea from '@/components/ChatArea.vue'
import CallDock from '@/components/CallDock.vue'
import TaskTrackerSidebar from '@/components/tasks/TaskTrackerSidebar.vue'
import TaskCard from '@/components/tasks/TaskCard.vue'
import TaskListView from '@/components/tasks/TaskListView.vue'
import TaskCreateDialog from '@/components/tasks/TaskCreateDialog.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useTasksStore } from '@/stores/tasks'
const SettingsDialog = defineAsyncComponent(() => import('@/components/SettingsDialog.vue'))
import { useCallStore } from '@/stores/call'

const route = useRoute()
const router = useRouter()
const settingsOpen = ref(false)
const audioSettingsOpen = ref(false)
const settingsLoading = ref(false)
const settingsError = ref('')
const settingsSuccess = ref('')
const settingsDisplayName = ref('')
const settingsEmail = ref('')
const settingsInitialDisplayName = ref('')
const settingsInitialEmail = ref('')
const settingsNewPassword = ref('')
const settingsConfirmPassword = ref('')
const settingsPasswordLoading = ref(false)
const settingsPasswordError = ref('')
const settingsPasswordSuccess = ref('')
const settingsAvatarLoading = ref(false)
const settingsAvatarError = ref('')
const profileAvatarInput = ref<HTMLInputElement | null>(null)
const wsStore = useWsStore()
const chatStore = useChatStore()
const callStore = useCallStore()
const authStore = useAuthStore()
const { logout } = useSessionOrchestrator()
const offlineQueue = useOfflineQueue()
// TODO(phase-5-platform-adapter): route app notification sounds via usePlatform().
const soundEngine = useNotificationSoundEngine()
const { checkExistingSubscription: checkPushSubscription, subscribe: subscribePush } = usePushNotifications()
const showServerUnavailableAlert = computed(() => authStore.lastAuthError === 'Server is unavailable')
const handlingIncomingInvite = ref(false)
const incomingInviteError = ref('')
const dismissedInviteIds = ref<string[]>([])
const selectedTemplateFilter = ref<string | null>(null)
let unsubscribeIncomingMessageSound: (() => void) | null = null
const tasksStore = useTasksStore()
const isTaskTrackerRoute = computed(() => route.name === 'tasks-list' || route.name === 'tasks-card')
const isTaskCardRoute = computed(() => route.name === 'tasks-card')
const appMode = computed<'chat' | 'task-tracker'>(() => (isTaskTrackerRoute.value ? 'task-tracker' : 'chat'))
const routeTaskId = computed(() =>
  typeof route.params.taskId === 'string' ? route.params.taskId : '',
)

async function goToChatMode() {
  if (route.name === 'main') return
  await router.push({ name: 'main' })
}

async function goToTaskTrackerMode() {
  const rememberedTaskId = loadLastOpenedTaskId()
  if (rememberedTaskId) {
    await router.push({ name: 'tasks-card', params: { taskId: rememberedTaskId } })
    return
  }
  await router.push({ name: 'tasks-list' })
}

async function openTask(id: string) {
  saveLastOpenedTaskId(id)
  await router.push({ name: 'tasks-card', params: { taskId: id } })
}

async function backToList() {
  tasksStore.clearSelectedTask()
  // Refresh the list so any edits made in the card are reflected
  await tasksStore.loadTaskList()
  await router.push({ name: 'tasks-list' })
}

function onTaskTrackerFilterChange(value: string | null) {
  selectedTemplateFilter.value = value
  if (route.name === 'tasks-card') {
    tasksStore.clearSelectedTask()
    void router.push({ name: 'tasks-list' })
  }
}

watch(
  () => ({ name: route.name, taskId: routeTaskId.value }),
  async ({ name, taskId }) => {
    if (name === 'tasks-card') {
      if (!taskId) {
        await router.replace({ name: 'tasks-list' })
        return
      }
      if (tasksStore.selectedTask?.id === taskId) {
        saveLastOpenedTaskId(taskId)
        return
      }
      tasksStore.clearSelectedTask()
      await tasksStore.selectTask(taskId, true)
      if (tasksStore.selectedTask?.id === taskId) {
        saveLastOpenedTaskId(taskId)
      } else {
        clearLastOpenedTaskId()
        await router.replace({ name: 'tasks-list' })
      }
      return
    }

    if (name === 'tasks-list') {
      tasksStore.clearSelectedTask()
      return
    }

    if (name === 'main') {
      tasksStore.clearSelectedTask()
    }
  },
  { immediate: true },
)

// Keep URL in sync when selected task changes from inside the card (subtasks, create dialog).
watch(() => tasksStore.selectedTask?.id, (taskId) => {
  if (!taskId || !isTaskTrackerRoute.value) return
  // While browsing the list, avoid re-opening a card due stale task selections.
  // The list should auto-open a card only for freshly created tasks.
  if (route.name !== 'tasks-card' && !(route.name === 'tasks-list' && tasksStore.createDialogOpen)) {
    return
  }
  saveLastOpenedTaskId(taskId)
  if (route.name === 'tasks-card' && routeTaskId.value === taskId) return
  void router.push({ name: 'tasks-card', params: { taskId } })
})

watch(
  () => route.name,
  (name) => {
    if (name === 'tasks-list' || name === 'tasks-card') return
    selectedTemplateFilter.value = null
  }
)

const incomingInvite = computed(() => {
  const pending = chatStore.pendingInvites
    .filter(item => !dismissedInviteIds.value.includes(item.id))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return pending[0] ?? null
})

const incomingInviteConversation = computed(() => {
  const invite = incomingInvite.value
  if (!invite) return null
  const channel = chatStore.channels.find(item => item.id === invite.conversationId)
  if (channel) {
    return {
      kind: 'channel' as const,
      visibility: channel.visibility,
      title: `#${channel.name}`,
    }
  }
  const dm = chatStore.directMessages.find(item => item.id === invite.conversationId)
  if (dm) {
    return {
      kind: 'dm' as const,
      visibility: 'dm' as const,
      title: `@${dm.displayName}`,
    }
  }
  return {
    kind: 'channel' as const,
    visibility: 'public' as const,
    title: 'this conversation',
  }
})

const incomingInviteCaller = computed(() => {
  const invite = incomingInvite.value
  if (!invite) return 'Someone'
  return chatStore.resolveDisplayName(invite.inviterUserId)
})

const incomingInviteConversationTitle = computed(() => incomingInviteConversation.value?.title ?? 'this conversation')

watch(incomingInvite, (invite) => {
  if (invite) {
    void soundEngine.startCallInviteRing()
    return
  }
  soundEngine.stopCallInviteRing()
}, { immediate: true })

const canSaveSettings = computed(() => {
  const displayName = settingsDisplayName.value.trim()
  const email = settingsEmail.value.trim()
  const hasChanged = displayName !== settingsInitialDisplayName.value
    || email !== settingsInitialEmail.value
  const hasValue = !!displayName || !!email
  return hasChanged && hasValue
})

async function handleLogout() {
  soundEngine.stopCallInviteRing()
  offlineQueue.clear()
  await logout()
  await router.push({ name: 'login' })
}

function handleClientFocus() {
  chatStore.setClientActive(true)
  chatStore.onClientFocus()
  reportClientWindowActivity(true)
}

function handleClientBlur() {
  chatStore.setClientActive(false)
  reportClientWindowActivity(false)
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    chatStore.setClientActive(false)
    reportClientWindowActivity(false)
    return
  }
  handleClientFocus()
}

function isWsActivitySignalReady(): boolean {
  return wsStore.state === 'AUTH_COMPLETE'
    || wsStore.state === 'BOOTSTRAPPING'
    || wsStore.state === 'LIVE_SYNCED'
    || wsStore.state === 'RECOVERING_GAP'
    || wsStore.state === 'STALE_REBOOTSTRAP'
}

function isChatWindowActive(): boolean {
  return document.visibilityState !== 'hidden' && document.hasFocus()
}

function reportClientWindowActivity(active: boolean) {
  if (!isWsActivitySignalReady()) return
  wsStore.sendSetClientWindowActivity(active)
}

function applyManualPresencePreference() {
  const preferred = loadManualPresencePreference()
  if (!preferred) return
  wsStore.sendSetPresence(preferred === 'away' ? PresenceStatus.AWAY : PresenceStatus.ONLINE)
}

function dismissInvite(inviteId: string) {
  dismissedInviteIds.value = Array.from(new Set([...dismissedInviteIds.value, inviteId]))
}

function closeSettings() {
  settingsOpen.value = false
  settingsError.value = ''
  settingsAvatarError.value = ''
  settingsNewPassword.value = ''
  settingsConfirmPassword.value = ''
  settingsPasswordError.value = ''
  settingsPasswordSuccess.value = ''
}

function syncSettingsFormFromUser() {
  const displayName = authStore.user?.displayName?.trim()
    || chatStore.workspace?.selfDisplayName?.trim()
  settingsDisplayName.value = displayName || authStore.user?.email?.trim() || ''
  settingsEmail.value = authStore.user?.email?.trim() || ''
  settingsInitialDisplayName.value = settingsDisplayName.value.trim()
  settingsInitialEmail.value = settingsEmail.value.trim()
}

async function openSettings() {
  settingsError.value = ''
  settingsAvatarError.value = ''
  settingsSuccess.value = ''
  settingsNewPassword.value = ''
  settingsConfirmPassword.value = ''
  settingsPasswordError.value = ''
  settingsPasswordSuccess.value = ''
  try {
    await authStore.ensureUserLoaded()
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : 'Failed to load profile'
  }
  syncSettingsFormFromUser()
  settingsOpen.value = true
}

function openAudioSettings() {
  audioSettingsOpen.value = true
}

async function saveSettings() {
  if (!canSaveSettings.value || settingsLoading.value) return
  settingsLoading.value = true
  settingsError.value = ''
  settingsSuccess.value = ''
  try {
    const updated = await authStore.updateProfile({
      display_name: settingsDisplayName.value,
      email: settingsEmail.value,
    })
    settingsSuccess.value = 'Profile updated'
    chatStore.registerUserIdentity(updated.id, updated.displayName, updated.email, updated.avatarUrl)
    settingsOpen.value = false
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : 'Failed to save settings'
  } finally {
    settingsLoading.value = false
  }
}

function openProfileAvatarPicker() {
  profileAvatarInput.value?.click()
}

async function onProfileAvatarSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  settingsAvatarLoading.value = true
  settingsAvatarError.value = ''
  settingsSuccess.value = ''
  try {
    const updated = await authStore.uploadAvatar(file)
    chatStore.registerUserIdentity(updated.id, updated.displayName, updated.email, updated.avatarUrl)
    settingsSuccess.value = 'Avatar updated'
  } catch (error) {
    settingsAvatarError.value = error instanceof Error ? error.message : 'Failed to upload avatar'
  } finally {
    settingsAvatarLoading.value = false
  }
}

async function removeProfileAvatar() {
  settingsAvatarLoading.value = true
  settingsAvatarError.value = ''
  settingsSuccess.value = ''
  try {
    const updated = await authStore.removeAvatar()
    chatStore.registerUserIdentity(updated.id, updated.displayName, updated.email, updated.avatarUrl)
    settingsSuccess.value = 'Avatar removed'
  } catch (error) {
    settingsAvatarError.value = error instanceof Error ? error.message : 'Failed to remove avatar'
  } finally {
    settingsAvatarLoading.value = false
  }
}

async function savePassword() {
  settingsPasswordError.value = ''
  settingsPasswordSuccess.value = ''
  if (!settingsNewPassword.value) {
    settingsPasswordError.value = 'Please enter a new password.'
    return
  }
  if (settingsNewPassword.value !== settingsConfirmPassword.value) {
    settingsPasswordError.value = 'Passwords do not match.'
    return
  }
  settingsPasswordLoading.value = true
  try {
    await authStore.changePassword(settingsNewPassword.value)
    settingsPasswordSuccess.value = 'Password changed successfully.'
    settingsNewPassword.value = ''
    settingsConfirmPassword.value = ''
  } catch (error) {
    settingsPasswordError.value = error instanceof Error ? error.message : 'Failed to change password.'
  } finally {
    settingsPasswordLoading.value = false
  }
}

async function acceptIncomingInvite() {
  const invite = incomingInvite.value
  const conversation = incomingInviteConversation.value
  if (!invite || !conversation) return
  handlingIncomingInvite.value = true
  incomingInviteError.value = ''
  wsStore.sendAcceptCallInvite(invite.id)
  dismissInvite(invite.id)
  try {
    await callStore.startOrJoinCall({
      conversationId: invite.conversationId,
      kind: conversation.kind,
      visibility: conversation.visibility,
      joinExistingOnly: true,
    })
  } catch (err) {
    incomingInviteError.value = err instanceof Error ? err.message : 'Failed to join call'
    dismissedInviteIds.value = dismissedInviteIds.value.filter(item => item !== invite.id)
  } finally {
    handlingIncomingInvite.value = false
  }
}

function rejectIncomingInvite() {
  const invite = incomingInvite.value
  if (!invite) return
  incomingInviteError.value = ''
  wsStore.sendRejectCallInvite(invite.id)
  dismissInvite(invite.id)
}

// Register WS→chat handlers once
chatStore.registerWsHandlers()
callStore.registerWsHandlers()

watch(() => chatStore.activeCalls, () => {
  callStore.syncWithActiveCalls()
}, { deep: true })

watch(() => chatStore.pendingInvites.map(item => item.id), (ids) => {
  dismissedInviteIds.value = dismissedInviteIds.value.filter(id => ids.includes(id))
  if (!ids.length) {
    incomingInviteError.value = ''
    handlingIncomingInvite.value = false
  }
})

// Register self in the user name cache
watch(() => authStore.user, (u) => {
  if (u) chatStore.registerUserIdentity(u.id, u.displayName, u.email, u.avatarUrl)
  if (settingsOpen.value && u) {
    syncSettingsFormFromUser()
  }
}, { immediate: true })

watch(settingsOpen, (isOpen) => {
  if (isOpen) {
    syncSettingsFormFromUser()
  }
}, { immediate: true })

// Load channels once WS auth is complete (real data) and also on mount if
// already authenticated (page refresh scenario)
watch(() => wsStore.state, async (state) => {
  if (state === 'AUTH_COMPLETE') {
    reportClientWindowActivity(isChatWindowActive())
    chatStore.startRealtimeFlow()
    applyManualPresencePreference()
    // Flush any messages that were composed while disconnected.
    // Notify the chat store of status transitions (queued → sending / failed)
    // and start send timeouts for each flushed message.
    // Re-validate push subscription if user had push enabled before.
    if (pushSupported && loadPushEndpoint()) {
      checkPushSubscription().then(() => {
        // If the browser subscription was invalidated (SW update, etc.),
        // re-subscribe transparently — permission was already granted.
        if (!loadPushEndpoint()) {
          subscribePush().catch(() => {})
        }
      })
    }
    offlineQueue.flush(wsStore, (conversationId, clientMsgId, status, threadRootMessageId, failReason) => {
      if (threadRootMessageId) {
        chatStore.updateThreadSendStatus(threadRootMessageId, clientMsgId, status, failReason)
        if (status === 'sending') {
          chatStore.startSendTimeout(conversationId, clientMsgId, true, threadRootMessageId)
        }
      } else {
        chatStore.updateSendStatus(conversationId, clientMsgId, status, failReason)
        if (status === 'sending') {
          chatStore.startSendTimeout(conversationId, clientMsgId, false)
        }
      }
    })
  }
})

function handleGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'd') {
    if (!callStore.activeCallId) return
    event.preventDefault()
    callStore.toggleMute().catch(() => {})
  }
}

onMounted(async () => {
  unsubscribeIncomingMessageSound = chatStore.onIncomingMessageNotification(() => {
    void soundEngine.playMessagePing()
  })

  window.addEventListener('focus', handleClientFocus)
  window.addEventListener('blur', handleClientBlur)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  document.addEventListener('keydown', handleGlobalKeydown)
  const active = isChatWindowActive()
  chatStore.setClientActive(active)
  if (active) {
    chatStore.onClientFocus()
  }

  // Only kick off the realtime flow if already at AUTH_COMPLETE on mount
  // (e.g. page refresh with fast session restore). The watch() above handles
  // the AUTH_COMPLETE transition for connections that complete after mount.
  // Do NOT use authStore.accessToken here — having a token does not mean the
  // WS is authenticated; calling startRealtimeFlow() before AUTH_COMPLETE is a no-op
  // and would cause a double-call when the watch fires moments later.
  if (wsStore.state === 'AUTH_COMPLETE') {
    reportClientWindowActivity(active)
    chatStore.startRealtimeFlow()
  }
})

onUnmounted(() => {
  unsubscribeIncomingMessageSound?.()
  unsubscribeIncomingMessageSound = null
  // Keep singleton engine alive across remounts; only stop active playback.
  soundEngine.stopCallInviteRing()

  window.removeEventListener('focus', handleClientFocus)
  window.removeEventListener('blur', handleClientBlur)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  document.removeEventListener('keydown', handleGlobalKeydown)
})
</script>
