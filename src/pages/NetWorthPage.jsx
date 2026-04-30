import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculateHoldings, calculatePortfolioSummary } from '../lib/holdings'
import { calculateNetWorthSummary, formatMoney } from '../lib/networth'
import { ensureDefaultCashflowCategories } from '../lib/cashflowCategories'

const DEBT_PAYMENT_CATEGORY = 'Debt Payment'
const LIABILITY_BILL_NOTE_PREFIX = 'linked_liability_id:'

function money(value) {
  return `$${formatMoney(Number(value || 0))}`
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7)
}

function monthKeyFromDate(value) {
  return String(value || todayISO()).slice(0, 7)
}

function dateFromMonthDay(monthKey, day) {
  const n = Number(day)
  if (!monthKey || !Number.isFinite(n) || n < 1 || n > 31) return ''
  const [year, month] = monthKey.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return `${monthKey}-${String(Math.min(n, lastDay)).padStart(2, '0')}`
}


function addMonthsToMonthKey(monthKey, offset) {
  if (!monthKey) return currentMonthKey()
  const [year, month] = monthKey.split('-').map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return currentMonthKey()
  const d = new Date(year, month - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function dateFromMonthDayAfterDate(baseDate, day) {
  const n = Number(day)
  if (!baseDate || !Number.isFinite(n) || n < 1 || n > 31) return ''
  const base = new Date(`${baseDate}T00:00:00`)
  if (Number.isNaN(base.getTime())) return ''

  let candidateMonthKey = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`
  let candidate = dateFromMonthDay(candidateMonthKey, n)
  if (candidate && new Date(`${candidate}T00:00:00`).getTime() <= base.getTime()) {
    candidateMonthKey = addMonthsToMonthKey(candidateMonthKey, 1)
    candidate = dateFromMonthDay(candidateMonthKey, n)
  }
  return candidate
}

function statementDateForMonth(liability, monthKey) {
  return dateFromMonthDay(monthKey, liability?.statement_day)
}

function dueDateForStatementMonth(liability, monthKey) {
  const statementDate = statementDateForMonth(liability, monthKey)
  if (!statementDate) return dateFromMonthDay(monthKey, liability?.due_day)
  return dateFromMonthDayAfterDate(statementDate, liability?.due_day)
}

function statementMonthKeyForPaymentDate(liability, paymentDate) {
  const value = paymentDate || todayISO()
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return monthKeyFromDate(value)

  const statementDay = Number(liability?.statement_day)
  if (!Number.isFinite(statementDay) || statementDay < 1 || statementDay > 31) {
    return monthKeyFromDate(value)
  }

  const paymentDay = d.getDate()
  const paymentMonthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  return paymentDay >= statementDay ? paymentMonthKey : addMonthsToMonthKey(paymentMonthKey, -1)
}

function niceDate(value) {
  if (!value) return 'Not set'
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(value) {
  if (!value) return null
  const start = new Date(`${todayISO()}T00:00:00`)
  const end = new Date(`${value}T00:00:00`)
  if (Number.isNaN(end.getTime())) return null
  return Math.ceil((end.getTime() - start.getTime()) / 86400000)
}

function displayAccountName(account) {
  if (!account) return 'Unknown account'
  return `${account.name || 'Unnamed Account'}${account.account_type ? ` · ${account.account_type}` : ''}`
}

function estimateMonthlyInterest(balance, apr) {
  const b = toNumber(balance)
  const r = toNumber(apr)
  if (b <= 0 || r <= 0) return 0
  return (b * r) / 100 / 12
}

function statementActivityTotal(row) {
  return toNumber(row?.new_charges) + toNumber(row?.interest_charged) + toNumber(row?.fees)
}

function statementUpdateNote(row) {
  const added = statementActivityTotal(row)
  const paid = toNumber(row?.principal_paid)
  const opening = toNumber(row?.opening_balance)
  const closing = statementClosing(row)

  if (added === 0 && paid === 0) {
    return 'No statement activity entered yet. Add the charges from your real statement, then apply the update.'
  }

  if (closing > opening) {
    return `Balance increases by ${money(closing - opening)} after statement charges and payments.`
  }

  if (closing < opening) {
    return `Balance decreases by ${money(opening - closing)} after payments and statement charges.`
  }

  return 'Projected closing balance matches the opening balance.'
}

function statementClosing(row) {
  return Math.max(
    0,
    toNumber(row?.opening_balance) +
      toNumber(row?.new_charges) +
      toNumber(row?.interest_charged) +
      toNumber(row?.fees) -
      toNumber(row?.principal_paid)
  )
}

function statementStatus(statement, liability) {
  if (statement?.status === 'closed') return { label: 'Closed', tone: 'neutral' }
  if (statement?.status === 'paid') return { label: 'Paid', tone: 'good' }
  if (statement?.status === 'partial') return { label: 'Partial', tone: 'warn' }

  const dueDate = statement?.due_date || dueDateForStatementMonth(liability, currentMonthKey())
  const days = daysUntil(dueDate)
  if (days != null && days < 0) return { label: 'Overdue', tone: 'bad' }
  if (days != null && days <= 7) return { label: `Due in ${days}d`, tone: 'warn' }
  if (dueDate) return { label: `Due ${niceDate(dueDate)}`, tone: 'neutral' }
  return { label: 'Schedule needed', tone: 'warn' }
}

function makeDebtPaymentDescription({ liabilityName, principalAmount, interestFeeAmount, note }) {
  const pieces = [
    `Debt Payment: ${liabilityName}`,
    `Principal: ${money(principalAmount)}`,
    `Interest/Fee: ${money(interestFeeAmount)}`
  ]
  const cleanedNote = String(note || '').trim()
  if (cleanedNote) pieces.push(`Note: ${cleanedNote}`)
  return pieces.join(' · ')
}

function makeDebtBillName(liability) {
  const name = String(liability?.name || 'Debt').trim()
  return `${name} Payment`
}

function makeDebtBillNote(liability) {
  const pieces = [
    `${LIABILITY_BILL_NOTE_PREFIX}${liability.id}`,
    'Auto-created from Net Worth Liability Bill Sync',
    liability.default_payment_account_id ? `default_payment_account_id:${liability.default_payment_account_id}` : '',
    liability.autopay_enabled ? 'autopay:on' : 'autopay:off'
  ].filter(Boolean)
  return pieces.join(' | ')
}


function appendDebtBillPaymentNote(note, paymentDate, cashflowEntryId) {
  const base = String(note || '').trim()
  const pieces = base ? base.split('|').map((item) => item.trim()).filter(Boolean) : []
  const filtered = pieces.filter(
    (piece) =>
      !piece.startsWith('last_payment_date:') &&
      !piece.startsWith('last_cashflow_entry_id:') &&
      !piece.startsWith('last_payment_source:')
  )

  filtered.push(`last_payment_date:${paymentDate}`)
  if (cashflowEntryId) filtered.push(`last_cashflow_entry_id:${cashflowEntryId}`)
  filtered.push('last_payment_source:net_worth')

  return filtered.join(' | ')
}

function getLinkedBillForLiability(liability, bills = []) {
  return bills.find((item) => billLinkedToLiability(item, liability)) || null
}

function billLinkedToLiability(bill, liability) {
  if (!bill || !liability?.id) return false
  const note = String(bill.note || '')
  if (note.includes(`${LIABILITY_BILL_NOTE_PREFIX}${liability.id}`)) return true
  return String(bill.name || '').trim().toLowerCase() === makeDebtBillName(liability).toLowerCase()
}

function liabilityBillStatus(liability, bills = []) {
  const bill = bills.find((item) => billLinkedToLiability(item, liability)) || null
  if (!bill) return { bill: null, label: 'Bill not synced', tone: 'warn' }
  if (String(bill.status || '').toLowerCase() !== 'active') {
    return { bill, label: 'Bill inactive', tone: 'warn' }
  }
  const dueMatches = Number(bill.due_day || 0) === Number(liability.due_day || 0)
  const amountMatches = Math.abs(toNumber(bill.amount) - toNumber(liability.minimum_payment)) < 0.01
  if (!dueMatches || !amountMatches) {
    return { bill, label: 'Bill needs update', tone: 'warn' }
  }
  return { bill, label: 'Bill synced', tone: 'good' }
}

const blankAssetForm = {
  name: '',
  asset_class: 'cash',
  current_value: '',
  notes: ''
}

const blankLiabilityForm = {
  name: '',
  liability_type: 'credit_card',
  current_balance: '',
  interest_rate: '',
  minimum_payment: '',
  due_day: '',
  statement_day: '',
  default_payment_account_id: '',
  autopay_enabled: false,
  notes: ''
}

const blankPaymentForm = {
  account_id: '',
  payment_date: todayISO(),
  total_payment: '',
  principal_amount: '',
  note: ''
}

const blankStatementForm = {
  month_key: currentMonthKey(),
  opening_balance: '',
  new_charges: '',
  interest_charged: '',
  fees: '',
  payments_made: '0',
  principal_paid: '0',
  minimum_due: '',
  due_date: '',
  statement_date: '',
  status: 'open',
  note: ''
}

export default function NetWorthPage() {
  const [accounts, setAccounts] = useState([])
  const [assetAccounts, setAssetAccounts] = useState([])
  const [liabilities, setLiabilities] = useState([])
  const [statements, setStatements] = useState([])
  const [bills, setBills] = useState([])
  const [investmentMarketValue, setInvestmentMarketValue] = useState(0)
  const [debtPaymentCategoryId, setDebtPaymentCategoryId] = useState(null)

  const [loading, setLoading] = useState(true)
  const [savingAsset, setSavingAsset] = useState(false)
  const [savingLiability, setSavingLiability] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [savingStatement, setSavingStatement] = useState(false)
  const [syncingBillId, setSyncingBillId] = useState(null)
  const [message, setMessage] = useState('')

  const [editingAssetId, setEditingAssetId] = useState(null)
  const [editingLiabilityId, setEditingLiabilityId] = useState(null)
  const [paymentLiability, setPaymentLiability] = useState(null)
  const [statementLiability, setStatementLiability] = useState(null)

  const [assetForm, setAssetForm] = useState(blankAssetForm)
  const [liabilityForm, setLiabilityForm] = useState(blankLiabilityForm)
  const [paymentForm, setPaymentForm] = useState(blankPaymentForm)
  const [statementForm, setStatementForm] = useState(blankStatementForm)

  useEffect(() => {
    loadNetWorthData()
  }, [])

  const summary = calculateNetWorthSummary(assetAccounts, liabilities, investmentMarketValue)

  const selectedPaymentAccount = useMemo(
    () => accounts.find((account) => account.id === paymentForm.account_id) || null,
    [accounts, paymentForm.account_id]
  )

  const currentStatementForPanel = useMemo(() => {
    if (!statementLiability?.id) return null
    return (
      statements.find(
        (row) => row.liability_id === statementLiability.id && row.month_key === statementForm.month_key
      ) || null
    )
  }, [statementLiability, statementForm.month_key, statements])

  const paymentPreview = useMemo(() => {
    const totalPayment = toNumber(paymentForm.total_payment)
    const principalAmount = toNumber(paymentForm.principal_amount)
    const interestFeeAmount = Math.max(0, totalPayment - principalAmount)
    const currentBalance = toNumber(paymentLiability?.current_balance)
    return {
      totalPayment,
      principalAmount,
      interestFeeAmount,
      balanceAfterPayment: Math.max(0, currentBalance - principalAmount)
    }
  }, [paymentForm, paymentLiability])

  const statementPreview = useMemo(() => {
    return {
      paymentsMade: toNumber(statementForm.payments_made),
      principalPaid: toNumber(statementForm.principal_paid),
      estimatedInterest: estimateMonthlyInterest(statementForm.opening_balance, statementLiability?.interest_rate),
      closingBalance: statementClosing(statementForm)
    }
  }, [statementForm, statementLiability])

  async function loadNetWorthData() {
    setLoading(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Unable to get current user')

      const categories = await ensureDefaultCashflowCategories(supabase, user.id)
      const debtCategory = categories.find(
        (category) =>
          String(category.name || '').trim().toLowerCase() === DEBT_PAYMENT_CATEGORY.toLowerCase()
      )

      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (accountError) throw accountError

      const { data: assetAccountData, error: assetAccountError } = await supabase
        .from('asset_accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (assetAccountError) throw assetAccountError

      const { data: liabilityData, error: liabilityError } = await supabase
        .from('liabilities')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (liabilityError) throw liabilityError

      const { data: statementData, error: statementError } = await supabase
        .from('liability_monthly_statements')
        .select('*')
        .eq('user_id', user.id)
        .order('month_key', { ascending: false })
        .order('created_at', { ascending: false })
      if (statementError) throw statementError

      const { data: billData, error: billError } = await supabase
        .from('bills')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (billError) throw billError

      const { data: txData, error: txError } = await supabase
        .from('investment_transactions')
        .select(`
          id,
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

      const { data: pricesData, error: pricesError } = await supabase
        .from('price_quotes')
        .select('id, asset_id, price, created_at')
        .order('created_at', { ascending: false })
      if (pricesError) throw pricesError

      const holdings = calculateHoldings(txData || [], pricesData || [])
      const portfolioSummary = calculatePortfolioSummary(holdings)

      setDebtPaymentCategoryId(debtCategory?.id || null)
      setAccounts(accountData || [])
      setAssetAccounts(assetAccountData || [])
      setLiabilities(liabilityData || [])
      setStatements(statementData || [])
      setBills(billData || [])
      setInvestmentMarketValue(portfolioSummary.totalMarketValue || 0)
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to load net worth data')
    }

    setLoading(false)
  }

  function resetAssetForm() {
    setAssetForm(blankAssetForm)
    setEditingAssetId(null)
  }

  function resetLiabilityForm() {
    setLiabilityForm(blankLiabilityForm)
    setEditingLiabilityId(null)
  }

  function resetPaymentForm() {
    setPaymentLiability(null)
    setPaymentForm({ ...blankPaymentForm, payment_date: todayISO() })
  }

  function resetStatementForm() {
    setStatementLiability(null)
    setStatementForm({ ...blankStatementForm, month_key: currentMonthKey() })
  }

  function statementToForm(row) {
    return {
      month_key: row.month_key || currentMonthKey(),
      opening_balance: row.opening_balance ?? '',
      new_charges: row.new_charges ?? '',
      interest_charged: row.interest_charged ?? '',
      fees: row.fees ?? '',
      payments_made: row.payments_made ?? '0',
      principal_paid: row.principal_paid ?? '0',
      minimum_due: row.minimum_due ?? '',
      due_date: row.due_date || '',
      statement_date: row.statement_date || '',
      status: row.status || 'open',
      note: row.note || ''
    }
  }

  function makeDefaultStatementForm(liability, monthKey = currentMonthKey()) {
    return {
      month_key: monthKey,
      opening_balance: liability.current_balance ?? '',
      new_charges: '',
      interest_charged: estimateMonthlyInterest(liability.current_balance, liability.interest_rate).toFixed(2),
      fees: '',
      payments_made: '0',
      principal_paid: '0',
      minimum_due: liability.minimum_payment ?? '',
      due_date: dueDateForStatementMonth(liability, monthKey),
      statement_date: statementDateForMonth(liability, monthKey),
      status: 'open',
      note: ''
    }
  }

  function handleAssetChange(e) {
    const { name, value } = e.target
    setAssetForm((prev) => ({ ...prev, [name]: value }))
  }

  function handleLiabilityChange(e) {
    const { name, value, type, checked } = e.target
    setLiabilityForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  function handlePaymentChange(e) {
    const { name, value } = e.target
    setPaymentForm((prev) => {
      if (name === 'total_payment') {
        const totalPayment = toNumber(value)
        const currentBalance = toNumber(paymentLiability?.current_balance)
        return {
          ...prev,
          total_payment: value,
          principal_amount: totalPayment > 0 ? String(Math.min(totalPayment, currentBalance)) : ''
        }
      }
      return { ...prev, [name]: value }
    })
  }

  function handleStatementChange(e) {
    const { name, value } = e.target
    setStatementForm((prev) => {
      if (name === 'month_key' && statementLiability) {
        const existing = statements.find(
          (row) => row.liability_id === statementLiability.id && row.month_key === value
        )
        return existing ? statementToForm(existing) : makeDefaultStatementForm(statementLiability, value)
      }
      return { ...prev, [name]: value }
    })
  }

  function applyEstimatedInterestToStatement() {
    if (!statementLiability) return
    setStatementForm((prev) => ({
      ...prev,
      interest_charged: estimateMonthlyInterest(prev.opening_balance, statementLiability.interest_rate).toFixed(2)
    }))
  }

  function refreshStatementDates() {
    if (!statementLiability) return
    setStatementForm((prev) => ({
      ...prev,
      statement_date: statementDateForMonth(statementLiability, prev.month_key),
      due_date: dueDateForStatementMonth(statementLiability, prev.month_key)
    }))
  }

  async function handleSaveAsset(e) {
    e.preventDefault()
    setSavingAsset(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Unable to get current user')

      const name = assetForm.name.trim()
      const currentValue = Number(assetForm.current_value)
      if (!name) throw new Error('Asset name is required')
      if (!Number.isFinite(currentValue) || currentValue < 0) {
        throw new Error('Current value must be a valid positive number')
      }

      const payload = {
        name,
        asset_class: assetForm.asset_class,
        current_value: currentValue,
        notes: assetForm.notes.trim() || null
      }

      if (editingAssetId) {
        const { error } = await supabase
          .from('asset_accounts')
          .update(payload)
          .eq('id', editingAssetId)
          .eq('user_id', user.id)
        if (error) throw error
        setMessage('Asset updated successfully')
      } else {
        const { error } = await supabase.from('asset_accounts').insert({ user_id: user.id, ...payload })
        if (error) throw error
        setMessage('Asset added successfully')
      }

      resetAssetForm()
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to save asset')
    }

    setSavingAsset(false)
  }

  async function handleSaveLiability(e) {
    e.preventDefault()
    setSavingLiability(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Unable to get current user')

      const name = liabilityForm.name.trim()
      const currentBalance = Number(liabilityForm.current_balance)
      if (!name) throw new Error('Liability name is required')
      if (!Number.isFinite(currentBalance) || currentBalance < 0) {
        throw new Error('Current balance must be a valid positive number')
      }

      const interestRate = liabilityForm.interest_rate === '' ? null : Number(liabilityForm.interest_rate)
      const minimumPayment = liabilityForm.minimum_payment === '' ? null : Number(liabilityForm.minimum_payment)
      const dueDay = liabilityForm.due_day === '' ? null : Number(liabilityForm.due_day)
      const statementDay = liabilityForm.statement_day === '' ? null : Number(liabilityForm.statement_day)

      if (interestRate != null && !Number.isFinite(interestRate)) throw new Error('Interest rate must be valid')
      if (minimumPayment != null && !Number.isFinite(minimumPayment)) throw new Error('Minimum payment must be valid')
      if (dueDay != null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
        throw new Error('Due day must be between 1 and 31')
      }
      if (statementDay != null && (!Number.isInteger(statementDay) || statementDay < 1 || statementDay > 31)) {
        throw new Error('Statement day must be between 1 and 31')
      }

      const payload = {
        name,
        liability_type: liabilityForm.liability_type,
        current_balance: currentBalance,
        interest_rate: interestRate,
        minimum_payment: minimumPayment,
        due_day: dueDay,
        statement_day: statementDay,
        default_payment_account_id: liabilityForm.default_payment_account_id || null,
        autopay_enabled: Boolean(liabilityForm.autopay_enabled),
        notes: liabilityForm.notes.trim() || null
      }

      if (editingLiabilityId) {
        const { error } = await supabase
          .from('liabilities')
          .update(payload)
          .eq('id', editingLiabilityId)
          .eq('user_id', user.id)
        if (error) throw error
        setMessage('Liability updated successfully')
      } else {
        const { error } = await supabase.from('liabilities').insert({ user_id: user.id, ...payload })
        if (error) throw error
        setMessage('Liability added successfully')
      }

      resetLiabilityForm()
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to save liability')
    }

    setSavingLiability(false)
  }

  function handleEditAsset(item) {
    setEditingAssetId(item.id)
    setAssetForm({
      name: item.name || '',
      asset_class: item.asset_class || 'cash',
      current_value: item.current_value ?? '',
      notes: item.notes || ''
    })
    setMessage('')
  }

  async function handleDeleteAsset(id) {
    if (!window.confirm('Are you sure you want to delete this asset?')) return
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Unable to get current user')

      const { error } = await supabase.from('asset_accounts').delete().eq('id', id).eq('user_id', user.id)
      if (error) throw error
      if (editingAssetId === id) resetAssetForm()
      setMessage('Asset deleted successfully')
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to delete asset')
    }
  }

  function handleEditLiability(item) {
    setEditingLiabilityId(item.id)
    setLiabilityForm({
      name: item.name || '',
      liability_type: item.liability_type || 'credit_card',
      current_balance: item.current_balance ?? '',
      interest_rate: item.interest_rate ?? '',
      minimum_payment: item.minimum_payment ?? '',
      due_day: item.due_day ?? '',
      statement_day: item.statement_day ?? '',
      default_payment_account_id: item.default_payment_account_id || '',
      autopay_enabled: Boolean(item.autopay_enabled),
      notes: item.notes || ''
    })
    setMessage('')
  }

  async function handleDeleteLiability(id) {
    if (!window.confirm('Are you sure you want to delete this liability?')) return
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Unable to get current user')

      const { error } = await supabase.from('liabilities').delete().eq('id', id).eq('user_id', user.id)
      if (error) throw error
      if (editingLiabilityId === id) resetLiabilityForm()
      if (paymentLiability?.id === id) resetPaymentForm()
      if (statementLiability?.id === id) resetStatementForm()
      setMessage('Liability deleted successfully')
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to delete liability')
    }
  }

  function startDebtPayment(liability) {
    const suggestedPayment = Number(liability.minimum_payment || 0) > 0 ? liability.minimum_payment : ''
    const suggestedPrincipal = suggestedPayment
      ? Math.min(toNumber(suggestedPayment), toNumber(liability.current_balance))
      : ''

    setPaymentLiability(liability)
    setPaymentForm({
      account_id: liability.default_payment_account_id || accounts[0]?.id || '',
      payment_date: todayISO(),
      total_payment: suggestedPayment === '' ? '' : String(suggestedPayment),
      principal_amount: suggestedPrincipal === '' ? '' : String(suggestedPrincipal),
      note: ''
    })
    setMessage('')
  }

  function startStatement(liability) {
    const monthKey = currentMonthKey()
    const existing = statements.find((row) => row.liability_id === liability.id && row.month_key === monthKey)
    setStatementLiability(liability)
    setStatementForm(existing ? statementToForm(existing) : makeDefaultStatementForm(liability, monthKey))
    setMessage('')
  }

  function buildStatementPayload(userId, liability, form) {
    const payload = {
      user_id: userId,
      liability_id: liability.id,
      month_key: form.month_key,
      opening_balance: toNumber(form.opening_balance),
      new_charges: toNumber(form.new_charges),
      interest_charged: toNumber(form.interest_charged),
      fees: toNumber(form.fees),
      payments_made: toNumber(form.payments_made),
      principal_paid: toNumber(form.principal_paid),
      minimum_due: form.minimum_due === '' ? null : toNumber(form.minimum_due),
      due_date: form.due_date || null,
      statement_date: form.statement_date || null,
      status: form.status || 'open',
      note: form.note?.trim() || null
    }
    payload.closing_balance = statementClosing(payload)
    return payload
  }

  async function handleSaveStatement(e) {
    e.preventDefault()
    setSavingStatement(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Unable to get current user')
      if (!statementLiability?.id) throw new Error('Choose a liability first')
      if (!statementForm.month_key) throw new Error('Statement month is required')

      const existing = currentStatementForPanel
      const payload = buildStatementPayload(user.id, statementLiability, statementForm)
      if (!Number.isFinite(payload.opening_balance) || payload.opening_balance < 0) {
        throw new Error('Opening balance must be valid')
      }
      if (payload.new_charges < 0 || payload.interest_charged < 0 || payload.fees < 0) {
        throw new Error('New charges, interest, and fees cannot be negative')
      }
      if (payload.principal_paid < 0 || payload.payments_made < 0) {
        throw new Error('Payments made and principal paid cannot be negative')
      }

      if (existing?.id) {
        const { error } = await supabase
          .from('liability_monthly_statements')
          .update(payload)
          .eq('id', existing.id)
          .eq('user_id', user.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('liability_monthly_statements').insert(payload)
        if (error) throw error
      }

      const { error: liabilityError } = await supabase
        .from('liabilities')
        .update({ current_balance: payload.closing_balance })
        .eq('id', statementLiability.id)
        .eq('user_id', user.id)
      if (liabilityError) throw liabilityError

      setMessage(`Statement update applied. ${statementLiability.name} balance is now ${money(payload.closing_balance)}. No Cashflow entry was created.`)
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to save statement')
    }

    setSavingStatement(false)
  }

  async function handleCloseStatement() {
    if (!currentStatementForPanel?.id || !statementLiability?.id) return
    if (!window.confirm('Close this statement month?')) return

    setSavingStatement(true)
    setMessage('')
    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Unable to get current user')

      const { error } = await supabase
        .from('liability_monthly_statements')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', currentStatementForPanel.id)
        .eq('user_id', user.id)
      if (error) throw error

      setMessage(`Statement closed for ${statementLiability.name}.`)
      setStatementForm((prev) => ({ ...prev, status: 'closed' }))
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to close statement')
    }
    setSavingStatement(false)
  }

  async function upsertPaymentStatement({ userId, liability, paymentDate, totalPayment, principalAmount, note }) {
    const monthKey = statementMonthKeyForPaymentDate(liability, paymentDate)
    const existing = statements.find((row) => row.liability_id === liability.id && row.month_key === monthKey)
    const base = existing || {
      opening_balance: toNumber(liability.current_balance),
      new_charges: 0,
      interest_charged: 0,
      fees: 0,
      payments_made: 0,
      principal_paid: 0,
      minimum_due: liability.minimum_payment ?? totalPayment,
      due_date: dueDateForStatementMonth(liability, monthKey),
      statement_date: statementDateForMonth(liability, monthKey),
      status: 'open',
      note: null
    }

    const nextPayments = toNumber(base.payments_made) + totalPayment
    const nextPrincipal = toNumber(base.principal_paid) + principalAmount
    const minimumDue = base.minimum_due == null ? null : toNumber(base.minimum_due)
    const payload = {
      user_id: userId,
      liability_id: liability.id,
      month_key: monthKey,
      opening_balance: toNumber(base.opening_balance),
      new_charges: toNumber(base.new_charges),
      interest_charged: toNumber(base.interest_charged),
      fees: toNumber(base.fees),
      payments_made: nextPayments,
      principal_paid: nextPrincipal,
      minimum_due: minimumDue,
      due_date: base.due_date || null,
      statement_date: base.statement_date || null,
      status: minimumDue != null && nextPayments >= minimumDue ? 'paid' : 'partial',
      note: [base.note, note ? `Payment note: ${note}` : ''].filter(Boolean).join(' | ') || null
    }
    payload.closing_balance = statementClosing(payload)

    if (existing?.id) {
      const { error } = await supabase
        .from('liability_monthly_statements')
        .update(payload)
        .eq('id', existing.id)
        .eq('user_id', userId)
      if (error) throw error
    } else {
      const { error } = await supabase.from('liability_monthly_statements').insert(payload)
      if (error) throw error
    }

    return payload.closing_balance
  }

  async function handleSyncDebtBill(liability) {
    if (!liability?.id) return
    setSyncingBillId(liability.id)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Unable to get current user')

      const dueDay = Number(liability.due_day)
      const amount = Number(liability.minimum_payment)
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
        throw new Error('Set a valid Due Day before syncing this liability to Bills')
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Set a valid Minimum Payment before syncing this liability to Bills')
      }

      const billName = makeDebtBillName(liability)
      const existingBill = bills.find((item) => billLinkedToLiability(item, liability)) || null
      const payload = {
        user_id: user.id,
        name: billName,
        category_id: debtPaymentCategoryId,
        category: DEBT_PAYMENT_CATEGORY,
        amount,
        due_day: dueDay,
        frequency: 'monthly',
        status: 'active',
        note: makeDebtBillNote(liability)
      }

      if (existingBill?.id) {
        const { error } = await supabase
          .from('bills')
          .update(payload)
          .eq('id', existingBill.id)
          .eq('user_id', user.id)
        if (error) throw error
        setMessage(`Bill updated for ${liability.name}: ${billName} · ${money(amount)} due on day ${dueDay}.`)
      } else {
        const { error } = await supabase.from('bills').insert(payload)
        if (error) throw error
        setMessage(`Bill created for ${liability.name}: ${billName} · ${money(amount)} due on day ${dueDay}.`)
      }

      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to sync liability to Bills')
    }

    setSyncingBillId(null)
  }

  async function handleRecordDebtPayment(e) {
    e.preventDefault()
    setSavingPayment(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Unable to get current user')
      if (!paymentLiability?.id) throw new Error('Choose a liability first')
      if (!paymentForm.account_id) throw new Error('Choose the account used to pay this debt')
      if (!paymentForm.payment_date) throw new Error('Payment date is required')

      const totalPayment = Number(paymentForm.total_payment)
      const principalAmount = Number(paymentForm.principal_amount)
      const currentBalance = toNumber(paymentLiability.current_balance)
      if (!Number.isFinite(totalPayment) || totalPayment <= 0) throw new Error('Total payment must be greater than zero')
      if (!Number.isFinite(principalAmount) || principalAmount < 0) throw new Error('Principal amount must be zero or greater')
      if (principalAmount > totalPayment + 0.000001) throw new Error('Principal amount cannot be greater than total payment')
      if (principalAmount > currentBalance + 0.000001) {
        throw new Error('Principal amount cannot be greater than the current liability balance')
      }

      const interestFeeAmount = Math.max(0, totalPayment - principalAmount)
      const description = makeDebtPaymentDescription({
        liabilityName: paymentLiability.name,
        principalAmount,
        interestFeeAmount,
        note: paymentForm.note
      })

      const { data: cashflowEntry, error: cashflowError } = await supabase
        .from('cashflow_entries')
        .insert({
          user_id: user.id,
          account_id: paymentForm.account_id,
          entry_date: paymentForm.payment_date,
          type: 'expense',
          amount: totalPayment,
          category_id: debtPaymentCategoryId,
          category: DEBT_PAYMENT_CATEGORY,
          description
        })
        .select('id')
        .single()
      if (cashflowError) throw cashflowError

      const syncedBalance = await upsertPaymentStatement({
        userId: user.id,
        liability: paymentLiability,
        paymentDate: paymentForm.payment_date,
        totalPayment,
        principalAmount,
        note: paymentForm.note
      })

      const { error: liabilityError } = await supabase
        .from('liabilities')
        .update({ current_balance: syncedBalance })
        .eq('id', paymentLiability.id)
        .eq('user_id', user.id)
      if (liabilityError) throw liabilityError

      const linkedBill = getLinkedBillForLiability(paymentLiability, bills)
      if (linkedBill?.id) {
        const nextBillNote = appendDebtBillPaymentNote(
          linkedBill.note,
          paymentForm.payment_date,
          cashflowEntry?.id
        )

        const { error: billPaymentNoteError } = await supabase
          .from('bills')
          .update({ note: nextBillNote })
          .eq('id', linkedBill.id)
          .eq('user_id', user.id)

        if (billPaymentNoteError) throw billPaymentNoteError
      }

      const accountName = selectedPaymentAccount?.name || 'selected account'
      setMessage(
        `Payment recorded. ${accountName} cash outflow: ${money(totalPayment)}. ${paymentLiability.name} balance: ${money(syncedBalance)}.`
      )
      resetPaymentForm()
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to record debt payment')
    }

    setSavingPayment(false)
  }

  return (
    <div>
      <div style={headerRowStyle}>
        <div>
          <h1 style={{ marginBottom: '8px' }}>Net Worth</h1>
          <p style={{ marginTop: 0, color: '#d1d5db' }}>
            Track assets, liabilities, net worth, debt payments, and statement cycles.
          </p>
        </div>
        <button onClick={loadNetWorthData} style={refreshButtonStyle}>Refresh Net Worth</button>
      </div>

      <div style={summaryGridStyle}>
        <SummaryCard label="Investment Assets" value={money(summary.investmentAssetsTotal)} />
        <SummaryCard label="External Assets" value={money(summary.externalAssetsTotal)} />
        <SummaryCard label="Total Assets" value={money(summary.totalAssets)} />
        <SummaryCard label="Liabilities" value={money(summary.liabilitiesTotal)} color="#ef4444" />
        <SummaryCard label="Net Worth" value={money(summary.netWorth)} color={summary.netWorth >= 0 ? '#22c55e' : '#ef4444'} />
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={infoPanelStyle}>
        <strong>Bài 55D Debt Bill Sync:</strong> sync each liability to Bills as a monthly payment reminder. Statement updates adjust debt balance; Record Payment creates cash outflow; Bill Sync creates or updates the monthly bill template.
      </div>

      {paymentLiability && (
        <DebtPaymentForm
          paymentLiability={paymentLiability}
          paymentForm={paymentForm}
          paymentPreview={paymentPreview}
          accounts={accounts}
          savingPayment={savingPayment}
          onChange={handlePaymentChange}
          onCancel={resetPaymentForm}
          onSubmit={handleRecordDebtPayment}
        />
      )}

      {statementLiability && (
        <StatementForm
          statementLiability={statementLiability}
          statementForm={statementForm}
          statementPreview={statementPreview}
          currentStatement={currentStatementForPanel}
          savingStatement={savingStatement}
          onChange={handleStatementChange}
          onCancel={resetStatementForm}
          onSubmit={handleSaveStatement}
          onClose={handleCloseStatement}
          onUseEstimatedInterest={applyEstimatedInterestToStatement}
          onRefreshDates={refreshStatementDates}
        />
      )}

      <div style={{ display: 'grid', gap: '24px', marginTop: '24px' }}>
        <ListCard
          title={`Liabilities${liabilities.length ? ` · ${liabilities.length} active` : ''}`}
          loading={loading}
          empty="No liabilities yet."
          bodyStyle={liabilityScrollAreaStyle}
        >
            {liabilities.map((item) => {
              const activeStatement = statements.find(
                (row) => row.liability_id === item.id && row.month_key === currentMonthKey()
              )
              const status = statementStatus(activeStatement, item)
              const billStatus = liabilityBillStatus(item, bills)
              return (
                <div key={item.id} style={listItemStyle}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{item.name}</strong>
                    <div style={mutedText}>Type: {item.liability_type}</div>
                    <div style={mutedText}>Balance: {money(item.current_balance)}</div>
                    {item.interest_rate != null && <div style={mutedText}>Interest: {item.interest_rate}%</div>}
                    {item.minimum_payment != null && <div style={mutedText}>Minimum Payment: {money(item.minimum_payment)}</div>}
                    <div style={mutedText}>
                      Due: {item.due_day ? `Day ${item.due_day}` : 'Not set'} · Statement: {item.statement_day ? `Day ${item.statement_day}` : 'Not set'} · Autopay: {item.autopay_enabled ? 'On' : 'Off'}
                    </div>
                    <div style={{ ...mutedText, color: status.tone === 'bad' ? '#f87171' : status.tone === 'good' ? '#4ade80' : status.tone === 'warn' ? '#fbbf24' : '#d1d5db' }}>
                      This month: {status.label}
                    </div>
                    {activeStatement && (
                      <div style={mutedText}>
                        Statement closing: {money(activeStatement.closing_balance)} · Paid: {money(activeStatement.payments_made)}
                      </div>
                    )}
                    <div style={{ ...mutedText, color: billStatus.tone === 'good' ? '#4ade80' : '#fbbf24' }}>
                      Bills: {billStatus.label}{billStatus.bill ? ` · ${money(billStatus.bill.amount)} due day ${billStatus.bill.due_day}` : ''}
                    </div>
                    {item.notes && <div style={mutedText}>Notes: {item.notes}</div>}
                  </div>

                  <div style={liabilityActionRowStyle}>
                    <button type="button" onClick={() => startDebtPayment(item)} style={paymentButtonStyle}>Record Payment</button>
                    <button type="button" onClick={() => startStatement(item)} style={statementButtonStyle}>Statement</button>
                    <button type="button" onClick={() => handleSyncDebtBill(item)} disabled={syncingBillId === item.id} style={billSyncButtonStyle}>{syncingBillId === item.id ? 'Syncing...' : 'Sync Bill'}</button>
                    <button type="button" onClick={() => handleEditLiability(item)} style={editButtonStyle}>Edit</button>
                    <button type="button" onClick={() => handleDeleteLiability(item.id)} style={deleteButtonStyle}>Delete</button>
                  </div>
                </div>
              )
            })}
        </ListCard>

        <div style={twoColumnGridStyle}>
          <ExternalAssetForm
            form={assetForm}
            editing={Boolean(editingAssetId)}
            saving={savingAsset}
            onChange={handleAssetChange}
            onCancel={resetAssetForm}
            onSubmit={handleSaveAsset}
          />

          <LiabilityForm
            form={liabilityForm}
            accounts={accounts}
            editing={Boolean(editingLiabilityId)}
            saving={savingLiability}
            onChange={handleLiabilityChange}
            onCancel={resetLiabilityForm}
            onSubmit={handleSaveLiability}
          />
        </div>

        <ListCard title="External Assets" loading={loading} empty="No external assets yet.">
          {assetAccounts.map((item) => (
            <div key={item.id} style={listItemStyle}>
              <div>
                <strong>{item.name}</strong>
                <div style={mutedText}>Class: {item.asset_class}</div>
                <div style={mutedText}>Value: {money(item.current_value)}</div>
                {item.notes && <div style={mutedText}>Notes: {item.notes}</div>}
              </div>
              <div style={actionRowStyle}>
                <button type="button" onClick={() => handleEditAsset(item)} style={editButtonStyle}>Edit</button>
                <button type="button" onClick={() => handleDeleteAsset(item.id)} style={deleteButtonStyle}>Delete</button>
              </div>
            </div>
          ))}
        </ListCard>
      </div>

    </div>
  )
}

function SummaryCard({ label, value, color = 'white' }) {
  return (
    <div style={summaryCardStyle}>
      <div style={summaryLabelStyle}>{label}</div>
      <div style={{ ...summaryValueStyle, color }}>{value}</div>
    </div>
  )
}

function ListCard({ title, loading, empty, children, bodyStyle }) {
  return (
    <div style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {loading ? <p>Loading...</p> : !children || children.length === 0 ? <p>{empty}</p> : <div style={{ display: 'grid', gap: '12px', ...bodyStyle }}>{children}</div>}
    </div>
  )
}

function DebtPaymentForm({ paymentLiability, paymentForm, paymentPreview, accounts, savingPayment, onChange, onCancel, onSubmit }) {
  return (
    <div style={paymentCardStyle}>
      <div style={formHeaderStyle}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: '6px' }}>Record Debt Payment</h2>
          <div style={mutedText}>Liability: <strong>{paymentLiability.name}</strong> · Current balance: {money(paymentLiability.current_balance)}</div>
        </div>
        <button type="button" onClick={onCancel} style={secondaryButtonStyle}>Cancel</button>
      </div>

      <form onSubmit={onSubmit}>
        <div style={paymentGridStyle}>
          <Field label="Pay From Account">
            <select name="account_id" value={paymentForm.account_id} onChange={onChange} style={inputStyle}>
              <option value="">Select account</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{displayAccountName(account)}</option>)}
            </select>
          </Field>
          <Field label="Payment Date"><input type="date" name="payment_date" value={paymentForm.payment_date} onChange={onChange} style={inputStyle} /></Field>
          <Field label="Total Cash Paid"><input type="number" step="0.01" min="0" name="total_payment" value={paymentForm.total_payment} onChange={onChange} placeholder="Example: 200" style={inputStyle} /></Field>
          <Field label="Debt Reduction Amount"><input type="number" step="0.01" min="0" name="principal_amount" value={paymentForm.principal_amount} onChange={onChange} placeholder="Principal amount" style={inputStyle} /></Field>
        </div>

        <div style={paymentPreviewStyle}>
          <PreviewMetric label="Cash Outflow" value={money(paymentPreview.totalPayment)} />
          <PreviewMetric label="Debt Balance Reduction" value={money(paymentPreview.principalAmount)} />
          <PreviewMetric label="Interest / Fee Portion" value={money(paymentPreview.interestFeeAmount)} />
          <PreviewMetric label="Balance after payment" value={money(paymentPreview.balanceAfterPayment)} />
        </div>

        <Field label="Note"><textarea name="note" value={paymentForm.note} onChange={onChange} placeholder="Optional note, confirmation number, or statement period" style={textareaStyle} /></Field>
        <button type="submit" disabled={savingPayment} style={buttonStyle}>{savingPayment ? 'Recording Payment...' : 'Record Payment + Sync Statement'}</button>
      </form>
    </div>
  )
}

function StatementForm({ statementLiability, statementForm, statementPreview, currentStatement, savingStatement, onChange, onCancel, onSubmit, onClose, onUseEstimatedInterest, onRefreshDates }) {
  return (
    <div style={statementCardStyle}>
      <div style={formHeaderStyle}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: '6px' }}>Monthly Liability Statement</h2>
          <div style={mutedText}>Liability: <strong>{statementLiability.name}</strong> · Current balance: {money(statementLiability.current_balance)}</div>
        </div>
        <button type="button" onClick={onCancel} style={secondaryButtonStyle}>Cancel</button>
      </div>

      <div style={statementHelperStyle}>
        <div>
          <strong>Monthly Statement Update Helper</strong>
          <p style={{ ...mutedText, marginBottom: 0 }}>
            Use this when the credit card or loan statement posts. Enter real new charges, interest, and fees from the statement.
            This updates the liability balance only; it does not create Cashflow because no cash leaves your account here.
          </p>
        </div>
        <div style={statementFormulaStyle}>
          Closing = Opening + New Charges + Interest + Fees - Principal Paid
        </div>
      </div>

      <form onSubmit={onSubmit}>
        <div style={statementGridStyle}>
          <Field label="Statement Month"><input type="month" name="month_key" value={statementForm.month_key} onChange={onChange} style={inputStyle} /></Field>
          <Field label="Opening Balance"><input type="number" step="0.01" min="0" name="opening_balance" value={statementForm.opening_balance} onChange={onChange} style={inputStyle} /></Field>
          <Field label="New Charges"><input type="number" step="0.01" min="0" name="new_charges" value={statementForm.new_charges} onChange={onChange} placeholder="Purchases / advances" style={inputStyle} /></Field>
          <Field label="Interest Charged"><input type="number" step="0.01" min="0" name="interest_charged" value={statementForm.interest_charged} onChange={onChange} placeholder={`Estimated ${money(statementPreview.estimatedInterest)}`} style={inputStyle} /></Field>
          <Field label="Fees"><input type="number" step="0.01" min="0" name="fees" value={statementForm.fees} onChange={onChange} placeholder="Late / annual / other fees" style={inputStyle} /></Field>
          <Field label="Minimum Due"><input type="number" step="0.01" min="0" name="minimum_due" value={statementForm.minimum_due} onChange={onChange} style={inputStyle} /></Field>
          <Field label="Due Date"><input type="date" name="due_date" value={statementForm.due_date} onChange={onChange} style={inputStyle} /></Field>
          <Field label="Statement Date"><input type="date" name="statement_date" value={statementForm.statement_date} onChange={onChange} style={inputStyle} /></Field>
          <Field label="Status">
            <select name="status" value={statementForm.status} onChange={onChange} style={inputStyle}>
              <option value="open">Open</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="closed">Closed</option>
              <option value="needs_review">Needs Review</option>
            </select>
          </Field>
        </div>

        <div style={statementQuickActionsStyle}>
          <button type="button" onClick={onUseEstimatedInterest} style={secondaryButtonStyle}>Use Estimated Interest</button>
          <button type="button" onClick={onRefreshDates} style={secondaryButtonStyle}>Recalculate Dates</button>
          <span style={mutedText}>{statementUpdateNote(statementForm)}</span>
        </div>

        <div style={paymentPreviewStyle}>
          <PreviewMetric label="Payments Made" value={money(statementPreview.paymentsMade)} />
          <PreviewMetric label="Principal Paid" value={money(statementPreview.principalPaid)} />
          <PreviewMetric label="Statement Additions" value={money(statementActivityTotal(statementForm))} />
          <PreviewMetric label="Estimated Interest" value={money(statementPreview.estimatedInterest)} />
          <PreviewMetric label="Projected Closing" value={money(statementPreview.closingBalance)} />
        </div>

        <Field label="Statement Note"><textarea name="note" value={statementForm.note} onChange={onChange} placeholder="Optional statement note or reconciliation note" style={textareaStyle} /></Field>

        <div style={actionRowStyle}>
          <button type="submit" disabled={savingStatement} style={primarySmallButtonStyle}>{savingStatement ? 'Applying Statement Update...' : 'Apply Statement Update + Update Balance'}</button>
          {currentStatement?.id && <button type="button" disabled={savingStatement} onClick={onClose} style={secondaryButtonStyle}>Close Statement</button>}
        </div>
      </form>
    </div>
  )
}

function ExternalAssetForm({ form, editing, saving, onChange, onCancel, onSubmit }) {
  return (
    <div style={cardStyle}>
      <div style={formHeaderStyle}>
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>{editing ? 'Edit Asset' : 'Add External Asset'}</h2>
        {editing && <button type="button" onClick={onCancel} style={secondaryButtonStyle}>Cancel Edit</button>}
      </div>
      <form onSubmit={onSubmit}>
        <Field label="Name"><input type="text" name="name" value={form.name} onChange={onChange} placeholder="Example: Car, House, Savings" style={inputStyle} /></Field>
        <Field label="Asset Class">
          <select name="asset_class" value={form.asset_class} onChange={onChange} style={inputStyle}>
            <option value="cash">Cash</option><option value="real_estate">Real Estate</option><option value="vehicle">Vehicle</option><option value="business">Business</option><option value="personal_property">Personal Property</option><option value="other">Other</option>
          </select>
        </Field>
        <Field label="Current Value"><input type="number" step="0.01" name="current_value" value={form.current_value} onChange={onChange} placeholder="Example: 12000" style={inputStyle} /></Field>
        <Field label="Notes"><textarea name="notes" value={form.notes} onChange={onChange} placeholder="Optional notes" style={textareaStyle} /></Field>
        <button type="submit" disabled={saving} style={buttonStyle}>{saving ? 'Saving...' : editing ? 'Update Asset' : 'Add Asset'}</button>
      </form>
    </div>
  )
}

function LiabilityForm({ form, accounts, editing, saving, onChange, onCancel, onSubmit }) {
  return (
    <div style={cardStyle}>
      <div style={formHeaderStyle}>
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>{editing ? 'Edit Liability' : 'Add Liability'}</h2>
        {editing && <button type="button" onClick={onCancel} style={secondaryButtonStyle}>Cancel Edit</button>}
      </div>
      <form onSubmit={onSubmit}>
        <Field label="Name"><input type="text" name="name" value={form.name} onChange={onChange} placeholder="Example: Credit Card, Mortgage" style={inputStyle} /></Field>
        <Field label="Liability Type">
          <select name="liability_type" value={form.liability_type} onChange={onChange} style={inputStyle}>
            <option value="credit_card">Credit Card</option><option value="mortgage">Mortgage</option><option value="auto_loan">Auto Loan</option><option value="personal_loan">Personal Loan</option><option value="student_loan">Student Loan</option><option value="other">Other</option>
          </select>
        </Field>
        <Field label="Current Balance"><input type="number" step="0.01" name="current_balance" value={form.current_balance} onChange={onChange} placeholder="Example: 8500" style={inputStyle} /></Field>
        <div style={statementGridStyle}>
          <Field label="Interest Rate (%)"><input type="number" step="0.01" name="interest_rate" value={form.interest_rate} onChange={onChange} placeholder="Optional" style={inputStyle} /></Field>
          <Field label="Minimum Payment"><input type="number" step="0.01" name="minimum_payment" value={form.minimum_payment} onChange={onChange} placeholder="Optional" style={inputStyle} /></Field>
          <Field label="Due Day"><input type="number" min="1" max="31" name="due_day" value={form.due_day} onChange={onChange} placeholder="18" style={inputStyle} /></Field>
          <Field label="Statement Day"><input type="number" min="1" max="31" name="statement_day" value={form.statement_day} onChange={onChange} placeholder="23" style={inputStyle} /></Field>
        </div>
        <Field label="Default Payment Account">
          <select name="default_payment_account_id" value={form.default_payment_account_id} onChange={onChange} style={inputStyle}>
            <option value="">No default account</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{displayAccountName(account)}</option>)}
          </select>
        </Field>
        <label style={checkboxRowStyle}><input type="checkbox" name="autopay_enabled" checked={form.autopay_enabled} onChange={onChange} /> Autopay enabled</label>
        <Field label="Notes"><textarea name="notes" value={form.notes} onChange={onChange} placeholder="Optional notes" style={textareaStyle} /></Field>
        <button type="submit" disabled={saving} style={buttonStyle}>{saving ? 'Saving...' : editing ? 'Update Liability' : 'Add Liability'}</button>
      </form>
    </div>
  )
}

function Field({ label, children }) {
  return <div style={fieldStyle}><label style={labelStyle}>{label}</label>{children}</div>
}

function PreviewMetric({ label, value }) {
  return <div><span style={summaryLabelStyle}>{label}</span><strong>{value}</strong></div>
}

const headerRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }
const refreshButtonStyle = { padding: '10px 14px', border: 'none', borderRadius: '10px', background: '#2563eb', color: 'white', cursor: 'pointer' }
const summaryGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }
const summaryCardStyle = { background: '#1f2937', padding: '20px', borderRadius: '12px', border: '1px solid #334155' }
const summaryLabelStyle = { display: 'block', color: '#d1d5db', fontSize: '14px', marginBottom: '8px' }
const summaryValueStyle = { fontSize: '24px', fontWeight: 700, color: 'white' }
const messageStyle = { marginTop: '16px', padding: '12px', borderRadius: '10px', background: '#1f2937', border: '1px solid #374151', color: '#f3f4f6' }
const infoPanelStyle = { marginTop: '16px', padding: '14px 16px', borderRadius: '12px', background: 'rgba(37, 99, 235, 0.12)', border: '1px solid rgba(96, 165, 250, 0.35)', color: '#dbeafe', lineHeight: 1.5 }
const twoColumnGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }
const cardStyle = { background: '#1f2937', padding: '20px', borderRadius: '12px', border: '1px solid #334155', minWidth: 0 }
const liabilityScrollAreaStyle = { maxHeight: '520px', overflowY: 'auto', paddingRight: '6px' }
const paymentCardStyle = { ...cardStyle, marginTop: '24px', background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98))' }
const statementCardStyle = { ...cardStyle, marginTop: '24px', background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.98), rgba(30, 41, 59, 0.98))', borderColor: 'rgba(20, 184, 166, 0.35)' }
const formHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }
const paymentGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }
const statementGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }
const paymentPreviewStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px', padding: '14px', borderRadius: '12px', border: '1px solid #334155', background: '#111827' }
const statementHelperStyle = { display: 'grid', gap: '12px', padding: '14px', borderRadius: '12px', border: '1px solid rgba(20, 184, 166, 0.35)', background: 'rgba(15, 118, 110, 0.12)', marginBottom: '16px' }
const statementFormulaStyle = { padding: '10px 12px', borderRadius: '10px', background: '#111827', border: '1px solid #334155', color: '#ccfbf1', fontWeight: 700 }
const statementQuickActionsStyle = { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }
const fieldStyle = { marginBottom: '16px' }
const labelStyle = { display: 'block', marginBottom: '8px' }
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #4b5563', background: '#111827', color: 'white' }
const textareaStyle = { width: '100%', minHeight: '90px', padding: '10px 12px', borderRadius: '8px', border: '1px solid #4b5563', background: '#111827', color: 'white', resize: 'vertical' }
const buttonStyle = { width: '100%', padding: '12px', border: 'none', borderRadius: '8px', background: '#2563eb', color: 'white', cursor: 'pointer' }
const secondaryButtonStyle = { padding: '10px 12px', border: 'none', borderRadius: '8px', background: '#4b5563', color: 'white', cursor: 'pointer' }
const primarySmallButtonStyle = { padding: '10px 12px', border: 'none', borderRadius: '8px', background: '#2563eb', color: 'white', cursor: 'pointer' }
const listItemStyle = { display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '16px', borderRadius: '10px', background: '#111827', border: '1px solid #374151', flexWrap: 'wrap' }
const mutedText = { marginTop: '6px', color: '#d1d5db', fontSize: '14px' }
const actionRowStyle = { display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }
const liabilityActionRowStyle = { ...actionRowStyle, justifyContent: 'flex-end' }
const checkboxRowStyle = { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', color: '#e5e7eb' }
const editButtonStyle = { padding: '8px 10px', border: 'none', borderRadius: '8px', background: '#2563eb', color: 'white', cursor: 'pointer' }
const paymentButtonStyle = { padding: '8px 10px', border: 'none', borderRadius: '8px', background: '#16a34a', color: 'white', cursor: 'pointer' }
const statementButtonStyle = { padding: '8px 10px', border: 'none', borderRadius: '8px', background: '#0f766e', color: 'white', cursor: 'pointer' }
const billSyncButtonStyle = { padding: '8px 10px', border: 'none', borderRadius: '8px', background: '#7c3aed', color: 'white', cursor: 'pointer' }
const deleteButtonStyle = { padding: '8px 10px', border: 'none', borderRadius: '8px', background: '#dc2626', color: 'white', cursor: 'pointer' }
