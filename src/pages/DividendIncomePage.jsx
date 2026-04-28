import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculateHoldings } from '../lib/holdings'
import {
  buildCategoryPayload,
  ensureDefaultCashflowCategories,
  findCategoryById,
  getCategoryOptionsByType
} from '../lib/cashflowCategories'

const INCOME_TYPES = ['dividend', 'interest']
const DIVIDEND_USE_MODES = {
  track_only: {
    label: 'Track Only',
    shortLabel: 'Track Only',
    description: 'Save in Dividend Tracker only. Does not affect Cashflow or monthly living income.',
    postToCashflow: false
  },
  reinvested: {
    label: 'Reinvested / DRIP',
    shortLabel: 'Reinvested',
    description: 'Dividend is kept inside investment accounts and used to buy ETF/stock later. Not posted to Cashflow.',
    postToCashflow: false
  },
  cashflow: {
    label: 'Post to Cashflow',
    shortLabel: 'Cashflow',
    description: 'Count this dividend as personal income in Cashflow, Budget, Money Plan, and dashboards.',
    postToCashflow: true
  }
}
const DEFAULT_FORM = {
  account_id: '',
  symbol: '',
  display_name: '',
  asset_type: 'stock',
  transaction_date: new Date().toISOString().slice(0, 10),
  income_type: 'dividend',
  shares: '',
  dividend_per_share: '',
  total_amount: '',
  fee: '0',
  dividend_use_mode: 'reinvested',
  post_to_cashflow: false,
  cashflow_category_id: '',
  note: ''
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatMoney(value) {
  return toNumber(value).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatPlainMoney(value) {
  return toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatPercent(value) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`
}

function formatQuantity(value) {
  return toNumber(value).toLocaleString(undefined, {
    maximumFractionDigits: 8
  })
}

function toDateKey(dateValue) {
  if (!dateValue) return ''
  return String(dateValue).slice(0, 10)
}

function getMonthKey(dateValue) {
  const key = toDateKey(dateValue)
  return key ? key.slice(0, 7) : ''
}

function getCurrentMonthKey() {
  return new Date().toISOString().slice(0, 7)
}

function getCurrentYearKey() {
  return new Date().toISOString().slice(0, 4)
}

function getMonthLabel(monthKey) {
  if (!monthKey) return 'Unknown'
  const [year, month] = monthKey.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  if (Number.isNaN(date.getTime())) return monthKey
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function buildLast12Months() {
  const months = []
  const today = new Date()

  for (let i = 11; i >= 0; i -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    months.push(`${year}-${month}`)
  }

  return months
}

function isWithinTrailing12Months(dateValue) {
  const date = new Date(`${toDateKey(dateValue)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return false

  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth() - 11, 1)
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 1)

  return date >= start && date < end
}

function getIncomeAmount(tx) {
  const quantity = Math.abs(toNumber(tx.quantity))
  const unitPrice = Math.abs(toNumber(tx.unit_price))
  const fee = Math.abs(toNumber(tx.fee))

  if (quantity > 0 && unitPrice > 0) {
    return Math.max(quantity * unitPrice - fee, 0)
  }

  return 0
}

function getDividendPerShare(tx) {
  const quantity = Math.abs(toNumber(tx.quantity))
  const unitPrice = Math.abs(toNumber(tx.unit_price))

  if (String(tx.type || '').toLowerCase() === 'interest') return 0
  if (quantity > 0 && unitPrice > 0) return unitPrice

  return 0
}

function groupBy(rows, keyGetter) {
  const map = new Map()

  rows.forEach((row) => {
    const key = keyGetter(row) || 'Unknown'

    if (!map.has(key)) {
      map.set(key, {
        key,
        total: 0,
        count: 0,
        lastDate: '',
        rows: []
      })
    }

    const item = map.get(key)
    item.total += row.incomeAmount
    item.count += 1
    item.lastDate = !item.lastDate || row.transaction_date > item.lastDate ? row.transaction_date : item.lastDate
    item.rows.push(row)
  })

  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

function getDefaultCashflowCategoryId(categories, incomeType) {
  const targetName = incomeType === 'interest' ? 'Interest' : 'Dividend'
  const match = categories.find(
    (category) =>
      !category.is_archived &&
      String(category.name || '').toLowerCase() === targetName.toLowerCase() &&
      (category.type === 'income' || category.type === 'both')
  )

  return match?.id || ''
}

function buildCashflowDescription({ incomeType, symbol, note }) {
  const prefix = incomeType === 'interest' ? 'Interest' : 'Dividend'
  const cleanSymbol = String(symbol || '').trim().toUpperCase() || 'Unknown'
  const cleanNote = String(note || '').trim()

  return cleanNote ? `${prefix}: ${cleanSymbol} · ${cleanNote}` : `${prefix}: ${cleanSymbol}`
}

function getToneForCashflowStatus(status) {
  if (status === 'Posted') return 'good'
  if (status === 'Not Posted') return 'warning'
  return 'muted'
}

function getDividendUseModeLabel(mode) {
  return DIVIDEND_USE_MODES[mode]?.shortLabel || 'Investment Only'
}

export default function DividendIncomePage() {
  const [allTransactions, setAllTransactions] = useState([])
  const [priceQuotes, setPriceQuotes] = useState([])
  const [assets, setAssets] = useState([])
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [cashflowEntries, setCashflowEntries] = useState([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [accountFilter, setAccountFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState(getCurrentYearKey())
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [formData, setFormData] = useState(DEFAULT_FORM)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const categoryData = await ensureDefaultCashflowCategories(supabase, user.id)

      const [accountsResult, txResult, quoteResult, assetResult, cashflowResult] = await Promise.all([
        supabase
          .from('accounts')
          .select('*')
          .eq('user_id', user.id)
          .order('name', { ascending: true }),
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
            accounts (
              id,
              name,
              account_type
            ),
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
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('price_quotes')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('assets')
          .select('*')
          .order('symbol', { ascending: true }),
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
              group_name
            )
          `)
          .eq('user_id', user.id)
          .eq('type', 'income')
          .order('entry_date', { ascending: false })
      ])

      if (accountsResult.error) throw accountsResult.error
      if (txResult.error) throw txResult.error
      if (quoteResult.error) throw quoteResult.error
      if (assetResult.error) throw assetResult.error
      if (cashflowResult.error) throw cashflowResult.error

      setCategories(categoryData || [])
      setFormData((prev) => {
        if (prev.cashflow_category_id) return prev

        return {
          ...prev,
          cashflow_category_id: getDefaultCashflowCategoryId(categoryData || [], prev.income_type)
        }
      })
      setAccounts(accountsResult.data || [])
      setAllTransactions(txResult.data || [])
      setPriceQuotes(quoteResult.data || [])
      setAssets(assetResult.data || [])
      setCashflowEntries(cashflowResult.data || [])
    } catch (error) {
      console.error('DividendIncomePage loadData error:', error)
      setMessage(error.message || 'Failed to load dividend income data')
    }

    setLoading(false)
  }

  const incomeCategoryOptions = useMemo(
    () => getCategoryOptionsByType(categories, 'income'),
    [categories]
  )

  const holdings = useMemo(() => {
    return calculateHoldings(allTransactions, priceQuotes)
  }, [allTransactions, priceQuotes])

  const enrichedTransactions = useMemo(() => {
    const incomeRows = allTransactions.filter((tx) => INCOME_TYPES.includes(String(tx.type || '').toLowerCase()))

    return incomeRows.map((tx) => {
      const symbol = tx.assets?.symbol || 'Unknown'
      const displayName = tx.assets?.display_name || symbol
      const accountName = tx.accounts?.name || 'Unassigned'
      const incomeAmount = getIncomeAmount(tx)
      const incomeType = String(tx.type || '').toLowerCase()
      const expectedDescription = buildCashflowDescription({
        incomeType,
        symbol,
        note: ''
      })

      const matchedCashflow = cashflowEntries.find((entry) => {
        const sameDate = toDateKey(entry.entry_date) === toDateKey(tx.transaction_date)
        const sameAccount = (entry.account_id || '') === (tx.account_id || '')
        const sameAmount = Math.abs(toNumber(entry.amount) - incomeAmount) < 0.01
        const description = String(entry.description || '').toLowerCase()
        const categoryName = String(entry.cashflow_categories?.name || entry.category || '').toLowerCase()
        const hasSymbol = description.includes(symbol.toLowerCase())
        const hasIncomeLabel = incomeType === 'interest'
          ? description.includes('interest') || categoryName.includes('interest')
          : description.includes('dividend') || categoryName.includes('dividend')

        return sameDate && sameAccount && sameAmount && hasSymbol && hasIncomeLabel
      })

      const dividendUseMode = matchedCashflow ? 'cashflow' : 'investment_only'

      return {
        ...tx,
        incomeType,
        incomeAmount,
        dividendPerShare: getDividendPerShare(tx),
        monthKey: getMonthKey(tx.transaction_date),
        yearKey: toDateKey(tx.transaction_date).slice(0, 4),
        symbol,
        displayName,
        assetType: tx.assets?.asset_type || 'unknown',
        accountName,
        cashflowStatus: matchedCashflow ? 'Posted' : 'Not Posted',
        dividendUseMode,
        dividendUseModeLabel: matchedCashflow ? 'Cashflow' : 'Investment Only',
        cashflowEntryId: matchedCashflow?.id || null,
        expectedDescription
      }
    })
  }, [allTransactions, cashflowEntries])

  const availableYears = useMemo(() => {
    const years = Array.from(
      new Set(enrichedTransactions.map((tx) => tx.yearKey).filter(Boolean))
    ).sort((a, b) => b.localeCompare(a))

    if (!years.includes(getCurrentYearKey())) years.unshift(getCurrentYearKey())
    return years
  }, [enrichedTransactions])

  const filteredTransactions = useMemo(() => {
    let rows = [...enrichedTransactions]

    if (accountFilter !== 'all') {
      if (accountFilter === 'unassigned') {
        rows = rows.filter((tx) => !tx.account_id)
      } else {
        rows = rows.filter((tx) => tx.account_id === accountFilter)
      }
    }

    if (yearFilter !== 'all') {
      rows = rows.filter((tx) => tx.yearKey === yearFilter)
    }

    if (statusFilter !== 'all') {
      rows = rows.filter((tx) => tx.cashflowStatus === statusFilter)
    }

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      rows = rows.filter((tx) => {
        return (
          tx.symbol.toLowerCase().includes(q) ||
          tx.displayName.toLowerCase().includes(q) ||
          tx.accountName.toLowerCase().includes(q) ||
          tx.incomeType.toLowerCase().includes(q)
        )
      })
    }

    return rows
  }, [enrichedTransactions, accountFilter, yearFilter, searchText, statusFilter])

  const bySymbol = useMemo(() => groupBy(filteredTransactions, (tx) => tx.symbol), [filteredTransactions])
  const byAccount = useMemo(() => groupBy(filteredTransactions, (tx) => tx.accountName), [filteredTransactions])

  const trailingIncomeBySymbol = useMemo(() => {
    const map = new Map()

    enrichedTransactions
      .filter((tx) => tx.incomeType === 'dividend' && isWithinTrailing12Months(tx.transaction_date))
      .forEach((tx) => {
        const key = tx.asset_id || tx.symbol
        map.set(key, (map.get(key) || 0) + tx.incomeAmount)
      })

    return map
  }, [enrichedTransactions])

  const incomeProjection = useMemo(() => {
    return holdings
      .map((holding) => {
        const trailingIncome = trailingIncomeBySymbol.get(holding.asset_id) || 0
        const currentMarketValue = toNumber(holding.market_value)
        const costBasis = toNumber(holding.cost_basis)
        const projectedMonthlyAverage = trailingIncome / 12
        const forwardYieldOnValue = currentMarketValue > 0 ? (trailingIncome / currentMarketValue) * 100 : 0
        const yieldOnCost = costBasis > 0 ? (trailingIncome / costBasis) * 100 : 0

        return {
          ...holding,
          trailingIncome,
          projectedMonthlyAverage,
          forwardYieldOnValue,
          yieldOnCost
        }
      })
      .filter((item) => item.trailingIncome > 0 || item.symbol)
      .sort((a, b) => b.trailingIncome - a.trailingIncome)
  }, [holdings, trailingIncomeBySymbol])

  const monthlyTrend = useMemo(() => {
    const months = buildLast12Months()
    const totals = months.map((monthKey) =>
      enrichedTransactions
        .filter((tx) => tx.monthKey === monthKey)
        .reduce((sum, tx) => sum + tx.incomeAmount, 0)
    )
    const maxValue = Math.max(1, ...totals)

    return months.map((monthKey, index) => ({
      monthKey,
      label: getMonthLabel(monthKey),
      total: totals[index],
      percent: Math.min((totals[index] / maxValue) * 100, 100)
    }))
  }, [enrichedTransactions])

  const summary = useMemo(() => {
    const currentMonth = getCurrentMonthKey()
    const currentYear = getCurrentYearKey()
    const totalIncome = enrichedTransactions.reduce((sum, tx) => sum + tx.incomeAmount, 0)
    const filteredIncome = filteredTransactions.reduce((sum, tx) => sum + tx.incomeAmount, 0)
    const thisMonthIncome = enrichedTransactions
      .filter((tx) => tx.monthKey === currentMonth)
      .reduce((sum, tx) => sum + tx.incomeAmount, 0)
    const thisYearIncome = enrichedTransactions
      .filter((tx) => tx.yearKey === currentYear)
      .reduce((sum, tx) => sum + tx.incomeAmount, 0)
    const trailing12Income = enrichedTransactions
      .filter((tx) => isWithinTrailing12Months(tx.transaction_date))
      .reduce((sum, tx) => sum + tx.incomeAmount, 0)
    const notPostedRows = enrichedTransactions.filter((tx) => tx.cashflowStatus === 'Not Posted')
    const postedRows = enrichedTransactions.filter((tx) => tx.cashflowStatus === 'Posted')
    const notPostedCount = notPostedRows.length
    const investmentOnlyIncome = notPostedRows.reduce((sum, tx) => sum + tx.incomeAmount, 0)
    const cashflowPostedIncome = postedRows.reduce((sum, tx) => sum + tx.incomeAmount, 0)
    const needsAmountReview = enrichedTransactions.filter((tx) => tx.incomeAmount <= 0).length
    const estimatedAnnualIncome = incomeProjection.reduce((sum, item) => sum + item.trailingIncome, 0)

    return {
      totalIncome,
      filteredIncome,
      thisMonthIncome,
      thisYearIncome,
      trailing12Income,
      estimatedAnnualIncome,
      estimatedMonthlyAverage: estimatedAnnualIncome / 12,
      totalTransactions: enrichedTransactions.length,
      filteredTransactions: filteredTransactions.length,
      notPostedCount,
      investmentOnlyIncome,
      cashflowPostedIncome,
      needsAmountReview
    }
  }, [enrichedTransactions, filteredTransactions, incomeProjection])

  const recentTransactions = useMemo(() => filteredTransactions.slice(0, 30), [filteredTransactions])
  const reviewTransactions = useMemo(
    () => enrichedTransactions.filter((tx) => tx.incomeAmount <= 0).slice(0, 12),
    [enrichedTransactions]
  )

  const topSymbol = bySymbol[0]
  const symbolConcentration = summary.filteredIncome > 0 && topSymbol
    ? (topSymbol.total / summary.filteredIncome) * 100
    : 0

  function resetForm() {
    setFormData({
      ...DEFAULT_FORM,
      transaction_date: new Date().toISOString().slice(0, 10),
      cashflow_category_id: getDefaultCashflowCategoryId(categories, 'dividend')
    })
  }

  function handleFormChange(event) {
    const { name, value, type, checked } = event.target

    setFormData((prev) => {
      const next = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }

      if (name === 'dividend_use_mode') {
        next.post_to_cashflow = DIVIDEND_USE_MODES[value]?.postToCashflow || false
      }

      if (name === 'post_to_cashflow') {
        next.dividend_use_mode = checked ? 'cashflow' : 'track_only'
      }

      if (name === 'income_type') {
        next.cashflow_category_id = getDefaultCashflowCategoryId(categories, value)

        if (value === 'interest') {
          next.shares = '1'
          next.dividend_per_share = prev.total_amount || prev.dividend_per_share || ''
        }
      }

      if (name === 'symbol') {
        const symbol = value.trim().toUpperCase()
        const matchedAsset = assets.find(
          (asset) => String(asset.symbol || '').toUpperCase() === symbol
        )

        next.symbol = symbol

        if (matchedAsset) {
          next.display_name = matchedAsset.display_name || matchedAsset.symbol || symbol
          next.asset_type = matchedAsset.asset_type || next.asset_type
        }
      }

      if (name === 'shares' || name === 'dividend_per_share') {
        const shares = name === 'shares' ? toNumber(value) : toNumber(prev.shares)
        const rate = name === 'dividend_per_share' ? toNumber(value) : toNumber(prev.dividend_per_share)
        next.total_amount = shares > 0 && rate > 0 ? String(Number((shares * rate).toFixed(8))) : prev.total_amount
      }

      if (name === 'total_amount' && prev.income_type === 'interest') {
        next.shares = '1'
        next.dividend_per_share = value
      }

      return next
    })
  }

  async function ensureAssetExists() {
    const symbol = formData.symbol.trim().toUpperCase()

    if (!symbol) throw new Error('Symbol is required')

    const existingAsset = assets.find(
      (asset) => String(asset.symbol || '').toUpperCase() === symbol
    )

    if (existingAsset) return existingAsset.id

    const { data, error } = await supabase
      .from('assets')
      .insert({
        symbol,
        display_name: formData.display_name.trim() || symbol,
        asset_type: formData.asset_type || 'stock',
        currency: 'USD'
      })
      .select()
      .single()

    if (error) throw error

    setAssets((prev) => [...prev, data].sort((a, b) => String(a.symbol || '').localeCompare(String(b.symbol || ''))))

    return data.id
  }

  async function maybePostToCashflow({ userId, amount, assetSymbol }) {
    if (!formData.post_to_cashflow) return false

    const selectedCategory = findCategoryById(categories, formData.cashflow_category_id)
    const categoryPayload = buildCategoryPayload({
      categories,
      categoryId: formData.cashflow_category_id,
      customCategory: formData.income_type === 'interest' ? 'Interest' : 'Dividend'
    })

    const description = buildCashflowDescription({
      incomeType: formData.income_type,
      symbol: assetSymbol,
      note: formData.note
    })

    const duplicate = cashflowEntries.find((entry) => {
      const sameDate = toDateKey(entry.entry_date) === toDateKey(formData.transaction_date)
      const sameAccount = (entry.account_id || '') === (formData.account_id || '')
      const sameAmount = Math.abs(toNumber(entry.amount) - amount) < 0.01
      const sameDescription = String(entry.description || '').trim().toLowerCase() === description.toLowerCase()
      return sameDate && sameAccount && sameAmount && sameDescription
    })

    if (duplicate) return false

    const { error } = await supabase.from('cashflow_entries').insert({
      user_id: userId,
      account_id: formData.account_id || null,
      entry_date: formData.transaction_date,
      type: 'income',
      amount,
      category_id: categoryPayload.category_id || selectedCategory?.id || null,
      category: categoryPayload.category || selectedCategory?.name || (formData.income_type === 'interest' ? 'Interest' : 'Dividend'),
      description
    })

    if (error) throw error

    return true
  }

  async function handleAddDividend(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')
      if (!formData.account_id) throw new Error('Please select the account that received this income')
      if (!formData.transaction_date) throw new Error('Pay date is required')
      if (!formData.income_type) throw new Error('Income type is required')

      const assetId = await ensureAssetExists()
      const symbol = formData.symbol.trim().toUpperCase()
      const feeValue = Math.max(toNumber(formData.fee), 0)
      const enteredTotalAmount = toNumber(formData.total_amount)
      const enteredIncomeRate = toNumber(formData.dividend_per_share)
      const totalAmount = enteredTotalAmount > 0 ? enteredTotalAmount : enteredIncomeRate
      const sharesValue = formData.income_type === 'interest'
        ? 1
        : toNumber(formData.shares)
      const unitPriceValue = formData.income_type === 'interest'
        ? totalAmount + feeValue
        : enteredIncomeRate

      if (formData.income_type === 'dividend' && sharesValue <= 0) {
        throw new Error('Dividend shares must be greater than 0')
      }

      if (unitPriceValue <= 0) {
        throw new Error(formData.income_type === 'interest' ? 'Interest amount is required' : 'Dividend per share is required')
      }

      const calculatedAmount = Math.max(sharesValue * unitPriceValue - feeValue, 0)

      if (calculatedAmount <= 0) {
        throw new Error('Total received must be greater than 0')
      }

      const { error: txError } = await supabase.from('investment_transactions').insert({
        user_id: user.id,
        account_id: formData.account_id,
        asset_id: assetId,
        transaction_date: formData.transaction_date,
        type: formData.income_type,
        quantity: sharesValue,
        unit_price: unitPriceValue,
        fee: feeValue
      })

      if (txError) throw txError

      const postedToCashflow = await maybePostToCashflow({
        userId: user.id,
        amount: calculatedAmount,
        assetSymbol: symbol
      })

      resetForm()
      await loadData()
      const incomeLabel = formData.income_type === 'interest' ? 'Interest' : 'Dividend'
      const useModeLabel = getDividendUseModeLabel(formData.dividend_use_mode)

      setMessage(
        postedToCashflow
          ? `${incomeLabel} saved and posted to Cashflow`
          : `${incomeLabel} saved as ${useModeLabel}. If you reinvest it, add the ETF/stock buy transaction separately.`
      )
    } catch (error) {
      console.error('handleAddDividend error:', error)
      setMessage(error.message || 'Failed to save dividend income')
    }

    setSaving(false)
  }

  async function handlePostExistingToCashflow(tx) {
    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')
      if (!tx.account_id) throw new Error('This income row has no account. Add/fix account first in Investments.')
      if (tx.incomeAmount <= 0) throw new Error('This income row has no usable dollar amount.')

      const categoryId = getDefaultCashflowCategoryId(categories, tx.incomeType)
      const categoryPayload = buildCategoryPayload({
        categories,
        categoryId,
        customCategory: tx.incomeType === 'interest' ? 'Interest' : 'Dividend'
      })

      const description = buildCashflowDescription({
        incomeType: tx.incomeType,
        symbol: tx.symbol,
        note: ''
      })

      const duplicate = cashflowEntries.find((entry) => {
        const sameDate = toDateKey(entry.entry_date) === toDateKey(tx.transaction_date)
        const sameAccount = (entry.account_id || '') === (tx.account_id || '')
        const sameAmount = Math.abs(toNumber(entry.amount) - tx.incomeAmount) < 0.01
        const sameDescription = String(entry.description || '').trim().toLowerCase() === description.toLowerCase()
        return sameDate && sameAccount && sameAmount && sameDescription
      })

      if (duplicate) {
        setMessage('This dividend already appears to be posted to Cashflow')
        setSaving(false)
        return
      }

      const { error } = await supabase.from('cashflow_entries').insert({
        user_id: user.id,
        account_id: tx.account_id,
        entry_date: tx.transaction_date,
        type: 'income',
        amount: tx.incomeAmount,
        category_id: categoryPayload.category_id,
        category: categoryPayload.category,
        description
      })

      if (error) throw error

      await loadData()
      setMessage(`${tx.symbol} posted to Cashflow`)
    } catch (error) {
      console.error('handlePostExistingToCashflow error:', error)
      setMessage(error.message || 'Failed to post dividend to cashflow')
    }

    setSaving(false)
  }

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>BÀI 46B · DIVIDEND REINVEST MODE MINI</div>
          <h1 style={titleStyle}>Dividend Income Center</h1>
          <p style={subtitleStyle}>
            Track dividends, interest income, reinvested income, optional cashflow posting, trailing 12-month income, and forward income estimates from your current holdings.
          </p>
        </div>
        <button type="button" onClick={loadData} style={refreshButtonStyle} disabled={loading || saving}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </section>

      {message && <div style={messageStyle}>{message}</div>}

      <section style={summaryGridStyle}>
        <StatCard label="This Month" value={formatMoney(summary.thisMonthIncome)} note="Dividend + interest received" />
        <StatCard label="This Year" value={formatMoney(summary.thisYearIncome)} note="Year-to-date income" />
        <StatCard label="TTM Income" value={formatMoney(summary.trailing12Income)} note="Trailing 12 months received" />
        <StatCard label="Estimated Monthly Avg" value={formatMoney(summary.estimatedMonthlyAverage)} note="Based on TTM income + current holdings" />
        <StatCard label="Investment Only" value={formatMoney(summary.investmentOnlyIncome)} note="Tracked here, not counted in Cashflow" />
        <StatCard label="Cashflow Posted" value={formatMoney(summary.cashflowPostedIncome)} note="Dividend/interest counted as income" />
        <StatCard label="Needs Review" value={summary.needsAmountReview} note="Rows missing usable amount" tone={summary.needsAmountReview > 0 ? 'warning' : 'normal'} />
      </section>

      <section style={formPanelStyle}>
        <div style={formIntroStyle}>
          <h2 style={sectionTitleStyle}>Add Dividend / Interest</h2>
          <p style={mutedStyle}>
            Saves an investment income transaction. Use Track Only or Reinvested/DRIP when the dividend stays inside your brokerage and should not affect living Cashflow.
          </p>
        </div>

        <form onSubmit={handleAddDividend} style={formGridStyle}>
          <Field label="Account">
            <select name="account_id" value={formData.account_id} onChange={handleFormChange} style={inputStyle} required>
              <option value="">Select account...</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Pay Date">
            <input name="transaction_date" type="date" value={formData.transaction_date} onChange={handleFormChange} style={inputStyle} required />
          </Field>

          <Field label="Income Type">
            <select name="income_type" value={formData.income_type} onChange={handleFormChange} style={inputStyle}>
              <option value="dividend">Dividend</option>
              <option value="interest">Interest</option>
            </select>
          </Field>

          <Field label="Symbol">
            <input name="symbol" value={formData.symbol} onChange={handleFormChange} placeholder="JEPQ, SCHD, JEPI..." style={inputStyle} required />
          </Field>

          <Field label="Display Name">
            <input name="display_name" value={formData.display_name} onChange={handleFormChange} placeholder="Optional" style={inputStyle} />
          </Field>

          <Field label="Asset Type">
            <select name="asset_type" value={formData.asset_type} onChange={handleFormChange} style={inputStyle}>
              <option value="stock">Stock / ETF</option>
              <option value="crypto">Crypto</option>
              <option value="fund">Fund</option>
              <option value="other">Other</option>
            </select>
          </Field>

          <Field label={formData.income_type === 'interest' ? 'Quantity' : 'Shares'}>
            <input
              name="shares"
              type="number"
              step="0.00000001"
              min="0"
              value={formData.shares}
              onChange={handleFormChange}
              placeholder={formData.income_type === 'interest' ? '1' : '100'}
              style={inputStyle}
              disabled={formData.income_type === 'interest'}
              required={formData.income_type === 'dividend'}
            />
          </Field>

          <Field label={formData.income_type === 'interest' ? 'Interest Amount' : 'Dividend / Share'}>
            <input
              name="dividend_per_share"
              type="number"
              step="0.00000001"
              min="0"
              value={formData.dividend_per_share}
              onChange={handleFormChange}
              placeholder={formData.income_type === 'interest' ? '45.00' : '0.4500'}
              style={inputStyle}
              required
            />
          </Field>

          <Field label="Total Received">
            <input name="total_amount" type="number" step="0.01" min="0" value={formData.total_amount} onChange={handleFormChange} placeholder="Auto-calculated" style={inputStyle} />
          </Field>

          <Field label="Fee">
            <input name="fee" type="number" step="0.01" min="0" value={formData.fee} onChange={handleFormChange} style={inputStyle} />
          </Field>

          <Field label="Cashflow Category">
            <select name="cashflow_category_id" value={formData.cashflow_category_id} onChange={handleFormChange} style={inputStyle} disabled={!formData.post_to_cashflow}>
              <option value="">Auto / fallback</option>
              {incomeCategoryOptions.map((category) => (
                <option key={category.id} value={category.id}>{category.group_name ? `${category.group_name} · ${category.name}` : category.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Note">
            <input name="note" value={formData.note} onChange={handleFormChange} placeholder="Optional note" style={inputStyle} />
          </Field>

          <div style={useModeWrapStyle}>
            <div style={useModeHeaderStyle}>Dividend Use Mode</div>
            <div style={useModeGridStyle}>
              {Object.entries(DIVIDEND_USE_MODES).map(([modeKey, mode]) => (
                <label
                  key={modeKey}
                  style={{
                    ...useModeCardStyle,
                    ...(formData.dividend_use_mode === modeKey ? useModeCardActiveStyle : {})
                  }}
                >
                  <input
                    name="dividend_use_mode"
                    type="radio"
                    value={modeKey}
                    checked={formData.dividend_use_mode === modeKey}
                    onChange={handleFormChange}
                  />
                  <span style={useModeTextStyle}>
                    <strong>{mode.label}</strong>
                    <small style={useModeDescriptionStyle}>{mode.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div style={formActionsStyle}>
            <button type="button" onClick={resetForm} style={secondaryButtonStyle} disabled={saving}>Reset</button>
            <button type="submit" style={primaryButtonStyle} disabled={saving}>{saving ? 'Saving...' : 'Save Dividend'}</button>
          </div>
        </form>
      </section>

      <section style={modeGuideStyle}>
        <div>
          <h2 style={sectionTitleStyle}>Reinvest Logic</h2>
          <p style={mutedStyle}>
            Dividend income and the ETF/stock purchase are two different investment events. Reinvested dividends stay out of Cashflow, then the actual buy should be recorded as a separate buy transaction.
          </p>
        </div>
        <div style={guideGridStyle}>
          <GuideCard title="1. Dividend Received" text="Save dividend as Track Only or Reinvested/DRIP. This keeps Dividend Tracker accurate without inflating living income." />
          <GuideCard title="2. Buy ETF / Stock" text="When you use that dividend to buy SCHD, JEPQ, JEPI, or another ETF, add/import the buy transaction separately so holdings shares update." />
          <GuideCard title="3. Cashflow Optional" text="Only choose Post to Cashflow when the money is truly available for spending or you want it counted in monthly personal income." />
        </div>
      </section>

      <section style={controlPanelStyle}>
        <div>
          <h2 style={sectionTitleStyle}>Income Filters</h2>
          <p style={mutedStyle}>Filter without changing any database records.</p>
        </div>

        <div style={filtersStyle}>
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search symbol, account, type..."
            style={inputStyle}
          />
          <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)} style={inputStyle}>
            <option value="all">All accounts</option>
            <option value="unassigned">Unassigned only</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
          <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} style={inputStyle}>
            <option value="all">All years</option>
            {availableYears.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
            <option value="all">All use statuses</option>
            <option value="Posted">Posted</option>
            <option value="Not Posted">Not Posted</option>
          </select>
        </div>
      </section>

      <section style={twoColumnGridStyle}>
        <Panel title="Monthly Income Trend" description="Last 12 months based on dividend / interest pay date.">
          {monthlyTrend.every((item) => item.total === 0) ? (
            <EmptyState text="No dividend or interest income found yet." />
          ) : (
            <div style={trendListStyle}>
              {monthlyTrend.map((item) => (
                <div key={item.monthKey} style={trendRowStyle}>
                  <div style={trendLabelStyle}>{item.label}</div>
                  <div style={trendBarWrapStyle}>
                    <div style={{ ...trendBarStyle, width: `${Math.max(item.percent, item.total > 0 ? 4 : 0)}%` }} />
                  </div>
                  <div style={trendValueStyle}>{formatMoney(item.total)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Income Quality" description="Quick checks for dividend tracking readiness.">
          <div style={qualityGridStyle}>
            <QualityCard label="Filtered Income" value={formatMoney(summary.filteredIncome)} note={`${summary.filteredTransactions} filtered row(s)`} />
            <QualityCard label="Top Symbol Share" value={formatPercent(symbolConcentration)} note={topSymbol ? `${topSymbol.key} is your largest income source` : 'No income source yet'} tone={symbolConcentration > 50 ? 'warning' : 'normal'} />
            <QualityCard label="Income Sources" value={bySymbol.length} note="Symbols with income transactions" />
            <QualityCard label="Accounts Used" value={byAccount.length} note="Accounts receiving income" />
          </div>
        </Panel>
      </section>

      <section style={panelStyle}>
        <div style={tableHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Forward Income Estimate</h2>
            <p style={mutedStyle}>Uses trailing 12-month dividend income by symbol against your current holdings. No outside dividend API needed.</p>
          </div>
          <div style={miniSummaryStyle}>
            <div style={mutedSmallStyle}>Estimated Annual</div>
            <strong>{formatMoney(summary.estimatedAnnualIncome)}</strong>
          </div>
        </div>

        {incomeProjection.length === 0 ? (
          <EmptyState text="No holdings found yet. Add holdings and dividend rows first." />
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th align="right">Shares</Th>
                  <Th align="right">TTM Income</Th>
                  <Th align="right">Monthly Avg</Th>
                  <Th align="right">Yield on Cost</Th>
                  <Th align="right">Yield on Value</Th>
                </tr>
              </thead>
              <tbody>
                {incomeProjection.slice(0, 30).map((item) => (
                  <tr key={item.asset_id} style={tableRowStyle}>
                    <Td>
                      <strong>{item.symbol}</strong>
                      <div style={mutedSmallStyle}>{item.display_name}</div>
                    </Td>
                    <Td align="right">{formatQuantity(item.quantity)}</Td>
                    <Td align="right"><strong>{formatMoney(item.trailingIncome)}</strong></Td>
                    <Td align="right">{formatMoney(item.projectedMonthlyAverage)}</Td>
                    <Td align="right">{item.yieldOnCost > 0 ? formatPercent(item.yieldOnCost) : '—'}</Td>
                    <Td align="right">{item.forwardYieldOnValue > 0 ? formatPercent(item.forwardYieldOnValue) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={twoColumnGridStyle}>
        <Panel title="Income by Symbol" description="Dividend / interest grouped by ticker or coin.">
          {bySymbol.length === 0 ? (
            <EmptyState text="No matching income by symbol." />
          ) : (
            <ScrollableList>
              {bySymbol.map((item) => (
                <BreakdownRow
                  key={item.key}
                  title={item.key}
                  subtitle={`${item.count} transaction(s) · Last ${item.lastDate || 'N/A'}`}
                  value={formatMoney(item.total)}
                  percent={summary.filteredIncome > 0 ? (item.total / summary.filteredIncome) * 100 : 0}
                />
              ))}
            </ScrollableList>
          )}
        </Panel>

        <Panel title="Income by Account" description="Shows where dividend income is landing.">
          {byAccount.length === 0 ? (
            <EmptyState text="No matching income by account." />
          ) : (
            <ScrollableList>
              {byAccount.map((item) => (
                <BreakdownRow
                  key={item.key}
                  title={item.key}
                  subtitle={`${item.count} transaction(s) · Last ${item.lastDate || 'N/A'}`}
                  value={formatMoney(item.total)}
                  percent={summary.filteredIncome > 0 ? (item.total / summary.filteredIncome) * 100 : 0}
                />
              ))}
            </ScrollableList>
          )}
        </Panel>
      </section>

      {reviewTransactions.length > 0 && (
        <section style={panelStyle}>
          <h2 style={sectionTitleStyle}>Needs Amount Review</h2>
          <p style={mutedStyle}>These rows exist, but the app cannot calculate a dollar amount because quantity or unit price is missing.</p>
          <div style={reviewListStyle}>
            {reviewTransactions.map((tx) => (
              <div key={tx.id} style={reviewRowStyle}>
                <div>
                  <strong>{tx.symbol}</strong>
                  <div style={mutedSmallStyle}>{tx.transaction_date} · {tx.incomeType} · {tx.accountName}</div>
                </div>
                <div style={mutedSmallStyle}>Qty {formatQuantity(tx.quantity)} · Price {formatMoney(tx.unit_price)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={panelStyle}>
        <div style={tableHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Dividend / Interest Ledger</h2>
            <p style={mutedStyle}>Showing up to 30 filtered income rows. Investment Only means it is tracked here but not counted as personal Cashflow income. If reinvested, add the buy transaction separately.</p>
          </div>
        </div>

        {recentTransactions.length === 0 ? (
          <EmptyState text="No dividend or interest transactions match your filters." />
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Symbol</Th>
                  <Th>Type</Th>
                  <Th>Account</Th>
                  <Th align="right">Shares</Th>
                  <Th align="right">$/Share</Th>
                  <Th align="right">Income</Th>
                  <Th>Use Mode</Th>
                  <Th>Cashflow</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((tx) => (
                  <tr key={tx.id} style={tableRowStyle}>
                    <Td>{tx.transaction_date}</Td>
                    <Td>
                      <strong>{tx.symbol}</strong>
                      <div style={mutedSmallStyle}>{tx.displayName}</div>
                    </Td>
                    <Td>{tx.incomeType}</Td>
                    <Td>{tx.accountName}</Td>
                    <Td align="right">{formatQuantity(tx.quantity)}</Td>
                    <Td align="right">{tx.dividendPerShare > 0 ? formatPlainMoney(tx.dividendPerShare) : '—'}</Td>
                    <Td align="right"><strong>{formatMoney(tx.incomeAmount)}</strong></Td>
                    <Td>
                      <span style={{ ...statusPillStyle, ...statusToneStyle[tx.cashflowStatus === 'Posted' ? 'good' : 'muted'] }}>
                        {tx.dividendUseModeLabel}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ ...statusPillStyle, ...statusToneStyle[getToneForCashflowStatus(tx.cashflowStatus)] }}>
                        {tx.cashflowStatus}
                      </span>
                    </Td>
                    <Td align="right">
                      {tx.cashflowStatus === 'Not Posted' ? (
                        <button type="button" style={smallButtonStyle} onClick={() => handlePostExistingToCashflow(tx)} disabled={saving}>
                          Post
                        </button>
                      ) : (
                        <span style={mutedSmallStyle}>Done</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  )
}

function StatCard({ label, value, note, tone = 'normal' }) {
  return (
    <div style={statCardStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={{ ...statValueStyle, color: tone === 'warning' ? '#facc15' : '#86efac' }}>{value}</div>
      <div style={mutedSmallStyle}>{note}</div>
    </div>
  )
}

function Panel({ title, description, children }) {
  return (
    <section style={panelStyle}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      <p style={mutedStyle}>{description}</p>
      {children}
    </section>
  )
}

function GuideCard({ title, text }) {
  return (
    <div style={guideCardStyle}>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  )
}

function QualityCard({ label, value, note, tone = 'normal' }) {
  return (
    <div style={qualityCardStyle}>
      <div style={mutedSmallStyle}>{label}</div>
      <div style={{ ...qualityValueStyle, color: tone === 'warning' ? '#facc15' : 'white' }}>{value}</div>
      <div style={mutedSmallStyle}>{note}</div>
    </div>
  )
}

function BreakdownRow({ title, subtitle, value, percent }) {
  return (
    <div style={breakdownRowStyle}>
      <div style={breakdownTopStyle}>
        <div>
          <strong>{title}</strong>
          <div style={mutedSmallStyle}>{subtitle}</div>
        </div>
        <strong>{value}</strong>
      </div>
      <div style={progressTrackStyle}>
        <div style={{ ...progressFillStyle, width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
      </div>
    </div>
  )
}

function ScrollableList({ children }) {
  return <div style={scrollListStyle}>{children}</div>
}

function EmptyState({ text }) {
  return <div style={emptyStyle}>{text}</div>
}

function Th({ children, align = 'left' }) {
  return <th style={{ ...thStyle, textAlign: align }}>{children}</th>
}

function Td({ children, align = 'left' }) {
  return <td style={{ ...tdStyle, textAlign: align }}>{children}</td>
}

const pageStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box'
}

const heroStyle = {
  border: '1px solid #334155',
  background: 'linear-gradient(135deg, #111827 0%, #172033 100%)',
  borderRadius: '18px',
  padding: '28px 32px',
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  alignItems: 'flex-start',
  flexWrap: 'wrap'
}

const eyebrowStyle = {
  color: '#93c5fd',
  letterSpacing: '0.18em',
  fontSize: '13px',
  fontWeight: 800,
  marginBottom: '10px'
}

const titleStyle = {
  margin: 0,
  fontSize: '34px',
  lineHeight: 1.1
}

const subtitleStyle = {
  margin: '14px 0 0',
  color: '#bfdbfe',
  fontSize: '17px',
  lineHeight: 1.5,
  maxWidth: '780px'
}

const refreshButtonStyle = {
  border: '1px solid #2563eb',
  background: '#1d4ed8',
  color: 'white',
  borderRadius: '10px',
  padding: '11px 16px',
  fontWeight: 800,
  cursor: 'pointer'
}

const messageStyle = {
  border: '1px solid #f59e0b',
  color: '#fde68a',
  background: 'rgba(245, 158, 11, 0.08)',
  borderRadius: '14px',
  padding: '14px 16px'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: '18px'
}

const statCardStyle = {
  border: '1px solid #334155',
  background: '#111827',
  borderRadius: '16px',
  padding: '20px'
}

const statLabelStyle = {
  color: '#bfdbfe',
  fontSize: '14px',
  marginBottom: '12px'
}

const statValueStyle = {
  fontSize: '30px',
  fontWeight: 900,
  lineHeight: 1
}

const formPanelStyle = {
  border: '1px solid #334155',
  background: 'linear-gradient(180deg, #111827 0%, #0b1220 100%)',
  borderRadius: '18px',
  padding: '24px'
}

const formIntroStyle = {
  marginBottom: '18px'
}

const formGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '16px',
  alignItems: 'end'
}

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  minWidth: 0
}

const fieldLabelStyle = {
  color: '#cbd5e1',
  fontSize: '13px',
  fontWeight: 800
}

const inputStyle = {
  width: '100%',
  background: '#020617',
  color: 'white',
  border: '1px solid #334155',
  borderRadius: '10px',
  padding: '12px 14px',
  fontSize: '15px',
  boxSizing: 'border-box'
}

const useModeWrapStyle = {
  gridColumn: '1 / -1',
  border: '1px solid #26364f',
  background: '#0b1220',
  borderRadius: '16px',
  padding: '16px'
}

const useModeHeaderStyle = {
  color: '#cbd5e1',
  fontSize: '13px',
  fontWeight: 900,
  marginBottom: '12px'
}

const useModeGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: '12px'
}

const useModeCardStyle = {
  display: 'flex',
  gap: '10px',
  alignItems: 'flex-start',
  border: '1px solid #334155',
  background: '#020617',
  borderRadius: '14px',
  padding: '14px',
  color: '#e5e7eb',
  cursor: 'pointer'
}

const useModeCardActiveStyle = {
  borderColor: '#60a5fa',
  background: 'rgba(37, 99, 235, 0.16)'
}

const useModeTextStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  lineHeight: 1.35
}

const useModeDescriptionStyle = {
  color: '#93a4bd',
  fontSize: '12px',
  fontWeight: 600
}

const formActionsStyle = {
  display: 'flex',
  gap: '10px',
  justifyContent: 'flex-end',
  alignItems: 'center'
}

const primaryButtonStyle = {
  border: '1px solid #16a34a',
  background: '#15803d',
  color: 'white',
  borderRadius: '10px',
  padding: '12px 16px',
  fontWeight: 900,
  cursor: 'pointer'
}

const secondaryButtonStyle = {
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#dbeafe',
  borderRadius: '10px',
  padding: '12px 16px',
  fontWeight: 800,
  cursor: 'pointer'
}

const modeGuideStyle = {
  border: '1px solid #334155',
  background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(34, 197, 94, 0.08))',
  borderRadius: '18px',
  padding: '24px'
}

const guideGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: '14px'
}

const guideCardStyle = {
  border: '1px solid #334155',
  background: '#0b1220',
  borderRadius: '14px',
  padding: '16px',
  color: '#e5e7eb',
  lineHeight: 1.45
}

const controlPanelStyle = {
  border: '1px solid #334155',
  background: '#111827',
  borderRadius: '16px',
  padding: '22px',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '18px',
  flexWrap: 'wrap'
}

const filtersStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: '12px',
  width: 'min(880px, 100%)'
}

const twoColumnGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '20px'
}

const panelStyle = {
  border: '1px solid #334155',
  background: '#111827',
  borderRadius: '18px',
  padding: '24px',
  minWidth: 0
}

const sectionTitleStyle = {
  margin: 0,
  fontSize: '25px',
  lineHeight: 1.15
}

const mutedStyle = {
  margin: '10px 0 18px',
  color: '#bfdbfe',
  lineHeight: 1.45
}

const mutedSmallStyle = {
  color: '#93a4bd',
  fontSize: '13px',
  lineHeight: 1.35
}

const trendListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px'
}

const trendRowStyle = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr 105px',
  gap: '12px',
  alignItems: 'center'
}

const trendLabelStyle = {
  color: '#e5e7eb',
  fontWeight: 700,
  fontSize: '13px'
}

const trendBarWrapStyle = {
  height: '10px',
  background: '#1f2937',
  borderRadius: '999px',
  overflow: 'hidden'
}

const trendBarStyle = {
  height: '100%',
  background: 'linear-gradient(90deg, #3b82f6, #22c55e)',
  borderRadius: '999px'
}

const trendValueStyle = {
  textAlign: 'right',
  fontWeight: 800
}

const qualityGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '14px'
}

const qualityCardStyle = {
  border: '1px solid #334155',
  borderRadius: '14px',
  padding: '16px',
  background: '#0b1220'
}

const qualityValueStyle = {
  fontSize: '24px',
  fontWeight: 900,
  margin: '8px 0 4px'
}

const miniSummaryStyle = {
  border: '1px solid #334155',
  background: '#0b1220',
  borderRadius: '14px',
  padding: '14px 16px',
  minWidth: '170px',
  textAlign: 'right'
}

const scrollListStyle = {
  maxHeight: '360px',
  overflowY: 'auto',
  paddingRight: '6px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px'
}

const breakdownRowStyle = {
  border: '1px solid #26364f',
  background: '#0b1220',
  borderRadius: '14px',
  padding: '16px'
}

const breakdownTopStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  alignItems: 'flex-start',
  marginBottom: '12px'
}

const progressTrackStyle = {
  height: '9px',
  background: '#1f2937',
  borderRadius: '999px',
  overflow: 'hidden'
}

const progressFillStyle = {
  height: '100%',
  background: 'linear-gradient(90deg, #3b82f6, #22c55e)',
  borderRadius: '999px'
}

const reviewListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  maxHeight: '320px',
  overflowY: 'auto',
  paddingRight: '6px'
}

const reviewRowStyle = {
  border: '1px solid #7c2d12',
  background: 'rgba(124, 45, 18, 0.16)',
  borderRadius: '12px',
  padding: '14px 16px',
  display: 'flex',
  justifyContent: 'space-between',
  gap: '14px',
  flexWrap: 'wrap'
}

const tableHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  alignItems: 'flex-start',
  flexWrap: 'wrap'
}

const tableWrapStyle = {
  width: '100%',
  maxHeight: '560px',
  overflow: 'auto',
  border: '1px solid #26364f',
  borderRadius: '14px'
}

const tableStyle = {
  width: '100%',
  minWidth: '980px',
  borderCollapse: 'collapse',
  background: '#0b1220'
}

const thStyle = {
  position: 'sticky',
  top: 0,
  background: '#111827',
  color: '#a8b5ca',
  borderBottom: '1px solid #334155',
  padding: '14px 16px',
  fontSize: '13px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  zIndex: 1
}

const tdStyle = {
  padding: '14px 16px',
  borderBottom: '1px solid #1f2a3d',
  verticalAlign: 'top'
}

const tableRowStyle = {
  color: '#e5e7eb'
}

const statusPillStyle = {
  display: 'inline-flex',
  borderRadius: '999px',
  padding: '5px 10px',
  fontSize: '12px',
  fontWeight: 900,
  border: '1px solid transparent',
  whiteSpace: 'nowrap'
}

const statusToneStyle = {
  good: {
    color: '#bbf7d0',
    background: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.35)'
  },
  warning: {
    color: '#fde68a',
    background: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.35)'
  },
  muted: {
    color: '#cbd5e1',
    background: 'rgba(148, 163, 184, 0.12)',
    borderColor: 'rgba(148, 163, 184, 0.24)'
  }
}

const smallButtonStyle = {
  border: '1px solid #2563eb',
  background: '#1d4ed8',
  color: 'white',
  borderRadius: '9px',
  padding: '8px 11px',
  fontWeight: 900,
  cursor: 'pointer'
}

const emptyStyle = {
  border: '1px dashed #334155',
  borderRadius: '14px',
  padding: '24px',
  color: '#bfdbfe',
  textAlign: 'center'
}
