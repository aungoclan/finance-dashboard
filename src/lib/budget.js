import { DEFAULT_APP_SETTINGS, normalizeSettings } from './appSettings'
import { getCategoryDisplayName, normalizeCategoryName } from './cashflowCategories'

export function pad2(value) {
  return String(value).padStart(2, '0')
}

export function formatMonthKey(year, month) {
  return `${year}-${pad2(month)}`
}

export function parseMonthKey(monthKey) {
  const [yearText, monthText] = String(monthKey || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    const now = new Date()

    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1
    }
  }

  return { year, month }
}

export function getCurrentMonthInfo() {
  const now = new Date()

  return {
    month: now.getMonth() + 1,
    year: now.getFullYear()
  }
}

export function getCurrentMonthKey() {
  const now = new Date()
  return formatMonthKey(now.getFullYear(), now.getMonth() + 1)
}

export function shiftMonthKey(monthKey, offset) {
  const { year, month } = parseMonthKey(monthKey)
  const shifted = new Date(year, month - 1 + offset, 1)

  return formatMonthKey(shifted.getFullYear(), shifted.getMonth() + 1)
}

export function getMonthDateRange(monthKey) {
  const { year, month } = parseMonthKey(monthKey)

  return {
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${shiftMonthKey(monthKey, 1)}-01`,
    month,
    year
  }
}

export function getMonthLabel(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const date = new Date(year, month - 1, 1)

  return date.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  })
}

export function toMoneyNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

export function getCategoryTextKey(record) {
  return `text:${normalizeCategoryName(getCategoryDisplayName(record)) || 'uncategorized'}`
}

export function getCategoryIdKey(record) {
  return record?.category_id ? `id:${record.category_id}` : ''
}

export function getCategoryKeys(record) {
  const keys = new Set()

  const idKey = getCategoryIdKey(record)
  if (idKey) keys.add(idKey)

  keys.add(getCategoryTextKey(record))

  return [...keys]
}

export function getPrimaryCategoryKey(record) {
  return getCategoryIdKey(record) || getCategoryTextKey(record)
}

export function getBudgetStatus({ planned, usagePercent, settings = DEFAULT_APP_SETTINGS }) {
  const normalized = normalizeSettings(settings)

  if (planned > 0 && usagePercent > normalized.budgetDangerPercent) {
    return 'Over Budget'
  }

  if (planned > 0 && usagePercent === normalized.budgetDangerPercent) {
    return 'At Limit'
  }

  if (planned > 0 && usagePercent >= normalized.budgetWarningPercent) {
    return 'Near Limit'
  }

  return 'On Track'
}

export function calculateActualByCategory(cashflowEntries = []) {
  const expenseEntries = cashflowEntries.filter((entry) => entry.type === 'expense')
  const actualByCategory = {}

  for (const entry of expenseEntries) {
    const amount = toMoneyNumber(entry.amount)
    const keys = getCategoryKeys(entry)

    for (const key of keys) {
      actualByCategory[key] = toMoneyNumber((actualByCategory[key] || 0) + amount)
    }
  }

  return actualByCategory
}

export function calculateBudgetSummary(
  budgets = [],
  cashflowEntries = [],
  settings = DEFAULT_APP_SETTINGS
) {
  const normalizedSettings = normalizeSettings(settings)
  const actualByCategory = calculateActualByCategory(cashflowEntries)

  const rows = budgets.map((budget) => {
    const category = getCategoryDisplayName(budget)
    const primaryKey = getPrimaryCategoryKey(budget)
    const textKey = getCategoryTextKey(budget)
    const planned = toMoneyNumber(budget.planned_amount)

    let actual = toMoneyNumber(actualByCategory[primaryKey])

    if (actual === 0 && textKey !== primaryKey) {
      actual = toMoneyNumber(actualByCategory[textKey])
    }

    const remaining = toMoneyNumber(planned - actual)
    const usagePercent = planned > 0 ? (actual / planned) * 100 : 0
    const status = getBudgetStatus({
      planned,
      usagePercent,
      settings: normalizedSettings
    })

    return {
      id: budget.id,
      category,
      category_id: budget.category_id || null,
      categoryKey: primaryKey,
      planned,
      actual,
      remaining,
      usagePercent,
      status,
      raw: budget
    }
  })

  const totalPlanned = rows.reduce((sum, row) => sum + row.planned, 0)
  const totalActual = rows.reduce((sum, row) => sum + row.actual, 0)
  const totalRemaining = totalPlanned - totalActual
  const overallUsagePercent = totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0

  return {
    rows,
    totalPlanned,
    totalActual,
    totalRemaining,
    overallUsagePercent,
    budgetWarningPercent: normalizedSettings.budgetWarningPercent,
    budgetDangerPercent: normalizedSettings.budgetDangerPercent
  }
}

export function buildBudgetLookup(budgets = []) {
  const map = new Map()

  for (const budget of budgets) {
    const keys = getCategoryKeys(budget)

    for (const key of keys) {
      if (!map.has(key)) {
        map.set(key, budget)
      }
    }
  }

  return map
}

export function getCarryForwardAdjustment(previousRemaining, mode = 'both') {
  const amount = toMoneyNumber(previousRemaining)

  if (mode === 'surplus_only') {
    return amount > 0 ? amount : 0
  }

  if (mode === 'overspend_only') {
    return amount < 0 ? amount : 0
  }

  if (mode === 'both') {
    return amount
  }

  return 0
}

export function buildCarryForwardRows({
  previousBudgets = [],
  previousCashflowEntries = [],
  currentBudgets = [],
  mode = 'both',
  minCarryAmount = 1,
  settings = DEFAULT_APP_SETTINGS
}) {
  const previousSummary = calculateBudgetSummary(
    previousBudgets,
    previousCashflowEntries,
    settings
  )

  const currentBudgetMap = buildBudgetLookup(currentBudgets)
  const minAmount = Math.max(toMoneyNumber(minCarryAmount), 0)

  return previousSummary.rows.map((previousRow) => {
    const previousBudget = previousRow.raw
    const primaryKey = getPrimaryCategoryKey(previousBudget)
    const textKey = getCategoryTextKey(previousBudget)
    const currentBudget = currentBudgetMap.get(primaryKey) || currentBudgetMap.get(textKey) || null

    const currentPlanned = toMoneyNumber(currentBudget?.planned_amount)
    const rawAdjustment = getCarryForwardAdjustment(previousRow.remaining, mode)
    const adjustment =
      Math.abs(rawAdjustment) >= minAmount ? toMoneyNumber(rawAdjustment) : 0

    const suggestedNewPlanned = Math.max(toMoneyNumber(currentPlanned + adjustment), 0)

    let carryStatus = 'No Carry'
    let tone = 'neutral'

    if (previousRow.remaining > 0) {
      carryStatus = 'Surplus'
      tone = 'good'
    }

    if (previousRow.remaining < 0) {
      carryStatus = 'Overspent'
      tone = 'danger'
    }

    if (adjustment === 0) {
      carryStatus = 'Below Threshold'
      tone = 'neutral'
    }

    if (!currentBudget && adjustment !== 0) {
      carryStatus = 'Create Current Budget'
      tone = 'warning'
    }

    return {
      key: primaryKey || textKey,
      category: previousRow.category,
      category_id: previousBudget.category_id || null,
      previousBudgetId: previousBudget.id,
      currentBudgetId: currentBudget?.id || null,
      previousPlanned: previousRow.planned,
      previousActual: previousRow.actual,
      previousRemaining: previousRow.remaining,
      currentPlanned,
      adjustment,
      suggestedNewPlanned,
      canApply: adjustment !== 0,
      carryStatus,
      tone,
      rawPreviousBudget: previousBudget,
      rawCurrentBudget: currentBudget
    }
  })
}

export function summarizeCarryForwardRows(rows = []) {
  const eligibleRows = rows.filter((row) => row.canApply)
  const surplusRows = rows.filter((row) => row.previousRemaining > 0 && row.canApply)
  const overspentRows = rows.filter((row) => row.previousRemaining < 0 && row.canApply)
  const createRows = rows.filter((row) => !row.currentBudgetId && row.canApply)

  const totalAdjustment = eligibleRows.reduce((sum, row) => sum + toMoneyNumber(row.adjustment), 0)
  const totalSurplus = surplusRows.reduce((sum, row) => sum + toMoneyNumber(row.adjustment), 0)
  const totalOverspend = overspentRows.reduce((sum, row) => sum + toMoneyNumber(row.adjustment), 0)

  return {
    totalRows: rows.length,
    eligibleRows: eligibleRows.length,
    surplusRows: surplusRows.length,
    overspentRows: overspentRows.length,
    createRows: createRows.length,
    totalAdjustment,
    totalSurplus,
    totalOverspend
  }
}

export function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

export function formatPercent(value) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`
}