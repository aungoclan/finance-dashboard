export const APP_THEME_STORAGE_KEY = 'finance-dashboard-ui-theme'

export const DEFAULT_UI_THEME = 'dark'

export const UI_THEME_OPTIONS = [
  {
    value: 'dark',
    label: 'Dark Classic',
    description: 'Current dark dashboard style. Safest default.'
  },
  {
    value: 'light',
    label: 'Light Pro',
    description: 'Bright white and blue professional theme.'
  },
  {
    value: 'blueGray',
    label: 'Blue Gray',
    description: 'Soft blue-gray light theme with calm financial dashboard tone.'
  },
  {
    value: 'emerald',
    label: 'Emerald Dark',
    description: 'Premium dark theme with emerald / teal accents.'
  },
  {
    value: 'sand',
    label: 'Premium Sand',
    description: 'Warm beige and muted gold theme.'
  }
]

const VALID_THEME_VALUES = new Set(UI_THEME_OPTIONS.map((theme) => theme.value))

export function normalizeTheme(theme) {
  const value = String(theme || '').trim()
  return VALID_THEME_VALUES.has(value) ? value : DEFAULT_UI_THEME
}

export function getThemeOption(theme) {
  const normalized = normalizeTheme(theme)
  return UI_THEME_OPTIONS.find((option) => option.value === normalized) || UI_THEME_OPTIONS[0]
}

export function loadLocalTheme() {
  if (typeof window === 'undefined') return DEFAULT_UI_THEME

  try {
    return normalizeTheme(window.localStorage.getItem(APP_THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_UI_THEME
  }
}

export function applyTheme(theme) {
  const normalized = normalizeTheme(theme)

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = normalized
    document.documentElement.style.colorScheme =
      normalized === 'dark' || normalized === 'emerald' ? 'dark' : 'light'
  }

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, normalized)
    } catch {
      // localStorage can be unavailable in private or restricted browsing modes.
    }
  }

  return normalized
}