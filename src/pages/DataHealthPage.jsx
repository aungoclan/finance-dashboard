import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_APP_SETTINGS, isStalePrice, loadUserSettings } from '../lib/appSettings'
import { refreshAllMarketPrices } from '../lib/marketPrice'
import { calculateHoldings, formatMoney, formatPercent } from '../lib/holdings'
import { getCategoryDisplayName, normalizeCategoryName } from '../lib/cashflowCategories'

const ACCOUNT_TYPES = [
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

const ASSET_TYPE_OPTIONS = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' }
]

const ISSUE_SEVERITY = {
  error: {
    label: 'Needs Fix',
    color: 'var(--danger)',
    bg: 'color-mix(in srgb, var(--danger) 12%, transparent)',
    border: 'var(--danger)'
  },
  warning: {
    label: 'Warning',
    color: 'var(--warning)',
    bg: 'color-mix(in srgb, var(--warning) 12%, transparent)',
    border: 'var(--warning)'
  },
  info: {
    label: 'Review',
    color: 'var(--accent-strong)',
    bg: 'color-mix(in srgb, var(--accent-strong) 12%, transparent)',
    border: 'var(--accent-strong)'
  },
  good: {
    label: 'Good',
    color: 'var(--success)',
    bg: 'color-mix(in srgb, var(--success) 12%, transparent)',
    border: 'var(--success)'
  }
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function isArchivedAccount(account) {
  return String(account?.name || '').startsWith('[ARCHIVED]')
}

function isValidAccountType(type) {
  return ACCOUNT_TYPES.includes(type)
}

function isBillLikeCategory(category) {
  return normalize(category).startsWith('bill:')
}

function getCurrentMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  }
}

function getCurrentMonthDueDate(dueDay) {
  const now = new Date()
  const year = now.getFullYear()
  const monthIndex = now.getMonth()
  const maxDay = new Date(year, monthIndex + 1, 0).getDate()
  const safeDay = Math.min(Math.max(Number(dueDay || 1), 1), maxDay)
  const date = new Date(year, monthIndex, safeDay)

  return date.toISOString().slice(0, 10)
}

function getBillDescription(bill) {
  const name = String(bill?.name || '').trim()
  return name ? `Bill: ${name}` : 'Bill'
}

function hasBillCashflowEntry(entries, bill) {
  const targetDate = getCurrentMonthDueDate(bill.due_day)
  const targetDescription = normalize(getBillDescription(bill))
  const targetAmount = toNumber(bill.amount)

  return entries.some((entry) => {
    const sameDate = entry.entry_date === targetDate
    const sameType = entry.type === 'expense'
    const sameAmount = Math.abs(toNumber(entry.amount) - targetAmount) < 0.005
    const sameDescription = normalize(entry.description) === targetDescription

    return sameDate && sameType && sameAmount && sameDescription
  })
}

function getLatestQuoteMap(priceQuotes = []) {
  const map = new Map()

  for (const quote of priceQuotes) {
    const assetId = quote.asset_id
    const price = toNumber(quote.price)

    if (!assetId || price <= 0) continue
    if (!map.has(assetId)) map.set(assetId, quote)
  }

  return map
}

function getDaysOld(dateValue) {
  if (!dateValue) return null

  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return null

  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
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

function buildCurrentMonthCategoryHealth({ budgets, cashflowEntries }) {
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

  const expenseWithoutBudget = [...expenseKeys]
    .filter((key) => !budgetKeys.has(key))
    .map((key) => expenseNames.get(key))
    .filter(Boolean)

  const budgetWithoutExpense = [...budgetKeys]
    .filter((key) => !expenseKeys.has(key))
    .map((key) => budgetNames.get(key))
    .filter(Boolean)

  return {
    expenseWithoutBudget: [...new Set(expenseWithoutBudget)],
    budgetWithoutExpense: [...new Set(budgetWithoutExpense)]
  }
}

export default function DataHealthPage() {
  const [accounts, setAccounts] = useState([])
  const [cashflowEntries, setCashflowEntries] = useState([])
  const [budgets, setBudgets] = useState([])
  const [bills, setBills] = useState([])
  const [assets, setAssets] = useState([])
  const [transactions, setTransactions] = useState([])
  const [priceQuotes, setPriceQuotes] = useState([])
  const [refreshDetails, setRefreshDetails] = useState([])

  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [sectionFilter, setSectionFilter] = useState('all')

  const [manualAssetId, setManualAssetId] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const [lockManualPrice, setLockManualPrice] = useState(false)

  const currentMonth = useMemo(() => getCurrentMonthRange(), [])

  useEffect(() => {
    loadDataHealth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadDataHealth() {
    setLoading(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const [
        accountResult,
        cashflowResult,
        budgetResult,
        billResult,
        txResult,
        assetResult,
        quoteResult
      ] = await Promise.all([
        supabase
          .from('accounts')
          .select('*')
          .eq('user_id', user.id)
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
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(2000),

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
          .order('year', { ascending: false })
          .order('month', { ascending: false })
          .order('category', { ascending: true })
          .limit(2000),

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
          .from('investment_transactions')
          .select(`
            id,
            user_id,
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
          .from('assets')
          .select(`
            id,
            symbol,
            display_name,
            asset_type,
            is_price_locked,
            locked_price,
            price_locked_at,
            price_lock_note
          `)
          .order('symbol', { ascending: true }),

        supabase
          .from('price_quotes')
          .select(`
            id,
            asset_id,
            price,
            created_at
          `)
          .order('created_at', { ascending: false })
      ])

      if (accountResult.error) throw accountResult.error
      if (cashflowResult.error) throw cashflowResult.error
      if (budgetResult.error) throw budgetResult.error
      if (billResult.error) throw billResult.error
      if (txResult.error) throw txResult.error
      if (assetResult.error) throw assetResult.error
      if (quoteResult.error) throw quoteResult.error

      setAccounts(accountResult.data || [])
      setCashflowEntries(cashflowResult.data || [])
      setBudgets(budgetResult.data || [])
      setBills(billResult.data || [])
      setTransactions(txResult.data || [])
      setAssets(assetResult.data || [])
      setPriceQuotes(quoteResult.data || [])
    } catch (error) {
      console.error('loadDataHealth error:', error)
      setMessage(error.message || 'Failed to load Data Health')
    } finally {
      setLoading(false)
    }
  }

  async function handleRunPriceCheck() {
    setRefreshing(true)
    setMessage('Updating market prices...')
    setRefreshDetails([])

    try {
      const result = await refreshAllMarketPrices()
      setRefreshDetails(result.details || [])
      setMessage(result.message || 'Market price check completed')
      await loadDataHealth()
    } catch (error) {
      console.error('handleRunPriceCheck error:', error)
      setMessage(error.message || 'Failed to refresh market prices')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleSetAssetType(assetId, nextType) {
    if (!assetId || !nextType) return

    setSaving(true)
    setMessage('')

    try {
      const { error } = await supabase
        .from('assets')
        .update({ asset_type: nextType })
        .eq('id', assetId)

      if (error) throw error

      setMessage(`Asset type updated to ${nextType}`)
      await loadDataHealth()
    } catch (error) {
      console.error('handleSetAssetType error:', error)
      setMessage(error.message || 'Failed to update asset type')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveManualPrice(e) {
    e.preventDefault()

    if (!manualAssetId) {
      setMessage('Please select an asset first')
      return
    }

    const numericPrice = Number(manualPrice)

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setMessage('Please enter a valid price greater than 0')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const { error: quoteError } = await supabase
        .from('price_quotes')
        .insert({
          asset_id: manualAssetId,
          price: numericPrice
        })

      if (quoteError) throw quoteError

      if (lockManualPrice) {
        const { error: lockError } = await supabase
          .from('assets')
          .update({
            is_price_locked: true,
            locked_price: numericPrice,
            price_lock_note: 'Manual lock from Data Health Pro',
            price_locked_at: new Date().toISOString()
          })
          .eq('id', manualAssetId)

        if (lockError) throw lockError
      }

      setManualAssetId('')
      setManualPrice('')
      setLockManualPrice(false)
      setMessage(lockManualPrice ? 'Manual price saved and locked' : 'Manual price saved')
      await loadDataHealth()
    } catch (error) {
      console.error('handleSaveManualPrice error:', error)
      setMessage(error.message || 'Failed to save manual price')
    } finally {
      setSaving(false)
    }
  }

  async function handleLockLatestPrice(assetId, price) {
    const numericPrice = Number(price)

    if (!assetId || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setMessage('No valid latest price available to lock')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const { error } = await supabase
        .from('assets')
        .update({
          is_price_locked: true,
          locked_price: numericPrice,
          price_lock_note: 'Locked from latest quote in Data Health Pro',
          price_locked_at: new Date().toISOString()
        })
        .eq('id', assetId)

      if (error) throw error

      setMessage('Latest price locked successfully')
      await loadDataHealth()
    } catch (error) {
      console.error('handleLockLatestPrice error:', error)
      setMessage(error.message || 'Failed to lock latest price')
    } finally {
      setSaving(false)
    }
  }

  async function handleUnlockPrice(assetId) {
    if (!assetId) return

    setSaving(true)
    setMessage('')

    try {
      const { error } = await supabase
        .from('assets')
        .update({
          is_price_locked: false,
          locked_price: null,
          price_lock_note: null,
          price_locked_at: null
        })
        .eq('id', assetId)

      if (error) throw error

      setMessage('Price unlocked successfully')
      await loadDataHealth()
    } catch (error) {
      console.error('handleUnlockPrice error:', error)
      setMessage(error.message || 'Failed to unlock price')
    } finally {
      setSaving(false)
    }
  }

  const analysis = useMemo(() => {
    const currentMonthCashflow = cashflowEntries.filter(
      (entry) =>
        entry.entry_date >= currentMonth.startDate &&
        entry.entry_date < currentMonth.endDate
    )

    const currentMonthBudgets = budgets.filter(
      (budget) => Number(budget.month) === currentMonth.month && Number(budget.year) === currentMonth.year
    )

    const activeMonthlyBills = bills.filter(
      (bill) => bill.status === 'active' && bill.frequency === 'monthly'
    )

    const holdings = calculateHoldings(transactions, priceQuotes)
    const latestQuoteMap = getLatestQuoteMap(priceQuotes)
    const categoryHealth = buildCurrentMonthCategoryHealth({
      budgets: currentMonthBudgets,
      cashflowEntries: currentMonthCashflow
    })

    const issues = []

    function addIssue({ severity, section, title, detail, count = 1, action, sample }) {
      issues.push({
        id: `${section}-${title}-${issues.length}`,
        severity,
        section,
        title,
        detail,
        count,
        action,
        sample
      })
    }

    const activeAccounts = accounts.filter((account) => !isArchivedAccount(account))
    const hasCashWallet = activeAccounts.some((account) => account.account_type === 'cash')

    if (!hasCashWallet) {
      addIssue({
        severity: 'warning',
        section: 'Accounts',
        title: 'No Cash Wallet account found',
        detail: 'Create or edit one account to type Cash Wallet if you track physical cash, cash received, or cash waiting to deposit.',
        action: 'Go to Accounts and set your Cash account type to Cash Wallet.'
      })
    }

    const nonStandardAccounts = accounts.filter(
      (account) => !isValidAccountType(account.account_type)
    )

    if (nonStandardAccounts.length > 0) {
      addIssue({
        severity: 'warning',
        section: 'Accounts',
        title: 'Non-standard account type',
        detail: `${nonStandardAccounts.length} account${nonStandardAccounts.length === 1 ? '' : 's'} use an old or unknown account type.`,
        count: nonStandardAccounts.length,
        action: 'Go to Accounts and edit each account to a standard account type.',
        sample: nonStandardAccounts.slice(0, 4).map((item) => item.name).join(', ')
      })
    }

    const unassignedCashflow = cashflowEntries.filter((entry) => !entry.account_id)
    if (unassignedCashflow.length > 0) {
      addIssue({
        severity: 'error',
        section: 'Cashflow',
        title: 'Cashflow entries missing account',
        detail: `${unassignedCashflow.length} cashflow entr${unassignedCashflow.length === 1 ? 'y is' : 'ies are'} not attached to an account.`,
        count: unassignedCashflow.length,
        action: 'Go to Cashflow, switch to Unassigned Only, and assign the correct account.',
        sample: unassignedCashflow.slice(0, 4).map((entry) => `${entry.entry_date} $${formatMoney(entry.amount)}`).join(', ')
      })
    }

    const legacyCashflow = cashflowEntries.filter(
      (entry) => !entry.category_id || isBillLikeCategory(entry.category)
    )

    if (legacyCashflow.length > 0) {
      addIssue({
        severity: 'warning',
        section: 'Categories',
        title: 'Legacy cashflow categories found',
        detail: `${legacyCashflow.length} cashflow entr${legacyCashflow.length === 1 ? 'y still uses' : 'ies still use'} text category or bill-like category.`,
        count: legacyCashflow.length,
        action: 'Go to Category Cleanup and map legacy entries to database categories.',
        sample: legacyCashflow.slice(0, 4).map((entry) => entry.category || 'Uncategorized').join(', ')
      })
    }

    const billLikeCashflow = cashflowEntries.filter((entry) => isBillLikeCategory(entry.category))
    if (billLikeCashflow.length > 0) {
      addIssue({
        severity: 'warning',
        section: 'Categories',
        title: 'Bill detail stored as category',
        detail: `${billLikeCashflow.length} cashflow entr${billLikeCashflow.length === 1 ? 'y has' : 'ies have'} category like "Bill: ...".`,
        count: billLikeCashflow.length,
        action: 'Move the bill name into Description and set category to Phone, Insurance, Subscriptions, etc.',
        sample: billLikeCashflow.slice(0, 4).map((entry) => entry.category).join(', ')
      })
    }

    const expenseNeedsDescription = cashflowEntries.filter((entry) => {
      if (entry.type !== 'expense') return false
      if (entry.description) return false

      const category = normalize(getCategoryDisplayName(entry))

      return [
        'subscriptions',
        'subscription',
        'phone',
        'insurance',
        'utilities',
        'internet',
        'car payment',
        'debt payment'
      ].includes(category)
    })

    if (expenseNeedsDescription.length > 0) {
      addIssue({
        severity: 'info',
        section: 'Cashflow',
        title: 'Recurring-style expenses missing description',
        detail: `${expenseNeedsDescription.length} expense entr${expenseNeedsDescription.length === 1 ? 'y looks' : 'ies look'} like recurring bills but has no detail/description.`,
        count: expenseNeedsDescription.length,
        action: 'Edit the entry and add a detail like Bill: ChatGPT, Bill: Tmobile, or Car Insurance.',
        sample: expenseNeedsDescription.slice(0, 4).map((entry) => `${entry.entry_date} ${getCategoryDisplayName(entry)}`).join(', ')
      })
    }

    const legacyBudgets = budgets.filter((budget) => !budget.category_id)
    if (legacyBudgets.length > 0) {
      addIssue({
        severity: 'warning',
        section: 'Budget',
        title: 'Budget rows missing category_id',
        detail: `${legacyBudgets.length} budget row${legacyBudgets.length === 1 ? '' : 's'} still use legacy text category.`,
        count: legacyBudgets.length,
        action: 'Go to Category Cleanup and map budget rows to database categories.',
        sample: legacyBudgets.slice(0, 4).map((budget) => `${budget.month}/${budget.year} ${budget.category}`).join(', ')
      })
    }

    const legacyBills = bills.filter((bill) => !bill.category_id)
    if (legacyBills.length > 0) {
      addIssue({
        severity: 'warning',
        section: 'Bills',
        title: 'Bills missing category_id',
        detail: `${legacyBills.length} bill template${legacyBills.length === 1 ? '' : 's'} still use legacy text category.`,
        count: legacyBills.length,
        action: 'Go to Category Cleanup or Bills and map each bill to a database category.',
        sample: legacyBills.slice(0, 4).map((bill) => bill.name).join(', ')
      })
    }

    const billsNotAdded = activeMonthlyBills.filter(
      (bill) => !hasBillCashflowEntry(currentMonthCashflow, bill)
    )

    if (billsNotAdded.length > 0) {
      addIssue({
        severity: 'info',
        section: 'Bills',
        title: 'Active monthly bills not added this month',
        detail: `${billsNotAdded.length} active monthly bill${billsNotAdded.length === 1 ? ' has' : 's have'} not been added to Cashflow for this month.`,
        count: billsNotAdded.length,
        action: 'Go to Bills or Month Setup and add ready bills to Cashflow.',
        sample: billsNotAdded.slice(0, 4).map((bill) => bill.name).join(', ')
      })
    }

    if (categoryHealth.expenseWithoutBudget.length > 0) {
      addIssue({
        severity: 'warning',
        section: 'Budget',
        title: 'Expense categories without budget',
        detail: `${categoryHealth.expenseWithoutBudget.length} expense categor${categoryHealth.expenseWithoutBudget.length === 1 ? 'y is' : 'ies are'} used this month but not in the current month budget.`,
        count: categoryHealth.expenseWithoutBudget.length,
        action: 'Go to Budget and add planned amounts for these categories.',
        sample: categoryHealth.expenseWithoutBudget.slice(0, 6).join(', ')
      })
    }

    if (categoryHealth.budgetWithoutExpense.length > 0) {
      addIssue({
        severity: 'info',
        section: 'Budget',
        title: 'Budget categories with no expense yet',
        detail: `${categoryHealth.budgetWithoutExpense.length} budget categor${categoryHealth.budgetWithoutExpense.length === 1 ? 'y has' : 'ies have'} no spending this month.`,
        count: categoryHealth.budgetWithoutExpense.length,
        action: 'This can be normal. Review if the budget category is no longer needed.',
        sample: categoryHealth.budgetWithoutExpense.slice(0, 6).join(', ')
      })
    }

    const txMissingAccount = transactions.filter((tx) => !tx.account_id)
    if (txMissingAccount.length > 0) {
      addIssue({
        severity: 'warning',
        section: 'Investments',
        title: 'Investment transactions missing account',
        detail: `${txMissingAccount.length} investment transaction${txMissingAccount.length === 1 ? '' : 's'} are not attached to an account.`,
        count: txMissingAccount.length,
        action: 'Go to Investments or Import cleanup and attach transactions to the correct brokerage/crypto account.'
      })
    }

    const assetsWithUnknownType = assets.filter(
      (asset) => !asset.asset_type || asset.asset_type === 'unknown'
    )

    if (assetsWithUnknownType.length > 0) {
      addIssue({
        severity: 'warning',
        section: 'Investments',
        title: 'Assets with unknown type',
        detail: `${assetsWithUnknownType.length} asset${assetsWithUnknownType.length === 1 ? '' : 's'} need asset type review.`,
        count: assetsWithUnknownType.length,
        action: 'Set the asset type to Stock, ETF, Crypto, Cash, or Other below.',
        sample: assetsWithUnknownType.slice(0, 6).map((asset) => asset.symbol).join(', ')
      })
    }

    const holdingsMissingPrice = holdings.filter((holding) => !holding.has_market_price)

    if (holdingsMissingPrice.length > 0) {
      addIssue({
        severity: 'error',
        section: 'Market Data',
        title: 'Holdings missing market price',
        detail: `${holdingsMissingPrice.length} current holding${holdingsMissingPrice.length === 1 ? ' has' : 's have'} no market price, so portfolio value may be understated.`,
        count: holdingsMissingPrice.length,
        action: 'Run Refresh Market Prices or set a manual price below.',
        sample: holdingsMissingPrice.slice(0, 6).map((holding) => holding.symbol).join(', ')
      })
    }

    const staleQuotes = holdings.filter((holding) => {
      const quote = latestQuoteMap.get(holding.asset_id)
      const daysOld = getDaysOld(quote?.created_at)

      return holding.has_market_price && daysOld !== null && daysOld > 7
    })

    if (staleQuotes.length > 0) {
      addIssue({
        severity: 'warning',
        section: 'Market Data',
        title: 'Stale market prices',
        detail: `${staleQuotes.length} holding${staleQuotes.length === 1 ? ' has' : 's have'} market prices older than 7 days.`,
        count: staleQuotes.length,
        action: 'Run Refresh Market Prices before relying on portfolio totals.',
        sample: staleQuotes.slice(0, 6).map((holding) => holding.symbol).join(', ')
      })
    }

    const zeroMarketValueHoldings = holdings.filter(
      (holding) => toNumber(holding.quantity) > 0 && toNumber(holding.market_value) === 0
    )

    if (zeroMarketValueHoldings.length > 0) {
      addIssue({
        severity: 'error',
        section: 'Market Data',
        title: 'Holdings with zero market value',
        detail: `${zeroMarketValueHoldings.length} holding${zeroMarketValueHoldings.length === 1 ? ' has' : 's have'} quantity but zero market value.`,
        count: zeroMarketValueHoldings.length,
        action: 'Check market price mapping, symbol, asset type, or manual price.',
        sample: zeroMarketValueHoldings.slice(0, 6).map((holding) => holding.symbol).join(', ')
      })
    }

    const errorCount = issues.filter((issue) => issue.severity === 'error').length
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length
    const infoCount = issues.filter((issue) => issue.severity === 'info').length

    const score = Math.max(
      0,
      Math.round(100 - errorCount * 18 - warningCount * 8 - infoCount * 3)
    )

    return {
      issues,
      score,
      errorCount,
      warningCount,
      infoCount,
      currentMonthCashflow,
      currentMonthBudgets,
      activeMonthlyBills,
      holdings,
      latestQuoteMap,
      categoryHealth
    }
  }, [accounts, assets, bills, budgets, cashflowEntries, currentMonth, priceQuotes, transactions])

  const filteredIssues = useMemo(() => {
    return analysis.issues.filter((issue) => {
      const severityMatch = severityFilter === 'all' || issue.severity === severityFilter
      const sectionMatch = sectionFilter === 'all' || issue.section === sectionFilter

      return severityMatch && sectionMatch
    })
  }, [analysis.issues, severityFilter, sectionFilter])

  const availableSections = useMemo(() => {
    return [...new Set(analysis.issues.map((issue) => issue.section))].sort()
  }, [analysis.issues])

  const latestQuoteMap = analysis.latestQuoteMap

  return (
    <div>
      <div style={pageHeaderStyle}>
        <div>
          <div style={eyebrowStyle}>Bài 36 · Local Production Readiness</div>
          <h1 style={titleStyle}>Data Health Pro</h1>
          <p style={subtitleStyle}>
            Check accounts, cashflow, categories, bills, budgets, and market data before moving toward production-ready testing.
          </p>
        </div>

        <div style={headerActionsStyle}>
          <button
            type="button"
            onClick={handleRunPriceCheck}
            disabled={refreshing}
            style={greenButtonStyle}
          >
            {refreshing ? 'Refreshing Prices...' : 'Refresh Market Prices'}
          </button>

          <button
            type="button"
            onClick={loadDataHealth}
            disabled={loading}
            style={refreshButtonStyle}
          >
            {loading ? 'Refreshing...' : 'Refresh Health'}
          </button>
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={scoreCardStyle}>
        <div>
          <div style={scoreLabelStyle}>Production Readiness Score</div>
          <div
            style={{
              ...scoreValueStyle,
              color:
                analysis.score >= 85
                  ? 'var(--success)'
                  : analysis.score >= 65
                    ? 'var(--warning)'
                    : 'var(--danger)'
            }}
          >
            {analysis.score}/100
          </div>
          <div style={scoreNoteStyle}>
            This is a local data quality score, not a deployment score. Fix high-impact data issues before testing production-ready flows.
          </div>
        </div>

        <div style={scoreGridStyle}>
          <HealthStat label="Needs Fix" value={analysis.errorCount} severity="error" />
          <HealthStat label="Warnings" value={analysis.warningCount} severity="warning" />
          <HealthStat label="Review" value={analysis.infoCount} severity="info" />
          <HealthStat label="Total Issues" value={analysis.issues.length} />
        </div>
      </div>

      <div style={summaryGridStyle}>
        <SummaryCard label="Accounts" value={accounts.length} sub="Standardized account center" />
        <SummaryCard label="Cashflow Entries" value={cashflowEntries.length} sub={`${analysis.currentMonthCashflow.length} this month`} />
        <SummaryCard label="Budgets" value={budgets.length} sub={`${analysis.currentMonthBudgets.length} current month`} />
        <SummaryCard label="Active Bills" value={analysis.activeMonthlyBills.length} sub="Monthly active templates" />
        <SummaryCard label="Holdings" value={analysis.holdings.length} sub="Open investment positions" />
        <SummaryCard label="Price Quotes" value={priceQuotes.length} sub="Saved market quotes" />
      </div>

      <div style={filterBarStyle}>
        <div>
          <label style={labelStyle}>Severity</label>
          <select
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
            style={selectStyle}
          >
            <option value="all">All severity</option>
            <option value="error">Needs Fix</option>
            <option value="warning">Warning</option>
            <option value="info">Review</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>Section</label>
          <select
            value={sectionFilter}
            onChange={(event) => setSectionFilter(event.target.value)}
            style={selectStyle}
          >
            <option value="all">All sections</option>
            {availableSections.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Readiness Issues</h2>
            <p style={sectionSubtitleStyle}>
              Fix red items first, then warnings, then optional review items.
            </p>
          </div>
        </div>

        {loading ? (
          <div style={emptyStyle}>Loading data health checks...</div>
        ) : filteredIssues.length === 0 ? (
          <div style={successBoxStyle}>
            No issues found for the selected filter. Your data looks clean in this area.
          </div>
        ) : (
          <div style={issueListStyle}>
            {filteredIssues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} />
            ))}
          </div>
        )}
      </section>

      <div style={twoColumnStyle}>
        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Asset Type & Price Control</h2>
              <p style={sectionSubtitleStyle}>
                Review asset types, latest prices, stale quotes, and locked manual prices.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveManualPrice} style={manualPriceFormStyle}>
            <select
              value={manualAssetId}
              onChange={(event) => setManualAssetId(event.target.value)}
              style={inputStyle}
            >
              <option value="">Select asset for manual price...</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.symbol} · {asset.display_name || asset.symbol}
                </option>
              ))}
            </select>

            <input
              type="number"
              step="0.00000001"
              value={manualPrice}
              onChange={(event) => setManualPrice(event.target.value)}
              placeholder="Manual price"
              style={inputStyle}
            />

            <label style={checkboxStyle}>
              <input
                type="checkbox"
                checked={lockManualPrice}
                onChange={(event) => setLockManualPrice(event.target.checked)}
              />
              Lock
            </label>

            <button type="submit" disabled={saving} style={primaryButtonStyle}>
              Save Price
            </button>
          </form>

          <div style={assetListStyle}>
            {assets.length === 0 ? (
              <div style={emptyStyle}>No assets found.</div>
            ) : (
              assets.map((asset) => {
                const quote = latestQuoteMap.get(asset.id)
                const latestPrice = toNumber(quote?.price)
                const daysOld = getDaysOld(quote?.created_at)

                return (
                  <div key={asset.id} style={assetRowStyle}>
                    <div style={{ minWidth: 0 }}>
                      <div style={assetTitleStyle}>
                        {asset.symbol || 'N/A'} · {asset.display_name || asset.symbol || 'Unnamed Asset'}
                      </div>
                      <div style={mutedTextStyle}>
                        Latest: {latestPrice > 0 ? `$${formatMoney(latestPrice)}` : 'Missing'}
                        {daysOld !== null ? ` · ${daysOld} day${daysOld === 1 ? '' : 's'} old` : ''}
                        {asset.is_price_locked ? ` · Locked $${formatMoney(asset.locked_price)}` : ''}
                      </div>
                    </div>

                    <div style={assetActionStyle}>
                      <select
                        value={asset.asset_type || 'other'}
                        onChange={(event) => handleSetAssetType(asset.id, event.target.value)}
                        style={miniSelectStyle}
                        disabled={saving}
                      >
                        {ASSET_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      {latestPrice > 0 && (
                        <button
                          type="button"
                          onClick={() => handleLockLatestPrice(asset.id, latestPrice)}
                          disabled={saving}
                          style={smallButtonStyle}
                        >
                          Lock Latest
                        </button>
                      )}

                      {asset.is_price_locked && (
                        <button
                          type="button"
                          onClick={() => handleUnlockPrice(asset.id)}
                          disabled={saving}
                          style={smallDangerButtonStyle}
                        >
                          Unlock
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Market Refresh Details</h2>
              <p style={sectionSubtitleStyle}>
                Last refresh result from the market price function.
              </p>
            </div>
          </div>

          {refreshDetails.length === 0 ? (
            <div style={emptyStyle}>No refresh details yet. Run Refresh Market Prices to see details.</div>
          ) : (
            <div style={refreshDetailListStyle}>
              {refreshDetails.map((item, index) => (
                <div key={`${item.symbol || 'item'}-${index}`} style={refreshDetailRowStyle}>
                  <strong>{item.symbol || item.assetSymbol || 'Unknown'}</strong>
                  <span>{item.status || item.message || 'Updated'}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function HealthStat({ label, value, severity }) {
  const tone = ISSUE_SEVERITY[severity] || ISSUE_SEVERITY.good

  return (
    <div style={{ ...healthStatStyle, borderColor: tone.border, background: tone.bg }}>
      <div style={{ ...healthStatValueStyle, color: tone.color }}>{value}</div>
      <div style={healthStatLabelStyle}>{label}</div>
    </div>
  )
}

function SummaryCard({ label, value, sub }) {
  return (
    <div style={summaryCardStyle}>
      <div style={summaryLabelStyle}>{label}</div>
      <div style={summaryValueStyle}>{value}</div>
      <div style={summarySubStyle}>{sub}</div>
    </div>
  )
}

function IssueCard({ issue }) {
  const tone = ISSUE_SEVERITY[issue.severity] || ISSUE_SEVERITY.info

  return (
    <div style={{ ...issueCardStyle, borderColor: tone.border, background: tone.bg }}>
      <div style={issueTopStyle}>
        <div>
          <div style={issueTitleStyle}>{issue.title}</div>
          <div style={issueSectionStyle}>{issue.section}</div>
        </div>

        <span style={{ ...issueBadgeStyle, color: tone.color, borderColor: tone.border }}>
          {tone.label}
        </span>
      </div>

      <p style={issueDetailStyle}>{issue.detail}</p>

      {issue.sample && (
        <div style={sampleStyle}>
          <strong>Sample:</strong> {issue.sample}
        </div>
      )}

      {issue.action && (
        <div style={actionStyle}>
          <strong>Suggested action:</strong> {issue.action}
        </div>
      )}
    </div>
  )
}

const pageHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '18px',
  padding: '22px 24px',
  borderRadius: '18px',
  background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-strong) 12%, transparent), var(--bg-card) 58%, color-mix(in srgb, var(--success) 8%, transparent))',
  border: '1px solid var(--border-main)',
  marginBottom: '18px'
}

const eyebrowStyle = {
  color: 'var(--accent-strong)',
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  fontSize: '12px',
  marginBottom: '8px'
}

const titleStyle = {
  margin: 0,
  fontSize: '34px',
  lineHeight: 1.1
}

const subtitleStyle = {
  margin: '12px 0 0',
  color: 'var(--text-muted)',
  lineHeight: 1.5,
  maxWidth: '820px'
}

const headerActionsStyle = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
}

const primaryButtonStyle = {
  padding: '11px 14px',
  borderRadius: '10px',
  border: 'none',
  background: 'var(--accent-strong)',
  color: 'white',
  fontWeight: 850,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}

const greenButtonStyle = {
  ...primaryButtonStyle,
  background: 'var(--success)'
}

const refreshButtonStyle = {
  ...primaryButtonStyle,
  background: 'color-mix(in srgb, var(--accent-strong) 12%, transparent)',
  border: '1px solid var(--accent-strong)',
  color: 'var(--text-main)'
}

const messageStyle = {
  marginBottom: '16px',
  padding: '12px 14px',
  borderRadius: '12px',
  background: 'color-mix(in srgb, var(--accent-strong) 10%, transparent)',
  border: '1px solid var(--accent-strong)',
  color: 'var(--text-main)'
}

const scoreCardStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 1fr) minmax(360px, 1.1fr)',
  gap: '18px',
  padding: '22px',
  borderRadius: '18px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-main)',
  marginBottom: '18px'
}

const scoreLabelStyle = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.08em'
}

const scoreValueStyle = {
  marginTop: '8px',
  fontSize: '48px',
  fontWeight: 950,
  lineHeight: 1
}

const scoreNoteStyle = {
  marginTop: '10px',
  color: 'var(--text-muted)',
  lineHeight: 1.5
}

const scoreGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: '12px'
}

const healthStatStyle = {
  padding: '14px',
  borderRadius: '14px',
  border: '1px solid',
  minWidth: 0
}

const healthStatValueStyle = {
  fontSize: '26px',
  fontWeight: 950
}

const healthStatLabelStyle = {
  marginTop: '5px',
  color: 'var(--text-muted)',
  fontSize: '12px',
  fontWeight: 800
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
  gap: '12px',
  marginBottom: '18px'
}

const summaryCardStyle = {
  padding: '15px',
  borderRadius: '14px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-main)',
  minWidth: 0
}

const summaryLabelStyle = {
  color: 'var(--text-muted)',
  fontSize: '13px',
  fontWeight: 800
}

const summaryValueStyle = {
  marginTop: '8px',
  color: 'var(--text-main)',
  fontSize: '24px',
  fontWeight: 950
}

const summarySubStyle = {
  marginTop: '6px',
  color: 'var(--text-muted)',
  fontSize: '12px',
  lineHeight: 1.35
}

const filterBarStyle = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap',
  padding: '14px',
  borderRadius: '14px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-main)',
  marginBottom: '18px'
}

const labelStyle = {
  display: 'block',
  marginBottom: '7px',
  color: 'var(--text-main)',
  fontSize: '12px',
  fontWeight: 850
}

const selectStyle = {
  minWidth: '180px',
  padding: '10px 11px',
  borderRadius: '10px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)'
}

const cardStyle = {
  padding: '20px',
  borderRadius: '18px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-main)',
  marginBottom: '18px'
}

const sectionHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '14px',
  marginBottom: '16px'
}

const sectionTitleStyle = {
  margin: 0,
  fontSize: '22px',
  letterSpacing: '-0.02em'
}

const sectionSubtitleStyle = {
  margin: '7px 0 0',
  color: 'var(--text-muted)',
  fontSize: '13px',
  lineHeight: 1.5
}

const issueListStyle = {
  display: 'grid',
  gap: '12px'
}

const issueCardStyle = {
  padding: '15px',
  borderRadius: '15px',
  border: '1px solid'
}

const issueTopStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px'
}

const issueTitleStyle = {
  color: 'var(--text-main)',
  fontWeight: 900,
  fontSize: '16px'
}

const issueSectionStyle = {
  marginTop: '4px',
  color: 'var(--text-muted)',
  fontSize: '12px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.08em'
}

const issueBadgeStyle = {
  padding: '5px 9px',
  borderRadius: '999px',
  border: '1px solid',
  fontSize: '12px',
  fontWeight: 900,
  whiteSpace: 'nowrap'
}

const issueDetailStyle = {
  margin: '10px 0 0',
  color: 'var(--text-main)',
  lineHeight: 1.5
}

const sampleStyle = {
  marginTop: '10px',
  color: 'var(--accent-strong)',
  fontSize: '13px',
  lineHeight: 1.45
}

const actionStyle = {
  marginTop: '10px',
  color: 'var(--success)',
  fontSize: '13px',
  lineHeight: 1.45
}

const successBoxStyle = {
  padding: '18px',
  borderRadius: '14px',
  background: 'color-mix(in srgb, var(--success) 10%, transparent)',
  border: '1px solid var(--success)',
  color: 'var(--success)'
}

const emptyStyle = {
  padding: '18px',
  borderRadius: '14px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-muted)'
}

const twoColumnStyle = {
  display: 'grid',
  gridTemplateColumns: '1.3fr 0.8fr',
  gap: '18px',
  alignItems: 'start'
}

const manualPriceFormStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(140px, 0.8fr) auto auto',
  gap: '10px',
  alignItems: 'center',
  marginBottom: '16px'
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 11px',
  borderRadius: '10px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)'
}

const checkboxStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  color: 'var(--text-main)',
  whiteSpace: 'nowrap'
}

const assetListStyle = {
  display: 'grid',
  gap: '10px',
  maxHeight: '620px',
  overflowY: 'auto',
  paddingRight: '4px'
}

const assetRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(240px, 1fr) auto',
  gap: '12px',
  alignItems: 'center',
  padding: '13px',
  borderRadius: '13px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)'
}

const assetTitleStyle = {
  color: 'var(--text-main)',
  fontWeight: 900,
  overflowWrap: 'anywhere'
}

const mutedTextStyle = {
  marginTop: '5px',
  color: 'var(--text-muted)',
  fontSize: '12px',
  lineHeight: 1.45
}

const assetActionStyle = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
}

const miniSelectStyle = {
  padding: '9px 10px',
  borderRadius: '9px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)'
}

const smallButtonStyle = {
  padding: '9px 10px',
  borderRadius: '9px',
  border: 'none',
  background: 'var(--accent-strong)',
  color: 'white',
  fontWeight: 800,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}

const smallDangerButtonStyle = {
  ...smallButtonStyle,
  background: 'var(--danger)'
}

const refreshDetailListStyle = {
  display: 'grid',
  gap: '10px',
  maxHeight: '620px',
  overflowY: 'auto',
  paddingRight: '4px'
}

const refreshDetailRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '12px',
  borderRadius: '12px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-muted)'
}
