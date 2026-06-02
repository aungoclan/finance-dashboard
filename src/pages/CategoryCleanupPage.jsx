import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ensureDefaultCashflowCategories, findCategoryById } from '../lib/cashflowCategories'
import {
  formatMoney,
  getCategoryOptionsByTypeForCleanup,
  getCleanDescriptionForCashflow,
  isLegacyBill,
  isLegacyBudgetRow,
  isLegacyCashflowEntry,
  suggestCategoryForBill,
  suggestCategoryForBudget,
  suggestCategoryForCashflow
} from '../lib/categoryCleanup'

const TABS = {
  CASHFLOW: 'cashflow',
  BUDGETS: 'budgets',
  BILLS: 'bills'
}

export default function CategoryCleanupPage() {
  const [activeTab, setActiveTab] = useState(TABS.CASHFLOW)
  const [categories, setCategories] = useState([])
  const [cashflowEntries, setCashflowEntries] = useState([])
  const [budgets, setBudgets] = useState([])
  const [bills, setBills] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadCleanupData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadCleanupData() {
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

      const [cashflowResult, budgetResult, billResult] = await Promise.all([
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
          .limit(1000),
        supabase
          .from('budgets')
          .select(`
            id,
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
          .limit(1000),
        supabase
          .from('bills')
          .select(`
            id,
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
          .order('due_day', { ascending: true })
      ])

      if (cashflowResult.error) throw cashflowResult.error
      if (budgetResult.error) throw budgetResult.error
      if (billResult.error) throw billResult.error

      const legacyCashflow = (cashflowResult.data || []).filter(isLegacyCashflowEntry)
      const legacyBudgets = (budgetResult.data || []).filter(isLegacyBudgetRow)
      const legacyBills = (billResult.data || []).filter(isLegacyBill)

      setCategories(categoryData)
      setCashflowEntries(legacyCashflow)
      setBudgets(legacyBudgets)
      setBills(legacyBills)

      setDrafts(buildInitialDrafts({
        categories: categoryData,
        cashflowEntries: legacyCashflow,
        budgets: legacyBudgets,
        bills: legacyBills
      }))
    } catch (error) {
      console.error('loadCleanupData error:', error)
      setMessage(
        error.message ||
          'Failed to load category cleanup data. Make sure Bài 38.1 SQL migration has been run.'
      )
    } finally {
      setLoading(false)
    }
  }

  function buildInitialDrafts({ categories, cashflowEntries, budgets, bills }) {
    const nextDrafts = {}

    for (const entry of cashflowEntries) {
      const suggested = suggestCategoryForCashflow(entry, categories)
      nextDrafts[`cashflow:${entry.id}`] = {
        category_id: suggested?.id || '',
        description: getCleanDescriptionForCashflow(entry)
      }
    }

    for (const row of budgets) {
      const suggested = suggestCategoryForBudget(row, categories)
      nextDrafts[`budget:${row.id}`] = {
        category_id: suggested?.id || ''
      }
    }

    for (const bill of bills) {
      const suggested = suggestCategoryForBill(bill, categories)
      nextDrafts[`bill:${bill.id}`] = {
        category_id: suggested?.id || ''
      }
    }

    return nextDrafts
  }

  function updateDraft(key, field, value) {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [field]: value
      }
    }))
  }

  async function updateCashflowEntry(entry) {
    const draftKey = `cashflow:${entry.id}`
    const draft = drafts[draftKey] || {}
    const selectedCategory = findCategoryById(categories, draft.category_id)

    if (!selectedCategory) {
      setMessage('Please choose a category before applying this fix.')
      return
    }

    setSavingId(draftKey)
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
          category_id: selectedCategory.id,
          category: selectedCategory.name,
          description: String(draft.description || '').trim() || null
        })
        .eq('id', entry.id)
        .eq('user_id', user.id)

      if (error) throw error

      setMessage(`Updated cashflow entry: ${entry.entry_date} · $${formatMoney(entry.amount)}`)
      await loadCleanupData()
    } catch (error) {
      console.error('updateCashflowEntry error:', error)
      setMessage(error.message || 'Failed to update cashflow entry')
    } finally {
      setSavingId('')
    }
  }

  async function updateBudgetRow(row) {
    const draftKey = `budget:${row.id}`
    const draft = drafts[draftKey] || {}
    const selectedCategory = findCategoryById(categories, draft.category_id)

    if (!selectedCategory) {
      setMessage('Please choose a category before applying this fix.')
      return
    }

    setSavingId(draftKey)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const { error } = await supabase
        .from('budgets')
        .update({
          category_id: selectedCategory.id,
          category: selectedCategory.name
        })
        .eq('id', row.id)
        .eq('user_id', user.id)

      if (error) throw error

      setMessage(`Updated budget row: ${row.month}/${row.year} · ${selectedCategory.name}`)
      await loadCleanupData()
    } catch (error) {
      console.error('updateBudgetRow error:', error)
      setMessage(error.message || 'Failed to update budget row')
    } finally {
      setSavingId('')
    }
  }

  async function updateBillRow(bill) {
    const draftKey = `bill:${bill.id}`
    const draft = drafts[draftKey] || {}
    const selectedCategory = findCategoryById(categories, draft.category_id)

    if (!selectedCategory) {
      setMessage('Please choose a category before applying this fix.')
      return
    }

    setSavingId(draftKey)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const { error } = await supabase
        .from('bills')
        .update({
          category_id: selectedCategory.id,
          category: selectedCategory.name
        })
        .eq('id', bill.id)
        .eq('user_id', user.id)

      if (error) throw error

      setMessage(`Updated bill: ${bill.name} → ${selectedCategory.name}`)
      await loadCleanupData()
    } catch (error) {
      console.error('updateBillRow error:', error)
      setMessage(error.message || 'Failed to update bill')
    } finally {
      setSavingId('')
    }
  }

  async function applySuggestedCashflowFixes() {
    const readyRows = cashflowEntries.filter((entry) => {
      const draft = drafts[`cashflow:${entry.id}`]
      return Boolean(draft?.category_id)
    })

    if (readyRows.length === 0) {
      setMessage('No suggested cashflow fixes available.')
      return
    }

    const confirmed = window.confirm(
      `Apply suggested category fixes to ${readyRows.length} legacy cashflow entr${readyRows.length === 1 ? 'y' : 'ies'}?`
    )

    if (!confirmed) return

    setBulkSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      for (const entry of readyRows) {
        const draft = drafts[`cashflow:${entry.id}`] || {}
        const selectedCategory = findCategoryById(categories, draft.category_id)

        if (!selectedCategory) continue

        const { error } = await supabase
          .from('cashflow_entries')
          .update({
            category_id: selectedCategory.id,
            category: selectedCategory.name,
            description: String(draft.description || '').trim() || null
          })
          .eq('id', entry.id)
          .eq('user_id', user.id)

        if (error) throw error
      }

      setMessage(`Applied ${readyRows.length} cashflow cleanup fix${readyRows.length === 1 ? '' : 'es'}.`)
      await loadCleanupData()
    } catch (error) {
      console.error('applySuggestedCashflowFixes error:', error)
      setMessage(error.message || 'Failed to apply suggested cashflow fixes')
    } finally {
      setBulkSaving(false)
    }
  }

  const cashflowCategoryOptions = useMemo(() => {
    return {
      income: getCategoryOptionsByTypeForCleanup(categories, 'income'),
      expense: getCategoryOptionsByTypeForCleanup(categories, 'expense')
    }
  }, [categories])

  const expenseCategoryOptions = useMemo(
    () => getCategoryOptionsByTypeForCleanup(categories, 'expense'),
    [categories]
  )

  const activeRows = {
    cashflow: cashflowEntries,
    budgets,
    bills
  }

  const totalLegacyCount = cashflowEntries.length + budgets.length + bills.length

  return (
    <div>
      <div style={pageHeaderStyle}>
        <div>
          <div style={eyebrowStyle}>Bài 38.1C · Category cleanup</div>
          <h1 style={titleStyle}>Category Cleanup</h1>
          <p style={subtitleStyle}>
            Clean legacy text categories and map them into database-backed categories without losing transaction details.
          </p>
        </div>

        <button type="button" onClick={loadCleanupData} style={refreshButtonStyle}>
          Refresh
        </button>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={summaryGridStyle}>
        <SummaryCard label="Legacy Cashflow" value={cashflowEntries.length} />
        <SummaryCard label="Legacy Budgets" value={budgets.length} />
        <SummaryCard label="Legacy Bills" value={bills.length} />
        <SummaryCard label="Total To Review" value={totalLegacyCount} tone={totalLegacyCount === 0 ? 'good' : 'warn'} />
      </div>

      <div style={guideCardStyle}>
        <strong>Recommended format:</strong>
        <span>
          Category should be the clean group, like <b>Subscriptions</b> or <b>Phone</b>. Description should keep the detail, like <b>Bill: ChatGPT</b> or <b>Bill: Tmobile</b>.
        </span>
      </div>

      <div style={tabRowStyle}>
        <TabButton
          active={activeTab === TABS.CASHFLOW}
          onClick={() => setActiveTab(TABS.CASHFLOW)}
          label={`Cashflow (${cashflowEntries.length})`}
        />
        <TabButton
          active={activeTab === TABS.BUDGETS}
          onClick={() => setActiveTab(TABS.BUDGETS)}
          label={`Budgets (${budgets.length})`}
        />
        <TabButton
          active={activeTab === TABS.BILLS}
          onClick={() => setActiveTab(TABS.BILLS)}
          label={`Bills (${bills.length})`}
        />
      </div>

      {loading ? (
        <div style={emptyStyle}>Loading category cleanup data...</div>
      ) : totalLegacyCount === 0 ? (
        <div style={successBoxStyle}>
          Nice. No legacy category rows found. Your category system is clean for now.
        </div>
      ) : (
        <div style={cardStyle}>
          {activeTab === TABS.CASHFLOW && (
            <div>
              <div style={sectionHeaderStyle}>
                <div>
                  <h2 style={sectionTitleStyle}>Legacy Cashflow Entries</h2>
                  <p style={sectionSubtitleStyle}>
                    These rows either have no category_id or still use bill-like text as category.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={applySuggestedCashflowFixes}
                  disabled={bulkSaving || cashflowEntries.length === 0}
                  style={cashflowEntries.length === 0 ? disabledButtonStyle : greenButtonStyle}
                >
                  {bulkSaving ? 'Applying...' : 'Apply Suggested Cashflow Fixes'}
                </button>
              </div>

              {cashflowEntries.length === 0 ? (
                <div style={successBoxStyle}>No legacy cashflow entries found.</div>
              ) : (
                <div style={rowListStyle}>
                  {cashflowEntries.map((entry) => {
                    const key = `cashflow:${entry.id}`
                    const draft = drafts[key] || {}
                    const options =
                      entry.type === 'income'
                        ? cashflowCategoryOptions.income
                        : cashflowCategoryOptions.expense

                    return (
                      <div key={entry.id} style={cleanupRowStyle}>
                        <div style={recordInfoStyle}>
                          <div style={recordTitleStyle}>
                            {entry.entry_date} · {entry.type} · ${formatMoney(entry.amount)}
                          </div>
                          <div style={legacyTextStyle}>
                            Current category: <b>{entry.category || 'Uncategorized'}</b>
                          </div>
                          {entry.description && (
                            <div style={detailTextStyle}>Current detail: {entry.description}</div>
                          )}
                          <div style={mutedTextStyle}>
                            Account: {entry.account?.name || 'Unassigned'}
                          </div>
                        </div>

                        <div style={fixGridStyle}>
                          <div>
                            <label style={labelStyle}>New Category</label>
                            <select
                              value={draft.category_id || ''}
                              onChange={(event) => updateDraft(key, 'category_id', event.target.value)}
                              style={inputStyle}
                            >
                              <option value="">Choose category...</option>
                              {options.map((category) => (
                                <option key={category.id} value={category.id}>
                                  {category.group_name ? `${category.group_name} · ` : ''}
                                  {category.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label style={labelStyle}>Description / Detail</label>
                            <input
                              value={draft.description || ''}
                              onChange={(event) => updateDraft(key, 'description', event.target.value)}
                              placeholder="Example: Bill: ChatGPT"
                              style={inputStyle}
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => updateCashflowEntry(entry)}
                            disabled={savingId === key}
                            style={primaryButtonStyle}
                          >
                            {savingId === key ? 'Saving...' : 'Apply Fix'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === TABS.BUDGETS && (
            <div>
              <div style={sectionHeaderStyle}>
                <div>
                  <h2 style={sectionTitleStyle}>Legacy Budget Rows</h2>
                  <p style={sectionSubtitleStyle}>
                    These budget rows still use text category only. Mapping them helps Budget vs Actual match more reliably.
                  </p>
                </div>
              </div>

              {budgets.length === 0 ? (
                <div style={successBoxStyle}>No legacy budget rows found.</div>
              ) : (
                <div style={rowListStyle}>
                  {budgets.map((row) => {
                    const key = `budget:${row.id}`
                    const draft = drafts[key] || {}

                    return (
                      <div key={row.id} style={cleanupRowStyle}>
                        <div style={recordInfoStyle}>
                          <div style={recordTitleStyle}>
                            {row.month}/{row.year} · ${formatMoney(row.planned_amount)}
                          </div>
                          <div style={legacyTextStyle}>
                            Current category: <b>{row.category || 'Uncategorized'}</b>
                          </div>
                        </div>

                        <div style={budgetFixGridStyle}>
                          <div>
                            <label style={labelStyle}>New Category</label>
                            <select
                              value={draft.category_id || ''}
                              onChange={(event) => updateDraft(key, 'category_id', event.target.value)}
                              style={inputStyle}
                            >
                              <option value="">Choose category...</option>
                              {expenseCategoryOptions.map((category) => (
                                <option key={category.id} value={category.id}>
                                  {category.group_name ? `${category.group_name} · ` : ''}
                                  {category.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <button
                            type="button"
                            onClick={() => updateBudgetRow(row)}
                            disabled={savingId === key}
                            style={primaryButtonStyle}
                          >
                            {savingId === key ? 'Saving...' : 'Apply Fix'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === TABS.BILLS && (
            <div>
              <div style={sectionHeaderStyle}>
                <div>
                  <h2 style={sectionTitleStyle}>Legacy Bills</h2>
                  <p style={sectionSubtitleStyle}>
                    These bill templates still use text category only. Mapping them keeps future Bill → Cashflow entries clean.
                  </p>
                </div>
              </div>

              {bills.length === 0 ? (
                <div style={successBoxStyle}>No legacy bills found.</div>
              ) : (
                <div style={rowListStyle}>
                  {bills.map((bill) => {
                    const key = `bill:${bill.id}`
                    const draft = drafts[key] || {}

                    return (
                      <div key={bill.id} style={cleanupRowStyle}>
                        <div style={recordInfoStyle}>
                          <div style={recordTitleStyle}>
                            {bill.name} · ${formatMoney(bill.amount)}
                          </div>
                          <div style={legacyTextStyle}>
                            Current category: <b>{bill.category || 'Uncategorized'}</b>
                          </div>
                          <div style={mutedTextStyle}>
                            Due day {bill.due_day} · {bill.frequency} · {bill.status}
                          </div>
                          <div style={detailTextStyle}>Future cashflow detail: Bill: {bill.name}</div>
                        </div>

                        <div style={budgetFixGridStyle}>
                          <div>
                            <label style={labelStyle}>New Category</label>
                            <select
                              value={draft.category_id || ''}
                              onChange={(event) => updateDraft(key, 'category_id', event.target.value)}
                              style={inputStyle}
                            >
                              <option value="">Choose category...</option>
                              {expenseCategoryOptions.map((category) => (
                                <option key={category.id} value={category.id}>
                                  {category.group_name ? `${category.group_name} · ` : ''}
                                  {category.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <button
                            type="button"
                            onClick={() => updateBillRow(bill)}
                            disabled={savingId === key}
                            style={primaryButtonStyle}
                          >
                            {savingId === key ? 'Saving...' : 'Apply Fix'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, tone = 'default' }) {
  return (
    <div style={summaryCardStyle}>
      <div style={summaryLabelStyle}>{label}</div>
      <div
        style={{
          ...summaryValueStyle,
          color: tone === 'good' ? 'var(--success)' : tone === 'warn' ? 'var(--warning)' : 'var(--text-main)'
        }}
      >
        {value}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={active ? activeTabButtonStyle : tabButtonStyle}
    >
      {label}
    </button>
  )
}

const pageHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '20px',
  marginBottom: '20px'
}

const eyebrowStyle = {
  color: 'var(--accent-strong)',
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: '8px'
}

const titleStyle = {
  margin: 0,
  fontSize: '34px',
  letterSpacing: '-0.04em'
}

const subtitleStyle = {
  margin: '10px 0 0',
  maxWidth: '820px',
  color: 'var(--text-muted)',
  lineHeight: 1.6
}

const refreshButtonStyle = {
  padding: '11px 15px',
  border: 'none',
  borderRadius: '11px',
  background: 'var(--accent-strong)',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 850,
  whiteSpace: 'nowrap'
}

const messageStyle = {
  marginBottom: '18px',
  padding: '13px 14px',
  borderRadius: '13px',
  background: 'color-mix(in srgb, var(--accent-strong) 10%, transparent)',
  border: '1px solid var(--accent-strong)',
  color: 'var(--text-main)'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: '16px',
  marginBottom: '18px'
}

const summaryCardStyle = {
  padding: '18px',
  borderRadius: '16px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-main)'
}

const summaryLabelStyle = {
  color: 'var(--text-muted)',
  fontSize: '13px',
  marginBottom: '8px',
  fontWeight: 850
}

const summaryValueStyle = {
  fontSize: '28px',
  fontWeight: 950,
  letterSpacing: '-0.03em'
}

const guideCardStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  padding: '14px 16px',
  borderRadius: '15px',
  background: 'color-mix(in srgb, var(--success) 10%, transparent)',
  border: '1px solid var(--success)',
  color: 'var(--success)',
  marginBottom: '18px',
  lineHeight: 1.55
}

const tabRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '10px',
  marginBottom: '18px'
}

const tabButtonStyle = {
  padding: '11px 14px',
  borderRadius: '999px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  cursor: 'pointer',
  fontWeight: 850
}

const activeTabButtonStyle = {
  ...tabButtonStyle,
  background: 'var(--accent-strong)',
  border: '1px solid var(--accent-strong)',
  color: 'white'
}

const cardStyle = {
  padding: '20px',
  borderRadius: '18px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-main)',
  boxShadow: '0 18px 40px rgba(0, 0, 0, 0.16)'
}

const sectionHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '14px',
  marginBottom: '16px',
  flexWrap: 'wrap'
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

const rowListStyle = {
  display: 'grid',
  gap: '12px'
}

const cleanupRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 0.8fr) minmax(420px, 1.2fr)',
  gap: '16px',
  padding: '15px',
  borderRadius: '15px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)'
}

const recordInfoStyle = {
  minWidth: 0
}

const recordTitleStyle = {
  color: 'var(--text-main)',
  fontWeight: 900,
  marginBottom: '8px'
}

const legacyTextStyle = {
  color: 'var(--warning)',
  fontSize: '13px',
  lineHeight: 1.5
}

const detailTextStyle = {
  color: 'var(--accent-strong)',
  fontSize: '13px',
  lineHeight: 1.5,
  marginTop: '4px'
}

const mutedTextStyle = {
  color: 'var(--text-muted)',
  fontSize: '12px',
  lineHeight: 1.5,
  marginTop: '4px'
}

const fixGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(180px, 1fr) minmax(200px, 1fr) auto',
  gap: '12px',
  alignItems: 'end'
}

const budgetFixGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(240px, 1fr) auto',
  gap: '12px',
  alignItems: 'end'
}

const labelStyle = {
  display: 'block',
  marginBottom: '7px',
  color: 'var(--text-main)',
  fontSize: '12px',
  fontWeight: 850
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 11px',
  borderRadius: '10px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  outline: 'none'
}

const primaryButtonStyle = {
  padding: '10px 13px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--accent-strong)',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 850,
  whiteSpace: 'nowrap'
}

const greenButtonStyle = {
  ...primaryButtonStyle,
  background: 'var(--success)'
}

const disabledButtonStyle = {
  ...primaryButtonStyle,
  background: 'var(--bg-card-soft)',
  color: 'var(--text-muted)',
  cursor: 'not-allowed'
}

const emptyStyle = {
  padding: '20px',
  borderRadius: '15px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-muted)'
}

const successBoxStyle = {
  ...emptyStyle,
  color: 'var(--success)',
  background: 'color-mix(in srgb, var(--success) 10%, transparent)',
  border: '1px solid var(--success)'
}
