import { getCategoryDisplayName } from './cashflowCategories'

export function getCurrentMonthDateRange() {
  const now = new Date()

  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  return {
    startDate: formatDateForInput(start),
    endDate: formatDateForInput(end)
  }
}

export function formatDateForInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function calculateCashflowSummary(entries = []) {
  const totalIncome = entries
    .filter((item) => item.type === 'income')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0)

  const totalExpenses = entries
    .filter((item) => item.type === 'expense')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0)

  const netCashflow = totalIncome - totalExpenses

  return {
    totalIncome,
    totalExpenses,
    netCashflow
  }
}

export function calculateCategorySummary(entries = [], entryType = 'expense') {
  const filtered = entries.filter((item) => item.type === entryType)

  const map = {}

  for (const entry of filtered) {
    const category = getCategoryDisplayName(entry)
    const amount = Number(entry.amount || 0)

    if (!map[category]) {
      map[category] = 0
    }

    map[category] += amount
  }

  return Object.entries(map)
    .map(([category, total]) => ({
      category,
      total
    }))
    .sort((a, b) => b.total - a.total)
}

export function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}