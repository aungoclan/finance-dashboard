import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_APP_SETTINGS, loadUserSettings } from '../lib/appSettings'

const REQUIRED_TABLES = [
  { name: 'accounts', module: 'Accounts / Cash Wallet', critical: true },
  { name: 'cashflow_entries', module: 'Cashflow / Budget / Money Plan', critical: true },
  { name: 'budgets', module: 'Budget Carry-Forward', critical: true },
  { name: 'bills', module: 'Bills Auto-Entry / Rollover', critical: true },
  { name: 'financial_goals', module: 'Goals Funding Pro', critical: true },
  { name: 'investment_transactions', module: 'Investments / Holdings / Dividend', critical: true },
  { name: 'assets', module: 'Holdings / Market Price', critical: true },
  { name: 'price_quotes', module: 'Market Price / Data Health', critical: true },
  { name: 'asset_accounts', module: 'Net Worth', critical: false },
  { name: 'liabilities', module: 'Debt Health / Net Worth', critical: false },
  { name: 'cashflow_categories', module: 'Category Database', critical: false },
  { name: 'cash_wallet_monthly_ledger', module: 'Cash Ledger', critical: false },
  { name: 'user_settings', module: 'Settings Engine', critical: true },
  { name: 'import_jobs', module: 'Import Center', critical: false },
  { name: 'net_worth_snapshots', module: 'Net Worth Snapshot', critical: false }
]

const ROUTE_CHECKS = [
  { name: 'Dashboard Command Center', path: '/' },
  { name: 'Money Plan', path: '/money-plan' },
  { name: 'Month Setup', path: '/month-setup' },
  { name: 'Category Cleanup', path: '/category-cleanup' },
  { name: 'Accounts', path: '/accounts' },
  { name: 'Cash Ledger', path: '/cash-wallet-ledger' },
  { name: 'Cashflow', path: '/cashflow' },
  { name: 'Budget', path: '/budget' },
  { name: 'Bills', path: '/bills' },
  { name: 'Net Worth', path: '/net-worth' },
  { name: 'Investments', path: '/investments' },
  { name: 'Holdings', path: '/holdings' },
  { name: 'Portfolio IQ', path: '/portfolio-intelligence' },
  { name: 'Dividend Income', path: '/dividend-income' },
  { name: 'Goals', path: '/financial-goals' },
  { name: 'Debt Health', path: '/debt-health' },
  { name: 'Debt Payoff', path: '/debt-payoff' },
  { name: 'Debt Strategy', path: '/debt-strategy' },
  { name: 'Data Health', path: '/data-health' },
  { name: 'Imports', path: '/imports' },
  { name: 'Settings', path: '/settings' },
  { name: 'Production Readiness', path: '/production-readiness' }
]

const CHECK_STYLE = {
  good: {
    label: 'Good',
    color: '#86efac',
    bg: 'rgba(34, 197, 94, 0.12)',
    border: 'rgba(34, 197, 94, 0.3)'
  },
  review: {
    label: 'Review',
    color: '#bfdbfe',
    bg: 'rgba(59, 130, 246, 0.12)',
    border: 'rgba(59, 130, 246, 0.3)'
  },
  warning: {
    label: 'Warning',
    color: '#fde68a',
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.3)'
  },
  danger: {
    label: 'Needs Fix',
    color: '#fca5a5',
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.35)'
  }
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function formatMoney(value) {
  const number = toNumber(value)
  return number.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  })
}

function formatPercent(value) {
  const number = toNumber(value)
  return `${number.toFixed(1)}%`
}

function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function getMonthRange(monthKey) {
  const [year, month] = String(monthKey || getMonthKey()).split('-').map(Number)
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear()
  const safeMonth = Number.isFinite(month) ? month : new Date().getMonth() + 1
  const start = new Date(safeYear, safeMonth - 1, 1)
  const end = new Date(safeYear, safeMonth, 1)

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  }
}

function getDaysOld(dateValue) {
  if (!dateValue) return null
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return null
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
}

function isArchivedAccount(account) {
  return String(account?.name || '').startsWith('[ARCHIVED]') || account?.is_archived === true
}

function isCurrentMonthEntry(entry, range) {
  const date = entry?.entry_date || entry?.transaction_date || entry?.date
  return date >= range.startDate && date < range.endDate
}

function getEntryAmount(entry) {
  return Math.abs(toNumber(entry?.amount))
}

function getEntryType(entry) {
  return normalize(entry?.type)
}

function getEntryCategory(entry) {
  return String(entry?.category || entry?.category_name || entry?.category_label || '').trim()
}

function getEntryDescription(entry) {
  return String(entry?.description || entry?.memo || entry?.note || '').trim()
}

function getGoalTarget(goal) {
  return toNumber(goal?.target_amount || goal?.target || goal?.goal_amount)
}

function getGoalCurrent(goal) {
  return toNumber(goal?.current_amount || goal?.saved_amount || goal?.amount_saved)
}

function getLiabilityBalance(liability) {
  return toNumber(liability?.current_balance || liability?.balance || liability?.amount)
}

function getLiabilityApr(liability) {
  return toNumber(liability?.interest_rate || liability?.apr)
}

function getLiabilityMinimumPayment(liability) {
  return toNumber(liability?.minimum_payment || liability?.min_payment || liability?.monthly_payment)
}

function getLatestQuoteMap(priceQuotes = []) {
  const quoteMap = new Map()

  for (const quote of priceQuotes) {
    const assetId = quote.asset_id
    if (!assetId || toNumber(quote.price) <= 0) continue

    const existing = quoteMap.get(assetId)
    const existingDate = existing?.created_at ? new Date(existing.created_at).getTime() : 0
    const nextDate = quote?.created_at ? new Date(quote.created_at).getTime() : 0

    if (!existing || nextDate >= existingDate) {
      quoteMap.set(assetId, quote)
    }
  }

  return quoteMap
}

function makeCheck({ id, title, status, detail, action, source }) {
  return { id, title, status, detail, action, source }
}

async function safeFetchTable(tableName) {
  try {
    const { data, error } = await supabase.from(tableName).select('*').limit(5000)

    if (error) {
      return {
        tableName,
        ok: false,
        data: [],
        error: error.message || `Unable to read ${tableName}`
      }
    }

    return {
      tableName,
      ok: true,
      data: data || [],
      error: ''
    }
  } catch (err) {
    return {
      tableName,
      ok: false,
      data: [],
      error: err.message || `Unable to read ${tableName}`
    }
  }
}

function buildTableChecks(tableResults) {
  return REQUIRED_TABLES.map((table) => {
    const result = tableResults[table.name]

    if (!result?.ok) {
      return makeCheck({
        id: `table-${table.name}`,
        title: table.name,
        status: table.critical ? 'danger' : 'warning',
        detail: `${table.module}: ${result?.error || 'Table not readable.'}`,
        action: table.critical
          ? 'Check Supabase table/schema before production testing.'
          : 'Optional module table. Review only if you use this feature.',
        source: 'Schema'
      })
    }

    return makeCheck({
      id: `table-${table.name}`,
      title: table.name,
      status: 'good',
      detail: `${table.module}: ${result.data.length} rows readable.`,
      action: 'No action needed.',
      source: 'Schema'
    })
  })
}

function buildDataChecks({ tableResults, settings, monthKey }) {
  const range = getMonthRange(monthKey)
  const accounts = tableResults.accounts?.data || []
  const cashflowEntries = tableResults.cashflow_entries?.data || []
  const budgets = tableResults.budgets?.data || []
  const bills = tableResults.bills?.data || []
  const goals = tableResults.financial_goals?.data || []
  const investmentTransactions = tableResults.investment_transactions?.data || []
  const assets = tableResults.assets?.data || []
  const priceQuotes = tableResults.price_quotes?.data || []
  const liabilities = tableResults.liabilities?.data || []
  const ledgers = tableResults.cash_wallet_monthly_ledger?.data || []
  const cashflowCategories = tableResults.cashflow_categories?.data || []

  const accountIds = new Set(accounts.map((account) => account.id).filter(Boolean))
  const archivedAccountIds = new Set(accounts.filter(isArchivedAccount).map((account) => account.id))
  const currentMonthEntries = cashflowEntries.filter((entry) => isCurrentMonthEntry(entry, range))
  const currentMonthIncome = currentMonthEntries
    .filter((entry) => getEntryType(entry) === 'income')
    .reduce((sum, entry) => sum + getEntryAmount(entry), 0)
  const currentMonthExpense = currentMonthEntries
    .filter((entry) => getEntryType(entry) === 'expense')
    .reduce((sum, entry) => sum + getEntryAmount(entry), 0)

  const missingAccountEntries = cashflowEntries.filter((entry) => !entry.account_id)
  const unknownAccountEntries = cashflowEntries.filter(
    (entry) => entry.account_id && !accountIds.has(entry.account_id)
  )
  const archivedAccountEntries = cashflowEntries.filter((entry) => archivedAccountIds.has(entry.account_id))
  const uncategorizedExpenseEntries = cashflowEntries.filter(
    (entry) => getEntryType(entry) === 'expense' && !entry.category_id && !getEntryCategory(entry)
  )

  const duplicateGroups = new Map()
  for (const entry of currentMonthEntries) {
    const key = [
      entry.entry_date || entry.date || '',
      getEntryType(entry),
      entry.account_id || 'no-account',
      getEntryCategory(entry) || 'no-category',
      getEntryAmount(entry).toFixed(2),
      normalize(getEntryDescription(entry))
    ].join('|')
    duplicateGroups.set(key, (duplicateGroups.get(key) || 0) + 1)
  }
  const duplicateCount = [...duplicateGroups.values()].filter((count) => count > 1).length

  const activeBills = bills.filter((bill) => bill?.is_active !== false && bill?.active !== false)
  const billsWithoutAccount = activeBills.filter((bill) => !bill.account_id)
  const billsWithoutCategory = activeBills.filter((bill) => !bill.category_id && !bill.category)
  const billLikeCashflowCategories = cashflowEntries.filter((entry) => normalize(getEntryCategory(entry)).startsWith('bill:'))

  const currentMonthBudgets = budgets.filter((budget) => {
    if (!budget.month && !budget.year && !budget.month_key) return true
    if (budget.month_key) return budget.month_key === monthKey
    const [year, month] = monthKey.split('-').map(Number)
    return Number(budget.month) === month && Number(budget.year) === year
  })

  const quoteMap = getLatestQuoteMap(priceQuotes)
  const assetsMissingQuote = assets.filter((asset) => {
    const type = normalize(asset.asset_type || asset.type)
    if (type === 'cash') return false
    if (asset.is_price_locked && toNumber(asset.locked_price) > 0) return false
    return !quoteMap.has(asset.id)
  })
  const staleQuoteDays = Number(settings?.stalePriceDays || DEFAULT_APP_SETTINGS.stalePriceDays)
  const staleQuotes = [...quoteMap.values()].filter((quote) => {
    const daysOld = getDaysOld(quote.created_at || quote.updated_at)
    return daysOld !== null && daysOld > staleQuoteDays
  })

  const dividendTransactions = investmentTransactions.filter((tx) => {
    const type = normalize(tx.type || tx.transaction_type)
    return type.includes('dividend') || type.includes('interest')
  })

  const incompleteGoals = goals.filter((goal) => getGoalTarget(goal) <= 0)
  const completedGoals = goals.filter((goal) => getGoalTarget(goal) > 0 && getGoalCurrent(goal) >= getGoalTarget(goal))
  const goalsMissingDeadline = goals.filter((goal) => !goal.target_date && !goal.deadline && !goal.due_date)

  const activeDebt = liabilities.filter((liability) => getLiabilityBalance(liability) > 0)
  const debtMissingApr = activeDebt.filter((liability) => getLiabilityApr(liability) <= 0)
  const debtMissingMinimum = activeDebt.filter((liability) => getLiabilityMinimumPayment(liability) <= 0)
  const highAprDebt = activeDebt.filter((liability) => getLiabilityApr(liability) >= 15)

  const currentMonthLedger = ledgers.find((ledger) => ledger.month_key === monthKey)
  const openLedgerCount = ledgers.filter((ledger) => ledger.status !== 'reconciled' || ledger.locked !== true).length

  const checks = []

  checks.push(
    makeCheck({
      id: 'accounts-present',
      title: 'Accounts baseline',
      status: accounts.length > 0 ? 'good' : 'danger',
      detail: accounts.length > 0 ? `${accounts.length} account records found.` : 'No accounts found.',
      action: accounts.length > 0 ? 'No action needed.' : 'Create at least one account before production testing.',
      source: 'Accounts'
    })
  )

  checks.push(
    makeCheck({
      id: 'cashflow-current-month',
      title: 'Current month cashflow activity',
      status: currentMonthEntries.length > 0 ? 'good' : 'review',
      detail:
        currentMonthEntries.length > 0
          ? `${currentMonthEntries.length} entries · Income ${formatMoney(currentMonthIncome)} · Expense ${formatMoney(currentMonthExpense)}.`
          : `No cashflow entries found for ${monthKey}.`,
      action:
        currentMonthEntries.length > 0
          ? 'Review totals only if they look off.'
          : 'This is okay for a blank month, but dashboard cards may show empty states.',
      source: 'Cashflow'
    })
  )

  checks.push(
    makeCheck({
      id: 'cashflow-account-links',
      title: 'Cashflow account links',
      status: missingAccountEntries.length || unknownAccountEntries.length ? 'warning' : 'good',
      detail:
        missingAccountEntries.length || unknownAccountEntries.length
          ? `${missingAccountEntries.length} entries missing account · ${unknownAccountEntries.length} entries point to missing account.`
          : 'All checked cashflow entries have valid account links.',
      action:
        missingAccountEntries.length || unknownAccountEntries.length
          ? 'Open Accounts or Cashflow and assign/fix account_id before production testing.'
          : 'No action needed.',
      source: 'Cashflow / Accounts'
    })
  )

  checks.push(
    makeCheck({
      id: 'archived-account-usage',
      title: 'Archived account usage',
      status: archivedAccountEntries.length ? 'warning' : 'good',
      detail: archivedAccountEntries.length
        ? `${archivedAccountEntries.length} cashflow entries still use archived accounts.`
        : 'No cashflow entries use archived accounts.',
      action: archivedAccountEntries.length
        ? 'Review whether those entries should stay historical or move to an active account.'
        : 'No action needed.',
      source: 'Accounts'
    })
  )

  checks.push(
    makeCheck({
      id: 'duplicate-current-month',
      title: 'Possible duplicate cashflow entries',
      status: duplicateCount ? 'warning' : 'good',
      detail: duplicateCount
        ? `${duplicateCount} duplicate-looking groups found in ${monthKey}.`
        : 'No duplicate-looking cashflow groups found for selected month.',
      action: duplicateCount ? 'Review duplicate-looking entries in Cashflow before relying on reports.' : 'No action needed.',
      source: 'Cashflow'
    })
  )

  checks.push(
    makeCheck({
      id: 'budget-current-month',
      title: 'Budget current month readiness',
      status: currentMonthBudgets.length > 0 ? 'good' : 'review',
      detail: currentMonthBudgets.length
        ? `${currentMonthBudgets.length} budget rows found for ${monthKey}.`
        : `No budget rows found for ${monthKey}.`,
      action: currentMonthBudgets.length
        ? 'No action needed.'
        : 'Run Month Setup or Budget Carry-Forward when you want this month planned.',
      source: 'Budget'
    })
  )

  checks.push(
    makeCheck({
      id: 'category-database',
      title: 'Category database usage',
      status: cashflowCategories.length > 0 ? 'good' : 'review',
      detail: cashflowCategories.length
        ? `${cashflowCategories.length} category records available.`
        : `${uncategorizedExpenseEntries.length} uncategorized expense entries found; category table has no readable rows.`,
      action: cashflowCategories.length
        ? 'No action needed.'
        : 'Run category cleanup only if category dropdowns or reporting look inconsistent.',
      source: 'Categories'
    })
  )

  checks.push(
    makeCheck({
      id: 'bill-template-quality',
      title: 'Bill template quality',
      status: billsWithoutAccount.length || billsWithoutCategory.length || billLikeCashflowCategories.length ? 'warning' : 'good',
      detail:
        billsWithoutAccount.length || billsWithoutCategory.length || billLikeCashflowCategories.length
          ? `${billsWithoutAccount.length} active bills missing account · ${billsWithoutCategory.length} missing category · ${billLikeCashflowCategories.length} legacy Bill: categories in cashflow.`
          : 'Bills look ready: account/category structure is clean.',
      action:
        billsWithoutAccount.length || billsWithoutCategory.length || billLikeCashflowCategories.length
          ? 'Fix bill account/category before using monthly rollover heavily.'
          : 'No action needed.',
      source: 'Bills'
    })
  )

  checks.push(
    makeCheck({
      id: 'cash-ledger-current-month',
      title: 'Cash Ledger monthly close',
      status: currentMonthLedger ? (currentMonthLedger.status === 'reconciled' ? 'good' : 'review') : 'review',
      detail: currentMonthLedger
        ? `Ledger exists for ${monthKey}: status ${currentMonthLedger.status || 'open'} · locked ${currentMonthLedger.locked ? 'yes' : 'no'}.`
        : `No Cash Ledger record saved for ${monthKey}.`,
      action: currentMonthLedger
        ? 'Reconcile and lock after actual cash count is final.'
        : 'Create the month snapshot only when you are ready to close cash for the month.',
      source: 'Cash Ledger'
    })
  )

  checks.push(
    makeCheck({
      id: 'cash-ledger-open-count',
      title: 'Open Cash Ledger months',
      status: openLedgerCount > 3 ? 'warning' : 'good',
      detail: `${openLedgerCount} ledger months are not fully reconciled/locked.`,
      action: openLedgerCount > 3 ? 'Close older months to keep Cash Wallet reporting clean.' : 'No action needed.',
      source: 'Cash Ledger'
    })
  )

  checks.push(
    makeCheck({
      id: 'market-price-readiness',
      title: 'Market price readiness',
      status: assetsMissingQuote.length || staleQuotes.length ? 'warning' : 'good',
      detail: `${assetsMissingQuote.length} assets missing quote · ${staleQuotes.length} quotes older than ${staleQuoteDays} days.`,
      action:
        assetsMissingQuote.length || staleQuotes.length
          ? 'Refresh prices or lock manual prices for special assets before production testing.'
          : 'No action needed.',
      source: 'Holdings / Prices'
    })
  )

  checks.push(
    makeCheck({
      id: 'dividend-tracker-readiness',
      title: 'Dividend tracker readiness',
      status: dividendTransactions.length ? 'good' : 'review',
      detail: dividendTransactions.length
        ? `${dividendTransactions.length} dividend/interest transactions found.`
        : 'No dividend/interest transactions found yet.',
      action: dividendTransactions.length
        ? 'No action needed.'
        : 'This is fine if you have not started tracking dividends yet.',
      source: 'Dividend Income'
    })
  )

  checks.push(
    makeCheck({
      id: 'goals-readiness',
      title: 'Goals funding data quality',
      status: incompleteGoals.length || goalsMissingDeadline.length ? 'review' : 'good',
      detail: `${goals.length} goals · ${completedGoals.length} completed · ${incompleteGoals.length} missing target · ${goalsMissingDeadline.length} missing deadline.`,
      action:
        incompleteGoals.length || goalsMissingDeadline.length
          ? 'Add target/deadline for goals that should receive funding suggestions.'
          : 'No action needed.',
      source: 'Goals'
    })
  )

  checks.push(
    makeCheck({
      id: 'debt-readiness',
      title: 'Debt health data quality',
      status: debtMissingApr.length || debtMissingMinimum.length || highAprDebt.length ? 'warning' : 'good',
      detail: `${activeDebt.length} active debts · ${debtMissingApr.length} missing APR · ${debtMissingMinimum.length} missing min payment · ${highAprDebt.length} high APR.`,
      action:
        debtMissingApr.length || debtMissingMinimum.length
          ? 'Add APR and minimum payment so Debt Health can rank debt correctly.'
          : highAprDebt.length
            ? 'Review high APR payoff priority.'
            : 'No action needed.',
      source: 'Debt Health'
    })
  )

  return checks
}

function buildStaticChecks() {
  return [
    makeCheck({
      id: 'local-first-workflow',
      title: 'Local-first workflow',
      status: 'good',
      detail: 'Project is being completed locally before GitHub/Vercel production testing.',
      action: 'Continue testing with npm run dev and npm run build.',
      source: 'Workflow'
    }),
    makeCheck({
      id: 'recent-module-boundary',
      title: 'Recent module boundaries',
      status: 'good',
      detail: 'Dividend, Cash Ledger, Debt Health, and Goals Funding are separated instead of auto-syncing everything together.',
      action: 'Keep major modules read-only or manual-action-first unless automation is clearly needed.',
      source: 'Architecture'
    }),
    makeCheck({
      id: 'cashflow-protection',
      title: 'Cashflow protection',
      status: 'good',
      detail: 'Recent features avoid silently posting to Cashflow except user-triggered actions such as Cash Adjustment or Post Dividend.',
      action: 'Before adding future automation, add preview/confirm screens first.',
      source: 'Architecture'
    })
  ]
}

function summarizeChecks(checks) {
  const counts = checks.reduce(
    (summary, check) => {
      summary[check.status] += 1
      return summary
    },
    { good: 0, review: 0, warning: 0, danger: 0 }
  )

  const score = Math.max(
    0,
    Math.round(
      100 - counts.danger * 18 - counts.warning * 8 - counts.review * 3
    )
  )

  let status = 'Production-Ready Local'
  let tone = 'good'

  if (counts.danger > 0) {
    status = 'Fix Required'
    tone = 'danger'
  } else if (counts.warning > 0) {
    status = 'Ready With Warnings'
    tone = 'warning'
  } else if (counts.review > 0) {
    status = 'Ready For Local Review'
    tone = 'review'
  }

  return { counts, score, status, tone }
}

export default function ProductionReadinessPage() {
  const [monthKey, setMonthKey] = useState(getMonthKey())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS)
  const [tableResults, setTableResults] = useState({})
  const [activeFilter, setActiveFilter] = useState('all')

  useEffect(() => {
    loadAudit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey])

  async function loadAudit() {
    setLoading(true)
    setRefreshing(true)
    setError('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError) throw userError
      if (!user) throw new Error('Unable to get current user.')

      const [loadedSettings, ...results] = await Promise.all([
        loadUserSettings().catch(() => DEFAULT_APP_SETTINGS),
        ...REQUIRED_TABLES.map((table) => safeFetchTable(table.name))
      ])

      const nextResults = results.reduce((map, result) => {
        map[result.tableName] = result
        return map
      }, {})

      setSettings(loadedSettings)
      setTableResults(nextResults)
    } catch (err) {
      setError(err.message || 'Unable to run readiness audit.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const tableChecks = useMemo(() => buildTableChecks(tableResults), [tableResults])

  const dataChecks = useMemo(
    () => buildDataChecks({ tableResults, settings, monthKey }),
    [tableResults, settings, monthKey]
  )

  const staticChecks = useMemo(() => buildStaticChecks(), [])

  const allChecks = useMemo(() => {
    return [...tableChecks, ...dataChecks, ...staticChecks]
  }, [tableChecks, dataChecks, staticChecks])

  const summary = useMemo(() => summarizeChecks(allChecks), [allChecks])

  const filteredChecks = useMemo(() => {
    if (activeFilter === 'all') return allChecks
    return allChecks.filter((check) => check.status === activeFilter)
  }, [allChecks, activeFilter])

  const topFixes = useMemo(() => {
    return allChecks.filter((check) => ['danger', 'warning'].includes(check.status)).slice(0, 8)
  }, [allChecks])

  if (loading) {
    return (
      <div style={pageStyle}>
        <section style={heroStyle}>
          <div>
            <div style={eyebrowStyle}>LOCAL PRODUCTION READINESS</div>
            <h1 style={titleStyle}>Production Readiness</h1>
            <p style={subtitleStyle}>Running local audit across routes, schema, settings, and core data.</p>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>BÀI 51 · LOCAL PRODUCTION READINESS</div>
          <h1 style={titleStyle}>Production Readiness Center</h1>
          <p style={subtitleStyle}>
            Final local audit for core modules before production-style testing. This page is read-only and does not change data.
          </p>
        </div>

        <div style={heroActionsStyle}>
          <label style={fieldLabelStyle}>
            Audit month
            <input
              type="month"
              value={monthKey}
              onChange={(event) => setMonthKey(event.target.value)}
              style={inputStyle}
            />
          </label>
          <button type="button" onClick={loadAudit} disabled={refreshing} style={primaryButtonStyle}>
            {refreshing ? 'Refreshing...' : 'Refresh Audit'}
          </button>
        </div>
      </section>

      {error && <div style={errorBoxStyle}>{error}</div>}

      <section style={summaryGridStyle}>
        <div style={scoreCardStyle}>
          <div style={scoreCircleStyle}>{summary.score}</div>
          <div>
            <div style={mutedLabelStyle}>Readiness Score</div>
            <h2 style={{ margin: '4px 0', color: CHECK_STYLE[summary.tone].color }}>{summary.status}</h2>
            <p style={smallTextStyle}>Score is local guidance only. Final truth is still npm run build plus manual page testing.</p>
          </div>
        </div>

        <StatPill label="Good" value={summary.counts.good} tone="good" />
        <StatPill label="Review" value={summary.counts.review} tone="review" />
        <StatPill label="Warnings" value={summary.counts.warning} tone="warning" />
        <StatPill label="Needs Fix" value={summary.counts.danger} tone="danger" />
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Recommended next fixes</h2>
            <p style={sectionSubtitleStyle}>Only items that can affect production-style testing are listed here.</p>
          </div>
        </div>

        {topFixes.length === 0 ? (
          <div style={emptyStateStyle}>No blocking warnings found. Continue with npm run dev and npm run build testing.</div>
        ) : (
          <div style={stackStyle}>
            {topFixes.map((check) => (
              <CheckRow key={check.id} check={check} compact />
            ))}
          </div>
        )}
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Route checklist</h2>
            <p style={sectionSubtitleStyle}>Use these links during local QA to catch blank pages, route mistakes, and layout regressions.</p>
          </div>
        </div>

        <div style={routeGridStyle}>
          {ROUTE_CHECKS.map((route) => (
            <a key={route.path} href={route.path} style={routeLinkStyle}>
              <span>{route.name}</span>
              <strong>{route.path}</strong>
            </a>
          ))}
        </div>
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Full audit checklist</h2>
            <p style={sectionSubtitleStyle}>Schema, data integrity, module boundaries, and recent feature readiness.</p>
          </div>

          <div style={filterRowStyle}>
            {['all', 'danger', 'warning', 'review', 'good'].map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                style={filter === activeFilter ? activeFilterButtonStyle : filterButtonStyle}
              >
                {filter === 'all' ? 'All' : CHECK_STYLE[filter].label}
              </button>
            ))}
          </div>
        </div>

        <div style={stackStyle}>
          {filteredChecks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Manual test flow</h2>
            <p style={sectionSubtitleStyle}>Run this local flow after Bài 46–51 changes.</p>
          </div>
        </div>

        <div style={manualGridStyle}>
          {[
            'Open Dashboard and confirm cards render without blank blocks.',
            'Open Cashflow, Budget, Bills, Accounts, and Cash Ledger for the selected month.',
            'Open Dividend Income and confirm Track Only / Reinvested / Post to Cashflow modes are clear.',
            'Open Goals and test one manual contribution with a small test goal if needed.',
            'Open Debt Health and confirm ratios do not look obviously wrong.',
            'Run npm run build after page-by-page local QA.'
          ].map((item, index) => (
            <div key={item} style={manualItemStyle}>
              <span style={manualIndexStyle}>{index + 1}</span>
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function StatPill({ label, value, tone }) {
  const style = CHECK_STYLE[tone]
  return (
    <div style={{ ...statPillStyle, borderColor: style.border, background: style.bg }}>
      <div style={{ ...statValueStyle, color: style.color }}>{value}</div>
      <div style={mutedLabelStyle}>{label}</div>
    </div>
  )
}

function CheckRow({ check, compact = false }) {
  const style = CHECK_STYLE[check.status] || CHECK_STYLE.review

  return (
    <article style={{ ...checkRowStyle, borderColor: style.border, background: style.bg }}>
      <div style={checkHeaderStyle}>
        <div>
          <div style={checkTitleStyle}>{check.title}</div>
          <div style={checkSourceStyle}>{check.source}</div>
        </div>
        <span style={{ ...badgeStyle, color: style.color, borderColor: style.border }}>{style.label}</span>
      </div>

      <p style={compact ? compactDetailStyle : checkDetailStyle}>{check.detail}</p>
      {!compact && <p style={checkActionStyle}>{check.action}</p>}
    </article>
  )
}

const pageStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '22px',
  color: '#e5e7eb'
}

const heroStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '20px',
  padding: '24px',
  borderRadius: '24px',
  background:
    'radial-gradient(circle at top left, rgba(59, 130, 246, 0.22), transparent 34%), linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(17, 24, 39, 0.92))',
  border: '1px solid rgba(148, 163, 184, 0.2)',
  boxShadow: '0 22px 60px rgba(0, 0, 0, 0.28)'
}

const eyebrowStyle = {
  fontSize: '12px',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: '#93c5fd',
  fontWeight: 800,
  marginBottom: '10px'
}

const titleStyle = {
  margin: 0,
  fontSize: '34px',
  lineHeight: 1.08,
  letterSpacing: '-0.04em'
}

const subtitleStyle = {
  margin: '12px 0 0',
  color: '#cbd5e1',
  maxWidth: '760px',
  lineHeight: 1.65
}

const heroActionsStyle = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: '12px',
  flexWrap: 'wrap'
}

const fieldLabelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '7px',
  color: '#cbd5e1',
  fontSize: '12px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.08em'
}

const inputStyle = {
  minHeight: '42px',
  minWidth: '170px',
  borderRadius: '14px',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(15, 23, 42, 0.9)',
  color: '#e5e7eb',
  padding: '0 12px',
  outline: 'none'
}

const primaryButtonStyle = {
  minHeight: '42px',
  border: '1px solid rgba(147, 197, 253, 0.45)',
  borderRadius: '14px',
  background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.95), rgba(14, 165, 233, 0.78))',
  color: '#eff6ff',
  fontWeight: 900,
  padding: '0 16px',
  cursor: 'pointer'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 2fr) repeat(4, minmax(130px, 1fr))',
  gap: '14px'
}

const scoreCardStyle = {
  display: 'flex',
  gap: '16px',
  alignItems: 'center',
  padding: '18px',
  borderRadius: '22px',
  background: 'rgba(15, 23, 42, 0.82)',
  border: '1px solid rgba(148, 163, 184, 0.18)'
}

const scoreCircleStyle = {
  width: '82px',
  height: '82px',
  borderRadius: '999px',
  display: 'grid',
  placeItems: 'center',
  fontSize: '28px',
  fontWeight: 950,
  color: '#dbeafe',
  border: '1px solid rgba(147, 197, 253, 0.35)',
  background: 'rgba(30, 64, 175, 0.24)'
}

const statPillStyle = {
  padding: '18px',
  borderRadius: '20px',
  border: '1px solid rgba(148, 163, 184, 0.18)'
}

const statValueStyle = {
  fontSize: '26px',
  fontWeight: 950,
  marginBottom: '4px'
}

const mutedLabelStyle = {
  color: '#94a3b8',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight: 800
}

const smallTextStyle = {
  margin: 0,
  color: '#94a3b8',
  fontSize: '13px',
  lineHeight: 1.5
}

const panelStyle = {
  padding: '20px',
  borderRadius: '24px',
  background: 'rgba(15, 23, 42, 0.82)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.18)'
}

const sectionHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  marginBottom: '16px',
  flexWrap: 'wrap'
}

const sectionTitleStyle = {
  margin: 0,
  fontSize: '21px',
  letterSpacing: '-0.02em'
}

const sectionSubtitleStyle = {
  margin: '6px 0 0',
  color: '#94a3b8',
  lineHeight: 1.5
}

const stackStyle = {
  display: 'grid',
  gap: '12px'
}

const checkRowStyle = {
  padding: '16px',
  borderRadius: '18px',
  border: '1px solid rgba(148, 163, 184, 0.18)'
}

const checkHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px'
}

const checkTitleStyle = {
  fontWeight: 900,
  color: '#f8fafc',
  marginBottom: '3px'
}

const checkSourceStyle = {
  color: '#94a3b8',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight: 800
}

const badgeStyle = {
  flexShrink: 0,
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: '999px',
  padding: '6px 10px',
  fontSize: '12px',
  fontWeight: 900
}

const checkDetailStyle = {
  margin: '12px 0 0',
  color: '#e2e8f0',
  lineHeight: 1.55
}

const compactDetailStyle = {
  margin: '10px 0 0',
  color: '#e2e8f0',
  lineHeight: 1.45
}

const checkActionStyle = {
  margin: '8px 0 0',
  color: '#cbd5e1',
  fontSize: '13px',
  lineHeight: 1.5
}

const filterRowStyle = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap'
}

const filterButtonStyle = {
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(15, 23, 42, 0.7)',
  color: '#cbd5e1',
  borderRadius: '999px',
  padding: '8px 11px',
  cursor: 'pointer',
  fontWeight: 800
}

const activeFilterButtonStyle = {
  ...filterButtonStyle,
  background: 'rgba(59, 130, 246, 0.22)',
  color: '#dbeafe',
  borderColor: 'rgba(147, 197, 253, 0.45)'
}

const routeGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '10px'
}

const routeLinkStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '14px',
  borderRadius: '16px',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  background: 'rgba(2, 6, 23, 0.34)',
  color: '#e5e7eb',
  textDecoration: 'none'
}

const manualGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '12px'
}

const manualItemStyle = {
  display: 'flex',
  gap: '12px',
  alignItems: 'flex-start',
  padding: '15px',
  borderRadius: '18px',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  background: 'rgba(2, 6, 23, 0.32)',
  color: '#cbd5e1',
  lineHeight: 1.5
}

const manualIndexStyle = {
  width: '26px',
  height: '26px',
  flexShrink: 0,
  borderRadius: '999px',
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(59, 130, 246, 0.2)',
  color: '#bfdbfe',
  fontWeight: 950
}

const emptyStateStyle = {
  padding: '18px',
  borderRadius: '18px',
  border: '1px solid rgba(34, 197, 94, 0.26)',
  background: 'rgba(34, 197, 94, 0.1)',
  color: '#bbf7d0',
  fontWeight: 800
}

const errorBoxStyle = {
  padding: '15px 16px',
  borderRadius: '18px',
  border: '1px solid rgba(248, 113, 113, 0.35)',
  background: 'rgba(127, 29, 29, 0.24)',
  color: '#fecaca',
  fontWeight: 800
}
