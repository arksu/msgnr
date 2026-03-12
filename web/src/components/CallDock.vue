<template>
  <div v-if="isVisible" :class="containerClass">
    <!-- ── Minimized pill ─────────────────────────────────────────────────── -->
    <div
      v-if="callStore.minimized"
      class="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-slate-900/95 px-3 py-1.5 text-white shadow-xl backdrop-blur"
    >
      <!-- Expand back to panel -->
      <button class="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-white/10 text-xs font-medium" @click="callStore.toggleMinimized()">
        <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
        <span class="max-w-[120px] truncate">{{ callStore.activeConversationTitle || 'Huddle' }}</span>
      </button>
      <div class="h-4 w-px bg-slate-700" />
      <!-- Mic toggle -->
      <button
        class="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
        :class="callStore.micEnabled ? 'text-slate-300 hover:bg-white/10' : 'text-red-400 hover:bg-white/10'"
        :title="callStore.micEnabled ? 'Mute' : 'Unmute'"
        @click="handleToggleMute"
      >
        <svg v-if="callStore.micEnabled" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
        </svg>
        <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v3M8 23h8"/>
        </svg>
      </button>
      <!-- Leave -->
      <button
        class="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/80 text-white hover:bg-red-500 transition-colors"
        title="Leave call"
        @click="handleLeave"
      >
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.4 12.4 0 0 0 2.53.59A2 2 0 0 1 22 16.84V19a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.26 11 19.8 19.8 0 0 1 1.18 2.37 2 2 0 0 1 3.16 0H5.5a2 2 0 0 1 2 1.72 12.4 12.4 0 0 0 .57 2.57 2 2 0 0 1-.45 2.11L6.35 7.67a16 16 0 0 0 4.33 5.64z"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      </button>
    </div>

    <!-- ── Expanded panel ─────────────────────────────────────────────────── -->
    <section v-else :class="panelClass">

      <!-- Header — single compact line -->
      <header class="flex items-center gap-2 border-b border-slate-700/80 px-3 py-2 shrink-0 min-w-0">
        <span class="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
        <span class="truncate text-sm font-semibold text-white min-w-0">{{ callStore.activeConversationTitle || 'Huddle' }}</span>
        <span class="shrink-0 text-slate-600">·</span>
        <span class="shrink-0 text-xs text-slate-400">{{ callStore.connecting ? 'Connecting…' : `${callStore.remoteParticipantCount + 1}` }}</span>
        <div class="ml-auto flex items-center gap-0.5 shrink-0">
          <!-- Maximize / restore -->
          <button
            class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            :title="maximized ? 'Restore' : 'Maximize'"
            @click="toggleMaximized"
          >
            <!-- Maximize: arrows-pointing-out -->
            <svg v-if="!maximized" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>
            <!-- Restore: arrows-pointing-in -->
            <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
            </svg>
          </button>
          <!-- Minimize to pill -->
          <button
            class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            title="Minimize"
            @click="handleMinimize"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M5 12h14"/>
            </svg>
          </button>
        </div>
      </header>

      <!-- Body -->
      <div :class="contentClass">

        <!-- Stage wrapper — must pass flex-1 height down in maximized mode -->
        <div :class="maximized ? 'flex-1 min-h-0 flex flex-col' : ''">

          <!-- ── Main stage ─────────────────────────────────────────────── -->
          <div :class="stageClass">

            <!--
              Remote screen share video — ALWAYS in DOM (v-show, not v-if) so the
              ref is populated before syncRemoteScreenTrack() tries to attach to it.
            -->
            <video
              ref="remoteScreenEl"
              v-show="remoteScreenActive && !pinnedSid"
              class="absolute inset-0 h-full w-full bg-black object-contain"
              autoplay
              playsinline
            />
            <div
              v-if="remoteScreenActive && !pinnedSid"
              class="absolute left-3 top-3 z-10 rounded-md border border-slate-500/70 bg-black/60 px-2 py-1 text-[11px] text-white"
            >
              {{ remoteScreenOwnerLabel }}
            </div>

            <!-- Pinned view: fills stage when a tile is pinned -->
            <template v-if="pinnedSid">
              <!-- Pinned video — always in DOM so ref is stable -->
              <video
                ref="pinnedVideoEl"
                class="absolute inset-0 h-full w-full object-cover bg-black"
                :class="pinnedTileHasVideo ? '' : 'invisible'"
                autoplay
                playsinline
                muted
              />
              <!-- Avatar fallback when pinned tile has no video -->
              <div
                v-if="!pinnedTileHasVideo"
                class="absolute inset-0 flex items-center justify-center"
              >
                <UserAvatar
                  :user-id="pinnedTile?.identity ?? ''"
                  :display-name="pinnedTileName"
                  :avatar-url="pinnedTile?.avatarUrl"
                  size="xl"
                  :class="fallbackAvatarClass"
                />
              </div>
              <!-- Name badge -->
              <div class="absolute left-3 bottom-12 z-10 rounded-md border border-slate-500/70 bg-black/60 px-2 py-1 text-[11px] text-white">
                {{ pinnedTileName }}
              </div>
              <!-- Unpin button -->
              <button
                class="absolute top-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 transition-colors"
                title="Unpin"
                @click="unpinTile"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </template>

            <!-- Camera tile grid (shown when no remote screen share and nothing pinned) -->
            <template v-if="!remoteScreenActive && !pinnedSid">
              <div :class="tileGridClass">

                  <!-- Local tile — NOT in v-for so ref="localVideoEl" / ref="localScreenEl"
                       are always stable single-element refs, never arrays. -->
                  <div
                    :class="[tileItemClass, localTile?.isSpeaking ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-slate-900' : '']"
                  >
                    <!--
                      Both video elements always in DOM — visibility toggled via CSS.
                      This ensures refs are always populated when watchEffect runs.
                    -->
                    <!-- Camera video -->
                    <video
                      ref="localVideoEl"
                      class="absolute inset-0 h-full w-full object-cover"
                      :class="localTile?.cameraOn && !localTile?.screenShareOn ? 'opacity-100' : 'opacity-0 pointer-events-none'"
                      autoplay
                      playsinline
                      muted
                    />
                    <!-- Local screen share video -->
                    <video
                      ref="localScreenEl"
                      class="absolute inset-0 h-full w-full object-contain bg-black"
                      :class="localTile?.screenShareOn ? 'opacity-100' : 'opacity-0 pointer-events-none'"
                      autoplay
                      playsinline
                      muted
                    />
                    <!-- Avatar fallback -->
                    <div
                      v-if="!localTile?.cameraOn && !localTile?.screenShareOn"
                      class="flex h-full w-full items-center justify-center"
                    >
                      <UserAvatar
                        :user-id="localTile?.identity ?? ''"
                        :display-name="localTile?.name ?? 'You'"
                        :avatar-url="localTile?.avatarUrl"
                        size="lg"
                        :class="fallbackAvatarClass"
                      />
                    </div>
                    <!-- "Sharing screen" badge -->
                    <div
                      v-if="localTile?.screenShareOn"
                      class="absolute left-2 top-2 z-10 rounded border border-emerald-400/50 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200"
                    >
                      Sharing screen
                    </div>
                    <!-- Name + mic overlay -->
                    <div class="absolute bottom-0 inset-x-0 z-10 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                      <span class="flex-1 truncate text-[11px] font-medium text-white leading-tight">{{ localTile?.name ?? '' }}</span>
                      <svg v-if="!localTile?.micOn" class="h-3.5 w-3.5 shrink-0 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <line x1="1" y1="1" x2="23" y2="23"/>
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v3M8 23h8"/>
                      </svg>
                      <svg v-else class="h-3.5 w-3.5 shrink-0 text-slate-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                      </svg>
                    </div>
                    <!-- Pin button (hover) -->
                    <button
                      v-if="localTile"
                      class="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                      title="Pin to full view"
                      @click.stop="pinTile(localTile.sid)"
                    >
                      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M15 3h6v6M9 21L21 3M21 9V3h-6"/>
                      </svg>
                    </button>
                  </div>

                  <!-- Remote tiles -->
                  <div
                    v-for="tile in remoteTiles"
                    :key="tile.sid"
                    :class="[tileItemClass, tile.isSpeaking ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-slate-900' : '']"
                  >
                    <video
                      v-if="tile.cameraOn"
                      :ref="(el) => setRemoteTileRef(tile.sid, el as HTMLVideoElement | null)"
                      class="h-full w-full object-cover"
                      autoplay
                      playsinline
                    />
                    <div
                      v-else
                      class="flex h-full w-full items-center justify-center"
                    >
                      <UserAvatar
                        :user-id="tile.identity"
                        :display-name="tile.name"
                        :avatar-url="tile.avatarUrl"
                        size="lg"
                        :class="fallbackAvatarClass"
                      />
                    </div>
                    <div class="absolute bottom-0 inset-x-0 z-10 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                      <span class="flex-1 truncate text-[11px] font-medium text-white leading-tight">{{ tile.name }}</span>
                      <svg v-if="!tile.micOn" class="h-3.5 w-3.5 shrink-0 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <line x1="1" y1="1" x2="23" y2="23"/>
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v3M8 23h8"/>
                      </svg>
                      <svg v-else class="h-3.5 w-3.5 shrink-0 text-slate-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                      </svg>
                    </div>
                    <!-- Pin button (hover) -->
                    <button
                      class="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                      title="Pin to full view"
                      @click.stop="pinTile(tile.sid)"
                    >
                      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M15 3h6v6M9 21L21 3M21 9V3h-6"/>
                      </svg>
                    </button>
                  </div>

              </div>
            </template>

          </div>
        </div>

        <!-- Error / audio blocked banners -->
        <div v-if="callStore.errorMessage" class="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {{ callStore.errorMessage }}
        </div>
        <div v-if="callStore.playbackBlocked" class="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          <div class="mb-2">Audio playback is blocked by the browser.</div>
          <button class="rounded bg-amber-500/80 px-2 py-1 text-xs text-white hover:bg-amber-500" @click="handleEnableAudio">
            Enable audio
          </button>
        </div>

        <!-- Controls bar — icon-only buttons -->
        <div class="relative flex items-center justify-center gap-2 py-1 shrink-0">

          <!-- Microphone -->
          <button
            class="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
            :class="callStore.micEnabled ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'"
            :title="callStore.micEnabled ? 'Mute microphone' : 'Unmute microphone'"
            @click="handleToggleMute"
          >
            <!-- Mic on -->
            <svg v-if="callStore.micEnabled" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
            </svg>
            <!-- Mic off / muted -->
            <svg v-else class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <line x1="1" y1="1" x2="23" y2="23"/>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v3M8 23h8"/>
            </svg>
          </button>

          <!-- Camera -->
          <button
            class="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
            :class="callStore.cameraEnabled ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'"
            :title="callStore.cameraEnabled ? 'Turn off camera' : 'Turn on camera'"
            @click="handleToggleCamera"
          >
            <!-- Camera on -->
            <svg v-if="callStore.cameraEnabled" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M23 7l-7 5 7 5V7z"/>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            <!-- Camera off -->
            <svg v-else class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>

          <!-- Screen share -->
          <button
            class="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
            :class="[
              callStore.screenShareEnabled
                ? 'bg-emerald-600/80 hover:bg-emerald-600 text-white'
                : 'bg-slate-700 text-white',
              !callStore.screenShareEnabled && callStore.remoteScreenShareActive
                ? 'opacity-50 cursor-not-allowed'
                : !callStore.screenShareEnabled ? 'hover:bg-slate-600' : '',
            ]"
            :title="!callStore.screenShareEnabled && callStore.remoteScreenShareActive
              ? 'Someone is already sharing their screen'
              : callStore.screenShareEnabled ? 'Stop sharing screen' : 'Share screen'"
            :disabled="!callStore.screenShareEnabled && callStore.remoteScreenShareActive"
            @click="handleToggleScreenShare"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <path d="M8 21h8M12 17v4"/>
              <polyline v-if="callStore.screenShareEnabled" points="17 8 12 3 7 8"/>
              <line v-if="callStore.screenShareEnabled" x1="12" y1="3" x2="12" y2="15"/>
              <polyline v-else points="12 8 12 13 15 10"/>
            </svg>
          </button>

          <!-- Invite members -->
          <button
            class="flex h-10 items-center justify-center gap-1.5 rounded-full px-3 transition-colors bg-slate-700 text-white hover:bg-slate-600"
            title="Invite members"
            data-testid="calldock-invite-button"
            :disabled="inviteLoading || inviteSubmitting"
            :class="inviteLoading || inviteSubmitting ? 'opacity-60 cursor-not-allowed' : ''"
            @click="openInviteDialog"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M19 8v6M16 11h6"/>
            </svg>
            <span class="text-xs font-medium">Invite</span>
          </button>

          <!-- End call -->
          <button
            class="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 hover:bg-red-400 text-white transition-colors"
            title="Leave call"
            @click="handleLeave"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.4 12.4 0 0 0 2.53.59A2 2 0 0 1 22 16.84V19a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.26 11 19.8 19.8 0 0 1 1.18 2.37 2 2 0 0 1 3.16 0H5.5a2 2 0 0 1 2 1.72 12.4 12.4 0 0 0 .57 2.57 2 2 0 0 1-.45 2.11L6.35 7.67a16 16 0 0 0 4.33 5.64z"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>

          <!-- Mute hotkey hint -->
          <span class="absolute right-0 flex items-center gap-1 text-[10px] text-slate-500 select-none pointer-events-none">
            <kbd class="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 font-mono leading-none">⌘D</kbd>
            <span>mute</span>
          </span>

        </div>

      </div>
    </section>

    <!-- Hidden audio host for remote audio tracks -->
    <div ref="remoteAudioHostEl" class="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true" />
  </div>

  <Teleport to="body">
    <div
      v-if="isVisible && inviteDialogOpen"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      data-testid="calldock-invite-modal"
      @click.self="closeInviteDialog"
    >
      <div class="w-full max-w-md overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div class="border-b border-slate-700 px-4 py-3">
          <div class="text-sm font-semibold text-white">Invite members to call</div>
          <div class="mt-1 text-xs text-slate-400">Select members and send invite notifications.</div>
        </div>

        <div v-if="inviteError" class="border-b border-slate-700 px-4 py-2 text-xs text-red-300">
          {{ inviteError }}
        </div>
        <div v-if="inviteResultSummary" class="border-b border-slate-700 px-4 py-2 text-xs text-emerald-200">
          {{ inviteResultSummary }}
        </div>

        <div class="max-h-72 overflow-y-auto">
          <div v-if="inviteLoading" class="px-4 py-6 text-center text-xs text-slate-400">
            Loading members...
          </div>
          <div v-else-if="inviteCandidates.length === 0" class="px-4 py-6 text-center text-xs text-slate-400">
            No members are available to invite.
          </div>
          <template v-else>
            <button
              v-for="candidate in inviteCandidates"
              :key="candidate.userId"
              :data-testid="`calldock-invite-candidate-${candidate.userId}`"
              class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5"
              @click="toggleInviteCandidate(candidate.userId)"
            >
              <input
                type="checkbox"
                class="h-4 w-4"
                :checked="selectedInviteeIds.includes(candidate.userId)"
                @click.stop
                @change="toggleInviteCandidate(candidate.userId)"
              >
              <UserAvatar
                :user-id="candidate.userId"
                :display-name="candidate.displayName || candidate.email"
                :avatar-url="candidate.avatarUrl"
                size="sm"
              />
              <div class="min-w-0">
                <div class="truncate text-sm text-white">{{ candidate.displayName || candidate.email }}</div>
                <div class="truncate text-xs text-slate-400">{{ candidate.email }}</div>
              </div>
            </button>
          </template>
        </div>

        <div class="flex justify-end gap-2 border-t border-slate-700 px-4 py-3">
          <button class="rounded px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10" @click="closeInviteDialog">
            Close
          </button>
          <button
            class="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            data-testid="calldock-send-invites"
            :disabled="inviteLoading || inviteSubmitting || selectedInviteeIds.length === 0"
            @click="sendCallInvites"
          >
            {{ inviteSubmitting ? 'Sending...' : 'Send invites' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRaw, watch, watchEffect } from 'vue'
import { Track } from 'livekit-client'
import { useCallStore } from '@/stores/call'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { listDmCandidates, type DmCandidateItem } from '@/services/http/chatApi'
import UserAvatar from './UserAvatar.vue'

// ── Types ─────────────────────────────────────────────────────────────────────

type AttachableMediaTrack = {
  sid: string
  kind: string
  attach: (el?: HTMLMediaElement) => HTMLMediaElement
  detach: (el?: HTMLMediaElement) => HTMLMediaElement[]
}

interface ParticipantTile {
  sid: string
  identity: string
  name: string
  avatarUrl?: string
  isLocal: boolean
  cameraOn: boolean
  screenShareOn: boolean
  micOn: boolean
  isSpeaking: boolean
}

interface InviteCandidate {
  userId: string
  displayName: string
  email: string
  avatarUrl: string
}

// ── Stores ────────────────────────────────────────────────────────────────────

const callStore = useCallStore()
const chatStore = useChatStore()
const authStore = useAuthStore()

// ── DOM unwrap helper ─────────────────────────────────────────────────────────
// LiveKit's track.attach(el) calls el.play() internally. Vue can wrap refs in
// a Proxy, making .play() non-callable. Always unwrap to the raw DOM node.
function unwrapEl<T extends HTMLElement>(el: T | null | undefined): T | null {
  if (!el) return null
  if (el instanceof HTMLElement) return el
  const raw = toRaw(el) as T
  return raw instanceof HTMLElement ? raw : null
}

// ── Refs ──────────────────────────────────────────────────────────────────────

const localVideoEl = ref<HTMLVideoElement | null>(null)   // local camera
const localScreenEl = ref<HTMLVideoElement | null>(null)  // local screen share
const remoteScreenEl = ref<HTMLVideoElement | null>(null) // remote screen share (always mounted)
const pinnedVideoEl = ref<HTMLVideoElement | null>(null)  // pinned full-stage view
const remoteAudioHostEl = ref<HTMLDivElement | null>(null)
const maximized = ref(false)
const pinnedSid = ref<string | null>(null)
const inviteDialogOpen = ref(false)
const inviteCandidates = ref<InviteCandidate[]>([])
const selectedInviteeIds = ref<string[]>([])
const inviteLoading = ref(false)
const inviteSubmitting = ref(false)
const inviteError = ref('')
const inviteResultSummary = ref('')

// Imperative track attachment state (not reactive — lives outside Vue reactivity)
let attachedLocalCameraTrack: AttachableMediaTrack | null = null
let attachedLocalScreenTrack: AttachableMediaTrack | null = null
let attachedRemoteScreenTrack: AttachableMediaTrack | null = null
let attachedPinnedTrack: AttachableMediaTrack | null = null
const attachedRemoteAudio = new Map<string, { track: AttachableMediaTrack; element: HTMLMediaElement }>()
const attachedRemoteCamera = new Map<string, { track: AttachableMediaTrack; element: HTMLVideoElement }>()

// Remote video element refs set by :ref callback in v-for
const remoteTileEls = new Map<string, HTMLVideoElement | null>()

const remoteScreenActive = ref(false)
const remoteScreenOwnerLabel = ref('Screen share')

// ── Debug ─────────────────────────────────────────────────────────────────────

const CALL_DEBUG_STORAGE_KEY = 'debug.calls'

function isCallDebugEnabled(): boolean {
  const envEnabled = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CALL_DEBUG === '1'
  if (envEnabled) return true
  try { return globalThis.localStorage?.getItem(CALL_DEBUG_STORAGE_KEY) === '1' } catch { return false }
}

function callDebug(message: string, payload?: unknown) {
  if (!isCallDebugEnabled()) return
  if (typeof payload === 'undefined') { console.info(`[call-debug] ${message}`); return }
  console.info(`[call-debug] ${message}`, payload)
}

function isScreenSource(source: unknown): boolean {
  return String(source ?? '').toLowerCase().includes('screen')
}

// ── Computed layout ───────────────────────────────────────────────────────────

const isVisible = computed(() => callStore.connected || callStore.connecting || Boolean(callStore.errorMessage))

const containerClass = computed(() =>
  maximized.value ? 'fixed inset-0 z-50' : 'fixed right-4 bottom-0 z-50 md:right-6 md:bottom-0'
)

const panelClass = computed(() =>
  maximized.value
    ? 'h-full w-full overflow-hidden rounded-none border-0 bg-slate-900/95 flex flex-col'
    : 'w-[min(96vw,640px)] overflow-hidden rounded-2xl border border-slate-600/70 bg-slate-900/95 shadow-2xl backdrop-blur'
)

const contentClass = computed(() =>
  maximized.value
    ? 'flex-1 p-3 flex flex-col gap-2 min-h-0 overflow-hidden'
    : 'flex flex-col gap-2 p-3'
)

const stageClass = computed(() =>
  // Normal: fixed height so the panel doesn't grow with tile content.
  // Maximized: flex-1 fills all remaining vertical space.
  maximized.value
    ? 'relative flex-1 min-h-0 flex flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950'
    : 'relative h-52 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950'
)

// Tile grid — explicit rows/heights in maximized mode to avoid tile overlap.
const tileGridClass = computed(() => {
  const n = participantTiles.value.length
  if (maximized.value) {
    const base = 'grid gap-2 p-3 h-full min-h-0'
    if (n <= 1) return `${base} grid-cols-1 grid-rows-1`
    if (n === 2) return `${base} grid-cols-2 grid-rows-1`
    if (n <= 4) return `${base} grid-cols-2 grid-rows-2`
    return `${base} grid-cols-3 auto-rows-[minmax(0,1fr)] overflow-y-auto content-start`
  }
  // Normal: grid fills the fixed-height stage; tiles stretch to fill rows
  const base = 'grid gap-1.5 p-1.5 h-full'
  if (n <= 1) return `${base} grid-cols-1`
  if (n === 2) return `${base} grid-cols-2`
  if (n <= 4) return `${base} grid-cols-2 grid-rows-2`
  return `${base} grid-cols-3`
})

// ── Participant tiles ─────────────────────────────────────────────────────────

const participantTiles = computed<ParticipantTile[]>(() => {
  callStore.mediaVersion // reactive dependency on topology changes

  const currentRoom = callStore.room
  const speakerSids = callStore.activeSpeakerSids

  const localName = (currentRoom?.localParticipant.name ?? '').trim()
    || authStore.user?.displayName?.trim()
    || authStore.user?.email?.trim()
    || chatStore.workspace?.selfDisplayName?.trim()
    || 'You'

  const localParticipant = currentRoom?.localParticipant
  const localCameraPub = localParticipant?.getTrackPublication(Track.Source.Camera)
  const localScreenPub = localParticipant?.getTrackPublication(Track.Source.ScreenShare)
  const localMicPub = localParticipant?.getTrackPublication(Track.Source.Microphone)

  const tiles: ParticipantTile[] = []

  tiles.push({
    sid: localParticipant?.sid ?? 'local',
    identity: localParticipant?.identity ?? '',
    name: localName,
    avatarUrl: authStore.user?.avatarUrl ?? chatStore.workspace?.selfAvatarUrl ?? '',
    isLocal: true,
    cameraOn: callStore.cameraEnabled && Boolean(localCameraPub?.track) && !localCameraPub?.isMuted,
    screenShareOn: callStore.screenShareEnabled && Boolean(localScreenPub?.track) && !localScreenPub?.isMuted,
    micOn: callStore.micEnabled && Boolean(localMicPub?.track) && !localMicPub?.isMuted,
    isSpeaking: Boolean(localParticipant && speakerSids.has(localParticipant.sid)),
  })

  if (!currentRoom) return tiles

  for (const participant of currentRoom.remoteParticipants.values()) {
    const name = (participant.name ?? '').trim()
      || chatStore.resolveDisplayName(participant.identity)
      || participant.identity.slice(0, 8)
    const cameraPub = participant.getTrackPublication(Track.Source.Camera)
    const micPub = participant.getTrackPublication(Track.Source.Microphone)

    tiles.push({
      sid: participant.sid,
      identity: participant.identity,
      name,
      avatarUrl: chatStore.resolveAvatarUrl(participant.identity),
      isLocal: false,
      cameraOn: Boolean(cameraPub?.isSubscribed && cameraPub?.track && !cameraPub?.isMuted),
      screenShareOn: false, // remote screen share is handled separately via remoteScreenActive
      micOn: Boolean(micPub?.isSubscribed && micPub?.track && !micPub?.isMuted),
      isSpeaking: speakerSids.has(participant.sid),
    })
  }

  return tiles
})

const localTile = computed(() => participantTiles.value.find(t => t.isLocal) ?? null)
const remoteTiles = computed(() => participantTiles.value.filter(t => !t.isLocal))

// Tile wrapper class — always constrained to its grid cell.
const tileItemClass = computed(() =>
  maximized.value
    ? 'group relative h-full min-h-0 overflow-hidden rounded-xl bg-slate-800'
    : 'group relative overflow-hidden rounded-xl bg-slate-800'
)

const fallbackAvatarClass = computed(() =>
  // Keep fallback avatars circular while filling most of the tile in all sizes.
  '!h-[90%] !w-auto !aspect-square !max-w-[90%]'
)

// ── Pin / fullscreen helpers ──────────────────────────────────────────────────

const pinnedTile = computed(() =>
  participantTiles.value.find(t => t.sid === pinnedSid.value) ?? null
)

const pinnedTileName = computed(() => pinnedTile.value?.name ?? '')

const pinnedTileHasVideo = computed(() => {
  const tile = pinnedTile.value
  if (!tile) return false
  return tile.cameraOn || tile.screenShareOn
})

function pinTile(sid: string) {
  pinnedSid.value = sid
}

function unpinTile() {
  // Detach the pinned track from pinnedVideoEl before clearing
  const video = unwrapEl(pinnedVideoEl.value)
  if (attachedPinnedTrack) {
    attachedPinnedTrack.detach(video ?? undefined)
    attachedPinnedTrack = null
  }
  pinnedSid.value = null
}

// ── Remote tile video element ref setter ──────────────────────────────────────

function setRemoteTileRef(sid: string, el: HTMLVideoElement | null) {
  remoteTileEls.set(sid, unwrapEl(el))
}

// ── watchEffect: runs on every mediaVersion bump ──────────────────────────────

watchEffect(() => {
  callStore.mediaVersion // reactive dependency

  syncLocalCameraTrack()
  syncLocalScreenTrack()
  syncRemoteAudioTracks()
  syncRemoteScreenTrack()
  syncRemoteCameraTracks()
  syncPinnedTrack()
})

// Re-sync pinned track whenever pinnedSid changes (not covered by mediaVersion)
watch(pinnedSid, () => {
  syncPinnedTrack()
})

// ── Local camera track ────────────────────────────────────────────────────────

function syncLocalCameraTrack() {
  const video = unwrapEl(localVideoEl.value)
  const track = callStore.localVideoTrack() as AttachableMediaTrack | null

  if (attachedLocalCameraTrack && (!track || track !== attachedLocalCameraTrack || !video)) {
    callDebug('detaching local camera track', { sid: attachedLocalCameraTrack.sid })
    attachedLocalCameraTrack.detach(video ?? undefined)
    attachedLocalCameraTrack = null
  }
  if (!video || !track) return
  if (attachedLocalCameraTrack !== track) {
    track.attach(video)
    callDebug('attached local camera track', { sid: track.sid })
    attachedLocalCameraTrack = track
  }
}

// ── Local screen share track ──────────────────────────────────────────────────

function syncLocalScreenTrack() {
  const video = unwrapEl(localScreenEl.value)
  const track = callStore.localScreenShareTrack() as AttachableMediaTrack | null

  if (attachedLocalScreenTrack && (!track || track !== attachedLocalScreenTrack || !video)) {
    callDebug('detaching local screen track', { sid: attachedLocalScreenTrack.sid })
    attachedLocalScreenTrack.detach(video ?? undefined)
    attachedLocalScreenTrack = null
  }
  if (!video || !track) return
  if (attachedLocalScreenTrack !== track) {
    track.attach(video)
    callDebug('attached local screen track', { sid: track.sid })
    attachedLocalScreenTrack = track
  }
}

// ── Remote camera tracks ──────────────────────────────────────────────────────

function syncRemoteCameraTracks() {
  const currentRoom = callStore.room
  if (!currentRoom) { detachAllRemoteCameraTracks(); return }

  const activeCameraTracks = new Map<string, AttachableMediaTrack>()
  for (const participant of currentRoom.remoteParticipants.values()) {
    // Skip: if this participant is pinned, their track goes to pinnedVideoEl instead
    if (participant.sid === pinnedSid.value) continue
    const pub = participant.getTrackPublication(Track.Source.Camera)
    if (!pub) continue
    if (!pub.isSubscribed) { pub.setSubscribed(true); continue }
    const track = pub.track as AttachableMediaTrack | null
    if (!track || track.kind !== 'video' || pub.isMuted) continue
    activeCameraTracks.set(participant.sid, track)
  }

  // Detach stale / gone tracks
  for (const [sid, attached] of attachedRemoteCamera) {
    if (activeCameraTracks.get(sid) !== attached.track) {
      callDebug('detaching stale remote camera track', { sid })
      attached.track.detach(attached.element)
      attachedRemoteCamera.delete(sid)
    }
  }

  // Attach new tracks to their tile <video> elements
  for (const [sid, track] of activeCameraTracks) {
    const videoEl = unwrapEl(remoteTileEls.get(sid) ?? null)
    if (!videoEl) continue

    const existing = attachedRemoteCamera.get(sid)
    if (existing) {
      if (existing.element === videoEl && existing.track === track) continue
      existing.track.detach(existing.element)
    }

    track.attach(videoEl)
    videoEl.autoplay = true
    videoEl.setAttribute('playsinline', 'true')
    attachedRemoteCamera.set(sid, { track, element: videoEl })
    callDebug('attached remote camera track', { sid })
    void videoEl.play().catch(() => { /* autoplay policy */ })
  }
}

function detachAllRemoteCameraTracks() {
  for (const [sid, attached] of attachedRemoteCamera) {
    callDebug('detaching remote camera track (cleanup)', { sid })
    attached.track.detach(attached.element)
    attachedRemoteCamera.delete(sid)
  }
}

// ── Remote screen share track ─────────────────────────────────────────────────

function detachRemoteScreenTrack() {
  const video = unwrapEl(remoteScreenEl.value)
  if (attachedRemoteScreenTrack) {
    callDebug('detaching remote screen track', { sid: attachedRemoteScreenTrack.sid })
    attachedRemoteScreenTrack.detach(video ?? undefined)
    attachedRemoteScreenTrack = null
  }
  remoteScreenActive.value = false
  remoteScreenOwnerLabel.value = 'Screen share'
}

function syncRemoteScreenTrack() {
  const currentRoom = callStore.room
  // remoteScreenEl is always in DOM (v-show, not v-if) so this ref is always populated
  const video = unwrapEl(remoteScreenEl.value)
  if (!currentRoom || !video) { detachRemoteScreenTrack(); return }

  let nextTrack: AttachableMediaTrack | null = null
  let owner = ''
  for (const participant of currentRoom.remoteParticipants.values()) {
    for (const publication of participant.videoTrackPublications.values()) {
      if (!isScreenSource(publication.source)) continue
      const participantId = participant.identity
      owner = participantId
        ? (chatStore.resolveDisplayName(participantId).trim() || participantId.slice(0, 8))
        : 'Teammate'
      if (!publication.isSubscribed) publication.setSubscribed(true)
      const track = publication.track as AttachableMediaTrack | null
      if (!track || track.kind !== 'video') continue
      nextTrack = track
      break
    }
    if (nextTrack) break
  }

  remoteScreenActive.value = Boolean(nextTrack)
  if (owner) remoteScreenOwnerLabel.value = `${owner} is sharing`

  if (attachedRemoteScreenTrack && attachedRemoteScreenTrack !== nextTrack) {
    callDebug('detaching stale remote screen track', { sid: attachedRemoteScreenTrack.sid })
    attachedRemoteScreenTrack.detach(video)
    attachedRemoteScreenTrack = null
  }
  if (!nextTrack || attachedRemoteScreenTrack === nextTrack) return

  nextTrack.attach(video)
  attachedRemoteScreenTrack = nextTrack
  callDebug('attached remote screen track', { sid: nextTrack.sid })
  void video.play().catch(() => { /* autoplay policy */ })
}

// ── Pinned full-stage track ───────────────────────────────────────────────────

function syncPinnedTrack() {
  const sid = pinnedSid.value
  const video = unwrapEl(pinnedVideoEl.value)

  // If nothing is pinned, detach and bail
  if (!sid) {
    if (attachedPinnedTrack) {
      attachedPinnedTrack.detach(video ?? undefined)
      attachedPinnedTrack = null
    }
    return
  }

  // Determine which track should fill the pinned view
  let nextTrack: AttachableMediaTrack | null = null
  const localSid = localTile.value?.sid

  if (sid === localSid) {
    // Local participant — prefer screen share over camera
    if (callStore.screenShareEnabled) {
      nextTrack = callStore.localScreenShareTrack() as AttachableMediaTrack | null
    }
    if (!nextTrack && callStore.cameraEnabled) {
      nextTrack = callStore.localVideoTrack() as AttachableMediaTrack | null
    }
  } else {
    const currentRoom = callStore.room
    if (currentRoom) {
      const participant = Array.from(currentRoom.remoteParticipants.values()).find(p => p.sid === sid)
      if (participant) {
        const pub = participant.getTrackPublication(Track.Source.Camera)
        if (pub?.isSubscribed && pub.track && !pub.isMuted) {
          nextTrack = pub.track as AttachableMediaTrack | null
        }
      }
    }
  }

  if (!video) return

  // Detach stale pinned track
  if (attachedPinnedTrack && attachedPinnedTrack !== nextTrack) {
    attachedPinnedTrack.detach(video)
    attachedPinnedTrack = null
  }
  if (!nextTrack || attachedPinnedTrack === nextTrack) return

  nextTrack.attach(video)
  attachedPinnedTrack = nextTrack
  callDebug('attached pinned track', { sid, trackSid: nextTrack.sid })
  void video.play().catch(() => { /* autoplay policy */ })
}

// ── Remote audio tracks ───────────────────────────────────────────────────────

function syncRemoteAudioTracks() {
  const host = remoteAudioHostEl.value
  const currentRoom = callStore.room
  if (!host || !currentRoom) { detachAllRemoteAudioTracks(); return }

  const activeTracks = new Map<string, AttachableMediaTrack>()
  for (const participant of currentRoom.remoteParticipants.values()) {
    for (const publication of participant.audioTrackPublications.values()) {
      const track = publication.track as AttachableMediaTrack | null
      if (!track || track.kind !== 'audio') continue
      activeTracks.set(track.sid, track)
    }
  }

  for (const [sid, attached] of attachedRemoteAudio) {
    if (activeTracks.get(sid) !== attached.track) {
      callDebug('detaching stale remote audio', { sid })
      attached.track.detach(attached.element)
      attached.element.remove()
      attachedRemoteAudio.delete(sid)
    }
  }

  for (const [sid, track] of activeTracks) {
    if (attachedRemoteAudio.has(sid)) continue
    const element = track.attach()
    element.autoplay = true
    element.muted = false
    element.volume = 1
    element.setAttribute('playsinline', 'true')
    element.style.opacity = '0'
    element.style.width = '1px'
    element.style.height = '1px'
    host.appendChild(element)
    attachedRemoteAudio.set(sid, { track, element })
    callDebug('attached remote audio', { sid })
    void element.play().catch(async () => {
      try { await currentRoom.startAudio(); await element.play() } catch { /* best effort */ }
    })
  }
}

function detachAllRemoteAudioTracks() {
  for (const [sid, attached] of attachedRemoteAudio) {
    callDebug('detaching remote audio (cleanup)', { sid })
    attached.track.detach(attached.element)
    attached.element.remove()
    attachedRemoteAudio.delete(sid)
  }
}

// ── Cleanup on unmount ────────────────────────────────────────────────────────

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleEscapeKey)

  const localVid = unwrapEl(localVideoEl.value)
  const localScr = unwrapEl(localScreenEl.value)
  const pinnedVid = unwrapEl(pinnedVideoEl.value)

  if (attachedLocalCameraTrack) {
    attachedLocalCameraTrack.detach(localVid ?? undefined)
    attachedLocalCameraTrack = null
  }
  if (attachedLocalScreenTrack) {
    attachedLocalScreenTrack.detach(localScr ?? undefined)
    attachedLocalScreenTrack = null
  }
  if (attachedPinnedTrack) {
    attachedPinnedTrack.detach(pinnedVid ?? undefined)
    attachedPinnedTrack = null
  }
  detachRemoteScreenTrack()
  detachAllRemoteAudioTracks()
  detachAllRemoteCameraTracks()
})

// ── Maximize / minimize ───────────────────────────────────────────────────────

watch(() => callStore.minimized, (value) => {
  if (value) maximized.value = false
})

function handleEscapeKey(evt: KeyboardEvent) {
  if (evt.key !== 'Escape') return
  if (inviteDialogOpen.value) {
    closeInviteDialog()
    return
  }
  if (maximized.value) {
    maximized.value = false
  }
}

watch([maximized, inviteDialogOpen], ([isMaximized, isInviteOpen]) => {
  const shouldListen = isMaximized || isInviteOpen
  document.removeEventListener('keydown', handleEscapeKey)
  if (shouldListen) {
    document.addEventListener('keydown', handleEscapeKey)
  }
})

function toggleMaximized() {
  maximized.value = !maximized.value
}

function closeInviteDialog() {
  inviteDialogOpen.value = false
}

function activeCallParticipantIds(): Set<string> {
  const ids = new Set<string>()
  const selfUserId = authStore.user?.id ?? chatStore.workspace?.selfUserId ?? ''
  if (selfUserId) ids.add(selfUserId)
  const currentRoom = callStore.room
  if (!currentRoom) return ids
  if (currentRoom.localParticipant.identity) {
    ids.add(currentRoom.localParticipant.identity)
  }
  for (const participant of currentRoom.remoteParticipants.values()) {
    if (participant.identity) ids.add(participant.identity)
  }
  return ids
}

function toInviteCandidate(member: DmCandidateItem): InviteCandidate {
  return {
    userId: member.user_id,
    displayName: member.display_name,
    email: member.email,
    avatarUrl: member.avatar_url,
  }
}

async function openInviteDialog() {
  inviteDialogOpen.value = true
  inviteLoading.value = true
  inviteError.value = ''
  inviteResultSummary.value = ''
  selectedInviteeIds.value = []

  const conversationId = callStore.activeConversationId
  if (!conversationId) {
    inviteLoading.value = false
    inviteError.value = 'No active call conversation.'
    inviteCandidates.value = []
    return
  }

  try {
    const members = await listDmCandidates()
    const inCall = activeCallParticipantIds()
    inviteCandidates.value = members
      .filter(member => member.user_id && !inCall.has(member.user_id))
      .map(toInviteCandidate)
  } catch (err) {
    inviteCandidates.value = []
    inviteError.value = err instanceof Error ? err.message : 'Failed to load members'
  } finally {
    inviteLoading.value = false
  }
}

function toggleInviteCandidate(userId: string) {
  if (selectedInviteeIds.value.includes(userId)) {
    selectedInviteeIds.value = selectedInviteeIds.value.filter(id => id !== userId)
    return
  }
  selectedInviteeIds.value = [...selectedInviteeIds.value, userId]
}

async function sendCallInvites() {
  if (!selectedInviteeIds.value.length) return
  inviteSubmitting.value = true
  inviteError.value = ''
  inviteResultSummary.value = ''
  const requestIds = [...selectedInviteeIds.value]
  try {
    const result = await callStore.inviteMembersToActiveCall(requestIds)
    const invitedCount = result.invitedUserIds.length
    const skippedCount = result.skippedUserIds.length
    inviteResultSummary.value = `Invited ${invitedCount}. Skipped ${skippedCount}.`

    const consumed = new Set([...result.invitedUserIds, ...result.skippedUserIds])
    if (consumed.size > 0) {
      inviteCandidates.value = inviteCandidates.value.filter(candidate => !consumed.has(candidate.userId))
      selectedInviteeIds.value = selectedInviteeIds.value.filter(id => !consumed.has(id))
    }
    closeInviteDialog()
  } catch (err) {
    inviteError.value = err instanceof Error ? err.message : 'Failed to send call invites'
  } finally {
    inviteSubmitting.value = false
  }
}

// ── Control handlers ──────────────────────────────────────────────────────────

async function handleToggleMute() {
  try { await callStore.toggleMute() } catch { /* best effort */ }
}

async function handleToggleCamera() {
  try { await callStore.toggleCamera() } catch { /* best effort */ }
}

async function handleToggleScreenShare() {
  try { await callStore.toggleScreenShare() } catch { /* best effort */ }
}

async function handleLeave() {
  await callStore.leaveCall()
  maximized.value = false
  pinnedSid.value = null
  inviteDialogOpen.value = false
}

function handleMinimize() {
  maximized.value = false
  callStore.toggleMinimized()
}

async function handleEnableAudio() {
  try { await callStore.enableAudioPlayback() } catch { /* best effort */ }
}
</script>
