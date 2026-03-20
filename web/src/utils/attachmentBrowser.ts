export async function openBlobInBrowser(loadBlob: () => Promise<Blob>): Promise<void> {
  const opened = window.open('about:blank', '_blank')
  if (!opened) {
    throw new Error('Popup blocked. Allow pop-ups to open attachments.')
  }

  try {
    opened.opener = null
  } catch {
    // Ignore browsers that expose opener as read-only.
  }

  try {
    const blob = await loadBlob()
    const url = URL.createObjectURL(blob)

    opened.location.replace(url)

    window.setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1_000)
  } catch (error) {
    opened?.close()
    throw error
  }
}
