// Per-window write barrier; independent of React and of authentication.
let updating = false
let participant: { pause: () => Promise<void>; resume: () => void } | undefined
export function assertNotUpdating() {
  if (updating) throw new Error('Mise à jour en cours. Attendez la réouverture du carnet.')
}
export function registerUpdateParticipant(value: NonNullable<typeof participant>) {
  participant = value
  return () => { if (participant === value) participant = undefined }
}
export async function pauseForUpdate() {
  updating = true
  await participant?.pause()
}
export function cancelUpdate() { updating = false; participant?.resume() }
