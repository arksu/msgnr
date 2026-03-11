<template>
  <aside class="flex flex-col h-full w-60 min-w-[240px] bg-sidebar-bg select-none">

    <!-- Workspace header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 transition-colors">
      <span class="font-bold text-white text-[15px] truncate">Msgnr</span>
    </div>

    <!-- Scrollable nav -->
    <nav class="flex-1 overflow-y-auto py-2">

      <!-- Search -->
      <button
        class="w-full flex items-center gap-2 px-3 py-1.5 mx-1 rounded text-sidebar-text hover:bg-sidebar-hover text-sm transition-colors"
        style="width: calc(100% - 8px)"
      >
        <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <span class="text-sidebar-textMuted">Search</span>
        <span class="ml-auto text-xs text-sidebar-heading bg-white/10 px-1.5 py-0.5 rounded">⌘K</span>
      </button>

      <!-- Channels section -->
      <div class="mt-3">
        <div class="flex items-center pr-1">
          <button
            class="flex items-center gap-1 px-3 py-0.5 flex-1 text-left min-w-0"
            @click="channelsOpen = !channelsOpen"
          >
            <svg
              class="w-3 h-3 text-sidebar-heading transition-transform shrink-0"
              :class="channelsOpen ? 'rotate-90' : ''"
              fill="currentColor" viewBox="0 0 20 20"
            >
              <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd"/>
            </svg>
            <span class="text-xs font-semibold text-sidebar-heading uppercase tracking-wide">Channels</span>
          </button>
          <button
            class="h-5 w-5 flex items-center justify-center rounded text-sidebar-heading hover:text-sidebar-text hover:bg-sidebar-hover shrink-0 transition-colors"
            title="Join channel"
            data-testid="add-channel-button"
            @click.stop="openChannelPicker"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>

        <div v-if="channelsOpen" class="mt-0.5">
          <SidebarItem
            v-for="ch in sortedChannels"
            :key="ch.id"
            :active="chatStore.activeChannelId === ch.id"
            :unread="ch.unread"
            :has-unread-thread-replies="ch.hasUnreadThreadReplies"
            :muted="ch.notificationLevel === NotificationLevel.NOTHING"
            @click="openConversation(ch.id)"
          >
            <template #icon>
              <span v-if="ch.visibility === 'private'" class="text-sidebar-textMuted" :data-testid="`channel-private-icon-${ch.id}`">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="5" y="11" width="14" height="10" rx="2" ry="2" />
                  <path d="M8 11V8a4 4 0 1 1 8 0v3" />
                </svg>
              </span>
              <span v-else class="text-sidebar-textMuted text-[24px] leading-none font-semibold">#</span>
            </template>
            <span class="inline-flex items-center gap-1">
              <span>{{ ch.name }}</span>
              <span
                v-if="hasActiveCall(ch.id)"
                class="text-emerald-300"
                :data-testid="`active-call-icon-channel-${ch.id}`"
                title="Active call"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.63 2.63a2 2 0 0 1-.45 2.11L8.1 9.91a16 16 0 0 0 6 6l1.45-1.19a2 2 0 0 1 2.11-.45c.85.3 1.73.51 2.63.63A2 2 0 0 1 22 16.92z"/>
                </svg>
              </span>
            </span>
            <template #actions>
              <div class="relative z-40" data-conversation-menu-root @click.stop>
                <button
                  :data-testid="`conversation-menu-button-channel-${ch.id}`"
                  class="h-6 w-6 rounded text-sidebar-textMuted hover:text-sidebar-text hover:bg-sidebar-hover opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  :class="isConversationMenuOpen('channel', ch.id) ? 'opacity-100' : ''"
                  @click.stop="toggleConversationMenu('channel', ch.id)"
                >
                  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5A1.5 1.5 0 1010 8a1.5 1.5 0 000 3.5zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/>
                  </svg>
                </button>
                <div
                  v-if="isConversationMenuOpen('channel', ch.id)"
                  class="absolute right-0 top-7 z-50 min-w-40 rounded border border-white/10 bg-sidebar-bg shadow-xl"
                >
                  <NotificationLevelSelector
                    :model-value="ch.notificationLevel"
                    @update:model-value="(level) => { chatStore.setNotificationLevel(ch.id, level); closeConversationMenus() }"
                  />
                  <div class="border-t border-white/10 p-1">
                    <button
                      :data-testid="`conversation-leave-channel-${ch.id}`"
                      class="w-full text-left px-2 py-1 rounded text-xs text-red-300 hover:bg-sidebar-hover disabled:opacity-50"
                      :disabled="isLeavingConversation('channel', ch.id)"
                      @click.stop="leaveConversationFromSidebar('channel', ch.id)"
                    >
                      Leave
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </SidebarItem>


        </div>
      </div>

      <!-- Direct Messages section -->
      <div class="mt-3">
        <div class="flex items-center pr-1">
          <button
            class="flex items-center gap-1 px-3 py-0.5 flex-1 text-left min-w-0"
            @click="dmsOpen = !dmsOpen"
          >
            <svg
              class="w-3 h-3 text-sidebar-heading transition-transform shrink-0"
              :class="dmsOpen ? 'rotate-90' : ''"
              fill="currentColor" viewBox="0 0 20 20"
            >
              <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd"/>
            </svg>
            <span class="text-xs font-semibold text-sidebar-heading uppercase tracking-wide">Direct Messages</span>
          </button>
          <button
            class="h-5 w-5 flex items-center justify-center rounded text-sidebar-heading hover:text-sidebar-text hover:bg-sidebar-hover shrink-0 transition-colors"
            title="New message"
            data-testid="new-message-button"
            @click.stop="openDmPicker"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>

      <div v-if="dmsOpen" class="mt-0.5">
        <SidebarItem
          v-for="dm in chatStore.directMessages"
          :key="dm.id"
            :active="chatStore.activeChannelId === dm.id"
            :unread="dm.unread"
            :has-unread-thread-replies="dm.hasUnreadThreadReplies"
            :muted="dm.notificationLevel === NotificationLevel.NOTHING"
            @click="openConversation(dm.id)"
          >
            <template #icon>
              <UserAvatar
                :user-id="dm.userId"
                :display-name="dm.displayName"
                :avatar-url="dm.avatarUrl"
                size="sm"
                :presence="dm.presence"
              />
            </template>
            <span class="inline-flex items-center gap-1">
              <span>{{ dm.displayName }}</span>
              <span
                v-if="hasActiveCall(dm.id)"
                class="text-emerald-300"
                :data-testid="`active-call-icon-dm-${dm.id}`"
                title="Active call"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.63 2.63a2 2 0 0 1-.45 2.11L8.1 9.91a16 16 0 0 0 6 6l1.45-1.19a2 2 0 0 1 2.11-.45c.85.3 1.73.51 2.63.63A2 2 0 0 1 22 16.92z"/>
                </svg>
              </span>
            </span>
            <template #actions>
              <div class="relative z-40" data-conversation-menu-root @click.stop>
                <button
                  :data-testid="`conversation-menu-button-dm-${dm.id}`"
                  class="h-6 w-6 rounded text-sidebar-textMuted hover:text-sidebar-text hover:bg-sidebar-hover opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  :class="isConversationMenuOpen('dm', dm.id) ? 'opacity-100' : ''"
                  @click.stop="toggleConversationMenu('dm', dm.id)"
                >
                  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5A1.5 1.5 0 1010 8a1.5 1.5 0 000 3.5zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/>
                  </svg>
                </button>
                <div
                  v-if="isConversationMenuOpen('dm', dm.id)"
                  class="absolute right-0 top-7 z-50 min-w-40 rounded border border-white/10 bg-sidebar-bg shadow-xl"
                >
                  <NotificationLevelSelector
                    :model-value="dm.notificationLevel"
                    @update:model-value="(level) => { chatStore.setNotificationLevel(dm.id, level); closeConversationMenus() }"
                  />
                  <div class="border-t border-white/10 p-1">
                    <button
                      :data-testid="`conversation-leave-dm-${dm.id}`"
                      class="w-full text-left px-2 py-1 rounded text-xs text-red-300 hover:bg-sidebar-hover disabled:opacity-50"
                      :disabled="isLeavingConversation('dm', dm.id)"
                      @click.stop="leaveConversationFromSidebar('dm', dm.id)"
                    >
                      Leave
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </SidebarItem>
        </div>
      </div>
      <div v-if="conversationActionError" class="px-3 mt-1 text-[11px] text-red-300">
        {{ conversationActionError }}
      </div>
    </nav>

    <!-- Footer actions -->
    <div class="border-t border-white/10 px-3 py-2 space-y-0.5">
      <router-link
        v-if="isAdmin"
        to="/admin"
        class="flex items-center gap-2 px-2 py-1.5 rounded text-sidebar-text hover:bg-sidebar-hover text-sm transition-colors"
        active-class="bg-sidebar-active text-white"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
        </svg>
        Admin
      </router-link>

      <button
        class="flex items-center gap-2 px-2 py-1.5 rounded text-sidebar-text hover:bg-sidebar-hover text-sm transition-colors w-full"
        @click="$emit('profile')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
        Profile
      </button>

      <button
        class="flex items-center gap-2 px-2 py-1.5 rounded text-sidebar-text hover:bg-sidebar-hover text-sm transition-colors w-full"
        @click="$emit('settings')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        Settings
      </button>

      <!-- User identity -->
      <div class="flex items-center gap-2 px-2 py-1.5 mt-1">
        <UserAvatar
          :user-id="sidebarIdentity.userId"
          :display-name="sidebarIdentity.displayName || sidebarIdentity.fallback"
          :avatar-url="sidebarIdentity.avatarUrl"
          size="sm"
          :presence="selfPresence"
        />
        <div class="min-w-0">
          <div class="text-sm text-sidebar-text truncate font-medium">{{ sidebarIdentity.displayName }}</div>
          <div class="text-xs text-sidebar-textMuted truncate flex items-center gap-1">
            <span>{{ sidebarIdentity.role }}</span>
            <span>·</span>
            <button
              type="button"
              data-testid="presence-menu-button"
              class="inline-flex items-center gap-1 hover:text-sidebar-text transition-colors"
              @click="presenceMenuOpen = !presenceMenuOpen"
            >
              <span class="w-1.5 h-1.5 rounded-full inline-block" :class="selfPresenceDotClass"/>
              <span>{{ selfPresenceLabel }}</span>
            </button>
          </div>
        </div>
        <button class="ml-auto text-sidebar-textMuted hover:text-red-400 transition-colors" @click="handleLogout">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
          </svg>
        </button>
      </div>
      <div v-if="presenceMenuOpen" class="px-2 pb-1">
        <div class="rounded border border-white/10 bg-sidebar-hover/60 p-1 space-y-0.5">
          <button
            type="button"
            data-testid="presence-set-active"
            class="w-full text-left px-2 py-1 rounded text-xs text-sidebar-text hover:bg-white/10"
            @click="setManualPresence('online')"
          >
            Set as active
          </button>
          <button
            type="button"
            data-testid="presence-set-away"
            class="w-full text-left px-2 py-1 rounded text-xs text-sidebar-text hover:bg-white/10"
            @click="setManualPresence('away')"
          >
            Set as away
          </button>
        </div>
      </div>
    </div>

  </aside>

  <Teleport to="body">
    <div
      v-if="channelPickerOpen"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      @click.self="closeChannelPicker"
    >
      <div class="w-full max-w-md rounded-xl bg-sidebar-bg border border-white/10 shadow-2xl overflow-hidden">
        <div class="px-4 py-3 border-b border-white/10">
          <div class="text-white font-semibold text-sm">Join channels</div>
          <div class="text-xs text-sidebar-textMuted mt-1">Select public channels you want to join.</div>
        </div>

        <div v-if="channelPickerError" class="px-4 py-3 text-sm text-red-300 border-b border-white/10">
          {{ channelPickerError }}
        </div>

        <div class="max-h-80 overflow-y-auto">
          <button
            v-for="candidate in channelCandidates"
            :key="candidate.id"
            :data-testid="`channel-candidate-${candidate.id}`"
            class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-sidebar-hover transition-colors"
            @click="toggleChannelSelection(candidate.id)"
          >
            <input
              type="checkbox"
              class="h-4 w-4"
              :checked="selectedChannelIds.includes(candidate.id)"
              @click.stop
              @change="toggleChannelSelection(candidate.id)"
            >
            <div class="text-sidebar-textMuted font-medium">#</div>
            <div class="min-w-0">
              <div class="text-sm text-sidebar-text truncate">{{ candidate.name }}</div>
            </div>
          </button>

          <div v-if="!channelLoading && channelCandidates.length === 0" class="px-4 py-6 text-sm text-sidebar-textMuted text-center">
            No available public channels
          </div>

          <div v-if="channelLoading" class="px-4 py-6 text-sm text-sidebar-textMuted text-center">
            Loading channels...
          </div>
        </div>

        <div class="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
          <button
            class="px-3 py-1.5 rounded text-sm text-sidebar-text hover:bg-sidebar-hover transition-colors"
            @click="closeChannelPicker"
          >
            Close
          </button>
          <button
            data-testid="join-selected-channels-button"
            class="px-3 py-1.5 rounded text-sm bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="selectedChannelIds.length === 0 || joiningChannels"
            @click="joinSelectedChannels"
          >
            Join selected
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="dmPickerOpen"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      @click.self="closeDmPicker"
    >
      <div class="w-full max-w-md rounded-xl bg-sidebar-bg border border-white/10 shadow-2xl overflow-hidden">
        <div class="px-4 py-3 border-b border-white/10">
          <div class="text-white font-semibold text-sm">Start direct message</div>
          <div class="text-xs text-sidebar-textMuted mt-1">Choose an active user to open a 1:1 DM.</div>
        </div>

        <div v-if="dmPickerError" class="px-4 py-3 text-sm text-red-300 border-b border-white/10">
          {{ dmPickerError }}
        </div>

        <div class="max-h-80 overflow-y-auto">
          <button
            v-for="candidate in dmCandidates"
            :key="candidate.userId"
            :data-testid="`dm-candidate-${candidate.userId}`"
            class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-sidebar-hover transition-colors"
            @click="selectDmCandidate(candidate.userId)"
          >
            <UserAvatar
              :user-id="candidate.userId"
              :display-name="candidate.displayName"
              :avatar-url="candidate.avatarUrl"
              size="sm"
            />
            <div class="min-w-0">
              <div class="text-sm text-sidebar-text truncate">{{ candidate.displayName }}</div>
            </div>
          </button>

          <div v-if="!dmLoading && dmCandidates.length === 0" class="px-4 py-6 text-sm text-sidebar-textMuted text-center">
            No available users
          </div>

          <div v-if="dmLoading" class="px-4 py-6 text-sm text-sidebar-textMuted text-center">
            Loading users...
          </div>
        </div>

        <div class="px-4 py-3 border-t border-white/10 flex justify-end">
          <button
            class="px-3 py-1.5 rounded text-sm text-sidebar-text hover:bg-sidebar-hover transition-colors"
            @click="closeDmPicker"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { NotificationLevel, PresenceStatus } from '@/shared/proto/packets_pb'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useWsStore } from '@/stores/ws'
import { useSessionOrchestrator } from '@/composables/useSessionOrchestrator'
import { createOrOpenDm, joinChannels, leaveConversation, listAvailableChannels, listDmCandidates } from '@/services/http/chatApi'
import { loadManualPresencePreference, saveManualPresencePreference } from '@/services/storage/manualPresenceStorage'
import SidebarItem from './SidebarItem.vue'
import NotificationLevelSelector from './NotificationLevelSelector.vue'
import UserAvatar from './UserAvatar.vue'

defineEmits<{ profile: []; settings: [] }>()

const router = useRouter()
const authStore = useAuthStore()
const chatStore = useChatStore()
const wsStore = useWsStore()
const { logout } = useSessionOrchestrator()

const channelsOpen = ref(true)
const dmsOpen = ref(true)
const channelPickerOpen = ref(false)
const channelLoading = ref(false)
const joiningChannels = ref(false)
const channelPickerError = ref('')
const channelCandidates = ref<Array<{ id: string; name: string }>>([])
const selectedChannelIds = ref<string[]>([])
const dmPickerOpen = ref(false)
const dmLoading = ref(false)
const dmPickerError = ref('')
const dmCandidates = ref<Array<{ userId: string; displayName: string; email: string; avatarUrl: string }>>([])
const presenceMenuOpen = ref(false)
const manualPresence = ref<'online' | 'away'>(loadManualPresencePreference() ?? 'online')
const openConversationMenuKey = ref('')
const leavingConversationKey = ref('')
const conversationActionError = ref('')

const isAdmin = computed(() => {
  const role = authStore.effectiveRole ?? chatStore.workspace?.selfRole
  return role === 'admin' || role === 'owner'
})
const sortedChannels = computed(() =>
  [...chatStore.channels].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
)

const sidebarIdentity = computed(() => ({
  userId: authStore.user?.id ?? chatStore.workspace?.selfUserId ?? '',
  displayName: authStore.user?.displayName ?? chatStore.workspace?.selfDisplayName ?? '',
  avatarUrl: authStore.user?.avatarUrl ?? chatStore.workspace?.selfAvatarUrl ?? '',
  role: authStore.effectiveRole ?? chatStore.workspace?.selfRole ?? '',
  fallback: authStore.user?.email ?? chatStore.workspace?.name ?? '?',
}))
const selfPresence = computed(() => {
  const selfUserId = authStore.user?.id ?? chatStore.workspace?.selfUserId ?? ''
  if (!selfUserId) return manualPresence.value
  const presence = chatStore.presenceByUserId[selfUserId]?.effectivePresence
  if (presence === PresenceStatus.AWAY) return 'away'
  if (presence === PresenceStatus.ONLINE) return 'online'
  return manualPresence.value
})
const selfPresenceLabel = computed(() => selfPresence.value === 'away' ? 'Away' : 'Active')
const selfPresenceDotClass = computed(() => selfPresence.value === 'away' ? 'bg-amber-400' : 'bg-green-400')

function hasActiveCall(conversationId: string): boolean {
  return chatStore.activeCalls.some(call => call.conversationId === conversationId)
}

async function handleLogout() {
  await logout()
  router.push({ name: 'login' })
}

async function openConversation(conversationId: string) {
  chatStore.selectChannel(conversationId)
  if (router.currentRoute.value.name !== 'main') {
    await router.push({ name: 'main' })
  }
}

function canSendPresence() {
  return wsStore.state === 'AUTH_COMPLETE'
    || wsStore.state === 'BOOTSTRAPPING'
    || wsStore.state === 'LIVE_SYNCED'
    || wsStore.state === 'RECOVERING_GAP'
    || wsStore.state === 'STALE_REBOOTSTRAP'
}

function setManualPresence(value: 'online' | 'away') {
  manualPresence.value = value
  saveManualPresencePreference(value)
  if (canSendPresence()) {
    wsStore.sendSetPresence(value === 'away' ? PresenceStatus.AWAY : PresenceStatus.ONLINE)
  }
  presenceMenuOpen.value = false
}

function conversationMenuKey(kind: 'channel' | 'dm', conversationId: string) {
  return `${kind}:${conversationId}`
}

function isConversationMenuOpen(kind: 'channel' | 'dm', conversationId: string) {
  return openConversationMenuKey.value === conversationMenuKey(kind, conversationId)
}

function isLeavingConversation(kind: 'channel' | 'dm', conversationId: string) {
  return leavingConversationKey.value === conversationMenuKey(kind, conversationId)
}

function toggleConversationMenu(kind: 'channel' | 'dm', conversationId: string) {
  const key = conversationMenuKey(kind, conversationId)
  openConversationMenuKey.value = openConversationMenuKey.value === key ? '' : key
  conversationActionError.value = ''
}

function closeConversationMenus() {
  openConversationMenuKey.value = ''
}

async function leaveConversationFromSidebar(kind: 'channel' | 'dm', conversationId: string) {
  const key = conversationMenuKey(kind, conversationId)
  leavingConversationKey.value = key
  conversationActionError.value = ''
  try {
    await leaveConversation(conversationId)
    chatStore.removeConversationLocal(conversationId)
    openConversationMenuKey.value = ''
  } catch (err) {
    conversationActionError.value = err instanceof Error ? err.message : 'Failed to leave conversation'
  } finally {
    if (leavingConversationKey.value === key) {
      leavingConversationKey.value = ''
    }
  }
}

onMounted(() => {
  document.addEventListener('click', closeConversationMenus)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeConversationMenus)
})

async function openDmPicker() {
  dmPickerOpen.value = true
  dmLoading.value = true
  dmPickerError.value = ''
  try {
    const candidates = await listDmCandidates()
    const existingDmUserIds = new Set(
      chatStore.directMessages
        .map(dm => dm.userId)
        .filter(userId => userId.trim().length > 0),
    )
    dmCandidates.value = candidates.map(candidate => ({
      userId: candidate.user_id,
      displayName: candidate.display_name || candidate.email,
      email: candidate.email,
      avatarUrl: candidate.avatar_url,
    })).filter(candidate => !existingDmUserIds.has(candidate.userId))
  } catch (err) {
    dmPickerError.value = err instanceof Error ? err.message : 'Failed to load users'
  } finally {
    dmLoading.value = false
  }
}

async function openChannelPicker() {
  channelPickerOpen.value = true
  channelLoading.value = true
  channelPickerError.value = ''
  selectedChannelIds.value = []
  try {
    const channels = await listAvailableChannels()
    channelCandidates.value = channels
      .filter(channel => channel.kind === 'channel' && channel.visibility === 'public')
      .map(channel => ({
        id: channel.id,
        name: channel.name,
      }))
  } catch (err) {
    channelPickerError.value = err instanceof Error ? err.message : 'Failed to load channels'
  } finally {
    channelLoading.value = false
  }
}

function closeChannelPicker() {
  closeConversationMenus()
  channelPickerOpen.value = false
  channelPickerError.value = ''
  joiningChannels.value = false
}

function toggleChannelSelection(channelId: string) {
  if (selectedChannelIds.value.includes(channelId)) {
    selectedChannelIds.value = selectedChannelIds.value.filter(id => id !== channelId)
    return
  }
  selectedChannelIds.value = [...selectedChannelIds.value, channelId]
}

async function joinSelectedChannels() {
  if (selectedChannelIds.value.length === 0) return
  joiningChannels.value = true
  channelPickerError.value = ''
  try {
    const selectedInDialogOrder = channelCandidates.value
      .filter(channel => selectedChannelIds.value.includes(channel.id))
      .map(channel => channel.id)

    const joined = await joinChannels(selectedInDialogOrder)
    for (const channel of joined) {
      const mapped = {
        id: channel.id,
        name: channel.name,
        kind: 'channel' as const,
        visibility: channel.visibility === 'private' ? 'private' as const : 'public' as const,
        unread: 0,
        lastActivityAt: channel.last_activity_at,
        notificationLevel: NotificationLevel.ALL,
      }
      const existingIdx = chatStore.channels.findIndex(existing => existing.id === channel.id)
      if (existingIdx === -1) {
        chatStore.channels.unshift(mapped)
      } else {
        chatStore.channels.splice(existingIdx, 1, mapped)
      }
    }
    if (joined.length > 0) {
      channelsOpen.value = true
      chatStore.selectChannel(joined[0].id)
    }
    closeChannelPicker()
  } catch (err) {
    channelPickerError.value = err instanceof Error ? err.message : 'Failed to join channels'
  } finally {
    joiningChannels.value = false
  }
}

function closeDmPicker() {
  closeConversationMenus()
  dmPickerOpen.value = false
  dmPickerError.value = ''
}

async function selectDmCandidate(userId: string) {
  dmPickerError.value = ''
  try {
    const dm = await createOrOpenDm(userId)
    chatStore.openDirectMessage({
      id: dm.conversation_id,
      userId: dm.user_id,
      displayName: dm.display_name || dm.email,
      avatarUrl: dm.avatar_url,
      presence: 'offline',
      unread: 0,
      notificationLevel: NotificationLevel.ALL,
    })
    dmsOpen.value = true
    closeDmPicker()
  } catch (err) {
    dmPickerError.value = err instanceof Error ? err.message : 'Failed to open direct message'
  }
}
</script>
