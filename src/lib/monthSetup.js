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

export function getCurrentMonthKey() {
  const now = new Date()
  return formatMonthKey(now.getFullYear(), now.getMonth() + 1)
}

export function getNextMonthKey(baseDate = new Date()) {
  const next = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1)
  return formatMonthKey(next.getFullYear(), next.getMonth() + 1)
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
    endDate: shiftMonthKey(monthKey, 1) + '-01',
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

export function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

export function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

export function toMoneyNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

export function getTodayKey() {
  return new Date().toISOString().slice(0, 10)
}

export function getSafeDueDate(monthKey, dueDay) {
  const { year, month } = parseMonthKey(monthKey)
  const requestedDay = Number(dueDay || 1)
  const safeRequestedDay = Math.min(
    Math.max(Number.isFinite(requestedDay) ? requestedDay : 1, 1),
    31
  )
  const lastDay = new Date(year, month, 0).getDate()
  const day = Math.min(safeRequestedDay, lastDay)

  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function getBillDescription(bill) {
  const name = String(bill?.name || '').trim()
  return name ? `Bill: ${name}` : 'Bill'
}

export function getBillCashflowCategory(bill) {
  const category = String(bill?.cashflow_categories?.name || bill?.category || '').trim()
  return category || ''
}

export function getBillAccountLabel(accountId, accounts = []) {
  if (!accountId) return 'No account selected'

  const account = accounts.find((item) => item.id === accountId)
  if (!account) return 'Unknown account'

  return `${account.name}${account.account_type ? ` (${account.account_type})` : ''}`
}

export function getBudgetCategoryMap(budgets = []) {
  const map = new Map()

  for (const budget of budgets) {
    const key = normalizeText(budget.category)
    if (!key) continue
    map.set(key, budget)
  }

  return map
}

export function getCashflowBillMatchKey(entry) {
  return [
    entry.entry_date || '',
    normalizeText(entry.type || 'expense'),
    normalizeText(entry.description || ''),
    toMoneyNumber(entry.amount).toFixed(2)
  ].join('|')
}

export function getBillCashflowMatchKey(bill, targetMonthKey) {
  return [
    getSafeDueDate(targetMonthKey, bill.due_day),
    'expense',
    normalizeText(getBillDescription(bill)),
    toMoneyNumber(bill.amount).toFixed(2)
  ].join('|')
}

export function getMissingBudgetRows(previousBudgets = [], targetBudgets = []) {
  const targetMap = getBudgetCategoryMap(targetBudgets)

  return previousBudgets.filter((budget) => {
    const key = normalizeText(budget.category)
    return key && !targetMap.has(key)
  })
}

export function getActiveMonthlyBills(bills = []) {
  return bills.filter((bill) => {
    const status = normalizeText(bill.status || 'active')
    const frequency = normalizeText(bill.frequency || 'monthly')

    return status === 'active' && frequency === 'monthly'
  })
}

export function getBillTimingStatus({ entryDate, todayKey = getTodayKey(), dueSoonDays = 7 }) {
  const due = new Date(`${entryDate}T00:00:00`)
  const today = new Date(`${todayKey}T00:00:00`)

  if (Number.isNaN(due.getTime()) || Number.isNaN(today.getTime())) {
    return {
      label: 'Review date',
      tone: 'warning',
      daysUntilDue: null
    }
  }

  const daysUntilDue = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (daysUntilDue < 0) {
    return {
      label: `${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? '' : 's'} past due`,
      tone: 'danger',
      daysUntilDue
    }
  }

  if (daysUntilDue === 0) {
    return {
      label: 'Due today',
      tone: 'danger',
      daysUntilDue
    }
  }

  if (daysUntilDue <= Number(dueSoonDays || 7)) {
    return {
      label: `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`,
      tone: 'warning',
      daysUntilDue
    }
  }

  return {
    label: `Due in ${daysUntilDue} days`,
    tone: 'default',
    daysUntilDue
  }
}

export function getBillSetupRows({
  bills = [],
  cashflowEntries = [],
  targetMonthKey,
  dueSoonDays = 7,
  billAccountMap = {}
}) {
  const existingKeys = new Set(cashflowEntries.map(getCashflowBillMatchKey))

  return bills.map((bill) => {
    const amount = toMoneyNumber(bill.amount)
    const entryDate = getSafeDueDate(targetMonthKey, bill.due_day)
    const category = getBillCashflowCategory(bill)
    const description = getBillDescription(bill)
    const matchKey = getBillCashflowMatchKey(bill, targetMonthKey)
    const alreadyAdded = existingKeys.has(matchKey)
    const missingAmount = amount <= 0
    const missingCategory = !category
    const needsCategoryId = !bill.category_id
    const selectedAccountId = billAccountMap[bill.id] || ''
   const rawTiming = getBillTimingStatus({
  entryDate,
  todayKey: getTodayKey(),
  dueSoonDays
})

const timing = alreadyAdded
  ? {
      label: 'Posted',
      tone: 'posted',
      daysUntilDue: rawTiming.daysUntilDue
    }
  : rawTiming

    let reason = 'Ready'
    let status = 'ready'
    let canAdd = true

    if (alreadyAdded) {
      status = 'added'
      reason = 'Already Added'
      canAdd = false
    } else if (missingAmount) {
      status = 'blocked'
      reason = 'Missing Amount'
      canAdd = false
    } else if (missingCategory) {
      status = 'blocked'
      reason = 'Missing Category'
      canAdd = false
    } else if (needsCategoryId) {
      status = 'review'
      reason = 'Category Review'
      canAdd = false
    }

    return {
      bill,
      amount,
      entryDate,
      category,
      description,
      matchKey,
      selectedAccountId,
      alreadyAdded,
      missingAmount,
      missingCategory,
      needsCategoryId,
      canAdd,
      status,
      reason,
      timing
    }
  })
}

export function summarizeBillRows(billRows = []) {
  return {
    total: billRows.length,
    ready: billRows.filter((row) => row.status === 'ready').length,
    added: billRows.filter((row) => row.status === 'added').length,
    blocked: billRows.filter((row) => row.status === 'blocked').length,
    review: billRows.filter((row) => row.status === 'review').length,
    dueSoon: billRows.filter((row) => row.timing?.tone === 'warning').length,
    pastDue: billRows.filter((row) => row.timing?.tone === 'danger').length,
    amountReady: billRows
      .filter((row) => row.status === 'ready')
      .reduce((sum, row) => sum + toMoneyNumber(row.amount), 0),
    amountAdded: billRows
      .filter((row) => row.status === 'added')
      .reduce((sum, row) => sum + toMoneyNumber(row.amount), 0),
    amountBlocked: billRows
      .filter((row) => row.status === 'blocked' || row.status === 'review')
      .reduce((sum, row) => sum + toMoneyNumber(row.amount), 0)
  }
}

export function summarizeCashflow(entries = []) {
  const income = entries
    .filter((entry) => entry.type === 'income')
    .reduce((sum, entry) => sum + toMoneyNumber(entry.amount), 0)

  const expense = entries
    .filter((entry) => entry.type === 'expense')
    .reduce((sum, entry) => sum + toMoneyNumber(entry.amount), 0)

  return {
    income,
    expense,
    net: income - expense,
    incomeCount: entries.filter((entry) => entry.type === 'income').length,
    expenseCount: entries.filter((entry) => entry.type === 'expense').length
  }
}

export function getCategoryHealth({ targetBudgets = [], targetCashflowEntries = [] }) {
  const budgetCategories = new Set(
    targetBudgets.map((budget) => normalizeText(budget.category)).filter(Boolean)
  )

  const expenseCategories = new Set(
    targetCashflowEntries
      .filter((entry) => entry.type === 'expense')
      .map((entry) => normalizeText(entry.category || 'Uncategorized'))
      .filter(Boolean)
  )

  const expensesWithoutBudget = [...expenseCategories].filter(
    (category) => !budgetCategories.has(category)
  )

  const budgetsWithoutExpense = [...budgetCategories].filter(
    (category) => !expenseCategories.has(category)
  )

  return {
    expensesWithoutBudget,
    budgetsWithoutExpense
  }
}

export function buildBudgetInsertRows({ userId, targetMonthKey, missingBudgets = [] }) {
  const { year, month } = parseMonthKey(targetMonthKey)

  return missingBudgets.map((budget) => ({
    user_id: userId,
    month,
    year,
    category_id: budget.category_id || null,
    category: String(budget.cashflow_categories?.name || budget.category || '').trim(),
    planned_amount: toMoneyNumber(budget.planned_amount)
  }))
}

export function buildBillCashflowInsertRows({
  userId,
  targetMonthKey,
  billRows = [],
  billAccountMap = {}
}) {
  return billRows
    .filter((row) => row.canAdd)
    .map((row) => ({
      user_id: userId,
      account_id: billAccountMap[row.bill.id] || null,
      entry_date: row.entryDate || getSafeDueDate(targetMonthKey, row.bill.due_day),
      type: 'expense',
      amount: toMoneyNumber(row.amount),
      category_id: row.bill.category_id || null,
      category: row.category,
      description: row.description
    }))
}