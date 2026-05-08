import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_APP_SETTINGS, loadUserSettings } from '../lib/appSettings'
import { getCategoryDisplayName, normalizeCategoryName } from '../lib/cashflowCategories'

const ALLOCATION_MODES = {
  conservative: {
    label: 'Conservative',
    description: 'Ưu tiên giữ cash buffer và giảm rủi ro trước.',
    buffer: 40,
    debt: 25,
    goals: 20,
    investment: 15
  },
  balanced: {
    label: 'Balanced',
    description: 'Cân bằng giữa buffer, debt, goals và đầu tư.',
    buffer: 25,
    debt: 25,
    goals: 25,
    investment: 25
  },
  aggressive: {
    label: 'Aggressive',
    description: 'Ưu tiên goals và investment nhiều hơn, chỉ hợp khi cashflow ổn.',
    buffer: 15,
    debt: 20,
    goals: 25,
    investment: 40
  }
}

const CASH_ACCOUNT_TYPES = ['cash', 'checking', 'savings', 'business']

function toNumber(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function formatMoney(value) {
  return toNumber(value).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatPercent(value) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10)
}

function getMonthRange(date = new Date()) {
  const year = date.getFullYear()
  const monthIndex = date.getMonth()
  const start = new Date(year, monthIndex, 1)
  const end = new Date(year, monthIndex + 1, 1)

  return {
    year,
    month: monthIndex + 1,
    monthIndex,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    label: date.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric'
    })
  }
}

function getMonthKey(monthInfo) {
  return `${monthInfo.year}-${String(monthInfo.month).padStart(2, '0')}`
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

function getGoalProgress(goal) {
  const target = toNumber(goal.target_amount)
  const current = toNumber(goal.current_amount)

  if (target <= 0) return 0
  return Math.max(0, Math.min(100, (current / target) * 100))
}

function getGoalRemaining(goal) {
  return Math.max(toNumber(goal.target_amount) - toNumber(goal.current_amount), 0)
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

function getMonthlyNeededForGoal(goal) {
  const remaining = getGoalRemaining(goal)
  const months = getMonthsUntil(goal.target_date)

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

function buildBudgetRows(budgets, cashflowEntries) {
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

  return budgets
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

function displayAccountName(account) {
  const name = String(account?.name || 'Unnamed Account')
  return name.startsWith('[ARCHIVED] ') ? name.replace('[ARCHIVED] ', '') : name
}

function getAccountCashNet(accounts, cashflowEntries) {
  const cashAccountIds = new Set(
    accounts
      .filter((account) => !isArchivedAccount(account))
      .filter((account) => CASH_ACCOUNT_TYPES.includes(account.account_type))
      .map((account) => account.id)
  )

  let income = 0
  let expense = 0

  for (const entry of cashflowEntries) {
    if (!cashAccountIds.has(entry.account_id)) continue

    if (entry.type === 'income') income += toNumber(entry.amount)
    if (entry.type === 'expense') expense += toNumber(entry.amount)
  }

  return income - expense
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

function getCashBalanceInfo({ accounts = [], allCashflowEntries = [], cashWalletLedgers = [], monthInfo }) {
  const monthKey = getMonthKey(monthInfo)
  const activeCashAccounts = accounts
    .filter((account) => !isArchivedAccount(account))
    .filter((account) => CASH_ACCOUNT_TYPES.includes(account.account_type))

  const ledgerByCashAccount = new Map()

  for (const ledger of cashWalletLedgers || []) {
    if (ledger.month_key !== monthKey) continue
    if (!ledger.cash_account_id) continue
    ledgerByCashAccount.set(ledger.cash_account_id, ledger)
  }

  let spendableBalance = 0
  let reserveBalance = 0
  let businessBalance = 0
  let totalLiquidCash = 0
  let ledgerFinalTotal = 0
  let fallbackCashflowTotal = 0
  let ledgerCount = 0

  for (const account of activeCashAccounts) {
    const accountType = account.account_type
    const fallbackNet = getAccountCashNetForAccount(account.id, allCashflowEntries)
    let accountBalance = fallbackNet

    if (accountType === 'cash') {
      const ledger = ledgerByCashAccount.get(account.id)

      if (ledger) {
        accountBalance = getLedgerFinalBalance(ledger)
        ledgerFinalTotal += accountBalance
        ledgerCount += 1
      } else {
        fallbackCashflowTotal += accountBalance
      }
    } else {
      fallbackCashflowTotal += accountBalance
    }

    totalLiquidCash += accountBalance

    if (accountType === 'cash' || accountType === 'checking') {
      spendableBalance += accountBalance
      continue
    }

    if (accountType === 'savings') {
      reserveBalance += accountBalance
      continue
    }

    if (accountType === 'business') {
      businessBalance += accountBalance
    }
  }

  return {
    finalBalance: spendableBalance,
    spendableBalance,
    reserveBalance,
    businessBalance,
    totalLiquidCash,
    ledgerFinalTotal,
    fallbackCashflowTotal,
    ledgerCount,
    hasLedger: ledgerCount > 0,
    sourceLabel: ledgerCount > 0
      ? 'Spendable cash uses Cash Wallet Ledger + checking cashflow. Savings is reserve, not default Safe-to-Spend.'
      : 'Spendable cash uses Cash Wallet/checking cashflow fallback. Savings is reserve, not default Safe-to-Spend.'
  }
}

function buildAllocation({ amount, mode }) {
  const selectedMode = ALLOCATION_MODES[mode] || ALLOCATION_MODES.balanced

  return {
    buffer: amount * (selectedMode.buffer / 100),
    debt: amount * (selectedMode.debt / 100),
    goals: amount * (selectedMode.goals / 100),
    investment: amount * (selectedMode.investment / 100)
  }
}

function buildInsights(plan) {
  const insights = []

  if (plan.actualIncome <= 0) {
    insights.push({
      tone: 'warning',
      title: 'Income chưa có trong tháng này',
      text: 'Money Plan cần income tháng hiện tại để tính Safe-to-Spend chính xác hơn.'
    })
  }

  if (plan.unpostedBillReserve > 0) {
    insights.push({
      tone: 'warning',
      title: 'Còn bill chưa đưa vào Cashflow',
      text: `Bạn còn ${formatMoney(plan.unpostedBillReserve)} active monthly bills chưa được post vào Cashflow tháng này.`
    })
  }

  if (plan.overdueUnpostedBills.length > 0) {
    insights.push({
      tone: 'danger',
      title: 'Có bill quá hạn nhưng chưa post',
      text: `${plan.overdueUnpostedBills.length} bill đã qua due date nhưng chưa thấy trong Cashflow. Nên kiểm tra ở Bills hoặc Month Setup.`
    })
  }

  if (plan.safeToSpend < 0) {
    insights.push({
      tone: 'danger',
      title: 'Safe-to-Spend đang âm',
      text: `Bạn đang thiếu khoảng ${formatMoney(Math.abs(plan.safeToSpend))} sau khi giữ tiền cho bill/debt cần thiết.`
    })
  } else if (plan.safeToSpend > 0) {
    insights.push({
      tone: 'success',
      title: 'Có tiền dư để phân bổ',
      text: `Safe-to-Spend hiện khoảng ${formatMoney(plan.safeToSpend)}. Có thể chia cho buffer, debt, goals hoặc investment theo mode đã chọn.`
    })
  }

  if (plan.cashBufferGap > 0) {
    insights.push({
      tone: 'info',
      title: 'Cash buffer chưa đủ mục tiêu',
      text: `Cash buffer còn thiếu khoảng ${formatMoney(plan.cashBufferGap)} so với target 1 tháng essential reserve.`
    })
  }

  if (plan.overBudgetRows.length > 0) {
    const top = plan.overBudgetRows[0]
    insights.push({
      tone: 'danger',
      title: 'Có budget bị vượt',
      text: `${top.category} đang dùng ${formatPercent(top.usagePercent)} của plan. Nên hạn chế chi thêm ở category này.`
    })
  }

  if (plan.goalMonthlyNeedTotal > plan.allocation.goals && plan.allocatableAmount > 0) {
    insights.push({
      tone: 'warning',
      title: 'Goal need cao hơn phần gợi ý',
      text: `Goals cần khoảng ${formatMoney(plan.goalMonthlyNeedTotal)}/tháng, nhưng allocation mode hiện chỉ gợi ý ${formatMoney(plan.allocation.goals)}.`
    })
  }

  if (!insights.length) {
    insights.push({
      tone: 'neutral',
      title: 'Dữ liệu hiện khá ổn',
      text: 'Money Plan chưa phát hiện vấn đề lớn. Tiếp tục cập nhật income, expense, bills và goals đều đặn.'
    })
  }

  return insights
}

function getToneStyle(tone) {
  if (tone === 'success') return styles.successPill
  if (tone === 'danger') return styles.dangerPill
  if (tone === 'warning') return styles.warningPill
  if (tone === 'info') return styles.infoPill
  return styles.neutralPill
}

export default function MoneyPlanPage() {
  const monthInfo = useMemo(() => getMonthRange(), [])
  const today = useMemo(() => new Date(`${getTodayKey()}T00:00:00`), [])

  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [cashflowEntries, setCashflowEntries] = useState([])
  const [allCashflowEntries, setAllCashflowEntries] = useState([])
  const [budgets, setBudgets] = useState([])
  const [bills, setBills] = useState([])
  const [goals, setGoals] = useState([])
  const [liabilities, setLiabilities] = useState([])
  const [accounts, setAccounts] = useState([])
  const [cashWalletLedgers, setCashWalletLedgers] = useState([])
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS)
  const [allocationMode, setAllocationMode] = useState('balanced')

  useEffect(() => {
    loadMoneyPlan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadMoneyPlan() {
    setLoading(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user.')
      }

const loadedSettings = await loadUserSettings()
setAppSettings(loadedSettings)

if (
  loadedSettings.moneyPlanDefaultMode &&
  ALLOCATION_MODES[loadedSettings.moneyPlanDefaultMode]
) {
  setAllocationMode(loadedSettings.moneyPlanDefaultMode)
}

      const [
        cashflowResult,
        allCashflowResult,
        budgetResult,
        billResult,
        goalResult,
        liabilityResult,
        accountResult,
        cashLedgerResult
      ] = await Promise.all([
        supabase
          .from('cashflow_entries')
          .select(`
            id,
            user_id,
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
          .gte('entry_date', monthInfo.startDate)
          .lt('entry_date', monthInfo.endDate)
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false }),

        supabase
          .from('cashflow_entries')
          .select(`
            id,
            user_id,
            account_id,
            entry_date,
            type,
            amount,
            category,
            category_id,
            description,
            created_at
          `)
          .eq('user_id', user.id)
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false }),

        supabase
          .from('budgets')
          .select(`
            id,
            user_id,
            month,
            year,
            category,
            category_id,
            planned_amount,
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
          .eq('month', monthInfo.month)
          .eq('year', monthInfo.year)
          .order('category', { ascending: true }),

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
          .order('priority', { ascending: true })
          .order('target_date', { ascending: true, nullsFirst: false }),

        supabase
          .from('liabilities')
          .select('*')
          .eq('user_id', user.id)
          .order('current_balance', { ascending: false }),

        supabase
          .from('accounts')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),

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
          .eq('month_key', getMonthKey(monthInfo))
          .order('created_at', { ascending: false })
      ])

      if (cashflowResult.error) throw cashflowResult.error
      if (allCashflowResult.error) throw allCashflowResult.error
      if (budgetResult.error) throw budgetResult.error
      if (billResult.error) throw billResult.error
      if (goalResult.error) throw goalResult.error
      if (liabilityResult.error) throw liabilityResult.error
      if (accountResult.error) throw accountResult.error
      if (cashLedgerResult.error) {
        console.warn('Cash Wallet Ledger unavailable in Money Plan:', cashLedgerResult.error.message)
      }

      setCashflowEntries(cashflowResult.data || [])
      setAllCashflowEntries(allCashflowResult.data || [])
      setBudgets(budgetResult.data || [])
      setBills(billResult.data || [])
      setGoals(goalResult.data || [])
      setLiabilities(liabilityResult.data || [])
      setAccounts(accountResult.data || [])
      setCashWalletLedgers(cashLedgerResult.error ? [] : cashLedgerResult.data || [])
    } catch (error) {
      console.error('MoneyPlanPage load error:', error)
      setMessage(error.message || 'Failed to load money plan.')
    } finally {
      setLoading(false)
    }
  }

  const plan = useMemo(() => {
    const incomeEntries = cashflowEntries.filter((entry) => entry.type === 'income')
    const expenseEntries = cashflowEntries.filter((entry) => entry.type === 'expense')

    const actualIncome = incomeEntries.reduce((sum, entry) => sum + toNumber(entry.amount), 0)
    const actualExpenses = expenseEntries.reduce((sum, entry) => sum + toNumber(entry.amount), 0)
    const postedNet = actualIncome - actualExpenses

    const activeMonthlyBills = bills.filter((bill) => {
      const status = normalize(bill.status || 'active')
      const frequency = normalize(bill.frequency || 'monthly')
      return status === 'active' && frequency === 'monthly'
    })

    const billRows = activeMonthlyBills
      .map((bill) => {
        const dueDate = getBillDueDate(bill, monthInfo.year, monthInfo.monthIndex)
        const dueDateKey = formatDateForInput(dueDate)
        const isAdded = isBillAddedToCashflow(cashflowEntries, bill, monthInfo)
        const isPastDue = dueDate < today
        const isTodayOrFuture = dueDate >= today

        return {
          ...bill,
          dueDate,
          dueDateKey,
          dueDateLabel: formatShortDate(dueDate),
          amountNumber: toNumber(bill.amount),
          isAdded,
          isPastDue,
          isTodayOrFuture,
          categoryLabel: getCategoryDisplayName(bill)
        }
      })
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())

    const unpostedBills = billRows.filter((bill) => !bill.isAdded)
    const upcomingUnpostedBills = unpostedBills.filter((bill) => bill.isTodayOrFuture)
    const overdueUnpostedBills = unpostedBills.filter((bill) => bill.isPastDue)

    const activeBillTotal = billRows.reduce((sum, bill) => sum + bill.amountNumber, 0)
    const postedBillTotal = billRows
      .filter((bill) => bill.isAdded)
      .reduce((sum, bill) => sum + bill.amountNumber, 0)
    const unpostedBillReserve = unpostedBills.reduce((sum, bill) => sum + bill.amountNumber, 0)
    const upcomingBillReserve = upcomingUnpostedBills.reduce((sum, bill) => sum + bill.amountNumber, 0)

    const budgetRows = buildBudgetRows(budgets, cashflowEntries)
    const totalBudgetPlanned = budgetRows.reduce((sum, row) => sum + row.planned, 0)
    const totalBudgetActual = budgetRows.reduce((sum, row) => sum + row.actual, 0)
    const budgetRemaining = totalBudgetPlanned - totalBudgetActual
    const positiveBudgetRemaining = Math.max(budgetRemaining, 0)
    const budgetUsagePercent =
      totalBudgetPlanned > 0 ? (totalBudgetActual / totalBudgetPlanned) * 100 : 0

    const overBudgetRows = budgetRows.filter((row) => row.status === 'Over Budget')
    const nearLimitRows = budgetRows.filter(
      (row) => row.status === 'Near Limit' || row.status === 'At Limit'
    )

    const activeGoals = goals
      .filter((goal) => normalize(goal.status || 'active') === 'active')
      .map((goal) => ({
        ...goal,
        progress: getGoalProgress(goal),
        remaining: getGoalRemaining(goal),
        monthlyNeeded: getMonthlyNeededForGoal(goal)
      }))
      .filter((goal) => goal.remaining > 0)
      .sort((a, b) => {
        const priorityDiff = getPriorityRank(a.priority) - getPriorityRank(b.priority)
        if (priorityDiff !== 0) return priorityDiff
        return toNumber(b.monthlyNeeded) - toNumber(a.monthlyNeeded)
      })

    const goalRemainingTotal = activeGoals.reduce((sum, goal) => sum + toNumber(goal.remaining), 0)
    const goalMonthlyNeedTotal = activeGoals.reduce(
      (sum, goal) => sum + toNumber(goal.monthlyNeeded),
      0
    )

    const debtBalanceTotal = liabilities.reduce(
      (sum, item) => sum + toNumber(item.current_balance),
      0
    )
    const debtMinimumTotal = liabilities.reduce(
      (sum, item) => sum + toNumber(item.minimum_payment),
      0
    )

    const debtPaymentsPosted = expenseEntries
      .filter(isDebtPaymentEntry)
      .reduce((sum, entry) => sum + toNumber(entry.amount), 0)

    const debtLikeUnpostedBillsTotal = unpostedBills
      .filter(isDebtLikeBill)
      .reduce((sum, bill) => sum + toNumber(bill.amount), 0)

    const debtMinimumRemaining = Math.max(
      debtMinimumTotal - debtPaymentsPosted - debtLikeUnpostedBillsTotal,
      0
    )

    const essentialReserve = unpostedBillReserve + debtMinimumRemaining
    const cashBalanceInfo = getCashBalanceInfo({
      accounts,
      allCashflowEntries,
      cashWalletLedgers,
      monthInfo
    })
    const cashBufferCurrent = cashBalanceInfo.finalBalance
    const safeToSpend = cashBufferCurrent - essentialReserve
    const allocatableAmount = Math.max(safeToSpend, 0)

    const allocation = buildAllocation({
      amount: allocatableAmount,
      mode: allocationMode
    })

    const essentialMonthlyBurn = Math.max(activeBillTotal + debtMinimumTotal, actualExpenses, 0)
    const cashBufferTarget = essentialMonthlyBurn > 0 ? essentialMonthlyBurn : 1000
    const cashBufferGap = Math.max(cashBufferTarget - cashBufferCurrent, 0)
    const cashBufferPercent =
      cashBufferTarget > 0 ? Math.max(0, Math.min(100, (cashBufferCurrent / cashBufferTarget) * 100)) : 0

    let planStatus = 'Needs Data'
    let planTone = 'neutral'

    if (actualIncome > 0 && safeToSpend > 0 && cashBufferGap <= 0) {
      planStatus = 'Strong'
      planTone = 'success'
    } else if (actualIncome > 0 && safeToSpend > 0) {
      planStatus = 'Flexible'
      planTone = 'success'
    } else if (actualIncome > 0 && safeToSpend <= 0) {
      planStatus = 'Tight'
      planTone = 'warning'
    }

    if (actualIncome > 0 && safeToSpend < -500) {
      planStatus = 'Defensive'
      planTone = 'danger'
    }

    const result = {
      actualIncome,
      actualExpenses,
      postedNet,
      activeMonthlyBills,
      billRows,
      activeBillTotal,
      postedBillTotal,
      unpostedBills,
      upcomingUnpostedBills,
      overdueUnpostedBills,
      unpostedBillReserve,
      upcomingBillReserve,
      budgetRows,
      totalBudgetPlanned,
      totalBudgetActual,
      budgetRemaining,
      positiveBudgetRemaining,
      budgetUsagePercent,
      overBudgetRows,
      nearLimitRows,
      activeGoals,
      goalRemainingTotal,
      goalMonthlyNeedTotal,
      liabilities,
      debtBalanceTotal,
      debtMinimumTotal,
      debtPaymentsPosted,
      debtMinimumRemaining,
      essentialReserve,
      safeToSpend,
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
      accountCount: accounts.length
    }

    return {
      ...result,
      insights: buildInsights(result)
    }
  }, [
    accounts,
    allCashflowEntries,
    allocationMode,
    bills,
    budgets,
    cashflowEntries,
    cashWalletLedgers,
    goals,
    liabilities,
    monthInfo,
    today
  ])

  const selectedMode = ALLOCATION_MODES[allocationMode]
  const topBudgetRows = plan.budgetRows.slice(0, 6)
  const topGoals = plan.activeGoals.slice(0, 5)
  const topBills = plan.unpostedBills.slice(0, 6)
  const topDebts = plan.liabilities.slice(0, 5)

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Bài 37 · Money Plan Pro</div>
          <h1 style={styles.title}>Money Plan Pro</h1>
          <p style={styles.subtitle}>
            Monthly command center for safe-to-spend, bill reserve, debt minimums, goals,
            cash buffer and suggested allocation. This page only reads your current data and does not create new records.
          </p>
        </div>

        <div style={styles.headerRight}>
          <div style={styles.monthBadge}>{monthInfo.label}</div>
          <button type="button" style={styles.refreshButton} onClick={loadMoneyPlan}>
            Refresh Plan
          </button>
        </div>
      </div>

      {message ? <div style={styles.message}>{message}</div> : null}

      {loading ? (
        <div style={styles.loadingCard}>Loading Money Plan Pro...</div>
      ) : (
        <>
          <section style={styles.heroGrid}>
            <div style={styles.heroCard}>
              <div style={styles.cardLabel}>Safe-to-Spend</div>
              <div style={styles.heroStatusRow}>
                <div style={styles.heroValue}>{plan.planStatus}</div>
                <span style={{ ...styles.statusPill, ...getToneStyle(plan.planTone) }}>
                  {plan.safeToSpend >= 0 ? 'Positive' : 'Shortfall'}
                </span>
              </div>

              <div
                style={{
                  ...styles.bigNumber,
                  color: plan.safeToSpend >= 0 ? 'var(--success)' : 'var(--danger)'
                }}
              >
                {formatMoney(plan.safeToSpend)}
              </div>

              <div style={styles.heroSubtext}>
                Current cash balance minus unposted active bills and remaining debt minimum reserve.
              </div>
            </div>

            <StatBox
              label="Income This Month"
              value={formatMoney(plan.actualIncome)}
              sub={`${plan.accountCount} account${plan.accountCount === 1 ? '' : 's'} connected`}
              tone="success"
            />

            <StatBox
              label="Posted Expenses"
              value={formatMoney(plan.actualExpenses)}
              sub={`Posted net: ${formatMoney(plan.postedNet)}`}
              tone={plan.postedNet >= 0 ? 'success' : 'danger'}
            />

            <StatBox
              label="Essential Reserve"
              value={formatMoney(plan.essentialReserve)}
              sub={`Bills ${formatMoney(plan.unpostedBillReserve)} · Debt ${formatMoney(plan.debtMinimumRemaining)}`}
              tone={plan.essentialReserve > 0 ? 'warning' : 'success'}
            />
          </section>

          <section style={styles.gridTwo}>
            <div style={styles.card}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Allocation Mode</h2>
<p style={styles.sectionSubtitle}>
  {selectedMode.description} Default mode from Settings: {appSettings.moneyPlanDefaultMode}.
</p>                </div>
              </div>

              <div style={styles.modeRow}>
                {Object.entries(ALLOCATION_MODES).map(([key, mode]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAllocationMode(key)}
                    style={allocationMode === key ? styles.activeModeButton : styles.modeButton}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {plan.allocatableAmount <= 0 ? (
                <div style={styles.emptyState}>
                  No positive Safe-to-Spend available for allocation yet. Focus on required bills,
                  minimum payments and reducing flexible spending first.
                </div>
              ) : (
                <div style={styles.allocationGrid}>
                  <AllocationItem
                    label="Cash Buffer"
                    value={plan.allocation.buffer}
                    percent={`${selectedMode.buffer}%`}
                    note="Build safety first"
                  />
                  <AllocationItem
                    label="Extra Debt"
                    value={plan.allocation.debt}
                    percent={`${selectedMode.debt}%`}
                    note="Reduce interest"
                  />
                  <AllocationItem
                    label="Goals"
                    value={plan.allocation.goals}
                    percent={`${selectedMode.goals}%`}
                    note="Fund priorities"
                  />
                  <AllocationItem
                    label="Investment DCA"
                    value={plan.allocation.investment}
                    percent={`${selectedMode.investment}%`}
                    note="Long-term growth"
                  />
                </div>
              )}
            </div>

            <div style={styles.card}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Action Center</h2>
                  <p style={styles.sectionSubtitle}>What needs attention this month.</p>
                </div>
              </div>

              <div style={styles.insightList}>
                {plan.insights.map((item, index) => (
                  <div key={`${item.title}-${index}`} style={styles.insightItem}>
                    <span style={{ ...styles.dot, ...getToneStyle(item.tone) }} />
                    <div>
                      <div style={styles.insightTitle}>{item.title}</div>
                      <div style={styles.insightText}>{item.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section style={styles.gridFour}>
            <MiniPanel
              label="Spendable Cash"
              value={formatMoney(plan.cashBufferCurrent)}
              sub={`${formatPercent(plan.cashBufferPercent)} of ${formatMoney(plan.cashBufferTarget)} target · ${plan.cashBufferHasLedger ? 'ledger synced' : 'cashflow fallback'}`}
              tone={plan.cashBufferGap <= 0 ? 'success' : 'warning'}
            />
            <MiniPanel
              label="Unposted Bills"
              value={formatMoney(plan.unpostedBillReserve)}
              sub={`${plan.unpostedBills.length} active monthly bill${plan.unpostedBills.length === 1 ? '' : 's'} not posted`}
              tone={plan.unpostedBillReserve > 0 ? 'warning' : 'success'}
            />
            <MiniPanel
              label="Reserve Cash"
              value={formatMoney(plan.reserveCash)}
              sub={`Savings available if needed · liquid total ${formatMoney(plan.totalLiquidCash)}`}
              tone={plan.reserveCash > 0 ? 'info' : 'neutral'}
            />
            <MiniPanel
              label="Budget Remaining"
              value={formatMoney(plan.budgetRemaining)}
              sub={`${formatPercent(plan.budgetUsagePercent)} used`}
              tone={plan.budgetRemaining >= 0 ? 'success' : 'danger'}
            />
            <MiniPanel
              label="Goal Monthly Need"
              value={formatMoney(plan.goalMonthlyNeedTotal)}
              sub={`${plan.activeGoals.length} active goal${plan.activeGoals.length === 1 ? '' : 's'}`}
              tone={plan.goalMonthlyNeedTotal > 0 ? 'info' : 'success'}
            />
          </section>

          <section style={styles.gridThree}>
            <PlanPanel title="Bills Reserve" subtitle={formatMoney(plan.unpostedBillReserve)}>
              {topBills.length ? (
                <div style={styles.list}>
                  {topBills.map((bill) => (
                    <div key={bill.id} style={styles.listRow}>
                      <div>
                        <div style={styles.listTitle}>{bill.name}</div>
                        <div style={styles.listSub}>
                          Due {bill.dueDateLabel} · {bill.categoryLabel}
                        </div>
                      </div>
                      <div style={styles.rightText}>
                        <div style={bill.isPastDue ? styles.negativeText : styles.warningText}>
                          {formatMoney(bill.amount)}
                        </div>
                        <div style={styles.miniText}>{bill.isPastDue ? 'past due' : 'reserve'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.emptyState}>
                  All active monthly bills appear to be posted to Cashflow for this month.
                </div>
              )}
            </PlanPanel>

            <PlanPanel title="Budget Watch" subtitle={`${formatPercent(plan.budgetUsagePercent)} used`}>
              {topBudgetRows.length ? (
                <div style={styles.list}>
                  {topBudgetRows.map((row) => (
                    <div key={row.id || row.category} style={styles.listRow}>
                      <div>
                        <div style={styles.listTitle}>{row.category}</div>
                        <div style={styles.listSub}>
                          {formatMoney(row.actual)} / {formatMoney(row.planned)}
                        </div>
                      </div>
                      <div style={styles.rightText}>
                        <div style={row.remaining >= 0 ? styles.positiveText : styles.negativeText}>
                          {formatMoney(row.remaining)}
                        </div>
                        <div style={styles.miniText}>{row.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.emptyState}>No budget rows for this month yet.</div>
              )}
            </PlanPanel>

            <PlanPanel
              title="Goals Pace"
              subtitle={`${topGoals.length} active priority goal${topGoals.length === 1 ? '' : 's'}`}
            >
              {topGoals.length ? (
                <div style={styles.list}>
                  {topGoals.map((goal) => (
                    <div key={goal.id} style={styles.listRow}>
                      <div>
                        <div style={styles.listTitle}>{goal.name}</div>
                        <div style={styles.listSub}>
                          {formatPercent(goal.progress)} funded · {goal.priority || 'Medium'}
                        </div>
                      </div>
                      <div style={styles.rightText}>
                        <div style={styles.infoText}>{formatMoney(goal.monthlyNeeded)}</div>
                        <div style={styles.miniText}>needed/mo</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.emptyState}>No active goal needing monthly funding.</div>
              )}
            </PlanPanel>
          </section>

          <section style={styles.gridTwo}>
            <div style={styles.card}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Debt Snapshot</h2>
                  <p style={styles.sectionSubtitle}>
                    Minimum payments and balances from your liabilities data.
                  </p>
                </div>
                <div style={styles.sectionMetric}>
                  {formatMoney(plan.debtMinimumTotal)}
                  <span> minimum/mo</span>
                </div>
              </div>

              {topDebts.length ? (
                <div style={styles.list}>
                  {topDebts.map((debt) => (
                    <div key={debt.id} style={styles.listRow}>
                      <div>
                        <div style={styles.listTitle}>{debt.name}</div>
                        <div style={styles.listSub}>
                          {debt.liability_type || 'Debt'} · APR {formatPercent(debt.interest_rate)}
                        </div>
                      </div>
                      <div style={styles.rightText}>
                        <div style={styles.negativeText}>{formatMoney(debt.current_balance)}</div>
                        <div style={styles.miniText}>Min {formatMoney(debt.minimum_payment)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.emptyState}>No liabilities found.</div>
              )}
            </div>

            <div style={styles.card}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Safe-to-Spend Formula</h2>
                  <p style={styles.sectionSubtitle}>
                    Uses spendable cash first. Savings is shown as reserve cash, but it is not automatically counted as Safe-to-Spend.
                  </p>
                </div>
              </div>

              <div style={styles.formulaBox}>
                <FormulaRow label="Spendable cash" value={plan.cashBufferCurrent} />
                <FormulaRow label="Unposted active bills" value={-plan.unpostedBillReserve} />
                <FormulaRow label="Debt minimum remaining" value={-plan.debtMinimumRemaining} />
                <div style={styles.formulaDivider} />
                <FormulaRow label="Safe-to-Spend" value={plan.safeToSpend} strong />
              </div>

              <div style={styles.noteBox}>
                Source: {plan.cashBufferSourceLabel} Reserve cash is {formatMoney(plan.reserveCash)} and total liquid cash is {formatMoney(plan.totalLiquidCash)}.
                Reserve can still be used for investing or emergencies, but it is not treated as automatic spending money.
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function StatBox({ label, value, sub, tone }) {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'danger'
        ? 'var(--danger)'
        : tone === 'warning'
          ? 'var(--warning)'
          : 'var(--accent)'

  return (
    <div style={styles.statCard}>
      <div style={styles.cardLabel}>{label}</div>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statSub}>{sub}</div>
    </div>
  )
}

function MiniPanel({ label, value, sub, tone }) {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'danger'
        ? 'var(--danger)'
        : tone === 'warning'
          ? 'var(--warning)'
          : 'var(--accent)'

  return (
    <div style={styles.miniPanel}>
      <div style={styles.cardLabel}>{label}</div>
      <div style={{ ...styles.miniPanelValue, color }}>{value}</div>
      <div style={styles.statSub}>{sub}</div>
    </div>
  )
}

function AllocationItem({ label, value, percent, note }) {
  return (
    <div style={styles.allocationItem}>
      <div style={styles.allocationTop}>
        <div style={styles.allocationLabel}>{label}</div>
        <div style={styles.allocationPercent}>{percent}</div>
      </div>
      <div style={styles.allocationValue}>{formatMoney(value)}</div>
      <div style={styles.allocationNote}>{note}</div>
    </div>
  )
}

function PlanPanel({ title, subtitle, children }) {
  return (
    <div style={styles.card}>
      <div style={styles.panelHeader}>
        <div>
          <h2 style={styles.sectionTitle}>{title}</h2>
          <p style={styles.sectionSubtitle}>{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function FormulaRow({ label, value, strong = false, positive = false }) {
  const isPositive = value >= 0 || positive

  return (
    <div style={strong ? styles.formulaRowStrong : styles.formulaRow}>
      <span>{label}</span>
      <strong style={isPositive ? styles.positiveText : styles.negativeText}>
        {value < 0 ? '-' : ''}
        {formatMoney(Math.abs(value))}
      </strong>
    </div>
  )
}

const styles = {
  page: {
    color: 'var(--text-main)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    alignItems: 'flex-start',
    marginBottom: 24
  },
  kicker: {
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 8
  },
  title: {
    margin: 0,
    color: 'var(--text-main)',
    fontSize: 36,
    lineHeight: 1.05,
    letterSpacing: '-0.04em',
    fontWeight: 900
  },
  subtitle: {
    margin: '10px 0 0',
    maxWidth: 820,
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    fontSize: 14
  },
  headerRight: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  monthBadge: {
    border: '1px solid var(--border-main)',
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 800,
    fontSize: 13,
    boxShadow: 'var(--shadow-soft)'
  },
  refreshButton: {
    border: '1px solid var(--accent-strong)',
    background: 'var(--accent-strong)',
    color: 'white',
    borderRadius: 12,
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: 'var(--shadow-soft)'
  },
  message: {
    border: '1px solid var(--warning)',
    background: 'var(--warning-soft)',
    color: 'var(--warning)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 18
  },
  loadingCard: {
    border: '1px solid var(--border-main)',
    background: 'var(--bg-card)',
    borderRadius: 18,
    padding: 24,
    color: 'var(--text-muted)',
    boxShadow: 'var(--shadow-card)'
  },
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 1.35fr) repeat(3, minmax(190px, 1fr))',
    gap: 16,
    marginBottom: 16
  },
  heroCard: {
    border: '1px solid var(--border-main)',
    borderRadius: 20,
    padding: 22,
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    boxShadow: 'var(--shadow-card)'
  },
  statCard: {
    border: '1px solid var(--border-main)',
    borderRadius: 20,
    padding: 18,
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    boxShadow: 'var(--shadow-card)'
  },
  miniPanel: {
    border: '1px solid var(--border-main)',
    borderRadius: 18,
    padding: 18,
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    boxShadow: 'var(--shadow-card)'
  },
  card: {
    border: '1px solid var(--border-main)',
    borderRadius: 20,
    padding: 20,
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    boxShadow: 'var(--shadow-card)'
  },
  cardLabel: {
    color: 'var(--text-soft)',
    fontSize: 13,
    fontWeight: 800
  },
  heroStatusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 12
  },
  heroValue: {
    color: 'var(--text-main)',
    fontSize: 30,
    fontWeight: 900,
    letterSpacing: '-0.04em'
  },
  heroSubtext: {
    marginTop: 12,
    color: 'var(--text-muted)',
    fontSize: 13,
    lineHeight: 1.55,
    maxWidth: 520
  },
  bigNumber: {
    marginTop: 18,
    fontSize: 44,
    fontWeight: 950,
    letterSpacing: '-0.05em'
  },
  statValue: {
    marginTop: 14,
    fontSize: 27,
    fontWeight: 900,
    letterSpacing: '-0.04em'
  },
  miniPanelValue: {
    marginTop: 12,
    fontSize: 25,
    fontWeight: 900,
    letterSpacing: '-0.04em'
  },
  statSub: {
    marginTop: 9,
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.45
  },
  gridTwo: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 16,
    marginBottom: 16
  },
  gridThree: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 16,
    marginBottom: 16
  },
  gridFour: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 16,
    marginBottom: 16
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'flex-start',
    marginBottom: 16
  },
  panelHeader: {
    marginBottom: 16
  },
  sectionTitle: {
    margin: 0,
    color: 'var(--text-main)',
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: '-0.02em'
  },
  sectionSubtitle: {
    margin: '6px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.45
  },
  sectionMetric: {
    color: 'var(--text-main)',
    fontWeight: 900,
    textAlign: 'right'
  },
  modeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16
  },
  modeButton: {
    border: '1px solid var(--border-soft)',
    background: 'var(--bg-card-soft)',
    color: 'var(--text-main)',
    borderRadius: 999,
    padding: '10px 13px',
    cursor: 'pointer',
    fontWeight: 850
  },
  activeModeButton: {
    border: '1px solid var(--accent-strong)',
    background: 'var(--accent-strong)',
    color: 'white',
    borderRadius: 999,
    padding: '10px 13px',
    cursor: 'pointer',
    fontWeight: 850
  },
  allocationGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12
  },
  allocationItem: {
    border: '1px solid var(--border-main)',
    borderRadius: 16,
    padding: 14,
    background: 'var(--bg-card-soft)',
    color: 'var(--text-main)'
  },
  allocationTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center'
  },
  allocationLabel: {
    fontSize: 13,
    color: 'var(--text-soft)',
    fontWeight: 800
  },
  allocationPercent: {
    color: 'var(--accent)',
    fontWeight: 900,
    fontSize: 12
  },
  allocationValue: {
    marginTop: 10,
    color: 'var(--text-main)',
    fontSize: 22,
    fontWeight: 900
  },
  allocationNote: {
    marginTop: 5,
    color: 'var(--text-muted)',
    fontSize: 12
  },
  insightList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  },
  insightItem: {
    display: 'grid',
    gridTemplateColumns: '12px 1fr',
    gap: 11,
    alignItems: 'flex-start',
    border: '1px solid var(--border-main)',
    borderRadius: 16,
    padding: 13,
    background: 'var(--bg-card-soft)',
    color: 'var(--text-main)'
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 5
  },
  insightTitle: {
    color: 'var(--text-main)',
    fontWeight: 900,
    fontSize: 13
  },
  insightText: {
    marginTop: 5,
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.5
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  listRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    border: '1px solid var(--border-main)',
    borderRadius: 15,
    padding: 12,
    background: 'var(--bg-card-soft)',
    color: 'var(--text-main)'
  },
  listTitle: {
    color: 'var(--text-main)',
    fontWeight: 850,
    fontSize: 13
  },
  listSub: {
    marginTop: 5,
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.35
  },
  rightText: {
    textAlign: 'right',
    flexShrink: 0,
    fontWeight: 850
  },
  miniText: {
    color: 'var(--text-muted)',
    fontSize: 11,
    marginTop: 4,
    fontWeight: 700
  },
  emptyState: {
    border: '1px dashed var(--border-soft)',
    borderRadius: 16,
    padding: 16,
    color: 'var(--text-muted)',
    fontSize: 13,
    lineHeight: 1.55,
    background: 'var(--bg-card-soft)'
  },
  formulaBox: {
    border: '1px solid var(--border-main)',
    borderRadius: 16,
    padding: 14,
    background: 'var(--bg-card-soft)',
    color: 'var(--text-main)'
  },
  formulaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    padding: '8px 0',
    color: 'var(--text-soft)',
    fontSize: 13
  },
  formulaRowStrong: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    padding: '10px 0 4px',
    color: 'var(--text-main)',
    fontSize: 15,
    fontWeight: 900
  },
  formulaDivider: {
    height: 1,
    background: 'var(--border-main)',
    margin: '8px 0'
  },
  noteBox: {
    marginTop: 13,
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.55
  },
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 900
  },
  successPill: {
    background: 'var(--success-soft)',
    color: 'var(--success)',
    border: '1px solid var(--success)'
  },
  dangerPill: {
    background: 'var(--danger-soft)',
    color: 'var(--danger)',
    border: '1px solid var(--danger)'
  },
  warningPill: {
    background: 'var(--warning-soft)',
    color: 'var(--warning)',
    border: '1px solid var(--warning)'
  },
  infoPill: {
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    border: '1px solid var(--accent)'
  },
  neutralPill: {
    background: 'var(--bg-card-soft)',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-soft)'
  },
  positiveText: {
    color: 'var(--success)'
  },
  negativeText: {
    color: 'var(--danger)'
  },
  warningText: {
    color: 'var(--warning)'
  },
  infoText: {
    color: 'var(--accent)'
  }
}
