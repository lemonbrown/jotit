const NOTES_KEY = 'jotit_notes'
const SETTINGS_KEY = 'jotit_settings'

export function loadNotes() {
  try {
    const data = localStorage.getItem(NOTES_KEY)
    if (!data) return null
    const notes = JSON.parse(data)
    // Migrate old notes that had a separate title field
    return notes.map(n => {
      if (!n.title) return n
      const { title, ...rest } = n
      if (title && !rest.content.startsWith(title)) {
        rest.content = title + (rest.content ? '\n' + rest.content : '')
      }
      return rest
    })
  } catch {
    return null
  }
}

export function saveNotes(notes) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
  } catch {}
}

const SETTINGS_DEFAULTS = {
  serverProxy: false,
  localAgentToken: '',
  bucketName: '',
  theme: 'dark',
  secretScanEnabled: false,
  secretScanBlockSync: false,
  syncEnabled: true,
}

export function loadSettings() {
  try {
    const data = localStorage.getItem(SETTINGS_KEY)
    return data ? { ...SETTINGS_DEFAULTS, ...JSON.parse(data) } : { ...SETTINGS_DEFAULTS }
  } catch {
    return { ...SETTINGS_DEFAULTS }
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {}
}
