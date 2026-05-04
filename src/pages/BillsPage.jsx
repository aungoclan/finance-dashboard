import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_APP_SETTINGS, loadUserSettings } from '../lib/appSettings'
import {
  buildCategoryPayload,
  ensureDefaultCashflowCategories,
  findCategoryById,
  getCategoryOptionsByType
} from '../lib/cashflowCategories'

const BILL_STATUS = {
  READY: 'ready',
  ADDED: 'added',
  REVIEW: 'review',
  BLOCKED: 'blocked',
  INACTIVE: 'inactive'
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatMonthKey(year, month) {
  return `${year}-${pad2(month)}`
}

function getCurrentMonthKey() {
  const now = new Date()
  return formatMonthKey(now.getFullYear(), now.getMonth() + 1)
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

function getMonthDateRange(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const next = new Date(year, month, 1)

  return {
    year,
    month,
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

function toMoneyNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
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


function addMonthsToMonthKey(monthKey, offset) {
  const { year, month } = parseMonthKey(monthKey)
  const date = new Date(year, month - 1 + offset, 1)
  return formatMonthKey(date.getFullYear(), date.getMonth() + 1)
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

function getLiabilityDatesForDueMonth(liability, dueMonthKey) {
  const entryDate = getSafeDueDate(dueMonthKey, liability?.due_day)

  if (!liability?.statement_day) {
    return {
      statementDate: '',
      entryDate
    }
  }

  const dueDay = Number(liability?.due_day || 1)
  const statementDay = Number(liability?.statement_day || 1)
  const statementMonthKey =
    Number.isFinite(dueDay) && Number.isFinite(statementDay) && dueDay <= statementDay
      ? addMonthsToMonthKey(dueMonthKey, -1)
      : dueMonthKey

  return {
    statementDate: getLiabilityStatementDate(liability, statementMonthKey),
    entryDate
  }
}

function getPreviousMonthStart(monthKey) {
  return `${addMonthsToMonthKey(monthKey, -1)}-01`
}

function getNextMonthEnd(monthKey) {
  return getMonthDateRange(addMonthsToMonthKey(monthKey, 2)).startDate
}

const LIABILITY_BILL_NOTE_PREFIX = 'linked_liability_id:'

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

function isTechnicalLiabilityBillNote(note) {
  const text = String(note || '')
  return text.includes('linked_liability_id:') || text.includes('default_payment_account_id:') || text.includes('Auto-created from Net Worth Liability Bill Sync')
}

function getFriendlyBillNote(row) {
  const note = String(row?.bill?.note || '').trim()

  if (!note) return ''

  if (row?.isDebtLinkedBill && isTechnicalLiabilityBillNote(note)) {
    if (row.alreadyAdded) {
      return 'Debt payment was recorded from Net Worth. This bill is locked to prevent duplicate cashflow.'
    }

    return 'Debt payment reminder linked to Net Worth. Record payment from Net Worth to update cashflow, liability balance, and statement together.'
  }

  return note
}

function getLinkedLiabilityPaymentDescription(liability) {
  const name = String(liability?.name || '').trim()
  return name ? `Debt Payment: ${name}` : 'Debt Payment:'
}

function isDateInRangeInclusive(value, start, end) {
  if (!value || !start || !end) return false
  return value >= start && value <= end
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10)
}

function getBillDescription(bill) {
  const name = String(bill?.name || '').trim()
  return name ? `Bill: ${name}` : 'Bill'
}

function getBillCategoryName(bill) {
  return String(bill?.cashflow_categories?.name || bill?.category || '').trim()
}

function getBillMatchKey({ entryDate, amount, description }) {
  return [
    entryDate || '',
    'expense',
    normalize(description || ''),
    toMoneyNumber(amount).toFixed(2)
  ].join('|')
}

function getEntryMatchKey(entry) {
  return getBillMatchKey({
    entryDate: entry.entry_date,
    amount: entry.amount,
    description: entry.description
  })
}

function getBillRowMatchKey(bill, targetMonthKey) {
  return getBillMatchKey({
    entryDate: getSafeDueDate(targetMonthKey, bill.due_day),
    amount: bill.amount,
    description: getBillDescription(bill)
  })
}

function getDaysUntilDate(dateKey) {
  const today = new Date(`${getTodayKey()}T00:00:00`)
  const date = new Date(`${dateKey}T00:00:00`)

  if (Number.isNaN(today.getTime()) || Number.isNaN(date.getTime())) return null

  return Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function getDueLabel(dateKey, dueSoonDays) {
  const days = getDaysUntilDate(dateKey)

  if (days === null) {
    return {
      label: 'Review date',
      tone: 'warning',
      days
    }
  }

  if (days < 0) {
    return {
      label: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} past due`,
      tone: 'danger',
      days
    }
  }

  if (days === 0) {
    return {
      label: 'Due today',
      tone: 'danger',
      days
    }
  }

  if (days <= Number(dueSoonDays || 7)) {
    return {
      label: `Due in ${days} day${days === 1 ? '' : 's'}`,
      tone: 'warning',
      days
    }
  }

  return {
    label: `Due in ${days} days`,
    tone: 'default',
    days
  }
}

function getAccountLabel(accountId, accounts = []) {
  if (!accountId) return 'Unassigned'

  const account = accounts.find((item) => item.id === accountId)
  if (!account) return 'Unknown account'

  return `${account.name}${account.account_type ? ` (${account.account_type})` : ''}`
}

function getLocalStorageKey(userId) {
  return `finance-dashboard.bill-account-map.${userId || 'local'}`
}

function buildBillControlRows({
  bills = [],
  cashflowEntries = [],
  accounts = [],
  targetMonthKey,
  billAccountMap = {},
  dueSoonDays = 7,
  liabilities = []
}) {
  const existingEntryMap = new Map()

  cashflowEntries.forEach((entry) => {
    existingEntryMap.set(getEntryMatchKey(entry), entry)
  })

  return bills.map((bill) => {
    const linkedLiability = getLinkedLiabilityForBill(bill, liabilities)
    const isDebtLinkedBill = Boolean(linkedLiability)
    const liabilityDueMonthDates = isDebtLinkedBill
      ? getLiabilityDatesForDueMonth(linkedLiability, targetMonthKey)
      : null
    const statementDate = liabilityDueMonthDates?.statementDate || ''
    const entryDate = isDebtLinkedBill
      ? liabilityDueMonthDates?.entryDate || getSafeDueDate(targetMonthKey, linkedLiability?.due_day || bill.due_day)
      : getSafeDueDate(targetMonthKey, bill.due_day)
    const amount = toMoneyNumber(bill.amount)
    const category = getBillCategoryName(bill)
    const description = getBillDescription(bill)
    const matchKey = getBillMatchKey({ entryDate, amount: bill.amount, description })

    const exactPostedEntry = existingEntryMap.get(matchKey) || null
    const debtPaymentPostedEntry = isDebtLinkedBill
      ? cashflowEntries.find((entry) => {
          const entryDescription = String(entry.description || '')
          const paymentDescription = getLinkedLiabilityPaymentDescription(linkedLiability)
          const isDebtPayment =
            normalize(entry.type) === 'expense' &&
            toMoneyNumber(entry.amount) > 0 &&
            entryDescription.toLowerCase().includes(paymentDescription.toLowerCase())

          if (!isDebtPayment) return false

          const windowStart = statementDate || getMonthDateRange(targetMonthKey).startDate
          const windowEnd = entryDate || getMonthDateRange(addMonthsToMonthKey(targetMonthKey, 1)).startDate
          return isDateInRangeInclusive(entry.entry_date, windowStart, windowEnd)
        })
      : null

    const postedEntry = exactPostedEntry || debtPaymentPostedEntry || null
    const alreadyAdded = Boolean(postedEntry)

    const savedAccountId = billAccountMap[bill.id] || ''
    const defaultDebtAccountId = linkedLiability?.default_payment_account_id || ''
    const postedAccountId = postedEntry?.account_id || ''
    const accountId = alreadyAdded ? postedAccountId : savedAccountId || defaultDebtAccountId

    const due = getDueLabel(entryDate, dueSoonDays)

    const isActive = normalize(bill.status || 'active') === 'active'
    const isMonthly = normalize(bill.frequency || 'monthly') === 'monthly'
    const missingAmount = amount <= 0
    const missingCategory = !category
    const missingCategoryId = !bill.category_id

    let status = BILL_STATUS.READY
    let reason = 'Ready'

    if (!isActive) {
      status = BILL_STATUS.INACTIVE
      reason = 'Inactive'
    } else if (!isMonthly) {
      status = BILL_STATUS.REVIEW
      reason = 'Not Monthly'
    } else if (alreadyAdded) {
      status = BILL_STATUS.ADDED
      reason = isDebtLinkedBill ? 'Paid / Posted' : 'Added This Month'
    } else if (missingAmount) {
      status = BILL_STATUS.BLOCKED
      reason = 'Missing Amount'
    } else if (missingCategory) {
      status = BILL_STATUS.BLOCKED
      reason = 'Missing Category'
    } else if (isDebtLinkedBill) {
      status = BILL_STATUS.REVIEW
      reason = 'Record in Net Worth'
    } else if (missingCategoryId) {
      status = BILL_STATUS.REVIEW
      reason = 'Category Review'
    }

    return {
      bill,
      id: bill.id,
      name: bill.name || 'Unnamed Bill',
      amount,
      dueDay: Number(bill.due_day || 1),
      entryDate,
      linkedLiability,
      isDebtLinkedBill,
      statementDate,
      category,
      description,
      matchKey,
      accountId,
      savedAccountId,
      postedAccountId,
      postedEntry,
      postedEntryId: postedEntry?.id || null,
      accountLabel: getAccountLabel(accountId, accounts),
      postedAccountLabel: getAccountLabel(postedAccountId, accounts),
      frequency: bill.frequency || 'monthly',
      billStatus: bill.status || 'active',
      alreadyAdded,
      isActive,
      isMonthly,
      missingAmount,
      missingCategory,
      missingCategoryId,
      status,
      reason,
      due,
      canAdd: status === BILL_STATUS.READY && !isDebtLinkedBill,
      canUpdatePostedAccount: alreadyAdded && Boolean(postedEntry?.id)
    }
  })
}

function summarizeRows(rows = []) {
  const ready = rows.filter((row) => row.status === BILL_STATUS.READY)
  const added = rows.filter((row) => row.status === BILL_STATUS.ADDED)
  const review = rows.filter((row) => row.status === BILL_STATUS.REVIEW)
  const blocked = rows.filter((row) => row.status === BILL_STATUS.BLOCKED)
  const inactive = rows.filter((row) => row.status === BILL_STATUS.INACTIVE)
  const activeMonthly = rows.filter((row) => row.isActive && row.isMonthly)

  return {
    total: rows.length,
    activeMonthly: activeMonthly.length,
    ready: ready.length,
    added: added.length,
    review: review.length,
    blocked: blocked.length,
    inactive: inactive.length,
    readyAmount: ready.reduce((sum, row) => sum + row.amount, 0),
    addedAmount: added.reduce((sum, row) => sum + row.amount, 0),
    monthlyFixedCost: activeMonthly.reduce((sum, row) => sum + row.amount, 0),
    dueSoon: rows.filter((row) => row.due.tone === 'warning' && row.status !== BILL_STATUS.ADDED).length,
    pastDue: rows.filter((row) => row.due.tone === 'danger' && row.status !== BILL_STATUS.ADDED).length
  }
}

export default function BillsPage() {
  const [targetMonthKey, setTargetMonthKey] = useState(getCurrentMonthKey())
  const [bills, setBills] = useState([])
  const [liabilities, setLiabilities] = useState([])
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [monthlyCashflowEntries, setMonthlyCashflowEntries] = useState([])
  const [billAccountMap, setBillAccountMap] = useState({})
  const [defaultAccountId, setDefaultAccountId] = useState('')
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  const targetRange = useMemo(() => getMonthDateRange(targetMonthKey), [targetMonthKey])

  const [formData, setFormData] = useState({
    name: '',
    category_id: '',
    category: '',
    amount: '',
    due_day: '1',
    frequency: 'monthly',
    status: 'active',
    note: ''
  })

  const expenseCategoryOptions = useMemo(
    () => getCategoryOptionsByType(categories, 'expense'),
    [categories]
  )

  useEffect(() => {
    loadBills()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMonthKey])

  async function loadBills() {
    setLoading(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const loadedSettings = await loadUserSettings()
      const categoryData = await ensureDefaultCashflowCategories(supabase, user.id)

      const cashflowLookupStart = getPreviousMonthStart(targetMonthKey)
      const cashflowLookupEnd = getNextMonthEnd(targetMonthKey)

      const [billResult, accountResult, liabilityResult, cashflowResult] = await Promise.all([
        supabase
          .from('bills')
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
          .order('due_day', { ascending: true }),

        supabase
          .from('accounts')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),

        supabase
          .from('liabilities')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),

        supabase
          .from('cashflow_entries')
          .select(`
            id,
            entry_date,
            type,
            amount,
            category,
            category_id,
            description,
            account_id,
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
          .gte('entry_date', cashflowLookupStart)
          .lt('entry_date', cashflowLookupEnd)
          .order('entry_date', { ascending: false })
      ])

      if (billResult.error) throw billResult.error
      if (accountResult.error) throw accountResult.error
      if (liabilityResult.error) throw liabilityResult.error
      if (cashflowResult.error) throw cashflowResult.error

      let savedMap = {}

      try {
        const savedMapText = window.localStorage.getItem(getLocalStorageKey(user.id))
        savedMap = savedMapText ? JSON.parse(savedMapText) : {}
      } catch {
        savedMap = {}
      }

      setAppSettings(loadedSettings)
      setCategories(categoryData)
      setBills(billResult.data || [])
      setLiabilities(liabilityResult.data || [])
      setAccounts(accountResult.data || [])
      setMonthlyCashflowEntries(cashflowResult.data || [])
      setBillAccountMap(savedMap && typeof savedMap === 'object' ? savedMap : {})

      if (!defaultAccountId && loadedSettings.defaultAccountId) {
        const exists = (accountResult.data || []).some(
          (account) => account.id === loadedSettings.defaultAccountId
        )

        if (exists) setDefaultAccountId(loadedSettings.defaultAccountId)
      }
    } catch (error) {
      console.error('loadBills error:', error)
      setMessage(
        error.message ||
          'Failed to load bills. Make sure bills, accounts, cashflow_entries, and categories are available.'
      )
    } finally {
      setLoading(false)
    }
  }

  async function persistBillAccountMap(nextMap) {
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser()

      window.localStorage.setItem(getLocalStorageKey(user?.id), JSON.stringify(nextMap))
    } catch (error) {
      console.warn('Unable to save bill account map locally:', error)
    }
  }

  function resetForm() {
    setEditingId(null)
    setFormData({
      name: '',
      category_id: '',
      category: '',
      amount: '',
      due_day: '1',
      frequency: 'monthly',
      status: 'active',
      note: ''
    })
  }

  function handleChange(e) {
    const { name, value } = e.target

    setFormData((prev) => {
      if (name === 'category_id') {
        const selected = findCategoryById(categories, value)

        return {
          ...prev,
          category_id: value,
          category: selected?.name || ''
        }
      }

      return {
        ...prev,
        [name]: value
      }
    })
  }

  function handleBillAccountChange(billId, accountId) {
    setBillAccountMap((prev) => {
      const next = {
        ...prev,
        [billId]: accountId
      }

      persistBillAccountMap(next)
      return next
    })
  }

  function handleApplyDefaultAccount() {
    if (!defaultAccountId) {
      setMessage('Choose a default account first.')
      return
    }

    const nextMap = { ...billAccountMap }

    billRows.forEach((row) => {
      if (row.canAdd) {
        nextMap[row.bill.id] = defaultAccountId
      }
    })

    setBillAccountMap(nextMap)
    persistBillAccountMap(nextMap)
    setMessage(`Applied ${getAccountLabel(defaultAccountId, accounts)} to all ready bills.`)
  }

  function handleClearAccountSelection() {
    setBillAccountMap({})
    persistBillAccountMap({})
    setMessage('Cleared saved bill account selections for this browser.')
  }

  async function handlePostedAccountChange(row, accountId) {
    if (!row?.postedEntryId) {
      setMessage('This bill does not have a posted cashflow entry to update.')
      return
    }

    setGenerating(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const { error } = await supabase
        .from('cashflow_entries')
        .update({
          account_id: accountId || null
        })
        .eq('id', row.postedEntryId)
        .eq('user_id', user.id)

      if (error) throw error

      setMessage(
        `${row.name} posted cashflow account updated to ${getAccountLabel(accountId, accounts)}.`
      )

      await loadBills()
    } catch (error) {
      console.error('handlePostedAccountChange error:', error)
      setMessage(error.message || 'Failed to update posted bill account.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')
      if (!formData.name.trim()) throw new Error('Bill name is required')
      if (!formData.amount) throw new Error('Amount is required')

      const amountValue = Number(formData.amount || 0)
      const dueDayValue = Number(formData.due_day || 1)

      if (Number.isNaN(amountValue) || amountValue <= 0) {
        throw new Error('Amount must be greater than 0')
      }

      if (Number.isNaN(dueDayValue) || dueDayValue < 1 || dueDayValue > 31) {
        throw new Error('Due day must be between 1 and 31')
      }

      const categoryPayload = buildCategoryPayload({
        categories,
        categoryId: formData.category_id,
        customCategory: formData.category
      })

      if (!categoryPayload.category) {
        throw new Error('Category is required')
      }

      const payload = {
        user_id: user.id,
        name: formData.name.trim(),
        category_id: categoryPayload.category_id,
        category: categoryPayload.category,
        amount: amountValue,
        due_day: dueDayValue,
        frequency: formData.frequency,
        status: formData.status,
        note: formData.note.trim() || null
      }

      if (editingId) {
        const { error } = await supabase
          .from('bills')
          .update(payload)
          .eq('id', editingId)
          .eq('user_id', user.id)

        if (error) throw error
        setMessage('Bill updated successfully')
      } else {
        const { error } = await supabase.from('bills').insert(payload)

        if (error) throw error
        setMessage('Bill added successfully')
      }

      resetForm()
      await loadBills()
    } catch (error) {
      console.error('handleSubmit error:', error)
      setMessage(error.message || 'Failed to save bill')
    } finally {
      setSaving(false)
    }
  }

  function handleEdit(bill) {
    setEditingId(bill.id)
    setFormData({
      name: bill.name || '',
      category_id: bill.category_id || '',
      category: bill.category || bill.cashflow_categories?.name || '',
      amount: bill.amount ?? '',
      due_day: bill.due_day ?? '1',
      frequency: bill.frequency || 'monthly',
      status: bill.status || 'active',
      note: bill.note || ''
    })
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleDelete(id) {
    const confirmed = window.confirm(
      'Delete this bill template? This does not delete cashflow entries already created from it.'
    )
    if (!confirmed) return

    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const { error } = await supabase
        .from('bills')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) throw error

      setBillAccountMap((prev) => {
        const next = { ...prev }
        delete next[id]
        persistBillAccountMap(next)
        return next
      })

      setMessage('Bill deleted successfully')
      await loadBills()
    } catch (error) {
      console.error('handleDelete error:', error)
      setMessage(error.message || 'Failed to delete bill')
    } finally {
      setSaving(false)
    }
  }

  async function addBillRowsToCashflow(rows) {
    const readyRows = rows.filter((row) => row.canAdd)

    if (readyRows.length === 0) {
      setMessage('No ready bills to add. Review blocked, duplicate, inactive, or category review rows first.')
      return
    }

    const confirmed = window.confirm(
      `Add ${readyRows.length} bill expense${readyRows.length === 1 ? '' : 's'} to Cashflow for ${getMonthLabel(targetMonthKey)}?`
    )

    if (!confirmed) return

    setGenerating(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const entriesToInsert = readyRows.map((row) => ({
        user_id: user.id,
        account_id: row.accountId || null,
        entry_date: row.entryDate,
        type: 'expense',
        amount: row.amount,
        category_id: row.bill.category_id || null,
        category: row.category,
        description: row.description
      }))

      const { error } = await supabase.from('cashflow_entries').insert(entriesToInsert)

      if (error) throw error

      setMessage(
        `Added ${entriesToInsert.length} bill expense${
          entriesToInsert.length === 1 ? '' : 's'
        } to Cashflow for ${getMonthLabel(targetMonthKey)}.`
      )

      await loadBills()
    } catch (error) {
      console.error('addBillRowsToCashflow error:', error)
      setMessage(error.message || 'Failed to add bills to cashflow')
    } finally {
      setGenerating(false)
    }
  }

  const billRows = useMemo(
    () =>
      buildBillControlRows({
        bills,
        cashflowEntries: monthlyCashflowEntries,
        accounts,
        targetMonthKey,
        billAccountMap,
        dueSoonDays: appSettings.billDueSoonDays,
        liabilities
      }),
    [
      bills,
      monthlyCashflowEntries,
      accounts,
      targetMonthKey,
      billAccountMap,
      appSettings.billDueSoonDays
    ]
  )

  const filteredRows = useMemo(() => {
    const query = normalize(searchTerm)

    return billRows.filter((row) => {
      const matchesSearch =
        !query ||
        normalize(row.name).includes(query) ||
        normalize(row.category).includes(query) ||
        normalize(row.description).includes(query) ||
        normalize(row.frequency).includes(query) ||
        normalize(row.billStatus).includes(query)

      const matchesStatus =
        statusFilter === 'all' ||
        row.status === statusFilter ||
        (statusFilter === 'active_monthly' && row.isActive && row.isMonthly)

      return matchesSearch && matchesStatus
    })
  }, [billRows, searchTerm, statusFilter])

  const summary = useMemo(() => summarizeRows(billRows), [billRows])

  const nextReadyRows = useMemo(
    () =>
      billRows
        .filter((row) => row.canAdd)
        .sort((a, b) => String(a.entryDate).localeCompare(String(b.entryDate))),
    [billRows]
  )

  const nextBill = useMemo(() => {
    return billRows
      .filter((row) => row.isActive && !row.alreadyAdded)
      .sort((a, b) => String(a.entryDate).localeCompare(String(b.entryDate)))[0]
  }, [billRows])

  return (
    <div>
      <div style={pageHeaderStyle}>
        <div>
          <div style={eyebrowStyle}>Bài 43B-mini · Posted Bill Account Sync</div>
          <h1 style={titleStyle}>Bills & Subscriptions</h1>
          <p style={subtitleStyle}>
            Manage recurring bill templates, post ready bills into Cashflow, prevent duplicates,
            and edit posted bill account directly from this page.
          </p>
        </div>

        <div style={headerActionStyle}>
          <input
            type="month"
            value={targetMonthKey}
            onChange={(event) => setTargetMonthKey(event.target.value)}
            style={monthInputStyle}
          />
          <button
            type="button"
            onClick={() => addBillRowsToCashflow(nextReadyRows)}
            disabled={generating || nextReadyRows.length === 0}
            style={nextReadyRows.length === 0 ? disabledHeaderButtonStyle : greenButtonStyle}
          >
            {generating ? 'Adding...' : `Add ${nextReadyRows.length} Ready`}
          </button>
          <button type="button" onClick={loadBills} style={refreshButtonStyle}>
            Refresh
          </button>
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={summaryGridStyle}>
        <SummaryCard
          title="Monthly Fixed Cost"
          value={`$${formatMoney(summary.monthlyFixedCost)}`}
          note={getMonthLabel(targetMonthKey)}
        />
        <SummaryCard
          title="Added This Month"
          value={`${summary.added}/${summary.activeMonthly}`}
          note={`Posted value $${formatMoney(summary.addedAmount)}`}
          tone={summary.ready > 0 ? 'warning' : 'good'}
        />
        <SummaryCard
          title="Ready to Post"
          value={String(summary.ready)}
          note={`Ready value $${formatMoney(summary.readyAmount)}`}
          tone={summary.ready > 0 ? 'good' : 'default'}
        />
        <SummaryCard
          title="Review / Blocked"
          value={`${summary.review}/${summary.blocked}`}
          note={`${summary.inactive} inactive`}
          tone={summary.review || summary.blocked ? 'warning' : 'good'}
        />
        <SummaryCard
          title="Next Bill"
          value={nextBill?.name || 'None'}
          note={nextBill ? `${nextBill.due.label} · $${formatMoney(nextBill.amount)}` : 'No open active bill'}
          tone={nextBill?.due?.tone === 'danger' ? 'danger' : nextBill?.due?.tone === 'warning' ? 'warning' : 'default'}
        />
      </div>

      <div style={integrationCardStyle}>
        <div>
          <h2 style={integrationTitleStyle}>Recurring Control</h2>
          <p style={integrationTextStyle}>
            Ready bills use the selected next-post account. Posted bills now show the real account
            from the Cashflow entry and can be changed here without opening Cashflow.
          </p>
        </div>

        <div style={integrationControlStyle}>
          <select
            value={defaultAccountId}
            onChange={(event) => setDefaultAccountId(event.target.value)}
            style={miniSelectStyle}
          >
            <option value="">Default account: Unassigned</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.account_type})
              </option>
            ))}
          </select>

          <button type="button" onClick={handleApplyDefaultAccount} style={secondaryButtonStyle}>
            Apply to Ready
          </button>

          <button type="button" onClick={handleClearAccountSelection} style={secondaryButtonStyle}>
            Clear Picks
          </button>
        </div>
      </div>

      <div style={layoutStyle}>
        <div style={formCardStyle}>
          <div style={formHeaderStyle}>
            <div>
              <h2 style={cardTitleStyle}>{editingId ? 'Edit Bill Template' : 'Add Bill Template'}</h2>
              <p style={cardSubtitleStyle}>
                Category is the group. Bill name becomes the Cashflow description.
              </p>
            </div>

            {editingId && (
              <button onClick={resetForm} type="button" style={secondaryButtonStyle}>
                Cancel
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit}>
            <Field label="Bill Name">
              <input
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Tmobile, ChatGPT, Rent, Insurance..."
                style={inputStyle}
              />
            </Field>

            <Field label="Category">
              <select
                name="category_id"
                value={formData.category_id}
                onChange={handleChange}
                style={inputStyle}
              >
                <option value="">Custom / legacy category</option>
                {expenseCategoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.group_name ? `${category.group_name} · ` : ''}
                    {category.name}
                  </option>
                ))}
              </select>
              <p style={fieldHintStyle}>
                Best practice: use database category so Budget, Money Plan, and Dashboard can match correctly.
              </p>
            </Field>

            {!formData.category_id && (
              <Field label="Custom Category">
                <input
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  placeholder="Example: Subscriptions, Phone, Insurance"
                  style={inputStyle}
                />
              </Field>
            )}

            <div style={twoColumnStyle}>
              <Field label="Amount">
                <input
                  type="number"
                  step="0.01"
                  name="amount"
                  value={formData.amount}
                  onChange={handleChange}
                  placeholder="150.00"
                  style={inputStyle}
                />
              </Field>

              <Field label="Due Day">
                <input
                  type="number"
                  min="1"
                  max="31"
                  name="due_day"
                  value={formData.due_day}
                  onChange={handleChange}
                  style={inputStyle}
                />
              </Field>
            </div>

            <div style={twoColumnStyle}>
              <Field label="Frequency">
                <select
                  name="frequency"
                  value={formData.frequency}
                  onChange={handleChange}
                  style={inputStyle}
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </Field>

              <Field label="Status">
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  style={inputStyle}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
            </div>

            <Field label="Note">
              <textarea
                name="note"
                value={formData.note}
                onChange={handleChange}
                placeholder="Optional note..."
                style={{ ...inputStyle, minHeight: '90px' }}
              />
            </Field>

            <button disabled={saving} style={buttonStyle}>
              {saving ? 'Saving...' : editingId ? 'Update Bill' : 'Add Bill'}
            </button>
          </form>
        </div>

        <div style={listCardStyle}>
          <div style={listHeaderStyle}>
            <div>
              <h2 style={cardTitleStyle}>Recurring Bill Control</h2>
              <p style={cardSubtitleStyle}>
                Selected month: {getMonthLabel(targetMonthKey)} · Due soon window: {appSettings.billDueSoonDays} day(s)
              </p>
            </div>

            <div style={filterRowStyle}>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search bills..."
                style={searchInputStyle}
              />

              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                style={filterSelectStyle}
              >
                <option value="all">All</option>
                <option value="active_monthly">Active Monthly</option>
                <option value={BILL_STATUS.READY}>Ready</option>
                <option value={BILL_STATUS.ADDED}>Added</option>
                <option value={BILL_STATUS.REVIEW}>Review</option>
                <option value={BILL_STATUS.BLOCKED}>Blocked</option>
                <option value={BILL_STATUS.INACTIVE}>Inactive</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div style={emptyStyle}>Loading bills...</div>
          ) : filteredRows.length === 0 ? (
            <div style={emptyStyle}>No bills found for this filter.</div>
          ) : (
            <div style={billListStyle}>
              {filteredRows.map((row) => {
                const bill = row.bill

                return (
                  <div key={bill.id} style={getBillItemStyle(row)}>
                    <div style={billTopStyle}>
                      <div style={{ minWidth: 0 }}>
                        <div style={billNameRowStyle}>
                          <strong style={billNameStyle}>{row.name}</strong>
                          <span style={getStatusBadgeStyle(row.status)}>{row.reason}</span>
                          <span style={getDueBadgeStyle(row.alreadyAdded ? 'posted' : row.due.tone)}>
                            {row.alreadyAdded ? 'Posted' : row.due.label}
                          </span>
                        </div>

                        <div style={mutedTextStyle}>
                          {row.category || 'Missing category'} · {row.isDebtLinkedBill ? `Payment due ${row.entryDate}${row.statementDate ? ` · statement ${row.statementDate}` : ''}` : `Due day ${row.dueDay}`} · {row.frequency} · {row.billStatus}
                        </div>

                        <div style={detailTextStyle}>Cashflow detail: {row.description}</div>

                        {row.missingCategoryId && !row.isDebtLinkedBill && (
                          <div style={reviewTextStyle}>
                            Needs database category mapping before safe recurring posting.
                          </div>
                        )}

                        {row.isDebtLinkedBill && !row.alreadyAdded && (
                          <div style={reviewTextStyle}>
                            Debt bills are reminders only. Record the payment from Net Worth so the cashflow, liability balance, and statement stay in sync.
                          </div>
                        )}

                        {getFriendlyBillNote(row) && (
                          <div style={mutedTextStyle}>{getFriendlyBillNote(row)}</div>
                        )}
                      </div>

                      <div style={amountBoxStyle}>
                        <div style={amountStyle}>${formatMoney(row.amount)}</div>
                        <div style={daysStyle}>{row.entryDate}</div>
                      </div>
                    </div>

                    <div style={billCashflowRowStyle}>
                      <select
                        value={row.alreadyAdded ? row.postedAccountId || '' : billAccountMap[bill.id] || ''}
                        onChange={(event) => {
                          if (row.alreadyAdded) {
                            handlePostedAccountChange(row, event.target.value)
                          } else {
                            handleBillAccountChange(bill.id, event.target.value)
                          }
                        }}
                        style={miniSelectStyle}
                        disabled={generating || (!row.canAdd && !row.canUpdatePostedAccount)}
                      >
                        <option value="">
                          {row.alreadyAdded ? 'Posted account: Unassigned' : 'Cashflow account: Unassigned'}
                        </option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name} ({account.account_type})
                          </option>
                        ))}
                      </select>

                      <div style={accountPreviewStyle}>
                        {row.alreadyAdded
                          ? `Posted account: ${row.postedAccountLabel}`
                          : `Next post account: ${row.accountLabel}`}
                      </div>

                      <button
                        type="button"
                        onClick={() => addBillRowsToCashflow([row])}
                        disabled={!row.canAdd || generating}
                        style={row.canAdd ? addCashflowButtonStyle : disabledSmallButtonStyle}
                      >
                        {row.alreadyAdded ? 'Posted' : row.isDebtLinkedBill ? 'Record in Net Worth' : row.canAdd ? 'Add to Cashflow' : row.reason}
                      </button>
                    </div>

                    <div style={actionRowStyle}>
                      <button onClick={() => handleEdit(bill)} style={editButtonStyle}>
                        Edit Template
                      </button>
                      <button onClick={() => handleDelete(bill.id)} style={deleteButtonStyle}>
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={fieldStyle}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function SummaryCard({ title, value, note, tone = 'default' }) {
  const color =
    tone === 'good'
      ? 'var(--success, #22c55e)'
      : tone === 'danger'
        ? 'var(--danger, #ef4444)'
        : tone === 'warning'
          ? 'var(--warning, #f59e0b)'
          : 'var(--text-main, #f9fafb)'

  return (
    <div style={summaryCardStyle}>
      <div style={summaryLabelStyle}>{title}</div>
      <div style={{ ...summaryValueStyle, color }}>{value}</div>
      {note && <div style={summaryNoteStyle}>{note}</div>}
    </div>
  )
}

function getStatusBadgeStyle(status) {
  if (status === BILL_STATUS.READY) return readyBadgeStyle
  if (status === BILL_STATUS.ADDED) return addedBadgeStyle
  if (status === BILL_STATUS.REVIEW) return warningBadgeStyle
  if (status === BILL_STATUS.BLOCKED) return dangerBadgeStyle
  return mutedBadgeStyle
}

function getDueBadgeStyle(tone) {
  if (tone === 'posted') return addedBadgeStyle
  if (tone === 'danger') return dangerBadgeStyle
  if (tone === 'warning') return warningBadgeStyle
  return mutedBadgeStyle
}

function getBillItemStyle(row) {
  if (row.status === BILL_STATUS.READY) {
    return { ...billItemStyle, borderColor: 'rgba(34,197,94,0.36)' }
  }

  if (row.status === BILL_STATUS.ADDED) {
    return { ...billItemStyle, borderColor: 'rgba(56,189,248,0.32)' }
  }

  if (row.status === BILL_STATUS.REVIEW) {
    return { ...billItemStyle, borderColor: 'rgba(245,158,11,0.36)' }
  }

  if (row.status === BILL_STATUS.BLOCKED) {
    return { ...billItemStyle, borderColor: 'rgba(239,68,68,0.36)' }
  }

  return { ...billItemStyle, opacity: 0.76 }
}

const pageHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  marginBottom: '20px',
  flexWrap: 'wrap'
}

const eyebrowStyle = {
  color: 'var(--accent, #38bdf8)',
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: '8px'
}

const titleStyle = {
  margin: 0,
  fontSize: '34px',
  fontWeight: 850,
  letterSpacing: '-0.04em'
}

const subtitleStyle = {
  marginTop: '8px',
  color: 'var(--text-soft, #cbd5e1)',
  fontSize: '15px',
  lineHeight: 1.55,
  maxWidth: '820px'
}

const headerActionStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
}

const monthInputStyle = {
  padding: '11px 12px',
  borderRadius: '10px',
  border: '1px solid var(--border-soft, #4b5563)',
  background: 'var(--bg-input, var(--bg-card, #111827))',
  color: 'var(--text-main, #f9fafb)',
  WebkitTextFillColor: 'var(--text-main, #f9fafb)',
  opacity: 1,
  colorScheme: 'inherit'
}

const refreshButtonStyle = {
  padding: '11px 14px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--accent, #38bdf8)',
  color: 'var(--button-text, white)',
  cursor: 'pointer',
  fontWeight: 800,
  whiteSpace: 'nowrap'
}

const greenButtonStyle = {
  padding: '11px 14px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--success, #22c55e)',
  color: 'var(--button-text, white)',
  cursor: 'pointer',
  fontWeight: 800,
  whiteSpace: 'nowrap'
}

const disabledHeaderButtonStyle = {
  ...greenButtonStyle,
  background: 'var(--bg-card-soft, #0f172a)',
  color: 'var(--text-muted, #9ca3af)',
  cursor: 'not-allowed'
}

const messageStyle = {
  marginBottom: '16px',
  padding: '12px 14px',
  borderRadius: '12px',
  background: 'var(--bg-card, #111827)',
  border: '1px solid var(--border-main, #374151)',
  color: 'var(--text-main, #f9fafb)'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: '16px',
  marginBottom: '20px'
}

const summaryCardStyle = {
  background: 'var(--bg-card, #111827)',
  border: '1px solid var(--border-main, #374151)',
  borderRadius: '18px',
  padding: '18px',
  boxShadow: 'var(--shadow-card, 0 14px 34px rgba(0,0,0,0.24))',
  minWidth: 0
}

const summaryLabelStyle = {
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '13px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.04em'
}

const summaryValueStyle = {
  marginTop: '10px',
  fontSize: '25px',
  fontWeight: 950,
  overflowWrap: 'anywhere'
}

const summaryNoteStyle = {
  marginTop: '8px',
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '12px',
  lineHeight: 1.45
}

const integrationCardStyle = {
  background: 'var(--bg-card, #111827)',
  border: '1px solid color-mix(in srgb, var(--success, #22c55e) 32%, transparent)',
  borderRadius: '18px',
  padding: '16px',
  marginBottom: '20px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  flexWrap: 'wrap'
}

const integrationTitleStyle = {
  margin: 0,
  color: 'var(--text-main, #f9fafb)',
  fontSize: '18px',
  fontWeight: 900
}

const integrationTextStyle = {
  margin: '6px 0 0',
  color: 'var(--text-soft, #cbd5e1)',
  fontSize: '14px',
  maxWidth: '760px',
  lineHeight: 1.5
}

const integrationControlStyle = {
  display: 'flex',
  gap: '9px',
  alignItems: 'center',
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
}

const layoutStyle = {
  display: 'grid',
  gridTemplateColumns: '420px minmax(0, 1fr)',
  gap: '24px',
  alignItems: 'start'
}

const formCardStyle = {
  background: 'var(--bg-card, #111827)',
  padding: '22px',
  borderRadius: '18px',
  border: '1px solid var(--border-main, #374151)',
  position: 'sticky',
  top: '20px',
  boxShadow: 'var(--shadow-card, 0 14px 34px rgba(0,0,0,0.24))',
  minWidth: 0
}

const listCardStyle = {
  background: 'var(--bg-card, #111827)',
  padding: '22px',
  borderRadius: '18px',
  border: '1px solid var(--border-main, #374151)',
  minWidth: 0,
  boxShadow: 'var(--shadow-card, 0 14px 34px rgba(0,0,0,0.24))'
}

const formHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  marginBottom: '18px'
}

const listHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '14px',
  marginBottom: '16px',
  flexWrap: 'wrap'
}

const cardTitleStyle = {
  margin: 0,
  fontSize: '24px',
  fontWeight: 850,
  letterSpacing: '-0.03em',
  color: 'var(--text-main, #f9fafb)'
}

const cardSubtitleStyle = {
  marginTop: '6px',
  marginBottom: 0,
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '14px',
  lineHeight: 1.45
}

const fieldStyle = {
  marginBottom: '16px'
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  color: 'var(--text-main, #f9fafb)',
  fontWeight: 750
}

const fieldHintStyle = {
  margin: '7px 0 0',
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '12px',
  lineHeight: 1.45
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 12px',
  borderRadius: '10px',
  border: '1px solid var(--border-soft, #4b5563)',
  background: 'var(--bg-input, var(--bg-card, #111827))',
  color: 'var(--text-main, #f9fafb)',
  WebkitTextFillColor: 'var(--text-main, #f9fafb)',
  outline: 'none',
  opacity: 1
}

const twoColumnStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px'
}

const buttonStyle = {
  width: '100%',
  padding: '13px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--accent, #38bdf8)',
  color: 'var(--button-text, white)',
  cursor: 'pointer',
  fontWeight: 800
}

const secondaryButtonStyle = {
  padding: '9px 12px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--bg-card-soft, #0f172a)',
  color: 'var(--button-text, white)',
  cursor: 'pointer',
  fontWeight: 750,
  whiteSpace: 'nowrap'
}

const filterRowStyle = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
}

const searchInputStyle = {
  ...inputStyle,
  width: '220px'
}

const filterSelectStyle = {
  ...inputStyle,
  width: '170px'
}

const billListStyle = {
  maxHeight: '760px',
  overflowY: 'auto',
  paddingRight: '6px',
  display: 'grid',
  gap: '12px'
}

const billItemStyle = {
  background: 'var(--bg-card, #111827)',
  border: '1px solid var(--border-main, #374151)',
  borderRadius: '14px',
  padding: '16px',
  boxShadow: 'var(--shadow-soft, 0 10px 24px rgba(0,0,0,0.2))',
  minWidth: 0
}

const billTopStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '18px'
}

const billNameRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  marginBottom: '8px',
  flexWrap: 'wrap'
}

const billNameStyle = {
  fontSize: '19px',
  color: 'var(--text-main, #f9fafb)',
  overflowWrap: 'anywhere'
}

const mutedTextStyle = {
  marginTop: '5px',
  color: 'var(--text-soft, #cbd5e1)',
  fontSize: '14px',
  lineHeight: 1.45
}

const detailTextStyle = {
  marginTop: '5px',
  color: 'var(--accent, #38bdf8)',
  fontSize: '13px',
  fontWeight: 750,
  lineHeight: 1.45
}

const reviewTextStyle = {
  marginTop: '5px',
  color: 'var(--warning, #f59e0b)',
  fontSize: '13px',
  fontWeight: 750,
  lineHeight: 1.45
}

const amountBoxStyle = {
  textAlign: 'right',
  minWidth: '140px'
}

const amountStyle = {
  fontSize: '20px',
  fontWeight: 900,
  color: 'var(--text-main, #f9fafb)'
}

const daysStyle = {
  marginTop: '6px',
  color: 'var(--accent, #38bdf8)',
  fontSize: '13px'
}

const baseBadgeStyle = {
  padding: '4px 9px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 850,
  whiteSpace: 'nowrap'
}

const readyBadgeStyle = {
  ...baseBadgeStyle,
  background: 'rgba(34,197,94,0.14)',
  color: 'var(--success, #22c55e)',
  border: '1px solid color-mix(in srgb, var(--success, #22c55e) 32%, transparent)'
}

const addedBadgeStyle = {
  ...baseBadgeStyle,
  background: 'rgba(59,130,246,0.14)',
  color: 'var(--accent, #38bdf8)',
  border: '1px solid rgba(59,130,246,0.28)'
}

const warningBadgeStyle = {
  ...baseBadgeStyle,
  background: 'rgba(245,158,11,0.14)',
  color: 'var(--warning, #f59e0b)',
  border: '1px solid rgba(245,158,11,0.28)'
}

const dangerBadgeStyle = {
  ...baseBadgeStyle,
  background: 'rgba(239,68,68,0.14)',
  color: 'var(--danger, #ef4444)',
  border: '1px solid rgba(239,68,68,0.28)'
}

const mutedBadgeStyle = {
  ...baseBadgeStyle,
  background: 'rgba(148,163,184,0.14)',
  color: 'var(--text-soft, #cbd5e1)',
  border: '1px solid rgba(148,163,184,0.28)'
}

const billCashflowRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 1fr) minmax(150px, 0.8fr) auto',
  gap: '10px',
  alignItems: 'center',
  marginTop: '14px',
  paddingTop: '12px',
  borderTop: '1px solid var(--border-faint, rgba(255,255,255,0.08))'
}

const miniSelectStyle = {
  minWidth: '220px',
  boxSizing: 'border-box',
  padding: '9px 10px',
  borderRadius: '10px',
  border: '1px solid var(--border-soft, #4b5563)',
  background: 'var(--bg-input, var(--bg-card-soft, #0f172a))',
  color: 'var(--text-main, #f9fafb)',
  WebkitTextFillColor: 'var(--text-main, #f9fafb)',
  outline: 'none',
  opacity: 1
}

const accountPreviewStyle = {
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '12px',
  lineHeight: 1.35
}

const addCashflowButtonStyle = {
  padding: '9px 12px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--success, #22c55e)',
  color: 'var(--button-text, white)',
  cursor: 'pointer',
  fontWeight: 800,
  whiteSpace: 'nowrap'
}

const disabledSmallButtonStyle = {
  ...addCashflowButtonStyle,
  background: 'var(--bg-card-soft, #0f172a)',
  color: 'var(--text-soft, #cbd5e1)',
  cursor: 'not-allowed'
}

const actionRowStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  marginTop: '14px',
  paddingTop: '12px',
  borderTop: '1px solid var(--border-faint, rgba(255,255,255,0.08))'
}

const editButtonStyle = {
  padding: '8px 12px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--accent, #38bdf8)',
  color: 'var(--button-text, white)',
  cursor: 'pointer',
  fontWeight: 750
}

const deleteButtonStyle = {
  padding: '8px 12px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--danger, #ef4444)',
  color: 'var(--button-text, white)',
  cursor: 'pointer',
  fontWeight: 750
}

const emptyStyle = {
  padding: '24px',
  borderRadius: '14px',
  background: 'var(--bg-card, #111827)',
  border: '1px solid var(--border-main, #374151)',
  color: 'var(--text-soft, #cbd5e1)',
  textAlign: 'center'
}