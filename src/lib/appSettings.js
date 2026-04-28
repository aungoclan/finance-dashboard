import { supabase } from './supabase'

export const DEFAULT_APP_SETTINGS = {
  defaultCurrency: 'USD',
  defaultAccountId: '',
  defaultImportAccountId: '',

  billDueSoonDays: 7,

  budgetWarningPercent: 80,
  budgetDangerPercent: 100,

  portfolioConcentrationThreshold: 50,
  cryptoAllocationWarningPercent: 70,

  stalePriceDays: 2,

  moneyPlanDefaultMode: 'balanced',

  dashboardSnapshotEnabled: true,
  showArchivedAccounts: false,
  compactDashboard: false
}

export function mergeSettings(settings) {
  return {
    ...DEFAULT_APP_SETTINGS,
    ...(settings && typeof settings === 'object' ? settings : {})
  }
}

export function normalizeSettings(settings) {
  const merged = mergeSettings(settings)

  return {
    ...merged,

    defaultCurrency: String(merged.defaultCurrency || 'USD').trim().toUpperCase(),
    defaultAccountId: String(merged.defaultAccountId || ''),
    defaultImportAccountId: String(merged.defaultImportAccountId || ''),

    billDueSoonDays: clampNumber(
      merged.billDueSoonDays,
      1,
      60,
      DEFAULT_APP_SETTINGS.billDueSoonDays
    ),

    budgetWarningPercent: clampNumber(
      merged.budgetWarningPercent,
      1,
      300,
      DEFAULT_APP_SETTINGS.budgetWarningPercent
    ),

    budgetDangerPercent: clampNumber(
      merged.budgetDangerPercent,
      1,
      500,
      DEFAULT_APP_SETTINGS.budgetDangerPercent
    ),

    portfolioConcentrationThreshold: clampNumber(
      merged.portfolioConcentrationThreshold,
      1,
      100,
      DEFAULT_APP_SETTINGS.portfolioConcentrationThreshold
    ),

    cryptoAllocationWarningPercent: clampNumber(
      merged.cryptoAllocationWarningPercent,
      1,
      100,
      DEFAULT_APP_SETTINGS.cryptoAllocationWarningPercent
    ),

    stalePriceDays: clampNumber(
      merged.stalePriceDays,
      1,
      30,
      DEFAULT_APP_SETTINGS.stalePriceDays
    ),

    moneyPlanDefaultMode: ['conservative', 'balanced', 'aggressive'].includes(
      String(merged.moneyPlanDefaultMode)
    )
      ? String(merged.moneyPlanDefaultMode)
      : DEFAULT_APP_SETTINGS.moneyPlanDefaultMode,

    dashboardSnapshotEnabled: Boolean(merged.dashboardSnapshotEnabled),
    showArchivedAccounts: Boolean(merged.showArchivedAccounts),
    compactDashboard: Boolean(merged.compactDashboard)
  }
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

export async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return data?.user?.id || null
}

export async function loadUserSettings() {
  const userId = await getCurrentUserId()
  if (!userId) return normalizeSettings(DEFAULT_APP_SETTINGS)

  const { data, error } = await supabase
    .from('user_settings')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error

  return normalizeSettings(data?.settings || DEFAULT_APP_SETTINGS)
}

export async function saveUserSettings(settings) {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be logged in to save settings.')

  const normalized = normalizeSettings(settings)

  const { error } = await supabase
    .from('user_settings')
    .upsert(
      {
        user_id: userId,
        settings: normalized,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    )

  if (error) throw error
  return normalized
}

export function shouldWarnBudget(usagePercent, settings) {
  const normalized = normalizeSettings(settings)
  return Number(usagePercent || 0) >= normalized.budgetWarningPercent
}

export function shouldDangerBudget(usagePercent, settings) {
  const normalized = normalizeSettings(settings)
  return Number(usagePercent || 0) >= normalized.budgetDangerPercent
}

export function isDueSoon(daysUntilDue, settings) {
  const normalized = normalizeSettings(settings)
  return Number(daysUntilDue) <= normalized.billDueSoonDays
}

export function isStalePrice(daysOld, settings) {
  const normalized = normalizeSettings(settings)
  return Number(daysOld) > normalized.stalePriceDays
}

export function isPortfolioConcentrated(weightPercent, settings) {
  const normalized = normalizeSettings(settings)
  return Number(weightPercent || 0) >= normalized.portfolioConcentrationThreshold
}

export function isCryptoAllocationHigh(weightPercent, settings) {
  const normalized = normalizeSettings(settings)
  return Number(weightPercent || 0) >= normalized.cryptoAllocationWarningPercent
}