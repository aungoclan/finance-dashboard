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

export default function CashflowPage() {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
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

      setCategories(categoryData)
      setAccounts(accountData || [])
      setEntries(entryData || [])
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
    <div>
      <div style={headerRowStyle}>
        <div>
          <h1 style={{ marginBottom: '8px' }}>Cashflow</h1>
          <p style={{ marginTop: 0, color: '#d1d5db' }}>
            Track income and expenses with database-backed categories plus transaction detail.
          </p>
          <div style={{ color: '#9ca3af', fontSize: '14px', marginTop: '8px' }}>
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
        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>
            {viewMode === VIEW_MODES.CURRENT_MONTH ? 'Monthly Income' : 'Visible Income'}
          </div>
          <div style={{ ...summaryValueStyle, color: '#22c55e' }}>
            ${formatMoney(summary.totalIncome)}
          </div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>
            {viewMode === VIEW_MODES.CURRENT_MONTH ? 'Monthly Expenses' : 'Visible Expenses'}
          </div>
          <div style={{ ...summaryValueStyle, color: '#ef4444' }}>
            ${formatMoney(summary.totalExpenses)}
          </div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>
            {viewMode === VIEW_MODES.CURRENT_MONTH ? 'Net Cashflow' : 'Visible Net Cashflow'}
          </div>
          <div
            style={{
              ...summaryValueStyle,
              color: summary.netCashflow >= 0 ? '#22c55e' : '#ef4444'
            }}
          >
            ${formatMoney(summary.netCashflow)}
          </div>
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={entriesFullWidthSectionStyle}>
          <div style={entriesCardStyle}>
            <div style={entriesHeaderStyle}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: '6px' }}>{viewTitle}</h2>
                <div style={{ color: '#9ca3af', fontSize: '14px' }}>
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
                            color: entry.type === 'income' ? '#22c55e' : '#ef4444'
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
                      <strong style={{ color: '#ef4444' }}>
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
                      <strong style={{ color: '#22c55e' }}>
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

const headerRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  marginBottom: '16px'
}

const refreshButtonStyle = {
  padding: '10px 14px',
  border: 'none',
  borderRadius: '10px',
  background: '#2563eb',
  color: 'white',
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}

const viewModeRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '10px',
  marginBottom: '16px'
}

const viewButtonStyle = {
  padding: '10px 14px',
  border: '1px solid #374151',
  borderRadius: '10px',
  background: '#111827',
  color: '#d1d5db',
  cursor: 'pointer'
}

const activeViewButtonStyle = {
  ...viewButtonStyle,
  border: '1px solid #60a5fa',
  background: '#1d4ed8',
  color: 'white'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '16px'
}

const summaryCardStyle = {
  background: '#1f2937',
  padding: '20px',
  borderRadius: '12px',
  minWidth: 0
}

const summaryLabelStyle = {
  color: '#d1d5db',
  fontSize: '14px',
  marginBottom: '10px'
}

const summaryValueStyle = {
  fontSize: '26px',
  fontWeight: 700,
  color: 'white'
}

const messageStyle = {
  marginTop: '16px',
  padding: '12px',
  borderRadius: '10px',
  background: '#1f2937',
  border: '1px solid #374151',
  color: '#f3f4f6'
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
  background: '#1f2937',
  padding: '20px',
  borderRadius: '12px',
  minWidth: 0
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
  marginBottom: '8px'
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid #4b5563',
  background: '#111827',
  color: 'white'
}

const helperTextStyle = {
  color: '#9ca3af',
  fontSize: '12px',
  marginTop: '7px',
  lineHeight: 1.45
}

const buttonStyle = {
  width: '100%',
  padding: '12px',
  border: 'none',
  borderRadius: '8px',
  background: '#2563eb',
  color: 'white',
  cursor: 'pointer'
}

const secondaryButtonStyle = {
  padding: '10px 12px',
  border: 'none',
  borderRadius: '8px',
  background: '#4b5563',
  color: 'white',
  cursor: 'pointer'
}

const tableStyle = {
  width: '100%',
  minWidth: '760px',
  borderCollapse: 'collapse'
}

const thStyle = {
  textAlign: 'left',
  padding: '12px',
  borderBottom: '1px solid #374151',
  color: '#d1d5db',
  fontWeight: 600,
  fontSize: '14px',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: '#1f2937'
}

const tdStyle = {
  padding: '12px',
  borderBottom: '1px solid #374151',
  color: 'white',
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
  background: '#111827',
  borderRadius: '10px',
  border: '1px solid #374151'
}

const categoryCellStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px'
}

const descriptionTextStyle = {
  marginTop: '5px',
  color: '#93c5fd',
  fontSize: '12px',
  fontWeight: 650
}

const legacyBadgeStyle = {
  display: 'inline-block',
  padding: '4px 7px',
  borderRadius: '999px',
  background: 'rgba(245, 158, 11, 0.14)',
  color: '#fde68a',
  border: '1px solid rgba(245, 158, 11, 0.32)',
  fontSize: '11px',
  fontWeight: 700
}

const actionRowStyle = {
  display: 'flex',
  gap: '8px'
}

const editButtonStyle = {
  padding: '8px 10px',
  border: 'none',
  borderRadius: '8px',
  background: '#2563eb',
  color: 'white',
  cursor: 'pointer'
}

const deleteButtonStyle = {
  padding: '8px 10px',
  border: 'none',
  borderRadius: '8px',
  background: '#dc2626',
  color: 'white',
  cursor: 'pointer'
}

const unassignedTextStyle = {
  color: '#fbbf24',
  fontWeight: 700
}