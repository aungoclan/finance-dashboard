import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_APP_SETTINGS, loadUserSettings } from '../lib/appSettings'
import {
  buildCarryForwardRows,
  calculateBudgetSummary,
  formatMoney,
  formatMonthKey,
  formatPercent,
  getCurrentMonthKey,
  getMonthDateRange,
  getMonthLabel,
  parseMonthKey,
  shiftMonthKey,
  summarizeCarryForwardRows
} from '../lib/budget'
import {
  buildCategoryPayload,
  ensureDefaultCashflowCategories,
  findCategoryById,
  getCategoryDisplayName,
  getCategoryOptionsByType
} from '../lib/cashflowCategories'

const CARRY_MODES = {
  both: {
    label: 'Surplus + Overspend',
    description: 'Carry unused budget forward and subtract overspending from the next month.'
  },
  surplus_only: {
    label: 'Surplus Only',
    description: 'Only carry unused budget forward. Overspending will not reduce the next month.'
  },
  overspend_only: {
    label: 'Overspend Only',
    description: 'Only subtract overspending from the next month. Unused money will not carry forward.'
  },
  off: {
    label: 'Review Only',
    description: 'Show previous month results but do not suggest carry-forward changes.'
  }
}

export default function BudgetPage() {
  const [selectedMonthKey, setSelectedMonthKey] = useState(getCurrentMonthKey())
  const [budgets, setBudgets] = useState([])
  const [previousBudgets, setPreviousBudgets] = useState([])
  const [cashflowEntries, setCashflowEntries] = useState([])
  const [previousCashflowEntries, setPreviousCashflowEntries] = useState([])
  const [categories, setCategories] = useState([])
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS)
  const [carryMode, setCarryMode] = useState('both')
  const [minCarryAmount, setMinCarryAmount] = useState('1')
  const [selectedCarryKeys, setSelectedCarryKeys] = useState(new Set())

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [applyingCarry, setApplyingCarry] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState(null)

  const selectedRange = useMemo(() => getMonthDateRange(selectedMonthKey), [selectedMonthKey])
  const previousMonthKey = useMemo(() => shiftMonthKey(selectedMonthKey, -1), [selectedMonthKey])
  const previousRange = useMemo(() => getMonthDateRange(previousMonthKey), [previousMonthKey])
  const { month, year } = parseMonthKey(selectedMonthKey)

  const [formData, setFormData] = useState({
    category_id: '',
    category: '',
    planned_amount: ''
  })

  const expenseCategoryOptions = useMemo(
    () => getCategoryOptionsByType(categories, 'expense'),
    [categories]
  )

  useEffect(() => {
    loadBudgetData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonthKey])

  const loadBudgetData = async () => {
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

      const [categoryData, loadedSettings] = await Promise.all([
        ensureDefaultCashflowCategories(supabase, user.id),
        loadUserSettings()
      ])

      const [budgetResult, previousBudgetResult, cashflowResult, previousCashflowResult] =
        await Promise.all([
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
            .eq('month', selectedRange.month)
            .eq('year', selectedRange.year)
            .order('category', { ascending: true }),

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
            .eq('month', previousRange.month)
            .eq('year', previousRange.year)
            .order('category', { ascending: true }),

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
            .gte('entry_date', selectedRange.startDate)
            .lt('entry_date', selectedRange.endDate)
            .order('entry_date', { ascending: false })
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
            .gte('entry_date', previousRange.startDate)
            .lt('entry_date', previousRange.endDate)
            .order('entry_date', { ascending: false })
            .order('created_at', { ascending: false })
        ])

      if (budgetResult.error) throw budgetResult.error
      if (previousBudgetResult.error) throw previousBudgetResult.error
      if (cashflowResult.error) throw cashflowResult.error
      if (previousCashflowResult.error) throw previousCashflowResult.error

      setCategories(categoryData)
      setAppSettings(loadedSettings)
      setBudgets(budgetResult.data || [])
      setPreviousBudgets(previousBudgetResult.data || [])
      setCashflowEntries(cashflowResult.data || [])
      setPreviousCashflowEntries(previousCashflowResult.data || [])
      setSelectedCarryKeys(new Set())
    } catch (error) {
      console.error('loadBudgetData error:', error)
      setMessage(error.message || 'Failed to load budget data')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      category_id: '',
      category: '',
      planned_amount: ''
    })
    setEditingId(null)
  }

  const handleChange = (e) => {
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

  const handleAddOrUpdateBudget = async (e) => {
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

      const plannedAmount = Number(formData.planned_amount)

      if (Number.isNaN(plannedAmount) || plannedAmount < 0) {
        throw new Error('Planned amount must be a valid positive number')
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
        category_id: categoryPayload.category_id,
        category: categoryPayload.category,
        planned_amount: plannedAmount
      }

      if (editingId) {
        const { error } = await supabase
          .from('budgets')
          .update(payload)
          .eq('id', editingId)
          .eq('user_id', user.id)

        if (error) throw error

        setMessage('Budget updated successfully')
      } else {
        const existingCategory = budgets.find((item) => {
          if (categoryPayload.category_id && item.category_id === categoryPayload.category_id) {
            return true
          }

          return (
            String(getCategoryDisplayName(item)).trim().toLowerCase() ===
            String(categoryPayload.category).trim().toLowerCase()
          )
        })

        if (existingCategory) {
          throw new Error('This category already has a budget for the selected month')
        }

        const { error } = await supabase.from('budgets').insert({
          user_id: user.id,
          month,
          year,
          ...payload
        })

        if (error) throw error

        setMessage('Budget added successfully')
      }

      resetForm()
      await loadBudgetData()
    } catch (error) {
      console.error('handleAddOrUpdateBudget error:', error)
      setMessage(error.message || 'Failed to save budget')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (budget) => {
    setEditingId(budget.id)
    setFormData({
      category_id: budget.category_id || '',
      category: budget.category || budget.cashflow_categories?.name || '',
      planned_amount: budget.planned_amount ?? ''
    })
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (budgetId) => {
    const confirmed = window.confirm('Are you sure you want to delete this budget?')
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
        .from('budgets')
        .delete()
        .eq('id', budgetId)
        .eq('user_id', user.id)

      if (error) throw error

      if (editingId === budgetId) resetForm()

      setMessage('Budget deleted successfully')
      await loadBudgetData()
    } catch (error) {
      console.error('handleDelete error:', error)
      setMessage(error.message || 'Failed to delete budget')
    }
  }

  function toggleCarryRow(key) {
    setSelectedCarryKeys((prev) => {
      const next = new Set(prev)

      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      return next
    })
  }

  function selectEligibleCarryRows() {
    const eligible = carryRows.filter((row) => row.canApply).map((row) => row.key)
    setSelectedCarryKeys(new Set(eligible))
    setMessage(`Selected ${eligible.length} eligible carry-forward row${eligible.length === 1 ? '' : 's'}.`)
  }

  function clearCarrySelection() {
    setSelectedCarryKeys(new Set())
    setMessage('Cleared carry-forward selection.')
  }

  async function handleApplyCarryForward() {
    const rowsToApply = carryRows.filter(
      (row) => row.canApply && selectedCarryKeys.has(row.key)
    )

    if (rowsToApply.length === 0) {
      setMessage('No carry-forward rows selected.')
      return
    }

    const confirmed = window.confirm(
      `Apply carry-forward to ${rowsToApply.length} budget row${
        rowsToApply.length === 1 ? '' : 's'
      } for ${getMonthLabel(selectedMonthKey)}?`
    )

    if (!confirmed) return

    setApplyingCarry(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      let updatedCount = 0
      let insertedCount = 0

      for (const row of rowsToApply) {
        const nextPlanned = Math.max(Number(row.suggestedNewPlanned || 0), 0)

        if (row.currentBudgetId) {
          const { error } = await supabase
            .from('budgets')
            .update({
              planned_amount: nextPlanned
            })
            .eq('id', row.currentBudgetId)
            .eq('user_id', user.id)

          if (error) throw error
          updatedCount += 1
        } else {
          const { error } = await supabase.from('budgets').insert({
            user_id: user.id,
            month,
            year,
            category_id: row.category_id || null,
            category: row.category,
            planned_amount: nextPlanned
          })

          if (error) throw error
          insertedCount += 1
        }
      }

      setMessage(
        `Carry-forward applied. Updated ${updatedCount}, created ${insertedCount} budget row${
          updatedCount + insertedCount === 1 ? '' : 's'
        }.`
      )
      setSelectedCarryKeys(new Set())
      await loadBudgetData()
    } catch (error) {
      console.error('handleApplyCarryForward error:', error)
      setMessage(error.message || 'Failed to apply carry-forward')
    } finally {
      setApplyingCarry(false)
    }
  }

  const getStatusColor = (status) => {
    if (status === 'Over Budget') return 'var(--danger)'
    if (status === 'At Limit') return 'var(--warning)'
    if (status === 'Near Limit') return 'var(--warning)'
    return 'var(--success)'
  }

  const getStatusBadgeStyle = (status) => {
    const color = getStatusColor(status)

    return {
      display: 'inline-block',
      padding: '6px 10px',
      borderRadius: '999px',
      fontSize: '12px',
      fontWeight: 800,
      color,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid ${color}`
    }
  }

  const budgetSummary = useMemo(
    () => calculateBudgetSummary(budgets, cashflowEntries, appSettings),
    [budgets, cashflowEntries, appSettings]
  )

  const previousBudgetSummary = useMemo(
    () => calculateBudgetSummary(previousBudgets, previousCashflowEntries, appSettings),
    [previousBudgets, previousCashflowEntries, appSettings]
  )

  const carryRows = useMemo(
    () =>
      buildCarryForwardRows({
        previousBudgets,
        previousCashflowEntries,
        currentBudgets: budgets,
        mode: carryMode,
        minCarryAmount,
        settings: appSettings
      }),
    [
      previousBudgets,
      previousCashflowEntries,
      budgets,
      carryMode,
      minCarryAmount,
      appSettings
    ]
  )

  const carrySummary = useMemo(() => summarizeCarryForwardRows(carryRows), [carryRows])

  const selectedCarryRows = carryRows.filter((row) => selectedCarryKeys.has(row.key))
  const selectedCarryAmount = selectedCarryRows.reduce(
    (sum, row) => sum + Number(row.adjustment || 0),
    0
  )

  return (
    <div style={pageStyle}>
      <div style={headerRowStyle}>
        <div>
          <div style={eyebrowStyle}>Bài 45 · Budget Carry-Forward Pro</div>
          <h1 style={pageTitleStyle}>Budget</h1>
          <p style={pageDescriptionStyle}>
            Set monthly budgets by database-backed category, compare actual expenses, and carry surplus or overspending forward.
          </p>
          <div style={pageMetaStyle}>
            Selected Month: {month}/{year} · Warning {appSettings.budgetWarningPercent}% · Danger {appSettings.budgetDangerPercent}%
          </div>
        </div>

        <div style={monthControlStyle}>
          <input
            type="month"
            value={selectedMonthKey}
            onChange={(event) => setSelectedMonthKey(event.target.value)}
            style={monthInputStyle}
          />
          <button onClick={loadBudgetData} style={refreshButtonStyle}>
            Refresh Budget
          </button>
        </div>
      </div>

      <div style={summaryGridStyle}>
        <SummaryCard label="Total Planned" value={`$${formatMoney(budgetSummary.totalPlanned)}`} />
        <SummaryCard label="Total Actual" value={`$${formatMoney(budgetSummary.totalActual)}`} />
        <SummaryCard
          label="Remaining"
          value={`$${formatMoney(budgetSummary.totalRemaining)}`}
          tone={budgetSummary.totalRemaining >= 0 ? 'good' : 'danger'}
          note={`Usage: ${formatPercent(budgetSummary.overallUsagePercent)}`}
        />
        <SummaryCard
          label="Previous Month Leftover"
          value={`$${formatMoney(previousBudgetSummary.totalRemaining)}`}
          tone={previousBudgetSummary.totalRemaining >= 0 ? 'good' : 'danger'}
          note={getMonthLabel(previousMonthKey)}
        />
        <SummaryCard
          label="Carry Suggestion"
          value={`$${formatMoney(carrySummary.totalAdjustment)}`}
          tone={carrySummary.totalAdjustment >= 0 ? 'good' : 'danger'}
          note={`${carrySummary.eligibleRows} eligible row${carrySummary.eligibleRows === 1 ? '' : 's'}`}
        />
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={mainGridStyle}>
        <div style={leftColumnStyle}>
          <div style={cardStyle}>
            <div style={formHeaderStyle}>
              <h2 style={{ marginTop: 0, marginBottom: 0 }}>
                {editingId ? 'Edit Budget' : 'Add Budget'}
              </h2>

              {editingId && (
                <button type="button" onClick={resetForm} style={secondaryButtonStyle}>
                  Cancel Edit
                </button>
              )}
            </div>

            <form onSubmit={handleAddOrUpdateBudget}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Category</label>
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
              </div>

              {!formData.category_id && (
                <div style={fieldStyle}>
                  <label style={labelStyle}>Custom Category</label>
                  <input
                    type="text"
                    name="category"
                    value={formData.category}
                    onChange={handleChange}
                    placeholder="Example: Groceries, Rent, Gas"
                    style={inputStyle}
                  />
                  <div style={helperTextStyle}>
                    Use custom category only if it is not in the database category list yet.
                  </div>
                </div>
              )}

              <div style={fieldStyle}>
                <label style={labelStyle}>Planned Amount</label>
                <input
                  type="number"
                  step="0.01"
                  name="planned_amount"
                  value={formData.planned_amount}
                  onChange={handleChange}
                  placeholder="Example: 500"
                  style={inputStyle}
                />
              </div>

              <button type="submit" disabled={saving} style={buttonStyle}>
                {saving ? 'Saving...' : editingId ? 'Update Budget' : 'Add Budget'}
              </button>
            </form>
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Carry-Forward Rules</h2>
            <p style={sectionSubStyle}>
              Carry-forward does not create a new table. It updates or creates rows in the existing budgets table for the selected month.
            </p>

            <div style={fieldStyle}>
              <label style={labelStyle}>Carry Mode</label>
              <select
                value={carryMode}
                onChange={(event) => setCarryMode(event.target.value)}
                style={inputStyle}
              >
                {Object.entries(CARRY_MODES).map(([key, item]) => (
                  <option key={key} value={key}>
                    {item.label}
                  </option>
                ))}
              </select>
              <div style={helperTextStyle}>{CARRY_MODES[carryMode]?.description}</div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Minimum Carry Amount</label>
              <input
                type="number"
                step="0.01"
                value={minCarryAmount}
                onChange={(event) => setMinCarryAmount(event.target.value)}
                style={inputStyle}
              />
              <div style={helperTextStyle}>
                Small differences below this amount will be ignored.
              </div>
            </div>

            <div style={carryActionGridStyle}>
              <button type="button" onClick={selectEligibleCarryRows} style={secondaryButtonStyle}>
                Select Eligible
              </button>
              <button type="button" onClick={clearCarrySelection} style={secondaryButtonStyle}>
                Clear
              </button>
            </div>

            <button
              type="button"
              onClick={handleApplyCarryForward}
              disabled={applyingCarry || selectedCarryKeys.size === 0}
              style={selectedCarryKeys.size === 0 ? disabledButtonStyle : greenButtonStyle}
            >
              {applyingCarry
                ? 'Applying...'
                : `Apply ${selectedCarryKeys.size} Selected`}
            </button>

            <div style={helperTextStyle}>
              Selected adjustment: ${formatMoney(selectedCarryAmount)}
            </div>
          </div>
        </div>

        <div style={rightColumnStyle}>
          <div style={budgetActualCardStyle}>
            <h2 style={{ marginTop: 0 }}>Budget vs Actual</h2>

            {loading ? (
              <p>Loading budgets...</p>
            ) : budgetSummary.rows.length === 0 ? (
              <p>No budgets found for {getMonthLabel(selectedMonthKey)}.</p>
            ) : (
              <div style={budgetActualScrollStyle}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Category</th>
                      <th style={thStyle}>Planned</th>
                      <th style={thStyle}>Actual</th>
                      <th style={thStyle}>Remaining</th>
                      <th style={thStyle}>Usage</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budgetSummary.rows.map((row) => (
                      <tr key={row.id}>
                        <td style={tdStyle}>{row.category}</td>
                        <td style={tdStyle}>${formatMoney(row.planned)}</td>
                        <td style={tdStyle}>${formatMoney(row.actual)}</td>
                        <td
                          style={{
                            ...tdStyle,
                            color: row.remaining >= 0 ? 'var(--success)' : 'var(--danger)',
                            fontWeight: 800
                          }}
                        >
                          ${formatMoney(row.remaining)}
                        </td>
                        <td style={tdStyle}>{formatPercent(row.usagePercent)}</td>
                        <td style={tdStyle}>
                          <span style={getStatusBadgeStyle(row.status)}>{row.status}</span>
                        </td>
                        <td style={tdStyle}>
                          <div style={actionRowStyle}>
                            <button
                              type="button"
                              onClick={() => handleEdit(row.raw)}
                              style={editButtonStyle}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(row.id)}
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

          <div style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>Carry-Forward Planner</h2>
                <p style={sectionSubStyle}>
                  Previous month: {getMonthLabel(previousMonthKey)} → Selected month: {getMonthLabel(selectedMonthKey)}
                </p>
              </div>
            </div>

            <div style={carrySummaryGridStyle}>
              <CarryStat label="Eligible" value={carrySummary.eligibleRows} />
              <CarryStat label="Surplus Rows" value={carrySummary.surplusRows} tone="good" />
              <CarryStat label="Overspent Rows" value={carrySummary.overspentRows} tone="danger" />
              <CarryStat label="Create Rows" value={carrySummary.createRows} tone="warning" />
            </div>

            {previousBudgets.length === 0 ? (
              <div style={emptyStyle}>
                No previous month budget found. Choose another selected month or create previous month budget first.
              </div>
            ) : carryRows.length === 0 ? (
              <div style={emptyStyle}>No carry-forward rows found.</div>
            ) : (
              <div style={carryListStyle}>
                {carryRows.map((row) => (
                  <div key={row.key} style={getCarryRowStyle(row)}>
                    <label style={carryCheckboxStyle}>
                      <input
                        type="checkbox"
                        checked={selectedCarryKeys.has(row.key)}
                        onChange={() => toggleCarryRow(row.key)}
                        disabled={!row.canApply}
                      />
                    </label>

                    <div style={{ minWidth: 0 }}>
                      <div style={carryTitleRowStyle}>
                        <strong>{row.category}</strong>
                        <span style={getCarryBadgeStyle(row.tone)}>{row.carryStatus}</span>
                      </div>

                      <div style={carryMetaStyle}>
                        Previous: planned ${formatMoney(row.previousPlanned)} · actual ${formatMoney(row.previousActual)} · remaining ${formatMoney(row.previousRemaining)}
                      </div>

                      <div style={carryMetaStyle}>
                        Current plan: ${formatMoney(row.currentPlanned)} → Suggested: ${formatMoney(row.suggestedNewPlanned)}
                      </div>
                    </div>

                    <div style={carryAmountStyle}>
                      <div
                        style={{
                          fontWeight: 900,
                          color: row.adjustment >= 0 ? 'var(--success)' : 'var(--danger)'
                        }}
                      >
                        {row.adjustment >= 0 ? '+' : '-'}${formatMoney(Math.abs(row.adjustment))}
                      </div>
                      <div style={miniTextStyle}>adjustment</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, note, tone = 'default' }) {
  const color =
    tone === 'good'
      ? 'var(--success)'
      : tone === 'danger'
        ? 'var(--danger)'
        : tone === 'warning'
          ? 'var(--warning)'
          : 'var(--text-main)'

  return (
    <div style={summaryCardStyle}>
      <div style={summaryLabelStyle}>{label}</div>
      <div style={{ ...summaryValueStyle, color }}>{value}</div>
      {note && <div style={summaryNoteStyle}>{note}</div>}
    </div>
  )
}

function CarryStat({ label, value, tone = 'default' }) {
  const color =
    tone === 'good'
      ? 'var(--success)'
      : tone === 'danger'
        ? 'var(--danger)'
        : tone === 'warning'
          ? 'var(--warning)'
          : 'var(--accent-strong)'

  return (
    <div style={carryStatStyle}>
      <div style={{ ...carryStatValueStyle, color }}>{value}</div>
      <div style={carryStatLabelStyle}>{label}</div>
    </div>
  )
}

function getCarryBadgeStyle(tone) {
  const color =
    tone === 'good'
      ? 'var(--success)'
      : tone === 'danger'
        ? 'var(--danger)'
        : tone === 'warning'
          ? 'var(--warning)'
          : 'var(--text-muted)'

  return {
    display: 'inline-block',
    padding: '5px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 900,
    color,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    border: `1px solid ${color}`
  }
}

function getCarryRowStyle(row) {
  const color =
    row.tone === 'good'
      ? 'var(--success)'
      : row.tone === 'danger'
        ? 'var(--danger)'
        : row.tone === 'warning'
          ? 'var(--warning)'
          : 'var(--border-main)'

  return {
    ...carryRowStyle,
    borderColor: color,
    opacity: row.canApply ? 1 : 0.72
  }
}



const pageStyle = {
  color: 'var(--text-main)'
}

const pageTitleStyle = {
  marginBottom: '8px',
  color: 'var(--text-main)'
}

const pageDescriptionStyle = {
  marginTop: 0,
  color: 'var(--text-muted)',
  maxWidth: '760px',
  lineHeight: 1.55
}

const pageMetaStyle = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  marginTop: '8px',
  fontWeight: 600
}

const headerRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  marginBottom: '18px'
}

const eyebrowStyle = {
  color: 'var(--accent-strong)',
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: '8px'
}

const monthControlStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
}

const monthInputStyle = {
  padding: '11px 12px',
  borderRadius: '10px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  colorScheme: 'inherit'
}

const refreshButtonStyle = {
  padding: '11px 14px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--accent-strong)',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 800
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: '14px',
  marginBottom: '18px'
}

const summaryCardStyle = {
  background: 'var(--bg-card)',
  color: 'var(--text-main)',
  padding: '18px',
  borderRadius: '14px',
  border: '1px solid var(--border-main)',
  boxShadow: 'var(--shadow-soft)',
  minWidth: 0
}

const summaryLabelStyle = {
  color: 'var(--text-soft)',
  fontSize: '13px',
  marginBottom: '10px',
  fontWeight: 800
}

const summaryValueStyle = {
  fontSize: '24px',
  fontWeight: 900,
  letterSpacing: '-0.03em'
}

const summaryNoteStyle = {
  marginTop: '8px',
  color: 'var(--text-muted)',
  fontSize: '12px',
  lineHeight: 1.45
}

const messageStyle = {
  marginBottom: '16px',
  padding: '12px',
  borderRadius: '10px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-main)'
}

const mainGridStyle = {
  display: 'grid',
  gridTemplateColumns: '360px minmax(0, 1fr)',
  gap: '24px',
  marginTop: '24px',
  alignItems: 'start'
}

const leftColumnStyle = {
  display: 'grid',
  gap: '18px',
  minWidth: 0
}

const rightColumnStyle = {
  display: 'grid',
  gap: '18px',
  minWidth: 0
}

const cardStyle = {
  background: 'var(--bg-card)',
  color: 'var(--text-main)',
  padding: '20px',
  borderRadius: '14px',
  border: '1px solid var(--border-main)',
  boxShadow: 'var(--shadow-card)',
  minWidth: 0
}

const budgetActualCardStyle = {
  ...cardStyle,
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 'min(680px, calc(100vh - 220px))',
  overflow: 'hidden'
}

const budgetActualScrollStyle = {
  width: '100%',
  maxWidth: '100%',
  overflowX: 'auto',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  paddingRight: '4px',
  minHeight: 0
}

const sectionHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  marginBottom: '16px'
}

const sectionSubStyle = {
  color: 'var(--text-muted)',
  fontSize: '13px',
  lineHeight: 1.5,
  marginTop: '7px'
}

const formHeaderStyle = {
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
  fontWeight: 800,
  color: 'var(--text-main)'
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 12px',
  borderRadius: '9px',
  border: '1px solid var(--border-soft)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-main)',
  colorScheme: 'inherit'
}

const helperTextStyle = {
  marginTop: '7px',
  color: 'var(--text-muted)',
  fontSize: '12px',
  lineHeight: 1.45
}

const buttonStyle = {
  width: '100%',
  padding: '12px',
  border: 'none',
  borderRadius: '9px',
  background: 'var(--accent-strong)',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 850
}

const secondaryButtonStyle = {
  padding: '10px 12px',
  border: '1px solid var(--border-main)',
  borderRadius: '9px',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  cursor: 'pointer',
  fontWeight: 800
}

const greenButtonStyle = {
  width: '100%',
  padding: '12px',
  border: 'none',
  borderRadius: '9px',
  background: 'var(--success)',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 850,
  marginTop: '12px'
}

const disabledButtonStyle = {
  ...greenButtonStyle,
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-muted)',
  cursor: 'not-allowed'
}

const carryActionGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '10px'
}

const tableStyle = {
  width: '100%',
  minWidth: '780px',
  borderCollapse: 'collapse'
}

const thStyle = {
  textAlign: 'left',
  padding: '12px',
  borderBottom: '1px solid var(--border-main)',
  color: 'var(--text-soft)',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--bg-card)'
}

const tdStyle = {
  padding: '12px',
  borderBottom: '1px solid var(--border-faint)',
  color: 'var(--text-main)',
  whiteSpace: 'nowrap'
}

const actionRowStyle = {
  display: 'flex',
  gap: '8px'
}

const editButtonStyle = {
  padding: '8px 10px',
  border: 'none',
  borderRadius: '8px',
  background: 'var(--accent-strong)',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 800
}

const deleteButtonStyle = {
  padding: '8px 10px',
  border: 'none',
  borderRadius: '8px',
  background: 'var(--danger-dark)',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 800
}

const carrySummaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: '10px',
  marginBottom: '14px'
}

const carryStatStyle = {
  padding: '12px',
  borderRadius: '12px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)'
}

const carryStatValueStyle = {
  fontSize: '20px',
  fontWeight: 950
}

const carryStatLabelStyle = {
  marginTop: '4px',
  color: 'var(--text-soft)',
  fontSize: '11px',
  fontWeight: 800
}

const carryListStyle = {
  display: 'grid',
  gap: '10px',
  maxHeight: '620px',
  overflowY: 'auto',
  paddingRight: '4px'
}

const carryRowStyle = {
  display: 'grid',
  gridTemplateColumns: '32px minmax(0, 1fr) 120px',
  gap: '12px',
  alignItems: 'center',
  padding: '13px',
  borderRadius: '14px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)'
}

const carryCheckboxStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}

const carryTitleRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
  marginBottom: '6px'
}

const carryMetaStyle = {
  color: 'var(--text-muted)',
  fontSize: '12px',
  lineHeight: 1.45
}

const carryAmountStyle = {
  textAlign: 'right'
}

const miniTextStyle = {
  marginTop: '4px',
  color: 'var(--text-muted)',
  fontSize: '11px'
}

const emptyStyle = {
  padding: '16px',
  borderRadius: '14px',
  background: 'var(--bg-card-soft)',
  border: '1px dashed var(--border-soft)',
  color: 'var(--text-soft)',
  lineHeight: 1.5
}
