export interface SoundEngine {
  playMessagePing(): Promise<void>
  startCallInviteRing(): Promise<void>
  stopCallInviteRing(): void
  dispose(): void
}
