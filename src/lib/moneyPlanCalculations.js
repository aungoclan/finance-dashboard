import { getCategoryDisplayName, normalizeCategoryName } from './cashflowCategories'

const CASH_ACCOUNT_TYPES = ['cash', 'checking', 'savings', 'business']
const DEFAULT_ALLOCATION_MODES = {
  balanced: {
    buffer: 25,
    debt: 25,
    goals: 25,
    investment: 25
  }
}

export function toNumber(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

export function getTodayKey() {
  return new Date().toISOString().slice(0, 10)
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function getFallbackMonthInfo() {
  const now = new Date()
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    monthIndex: now.getMonth()
  }
}

function normalizeMonthInfo(monthInfo) {
  const fallback = getFallbackMonthInfo()
  const year = Number(monthInfo?.year)
  const month = Number(monthInfo?.month)
  const monthIndex = Number(monthInfo?.monthIndex)
  const safeMonth = Number.isInteger(month) && month >= 1 && month <= 12 ? month : fallback.month

  return {
    year: Number.isInteger(year) ? year : fallback.year,
    month: safeMonth,
    monthIndex: Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex <= 11
      ? monthIndex
      : safeMonth - 1
  }
}

function getSafeTodayDate(today) {
  if (today instanceof Date && !Number.isNaN(today.getTime())) return today
  return new Date(`${getTodayKey()}T00:00:00`)
}

export function getMonthKey(monthInfo) {
  const safeMonthInfo = normalizeMonthInfo(monthInfo)
  return `${safeMonthInfo.year}-${String(safeMonthInfo.month).padStart(2, '0')}`
}

export function getPreviousMonthKey(monthInfo) {
  return addMonthsToMonthKey(getMonthKey(monthInfo), -1)
}

function parseMonthKey(monthKey) {
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

function formatMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function addMonthsToMonthKey(monthKey, offset) {
  const { year, month } = parseMonthKey(monthKey)
  const date = new Date(year, month - 1 + offset, 1)
  return formatMonthKey(date.getFullYear(), date.getMonth() + 1)
}

function getSafeDueDate(monthKey, dueDay) {
  const { year, month } = parseMonthKey(monthKey)
  const requestedDay = Number(dueDay || 1)
  const safeRequestedDay = Math.min(
    Math.max(Number.isFinite(requestedDay) ? requestedDay : 1, 1),
    31
  )
  const lastDay = new Date(year, month, 0).getDate()
  const day = Math.min(safeRequestedDay, lastDay)

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getDateFromMonthDayAfterDate(baseDate, dueDay) {
  const n = Number(dueDay)
  if (!baseDate || !Number.isFinite(n) || n < 1 || n > 31) return ''

  const base = new Date(`${baseDate}T00:00:00`)
  if (Number.isNaN(base.getTime())) return ''

  let candidateMonthKey = formatMonthKey(base.getFullYear(), base.getMonth() + 1)
  let candidate = getSafeDueDate(candidateMonthKey, n)

  if (new Date(`${candidate}T00:00:00`).getTime() <= base.getTime()) {
    candidateMonthKey = addMonthsToMonthKey(candidateMonthKey, 1)
    candidate = getSafeDueDate(candidateMonthKey, n)
  }

  return candidate
}

function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function formatDateForInput(date) {
  return date.toISOString().slice(0, 10)
}

function getBillDueDate(bill, year, monthIndex) {
  const maxDay = getDaysInMonth(year, monthIndex)
  const dueDay = Math.max(1, Math.min(toNumber(bill.due_day || 1), maxDay))
  return new Date(year, monthIndex, dueDay)
}

function formatShortDate(date) {
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}

function getBillDescription(bill) {
  const name = String(bill?.name || '').trim()
  return name ? `Bill: ${name}` : 'Bill'
}

function getLinkedLiabilityIdFromBill(bill) {
  const note = String(bill?.note || '')
  const match = note.match(/linked_liability_id:([0-9a-fA-F-]{20,})/)
  return match?.[1] || null
}

function getLinkedLiabilityForBill(bill, liabilities = []) {
  const linkedId = getLinkedLiabilityIdFromBill(bill)
  if (!linkedId) return null
  return liabilities.find((item) => item.id === linkedId) || null
}

function getLiabilityStatementDate(liability, statementMonthKey) {
  if (!liability?.statement_day) return ''
  return getSafeDueDate(statementMonthKey, liability.statement_day)
}

function getLiabilityDueDateForStatementMonth(liability, statementMonthKey) {
  const statementDate = getLiabilityStatementDate(liability, statementMonthKey)
  if (!statementDate) return getSafeDueDate(statementMonthKey, liability?.due_day)
  return getDateFromMonthDayAfterDate(statementDate, liability?.due_day)
}

function dateKeyToDate(value) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function findLiabilityStatementForMonth(liabilityStatements = [], liabilityId, monthKey) {
  return liabilityStatements.find((row) => row.liability_id === liabilityId && row.month_key === monthKey) || null
}

function getLinkedLiabilityPaymentDescription(liability) {
  const name = String(liability?.name || '').trim()
  return name ? `Debt Payment: ${name}` : 'Debt Payment:'
}

function isDateInRangeInclusive(value, start, end) {
  if (!value || !start || !end) return false
  return value >= start && value <= end
}

function isBillAddedToCashflow(cashflowEntries, bill, monthInfo) {
  const dueDate = formatDateForInput(getBillDueDate(bill, monthInfo.year, monthInfo.monthIndex))
  const description = normalize(getBillDescription(bill))
  const amount = toNumber(bill.amount)

  return cashflowEntries.some((entry) => {
    const sameDate = entry.entry_date === dueDate
    const sameType = entry.type === 'expense'
    const sameAmount = Math.abs(toNumber(entry.amount) - amount) < 0.005
    const sameDescription = normalize(entry.description) === description

    return sameDate && sameType && sameAmount && sameDescription
  })
}

function findDebtPaymentEntryForCycle({
  allCashflowEntries = [],
  linkedLiability,
  statementDateKey,
  dueDateKey,
  monthKey
}) {
  const paymentDescription = normalize(getLinkedLiabilityPaymentDescription(linkedLiability))
  const windowStart = statementDateKey || `${monthKey}-01`
  const windowEnd = dueDateKey || `${addMonthsToMonthKey(monthKey, 1)}-01`

  return allCashflowEntries.find((entry) => {
    const isDebtPayment =
      normalize(entry.type) === 'expense' &&
      toNumber(entry.amount) > 0 &&
      normalize(entry.description).includes(paymentDescription)

    if (!isDebtPayment) return false
    return isDateInRangeInclusive(entry.entry_date, windowStart, windowEnd)
  }) || null
}

function getDebtBillReserveInfo({
  bill,
  linkedLiability,
  liabilityStatements = [],
  allCashflowEntries = [],
  monthKey
}) {
  const statementDateKey = getLiabilityStatementDate(linkedLiability, monthKey)
  const dueDateKey = getLiabilityDueDateForStatementMonth(linkedLiability, monthKey)
  const statement = findLiabilityStatementForMonth(liabilityStatements, linkedLiability.id, monthKey)
  const minimumDue =
    statement?.minimum_due == null
      ? toNumber(linkedLiability?.minimum_payment || bill.amount)
      : toNumber(statement.minimum_due)
  const statementPaid = toNumber(statement?.payments_made)
  const cashflowPayment = findDebtPaymentEntryForCycle({
    allCashflowEntries,
    linkedLiability,
    statementDateKey,
    dueDateKey,
    monthKey
  })
  const paid = Math.max(statementPaid, toNumber(cashflowPayment?.amount))
  const isPaid = statement?.status === 'paid' || (minimumDue > 0 && paid >= minimumDue)
  const remaining = isPaid ? 0 : Math.max(minimumDue - paid, 0)

  return {
    dueDateKey,
    dueDate: dateKeyToDate(dueDateKey),
    statementDateKey,
    minimumDue,
    paid,
    remaining,
    isAdded: remaining <= 0,
    statement,
    cashflowPayment
  }
}

function getGoalProgress(goal) {
  const target = toNumber(goal.target_amount)
  const current = toNumber(goal.current_amount)

  if (target <= 0) return 0
  return Math.max(0, Math.min(100, (current / target) * 100))
}

function getGoalRemaining(goal) {
  return Math.max(toNumber(goal.target_amount) - toNumber(goal.current_amount), 0)
}

function getMonthsUntil(dateString, todayKey = getTodayKey()) {
  if (!dateString) return null

  const today = new Date(`${todayKey}T00:00:00`)
  const target = new Date(`${dateString}T00:00:00`)

  if (Number.isNaN(target.getTime())) return null

  const days = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (days <= 0) return 1

  return Math.max(days / 30.4375, 1)
}

function getMonthlyNeededForGoal(goal, todayKey) {
  const remaining = getGoalRemaining(goal)
  const months = getMonthsUntil(goal.target_date, todayKey)

  if (!remaining || !months) return 0
  return remaining / months
}

function getPriorityRank(priority) {
  if (priority === 'High') return 1
  if (priority === 'Medium') return 2
  if (priority === 'Low') return 3
  return 4
}

function getCategoryKey(record) {
  if (record?.category_id) return `id:${record.category_id}`

  const categoryName = getCategoryDisplayName(record)
  return `text:${normalizeCategoryName(categoryName) || 'uncategorized'}`
}

function getTextCategoryKey(record) {
  const categoryName = getCategoryDisplayName(record)
  return `text:${normalizeCategoryName(categoryName) || 'uncategorized'}`
}

function isDebtLikeBill(bill) {
  const text = normalize(`${bill.name || ''} ${bill.category || ''} ${getCategoryDisplayName(bill)}`)

  return (
    text.includes('debt') ||
    text.includes('loan') ||
    text.includes('credit card') ||
    text.includes('minimum') ||
    text.includes('car payment')
  )
}

export function calculateBudgetWatch(budgets = [], cashflowEntries = []) {
  const expenseEntries = cashflowEntries.filter((entry) => entry.type === 'expense')
  const actualByCategory = {}

  for (const entry of expenseEntries) {
    const amount = toNumber(entry.amount)
    const idKey = getCategoryKey(entry)
    const textKey = getTextCategoryKey(entry)

    actualByCategory[idKey] = (actualByCategory[idKey] || 0) + amount

    if (textKey !== idKey) {
      actualByCategory[textKey] = (actualByCategory[textKey] || 0) + amount
    }
  }

  const budgetRows = budgets
    .map((budget) => {
      const category = getCategoryDisplayName(budget)
      const idKey = getCategoryKey(budget)
      const textKey = getTextCategoryKey(budget)
      const planned = toNumber(budget.planned_amount)

      let actual = toNumber(actualByCategory[idKey])
      if (actual === 0 && textKey !== idKey) {
        actual = toNumber(actualByCategory[textKey])
      }

      const remaining = planned - actual
      const usagePercent = planned > 0 ? (actual / planned) * 100 : 0

      let status = 'On Track'
      if (planned > 0 && usagePercent > 100) status = 'Over Budget'
      else if (planned > 0 && usagePercent === 100) status = 'At Limit'
      else if (planned > 0 && usagePercent >= 80) status = 'Near Limit'

      return {
        id: budget.id,
        category,
        category_id: budget.category_id || null,
        planned,
        actual,
        remaining,
        usagePercent,
        status
      }
    })
    .sort((a, b) => b.usagePercent - a.usagePercent)

  const totalBudgetPlanned = budgetRows.reduce((sum, row) => sum + row.planned, 0)
  const totalBudgetActual = budgetRows.reduce((sum, row) => sum + row.actual, 0)
  const budgetRemaining = totalBudgetPlanned - totalBudgetActual

  return {
    budgetRows,
    totalBudgetPlanned,
    totalBudgetActual,
    budgetRemaining,
    positiveBudgetRemaining: Math.max(budgetRemaining, 0),
    budgetUsagePercent:
      totalBudgetPlanned > 0 ? (totalBudgetActual / totalBudgetPlanned) * 100 : 0,
    overBudgetRows: budgetRows.filter((row) => row.status === 'Over Budget'),
    nearLimitRows: budgetRows.filter(
      (row) => row.status === 'Near Limit' || row.status === 'At Limit'
    )
  }
}

function isDebtPaymentEntry(entry) {
  const text = normalize(
    `${entry.category || ''} ${entry.description || ''} ${getCategoryDisplayName(entry)}`
  )

  return (
    text.includes('debt payment') ||
    text.includes('loan') ||
    text.includes('credit card') ||
    text.includes('minimum payment') ||
    text.includes('car payment')
  )
}

function isArchivedAccount(account) {
  return String(account?.name || '').startsWith('[ARCHIVED]')
}

export function getAccountRole(account) {
  const accountType = account?.account_type
  if (accountType === 'cash' || accountType === 'checking') return 'spendable'
  if (accountType === 'savings') return 'reserve'
  if (accountType === 'business') return 'business'
  return 'excluded'
}

function getAccountCashNetForAccount(accountId, cashflowEntries) {
  let income = 0
  let expense = 0

  for (const entry of cashflowEntries) {
    if (entry.account_id !== accountId) continue

    if (entry.type === 'income') income += toNumber(entry.amount)
    if (entry.type === 'expense') expense += toNumber(entry.amount)
  }

  return income - expense
}

function getLedgerFinalBalance(ledger) {
  if (!ledger) return 0

  const actual = ledger.actual_cash_count
  const expected = ledger.expected_closing_balance

  return actual === null || actual === undefined ? toNumber(expected) : toNumber(actual)
}

function getMonthDateRangeFromKey(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const next = new Date(year, month, 1)

  return {
    startDate: `${year}-${String(month).padStart(2, '0')}-01`,
    endDate: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
  }
}

function getCashflowNetForAccountInMonth(accountId, allCashflowEntries, monthKey) {
  const { startDate, endDate } = getMonthDateRangeFromKey(monthKey)
  let income = 0
  let expense = 0

  for (const entry of allCashflowEntries || []) {
    if (entry.account_id !== accountId) continue

    const entryDate = String(entry.entry_date || '')
    if (entryDate < startDate || entryDate >= endDate) continue

    if (entry.type === 'income') income += toNumber(entry.amount)
    if (entry.type === 'expense') expense += toNumber(entry.amount)
  }

  return income - expense
}

export function calculateSpendableCash({
  accounts = [],
  allCashflowEntries = [],
  cashWalletLedgers = [],
  monthInfo
} = {}) {
  const safeAccounts = asArray(accounts)
  const safeAllCashflowEntries = asArray(allCashflowEntries)
  const safeCashWalletLedgers = asArray(cashWalletLedgers)
  const safeMonthInfo = normalizeMonthInfo(monthInfo)
  const monthKey = getMonthKey(safeMonthInfo)
  const previousMonthKey = addMonthsToMonthKey(monthKey, -1)
  const activeCashAccounts = safeAccounts
    .filter((account) => !isArchivedAccount(account))
    .filter((account) => CASH_ACCOUNT_TYPES.includes(account.account_type))

  const currentLedgerByCashAccount = new Map()
  const previousLedgerByCashAccount = new Map()

  for (const ledger of safeCashWalletLedgers) {
    if (!ledger.cash_account_id) continue

    if (ledger.month_key === monthKey) {
      currentLedgerByCashAccount.set(ledger.cash_account_id, ledger)
    }

    if (ledger.month_key === previousMonthKey) {
      previousLedgerByCashAccount.set(ledger.cash_account_id, ledger)
    }
  }

  let spendableBalance = 0
  let reserveBalance = 0
  let businessBalance = 0
  let totalLiquidCash = 0
  let ledgerFinalTotal = 0
  let fallbackCashflowTotal = 0
  let ledgerCount = 0
  let carryoverCount = 0

  for (const account of activeCashAccounts) {
    const accountType = account.account_type
    const fallbackNet = getAccountCashNetForAccount(account.id, safeAllCashflowEntries)
    let accountBalance = fallbackNet

    if (accountType === 'cash') {
      const currentLedger = currentLedgerByCashAccount.get(account.id)
      const previousLedger = previousLedgerByCashAccount.get(account.id)

      if (currentLedger) {
        accountBalance = getLedgerFinalBalance(currentLedger)
        ledgerFinalTotal += accountBalance
        ledgerCount += 1
      } else if (previousLedger) {
        const previousFinal = getLedgerFinalBalance(previousLedger)
        const currentMonthMovement = getCashflowNetForAccountInMonth(
          account.id,
          safeAllCashflowEntries,
          monthKey
        )

        accountBalance = previousFinal + currentMonthMovement
        ledgerFinalTotal += accountBalance
        carryoverCount += 1
      } else {
        fallbackCashflowTotal += accountBalance
      }
    } else {
      fallbackCashflowTotal += accountBalance
    }

    totalLiquidCash += accountBalance

    const role = getAccountRole(account)

    // Negative Cash Wallet is valid and intentionally not clamped to zero.
    if (role === 'spendable') {
      spendableBalance += accountBalance
      continue
    }

    // Savings, including accounts like "Tiet Kiem", stays reserve by default.
    if (role === 'reserve') {
      reserveBalance += accountBalance
      continue
    }

    // Business cash is tracked separately from daily spendable cash.
    if (role === 'business') {
      businessBalance += accountBalance
    }
  }

  const hasLedger = ledgerCount > 0 || carryoverCount > 0

  // Roth/IRA/investment/brokerage/crypto accounts are excluded unless explicitly designed later.
  return {
    finalBalance: spendableBalance,
    spendableBalance,
    reserveBalance,
    businessBalance,
    totalLiquidCash,
    ledgerFinalTotal,
    fallbackCashflowTotal,
    ledgerCount,
    carryoverCount,
    hasLedger,
    sourceLabel: ledgerCount > 0
      ? 'Spendable cash uses current Cash Wallet Ledger + checking cashflow. Savings is reserve, not default Safe-to-Spend.'
      : carryoverCount > 0
        ? 'Spendable cash uses previous Cash Wallet Ledger carryover + current month movement. Savings is reserve, not default Safe-to-Spend.'
        : 'Spendable cash uses Cash Wallet/checking cashflow fallback. Savings is reserve, not default Safe-to-Spend.'
  }
}

export function calculateBillsReserve({
  bills = [],
  cashflowEntries = [],
  allCashflowEntries = [],
  liabilities = [],
  liabilityStatements = [],
  monthInfo,
  today
} = {}) {
  const safeBills = asArray(bills)
  const safeCashflowEntries = asArray(cashflowEntries)
  const safeAllCashflowEntries = asArray(allCashflowEntries)
  const safeLiabilities = asArray(liabilities)
  const safeLiabilityStatements = asArray(liabilityStatements)
  const safeMonthInfo = normalizeMonthInfo(monthInfo)
  const safeToday = getSafeTodayDate(today)
  const monthKey = getMonthKey(safeMonthInfo)
  const activeMonthlyBills = safeBills.filter((bill) => {
    const status = normalize(bill.status || 'active')
    const frequency = normalize(bill.frequency || 'monthly')
    return status === 'active' && frequency === 'monthly'
  })

  const billRows = activeMonthlyBills
    .map((bill) => {
      const linkedLiability = getLinkedLiabilityForBill(bill, safeLiabilities)
      const debtReserveInfo = linkedLiability
        ? getDebtBillReserveInfo({
            bill,
            linkedLiability,
            liabilityStatements: safeLiabilityStatements,
            allCashflowEntries: safeAllCashflowEntries,
            monthKey
          })
        : null
      const fallbackDueDate = getBillDueDate(bill, safeMonthInfo.year, safeMonthInfo.monthIndex)
      const dueDate = debtReserveInfo?.dueDate || fallbackDueDate
      const dueDateKey = debtReserveInfo?.dueDateKey || formatDateForInput(dueDate)
      const isAdded = debtReserveInfo
        ? debtReserveInfo.isAdded
        : isBillAddedToCashflow(safeCashflowEntries, bill, safeMonthInfo)
      const reserveAmount = debtReserveInfo ? debtReserveInfo.remaining : toNumber(bill.amount)
      const isPastDue = reserveAmount > 0 && dueDate < safeToday
      const isTodayOrFuture = dueDate >= safeToday

      return {
        ...bill,
        originalAmount: toNumber(bill.amount),
        amount: reserveAmount,
        dueDate,
        dueDateKey,
        dueDateLabel: formatShortDate(dueDate),
        amountNumber: reserveAmount,
        isAdded,
        isPastDue,
        isTodayOrFuture,
        categoryLabel: getCategoryDisplayName(bill),
        isDebtLinkedBill: Boolean(linkedLiability),
        linkedLiability,
        debtReserveInfo
      }
    })
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())

  const unpostedBills = billRows.filter((bill) => !bill.isAdded)
  const upcomingUnpostedBills = unpostedBills.filter((bill) => bill.isTodayOrFuture)

  // Bills reserve includes unpaid monthly bills; debt-linked rows reserve only remaining minimum due.
  return {
    activeMonthlyBills,
    billRows,
    unpostedBills,
    upcomingUnpostedBills,
    overdueUnpostedBills: unpostedBills.filter((bill) => bill.isPastDue),
    activeBillTotal: billRows.reduce((sum, bill) => sum + bill.originalAmount, 0),
    postedBillTotal: billRows
      .filter((bill) => bill.isAdded)
      .reduce((sum, bill) => sum + bill.originalAmount, 0),
    unpostedBillReserve: unpostedBills.reduce((sum, bill) => sum + bill.amountNumber, 0),
    upcomingBillReserve: upcomingUnpostedBills.reduce((sum, bill) => sum + bill.amountNumber, 0)
  }
}

export function calculateGoalsPace(goals = [], todayKey = getTodayKey()) {
  const activeGoals = goals
    .filter((goal) => normalize(goal.status || 'active') === 'active')
    .map((goal) => ({
      ...goal,
      progress: getGoalProgress(goal),
      remaining: getGoalRemaining(goal),
      monthlyNeeded: getMonthlyNeededForGoal(goal, todayKey)
    }))
    .filter((goal) => goal.remaining > 0)
    .sort((a, b) => {
      const priorityDiff = getPriorityRank(a.priority) - getPriorityRank(b.priority)
      if (priorityDiff !== 0) return priorityDiff
      return toNumber(b.monthlyNeeded) - toNumber(a.monthlyNeeded)
    })

  return {
    activeGoals,
    goalRemainingTotal: activeGoals.reduce((sum, goal) => sum + toNumber(goal.remaining), 0),
    goalMonthlyNeedTotal: activeGoals.reduce(
      (sum, goal) => sum + toNumber(goal.monthlyNeeded),
      0
    )
  }
}

export function calculateDebtMinimumRemaining({
  liabilities = [],
  expenseEntries = [],
  billRows = [],
  liabilityStatements = [],
  monthInfo
} = {}) {
  const safeLiabilities = asArray(liabilities)
  const safeExpenseEntries = asArray(expenseEntries)
  const safeBillRows = asArray(billRows)
  const safeLiabilityStatements = asArray(liabilityStatements)
  const monthKey = getMonthKey(monthInfo)
  const linkedLiabilityIds = new Set(
    safeBillRows
      .map((bill) => bill.linkedLiability?.id || getLinkedLiabilityIdFromBill(bill))
      .filter(Boolean)
  )
  const debtBalanceTotal = safeLiabilities.reduce(
    (sum, item) => sum + toNumber(item.current_balance),
    0
  )
  const debtMinimumTotal = safeLiabilities.reduce(
    (sum, item) => sum + toNumber(item.minimum_payment),
    0
  )

  const debtPaymentsPosted = safeExpenseEntries
    .filter(isDebtPaymentEntry)
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0)

  const unlinkedDebtBillReserve = safeBillRows
    .filter((bill) => !bill.isAdded && !bill.linkedLiability && isDebtLikeBill(bill))
    .reduce((sum, bill) => sum + toNumber(bill.amountNumber), 0)

  const rawDebtMinimumRemaining = safeLiabilities.reduce((sum, liability) => {
    if (linkedLiabilityIds.has(liability.id)) return sum

    const statement = findLiabilityStatementForMonth(safeLiabilityStatements, liability.id, monthKey)
    const minimumDue =
      statement?.minimum_due == null ? toNumber(liability.minimum_payment) : toNumber(statement.minimum_due)
    const paid = toNumber(statement?.payments_made)
    const remaining =
      statement?.status === 'paid' || (minimumDue > 0 && paid >= minimumDue)
        ? 0
        : Math.max(minimumDue - paid, 0)

    return sum + remaining
  }, 0)
  const debtMinimumRemaining = Math.max(rawDebtMinimumRemaining - unlinkedDebtBillReserve, 0)

  return {
    debtBalanceTotal,
    debtMinimumTotal,
    debtPaymentsPosted,
    debtMinimumRemaining
  }
}

export function calculateSafeToSpend({ cashBufferCurrent, unpostedBillReserve, debtMinimumRemaining }) {
  const essentialReserve = unpostedBillReserve + debtMinimumRemaining
  return {
    essentialReserve,
    safeToSpend: cashBufferCurrent - essentialReserve
  }
}

function buildAllocation({ amount = 0, mode = 'balanced', allocationModes = DEFAULT_ALLOCATION_MODES } = {}) {
  const safeModes =
    allocationModes && typeof allocationModes === 'object'
      ? allocationModes
      : DEFAULT_ALLOCATION_MODES
  const selectedMode = safeModes[mode] || safeModes.balanced || DEFAULT_ALLOCATION_MODES.balanced

  return {
    buffer: amount * (toNumber(selectedMode.buffer) / 100),
    debt: amount * (toNumber(selectedMode.debt) / 100),
    goals: amount * (toNumber(selectedMode.goals) / 100),
    investment: amount * (toNumber(selectedMode.investment) / 100)
  }
}

export function buildMoneyPlanSummary({
  accounts = [],
  allCashflowEntries = [],
  allocationMode,
  allocationModes,
  bills = [],
  budgets = [],
  cashflowEntries = [],
  cashWalletLedgers = [],
  goals = [],
  liabilities = [],
  liabilityStatements = [],
  monthInfo,
  today
} = {}) {
  const safeAccounts = asArray(accounts)
  const safeAllCashflowEntries = asArray(allCashflowEntries)
  const safeBills = asArray(bills)
  const safeBudgets = asArray(budgets)
  const safeCashflowEntries = asArray(cashflowEntries)
  const safeCashWalletLedgers = asArray(cashWalletLedgers)
  const safeGoals = asArray(goals)
  const safeLiabilities = asArray(liabilities)
  const safeLiabilityStatements = asArray(liabilityStatements)
  const safeMonthInfo = normalizeMonthInfo(monthInfo)
  const safeToday = getSafeTodayDate(today)
  const incomeEntries = safeCashflowEntries.filter((entry) => entry.type === 'income')
  const expenseEntries = safeCashflowEntries.filter((entry) => entry.type === 'expense')

  const actualIncome = incomeEntries.reduce((sum, entry) => sum + toNumber(entry.amount), 0)
  const actualExpenses = expenseEntries.reduce((sum, entry) => sum + toNumber(entry.amount), 0)
  const postedNet = actualIncome - actualExpenses

  const billsReserve = calculateBillsReserve({
    bills: safeBills,
    cashflowEntries: safeCashflowEntries,
    allCashflowEntries: safeAllCashflowEntries,
    liabilities: safeLiabilities,
    liabilityStatements: safeLiabilityStatements,
    monthInfo: safeMonthInfo,
    today: safeToday
  })
  const budgetWatch = calculateBudgetWatch(safeBudgets, safeCashflowEntries)
  const goalsPace = calculateGoalsPace(safeGoals, getTodayKey())
  const debt = calculateDebtMinimumRemaining({
    liabilities: safeLiabilities,
    expenseEntries,
    billRows: billsReserve.billRows,
    liabilityStatements: safeLiabilityStatements,
    monthInfo: safeMonthInfo
  })

  const cashBalanceInfo = calculateSpendableCash({
    accounts: safeAccounts,
    allCashflowEntries: safeAllCashflowEntries,
    cashWalletLedgers: safeCashWalletLedgers,
    monthInfo: safeMonthInfo
  })
  const cashBufferCurrent = cashBalanceInfo.finalBalance
  const safeToSpendInfo = calculateSafeToSpend({
    cashBufferCurrent,
    unpostedBillReserve: billsReserve.unpostedBillReserve,
    debtMinimumRemaining: debt.debtMinimumRemaining
  })
  const allocatableAmount = Math.max(safeToSpendInfo.safeToSpend, 0)

  const allocation = buildAllocation({
    amount: allocatableAmount,
    mode: allocationMode,
    allocationModes
  })

  const essentialMonthlyBurn = Math.max(
    billsReserve.activeBillTotal + debt.debtMinimumTotal,
    actualExpenses,
    0
  )
  const cashBufferTarget = essentialMonthlyBurn > 0 ? essentialMonthlyBurn : 1000
  const cashBufferGap = Math.max(cashBufferTarget - cashBufferCurrent, 0)
  const cashBufferPercent =
    cashBufferTarget > 0 ? Math.max(0, Math.min(100, (cashBufferCurrent / cashBufferTarget) * 100)) : 0

  let planStatus = 'Needs Data'
  let planTone = 'neutral'

  if (actualIncome > 0 && safeToSpendInfo.safeToSpend > 0 && cashBufferGap <= 0) {
    planStatus = 'Strong'
    planTone = 'success'
  } else if (actualIncome > 0 && safeToSpendInfo.safeToSpend > 0) {
    planStatus = 'Flexible'
    planTone = 'success'
  } else if (actualIncome > 0 && safeToSpendInfo.safeToSpend <= 0) {
    planStatus = 'Tight'
    planTone = 'warning'
  }

  if (actualIncome > 0 && safeToSpendInfo.safeToSpend < -500) {
    planStatus = 'Defensive'
    planTone = 'danger'
  }

  return {
    actualIncome,
    actualExpenses,
    postedNet,
    ...billsReserve,
    ...budgetWatch,
    ...goalsPace,
    liabilities: safeLiabilities,
    ...debt,
    essentialReserve: safeToSpendInfo.essentialReserve,
    safeToSpend: safeToSpendInfo.safeToSpend,
    allocatableAmount,
    allocation,
    cashBufferCurrent,
    cashBufferSourceLabel: cashBalanceInfo.sourceLabel,
    cashBufferHasLedger: cashBalanceInfo.hasLedger,
    cashBufferLedgerCount: cashBalanceInfo.ledgerCount,
    reserveCash: cashBalanceInfo.reserveBalance,
    businessCash: cashBalanceInfo.businessBalance,
    totalLiquidCash: cashBalanceInfo.totalLiquidCash,
    cashBufferTarget,
    cashBufferGap,
    cashBufferPercent,
    planStatus,
    planTone,
    accountCount: safeAccounts.length
  }
}
