import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculateHoldings, formatMoney, formatPercent } from '../lib/holdings'
import { DEFAULT_APP_SETTINGS, loadUserSettings } from '../lib/appSettings'

const ACCOUNT_TYPES = [
  {
    value: 'cash',
    label: 'Cash Wallet',
    group: 'Cash',
    description: 'Physical cash, cash on hand, cash received before deposit'
  },
  {
    value: 'checking',
    label: 'Checking',
    group: 'Cash',
    description: 'Daily bank account for spending and income'
  },
  {
    value: 'savings',
    label: 'Savings',
    group: 'Cash',
    description: 'Savings, emergency fund, reserve account'
  },
  {
    value: 'business',
    label: 'Business Cash',
    group: 'Cash',
    description: 'Business operating money or business cashflow account'
  },
  {
    value: 'brokerage',
    label: 'Brokerage',
    group: 'Investment',
    description: 'Stocks, ETFs, options, taxable investing'
  },
  {
    value: 'ira',
    label: 'IRA / Retirement',
    group: 'Investment',
    description: 'IRA, Roth IRA, retirement investing'
  },
  {
    value: 'crypto',
    label: 'Crypto',
    group: 'Investment',
    description: 'Crypto exchange, crypto wallet, on-chain holdings'
  },
  {
    value: 'credit_card',
    label: 'Credit Card',
    group: 'Debt',
    description: 'Credit card account'
  },
  {
    value: 'loan',
    label: 'Loan',
    group: 'Debt',
    description: 'Personal loan, auto loan, debt account'
  },
  {
    value: 'other',
    label: 'Other',
    group: 'Other',
    description: 'Temporary or uncategorized account'
  }
]

const ARCHIVE_PREFIX = '[ARCHIVED] '
const LARGE_EXPENSE_REVIEW_AMOUNT = 1000
const DUPLICATE_WINDOW_LIMIT = 8

const ACCOUNT_TYPE_LABELS = ACCOUNT_TYPES.reduce((map, item) => {
  map[item.value] = item.label
  return map
}, {})

const ACCOUNT_TYPE_GROUPS = ACCOUNT_TYPES.reduce((map, item) => {
  map[item.value] = item.group
  return map
}, {})

const ACCOUNT_TYPE_DESCRIPTIONS = ACCOUNT_TYPES.reduce((map, item) => {
  map[item.value] = item.description
  return map
}, {})

function money(value) {
  return `$${formatMoney(Number(value || 0))}`
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function getCurrentMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
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
  return `${year}-${pad2(month)}`
}

function shiftMonthKey(monthKey, offset) {
  const { year, month } = parseMonthKey(monthKey)
  const shifted = new Date(year, month - 1 + offset, 1)
  return formatMonthKey(shifted.getFullYear(), shifted.getMonth() + 1)
}

function getMonthRange(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const next = new Date(year, month, 1)

  return {
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-01`
  }
}

function getMonthLabel(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const date = new Date(year, month - 1, 1)

  return date.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  })
}

function typeLabel(type) {
  return ACCOUNT_TYPE_LABELS[type] || type || 'Unknown'
}

function typeGroup(type) {
  return ACCOUNT_TYPE_GROUPS[type] || 'Review'
}

function typeDescription(type) {
  return ACCOUNT_TYPE_DESCRIPTIONS[type] || 'Review this account type'
}

function isValidAccountType(type) {
  return ACCOUNT_TYPES.some((item) => item.value === type)
}

function isCashAccount(type) {
  return ['cash', 'checking', 'savings', 'business'].includes(type)
}

function isInvestmentAccount(type) {
  return ['brokerage', 'ira', 'crypto'].includes(type)
}

function isDebtAccount(type) {
  return ['credit_card', 'loan'].includes(type)
}

function isArchivedName(name) {
  return String(name || '').startsWith(ARCHIVE_PREFIX)
}

function displayName(name) {
  const value = String(name || '').trim()
  return isArchivedName(value)
    ? value.slice(ARCHIVE_PREFIX.length).trim() || 'Archived Account'
    : value
}

function archivedName(name) {
  const value = String(name || '').trim()
  return isArchivedName(value) ? value : `${ARCHIVE_PREFIX}${value || 'Archived Account'}`
}

function activeName(name) {
  return displayName(name)
}

function isBillCashflowEntry(entry) {
  return normalize(entry?.type) === 'expense' && normalize(entry?.description).startsWith('bill:')
}

function isDebtPaymentCashflowEntry(entry) {
  if (normalize(entry?.type) !== 'expense') return false

  const category = normalize(entry?.category)
  const description = normalize(entry?.description)

  return category === 'debt payment' || description.startsWith('debt payment:')
}

function getEntryAmount(entry) {
  return Math.abs(toNumber(entry?.amount))
}

function getEntryAccountKey(entry) {
  return entry?.account_id || 'unassigned'
}

function getDuplicateKey(entry) {
  return [
    entry.entry_date || '',
    normalize(entry.type),
    toNumber(entry.amount).toFixed(2),
    normalize(entry.category),
    normalize(entry.description),
    entry.account_id || 'unassigned'
  ].join('|')
}

function getAccountSeed(account) {
  const accountType = account.account_type || 'unknown'

  return {
    id: account.id,
    rawName: account.name || 'Unnamed Account',
    name: displayName(account.name || 'Unnamed Account'),
    isArchived: isArchivedName(account.name || ''),
    account_type: accountType,
    accountGroup: typeGroup(accountType),
    currency: account.currency || 'USD',

    investmentValue: 0,
    costBasis: 0,
    unrealizedPL: 0,
    unrealizedPLPercent: 0,
    positionCount: 0,
    investmentTxCount: 0,

    monthlyIncome: 0,
    monthlyExpense: 0,
    monthlyNet: 0,
    monthlyBillExpense: 0,
    monthlyBillCount: 0,
    monthlyDebtPaymentExpense: 0,
    monthlyDebtPaymentCount: 0,
    monthlyEntryCount: 0,
    monthlyLargeExpenseCount: 0,
    lastMonthIncome: 0,
    lastMonthExpense: 0,
    lastMonthNet: 0,
    allTimeIncome: 0,
    allTimeExpense: 0,
    allTimeNet: 0,
    cashflowCount: 0,

    cashLedgerCount: 0,
    cashLedgerMonths: [],
    currentMonthOpeningBalance: 0,
    currentMonthActualCashCount: null,
    currentMonthExpectedClosing: 0,
    currentMonthLedgerStatus: '',
    currentMonthLedgerLocked: false,
    currentMonthHasLedger: false,
    currentMonthFinalCashBalance: 0,

    previousMonthOpeningBalance: 0,
    previousMonthActualCashCount: null,
    previousMonthExpectedClosing: 0,
    previousMonthLedgerStatus: '',
    previousMonthLedgerLocked: false,
    previousMonthHasLedger: false,
    previousMonthFinalCashBalance: 0,

    needsReview: false,
    reviewReasons: []
  }
}


function getOpeningBalanceGuide(rowOrType) {
  const accountType =
    typeof rowOrType === 'string' ? rowOrType : rowOrType?.account_type || 'other'
  const row = typeof rowOrType === 'string' ? null : rowOrType

  if (accountType === 'cash') {
    const hasCashLedger = toNumber(row?.cashLedgerCount) > 0
    const hasCashflow = toNumber(row?.cashflowCount) > 0

    return {
      label: hasCashLedger ? 'Cash ledger started' : hasCashflow ? 'Cashflow started' : 'Needs opening balance',
      tone: hasCashLedger || hasCashflow ? 'good' : 'warn',
      detail: hasCashLedger
        ? `Opening balance exists in Cash Wallet Ledger for ${row?.cashLedgerMonths?.join(', ') || 'one or more months'}.`
        : hasCashflow
          ? 'Cashflow exists. If this is a real account, verify the opening balance in Cash Wallet Ledger before relying on carryover.'
          : 'For real data, set the first month opening balance in Cash Wallet Ledger. Do not create fake income just to match cash.',
      action: 'Use Cash Wallet Ledger for opening balance and monthly cash count.'
    }
  }

  if (accountType === 'checking' || accountType === 'savings' || accountType === 'business') {
    return {
      label: row?.cashflowCount > 0 ? 'Bank activity started' : 'Needs first real activity',
      tone: row?.cashflowCount > 0 ? 'good' : 'review',
      detail:
        'Starting balance is a reconciliation baseline, not income. Add real deposits/expenses from the date you start tracking.',
      action: 'Use Cashflow for real transactions. Use Account Control to reconcile monthly.'
    }
  }

  if (isInvestmentAccount(accountType)) {
    return {
      label: row?.investmentTxCount > 0 ? 'Lots connected' : 'Needs lots / import',
      tone: row?.investmentTxCount > 0 ? 'good' : 'warn',
      detail:
        'Opening investment value should come from imported/manual buy lots, shares, cost basis, and market prices — not from cashflow.',
      action: 'Use Investments / Import before trusting holdings or P&L.'
    }
  }

  if (isDebtAccount(accountType)) {
    return {
      label: 'Track in Net Worth',
      tone: 'review',
      detail:
        'Debt starting balance should be entered as a Liability in Net Worth. Payments should use Net Worth → Record Payment.',
      action: 'Use Net Worth liabilities for credit cards and loans.'
    }
  }

  return {
    label: 'Manual review',
    tone: 'review',
    detail:
      'Other accounts need a clear starting source before real reports are trusted.',
    action: 'Document where the starting value comes from.'
  }
}

function getOpeningToneStyle(tone) {
  if (tone === 'good') return activeBadgeStyle
  if (tone === 'warn') return reviewBadgeStyle
  return neutralBadgeStyle
}

function getCashLedgerFinalBalance(row, period = 'current') {
  const hasLedger = period === 'previous' ? row.previousMonthHasLedger : row.currentMonthHasLedger

  if (!hasLedger) {
    if (period === 'previous') return row.lastMonthNet

    // Bài 62F Mini: if the current Cash Wallet month is not saved yet,
    // carry forward the previous ledger final and apply current month movement.
    // This keeps Accounts aligned with Cash Ledger month-to-month carryover.
    if (row.previousMonthHasLedger) {
      return toNumber(row.previousMonthFinalCashBalance) + toNumber(row.monthlyNet)
    }

    return row.allTimeNet
  }

  const actualValue =
    period === 'previous' ? row.previousMonthActualCashCount : row.currentMonthActualCashCount
  const expectedValue =
    period === 'previous' ? row.previousMonthExpectedClosing : row.currentMonthExpectedClosing

  return actualValue === null || actualValue === undefined ? toNumber(expectedValue) : toNumber(actualValue)
}

function getCashLedgerOpeningBalance(row) {
  if (row.currentMonthHasLedger) return toNumber(row.currentMonthOpeningBalance)
  if (row.previousMonthHasLedger) return toNumber(row.previousMonthFinalCashBalance)
  return 0
}

function getCashLedgerFallbackLabel(row) {
  if (row.currentMonthHasLedger) return getCashLedgerStatusLabel(row)
  if (row.previousMonthHasLedger) return 'No ledger yet · carried from previous ledger'
  return 'No ledger yet · fallback from cashflow'
}

function getCashLedgerFormulaText(row) {
  if (row.currentMonthHasLedger) {
    return `Formula: ${money(row.currentMonthOpeningBalance)} opening + ${money(row.monthlyIncome)} cash in - ${money(row.monthlyExpense)} cash out = ${money(row.currentMonthExpectedClosing)} expected`
  }

  if (row.previousMonthHasLedger) {
    const opening = toNumber(row.previousMonthFinalCashBalance)
    const expected = opening + toNumber(row.monthlyIncome) - toNumber(row.monthlyExpense)
    return `Carryover estimate: ${money(opening)} previous final + ${money(row.monthlyIncome)} cash in - ${money(row.monthlyExpense)} cash out = ${money(expected)} expected. Create this month's Cash Wallet Ledger snapshot to lock it.`
  }

  return 'No monthly ledger found yet. Fallback is cashflow movement only until you create a Cash Wallet Ledger snapshot.'
}

function getCashLedgerStatusLabel(row) {
  if (!row.currentMonthHasLedger) return 'No ledger yet'
  if (row.currentMonthLedgerLocked) return 'Locked / Reconciled'
  if (row.currentMonthActualCashCount !== null && row.currentMonthActualCashCount !== undefined) return 'Saved Snapshot'
  return row.currentMonthLedgerStatus || 'Open Ledger'
}

function getCashBalanceTone(value) {
  return toNumber(value) >= 0 ? 'good' : 'bad'
}

function getReconciliationTone(row) {
  if (row.id === 'unassigned') return 'bad'
  if (row.isArchived && row.monthlyEntryCount > 0) return 'bad'
  if (row.needsReview) return 'warn'
  if (row.monthlyNet >= 0) return 'good'
  return 'neutral'
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [priceQuotes, setPriceQuotes] = useState([])
  const [cashflowEntries, setCashflowEntries] = useState([])
  const [cashWalletLedgers, setCashWalletLedgers] = useState([])
  const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')
  const [controlFilter, setControlFilter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [monthKey, setMonthKey] = useState(getCurrentMonthKey())
  const [editingAccountId, setEditingAccountId] = useState(null)
  const [accountPagerIndex, setAccountPagerIndex] = useState(0)

  const [editFormData, setEditFormData] = useState({
    name: '',
    account_type: 'cash',
    currency: 'USD'
  })

  const [formData, setFormData] = useState({
    name: '',
    account_type: 'cash',
    currency: 'USD'
  })

  useEffect(() => {
    loadAccounts()
  }, [])

  async function loadAccounts() {
    setLoading(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const settingsResult = await loadUserSettings().catch((error) => {
        console.warn('loadUserSettings fallback:', error)
        return DEFAULT_APP_SETTINGS
      })

      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (accountError) throw accountError

      const { data: txData, error: txError } = await supabase
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
        .order('created_at', { ascending: true })

      if (txError) throw txError

      const { data: quoteData, error: quoteError } = await supabase
        .from('price_quotes')
        .select('*')
        .order('created_at', { ascending: false })

      if (quoteError) throw quoteError

      const { data: cashflowData, error: cashflowError } = await supabase
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
        .order('created_at', { ascending: false })

      if (cashflowError) throw cashflowError

      const { data: ledgerData, error: ledgerError } = await supabase
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
        .order('month_key', { ascending: false })

      if (ledgerError) {
        console.warn('Cash Wallet Ledger unavailable in Accounts opening guard:', ledgerError.message)
      }

      setSettings(settingsResult || DEFAULT_APP_SETTINGS)
      setShowArchived(Boolean(settingsResult?.showArchivedAccounts))
      setAccounts(accountData || [])
      setTransactions(txData || [])
      setPriceQuotes(quoteData || [])
      setCashflowEntries(cashflowData || [])
      setCashWalletLedgers(ledgerError ? [] : ledgerData || [])
    } catch (error) {
      console.error('loadAccounts error:', error)
      setMessage(error.message || 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e) {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  async function handleAddAccount(e) {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      if (!formData.name.trim()) {
        throw new Error('Account name is required')
      }

      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const { error } = await supabase.from('accounts').insert({
        user_id: user.id,
        name: formData.name.trim(),
        account_type: formData.account_type,
        currency: formData.currency
      })

      if (error) throw error

      setFormData({ name: '', account_type: 'cash', currency: 'USD' })
      setMessage('Account added successfully')
      await loadAccounts()
    } catch (error) {
      console.error('handleAddAccount error:', error)
      setMessage(error.message || 'Failed to add account')
    } finally {
      setSaving(false)
    }
  }

  function startEditAccount(account) {
    if (!account || account.id === 'unassigned') return

    setEditingAccountId(account.id)
    setEditFormData({
      name: account.name || '',
      account_type: isValidAccountType(account.account_type) ? account.account_type : 'other',
      currency: account.currency || 'USD'
    })
    setMessage('')
  }

  function cancelEditAccount() {
    setEditingAccountId(null)
    setEditFormData({ name: '', account_type: 'cash', currency: 'USD' })
  }

  function handleEditChange(e) {
    const { name, value } = e.target
    setEditFormData((prev) => ({ ...prev, [name]: value }))
  }

  async function handleUpdateAccount(accountId) {
    if (!accountId || accountId === 'unassigned') return

    setSaving(true)
    setMessage('')

    try {
      if (!editFormData.name.trim()) {
        throw new Error('Account name is required')
      }

      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const { error } = await supabase
        .from('accounts')
        .update({
          name: editFormData.name.trim(),
          account_type: editFormData.account_type,
          currency: editFormData.currency
        })
        .eq('id', accountId)
        .eq('user_id', user.id)

      if (error) throw error

      setMessage('Account updated successfully')
      cancelEditAccount()
      await loadAccounts()
    } catch (error) {
      console.error('handleUpdateAccount error:', error)
      setMessage(error.message || 'Failed to update account')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchiveAccount(account) {
    if (!account || account.id === 'unassigned') return

    const action = account.isArchived ? 'reactivate' : 'archive'
    const confirmText = account.isArchived
      ? `Reactivate ${account.name}?`
      : `Archive ${account.name}? This keeps all history, but marks the account as inactive.`

    if (!window.confirm(confirmText)) return

    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const nextName = account.isArchived ? activeName(account.rawName) : archivedName(account.rawName)

      const { error } = await supabase
        .from('accounts')
        .update({ name: nextName })
        .eq('id', account.id)
        .eq('user_id', user.id)

      if (error) throw error

      setMessage(account.isArchived ? 'Account reactivated successfully' : 'Account archived successfully')
      await loadAccounts()
    } catch (error) {
      console.error('handleArchiveAccount error:', error)
      setMessage(error.message || `Failed to ${action} account`)
    } finally {
      setSaving(false)
    }
  }

  async function handleSafeDeleteAccount(account) {
    if (!account || account.id === 'unassigned') return

    const linkedCount = account.investmentTxCount + account.cashflowCount

    if (linkedCount > 0) {
      setMessage(
        `Safe delete blocked: ${account.name} has ${linkedCount} linked entr${
          linkedCount === 1 ? 'y' : 'ies'
        }. Archive it instead to keep your history safe.`
      )
      return
    }

    if (
      !window.confirm(
        `Delete ${account.name}? This account has no linked entries, so it can be safely deleted.`
      )
    ) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const { error } = await supabase
        .from('accounts')
        .delete()
        .eq('id', account.id)
        .eq('user_id', user.id)

      if (error) throw error

      setMessage('Account deleted successfully')
      await loadAccounts()
    } catch (error) {
      console.error('handleSafeDeleteAccount error:', error)
      setMessage(error.message || 'Failed to delete account')
    } finally {
      setSaving(false)
    }
  }

  const {
    accountRows,
    summary,
    typeRows,
    healthWarnings,
    reconciliationRows,
    reconciliationIssues,
    duplicateGroups,
    monthLabel,
    previousMonthLabel
  } = useMemo(() => {
    const { startDate, endDate } = getMonthRange(monthKey)
    const previousMonthKey = shiftMonthKey(monthKey, -1)
    const { startDate: previousStartDate, endDate: previousEndDate } = getMonthRange(previousMonthKey)
    const map = new Map()

    accounts.forEach((account) => {
      map.set(account.id, getAccountSeed(account))
    })

    cashWalletLedgers.forEach((ledger) => {
      const accountId = ledger.cash_account_id
      const row = map.get(accountId)
      if (!row) return

      row.cashLedgerCount += 1
      row.cashLedgerMonths.push(ledger.month_key)
      if (ledger.month_key === monthKey) {
        row.currentMonthHasLedger = true
        row.currentMonthOpeningBalance = toNumber(ledger.opening_balance)
        row.currentMonthActualCashCount =
          ledger.actual_cash_count === null || ledger.actual_cash_count === undefined
            ? null
            : toNumber(ledger.actual_cash_count)
        row.currentMonthExpectedClosing = toNumber(ledger.expected_closing_balance)
        row.currentMonthLedgerStatus = ledger.status || ''
        row.currentMonthLedgerLocked = Boolean(ledger.locked)
      }

      if (ledger.month_key === previousMonthKey) {
        row.previousMonthHasLedger = true
        row.previousMonthOpeningBalance = toNumber(ledger.opening_balance)
        row.previousMonthActualCashCount =
          ledger.actual_cash_count === null || ledger.actual_cash_count === undefined
            ? null
            : toNumber(ledger.actual_cash_count)
        row.previousMonthExpectedClosing = toNumber(ledger.expected_closing_balance)
        row.previousMonthLedgerStatus = ledger.status || ''
        row.previousMonthLedgerLocked = Boolean(ledger.locked)
      }
    })

    const needsUnassignedInvestment = transactions.some((tx) => !tx.account_id)
    const needsUnassignedCashflow = cashflowEntries.some((entry) => !entry.account_id)

    if (needsUnassignedInvestment || needsUnassignedCashflow) {
      map.set(
        'unassigned',
        getAccountSeed({
          id: 'unassigned',
          name: 'Unassigned Activity',
          account_type: 'unknown',
          currency: 'USD'
        })
      )
    }

    const txByAccount = new Map()

    transactions.forEach((tx) => {
      const accountId = tx.account_id || 'unassigned'
      if (!txByAccount.has(accountId)) txByAccount.set(accountId, [])
      txByAccount.get(accountId).push(tx)
    })

    txByAccount.forEach((items, accountId) => {
      const row = map.get(accountId)
      if (!row) return

      const holdings = calculateHoldings(items, priceQuotes)

      row.positionCount = holdings.length
      row.investmentTxCount = items.length
      row.investmentValue = holdings.reduce((sum, item) => sum + toNumber(item.market_value), 0)
      row.costBasis = holdings.reduce((sum, item) => sum + toNumber(item.cost_basis), 0)
      row.unrealizedPL = holdings.reduce((sum, item) => sum + toNumber(item.unrealized_pl), 0)
      row.unrealizedPLPercent = row.costBasis > 0 ? (row.unrealizedPL / row.costBasis) * 100 : 0
    })

    const duplicateMap = new Map()
    const monthlyEntries = []

    cashflowEntries.forEach((entry) => {
      const accountId = getEntryAccountKey(entry)
      const row = map.get(accountId)
      if (!row) return

      const amount = getEntryAmount(entry)
      const entryType = normalize(entry.type)
      const date = entry.entry_date || ''
      const inThisMonth = date >= startDate && date < endDate
      const inPreviousMonth = date >= previousStartDate && date < previousEndDate

      if (entryType === 'income') {
        row.allTimeIncome += amount
        if (inThisMonth) row.monthlyIncome += amount
        if (inPreviousMonth) row.lastMonthIncome += amount
      }

      if (entryType === 'expense') {
        row.allTimeExpense += amount
        if (inThisMonth) row.monthlyExpense += amount
        if (inPreviousMonth) row.lastMonthExpense += amount
      }

      if (inThisMonth) {
        row.monthlyEntryCount += 1
        monthlyEntries.push(entry)

        if (isBillCashflowEntry(entry)) {
          row.monthlyBillExpense += amount
          row.monthlyBillCount += 1
        }

        if (isDebtPaymentCashflowEntry(entry)) {
          row.monthlyDebtPaymentExpense += amount
          row.monthlyDebtPaymentCount += 1
        }

        if (entryType === 'expense' && amount >= LARGE_EXPENSE_REVIEW_AMOUNT) {
          row.monthlyLargeExpenseCount += 1
        }

        const duplicateKey = getDuplicateKey(entry)
        const list = duplicateMap.get(duplicateKey) || []
        list.push(entry)
        duplicateMap.set(duplicateKey, list)
      }

      row.cashflowCount += 1
    })

    const rows = Array.from(map.values()).map((row) => {
      const monthlyNet = row.monthlyIncome - row.monthlyExpense
      const lastMonthNet = row.lastMonthIncome - row.lastMonthExpense
      const allTimeNet = row.allTimeIncome - row.allTimeExpense
      const reviewReasons = []

      if (row.id === 'unassigned') {
        reviewReasons.push('Has unassigned activity')
      }

      if (row.isArchived) {
        reviewReasons.push('Archived account')
      }

      if (row.isArchived && row.monthlyEntryCount > 0) {
        reviewReasons.push('Archived account used this month')
      }

      if (!isValidAccountType(row.account_type)) {
        reviewReasons.push('Non-standard account type')
      }

      if (!row.isArchived && row.investmentTxCount === 0 && row.cashflowCount === 0) {
        reviewReasons.push('No linked activity yet')
      }

      if (isInvestmentAccount(row.account_type) && row.cashflowCount > 0 && row.investmentTxCount === 0) {
        reviewReasons.push('Investment account has cashflow but no investment transactions')
      }

      if (isCashAccount(row.account_type) && row.investmentTxCount > 0) {
        reviewReasons.push('Cash account has investment transactions')
      }

      if (row.monthlyLargeExpenseCount > 0) {
        reviewReasons.push(`${row.monthlyLargeExpenseCount} large expense${row.monthlyLargeExpenseCount === 1 ? '' : 's'} this month`)
      }

      const openingGuide = getOpeningBalanceGuide(row)

      const rowWithNets = {
        ...row,
        monthlyNet,
        lastMonthNet,
        allTimeNet
      }

      const previousMonthFinalCashBalance =
        row.account_type === 'cash' ? getCashLedgerFinalBalance(rowWithNets, 'previous') : lastMonthNet
      const rowWithLedgerCarryover = {
        ...rowWithNets,
        previousMonthFinalCashBalance
      }
      const currentMonthFinalCashBalance =
        row.account_type === 'cash' ? getCashLedgerFinalBalance(rowWithLedgerCarryover, 'current') : allTimeNet

      return {
        ...rowWithLedgerCarryover,
        currentMonthFinalCashBalance,
        monthOverMonthChange: monthlyNet - lastMonthNet,
        openingGuide,
        reviewReasons,
        needsReview: reviewReasons.length > 0
      }
    })

    rows.sort((a, b) => {
      if (a.id === 'unassigned') return 1
      if (b.id === 'unassigned') return -1

      const groupOrder = {
        Cash: 1,
        Investment: 2,
        Debt: 3,
        Other: 4,
        Review: 5
      }

      const groupDiff = (groupOrder[a.accountGroup] || 99) - (groupOrder[b.accountGroup] || 99)
      if (groupDiff !== 0) return groupDiff

      const aValue = a.investmentValue + Math.abs(a.allTimeNet) + Math.abs(a.monthlyNet)
      const bValue = b.investmentValue + Math.abs(b.allTimeNet) + Math.abs(b.monthlyNet)
      return bValue - aValue
    })

    const totals = rows.reduce(
      (acc, row) => {
        acc.investmentValue += row.investmentValue
        acc.costBasis += row.costBasis
        acc.unrealizedPL += row.unrealizedPL
        acc.monthlyIncome += row.monthlyIncome
        acc.monthlyExpense += row.monthlyExpense
        acc.monthlyNet += row.monthlyNet
        acc.monthlyBillExpense += row.monthlyBillExpense
        acc.monthlyBillCount += row.monthlyBillCount
        acc.monthlyDebtPaymentExpense += row.monthlyDebtPaymentExpense
        acc.monthlyDebtPaymentCount += row.monthlyDebtPaymentCount
        acc.monthlyEntryCount += row.monthlyEntryCount
        acc.lastMonthNet += row.lastMonthNet
        acc.allTimeIncome += row.allTimeIncome
        acc.allTimeExpense += row.allTimeExpense
        acc.allTimeNet += row.allTimeNet

        if (row.isArchived) acc.archivedAccounts += 1
        if (!row.isArchived) acc.activeAccounts += 1
        if (row.needsReview) acc.needsReview += 1
        if (row.id === 'unassigned') acc.unassignedNet += row.monthlyNet
        if (row.id === 'unassigned') acc.unassignedEntries += row.monthlyEntryCount
        if (row.isArchived && row.monthlyEntryCount > 0) acc.archivedUsedThisMonth += 1
        if (isCashAccount(row.account_type) && !row.isArchived) acc.cashAccounts += 1
        if (row.account_type === 'cash' && !row.isArchived) acc.cashWallets += 1
        if (isInvestmentAccount(row.account_type) && !row.isArchived) acc.investmentAccounts += 1
        if (isDebtAccount(row.account_type) && !row.isArchived) acc.debtAccounts += 1

        return acc
      },
      {
        investmentValue: 0,
        costBasis: 0,
        unrealizedPL: 0,
        unrealizedPLPercent: 0,
        monthlyIncome: 0,
        monthlyExpense: 0,
        monthlyNet: 0,
        monthlyBillExpense: 0,
        monthlyBillCount: 0,
        monthlyDebtPaymentExpense: 0,
        monthlyDebtPaymentCount: 0,
        monthlyEntryCount: 0,
        lastMonthNet: 0,
        allTimeIncome: 0,
        allTimeExpense: 0,
        allTimeNet: 0,
        activeAccounts: 0,
        needsReview: 0,
        archivedAccounts: 0,
        archivedUsedThisMonth: 0,
        unassignedEntries: 0,
        unassignedNet: 0,
        cashAccounts: 0,
        cashWallets: 0,
        investmentAccounts: 0,
        debtAccounts: 0
      }
    )

    totals.unrealizedPLPercent =
      totals.costBasis > 0 ? (totals.unrealizedPL / totals.costBasis) * 100 : 0
    totals.monthOverMonthChange = totals.monthlyNet - totals.lastMonthNet

    const typeMap = new Map()

    rows.forEach((row) => {
      if (row.id === 'unassigned') return

      const key = row.account_type || 'unknown'
      const item = typeMap.get(key) || {
        type: key,
        label: typeLabel(key),
        group: typeGroup(key),
        count: 0,
        investmentValue: 0,
        finalCashBalance: 0,
        displayValue: 0,
        allTimeNet: 0,
        monthlyNet: 0,
        cashflowCount: 0,
        investmentTxCount: 0
      }

      item.count += 1

      if (isCashAccount(row.account_type)) {
        item.finalCashBalance += toNumber(row.currentMonthFinalCashBalance)
        item.displayValue += toNumber(row.currentMonthFinalCashBalance)
      } else {
        item.investmentValue += row.investmentValue
        item.displayValue += row.investmentValue
      }

      item.allTimeNet += row.allTimeNet
      item.monthlyNet += row.monthlyNet
      item.cashflowCount += row.cashflowCount
      item.investmentTxCount += row.investmentTxCount
      typeMap.set(key, item)
    })

    const duplicates = Array.from(duplicateMap.values())
      .filter((items) => items.length > 1)
      .slice(0, DUPLICATE_WINDOW_LIMIT)
      .map((items) => ({
        key: getDuplicateKey(items[0]),
        count: items.length,
        sample: items[0],
        totalAmount: items.reduce((sum, item) => sum + getEntryAmount(item), 0)
      }))

    const issues = []

    if (totals.unassignedEntries > 0) {
      issues.push({
        tone: 'bad',
        title: 'Unassigned cashflow this month',
        detail: `${totals.unassignedEntries} entr${totals.unassignedEntries === 1 ? 'y is' : 'ies are'} missing account assignment. Monthly net affected: ${money(totals.unassignedNet)}.`
      })
    }

    if (totals.archivedUsedThisMonth > 0) {
      issues.push({
        tone: 'bad',
        title: 'Archived account used this month',
        detail: `${totals.archivedUsedThisMonth} archived account${totals.archivedUsedThisMonth === 1 ? '' : 's'} still have current-month cashflow.`
      })
    }

    if (duplicates.length > 0) {
      issues.push({
        tone: 'warn',
        title: 'Possible duplicate entries',
        detail: `${duplicates.length} duplicate-looking cashflow group${duplicates.length === 1 ? '' : 's'} found in ${getMonthLabel(monthKey)}.`
      })
    }

    const billEntriesMissingAccount = monthlyEntries.filter(
      (entry) => isBillCashflowEntry(entry) && !entry.account_id
    )

    if (billEntriesMissingAccount.length > 0) {
      issues.push({
        tone: 'warn',
        title: 'Posted bills missing account',
        detail: `${billEntriesMissingAccount.length} posted bill entr${billEntriesMissingAccount.length === 1 ? 'y is' : 'ies are'} not tied to an account.`
      })
    }

    const warnings = []

    if (totals.cashWallets === 0) {
      warnings.push({
        tone: 'warn',
        title: 'No Cash Wallet found',
        detail: 'Create or change one account type to Cash Wallet if you track physical cash or cash received before deposit.'
      })
    }

    if (needsUnassignedCashflow || needsUnassignedInvestment) {
      warnings.push({
        tone: 'bad',
        title: 'Unassigned activity found',
        detail: 'Some cashflow or investment entries are not attached to an account.'
      })
    }

    const nonStandardAccounts = rows.filter(
      (row) => row.id !== 'unassigned' && !isValidAccountType(row.account_type)
    )

    if (nonStandardAccounts.length > 0) {
      warnings.push({
        tone: 'warn',
        title: 'Non-standard account types',
        detail: `${nonStandardAccounts.length} account${
          nonStandardAccounts.length === 1 ? '' : 's'
        } should be reviewed and changed to a standard type.`
      })
    }

    const controlRows = rows
      .filter((row) => row.monthlyEntryCount > 0 || row.monthlyBillCount > 0 || row.id === 'unassigned')
      .sort((a, b) => {
        if (a.id === 'unassigned') return -1
        if (b.id === 'unassigned') return 1
        if (a.needsReview !== b.needsReview) return a.needsReview ? -1 : 1
        return Math.abs(b.monthlyNet) - Math.abs(a.monthlyNet)
      })

    return {
      accountRows: rows,
      summary: totals,
      typeRows: Array.from(typeMap.values()).sort((a, b) => {
        const groupOrder = {
          Cash: 1,
          Investment: 2,
          Debt: 3,
          Other: 4,
          Review: 5
        }

        const groupDiff = (groupOrder[a.group] || 99) - (groupOrder[b.group] || 99)
        if (groupDiff !== 0) return groupDiff

        return (
          Math.abs(b.displayValue) +
          Math.abs(b.allTimeNet) -
          (Math.abs(a.displayValue) + Math.abs(a.allTimeNet))
        )
      }),
      healthWarnings: warnings,
      reconciliationRows: controlRows,
      reconciliationIssues: issues,
      duplicateGroups: duplicates,
      monthLabel: getMonthLabel(monthKey),
      previousMonthLabel: getMonthLabel(previousMonthKey)
    }
  }, [accounts, transactions, priceQuotes, cashflowEntries, cashWalletLedgers, monthKey])

  const availableTypes = useMemo(() => {
    const types = new Set(accountRows.map((row) => row.account_type || 'unknown'))
    return Array.from(types).sort()
  }, [accountRows])

  const filteredRows = useMemo(() => {
    const query = normalize(searchTerm)

    return accountRows.filter((row) => {
      const matchSearch =
        !query ||
        normalize(row.name).includes(query) ||
        normalize(row.rawName).includes(query) ||
        normalize(row.account_type).includes(query) ||
        normalize(row.currency).includes(query)

      const matchType = typeFilter === 'all' || row.account_type === typeFilter
      const matchGroup = groupFilter === 'all' || row.accountGroup === groupFilter
      const matchArchived = showArchived || !row.isArchived

      const matchControl =
        controlFilter === 'all' ||
        (controlFilter === 'needsReview' && row.needsReview) ||
        (controlFilter === 'monthlyActivity' && row.monthlyEntryCount > 0) ||
        (controlFilter === 'billsPosted' && row.monthlyBillCount > 0) ||
        (controlFilter === 'unassigned' && row.id === 'unassigned') ||
        (controlFilter === 'cashWallet' && row.account_type === 'cash')

      return matchSearch && matchType && matchGroup && matchArchived && matchControl
    })
  }, [accountRows, searchTerm, typeFilter, groupFilter, showArchived, controlFilter])

  const cashWalletRows = useMemo(
    () => accountRows.filter((row) => row.account_type === 'cash' && !row.isArchived),
    [accountRows]
  )

  useEffect(() => {
    setAccountPagerIndex(0)
  }, [searchTerm, typeFilter, groupFilter, controlFilter, showArchived, monthKey])

  useEffect(() => {
    if (filteredRows.length === 0) {
      if (accountPagerIndex !== 0) setAccountPagerIndex(0)
      return
    }

    if (accountPagerIndex > filteredRows.length - 1) {
      setAccountPagerIndex(filteredRows.length - 1)
    }
  }, [filteredRows.length, accountPagerIndex])

  const selectedAccountRow = filteredRows[accountPagerIndex] || null
  const accountPagerTotal = filteredRows.length
  const accountPagerCurrent = accountPagerTotal === 0 ? 0 : accountPagerIndex + 1

  function goToPreviousAccount() {
    if (accountPagerTotal <= 1) return
    setAccountPagerIndex((current) => (current <= 0 ? accountPagerTotal - 1 : current - 1))
  }

  function goToNextAccount() {
    if (accountPagerTotal <= 1) return
    setAccountPagerIndex((current) => (current >= accountPagerTotal - 1 ? 0 : current + 1))
  }

  return (
    <div>
      <div style={pageHeaderStyle}>
        <div>
          <div style={eyebrowStyle}>Bài 57A · Real account opening balance guard</div>
          <h1 style={titleStyle}>Account Control Center</h1>
          <p style={subtitleStyle}>
            Reconcile accounts, protect opening balances, catch unassigned entries, and prepare a clean real-data account setup.
          </p>
        </div>

        <div style={headerActionsStyle}>
          <label style={monthLabelStyle}>
            Control Month
            <input
              type="month"
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value || getCurrentMonthKey())}
              style={monthInputStyle}
            />
          </label>
          <button type="button" onClick={loadAccounts} disabled={loading} style={refreshButtonStyle}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      {healthWarnings.length > 0 && (
        <div style={warningGridStyle}>
          {healthWarnings.map((warning) => (
            <div
              key={warning.title}
              style={warning.tone === 'bad' ? badWarningStyle : warnWarningStyle}
            >
              <strong>{warning.title}</strong>
              <div>{warning.detail}</div>
            </div>
          ))}
        </div>
      )}

      <div style={summaryGridStyle}>
        <StatCard
          label={`${monthLabel} Net`}
          value={money(summary.monthlyNet)}
          sub={`Income ${money(summary.monthlyIncome)} · Expense ${money(summary.monthlyExpense)}`}
          tone={summary.monthlyNet >= 0 ? 'good' : 'bad'}
        />
        <StatCard
          label="Posted Bills"
          value={money(summary.monthlyBillExpense)}
          sub={`${summary.monthlyBillCount} bill entr${summary.monthlyBillCount === 1 ? 'y' : 'ies'} posted this month`}
          tone={summary.monthlyBillCount > 0 ? 'good' : 'neutral'}
        />
        <StatCard
          label="MoM Change"
          value={money(summary.monthOverMonthChange)}
          sub={`${previousMonthLabel} net: ${money(summary.lastMonthNet)}`}
          tone={summary.monthOverMonthChange >= 0 ? 'good' : 'bad'}
        />
        <StatCard
          label="Account Health"
          value={summary.needsReview}
          sub={`${summary.activeAccounts} active · ${summary.archivedAccounts} archived · ${summary.unassignedEntries} unassigned this month`}
          tone={summary.needsReview === 0 ? 'good' : 'warn'}
        />
      </div>

      <div style={controlGridStyle}>
        <div style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={{ margin: 0 }}>Monthly Account Control</h2>
              <p style={smallTextStyle}>
                This section checks where money moved in {monthLabel}. It does not create new tables or change your cashflow.
              </p>
            </div>
            <span style={pillStyle}>{reconciliationRows.length} active row{reconciliationRows.length === 1 ? '' : 's'}</span>
          </div>

          {reconciliationIssues.length > 0 ? (
            <div style={issueGridStyle}>
              {reconciliationIssues.map((issue) => (
                <div key={issue.title} style={issue.tone === 'bad' ? issueBadStyle : issueWarnStyle}>
                  <strong>{issue.title}</strong>
                  <div>{issue.detail}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={goodNoticeStyle}>
              No major reconciliation issue found for {monthLabel}. Review account rows below before closing the month.
            </div>
          )}

          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Account</th>
                  <th style={thRightStyle}>Income</th>
                  <th style={thRightStyle}>Expense</th>
                  <th style={thRightStyle}>Net</th>
                  <th style={thRightStyle}>Bills</th>
                  <th style={thStyle}>Health</th>
                </tr>
              </thead>
              <tbody>
                {reconciliationRows.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={emptyTdStyle}>
                      No account-linked cashflow found for {monthLabel}.
                    </td>
                  </tr>
                ) : (
                  reconciliationRows.map((row) => (
                    <tr key={row.id}>
                      <td style={tdStyle}>
                        <strong>{row.name}</strong>
                        <div style={mutedStyle}>{typeLabel(row.account_type)} · {row.monthlyEntryCount} entries</div>
                      </td>
                      <td style={tdRightStyle}>{money(row.monthlyIncome)}</td>
                      <td style={tdRightStyle}>{money(row.monthlyExpense)}</td>
                      <td style={tdRightStyle}>
                        <span style={row.monthlyNet >= 0 ? positiveTextStyle : negativeTextStyle}>
                          {money(row.monthlyNet)}
                        </span>
                      </td>
                      <td style={tdRightStyle}>
                        {money(row.monthlyBillExpense)}
                        <div style={mutedStyle}>{row.monthlyBillCount} bill posted</div>
                        {row.monthlyDebtPaymentCount > 0 && (
                          <div style={miniReasonStyle}>Debt: {money(row.monthlyDebtPaymentExpense)} · {row.monthlyDebtPaymentCount}</div>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <HealthBadge tone={getReconciliationTone(row)} />
                        {row.reviewReasons.length > 0 && (
                          <div style={miniReasonStyle}>{row.reviewReasons.slice(0, 2).join(' · ')}</div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={sidePanelStyle}>
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Cash Wallet Movement</h2>
            <p style={smallTextStyle}>
              Cash Wallet balance uses the selected month's ledger formula: opening balance + cash in - cash out. Monthly movement remains separate.
            </p>

            {cashWalletRows.length === 0 ? (
              <div style={emptyStyle}>No active Cash Wallet account found.</div>
            ) : (
              <div style={cashWalletListStyle}>
                {cashWalletRows.map((row) => (
                  <div key={row.id} style={cashWalletItemStyle}>
                    <div style={accountTitleRowStyle}>
                      <strong>{row.name}</strong>
                      <span style={getCashBalanceTone(row.currentMonthFinalCashBalance) === 'good' ? activeBadgeStyle : reviewBadgeStyle}>
                        {getCashLedgerStatusLabel(row)}
                      </span>
                    </div>
                    <div style={miniMetricGridStyle}>
                      <Metric
                        label="Final Cash Balance"
                        value={money(row.currentMonthFinalCashBalance)}
                        tone={getCashBalanceTone(row.currentMonthFinalCashBalance)}
                      />
                      <Metric
                        label="This Month Movement"
                        value={money(row.monthlyNet)}
                        tone={getCashBalanceTone(row.monthlyNet)}
                      />
                      <Metric
                        label="Opening Balance"
                        value={money(getCashLedgerOpeningBalance(row))}
                        tone={getCashBalanceTone(getCashLedgerOpeningBalance(row))}
                      />
                      <Metric
                        label="Previous Final"
                        value={money(row.previousMonthHasLedger ? row.previousMonthFinalCashBalance : row.lastMonthNet)}
                        tone={getCashBalanceTone(row.previousMonthHasLedger ? row.previousMonthFinalCashBalance : row.lastMonthNet)}
                      />
                    </div>
                    <div style={cashLedgerFormulaStyle}>
                      {getCashLedgerFormulaText(row)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>

        <div style={cardStyle}>
          <div style={accountTopStyle}>
            <div>
              <h2 style={{ margin: 0 }}>Your Accounts</h2>
              <p style={smallTextStyle}>
                Account value, selected-month cashflow, all-time cashflow, and account health.
              </p>
            </div>

            <div style={filterStyle}>
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search accounts..."
                style={searchInputStyle}
              />

              <select
                value={controlFilter}
                onChange={(e) => setControlFilter(e.target.value)}
                style={selectSmallStyle}
              >
                <option value="all">All control</option>
                <option value="needsReview">Needs review</option>
                <option value="monthlyActivity">Monthly activity</option>
                <option value="billsPosted">Bills posted</option>
                <option value="cashWallet">Cash Wallet</option>
                <option value="unassigned">Unassigned</option>
              </select>

              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                style={selectSmallStyle}
              >
                <option value="all">All groups</option>
                <option value="Cash">Cash</option>
                <option value="Investment">Investment</option>
                <option value="Debt">Debt</option>
                <option value="Other">Other</option>
                <option value="Review">Review</option>
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={selectSmallStyle}
              >
                <option value="all">All types</option>
                {availableTypes.map((type) => (
                  <option key={type} value={type}>
                    {typeLabel(type)}
                  </option>
                ))}
              </select>

              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                Show archived
              </label>
            </div>
          </div>

          {loading ? (
            <p style={mutedStyle}>Loading accounts...</p>
          ) : filteredRows.length === 0 ? (
            <div style={emptyStyle}>No accounts found. Add an account or clear the filter.</div>
          ) : (
            <div style={accountPagerShellStyle}>
              <div style={accountPagerBarStyle}>
                <div>
                  <div style={accountPagerLabelStyle}>
                    Showing {accountPagerCurrent} of {accountPagerTotal}
                  </div>
                  <div style={accountPagerNameStyle}>
                    {selectedAccountRow?.name || 'No account selected'}
                  </div>
                </div>

                <div style={accountPagerActionsStyle}>
                  <button
                    type="button"
                    onClick={goToPreviousAccount}
                    disabled={accountPagerTotal <= 1}
                    style={accountPagerTotal <= 1 ? pagerButtonDisabledStyle : pagerButtonStyle}
                  >
                    ← Previous
                  </button>
                  <button
                    type="button"
                    onClick={goToNextAccount}
                    disabled={accountPagerTotal <= 1}
                    style={accountPagerTotal <= 1 ? pagerButtonDisabledStyle : pagerButtonStyle}
                  >
                    Next →
                  </button>
                </div>
              </div>

              <div style={accountPagerHintStyle}>
                Filters still load all matching accounts. This only shows one card at a time to keep the page short.
              </div>

              {selectedAccountRow && (
                <AccountCard
                  key={selectedAccountRow.id}
                  account={selectedAccountRow}
                  saving={saving}
                  editingAccountId={editingAccountId}
                  editFormData={editFormData}
                  onEditChange={handleEditChange}
                  onStartEdit={startEditAccount}
                  onCancelEdit={cancelEditAccount}
                  onUpdate={handleUpdateAccount}
                  onArchive={handleArchiveAccount}
                  onSafeDelete={handleSafeDeleteAccount}
                />
              )}
            </div>
          )}
        </div>

      <div style={mainGridStyle}>
        <div style={leftColumnStyle}>

          <div style={realDataGuardStyle}>
            <div style={guardHeaderStyle}>
              <div>
                <h2 style={{ margin: 0 }}>Real Account Opening Balance Guard</h2>
                <p style={smallTextStyle}>
                  Use this when starting a new real-data account. Opening balance is a baseline, not cashflow income or expense.
                </p>
              </div>
              <span style={pillStyle}>Manual-first</span>
            </div>

            <div style={guardRuleGridStyle}>
              <div style={guardRuleStyle}>
                <strong>Cash Wallet</strong>
                <div>Set opening balance in Cash Wallet Ledger. Count actual cash monthly.</div>
              </div>

              <div style={guardRuleStyle}>
                <strong>Checking / Savings</strong>
                <div>Add real deposits and expenses from your start date. Do not add fake income for opening balance.</div>
              </div>

              <div style={guardRuleStyle}>
                <strong>Brokerage / Crypto</strong>
                <div>Use Import / Investments to add buy lots, shares, cost basis, and prices before trusting P&amp;L.</div>
              </div>

              <div style={guardRuleStyle}>
                <strong>Credit Card / Loan</strong>
                <div>Track starting debt in Net Worth liabilities. Payments should use Net Worth → Record Payment.</div>
              </div>
            </div>

            <div style={guardWarningStyle}>
              This page will not auto-create cashflow from opening balances. That protects Net Worth, Cashflow, and P&amp;L from fake activity.
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Add Account</h2>
            <p style={smallTextStyle}>
              Add the account shell first. Then use the correct module for opening balance, cashflow, investments, or debt tracking.
            </p>

            <form onSubmit={handleAddAccount} style={{ marginTop: '18px' }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Account Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Example: Cash, Chase Checking, Robinhood"
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Account Type</label>
                <select
                  name="account_type"
                  value={formData.account_type}
                  onChange={handleChange}
                  style={inputStyle}
                >
                  {ACCOUNT_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <div style={helperTextStyle}>{typeDescription(formData.account_type)}</div>
                <div style={openingHintStyle}>
                  <strong>Opening balance path:</strong> {getOpeningBalanceGuide(formData.account_type).action}
                </div>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Currency</label>
                <select
                  name="currency"
                  value={formData.currency}
                  onChange={handleChange}
                  style={inputStyle}
                >
                  <option value="USD">USD</option>
                </select>
              </div>

              <button type="submit" disabled={saving} style={buttonStyle}>
                {saving ? 'Saving...' : 'Add Account'}
              </button>
            </form>
          </div>

        </div>

        <div style={leftColumnStyle}>
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Duplicate Watch</h2>
            {duplicateGroups.length === 0 ? (
              <p style={mutedStyle}>No duplicate-looking cashflow groups found for {monthLabel}.</p>
            ) : (
              <div style={duplicateListStyle}>
                {duplicateGroups.map((group) => (
                  <div key={group.key} style={duplicateItemStyle}>
                    <strong>{group.count} similar entries</strong>
                    <div style={mutedStyle}>
                      {group.sample.entry_date} · {group.sample.description || group.sample.category || 'No description'}
                    </div>
                    <div style={mutedStyle}>Combined amount: {money(group.totalAmount)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Account Type Breakdown</h2>
            <p style={smallTextStyle}>Grouped by standardized account type.</p>

            {typeRows.length === 0 ? (
              <p style={mutedStyle}>No account types yet.</p>
            ) : (
              <div style={typeListStyle}>
                {typeRows.map((row) => (
                  <div key={row.type} style={typeItemStyle}>
                    <div>
                      <strong>{row.label}</strong>
                      <div style={mutedStyle}>
                        {row.group} · {row.count} account{row.count === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={row.displayValue >= 0 ? positiveTextStyle : negativeTextStyle}>
                        {money(row.displayValue)}
                      </strong>
                      <div style={mutedStyle}>
                        {row.type === 'cash'
                          ? 'Final cash balance'
                          : row.type === 'checking'
                            ? 'Spendable cash value'
                            : row.type === 'savings'
                              ? 'Reserve cash value'
                              : row.type === 'business'
                                ? 'Business cash value'
                                : 'Account value'}
                      </div>
                      <div style={mutedStyle}>Month net {money(row.monthlyNet)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Reconciliation Rules</h2>
            <p style={smallTextStyle}>
              Use account assignment as the source of truth. Posted bills should have an account, Cash Wallet should hold physical cash movement, and unassigned activity should be cleaned before closing the month.
            </p>
            <div style={ruleListStyle}>
              <div>Budget thresholds read from Settings: {settings.budgetWarningPercent}% / {settings.budgetDangerPercent}%.</div>
              <div>Large expense review starts at {money(LARGE_EXPENSE_REVIEW_AMOUNT)} for this page only.</div>
              <div>No new database tables are created in this lesson.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, tone }) {
  const color =
    tone === 'good' ? '#86efac' : tone === 'bad' ? '#fca5a5' : tone === 'warn' ? '#fde68a' : '#ffffff'

  return (
    <div style={statCardStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={{ ...statValueStyle, color }}>{value}</div>
      <div style={statSubStyle}>{sub}</div>
    </div>
  )
}

function HealthBadge({ tone }) {
  if (tone === 'bad') return <span style={badBadgeStyle}>Needs Fix</span>
  if (tone === 'warn') return <span style={reviewBadgeStyle}>Review</span>
  if (tone === 'good') return <span style={activeBadgeStyle}>Good</span>
  return <span style={neutralBadgeStyle}>Normal</span>
}

function AccountCard({
  account,
  saving,
  editingAccountId,
  editFormData,
  onEditChange,
  onStartEdit,
  onCancelEdit,
  onUpdate,
  onArchive,
  onSafeDelete
}) {
  const isEditing = editingAccountId === account.id
  const canManage = account.id !== 'unassigned'
  const linkedCount = account.investmentTxCount + account.cashflowCount
  const canSafeDelete = canManage && linkedCount === 0

  const badgeStyle = account.isArchived
    ? archivedBadgeStyle
    : account.needsReview
      ? reviewBadgeStyle
      : activeBadgeStyle

  const badgeText = account.isArchived ? 'Archived' : account.needsReview ? 'Review' : 'Active'

  return (
    <div style={accountItemStyle}>
      <div style={accountTitleRowStyle}>
        <div style={{ minWidth: 0 }}>
          <strong style={accountNameStyle}>{account.name}</strong>
          <div style={accountMetaStyle}>
            {typeLabel(account.account_type)} · {account.accountGroup} · {account.currency || 'USD'}
          </div>
        </div>

        <span style={badgeStyle}>{badgeText}</span>
      </div>

      {isEditing ? (
        <div style={editBoxStyle}>
          <div style={editGridStyle}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Account Name</label>
              <input
                type="text"
                name="name"
                value={editFormData.name}
                onChange={onEditChange}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Account Type</label>
              <select
                name="account_type"
                value={editFormData.account_type}
                onChange={onEditChange}
                style={inputStyle}
              >
                {ACCOUNT_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <div style={helperTextStyle}>{typeDescription(editFormData.account_type)}</div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Currency</label>
              <select
                name="currency"
                value={editFormData.currency}
                onChange={onEditChange}
                style={inputStyle}
              >
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <div style={actionRowStyle}>
            <button
              type="button"
              onClick={() => onUpdate(account.id)}
              disabled={saving}
              style={smallPrimaryButtonStyle}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" onClick={onCancelEdit} disabled={saving} style={smallGhostButtonStyle}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {account.reviewReasons.length > 0 && (
            <div style={reviewBoxStyle}>
              {account.reviewReasons.map((reason) => (
                <span key={reason} style={reviewChipStyle}>
                  {reason}
                </span>
              ))}
            </div>
          )}

          <div style={openingStatusStyle}>
            <div>
              <strong>Opening Balance Path</strong>
              <div style={helperTextStyle}>{account.openingGuide?.detail}</div>
              <div style={helperTextStyle}>{account.openingGuide?.action}</div>
            </div>
            <span style={getOpeningToneStyle(account.openingGuide?.tone)}>
              {account.openingGuide?.label || 'Review'}
            </span>
          </div>

          <div style={metricGridStyle}>
            <Metric label="Investment" value={money(account.investmentValue)} />
            <Metric
              label="Unrealized P&L"
              value={money(account.unrealizedPL)}
              sub={formatPercent(account.unrealizedPLPercent)}
              tone={account.unrealizedPL >= 0 ? 'good' : 'bad'}
            />
            {isCashAccount(account.account_type) && (
              <Metric
                label="Final Cash Balance"
                value={money(account.currentMonthFinalCashBalance)}
                sub={
                  account.account_type === 'cash'
                    ? getCashLedgerFallbackLabel(account)
                    : account.account_type === 'savings'
                      ? 'Reserve cash · cashflow balance'
                      : account.account_type === 'checking'
                        ? 'Spendable cash · cashflow balance'
                        : account.account_type === 'business'
                          ? 'Business cash · cashflow balance'
                          : 'Cashflow balance'
                }
                tone={getCashBalanceTone(account.currentMonthFinalCashBalance)}
              />
            )}
            <Metric label="Month Income" value={money(account.monthlyIncome)} />
            <Metric label="Month Expense" value={money(account.monthlyExpense)} />
            <Metric
              label={account.account_type === 'cash' ? 'This Month Movement' : 'Month Net'}
              value={money(account.monthlyNet)}
              sub={account.account_type === 'cash' ? 'Cash in - cash out for selected month' : undefined}
              tone={account.monthlyNet >= 0 ? 'good' : 'bad'}
            />
            {account.account_type === 'cash' ? (
              <Metric
                label={account.currentMonthHasLedger ? 'Ledger Opening' : account.previousMonthHasLedger ? 'Carryover Opening' : 'Opening Source'}
                value={money(getCashLedgerOpeningBalance(account))}
                sub={
                  account.currentMonthHasLedger
                    ? 'Saved in this month ledger'
                    : account.previousMonthHasLedger
                      ? 'Carried from previous final'
                      : 'No ledger yet'
                }
                tone={getCashBalanceTone(getCashLedgerOpeningBalance(account))}
              />
            ) : (
              <Metric
                label="All-Time Net"
                value={money(account.allTimeNet)}
                tone={account.allTimeNet >= 0 ? 'good' : 'bad'}
              />
            )}
            <Metric
              label="Bills Posted"
              value={money(account.monthlyBillExpense)}
              sub={`${account.monthlyBillCount} bill entr${account.monthlyBillCount === 1 ? 'y' : 'ies'} from Bills page`}
            />
            {(account.monthlyDebtPaymentCount > 0 || account.account_type === 'cash') && (
              <Metric
                label="Debt Payments"
                value={money(account.monthlyDebtPaymentExpense)}
                sub={`${account.monthlyDebtPaymentCount} payment entr${account.monthlyDebtPaymentCount === 1 ? 'y' : 'ies'} from Net Worth`}
                tone={account.monthlyDebtPaymentCount > 0 ? 'bad' : 'neutral'}
              />
            )}
            {account.account_type !== 'cash' && (
              <Metric
                label="MoM Change"
                value={money(account.monthOverMonthChange)}
                tone={account.monthOverMonthChange >= 0 ? 'good' : 'bad'}
              />
            )}
            <Metric label="Monthly Entries" value={account.monthlyEntryCount} />
            {account.account_type === 'cash' && (
              <Metric
                label="Ledger Status"
                value={
                  account.currentMonthHasLedger
                    ? getCashLedgerStatusLabel(account)
                    : account.previousMonthHasLedger
                      ? 'Carryover estimate'
                      : 'Not set'
                }
                sub={
                  account.currentMonthHasLedger
                    ? `Current opening: ${money(account.currentMonthOpeningBalance)}`
                    : account.previousMonthHasLedger
                      ? `Previous final: ${money(account.previousMonthFinalCashBalance)}`
                      : 'Use Cash Wallet Ledger'
                }
                tone={account.currentMonthHasLedger || account.previousMonthHasLedger ? 'good' : 'bad'}
              />
            )}
          </div>

          <div style={activityStyle}>
            {account.positionCount} positions · {account.investmentTxCount} investment tx ·{' '}
            {account.cashflowCount} cashflow entries
          </div>

          {canManage && (
            <div style={actionRowStyle}>
              <button
                type="button"
                onClick={() => onStartEdit(account)}
                disabled={saving}
                style={smallGhostButtonStyle}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onArchive(account)}
                disabled={saving}
                style={smallWarnButtonStyle}
              >
                {account.isArchived ? 'Reactivate' : 'Archive'}
              </button>
              <button
                type="button"
                onClick={() => onSafeDelete(account)}
                disabled={saving || !canSafeDelete}
                title={
                  canSafeDelete
                    ? 'Delete this unused account'
                    : 'Safe delete is only available when this account has 0 linked entries'
                }
                style={canSafeDelete ? smallDangerButtonStyle : smallDisabledButtonStyle}
              >
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Metric({ label, value, sub, tone }) {
  const color = tone === 'good' ? '#86efac' : tone === 'bad' ? '#fca5a5' : '#ffffff'

  return (
    <div style={metricStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ ...metricValueStyle, color }}>{value}</div>
      {sub && <div style={metricSubStyle}>{sub}</div>}
    </div>
  )
}

const pageHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  padding: '22px 24px',
  borderRadius: '16px',
  background: '#111827',
  border: '1px solid #334155'
}

const headerActionsStyle = {
  display: 'flex',
  gap: '12px',
  alignItems: 'flex-end',
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
}

const monthLabelStyle = {
  display: 'grid',
  gap: '7px',
  color: '#bfdbfe',
  fontSize: '13px',
  fontWeight: 800
}

const monthInputStyle = {
  padding: '10px 12px',
  borderRadius: '10px',
  border: '1px solid #4b5563',
  background: '#0b1220',
  color: '#ffffff',
  fontWeight: 800
}

const eyebrowStyle = {
  color: '#93c5fd',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  fontSize: '13px',
  marginBottom: '8px'
}

const titleStyle = {
  margin: 0,
  fontSize: '34px',
  lineHeight: 1.1
}

const subtitleStyle = {
  margin: '12px 0 0',
  color: '#bfdbfe',
  lineHeight: 1.45
}

const refreshButtonStyle = {
  padding: '10px 14px',
  borderRadius: '10px',
  border: '1px solid #315b9e',
  background: 'rgba(37, 99, 235, 0.16)',
  color: '#ffffff',
  fontWeight: 800,
  cursor: 'pointer'
}

const messageStyle = {
  marginTop: '16px',
  padding: '12px 14px',
  borderRadius: '10px',
  background: '#111827',
  border: '1px solid #60a5fa',
  color: '#dbeafe'
}

const warningGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '12px',
  marginTop: '16px'
}

const warnWarningStyle = {
  padding: '13px 14px',
  borderRadius: '12px',
  background: 'rgba(245, 158, 11, 0.12)',
  border: '1px solid rgba(245, 158, 11, 0.3)',
  color: '#fde68a',
  lineHeight: 1.45
}

const badWarningStyle = {
  ...warnWarningStyle,
  background: 'rgba(239, 68, 68, 0.12)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  color: '#fecaca'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: '16px',
  marginTop: '20px'
}

const statCardStyle = {
  padding: '18px',
  borderRadius: '14px',
  background: '#111827',
  border: '1px solid #26354d',
  minWidth: 0
}

const statLabelStyle = {
  color: '#9fb1cc',
  fontSize: '14px'
}

const statValueStyle = {
  marginTop: '10px',
  fontSize: '30px',
  lineHeight: 1.1,
  fontWeight: 900
}

const statSubStyle = {
  marginTop: '8px',
  color: '#9fb1cc',
  fontSize: '13px',
  lineHeight: 1.35
}

const controlGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.35fr) 360px',
  gap: '24px',
  marginTop: '24px',
  alignItems: 'start'
}

const sidePanelStyle = {
  display: 'grid',
  gap: '24px',
  minWidth: 0
}

const sectionHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  alignItems: 'flex-start',
  marginBottom: '16px'
}

const pillStyle = {
  padding: '7px 10px',
  borderRadius: '999px',
  background: 'rgba(59, 130, 246, 0.12)',
  color: '#bfdbfe',
  fontSize: '12px',
  fontWeight: 850,
  whiteSpace: 'nowrap',
  border: '1px solid rgba(96, 165, 250, 0.28)'
}

const issueGridStyle = {
  display: 'grid',
  gap: '10px',
  marginBottom: '14px'
}

const issueWarnStyle = {
  padding: '12px',
  borderRadius: '10px',
  background: 'rgba(245, 158, 11, 0.1)',
  border: '1px solid rgba(245, 158, 11, 0.28)',
  color: '#fde68a',
  lineHeight: 1.4
}

const issueBadStyle = {
  ...issueWarnStyle,
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.28)',
  color: '#fecaca'
}

const goodNoticeStyle = {
  padding: '12px',
  borderRadius: '10px',
  background: 'rgba(34, 197, 94, 0.1)',
  border: '1px solid rgba(34, 197, 94, 0.28)',
  color: '#bbf7d0',
  marginBottom: '14px',
  lineHeight: 1.4
}

const tableWrapStyle = {
  overflowX: 'auto',
  borderRadius: '12px',
  border: '1px solid #334155'
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: '820px',
  background: '#0b1220'
}

const thStyle = {
  textAlign: 'left',
  padding: '12px',
  borderBottom: '1px solid #334155',
  color: '#bfdbfe',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em'
}

const thRightStyle = {
  ...thStyle,
  textAlign: 'right'
}

const tdStyle = {
  padding: '12px',
  borderBottom: '1px solid #1f2937',
  verticalAlign: 'top'
}

const tdRightStyle = {
  ...tdStyle,
  textAlign: 'right',
  fontWeight: 800
}

const emptyTdStyle = {
  ...tdStyle,
  textAlign: 'center',
  color: '#94a3b8',
  padding: '22px'
}

const positiveTextStyle = {
  color: '#86efac'
}

const negativeTextStyle = {
  color: '#fca5a5'
}

const miniReasonStyle = {
  marginTop: '6px',
  color: '#cbd5e1',
  fontSize: '12px',
  lineHeight: 1.35
}

const mainGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: '24px',
  marginTop: '24px',
  alignItems: 'start'
}

const leftColumnStyle = {
  display: 'grid',
  gap: '24px',
  minWidth: 0
}

const cardStyle = {
  background: '#1f2937',
  padding: '20px',
  borderRadius: '12px',
  border: '1px solid #374151',
  minWidth: 0
}

const smallTextStyle = {
  margin: '8px 0 0',
  color: '#bfdbfe',
  lineHeight: 1.45
}

const fieldStyle = {
  marginBottom: '16px'
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  fontWeight: 700
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid #4b5563',
  background: '#111827',
  color: 'white',
  fontSize: '15px'
}

const helperTextStyle = {
  marginTop: '7px',
  color: '#9fb1cc',
  fontSize: '12px',
  lineHeight: 1.35
}

const buttonStyle = {
  width: '100%',
  padding: '12px',
  border: 'none',
  borderRadius: '8px',
  background: '#2563eb',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 800,
  fontSize: '15px'
}

const accountTopStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  marginBottom: '18px'
}

const filterStyle = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
}

const checkboxLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  color: '#dbeafe',
  fontSize: '13px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid #4b5563',
  background: '#111827',
  whiteSpace: 'nowrap'
}

const searchInputStyle = {
  ...inputStyle,
  width: '220px'
}

const selectSmallStyle = {
  ...inputStyle,
  width: '150px'
}

const accountPagerShellStyle = {
  display: 'grid',
  gap: '12px'
}

const accountPagerBarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  flexWrap: 'wrap',
  padding: '12px 14px',
  borderRadius: '12px',
  background: '#0b1220',
  border: '1px solid #334155'
}

const accountPagerLabelStyle = {
  color: '#93c5fd',
  fontSize: '12px',
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.12em'
}

const accountPagerNameStyle = {
  marginTop: '3px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: 900
}

const accountPagerActionsStyle = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap'
}

const pagerButtonStyle = {
  padding: '9px 12px',
  borderRadius: '10px',
  border: '1px solid #2563eb',
  background: '#1d4ed8',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 900,
  cursor: 'pointer'
}

const pagerButtonDisabledStyle = {
  ...pagerButtonStyle,
  border: '1px solid #334155',
  background: '#111827',
  color: '#64748b',
  cursor: 'not-allowed'
}

const accountPagerHintStyle = {
  color: '#9fb1cc',
  fontSize: '12px',
  lineHeight: 1.4
}

const accountItemStyle = {
  padding: '16px',
  borderRadius: '10px',
  background: '#111827',
  border: '1px solid #374151'
}

const accountTitleRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px'
}

const accountNameStyle = {
  fontSize: '18px',
  lineHeight: 1.3
}

const accountMetaStyle = {
  marginTop: '6px',
  color: '#d1d5db',
  fontSize: '14px'
}

const activeBadgeStyle = {
  padding: '5px 9px',
  borderRadius: '999px',
  background: 'rgba(34, 197, 94, 0.12)',
  color: '#86efac',
  fontSize: '12px',
  fontWeight: 800,
  whiteSpace: 'nowrap'
}

const reviewBadgeStyle = {
  ...activeBadgeStyle,
  background: 'rgba(245, 158, 11, 0.12)',
  color: '#fde68a'
}

const badBadgeStyle = {
  ...activeBadgeStyle,
  background: 'rgba(239, 68, 68, 0.12)',
  color: '#fecaca'
}

const neutralBadgeStyle = {
  ...activeBadgeStyle,
  background: 'rgba(148, 163, 184, 0.12)',
  color: '#cbd5e1'
}

const archivedBadgeStyle = {
  ...activeBadgeStyle,
  background: 'rgba(148, 163, 184, 0.12)',
  color: '#cbd5e1'
}

const editBoxStyle = {
  marginTop: '14px',
  padding: '14px',
  borderRadius: '10px',
  background: '#0b1220',
  border: '1px solid #27364f'
}

const editGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr) 120px',
  gap: '12px',
  alignItems: 'start'
}

const actionRowStyle = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
  marginTop: '14px'
}

const smallButtonBaseStyle = {
  padding: '8px 10px',
  borderRadius: '8px',
  color: '#ffffff',
  fontWeight: 800,
  fontSize: '13px',
  cursor: 'pointer'
}

const smallPrimaryButtonStyle = {
  ...smallButtonBaseStyle,
  border: '1px solid #2563eb',
  background: '#2563eb'
}

const smallGhostButtonStyle = {
  ...smallButtonBaseStyle,
  border: '1px solid #475569',
  background: '#111827'
}

const smallWarnButtonStyle = {
  ...smallButtonBaseStyle,
  border: '1px solid #92400e',
  background: 'rgba(245, 158, 11, 0.16)',
  color: '#fde68a'
}

const smallDangerButtonStyle = {
  ...smallButtonBaseStyle,
  border: '1px solid #991b1b',
  background: 'rgba(220, 38, 38, 0.18)',
  color: '#fecaca'
}

const smallDisabledButtonStyle = {
  ...smallButtonBaseStyle,
  border: '1px solid #334155',
  background: '#111827',
  color: '#64748b',
  cursor: 'not-allowed'
}

const reviewBoxStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '7px',
  marginTop: '12px'
}

const reviewChipStyle = {
  display: 'inline-block',
  padding: '5px 8px',
  borderRadius: '999px',
  background: 'rgba(245, 158, 11, 0.12)',
  border: '1px solid rgba(245, 158, 11, 0.28)',
  color: '#fde68a',
  fontSize: '12px',
  fontWeight: 750
}

const metricGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '10px',
  marginTop: '14px'
}

const miniMetricGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: '8px',
  marginTop: '12px'
}

const cashLedgerFormulaStyle = {
  marginTop: '12px',
  padding: '10px 12px',
  borderRadius: '12px',
  background: '#111827',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  color: '#cbd5e1',
  fontSize: '12px',
  lineHeight: 1.45
}

const metricStyle = {
  padding: '10px',
  borderRadius: '8px',
  background: '#0b1220',
  border: '1px solid #27364f',
  minWidth: 0
}

const metricLabelStyle = {
  color: '#9fb1cc',
  fontSize: '12px'
}

const metricValueStyle = {
  marginTop: '5px',
  fontWeight: 850,
  fontSize: '15px'
}

const metricSubStyle = {
  marginTop: '3px',
  color: '#9fb1cc',
  fontSize: '12px'
}

const activityStyle = {
  marginTop: '12px',
  color: '#9fb1cc',
  fontSize: '13px'
}

const typeListStyle = {
  display: 'grid',
  gap: '10px',
  marginTop: '14px'
}

const typeItemStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '12px',
  borderRadius: '10px',
  background: '#111827',
  border: '1px solid #374151'
}

const mutedStyle = {
  color: '#d1d5db',
  marginTop: '4px',
  fontSize: '13px'
}

const emptyStyle = {
  padding: '18px',
  borderRadius: '10px',
  background: '#111827',
  border: '1px dashed #4b5563',
  color: '#d1d5db'
}

const cashWalletListStyle = {
  display: 'grid',
  gap: '12px',
  marginTop: '14px'
}

const cashWalletItemStyle = {
  padding: '13px',
  borderRadius: '10px',
  background: '#111827',
  border: '1px solid #334155'
}

const duplicateListStyle = {
  display: 'grid',
  gap: '10px',
  marginTop: '12px'
}

const duplicateItemStyle = {
  padding: '12px',
  borderRadius: '10px',
  background: '#111827',
  border: '1px solid rgba(245, 158, 11, 0.28)'
}


const realDataGuardStyle = {
  background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.18), rgba(15, 23, 42, 0.96))',
  padding: '20px',
  borderRadius: '14px',
  border: '1px solid rgba(96, 165, 250, 0.32)',
  minWidth: 0
}

const guardHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '14px',
  alignItems: 'flex-start',
  flexWrap: 'wrap'
}

const guardRuleGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '10px',
  marginTop: '14px'
}

const guardRuleStyle = {
  padding: '12px',
  borderRadius: '12px',
  background: 'rgba(15, 23, 42, 0.72)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  color: '#dbeafe',
  fontSize: '13px',
  lineHeight: 1.45,
  minWidth: 0
}

const guardWarningStyle = {
  marginTop: '12px',
  padding: '12px',
  borderRadius: '12px',
  background: 'rgba(245, 158, 11, 0.11)',
  border: '1px solid rgba(245, 158, 11, 0.28)',
  color: '#fde68a',
  fontSize: '13px',
  lineHeight: 1.45
}

const openingHintStyle = {
  marginTop: '8px',
  padding: '10px',
  borderRadius: '10px',
  background: 'rgba(59, 130, 246, 0.1)',
  border: '1px solid rgba(96, 165, 250, 0.22)',
  color: '#bfdbfe',
  fontSize: '12px',
  lineHeight: 1.45
}

const openingStatusStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  marginTop: '12px',
  padding: '12px',
  borderRadius: '10px',
  background: '#0b1220',
  border: '1px solid #27364f'
}


const ruleListStyle = {
  display: 'grid',
  gap: '8px',
  marginTop: '14px',
  color: '#d1d5db',
  fontSize: '13px',
  lineHeight: 1.4
}
