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
        <span
          v-if="showChatModeUnreadBadge"
          data-testid="mode-chat-unread-badge"
          class="pointer-events-none absolute -top-1 -right-1 z-10 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold leading-[18px] text-white"
        >
          {{ chatModeUnreadBadgeLabel }}
        </span>
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
      <div class="group relative">
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
          :class="appMode === 'documents' ? 'bg-sidebar-active text-white' : 'text-sidebar-textMuted hover:bg-sidebar-hover hover:text-sidebar-text'"
          title="Documents"
          aria-label="Documents"
          data-testid="mode-documents"
          @click="goToDocumentsMode"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
            <path d="M14 3v6h6" />
          </svg>
        </button>
        <span class="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-chat-border bg-chat-header px-2 py-1 text-xs text-gray-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          Documents
        </span>
      </div>
    </aside>
    <ResizableSidebar
      v-if="appMode === 'chat'"
      storage-key="msgnr:sidebar-width:chat:v1"
      :default-width="240"
      :min-width="220"
      :max-width="420"
    >
      <AppSidebar @profile="openSettings" @settings="openAudioSettings" />
    </ResizableSidebar>
    <main class="flex-1 min-w-0 min-h-0">
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
      <template v-else-if="appMode === 'task-tracker'">
        <TaskTrackerShell
          v-model="selectedTemplateFilter"
          :current-view="taskTrackerBaseRouteName"
          :view-mode="taskTrackerViewMode"
          @open-list="openTaskListRoute"
          @open-kanban="openTaskKanbanRoute"
          @open-task="openTask"
          @back="backToList"
        />
      </template>
      <template v-else>
        <DocumentsShell
          :selected-teamspace-id="documentsSelectedTeamspaceId"
          :selected-document-id="routeDocumentId || documentsStore.selectedDocument?.id || null"
          :view-mode="documentsViewMode"
          @open-teamspaces="openDocumentsTeamspacesRoute"
          @open-teamspace="openDocumentsTeamspaceRoute"
          @open-document="openDocument"
          @documents-deleted="handleDocumentsDeleted"
          @back="backToDocuments"
          @open-parent="openDocument"
        />
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
import { computed, ref, watch, onMounted, onUnmounted, defineAsyncComponent, defineComponent, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PresenceStatus } from '@/shared/proto/packets_pb'
import { useWsStore } from '@/stores/ws'
import { useChatStore, type IncomingMessageNotification } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { useSessionOrchestrator } from '@/composables/useSessionOrchestrator'
import { useOfflineQueue } from '@/composables/useOfflineQueue'
import { usePushNotifications, pushSupported } from '@/composables/usePushNotifications'
import { loadPushEndpoint } from '@/services/storage/pushStorage'
import { loadManualPresencePreference } from '@/services/storage/manualPresenceStorage'
import { useNotificationSoundEngine } from '@/services/sound'
import { getPlatformOrNull } from '@/platform'
import { isTauriRuntime } from '@/platform/runtime'
import {
  loadLastOpenedTaskPublicId,
  saveLastOpenedTaskPublicId,
  clearLastOpenedTaskPublicId,
} from '@/services/storage/lastTaskRouteStorage'
import {
  isUuidTaskRouteValue,
  taskPublicIdFromSlug,
  taskSlugFromPublicId,
} from '@/services/taskRoute'
import {
  notificationOpenIntentFromMessage,
  notificationOpenIntentFromQuery,
  stripNotificationOpenQuery,
  type NotificationOpenIntent,
} from '@/services/notificationOpen'
import ResizableSidebar from '@/components/ResizableSidebar.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import ChatArea from '@/components/ChatArea.vue'
import CallDock from '@/components/CallDock.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useTasksStore } from '@/stores/tasks'
import { useDocumentsStore } from '@/stores/documents'
const SettingsDialog = defineAsyncComponent(() => import('@/components/SettingsDialog.vue'))
function createTaskTrackerShellStub() {
  return defineComponent({
    name: 'TaskTrackerShellStub',
    props: {
      modelValue: {
        type: String,
        default: null,
      },
      currentView: {
        type: String,
        required: true,
      },
      viewMode: {
        type: String,
        required: true,
      },
    },
    emits: ['update:modelValue', 'openList', 'openKanban', 'openTask', 'back'],
    setup(props, { emit }) {
      return () => h('div', { 'data-testid': 'task-tracker' }, [
        h('aside', { 'data-testid': 'task-tracker-sidebar' }),
        props.viewMode === 'card'
          ? h('section', { 'data-testid': 'task-card' }, [
              h('button', {
                'data-testid': 'task-card-back',
                type: 'button',
                onClick: () => emit('back'),
              }, 'back'),
            ])
          : props.viewMode === 'kanban'
            ? h('section', { 'data-testid': 'task-kanban-view' }, [
                h('button', {
                  'data-testid': 'task-kanban-open',
                  type: 'button',
                  onClick: () => emit('openTask', 'TASK-K'),
                }, 'open'),
              ])
            : h('section', { 'data-testid': 'task-list-view' }, [
                h('button', {
                  'data-testid': 'task-list-open',
                  type: 'button',
                  onClick: () => emit('openTask', 'TASK-1'),
                }, 'open'),
              ]),
        h('div', { 'data-testid': 'task-create-dialog' }),
      ])
    },
  })
}

function createDocumentsShellStub() {
  return defineComponent({
    name: 'DocumentsShellStub',
    props: {
      selectedTeamspaceId: {
        type: String,
        default: null,
      },
      selectedDocumentId: {
        type: String,
        default: null,
      },
      viewMode: {
        type: String,
        required: true,
      },
    },
    emits: ['openTeamspaces', 'openTeamspace', 'openDocument', 'documentsDeleted', 'back', 'openParent'],
    setup(props, { emit }) {
      return () => h('div', { 'data-testid': 'documents-mode' }, [
        h('aside', { 'data-testid': 'documents-sidebar' }),
        props.viewMode === 'card'
          ? h('section', { 'data-testid': 'document-card' }, [
              h('button', {
                'data-testid': 'document-card-back',
                type: 'button',
                onClick: () => emit('back'),
              }, 'back'),
            ])
          : h('section', { 'data-testid': 'teamspaces-view' }),
      ])
    },
  })
}

const TaskTrackerShell = import.meta.env.MODE === 'test'
  ? createTaskTrackerShellStub()
  : defineAsyncComponent(() => import('@/components/tasks/TaskTrackerShell.vue'))
const DocumentsShell = import.meta.env.MODE === 'test'
  ? createDocumentsShellStub()
  : defineAsyncComponent(() => import('@/components/documents/DocumentsShell.vue'))
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
const soundEngine = useNotificationSoundEngine()
const platform = getPlatformOrNull()
const isDesktopRuntime = isTauriRuntime()
const { checkExistingSubscription: checkPushSubscription, subscribe: subscribePush } = usePushNotifications()
const showServerUnavailableAlert = computed(() => authStore.lastAuthError === 'Server is unavailable')
const handlingIncomingInvite = ref(false)
const incomingInviteError = ref('')
const dismissedInviteIds = ref<string[]>([])
const selectedTemplateFilter = ref<string | null>(null)
const lastTaskTrackerNonCardRoute = ref<'tasks-list' | 'tasks-kanban'>('tasks-list')
const lastDocumentsNonCardRoute = ref<{ name: 'documents-teamspaces' | 'documents-teamspace'; teamspaceId?: string }>({
  name: 'documents-teamspaces',
})
let unsubscribeIncomingMessageSound: (() => void) | null = null
const tasksStore = useTasksStore()
const documentsStore = useDocumentsStore()
const isTaskTrackerRoute = computed(() => (
  route.name === 'tasks-list'
  || route.name === 'tasks-kanban'
  || route.name === 'tasks-card'
))
const isDocumentsRoute = computed(() => (
  route.name === 'documents-teamspaces'
  || route.name === 'documents-teamspace'
  || route.name === 'documents-card'
))
const taskTrackerBaseRouteName = computed<'tasks-list' | 'tasks-kanban'>(() => {
  if (route.name === 'tasks-list') return 'tasks-list'
  if (route.name === 'tasks-kanban') return 'tasks-kanban'
  return lastTaskTrackerNonCardRoute.value
})
const appMode = computed<'chat' | 'task-tracker' | 'documents'>(() => {
  if (isTaskTrackerRoute.value) return 'task-tracker'
  if (isDocumentsRoute.value) return 'documents'
  return 'chat'
})
const taskTrackerViewMode = computed<'list' | 'kanban' | 'card'>(() => {
  if (route.name === 'tasks-card') return 'card'
  if (route.name === 'tasks-kanban') return 'kanban'
  return 'list'
})
const documentsViewMode = computed<'teamspaces' | 'teamspace' | 'card'>(() => {
  if (route.name === 'documents-card') return 'card'
  if (route.name === 'documents-teamspace') return 'teamspace'
  return 'teamspaces'
})
const showChatModeUnreadBadge = computed(() => appMode.value !== 'chat' && chatStore.totalUnreadCount > 0)
const chatModeUnreadBadgeLabel = computed(() => (chatStore.totalUnreadCount > 99 ? '99+' : String(chatStore.totalUnreadCount)))
const pendingNotificationOpenIntent = ref<NotificationOpenIntent | null>(null)
const routeTaskSlug = computed(() =>
  typeof route.params.taskSlug === 'string' ? route.params.taskSlug : '',
)
const routeDocumentId = computed(() =>
  typeof route.params.documentId === 'string' ? route.params.documentId : '',
)
const routeDocumentsTeamspaceId = computed(() =>
  typeof route.params.teamspaceId === 'string' ? route.params.teamspaceId : '',
)
const documentsSelectedTeamspaceId = computed(() =>
  routeDocumentsTeamspaceId.value || documentsStore.selectedDocument?.teamspace_id || null,
)
let serviceWorkerMessageHandler: ((event: MessageEvent) => void) | null = null

async function goToChatMode() {
  if (route.name === 'main') return
  await router.push({ name: 'main' })
}

function queueNotificationOpenIntent(intent: NotificationOpenIntent | null) {
  if (!intent?.conversationId) return
  pendingNotificationOpenIntent.value = intent
  void tryConsumeNotificationOpenIntent()
}

function canConsumeNotificationOpenIntent() {
  return authStore.authState === 'AUTHENTICATED'
    && chatStore.bootstrapped
    && wsStore.state === 'LIVE_SYNCED'
}

function hasConversationInSnapshot(conversationId: string): boolean {
  return chatStore.channels.some(channel => channel.id === conversationId)
    || chatStore.directMessages.some(dm => dm.id === conversationId)
}

async function clearNotificationOpenQueryParams() {
  const currentRoute = router.currentRoute.value
  if (!notificationOpenIntentFromQuery(currentRoute.query as Record<string, unknown>)) return
  const nextQuery = stripNotificationOpenQuery(currentRoute.query as Record<string, unknown>)
  if (typeof currentRoute.name === 'string') {
    await router.replace({
      name: currentRoute.name,
      params: currentRoute.params,
      query: nextQuery as Record<string, string | string[]>,
      hash: currentRoute.hash,
    })
    return
  }
  await router.replace({
    path: currentRoute.path,
    query: nextQuery as Record<string, string | string[]>,
    hash: currentRoute.hash,
  })
}

async function tryConsumeNotificationOpenIntent() {
  const intent = pendingNotificationOpenIntent.value
  if (!intent || !canConsumeNotificationOpenIntent()) return

  if (!hasConversationInSnapshot(intent.conversationId)) {
    pendingNotificationOpenIntent.value = null
    await clearNotificationOpenQueryParams()
    return
  }

  if (router.currentRoute.value.name !== 'main') {
    await router.replace({ name: 'main' })
  }

  if (chatStore.activeChannelId !== intent.conversationId) {
    chatStore.selectChannel(intent.conversationId)
  }

  pendingNotificationOpenIntent.value = null
  await clearNotificationOpenQueryParams()
}

function canonicalTaskSlugFromPublicId(publicId: string): string {
  return taskSlugFromPublicId(publicId)
}

function canonicalTaskPublicIdFromSlug(taskSlug: string): string {
  return taskPublicIdFromSlug(taskSlug)
}

async function pushTaskRoute(publicId: string, replace = false) {
  const taskSlug = canonicalTaskSlugFromPublicId(publicId)
  if (replace) {
    await router.replace({ name: 'tasks-card', params: { taskSlug } })
    return
  }
  await router.push({ name: 'tasks-card', params: { taskSlug } })
}

async function syncTaskRouteToSelectedTask(replace = false) {
  const task = tasksStore.selectedTask
  if (!task) return
  saveLastOpenedTaskPublicId(task.public_id)
  const canonicalTaskSlug = canonicalTaskSlugFromPublicId(task.public_id)
  if (route.name === 'tasks-card' && routeTaskSlug.value === canonicalTaskSlug) return
  await pushTaskRoute(task.public_id, replace)
}

async function goToTaskTrackerMode() {
  const rememberedTaskPublicId = loadLastOpenedTaskPublicId()
  if (rememberedTaskPublicId) {
    await pushTaskRoute(rememberedTaskPublicId)
    return
  }
  await router.push({ name: 'tasks-list' })
}

async function goToDocumentsMode() {
  if (route.name === 'documents-card' || route.name === 'documents-teamspace' || route.name === 'documents-teamspaces') return
  if (lastDocumentsNonCardRoute.value.name === 'documents-teamspace' && lastDocumentsNonCardRoute.value.teamspaceId) {
    await router.push({ name: 'documents-teamspace', params: { teamspaceId: lastDocumentsNonCardRoute.value.teamspaceId } })
    return
  }
  await router.push({ name: 'documents-teamspaces' })
}

async function openTaskListRoute() {
  lastTaskTrackerNonCardRoute.value = 'tasks-list'
  if (route.name === 'tasks-list') return
  await router.push({ name: 'tasks-list' })
}

async function openTaskKanbanRoute() {
  lastTaskTrackerNonCardRoute.value = 'tasks-kanban'
  if (route.name === 'tasks-kanban') return
  await router.push({ name: 'tasks-kanban' })
}

async function openTask(publicId: string) {
  saveLastOpenedTaskPublicId(publicId)
  await pushTaskRoute(publicId)
}

async function openDocumentsTeamspacesRoute() {
  lastDocumentsNonCardRoute.value = { name: 'documents-teamspaces' }
  if (route.name === 'documents-teamspaces') return
  await router.push({ name: 'documents-teamspaces' })
}

async function openDocumentsTeamspaceRoute(teamspaceId: string) {
  lastDocumentsNonCardRoute.value = { name: 'documents-teamspace', teamspaceId }
  if (route.name === 'documents-teamspace' && routeDocumentsTeamspaceId.value === teamspaceId) return
  await router.push({ name: 'documents-teamspace', params: { teamspaceId } })
}

async function openDocument(id: string) {
  await router.push({ name: 'documents-card', params: { documentId: id } })
}

async function handleDocumentsDeleted(deletedDocumentIds: string[]) {
  if (deletedDocumentIds.length === 0) return
  const currentDocumentId = routeDocumentId.value || documentsStore.selectedDocument?.id || ''
  if (!currentDocumentId || !deletedDocumentIds.includes(currentDocumentId)) {
    return
  }
  documentsStore.clearSelectedDocument()
  await backToDocuments()
}

function routeTaskSlugMatchesSelected(routeSlug: string): boolean {
  const task = tasksStore.selectedTask
  if (!task) return false
  return task.public_id === canonicalTaskPublicIdFromSlug(routeSlug)
}

function routeDocumentIdMatchesSelected(routeID: string): boolean {
  const documentItem = documentsStore.selectedDocument
  if (!documentItem) return false
  return documentItem.id === routeID
}

async function backToList() {
  tasksStore.clearSelectedTask()
  // Refresh the list so any edits made in the card are reflected
  await tasksStore.loadTaskList()
  await router.push({ name: lastTaskTrackerNonCardRoute.value })
}

async function backToDocuments() {
  documentsStore.clearSelectedDocument()
  await documentsStore.loadSidebar(true)
  if (lastDocumentsNonCardRoute.value.name === 'documents-teamspace' && lastDocumentsNonCardRoute.value.teamspaceId) {
    await router.push({ name: 'documents-teamspace', params: { teamspaceId: lastDocumentsNonCardRoute.value.teamspaceId } })
    return
  }
  await router.push({ name: 'documents-teamspaces' })
}

watch(
  () => ({ name: route.name, taskSlug: routeTaskSlug.value, documentId: routeDocumentId.value, teamspaceId: routeDocumentsTeamspaceId.value }),
  async ({ name, taskSlug, documentId, teamspaceId }) => {
    if (name === 'tasks-card') {
      if (!taskSlug || isUuidTaskRouteValue(taskSlug)) {
        await router.replace({ name: lastTaskTrackerNonCardRoute.value })
        return
      }
      if (routeTaskSlugMatchesSelected(taskSlug)) {
        await syncTaskRouteToSelectedTask(true)
        return
      }
      const publicId = canonicalTaskPublicIdFromSlug(taskSlug)
      tasksStore.clearSelectedTask()
      await tasksStore.selectTaskByPublicId(publicId, true)
      if (routeTaskSlugMatchesSelected(taskSlug)) {
        await syncTaskRouteToSelectedTask(true)
      } else {
        clearLastOpenedTaskPublicId()
        await router.replace({ name: lastTaskTrackerNonCardRoute.value })
      }
      return
    }

    if (name === 'tasks-list' || name === 'tasks-kanban') {
      lastTaskTrackerNonCardRoute.value = name
      tasksStore.clearSelectedTask()
      return
    }

    if (name === 'documents-card') {
      if (!documentId) {
        await backToDocuments()
        return
      }
      void documentsStore.loadSidebar()
      if (routeDocumentIdMatchesSelected(documentId)) {
        return
      }
      documentsStore.clearSelectedDocument()
      await documentsStore.selectDocument(documentId, true)
      if (!routeDocumentIdMatchesSelected(documentId)) {
        await backToDocuments()
      }
      return
    }

    if (name === 'documents-teamspace') {
      if (!teamspaceId) {
        await router.replace({ name: 'documents-teamspaces' })
        return
      }
      lastDocumentsNonCardRoute.value = { name: 'documents-teamspace', teamspaceId }
      documentsStore.clearSelectedDocument()
      void documentsStore.loadTeamspaces()
      void documentsStore.loadSidebar()
      return
    }

    if (name === 'documents-teamspaces') {
      lastDocumentsNonCardRoute.value = { name: 'documents-teamspaces' }
      documentsStore.clearSelectedDocument()
      void documentsStore.loadTeamspaces()
      void documentsStore.loadSidebar()
      return
    }

    if (name === 'main') {
      tasksStore.clearSelectedTask()
      documentsStore.clearSelectedDocument()
    }
  },
  { immediate: true },
)

// Keep URL in sync when selected task changes from inside the card (subtasks, create dialog).
watch(() => tasksStore.selectedTask?.public_id, (taskPublicId) => {
  if (!taskPublicId || !isTaskTrackerRoute.value) return
  // While browsing the list, avoid re-opening a card due stale task selections.
  // The list should auto-open a card only for freshly created tasks.
  if (
    route.name !== 'tasks-card'
    && !(tasksStore.createDialogOpen && (route.name === 'tasks-list' || route.name === 'tasks-kanban'))
  ) {
    return
  }
  void syncTaskRouteToSelectedTask(route.name === 'tasks-card')
})

watch(() => documentsStore.selectedDocument?.id, (documentId) => {
  if (!documentId || !isDocumentsRoute.value) return
  if (route.name !== 'documents-card' && route.name !== 'documents-teamspace' && route.name !== 'documents-teamspaces') return
  if (route.name === 'documents-card' && routeDocumentId.value === documentId) return
  void router.push({ name: 'documents-card', params: { documentId } })
})

watch(
  () => route.name,
  (name) => {
    if (
      name === 'tasks-list'
      || name === 'tasks-kanban'
      || name === 'tasks-card'
      || name === 'documents-teamspaces'
      || name === 'documents-teamspace'
      || name === 'documents-card'
    ) return
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

function conversationNotificationTitle(conversationId: string): string {
  const channel = chatStore.channels.find(item => item.id === conversationId)
  if (channel) return `#${channel.name}`
  const dm = chatStore.directMessages.find(item => item.id === conversationId)
  if (dm) return dm.displayName
  return 'Msgnr'
}

function toMessagePreview(event: IncomingMessageNotification): string {
  const body = event.body.trim().replace(/\s+/g, ' ')
  if (body) {
    return body.length > 160 ? `${body.slice(0, 157)}...` : body
  }
  if (event.attachmentCount > 0) {
    return event.attachmentCount === 1 ? 'Sent an attachment' : `Sent ${event.attachmentCount} attachments`
  }
  return 'New message'
}

function conversationNotificationBody(event: IncomingMessageNotification): string {
  const preview = toMessagePreview(event)
  const isChannelConversation = chatStore.channels.some(item => item.id === event.conversationId)
  if (isChannelConversation && event.senderName) {
    return `${event.senderName}: ${preview}`
  }
  return preview
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

watch(
  [() => authStore.authState, () => wsStore.state, () => chatStore.bootstrapped],
  () => {
    void tryConsumeNotificationOpenIntent()
  },
  { immediate: true },
)

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
    if (!isDesktopRuntime && pushSupported && loadPushEndpoint()) {
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
  unsubscribeIncomingMessageSound = chatStore.onIncomingMessageNotification((event) => {
    const windowActive = isChatWindowActive()
    if (platform?.type === 'tauri') {
      if (!windowActive) {
        void platform.notifications.show({
          title: conversationNotificationTitle(event.conversationId),
          body: conversationNotificationBody(event),
          conversationId: event.conversationId,
          tag: `conv:${event.conversationId}`,
        })
      }
      void platform.notifications.playSound?.('message-ping')
      return
    }

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

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    serviceWorkerMessageHandler = (event: MessageEvent) => {
      queueNotificationOpenIntent(notificationOpenIntentFromMessage(event.data))
    }
    navigator.serviceWorker.addEventListener('message', serviceWorkerMessageHandler)
  }

  queueNotificationOpenIntent(notificationOpenIntentFromQuery(route.query as Record<string, unknown>))

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
  if (serviceWorkerMessageHandler && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.removeEventListener('message', serviceWorkerMessageHandler)
    serviceWorkerMessageHandler = null
  }
})
</script>
