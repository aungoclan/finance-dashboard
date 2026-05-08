import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  calculateCashflowSummary,
  calculateCategorySummary,
  formatMoney,
  getCurrentMonthDateRange
} from '../lib/cashflow'
import {
  buildCategoryPayload,
  ensureDefaultCashflowCategories,
  findCategoryById,
  getCategoryDisplayName,
  getCategoryOptionsByType
} from '../lib/cashflowCategories'

const VIEW_MODES = {
  CURRENT_MONTH: 'current_month',
  ALL_TIME: 'all_time',
  UNASSIGNED: 'unassigned'
}


const CASH_ACCOUNT_TYPES = ['cash', 'checking', 'savings', 'business']

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function parseMonthKey(monthKey) {
  const [yearText, monthText] = String(monthKey || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  }

  return { year, month }
}

function shiftMonthKey(monthKey, offset) {
  const { year, month } = parseMonthKey(monthKey)
  const shifted = new Date(year, month - 1 + offset, 1)
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}`
}

function getMonthRangeFromKey(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const next = new Date(year, month, 1)

  return {
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-01`
  }
}

function isArchivedAccount(account) {
  return String(account?.name || '').startsWith('[ARCHIVED] ')
}

function getEntryAmount(entry) {
  return Math.abs(toNumber(entry?.amount))
}

function getLedgerFinalBalance(ledger) {
  if (!ledger) return 0

  const actual = ledger.actual_cash_count
  if (actual !== null && actual !== undefined) return toNumber(actual)

  return toNumber(ledger.expected_closing_balance)
}

function getNetForAccount(entries, accountId, range = null) {
  let income = 0
  let expense = 0

  for (const entry of entries || []) {
    if ((entry.account_id || '') !== accountId) continue

    const entryDate = String(entry.entry_date || '')
    if (range && (entryDate < range.startDate || entryDate >= range.endDate)) continue

    if (entry.type === 'income') income += getEntryAmount(entry)
    if (entry.type === 'expense') expense += getEntryAmount(entry)
  }

  return income - expense
}

function buildCashBalanceSummary({ accounts = [], entries = [], ledgers = [], monthKey }) {
  const currentRange = getMonthRangeFromKey(monthKey)
  const previousMonthKey = shiftMonthKey(monthKey, -1)
  const cashAccounts = (accounts || [])
    .filter((account) => !isArchivedAccount(account))
    .filter((account) => CASH_ACCOUNT_TYPES.includes(account.account_type))

  const currentLedgerByAccount = new Map()
  const previousLedgerByAccount = new Map()

  for (const ledger of ledgers || []) {
    if (!ledger.cash_account_id) continue
    if (ledger.month_key === monthKey) currentLedgerByAccount.set(ledger.cash_account_id, ledger)
    if (ledger.month_key === previousMonthKey) previousLedgerByAccount.set(ledger.cash_account_id, ledger)
  }

  let cashWalletBalance = 0
  let spendableBalance = 0
  let reserveBalance = 0
  let businessBalance = 0
  let currentLedgerCount = 0
  let carryoverCount = 0

  for (const account of cashAccounts) {
    let balance = getNetForAccount(entries, account.id)

    if (account.account_type === 'cash') {
      const currentLedger = currentLedgerByAccount.get(account.id)
      const previousLedger = previousLedgerByAccount.get(account.id)

      if (currentLedger) {
        balance = getLedgerFinalBalance(currentLedger)
        currentLedgerCount += 1
      } else if (previousLedger) {
        balance = getLedgerFinalBalance(previousLedger) + getNetForAccount(entries, account.id, currentRange)
        carryoverCount += 1
      }

      cashWalletBalance += balance
    }

    if (account.account_type === 'cash' || account.account_type === 'checking') {
      spendableBalance += balance
    } else if (account.account_type === 'savings') {
      reserveBalance += balance
    } else if (account.account_type === 'business') {
      businessBalance += balance
    }
  }

  const sourceLabel =
    currentLedgerCount > 0
      ? 'Current Cash Ledger snapshot'
      : carryoverCount > 0
        ? 'Previous ledger + current month movement'
        : 'Cashflow fallback · no ledger yet'

  return {
    cashWalletBalance,
    spendableBalance,
    reserveBalance,
    businessBalance,
    sourceLabel
  }
}

export default function CashflowPage() {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
  const [balanceEntries, setBalanceEntries] = useState([])
  const [cashWalletLedgers, setCashWalletLedgers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [viewMode, setViewMode] = useState(VIEW_MODES.CURRENT_MONTH)

  const { startDate, endDate } = getCurrentMonthDateRange()

  const [formData, setFormData] = useState({
    account_id: '',
    entry_date: new Date().toISOString().split('T')[0],
    type: 'expense',
    amount: '',
    category_id: '',
    category: '',
    description: ''
  })

  const categoryOptions = useMemo(
    () => getCategoryOptionsByType(categories, formData.type),
    [categories, formData.type]
  )

  useEffect(() => {
    loadCashflowData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  const loadCashflowData = async () => {
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

      const categoryData = await ensureDefaultCashflowCategories(supabase, user.id)

      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (accountError) {
        throw accountError
      }

      let query = supabase
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
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (viewMode === VIEW_MODES.CURRENT_MONTH) {
        query = query.gte('entry_date', startDate).lt('entry_date', endDate)
      }

      if (viewMode === VIEW_MODES.UNASSIGNED) {
        query = query.is('account_id', null)
      }

      const { data: entryData, error: entryError } = await query

      if (entryError) {
        throw entryError
      }

      const { data: balanceEntryData, error: balanceEntryError } = await supabase
        .from('cashflow_entries')
        .select(`
          id,
          account_id,
          entry_date,
          type,
          amount
        `)
        .eq('user_id', user.id)

      if (balanceEntryError) {
        throw balanceEntryError
      }

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
        console.warn('Cash Wallet Ledger unavailable on Cashflow page:', ledgerError.message)
      }

      setCategories(categoryData)
      setAccounts(accountData || [])
      setEntries(entryData || [])
      setBalanceEntries(balanceEntryData || [])
      setCashWalletLedgers(ledgerError ? [] : ledgerData || [])
    } catch (error) {
      console.error(error)
      setMessage(
        error.message ||
          'Failed to load cashflow data. If this happened after Bài 38.1B-mini, make sure the SQL migration was run first.'
      )
    }

    setLoading(false)
  }

  const resetForm = () => {
    setFormData({
      account_id: '',
      entry_date: new Date().toISOString().split('T')[0],
      type: 'expense',
      amount: '',
      category_id: '',
      category: '',
      description: ''
    })
    setEditingId(null)
  }

  const handleChange = (e) => {
    const { name, value } = e.target

    setFormData((prev) => {
      if (name === 'type') {
        return {
          ...prev,
          type: value,
          category_id: '',
          category: ''
        }
      }

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

  const handleViewModeChange = (nextViewMode) => {
    setViewMode(nextViewMode)
    setMessage('')
  }

  const handleAddOrUpdateEntry = async (e) => {
    e.preventDefault()
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

      if (!formData.entry_date) {
        throw new Error('Entry date is required')
      }

      if (!formData.type) {
        throw new Error('Entry type is required')
      }

      if (!formData.amount) {
        throw new Error('Amount is required')
      }

      const amountValue = Number(formData.amount)

      if (Number.isNaN(amountValue) || amountValue < 0) {
        throw new Error('Amount must be a valid positive number')
      }

      const categoryPayload = buildCategoryPayload({
        categories,
        categoryId: formData.category_id,
        customCategory: formData.category
      })

      const payload = {
        account_id: formData.account_id || null,
        entry_date: formData.entry_date,
        type: formData.type,
        amount: amountValue,
        category_id: categoryPayload.category_id,
        category: categoryPayload.category,
        description: formData.description.trim() || null
      }

      if (editingId) {
        const { error } = await supabase
          .from('cashflow_entries')
          .update(payload)
          .eq('id', editingId)
          .eq('user_id', user.id)

        if (error) {
          throw error
        }

        setMessage('Cashflow entry updated successfully')
      } else {
        const { error } = await supabase.from('cashflow_entries').insert({
          user_id: user.id,
          ...payload
        })

        if (error) {
          throw error
        }

        setMessage('Cashflow entry added successfully')
      }

      resetForm()
      await loadCashflowData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to save cashflow entry')
    }

    setSaving(false)
  }

  const handleEdit = (entry) => {
    setEditingId(entry.id)
    setFormData({
      account_id: entry.account_id || '',
      entry_date: entry.entry_date,
      type: entry.type,
      amount: entry.amount,
      category_id: entry.category_id || '',
      category: entry.category || entry.cashflow_categories?.name || '',
      description: entry.description || ''
    })
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (entryId) => {
    const confirmed = window.confirm('Are you sure you want to delete this cashflow entry?')
    if (!confirmed) return

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
        .from('cashflow_entries')
        .delete()
        .eq('id', entryId)
        .eq('user_id', user.id)

      if (error) {
        throw error
      }

      if (editingId === entryId) {
        resetForm()
      }

      setMessage('Cashflow entry deleted successfully')
      await loadCashflowData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to delete cashflow entry')
    }
  }

  const summary = calculateCashflowSummary(entries)
  const cashBalanceSummary = buildCashBalanceSummary({
    accounts,
    entries: balanceEntries,
    ledgers: cashWalletLedgers,
    monthKey: startDate.slice(0, 7)
  })
  const expenseCategories = calculateCategorySummary(entries, 'expense')
  const incomeCategories = calculateCategorySummary(entries, 'income')

  const viewTitle =
    viewMode === VIEW_MODES.ALL_TIME
      ? 'Cashflow Entries (All Time)'
      : viewMode === VIEW_MODES.UNASSIGNED
        ? 'Cashflow Entries (Unassigned Only)'
        : 'Cashflow Entries (Current Month)'

  const viewDescription =
    viewMode === VIEW_MODES.ALL_TIME
      ? 'Showing every cashflow entry you have saved.'
      : viewMode === VIEW_MODES.UNASSIGNED
        ? 'Showing entries with no account selected.'
        : `Period: ${startDate} to ${endDate} (exclusive)`

  return (
    <div style={pageStyle}>
      <div style={headerRowStyle}>
        <div>
          <h1 style={{ marginBottom: '8px' }}>Cashflow</h1>
          <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
            Track income and expenses with database-backed categories plus transaction detail.
          </p>
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '8px' }}>
            {viewDescription}
          </div>
        </div>

        <button onClick={loadCashflowData} style={refreshButtonStyle}>
          Refresh Cashflow
        </button>
      </div>

      <div style={viewModeRowStyle}>
        <button
          type="button"
          onClick={() => handleViewModeChange(VIEW_MODES.CURRENT_MONTH)}
          style={viewMode === VIEW_MODES.CURRENT_MONTH ? activeViewButtonStyle : viewButtonStyle}
        >
          Current Month
        </button>
        <button
          type="button"
          onClick={() => handleViewModeChange(VIEW_MODES.ALL_TIME)}
          style={viewMode === VIEW_MODES.ALL_TIME ? activeViewButtonStyle : viewButtonStyle}
        >
          All Time
        </button>
        <button
          type="button"
          onClick={() => handleViewModeChange(VIEW_MODES.UNASSIGNED)}
          style={viewMode === VIEW_MODES.UNASSIGNED ? activeViewButtonStyle : viewButtonStyle}
        >
          Unassigned Only
        </button>
      </div>

      <div style={summaryGridStyle}>
        <div style={importantSummaryCardStyle}>
          <div style={summaryLabelStyle}>Cash Wallet Balance</div>
          <div
            style={{
              ...summaryValueStyle,
              color: cashBalanceSummary.cashWalletBalance >= 0 ? 'var(--success)' : 'var(--danger)'
            }}
          >
            ${formatMoney(cashBalanceSummary.cashWalletBalance)}
          </div>
          <div style={summarySubTextStyle}>{cashBalanceSummary.sourceLabel}</div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>
            {viewMode === VIEW_MODES.CURRENT_MONTH ? 'Income Movement' : 'Visible Income'}
          </div>
          <div style={{ ...summaryValueStyle, color: 'var(--success)' }}>
            ${formatMoney(summary.totalIncome)}
          </div>
          <div style={summarySubTextStyle}>Cashflow entries only</div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>
            {viewMode === VIEW_MODES.CURRENT_MONTH ? 'Expense Movement' : 'Visible Expenses'}
          </div>
          <div style={{ ...summaryValueStyle, color: 'var(--danger)' }}>
            ${formatMoney(summary.totalExpenses)}
          </div>
          <div style={summarySubTextStyle}>Cash out / payments posted</div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>
            {viewMode === VIEW_MODES.CURRENT_MONTH ? 'Net Movement' : 'Visible Net Movement'}
          </div>
          <div
            style={{
              ...summaryValueStyle,
              color: summary.netCashflow >= 0 ? 'var(--success)' : 'var(--danger)'
            }}
          >
            ${formatMoney(summary.netCashflow)}
          </div>
          <div style={summarySubTextStyle}>Income - expenses for this view</div>
        </div>
      </div>

      <div style={cashExplainerStyle}>
        <strong>Cashflow = movement.</strong> The first card shows your actual Cash Wallet balance for the selected month.
        Income, expenses, and net movement explain why the balance changed, but they are not the same as final cash on hand.
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={entriesFullWidthSectionStyle}>
          <div style={entriesCardStyle}>
            <div style={entriesHeaderStyle}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: '6px' }}>{viewTitle}</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                  {entries.length} visible entr{entries.length === 1 ? 'y' : 'ies'}
                </div>
              </div>
            </div>

            {loading ? (
              <p>Loading entries...</p>
            ) : entries.length === 0 ? (
              <p>No cashflow entries found for this view.</p>
            ) : (
              <div style={entriesScrollStyle}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Amount</th>
                      <th style={thStyle}>Category / Detail</th>
                      <th style={thStyle}>Account</th>
                      <th style={thStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id}>
                        <td style={tdStyle}>{entry.entry_date}</td>
                        <td
                          style={{
                            ...tdStyle,
                            color: entry.type === 'income' ? 'var(--success)' : 'var(--danger)'
                          }}
                        >
                          {entry.type}
                        </td>
                        <td style={tdStyle}>${formatMoney(entry.amount)}</td>
                        <td style={tdStyle}>
                          <div style={categoryCellStyle}>
                            <span>{getCategoryDisplayName(entry)}</span>
                            {!entry.category_id && (
                              <span style={legacyBadgeStyle}>legacy text</span>
                            )}
                          </div>
                          {entry.description && (
                            <div style={descriptionTextStyle}>{entry.description}</div>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {entry.accounts?.name || (
                            <span style={unassignedTextStyle}>Unassigned</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <div style={actionRowStyle}>
                            <button
                              type="button"
                              onClick={() => handleEdit(entry)}
                              style={editButtonStyle}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(entry.id)}
                              style={deleteButtonStyle}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

      </div>

      <div style={mainGridStyle}>
        <div style={cardStyle}>
          <div style={formHeaderStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 0 }}>
              {editingId ? 'Edit Cashflow Entry' : 'Add Cashflow Entry'}
            </h2>

            {editingId && (
              <button type="button" onClick={resetForm} style={secondaryButtonStyle}>
                Cancel Edit
              </button>
            )}
          </div>

          <form onSubmit={handleAddOrUpdateEntry}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Account</label>
              <select
                name="account_id"
                value={formData.account_id}
                onChange={handleChange}
                style={inputStyle}
              >
                <option value="">No account selected</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.account_type})
                  </option>
                ))}
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Date</label>
              <input
                type="date"
                name="entry_date"
                value={formData.entry_date}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Type</label>
              <select
                name="type"
                value={formData.type}
                onChange={handleChange}
                style={inputStyle}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Amount</label>
              <input
                type="number"
                step="0.01"
                name="amount"
                value={formData.amount}
                onChange={handleChange}
                placeholder="Example: 120.50"
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Category</label>
              <select
                name="category_id"
                value={formData.category_id}
                onChange={handleChange}
                style={inputStyle}
              >
                <option value="">Custom / legacy category</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.group_name ? `${category.group_name} · ` : ''}
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            {!formData.category_id && (
              <div style={fieldStyle}>
                <label style={labelStyle}>Custom Category</label>
                <input
                  type="text"
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  placeholder="Example: Groceries, Salary, Rent"
                  style={inputStyle}
                />
              </div>
            )}

            <div style={fieldStyle}>
              <label style={labelStyle}>Description / Detail</label>
              <input
                type="text"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Example: Bill: ChatGPT, Bill: Tmobile, Costco groceries"
                style={inputStyle}
              />
              <div style={helperTextStyle}>
                Category is for grouping. Description is for the exact bill, vendor, or transaction detail.
              </div>
            </div>

            <button type="submit" disabled={saving} style={buttonStyle}>
              {saving ? 'Saving...' : editingId ? 'Update Entry' : 'Add Entry'}
            </button>
          </form>
        </div>

        <div style={rightStackStyle}>
          <div style={twoColumnGridStyle}>
            <div style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>Expense by Category</h2>

              {expenseCategories.length === 0 ? (
                <p>No expense categories yet.</p>
              ) : (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {expenseCategories.map((item) => (
                    <div key={item.category} style={categoryRowStyle}>
                      <span>{item.category}</span>
                      <strong style={{ color: 'var(--danger)' }}>
                        ${formatMoney(item.total)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>Income by Category</h2>

              {incomeCategories.length === 0 ? (
                <p>No income categories yet.</p>
              ) : (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {incomeCategories.map((item) => (
                    <div key={item.category} style={categoryRowStyle}>
                      <span>{item.category}</span>
                      <strong style={{ color: 'var(--success)' }}>
                        ${formatMoney(item.total)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const pageStyle = {
  color: 'var(--text-main)'
}

const headerRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  marginBottom: '16px',
  flexWrap: 'wrap'
}

const refreshButtonStyle = {
  padding: '10px 14px',
  border: '1px solid var(--accent)',
  borderRadius: '10px',
  background: 'var(--accent)',
  color: '#ffffff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontWeight: 800,
  boxShadow: 'var(--shadow-soft)'
}

const viewModeRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '10px',
  marginBottom: '16px'
}

const viewButtonStyle = {
  padding: '10px 14px',
  border: '1px solid var(--border-main)',
  borderRadius: '10px',
  background: 'var(--bg-card)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontWeight: 700
}

const activeViewButtonStyle = {
  ...viewButtonStyle,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: '#ffffff',
  boxShadow: 'var(--shadow-soft)'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: '16px'
}

const summaryCardStyle = {
  background: 'var(--bg-card)',
  padding: '20px',
  borderRadius: '14px',
  minWidth: 0,
  border: '1px solid var(--border-main)',
  boxShadow: 'var(--shadow-card)'
}

const importantSummaryCardStyle = {
  ...summaryCardStyle,
  border: '1px solid var(--accent)',
  background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-soft))'
}

const summarySubTextStyle = {
  marginTop: '8px',
  color: 'var(--text-muted)',
  fontSize: '12px',
  lineHeight: 1.4
}

const cashExplainerStyle = {
  marginTop: '12px',
  padding: '12px 14px',
  borderRadius: '12px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-muted)',
  fontSize: '13px',
  lineHeight: 1.45
}

const summaryLabelStyle = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  marginBottom: '10px'
}

const summaryValueStyle = {
  fontSize: '26px',
  fontWeight: 800,
  color: 'var(--text-main)'
}

const messageStyle = {
  marginTop: '16px',
  padding: '12px',
  borderRadius: '10px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-main)'
}

const entriesFullWidthSectionStyle = {
  marginTop: '24px'
}

const mainGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)',
  gap: '24px',
  marginTop: '24px',
  alignItems: 'start'
}

const cardStyle = {
  background: 'var(--bg-card)',
  padding: '20px',
  borderRadius: '14px',
  minWidth: 0,
  border: '1px solid var(--border-main)',
  boxShadow: 'var(--shadow-card)',
  color: 'var(--text-main)'
}

const rightStackStyle = {
  display: 'grid',
  gap: '24px',
  minWidth: 0,
  alignSelf: 'start'
}

const entriesCardStyle = {
  ...cardStyle,
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 'min(620px, calc(100vh - 220px))',
  overflow: 'hidden'
}

const entriesScrollStyle = {
  width: '100%',
  maxWidth: '100%',
  overflowX: 'auto',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  paddingRight: '4px',
  minHeight: 0,
  flex: 1
}

const formHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '16px'
}

const entriesHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '16px'
}

const fieldStyle = {
  marginBottom: '16px'
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  color: 'var(--text-main)',
  fontWeight: 750
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: '10px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  outline: 'none'
}

const helperTextStyle = {
  color: 'var(--text-muted)',
  fontSize: '12px',
  marginTop: '7px',
  lineHeight: 1.45
}

const buttonStyle = {
  width: '100%',
  padding: '12px',
  border: '1px solid var(--accent)',
  borderRadius: '10px',
  background: 'var(--accent)',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 850,
  boxShadow: 'var(--shadow-soft)'
}

const secondaryButtonStyle = {
  padding: '10px 12px',
  border: '1px solid var(--border-main)',
  borderRadius: '10px',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  cursor: 'pointer',
  fontWeight: 800
}

const tableStyle = {
  width: '100%',
  minWidth: '760px',
  borderCollapse: 'collapse'
}

const thStyle = {
  textAlign: 'left',
  padding: '12px',
  borderBottom: '1px solid var(--border-main)',
  color: 'var(--text-muted)',
  fontWeight: 800,
  fontSize: '14px',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--bg-card)'
}

const tdStyle = {
  padding: '12px',
  borderBottom: '1px solid var(--border-soft)',
  color: 'var(--text-main)',
  fontSize: '14px',
  whiteSpace: 'nowrap',
  verticalAlign: 'top'
}

const twoColumnGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '24px'
}

const categoryRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  padding: '12px',
  background: 'var(--bg-card-soft)',
  borderRadius: '10px',
  border: '1px solid var(--border-main)',
  color: 'var(--text-main)'
}

const categoryCellStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px'
}

const descriptionTextStyle = {
  marginTop: '5px',
  color: 'var(--accent)',
  fontSize: '12px',
  fontWeight: 650
}

const legacyBadgeStyle = {
  display: 'inline-block',
  padding: '4px 7px',
  borderRadius: '999px',
  background: 'var(--warning-soft)',
  color: 'var(--warning)',
  border: '1px solid var(--warning)',
  fontSize: '11px',
  fontWeight: 700
}

const actionRowStyle = {
  display: 'flex',
  gap: '8px'
}

const editButtonStyle = {
  padding: '8px 10px',
  border: '1px solid var(--accent)',
  borderRadius: '8px',
  background: 'var(--accent)',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 800
}

const deleteButtonStyle = {
  padding: '8px 10px',
  border: '1px solid var(--danger)',
  borderRadius: '8px',
  background: 'var(--danger)',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 800
}

const unassignedTextStyle = {
  color: 'var(--warning)',
  fontWeight: 700
}