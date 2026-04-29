import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { saveNetWorthSnapshot } from '../lib/snapshot'
import { getNetWorthHistory } from '../lib/history'
import PortfolioIntelligencePanel from '../components/PortfolioIntelligencePanel'
import {
  calculateHoldings,
  calculatePortfolioSummary,
  formatMoney as formatHoldingsMoney,
  formatPercent
} from '../lib/holdings'
import {
  calculateCashflowSummary,
  getCurrentMonthDateRange,
  formatMoney as formatCashflowMoney
} from '../lib/cashflow'
import {
  getCurrentMonthInfo,
  calculateBudgetSummary,
  formatMoney as formatBudgetMoney
} from '../lib/budget'
import {
  calculateNetWorthSummary,
  formatMoney as formatNetWorthMoney
} from '../lib/networth'
import { getCategoryDisplayName, normalizeCategoryName } from '../lib/cashflowCategories'
import {
  buildPortfolioAllocationData,
  buildCashflowChartData,
  buildBudgetChartData
} from '../lib/chartData'

import NetWorthChart from '../components/charts/NetWorthChart'
import PortfolioPieChart from '../components/charts/PortfolioPieChart'
import CashflowBarChart from '../components/charts/CashflowBarChart'
import BudgetChart from '../components/charts/BudgetChart'

const CASH_ACCOUNT_TYPES = ['cash', 'checking', 'savings', 'business']
const STANDARD_ACCOUNT_TYPES = [
  'cash',
  'checking',
  'savings',
  'business',
  'brokerage',
  'ira',
  'crypto',
  'credit_card',
  'loan',
  'other'
]

function toNumber(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function money(value) {
  return `$${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function isArchivedAccount(account) {
  return String(account?.name || '').startsWith('[ARCHIVED]')
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatMonthKey(year, month) {
  return `${year}-${pad2(month)}`
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10)
}

function getCurrentMonthKey() {
  return getTodayKey().slice(0, 7)
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

function addMonthsToMonthKey(monthKey, offset) {
  const { year, month } = parseMonthKey(monthKey)
  const date = new Date(year, month - 1 + offset, 1)
  return formatMonthKey(date.getFullYear(), date.getMonth() + 1)
}

function getMonthDateRangeFromKey(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const next = new Date(year, month, 1)

  return {
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-01`
  }
}

function getSafeDueDate(monthKey, dueDay) {
  const { year, month } = parseMonthKey(monthKey)
  const requestedDay = Number(dueDay || 1)
  const safeRequestedDay = Math.min(
    Math.max(Number.isFinite(requestedDay) ? requestedDay : 1, 1),
    31
  )
  const lastDay = new Date(year, month, 0).getDate()
  const safeDay = Math.min(safeRequestedDay, lastDay)

  return `${year}-${pad2(month)}-${pad2(safeDay)}`
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

function formatDateForInput(date) {
  return date.toISOString().slice(0, 10)
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

function getLinkedLiabilityPaymentDescription(liability) {
  const name = String(liability?.name || '').trim()
  return name ? `Debt Payment: ${name}` : 'Debt Payment:'
}

function getDashboardBillSchedule({ bill, liabilities = [], targetMonthKey }) {
  const linkedLiability = getLinkedLiabilityForBill(bill, liabilities)
  const isDebtLinkedBill = Boolean(linkedLiability)
  const statementDateKey = isDebtLinkedBill
    ? getLiabilityStatementDate(linkedLiability, targetMonthKey)
    : ''
  const dueDateKey = isDebtLinkedBill
    ? getLiabilityDueDateForStatementMonth(linkedLiability, targetMonthKey)
    : getSafeDueDate(targetMonthKey, bill.due_day)

  return {
    linkedLiability,
    isDebtLinkedBill,
    statementDateKey,
    dueDateKey,
    dueDate: dateKeyToDate(dueDateKey) || new Date(`${getTodayKey()}T00:00:00`)
  }
}

function isDateInRangeInclusive(value, start, end) {
  if (!value || !start || !end) return false
  return value >= start && value <= end
}

function isDebtPaymentPostedForBill({ bill, liabilities = [], allCashflowEntries = [], targetMonthKey }) {
  const schedule = getDashboardBillSchedule({ bill, liabilities, targetMonthKey })
  if (!schedule.isDebtLinkedBill || !schedule.linkedLiability) return false

  const paymentDescription = normalize(getLinkedLiabilityPaymentDescription(schedule.linkedLiability))
  const monthRange = getMonthDateRangeFromKey(targetMonthKey)
  const windowStart = schedule.statementDateKey || monthRange.startDate
  const windowEnd = schedule.dueDateKey || getMonthDateRangeFromKey(addMonthsToMonthKey(targetMonthKey, 1)).startDate

  return allCashflowEntries.some((entry) => {
    const isDebtPayment =
      normalize(entry.type) === 'expense' &&
      toNumber(entry.amount) > 0 &&
      normalize(entry.description).includes(paymentDescription)

    if (!isDebtPayment) return false
    return isDateInRangeInclusive(entry.entry_date, windowStart, windowEnd)
  })
}

function isBillAddedToCashflow({ cashflowEntries, allCashflowEntries, bill, liabilities, targetMonthKey }) {
  const schedule = getDashboardBillSchedule({ bill, liabilities, targetMonthKey })

  if (schedule.isDebtLinkedBill) {
    return isDebtPaymentPostedForBill({ bill, liabilities, allCashflowEntries, targetMonthKey })
  }

  const dueDateKey = schedule.dueDateKey
  const description = normalize(getBillDescription(bill))
  const amount = toNumber(bill.amount)

  return cashflowEntries.some((entry) => {
    const sameDate = entry.entry_date === dueDateKey
    const sameType = normalize(entry.type) === 'expense'
    const sameAmount = Math.abs(toNumber(entry.amount) - amount) < 0.005
    const sameDescription = normalize(entry.description) === description

    return sameDate && sameType && sameAmount && sameDescription
  })
}

function isBillLikeCategory(category) {
  return normalize(category).startsWith('bill:')
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

function buildBudgetWatchRows(budgetRows = []) {
  return [...budgetRows]
    .filter((row) => row.status === 'Over Budget' || row.status === 'Near Limit' || row.status === 'At Limit')
    .sort((a, b) => Number(b.usagePercent || 0) - Number(a.usagePercent || 0))
    .slice(0, 5)
}

function buildCategoryCoverage({ budgets = [], cashflowEntries = [] }) {
  const expenseEntries = cashflowEntries.filter((entry) => entry.type === 'expense')

  const budgetKeys = new Set()
  const budgetNames = new Map()

  for (const budget of budgets) {
    const key = getCategoryKey(budget)
    const textKey = getTextCategoryKey(budget)
    const name = getCategoryDisplayName(budget)

    budgetKeys.add(key)
    budgetKeys.add(textKey)
    budgetNames.set(key, name)
    budgetNames.set(textKey, name)
  }

  const expenseKeys = new Set()
  const expenseNames = new Map()

  for (const entry of expenseEntries) {
    const key = getCategoryKey(entry)
    const textKey = getTextCategoryKey(entry)
    const name = getCategoryDisplayName(entry)

    expenseKeys.add(key)
    expenseKeys.add(textKey)
    expenseNames.set(key, name)
    expenseNames.set(textKey, name)
  }

  return {
    expenseWithoutBudget: [...expenseKeys]
      .filter((key) => !budgetKeys.has(key))
      .map((key) => expenseNames.get(key))
      .filter(Boolean),
    budgetWithoutExpense: [...budgetKeys]
      .filter((key) => !expenseKeys.has(key))
      .map((key) => budgetNames.get(key))
      .filter(Boolean)
  }
}

function getMonthsUntil(dateString) {
  if (!dateString) return null

  const today = new Date(`${getTodayKey()}T00:00:00`)
  const target = new Date(`${dateString}T00:00:00`)

  if (Number.isNaN(target.getTime())) return null

  const days = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (days <= 0) return 1

  return Math.max(days / 30.4375, 1)
}

function getGoalMonthlyNeed(goal) {
  const target = toNumber(goal.target_amount)
  const current = toNumber(goal.current_amount)
  const remaining = Math.max(target - current, 0)
  const months = getMonthsUntil(goal.target_date)

  if (!remaining || !months) return 0
  return remaining / months
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

function getAccountCashNet(accounts, allCashflowEntries) {
  const cashAccountIds = new Set(
    accounts
      .filter((account) => !isArchivedAccount(account))
      .filter((account) => CASH_ACCOUNT_TYPES.includes(account.account_type))
      .map((account) => account.id)
  )

  let income = 0
  let expense = 0

  for (const entry of allCashflowEntries) {
    if (!cashAccountIds.has(entry.account_id)) continue

    if (entry.type === 'income') income += toNumber(entry.amount)
    if (entry.type === 'expense') expense += toNumber(entry.amount)
  }

  return income - expense
}

function getAccountCashNetForAccount(accountId, allCashflowEntries) {
  let income = 0
  let expense = 0

  for (const entry of allCashflowEntries || []) {
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

function getCashBalanceInfo({ accounts = [], allCashflowEntries = [], cashWalletLedgers = [], targetMonthKey }) {
  const activeCashAccounts = accounts
    .filter((account) => !isArchivedAccount(account))
    .filter((account) => CASH_ACCOUNT_TYPES.includes(account.account_type))

  const ledgerByCashAccount = new Map()

  for (const ledger of cashWalletLedgers || []) {
    if (ledger.month_key !== targetMonthKey) continue
    if (!ledger.cash_account_id) continue
    ledgerByCashAccount.set(ledger.cash_account_id, ledger)
  }

  let finalBalance = 0
  let ledgerFinalTotal = 0
  let fallbackCashflowTotal = 0
  let ledgerCount = 0

  for (const account of activeCashAccounts) {
    const fallbackNet = getAccountCashNetForAccount(account.id, allCashflowEntries)

    if (account.account_type === 'cash') {
      const ledger = ledgerByCashAccount.get(account.id)

      if (ledger) {
        const finalValue = getLedgerFinalBalance(ledger)
        finalBalance += finalValue
        ledgerFinalTotal += finalValue
        ledgerCount += 1
      } else {
        finalBalance += fallbackNet
        fallbackCashflowTotal += fallbackNet
      }

      continue
    }

    finalBalance += fallbackNet
    fallbackCashflowTotal += fallbackNet
  }

  return {
    finalBalance,
    ledgerFinalTotal,
    fallbackCashflowTotal,
    ledgerCount,
    hasLedger: ledgerCount > 0,
    sourceLabel: ledgerCount > 0
      ? 'Cash Wallet Ledger final balance + non-ledger cashflow fallback'
      : 'Cashflow net fallback'
  }
}

function calculateDashboardHealth({
  accounts,
  cashflowEntries,
  budgets,
  bills,
  holdings,
  budgetRows
}) {
  let errorCount = 0
  let warningCount = 0
  let infoCount = 0
  const notes = []

  const activeAccounts = accounts.filter((account) => !isArchivedAccount(account))
  const hasCashWallet = activeAccounts.some((account) => account.account_type === 'cash')

  if (!hasCashWallet) {
    warningCount += 1
    notes.push('No Cash Wallet')
  }

  const badAccountTypes = accounts.filter(
    (account) => !STANDARD_ACCOUNT_TYPES.includes(account.account_type)
  )

  if (badAccountTypes.length > 0) {
    warningCount += badAccountTypes.length
    notes.push(`${badAccountTypes.length} account type issue(s)`)
  }

  const unassignedCashflow = cashflowEntries.filter((entry) => !entry.account_id)
  if (unassignedCashflow.length > 0) {
    errorCount += unassignedCashflow.length
    notes.push(`${unassignedCashflow.length} unassigned cashflow`)
  }

  const legacyCashflow = cashflowEntries.filter(
    (entry) => !entry.category_id || isBillLikeCategory(entry.category)
  )

  if (legacyCashflow.length > 0) {
    warningCount += legacyCashflow.length
    notes.push(`${legacyCashflow.length} legacy category row(s)`)
  }

  const legacyBudgets = budgets.filter((budget) => !budget.category_id)
  if (legacyBudgets.length > 0) {
    warningCount += legacyBudgets.length
    notes.push(`${legacyBudgets.length} legacy budget row(s)`)
  }

  const legacyBills = bills.filter((bill) => !bill.category_id)
  if (legacyBills.length > 0) {
    warningCount += legacyBills.length
    notes.push(`${legacyBills.length} legacy bill(s)`)
  }

  const missingPriceHoldings = holdings.filter(
    (holding) => toNumber(holding.quantity) > 0 && !holding.has_market_price
  )

  if (missingPriceHoldings.length > 0) {
    errorCount += missingPriceHoldings.length
    notes.push(`${missingPriceHoldings.length} holding price issue(s)`)
  }

  const overBudgetRows = budgetRows.filter((row) => row.status === 'Over Budget')
  if (overBudgetRows.length > 0) {
    warningCount += overBudgetRows.length
    notes.push(`${overBudgetRows.length} over-budget category/categories`)
  }

  const score = Math.max(0, Math.round(100 - errorCount * 14 - warningCount * 5 - infoCount * 2))

  return {
    score,
    errorCount,
    warningCount,
    infoCount,
    totalIssues: errorCount + warningCount + infoCount,
    notes
  }
}

function calculateMoneyPlanSnapshot({
  accounts,
  cashflowEntries,
  allCashflowEntries,
  cashWalletLedgers = [],
  budgets,
  bills,
  goals,
  liabilities,
  budgetRows,
  targetMonthKey = getCurrentMonthKey()
}) {
  const income = cashflowEntries
    .filter((entry) => entry.type === 'income')
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0)

  const expense = cashflowEntries
    .filter((entry) => entry.type === 'expense')
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0)

  const postedNet = income - expense

  const activeBills = bills.filter(
    (bill) => normalize(bill.status || 'active') === 'active' && normalize(bill.frequency || 'monthly') === 'monthly'
  )

  const unpostedBills = activeBills
    .map((bill) => {
      const schedule = getDashboardBillSchedule({ bill, liabilities, targetMonthKey })
      const alreadyPosted = isBillAddedToCashflow({
        cashflowEntries,
        allCashflowEntries,
        bill,
        liabilities,
        targetMonthKey
      })

      return {
        ...bill,
        amountNumber: toNumber(bill.amount),
        dueDate: schedule.dueDate,
        dueDateKey: schedule.dueDateKey,
        dueDateLabel: formatShortDate(schedule.dueDate),
        statementDateKey: schedule.statementDateKey,
        categoryLabel: getCategoryDisplayName(bill),
        isDebtLinkedBill: schedule.isDebtLinkedBill,
        linkedLiability: schedule.linkedLiability,
        alreadyPosted,
        isPastDue: schedule.dueDate < new Date(`${getTodayKey()}T00:00:00`)
      }
    })
    .filter((bill) => !bill.alreadyPosted)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())

  const unpostedBillReserve = unpostedBills.reduce((sum, bill) => sum + toNumber(bill.amount), 0)

  const debtMinimumTotal = liabilities.reduce((sum, item) => sum + toNumber(item.minimum_payment), 0)

  const debtPosted = cashflowEntries
    .filter(isDebtPaymentEntry)
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0)

  const debtLikeUnpostedBillTotal = unpostedBills
    .filter(isDebtLikeBill)
    .reduce((sum, bill) => sum + toNumber(bill.amount), 0)

  const debtMinimumRemaining = Math.max(debtMinimumTotal - debtPosted - debtLikeUnpostedBillTotal, 0)

  const essentialReserve = unpostedBillReserve + debtMinimumRemaining
  const cashBalanceInfo = getCashBalanceInfo({
    accounts,
    allCashflowEntries,
    cashWalletLedgers,
    targetMonthKey
  })
  const cashBufferCurrent = cashBalanceInfo.finalBalance
  const safeToSpend = cashBufferCurrent - essentialReserve

  const totalBudgetPlanned = budgetRows.reduce((sum, row) => sum + toNumber(row.planned), 0)
  const totalBudgetActual = budgetRows.reduce((sum, row) => sum + toNumber(row.actual), 0)
  const budgetRemaining = totalBudgetPlanned - totalBudgetActual

  const activeGoals = goals.filter((goal) => normalize(goal.status || 'active') === 'active')
  const goalMonthlyNeed = activeGoals.reduce((sum, goal) => sum + getGoalMonthlyNeed(goal), 0)

  const cashBufferTarget = Math.max(unpostedBillReserve + debtMinimumTotal + expense, 1000)
  const cashBufferPercent =
    cashBufferTarget > 0 ? Math.max(0, Math.min(100, (cashBufferCurrent / cashBufferTarget) * 100)) : 0

  let label = 'Needs Data'
  let tone = 'yellow'

  if (income > 0 && safeToSpend >= 0) {
    label = 'Flexible'
    tone = 'green'
  }

  if (income > 0 && safeToSpend < 0) {
    label = 'Tight'
    tone = 'yellow'
  }

  if (income > 0 && safeToSpend < -500) {
    label = 'Defensive'
    tone = 'red'
  }

  return {
    label,
    tone,
    income,
    expense,
    postedNet,
    safeToSpend,
    essentialReserve,
    unpostedBillReserve,
    debtMinimumRemaining,
    unpostedBills,
    budgetRemaining,
    goalMonthlyNeed,
    cashBufferCurrent,
    cashBufferSourceLabel: cashBalanceInfo.sourceLabel,
    cashBufferHasLedger: cashBalanceInfo.hasLedger,
    cashBufferLedgerCount: cashBalanceInfo.ledgerCount,
    cashBufferTarget,
    cashBufferPercent
  }
}

export default function DashboardPage() {
  const [summary, setSummary] = useState({
    totalPositions: 0,
    totalCostBasis: 0,
    totalMarketValue: 0,
    totalUnrealizedPL: 0,
    totalUnrealizedPLPercent: 0,
    totalIncome: 0,
    totalExpenses: 0,
    netCashflow: 0,
    totalPlanned: 0,
    totalActual: 0,
    totalRemaining: 0,
    overallUsagePercent: 0,
    investmentAssetsTotal: 0,
    externalAssetsTotal: 0,
    totalAssets: 0,
    liabilitiesTotal: 0,
    netWorth: 0,
    cashBalance: 0,
    cashBalanceHasLedger: false,
    cashBalanceSourceLabel: 'Cashflow net fallback'
  })

  const [holdings, setHoldings] = useState([])
  const [budgetRows, setBudgetRows] = useState([])
  const [historyData, setHistoryData] = useState([])
  const [moneyPlan, setMoneyPlan] = useState(createEmptyMoneyPlan())
  const [dataHealth, setDataHealth] = useState(createEmptyDataHealth())
  const [commandCenter, setCommandCenter] = useState(createEmptyCommandCenter())
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    loadDashboardSummary()
  }, [])

  async function loadDashboardSummary() {
    setLoading(true)
    setErrorMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const { startDate, endDate } = getCurrentMonthDateRange()
      const { month, year } = getCurrentMonthInfo()

      const [
        txResult,
        priceResult,
        cashflowResult,
        allCashflowResult,
        budgetResult,
        accountResult,
        assetAccountResult,
        liabilityResult,
        billResult,
        goalResult,
        cashLedgerResult
      ] = await Promise.all([
        supabase
          .from('investment_transactions')
          .select(`
            id,
            account_id,
            asset_id,
            transaction_date,
            type,
            quantity,
            unit_price,
            fee,
            created_at,
            assets (
              id,
              symbol,
              display_name,
              asset_type,
              is_price_locked,
              locked_price
            )
          `)
          .eq('user_id', user.id)
          .order('transaction_date', { ascending: true })
          .order('created_at', { ascending: true }),

        supabase
          .from('price_quotes')
          .select('id, asset_id, price, created_at')
          .order('created_at', { ascending: false }),

        supabase
          .from('cashflow_entries')
          .select(`
            id,
            account_id,
            entry_date,
            type,
            amount,
            category,
            category_id,
            description,
            created_at,
            accounts (
              id,
              name,
              account_type
            ),
            cashflow_categories (
              id,
              name,
              type,
              group_name,
              icon,
              color
            )
          `)
          .eq('user_id', user.id)
          .gte('entry_date', startDate)
          .lt('entry_date', endDate)
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false }),

        supabase
          .from('cashflow_entries')
          .select('id, account_id, entry_date, type, amount, category, category_id, description, created_at')
          .eq('user_id', user.id)
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false }),

        supabase
          .from('budgets')
          .select(`
            *,
            cashflow_categories (
              id,
              name,
              type,
              group_name,
              icon,
              color
            )
          `)
          .eq('user_id', user.id)
          .eq('month', month)
          .eq('year', year)
          .order('category', { ascending: true }),

        supabase
          .from('accounts')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),

        supabase
          .from('asset_accounts')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),

        supabase
          .from('liabilities')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),

        supabase
          .from('bills')
          .select(`
            id,
            user_id,
            name,
            category,
            category_id,
            amount,
            due_day,
            frequency,
            status,
            note,
            created_at,
            cashflow_categories (
              id,
              name,
              type,
              group_name,
              icon,
              color
            )
          `)
          .eq('user_id', user.id)
          .order('due_day', { ascending: true }),

        supabase
          .from('financial_goals')
          .select('*')
          .eq('user_id', user.id)
          .order('priority', { ascending: true }),

        supabase
          .from('cash_wallet_monthly_ledger')
          .select(`
            id,
            user_id,
            cash_account_id,
            month_key,
            opening_balance,
            actual_cash_count,
            expected_closing_balance,
            status,
            locked,
            created_at
          `)
          .eq('user_id', user.id)
          .eq('month_key', `${year}-${pad2(month)}`)
          .order('created_at', { ascending: false })
      ])

      if (txResult.error) throw txResult.error
      if (priceResult.error) throw priceResult.error
      if (cashflowResult.error) throw cashflowResult.error
      if (allCashflowResult.error) throw allCashflowResult.error
      if (budgetResult.error) throw budgetResult.error
      if (accountResult.error) throw accountResult.error
      if (assetAccountResult.error) throw assetAccountResult.error
      if (liabilityResult.error) throw liabilityResult.error
      if (billResult.error) throw billResult.error
      if (goalResult.error) throw goalResult.error
      if (cashLedgerResult.error) {
        console.warn('Cash Wallet Ledger unavailable in Dashboard:', cashLedgerResult.error.message)
      }

      const txData = txResult.data || []
      const pricesData = priceResult.data || []
      const cashflowData = cashflowResult.data || []
      const allCashflowData = allCashflowResult.data || []
      const budgetData = budgetResult.data || []
      const accountData = accountResult.data || []
      const assetAccountData = assetAccountResult.data || []
      const liabilityData = liabilityResult.data || []
      const billData = billResult.data || []
      const goalData = goalResult.data || []
      const cashLedgerData = cashLedgerResult.error ? [] : cashLedgerResult.data || []
      const targetMonthKey = `${year}-${pad2(month)}`

      const cashBalanceInfo = getCashBalanceInfo({
        accounts: accountData,
        allCashflowEntries: allCashflowData,
        cashWalletLedgers: cashLedgerData,
        targetMonthKey
      })

      const holdingsData = calculateHoldings(txData, pricesData)
      const portfolioSummary = calculatePortfolioSummary(holdingsData)
      const cashflowSummary = calculateCashflowSummary(cashflowData)
      const budgetSummary = calculateBudgetSummary(budgetData, cashflowData)
      const netWorthSummary = calculateNetWorthSummary(
        assetAccountData,
        liabilityData,
        portfolioSummary.totalMarketValue || 0
      )

      const nextSummary = {
        ...portfolioSummary,
        ...cashflowSummary,
        ...budgetSummary,
        ...netWorthSummary,
        cashBalance: cashBalanceInfo.finalBalance,
        cashBalanceHasLedger: cashBalanceInfo.hasLedger,
        cashBalanceSourceLabel: cashBalanceInfo.sourceLabel
      }

      const nextMoneyPlan = calculateMoneyPlanSnapshot({
        accounts: accountData,
        cashflowEntries: cashflowData,
        allCashflowEntries: allCashflowData,
        cashWalletLedgers: cashLedgerData,
        budgets: budgetData,
        bills: billData,
        goals: goalData,
        liabilities: liabilityData,
        budgetRows: budgetSummary.rows || [],
        targetMonthKey
      })

      const nextHealth = calculateDashboardHealth({
        accounts: accountData,
        cashflowEntries: cashflowData,
        budgets: budgetData,
        bills: billData,
        holdings: holdingsData,
        budgetRows: budgetSummary.rows || []
      })

      const categoryCoverage = buildCategoryCoverage({
        budgets: budgetData,
        cashflowEntries: cashflowData
      })

      const nextCommandCenter = buildCommandCenter({
        holdingsData,
        budgetRows: budgetSummary.rows || [],
        bills: billData,
        cashflowEntries: cashflowData,
        goals: goalData,
        moneyPlan: nextMoneyPlan,
        dataHealth: nextHealth,
        categoryCoverage
      })

      setSummary(nextSummary)
      setHoldings(holdingsData)
      setBudgetRows(budgetSummary.rows || [])
      setMoneyPlan(nextMoneyPlan)
      setDataHealth(nextHealth)
      setCommandCenter(nextCommandCenter)

      await saveNetWorthSnapshot({
        userId: user.id,
        netWorth: netWorthSummary.netWorth,
        totalAssets: netWorthSummary.totalAssets,
        liabilities: netWorthSummary.liabilitiesTotal,
        investmentValue: portfolioSummary.totalMarketValue
      })

      const history = await getNetWorthHistory(user.id)
      setHistoryData(history || [])
    } catch (error) {
      console.error('Dashboard load error:', error)
      setErrorMessage(error.message || 'Dashboard failed to load.')
    } finally {
      setLoading(false)
    }
  }

  const netWorthChartData = useMemo(() => historyData, [historyData])

  const portfolioChartData = useMemo(() => {
    return buildPortfolioAllocationData(holdings)
  }, [holdings])

  const cashflowChartData = useMemo(() => {
    return buildCashflowChartData(summary)
  }, [summary])

  const budgetChartData = useMemo(() => {
    return buildBudgetChartData(budgetRows)
  }, [budgetRows])

  const topHoldings = useMemo(() => {
    return [...holdings]
      .sort((a, b) => toNumber(b.market_value) - toNumber(a.market_value))
      .slice(0, 5)
  }, [holdings])

  const savingsRate =
    summary.totalIncome > 0 ? (summary.netCashflow / summary.totalIncome) * 100 : 0

  const debtRatio =
    summary.totalAssets > 0 ? (summary.liabilitiesTotal / summary.totalAssets) * 100 : 0

  const cashflowPositive = summary.netCashflow >= 0
  const portfolioPositive = summary.totalUnrealizedPL >= 0
  const budgetOver = summary.overallUsagePercent > 100

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div>
         
          <h1 style={styles.title}>Financial Command Center</h1>
          <p style={styles.subtitle}>
            One-page view for net worth, safe-to-spend, bills, budget, portfolio, and data health.
          </p>
        </div>

        <button onClick={loadDashboardSummary} style={styles.refreshButton}>
          {loading ? 'Refreshing...' : 'Refresh Dashboard'}
        </button>
      </div>

      {errorMessage && <div style={styles.errorBox}>{errorMessage}</div>}

      <div style={styles.commandGrid}>
        <div style={styles.scoreCard}>
          <div style={styles.cardLabel}>Readiness Score</div>
          <div
            style={{
              ...styles.scoreValue,
              color:
                dataHealth.score >= 85
                  ? '#86efac'
                  : dataHealth.score >= 65
                    ? '#fde68a'
                    : '#fca5a5'
            }}
          >
            {loading ? '...' : `${dataHealth.score}/100`}
          </div>
          <div style={styles.note}>
            {dataHealth.totalIssues > 0
              ? `${dataHealth.totalIssues} item(s) need review before production-ready testing.`
              : 'No major local data issues detected.'}
          </div>
        </div>

        <div style={styles.scoreCard}>
          <div style={styles.cardLabel}>Money Plan</div>
          <div style={{ ...styles.scoreValue, color: getToneColor(moneyPlan.tone) }}>
            {loading ? '...' : moneyPlan.label}
          </div>
          <div style={styles.note}>
            Safe-to-Spend: <strong>{money(moneyPlan.safeToSpend)}</strong>
          </div>
        </div>

        <div style={styles.scoreCard}>
          <div style={styles.cardLabel}>Cash Buffer</div>
          <div
            style={{
              ...styles.scoreValue,
              color: moneyPlan.cashBufferPercent >= 100 ? '#86efac' : '#fde68a'
            }}
          >
            {loading ? '...' : formatPercent(moneyPlan.cashBufferPercent)}
          </div>
          <div style={styles.note}>
            {money(moneyPlan.cashBufferCurrent)} / {money(moneyPlan.cashBufferTarget)}
            {moneyPlan.cashBufferHasLedger ? ' · ledger synced' : ' · cashflow fallback'}
          </div>
        </div>
      </div>

      <div style={styles.statsGrid}>
        <StatCard
          label="Net Worth"
          value={loading ? '...' : `$${formatNetWorthMoney(summary.netWorth)}`}
          tone={summary.netWorth >= 0 ? 'green' : 'red'}
          note="Assets minus liabilities"
        />

        <StatCard
          label="Safe-to-Spend"
          value={loading ? '...' : money(moneyPlan.safeToSpend)}
          tone={moneyPlan.safeToSpend >= 0 ? 'green' : 'red'}
          note={`Reserve: ${money(moneyPlan.essentialReserve)}`}
        />

        <StatCard
          label="Cash Balance"
          value={loading ? '...' : money(summary.cashBalance)}
          tone={summary.cashBalance >= 0 ? 'green' : 'red'}
          note={summary.cashBalanceHasLedger ? 'Cash Wallet Ledger synced' : 'Cashflow fallback'}
        />

        <StatCard
          label="Portfolio Value"
          value={loading ? '...' : `$${formatHoldingsMoney(summary.totalMarketValue)}`}
          note={`${summary.totalPositions || 0} open positions`}
        />

        <StatCard
          label="Unrealized P&L"
          value={loading ? '...' : `$${formatHoldingsMoney(summary.totalUnrealizedPL)}`}
          tone={portfolioPositive ? 'green' : 'red'}
          note={loading ? '' : formatPercent(summary.totalUnrealizedPLPercent)}
        />

        <StatCard
          label="Net Cashflow"
          value={loading ? '...' : `$${formatCashflowMoney(summary.netCashflow)}`}
          tone={cashflowPositive ? 'green' : 'red'}
          note={loading ? '' : `Savings rate: ${formatPercent(savingsRate)}`}
        />

        <StatCard
          label="Budget Usage"
          value={loading ? '...' : formatPercent(summary.overallUsagePercent)}
          tone={budgetOver ? 'red' : 'yellow'}
          note={loading ? '' : `Remaining: $${formatBudgetMoney(summary.totalRemaining)}`}
        />

        <StatCard
          label="Unposted Bills"
          value={loading ? '...' : money(moneyPlan.unpostedBillReserve)}
          tone={moneyPlan.unpostedBillReserve > 0 ? 'yellow' : 'green'}
          note={`${moneyPlan.unpostedBills.length} bill(s) not posted`}
        />

        <StatCard
          label="Liabilities"
          value={loading ? '...' : `$${formatNetWorthMoney(summary.liabilitiesTotal)}`}
          tone="red"
          note={loading ? '' : `Debt ratio: ${formatPercent(debtRatio)}`}
        />
      </div>

      <div style={styles.mainGrid}>
        <div style={styles.leftStack}>
          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <h2 style={styles.panelTitle}>Today’s Action Center</h2>
                <p style={styles.panelSubtitle}>The most important signals from your app.</p>
              </div>
            </div>

            <div style={styles.actionList}>
              {commandCenter.items.map((item) => (
                <a key={item.title} href={item.href} style={styles.actionItem}>
                  <span style={{ ...styles.dot, background: getToneColor(item.tone) }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.actionTitle}>{item.title}</div>
                    <div style={styles.actionText}>{item.text}</div>
                  </div>
                  <span style={{ ...styles.actionBadge, color: getToneColor(item.tone) }}>
                    {item.badge}
                  </span>
                </a>
              ))}
            </div>
          </section>

          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <h2 style={styles.panelTitle}>Upcoming / Unposted Bills</h2>
                <p style={styles.panelSubtitle}>Bills still reserved by Money Plan. Debt reminders are synced with Net Worth.</p>
              </div>
            </div>

            {moneyPlan.unpostedBills.length === 0 ? (
              <div style={styles.empty}>All active monthly bills appear posted this month.</div>
            ) : (
              <div style={styles.list}>
                {moneyPlan.unpostedBills.slice(0, 6).map((bill) => (
                  <div key={bill.id} style={styles.listRow}>
                    <div>
                      <div style={styles.listTitle}>{bill.name}</div>
                      <div style={styles.listSub}>
                        {bill.isDebtLinkedBill ? 'Payment due' : 'Due'} {bill.dueDateLabel} · {bill.categoryLabel}
                      </div>
                    </div>
                    <div style={styles.rightText}>
                      <div style={bill.isPastDue ? styles.redText : styles.yellowText}>
                        ${formatCashflowMoney(bill.amount)}
                      </div>
                      <div style={styles.miniText}>
                        {bill.isDebtLinkedBill
                          ? bill.isPastDue
                            ? 'record in Net Worth'
                            : 'debt reminder'
                          : bill.isPastDue
                            ? 'past due'
                            : 'reserve'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <h2 style={styles.panelTitle}>Budget Watch</h2>
                <p style={styles.panelSubtitle}>Categories near or over monthly plan.</p>
              </div>
            </div>

            {commandCenter.budgetWatch.length === 0 ? (
              <div style={styles.empty}>No budget category needs attention right now.</div>
            ) : (
              <div style={styles.list}>
                {commandCenter.budgetWatch.map((row) => (
                  <div key={row.id || row.category} style={styles.listRow}>
                    <div>
                      <div style={styles.listTitle}>{row.category}</div>
                      <div style={styles.listSub}>
                        {money(row.actual)} / {money(row.planned)}
                      </div>
                    </div>
                    <div style={styles.rightText}>
                      <div style={row.remaining >= 0 ? styles.greenText : styles.redText}>
                        {money(row.remaining)}
                      </div>
                      <div style={styles.miniText}>{formatPercent(row.usagePercent)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div style={styles.rightStack}>
          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <h2 style={styles.panelTitle}>Top Holdings</h2>
                <p style={styles.panelSubtitle}>Largest positions by market value.</p>
              </div>
            </div>

            {topHoldings.length === 0 ? (
              <div style={styles.empty}>No holdings yet.</div>
            ) : (
              <div style={styles.list}>
                {topHoldings.map((item) => (
                  <div key={item.asset_id || item.symbol} style={styles.listRow}>
                    <div>
                      <div style={styles.listTitle}>{item.symbol}</div>
                      <div style={styles.listSub}>{item.display_name || 'Investment'}</div>
                    </div>

                    <div style={styles.rightText}>
                      <div style={styles.listTitle}>
                        ${formatHoldingsMoney(item.market_value || 0)}
                      </div>
                      <div
                        style={{
                          ...styles.miniText,
                          color: toNumber(item.unrealized_pl) >= 0 ? '#22c55e' : '#ef4444'
                        }}
                      >
                        ${formatHoldingsMoney(item.unrealized_pl || 0)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <h2 style={styles.panelTitle}>Quick Snapshot</h2>
                <p style={styles.panelSubtitle}>Current month and balance overview.</p>
              </div>
            </div>

            <SnapshotRow label="Total Assets" value={`$${formatNetWorthMoney(summary.totalAssets)}`} />
            <SnapshotRow label="Investment Assets" value={`$${formatNetWorthMoney(summary.investmentAssetsTotal)}`} />
            <SnapshotRow label="External Assets" value={`$${formatNetWorthMoney(summary.externalAssetsTotal)}`} />
            <SnapshotRow label="Total Debt" value={`$${formatNetWorthMoney(summary.liabilitiesTotal)}`} />
            <SnapshotRow label="Cash Balance" value={money(summary.cashBalance)} />
            <SnapshotRow label="Monthly Income" value={`$${formatCashflowMoney(summary.totalIncome)}`} />
            <SnapshotRow label="Monthly Expenses" value={`$${formatCashflowMoney(summary.totalExpenses)}`} />
            <SnapshotRow label="Goal Monthly Need" value={money(moneyPlan.goalMonthlyNeed)} />
          </section>

          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <h2 style={styles.panelTitle}>Data Health Snapshot</h2>
                <p style={styles.panelSubtitle}>Fast version of Data Health Pro.</p>
              </div>
            </div>

            {dataHealth.notes.length === 0 ? (
              <div style={styles.empty}>No major issue detected in dashboard checks.</div>
            ) : (
              <div style={styles.tagWrap}>
                {dataHealth.notes.slice(0, 8).map((note) => (
                  <span key={note} style={styles.warningTag}>
                    {note}
                  </span>
                ))}
              </div>
            )}

            <a href="/data-health" style={styles.linkButton}>
              Open Data Health
            </a>
          </section>
        </div>
      </div>

      <PortfolioIntelligencePanel holdings={holdings} />

      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Charts</h2>
        <p style={styles.panelSubtitle}>Visual overview of your financial trend.</p>
      </div>

      <div style={styles.chartsGrid}>
        <div style={styles.chartShell}>
          <NetWorthChart data={netWorthChartData} />
        </div>

        <div style={styles.chartShell}>
          <PortfolioPieChart data={portfolioChartData} />
        </div>

        <div style={styles.chartShell}>
          <CashflowBarChart data={cashflowChartData} />
        </div>

        <div style={styles.chartShell}>
          <BudgetChart data={budgetChartData} />
        </div>
      </div>
    </div>
  )
}

function createEmptyMoneyPlan() {
  return {
    label: 'Needs Data',
    tone: 'yellow',
    income: 0,
    expense: 0,
    postedNet: 0,
    safeToSpend: 0,
    essentialReserve: 0,
    unpostedBillReserve: 0,
    debtMinimumRemaining: 0,
    unpostedBills: [],
    budgetRemaining: 0,
    goalMonthlyNeed: 0,
    cashBufferCurrent: 0,
    cashBufferTarget: 1000,
    cashBufferPercent: 0
  }
}

function createEmptyDataHealth() {
  return {
    score: 100,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    totalIssues: 0,
    notes: []
  }
}

function createEmptyCommandCenter() {
  return {
    items: [],
    budgetWatch: []
  }
}

function buildCommandCenter({
  holdingsData,
  budgetRows,
  bills,
  cashflowEntries,
  goals,
  moneyPlan,
  dataHealth,
  categoryCoverage
}) {
  const items = []
  const budgetWatch = buildBudgetWatchRows(budgetRows)

  items.push({
    title: 'Money Plan',
    text:
      moneyPlan.safeToSpend >= 0
        ? `Safe-to-Spend is ${money(moneyPlan.safeToSpend)}.`
        : `Shortfall of ${money(Math.abs(moneyPlan.safeToSpend))}. Review bills and spending.`,
    badge: moneyPlan.label,
    tone: moneyPlan.tone,
    href: '/money-plan'
  })

  items.push({
    title: 'Data Health',
    text:
      dataHealth.totalIssues > 0
        ? `${dataHealth.totalIssues} issue(s) found. Fix red and yellow items first.`
        : 'No major local data issues detected.',
    badge: dataHealth.totalIssues > 0 ? 'Review' : 'OK',
    tone: dataHealth.totalIssues > 0 ? 'yellow' : 'green',
    href: '/data-health'
  })

  const dueSoonBills = moneyPlan.unpostedBills
    .filter((bill) => {
      const today = new Date(`${getTodayKey()}T00:00:00`)
      const days = Math.ceil((bill.dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      return days <= 14
    })
    .slice(0, 3)

  items.push({
    title: 'Bills',
    text:
      dueSoonBills.length > 0
        ? dueSoonBills.map((bill) => `${bill.name} ${money(bill.amount)}`).join(' · ')
        : 'No unposted active bill due soon.',
    badge: `${moneyPlan.unpostedBills.length} open`,
    tone: moneyPlan.unpostedBills.length > 0 ? 'yellow' : 'green',
    href: '/bills'
  })

  items.push({
    title: 'Budget',
    text:
      budgetWatch.length > 0
        ? `${budgetWatch[0].category} is at ${formatPercent(budgetWatch[0].usagePercent)}.`
        : 'No major budget pressure right now.',
    badge: budgetWatch.length > 0 ? 'Watch' : 'OK',
    tone: budgetWatch.length > 0 ? 'yellow' : 'green',
    href: '/budget'
  })

  const totalValue = holdingsData.reduce((sum, item) => sum + toNumber(item.market_value), 0)
  const topHolding = [...holdingsData].sort((a, b) => toNumber(b.market_value) - toNumber(a.market_value))[0]
  const topWeight = totalValue > 0 && topHolding ? (toNumber(topHolding.market_value) / totalValue) * 100 : 0

  items.push({
    title: 'Portfolio',
    text:
      topWeight >= 35
        ? `${topHolding.symbol} is ${formatPercent(topWeight)} of portfolio.`
        : 'No major concentration warning from dashboard.',
    badge: topWeight >= 50 ? 'High' : topWeight >= 35 ? 'Medium' : 'Normal',
    tone: topWeight >= 50 ? 'red' : topWeight >= 35 ? 'yellow' : 'green',
    href: '/portfolio-intelligence'
  })

  const activeGoals = goals.filter((goal) => normalize(goal.status || 'active') === 'active')
  const goalRemaining = activeGoals.reduce((sum, goal) => {
    return sum + Math.max(toNumber(goal.target_amount) - toNumber(goal.current_amount), 0)
  }, 0)

  items.push({
    title: 'Goals',
    text:
      activeGoals.length > 0
        ? `${activeGoals.length} active goal(s), ${money(goalRemaining)} remaining.`
        : 'No active goals found yet.',
    badge: `${activeGoals.length} active`,
    tone: activeGoals.length > 0 ? 'blue' : 'yellow',
    href: '/financial-goals'
  })

  if (categoryCoverage.expenseWithoutBudget.length > 0) {
    items.push({
      title: 'Category Coverage',
      text: `${categoryCoverage.expenseWithoutBudget.length} expense category/categories have no budget this month.`,
      badge: 'Review',
      tone: 'yellow',
      href: '/budget'
    })
  }

  return {
    items,
    budgetWatch
  }
}

function getToneColor(tone) {
  if (tone === 'green' || tone === 'success') return '#22c55e'
  if (tone === 'red' || tone === 'danger') return '#ef4444'
  if (tone === 'yellow' || tone === 'warning') return '#f59e0b'
  if (tone === 'blue' || tone === 'info') return '#60a5fa'
  return '#f9fafb'
}

function StatCard({ label, value, note, tone = 'default' }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.cardLabel}>{label}</div>
      <div style={{ ...styles.value, color: getToneColor(tone) }}>{value}</div>
      {note && <div style={styles.note}>{note}</div>}
    </div>
  )
}

function SnapshotRow({ label, value }) {
  return (
    <div style={styles.snapshotRow}>
      <span style={styles.snapshotLabel}>{label}</span>
      <span style={styles.snapshotValue}>{value}</span>
    </div>
  )
}

const styles = {
  page: {
    color: '#f9fafb'
  },
  hero: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    padding: 24,
    borderRadius: 22,
    background:
      'linear-gradient(135deg, rgba(37,99,235,0.28), rgba(15,23,42,1) 55%, rgba(34,197,94,0.16))',
    border: '1px solid rgba(255,255,255,0.08)',
    marginBottom: 18
  },
  eyebrow: {
    color: '#93c5fd',
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    marginBottom: 8
  },
  title: {
    margin: 0,
    fontSize: 34,
    lineHeight: 1.1,
    letterSpacing: '-0.04em'
  },
  subtitle: {
    marginTop: 10,
    marginBottom: 0,
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 1.55,
    maxWidth: 760
  },
  refreshButton: {
    padding: '12px 16px',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 14,
    background: '#2563eb',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 800,
    boxShadow: '0 10px 24px rgba(37,99,235,0.25)'
  },
  errorBox: {
    padding: '14px 16px',
    borderRadius: 14,
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.35)',
    color: '#fecaca',
    marginBottom: 16
  },
  commandGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 16,
    marginBottom: 18
  },
  scoreCard: {
    background: '#111827',
    padding: 20,
    borderRadius: 20,
    border: '1px solid rgba(148,163,184,0.22)',
    boxShadow: '0 14px 34px rgba(0,0,0,0.24)'
  },
  scoreValue: {
    fontSize: 34,
    fontWeight: 950,
    marginTop: 10,
    letterSpacing: '-0.04em'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 16,
    marginBottom: 18
  },
  statCard: {
    background: '#1f2937',
    padding: 18,
    borderRadius: 18,
    minHeight: 126,
    border: '1px solid rgba(148,163,184,0.22)',
    boxShadow: '0 14px 34px rgba(0,0,0,0.28)'
  },
  cardLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: 850,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 10
  },
  value: {
    fontSize: 28,
    fontWeight: 900,
    color: '#f9fafb',
    letterSpacing: '-0.035em'
  },
  note: {
    marginTop: 8,
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 1.45
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 0.8fr)',
    gap: 18,
    marginBottom: 22,
    alignItems: 'start'
  },
  leftStack: {
    display: 'grid',
    gap: 18
  },
  rightStack: {
    display: 'grid',
    gap: 18
  },
  panel: {
    background: '#1f2937',
    borderRadius: 20,
    padding: 20,
    border: '1px solid rgba(148,163,184,0.22)',
    boxShadow: '0 14px 34px rgba(0,0,0,0.24)',
    minWidth: 0
  },
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16
  },
  panelTitle: {
    margin: 0,
    fontSize: 19,
    fontWeight: 900,
    letterSpacing: '-0.02em'
  },
  panelSubtitle: {
    marginTop: 6,
    marginBottom: 0,
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 1.45
  },
  actionList: {
    display: 'grid',
    gap: 10
  },
  actionItem: {
    display: 'grid',
    gridTemplateColumns: '10px minmax(0, 1fr) auto',
    alignItems: 'start',
    gap: 12,
    textDecoration: 'none',
    color: '#f9fafb',
    padding: 14,
    borderRadius: 15,
    background: '#111827',
    border: '1px solid #334155'
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 5
  },
  actionTitle: {
    fontWeight: 900,
    fontSize: 14
  },
  actionText: {
    marginTop: 5,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 1.45
  },
  actionBadge: {
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap'
  },
  list: {
    display: 'grid',
    gap: 10
  },
  listRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    padding: 13,
    borderRadius: 15,
    background: '#111827',
    border: '1px solid #334155'
  },
  listTitle: {
    fontSize: 14,
    fontWeight: 900
  },
  listSub: {
    marginTop: 5,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 1.35
  },
  rightText: {
    textAlign: 'right',
    flexShrink: 0
  },
  miniText: {
    marginTop: 4,
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 750
  },
  greenText: {
    color: '#22c55e',
    fontWeight: 900
  },
  redText: {
    color: '#ef4444',
    fontWeight: 900
  },
  yellowText: {
    color: '#f59e0b',
    fontWeight: 900
  },
  empty: {
    padding: 18,
    borderRadius: 14,
    background: '#111827',
    border: '1px dashed #4b5563',
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 1.45
  },
  snapshotRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    padding: '12px 0',
    borderBottom: '1px solid rgba(255,255,255,0.07)'
  },
  snapshotLabel: {
    color: '#94a3b8'
  },
  snapshotValue: {
    color: '#f9fafb',
    fontWeight: 900
  },
  tagWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14
  },
  warningTag: {
    display: 'inline-block',
    padding: '7px 10px',
    borderRadius: 999,
    background: 'rgba(245, 158, 11, 0.12)',
    color: '#fde68a',
    border: '1px solid rgba(245, 158, 11, 0.28)',
    fontSize: 12,
    fontWeight: 800
  },
  linkButton: {
    display: 'inline-block',
    textDecoration: 'none',
    marginTop: 4,
    padding: '10px 13px',
    borderRadius: 11,
    background: '#2563eb',
    color: 'white',
    fontWeight: 850
  },
  sectionHeader: {
    marginTop: 6,
    marginBottom: 12
  },
  sectionTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 900
  },
  chartsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
    gap: 18,
    alignItems: 'stretch'
  },
  chartShell: {
    background: '#1f2937',
    borderRadius: 20,
    padding: 12,
    border: '1px solid rgba(148,163,184,0.22)',
    minHeight: 320,
    overflow: 'hidden',
    boxShadow: '0 14px 34px rgba(0,0,0,0.24)'
  }
}