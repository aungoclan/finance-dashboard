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
import { buildMoneyPlanSummary } from '../lib/moneyPlanCalculations'
import {
  buildPortfolioAllocationData,
  buildCashflowChartData,
  buildBudgetChartData
} from '../lib/chartData'

import NetWorthChart from '../components/charts/NetWorthChart'
import PortfolioPieChart from '../components/charts/PortfolioPieChart'
import CashflowBarChart from '../components/charts/CashflowBarChart'
import BudgetChart from '../components/charts/BudgetChart'

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
    reserveCash: 0,
    totalLiquidCash: 0,
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
      const targetMonthKey = `${year}-${pad2(month)}`
      const previousMonthKey = addMonthsToMonthKey(targetMonthKey, -1)

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
        liabilityStatementResult,
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
            source_account_id,
            target_account_id,
            transfer_group_id,
            created_at,
            account:accounts!cashflow_entries_account_id_fkey (
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
          .select('id, account_id, entry_date, type, amount, category, category_id, description, source_account_id, target_account_id, transfer_group_id, created_at')
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
          .from('liability_monthly_statements')
          .select('*')
          .eq('user_id', user.id)
          .eq('month_key', targetMonthKey)
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
          .in('month_key', [targetMonthKey, previousMonthKey])
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
      if (liabilityStatementResult.error) throw liabilityStatementResult.error
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
      const liabilityStatementData = liabilityStatementResult.data || []
      const cashLedgerData = cashLedgerResult.error ? [] : cashLedgerResult.data || []

      const holdingsData = calculateHoldings(txData, pricesData)
      const portfolioSummary = calculatePortfolioSummary(holdingsData)
      const cashflowSummary = calculateCashflowSummary(cashflowData)
      const budgetSummary = calculateBudgetSummary(budgetData, cashflowData)
      const netWorthSummary = calculateNetWorthSummary(
        assetAccountData,
        liabilityData,
        portfolioSummary.totalMarketValue || 0
      )

      const monthInfo = { year, month, monthIndex: month - 1 }
      const moneyPlanSummary = buildMoneyPlanSummary({
        accounts: accountData,
        cashflowEntries: cashflowData,
        allCashflowEntries: allCashflowData,
        cashWalletLedgers: cashLedgerData,
        bills: billData,
        goals: goalData,
        liabilities: liabilityData,
        liabilityStatements: liabilityStatementData,
        budgetRows: budgetSummary.rows || [],
        monthInfo,
        today: new Date(`${getTodayKey()}T00:00:00`)
      })

      const nextMoneyPlan = {
        ...moneyPlanSummary,
        label: moneyPlanSummary.planStatus,
        tone: getDashboardMoneyPlanTone(moneyPlanSummary.planTone),
        income: moneyPlanSummary.actualIncome,
        expense: moneyPlanSummary.actualExpenses,
        goalMonthlyNeed: moneyPlanSummary.goalMonthlyNeedTotal
      }

      const nextSummary = {
        ...portfolioSummary,
        ...cashflowSummary,
        ...budgetSummary,
        ...netWorthSummary,
        cashBalance: moneyPlanSummary.cashBufferCurrent,
        reserveCash: moneyPlanSummary.reserveCash,
        totalLiquidCash: moneyPlanSummary.totalLiquidCash,
        cashBalanceHasLedger: moneyPlanSummary.cashBufferHasLedger,
        cashBalanceSourceLabel: moneyPlanSummary.cashBufferSourceLabel
      }

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
                  ? 'var(--success)'
                  : dataHealth.score >= 65
                    ? 'var(--warning)'
                    : 'var(--danger)'
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
          <div style={styles.cardLabel}>Spendable Cash</div>
          <div
            style={{
              ...styles.scoreValue,
              color: moneyPlan.cashBufferPercent >= 100 ? 'var(--success)' : 'var(--warning)'
            }}
          >
            {loading ? '...' : formatPercent(moneyPlan.cashBufferPercent)}
          </div>
          <div style={styles.note}>
            {money(moneyPlan.cashBufferCurrent)} / {money(moneyPlan.cashBufferTarget)}
            {moneyPlan.cashBufferHasLedger ? ' · ledger/carryover synced · savings reserve' : ' · cashflow fallback · savings reserve'}
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
          label="Spendable Cash"
          value={loading ? '...' : money(summary.cashBalance)}
          tone={summary.cashBalance >= 0 ? 'green' : 'red'}
          note={summary.cashBalanceHasLedger ? 'Ledger/carryover synced · savings excluded' : 'Cashflow fallback · savings excluded'}
        />

        <StatCard
          label="Reserve Cash"
          value={loading ? '...' : money(summary.reserveCash)}
          tone={summary.reserveCash >= 0 ? 'green' : 'red'}
          note={`Total liquid cash: ${money(summary.totalLiquidCash)}`}
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
                          color: toNumber(item.unrealized_pl) >= 0 ? 'var(--success)' : 'var(--danger)'
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
            <SnapshotRow label="Spendable Cash" value={money(summary.cashBalance)} />
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

function getDashboardMoneyPlanTone(planTone) {
  if (planTone === 'success') return 'green'
  if (planTone === 'danger') return 'red'
  return 'yellow'
}

function buildCommandCenter({
  holdingsData,
  budgetRows,
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
  if (tone === 'green' || tone === 'success') return 'var(--success)'
  if (tone === 'red' || tone === 'danger') return 'var(--danger)'
  if (tone === 'yellow' || tone === 'warning') return 'var(--warning)'
  if (tone === 'blue' || tone === 'info') return 'var(--accent)'
  return 'var(--text-main)'
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
    color: 'var(--text-main)'
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
      'linear-gradient(135deg, var(--accent-soft), var(--bg-card) 58%, var(--success-soft))',
    border: '1px solid var(--border-main)',
    boxShadow: 'var(--shadow-card)',
    marginBottom: 18
  },
  eyebrow: {
    color: 'var(--accent)',
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
    letterSpacing: '-0.04em',
    color: 'var(--text-main)'
  },
  subtitle: {
    marginTop: 10,
    marginBottom: 0,
    color: 'var(--text-soft)',
    fontSize: 15,
    lineHeight: 1.55,
    maxWidth: 760
  },
  refreshButton: {
    padding: '12px 16px',
    border: '1px solid color-mix(in srgb, var(--accent) 44%, transparent)',
    borderRadius: 14,
    background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 800,
    boxShadow: 'var(--shadow-soft)'
  },
  errorBox: {
    padding: '14px 16px',
    borderRadius: 14,
    background: 'var(--danger-soft)',
    border: '1px solid color-mix(in srgb, var(--danger) 38%, transparent)',
    color: 'var(--danger)',
    marginBottom: 16,
    fontWeight: 800
  },
  commandGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 16,
    marginBottom: 18
  },
  scoreCard: {
    background: 'var(--bg-card)',
    padding: 20,
    borderRadius: 20,
    border: '1px solid var(--border-main)',
    boxShadow: 'var(--shadow-card)',
    color: 'var(--text-main)'
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
    background: 'var(--bg-card)',
    padding: 18,
    borderRadius: 18,
    minHeight: 126,
    border: '1px solid var(--border-main)',
    boxShadow: 'var(--shadow-card)',
    color: 'var(--text-main)'
  },
  cardLabel: {
    color: 'var(--text-muted)',
    fontSize: 13,
    fontWeight: 850,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 10
  },
  value: {
    fontSize: 28,
    fontWeight: 900,
    color: 'var(--text-main)',
    letterSpacing: '-0.035em'
  },
  note: {
    marginTop: 8,
    color: 'var(--text-muted)',
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
    background: 'var(--bg-card)',
    borderRadius: 20,
    padding: 20,
    border: '1px solid var(--border-main)',
    boxShadow: 'var(--shadow-card)',
    minWidth: 0,
    color: 'var(--text-main)'
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
    letterSpacing: '-0.02em',
    color: 'var(--text-main)'
  },
  panelSubtitle: {
    marginTop: 6,
    marginBottom: 0,
    color: 'var(--text-muted)',
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
    color: 'var(--text-main)',
    padding: 14,
    borderRadius: 15,
    background: 'var(--bg-card-soft)',
    border: '1px solid var(--border-main)'
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 5
  },
  actionTitle: {
    fontWeight: 900,
    fontSize: 14,
    color: 'var(--text-main)'
  },
  actionText: {
    marginTop: 5,
    color: 'var(--text-muted)',
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
    background: 'var(--bg-card-soft)',
    border: '1px solid var(--border-main)',
    color: 'var(--text-main)'
  },
  listTitle: {
    fontSize: 14,
    fontWeight: 900,
    color: 'var(--text-main)'
  },
  listSub: {
    marginTop: 5,
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.35
  },
  rightText: {
    textAlign: 'right',
    flexShrink: 0
  },
  miniText: {
    marginTop: 4,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 750
  },
  greenText: {
    color: 'var(--success)',
    fontWeight: 900
  },
  redText: {
    color: 'var(--danger)',
    fontWeight: 900
  },
  yellowText: {
    color: 'var(--warning)',
    fontWeight: 900
  },
  empty: {
    padding: 18,
    borderRadius: 14,
    background: 'var(--bg-card-soft)',
    border: '1px dashed var(--border-soft)',
    color: 'var(--text-muted)',
    textAlign: 'center',
    lineHeight: 1.45
  },
  snapshotRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    padding: '12px 0',
    borderBottom: '1px solid var(--border-faint)'
  },
  snapshotLabel: {
    color: 'var(--text-muted)'
  },
  snapshotValue: {
    color: 'var(--text-main)',
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
    background: 'var(--warning-soft)',
    color: 'var(--warning)',
    border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
    fontSize: 12,
    fontWeight: 800
  },
  linkButton: {
    display: 'inline-block',
    textDecoration: 'none',
    marginTop: 4,
    padding: '10px 13px',
    borderRadius: 11,
    background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
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
    fontWeight: 900,
    color: 'var(--text-main)'
  },
  chartsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
    gap: 18,
    alignItems: 'stretch'
  },
  chartShell: {
    background: 'var(--bg-card)',
    borderRadius: 20,
    padding: 12,
    border: '1px solid var(--border-main)',
    minHeight: 320,
    minWidth: 0,
    overflow: 'hidden',
    boxShadow: 'var(--shadow-card)',
    color: 'var(--text-main)'
  }
}
