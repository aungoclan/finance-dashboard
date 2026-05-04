import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_APP_SETTINGS, loadUserSettings } from '../lib/appSettings'
import {
  buildBillCashflowInsertRows,
  buildBudgetInsertRows,
  formatMoney,
  getActiveMonthlyBills,
  getBillAccountLabel,
  getBillSetupRows,
  getCategoryHealth,
  getCurrentMonthKey,
  getMissingBudgetRows,
  getMonthDateRange,
  getMonthLabel,
  getNextMonthKey,
  shiftMonthKey,
  summarizeBillRows,
  summarizeCashflow
} from '../lib/monthSetup'


const LIABILITY_BILL_NOTE_PREFIX = 'linked_liability_id:'

function isDebtLinkedBillTemplate(bill) {
  const note = String(bill?.note || '')
  return (
    note.includes(LIABILITY_BILL_NOTE_PREFIX) ||
    note.includes('Auto-created from Net Worth Liability Bill Sync') ||
    note.includes('default_payment_account_id:')
  )
}

function getFriendlyDebtBillNote(row) {
  if (row?.alreadyAdded) {
    return 'Debt payment was already recorded from Net Worth. Month Setup keeps this locked to prevent duplicate cashflow.'
  }

  return 'Debt payment reminder linked to Net Worth. Record payment from Net Worth → Liabilities so cashflow, debt balance, and statement status stay in sync.'
}

export default function MonthSetupPage() {
  const [targetMonthKey, setTargetMonthKey] = useState(getNextMonthKey())
  const [accounts, setAccounts] = useState([])
  const [previousBudgets, setPreviousBudgets] = useState([])
  const [targetBudgets, setTargetBudgets] = useState([])
  const [bills, setBills] = useState([])
  const [targetCashflowEntries, setTargetCashflowEntries] = useState([])
  const [billAccountMap, setBillAccountMap] = useState({})
  const [defaultBillAccountId, setDefaultBillAccountId] = useState('')
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [savingBudget, setSavingBudget] = useState(false)
  const [savingBills, setSavingBills] = useState(false)
  const [message, setMessage] = useState('')

  const previousMonthKey = useMemo(() => shiftMonthKey(targetMonthKey, -1), [targetMonthKey])
  const targetRange = useMemo(() => getMonthDateRange(targetMonthKey), [targetMonthKey])
  const previousRange = useMemo(() => getMonthDateRange(previousMonthKey), [previousMonthKey])

  useEffect(() => {
    loadMonthSetupData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMonthKey])

  async function loadMonthSetupData() {
    setLoading(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const loadedSettings = await loadUserSettings()

      const [accountResult, previousBudgetResult, targetBudgetResult, billResult, cashflowResult] =
        await Promise.all([
          supabase
            .from('accounts')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),

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
            .eq('month', targetRange.month)
            .eq('year', targetRange.year)
            .order('category', { ascending: true }),

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
            .from('cashflow_entries')
            .select(`
              id,
              account_id,
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
            .gte('entry_date', targetRange.startDate)
            .lt('entry_date', targetRange.endDate)
            .order('entry_date', { ascending: true })
        ])

      if (accountResult.error) throw accountResult.error
      if (previousBudgetResult.error) throw previousBudgetResult.error
      if (targetBudgetResult.error) throw targetBudgetResult.error
      if (billResult.error) throw billResult.error
      if (cashflowResult.error) throw cashflowResult.error

      const accountData = accountResult.data || []

      setAppSettings(loadedSettings)
      setAccounts(accountData)
      setPreviousBudgets(previousBudgetResult.data || [])
      setTargetBudgets(targetBudgetResult.data || [])
      setBills(billResult.data || [])
      setTargetCashflowEntries(cashflowResult.data || [])

      if (!defaultBillAccountId && loadedSettings.defaultAccountId) {
        const exists = accountData.some((account) => account.id === loadedSettings.defaultAccountId)
        if (exists) setDefaultBillAccountId(loadedSettings.defaultAccountId)
      }
    } catch (error) {
      console.error('loadMonthSetupData error:', error)
      setMessage(error.message || 'Failed to load month setup data')
    } finally {
      setLoading(false)
    }
  }

  function handleBillAccountChange(billId, accountId) {
    setBillAccountMap((prev) => ({
      ...prev,
      [billId]: accountId
    }))
  }

  function handleApplyDefaultAccountToReadyBills() {
    if (!defaultBillAccountId) {
      setMessage('Choose a default account first.')
      return
    }

    const nextMap = { ...billAccountMap }

    autoEntryBillRows.forEach((row) => {
      if (row.canAdd) {
        nextMap[row.bill.id] = defaultBillAccountId
      }
    })

    setBillAccountMap(nextMap)
    setMessage(`Applied ${getBillAccountLabel(defaultBillAccountId, accounts)} to all ready bills.`)
  }

  function handleClearBillAccounts() {
    setBillAccountMap({})
    setMessage('Cleared bill account selections for this setup screen.')
  }

  async function handleCopyBudgets() {
    if (missingBudgets.length === 0) {
      setMessage('No missing budgets to copy. Target month already has all categories from previous month.')
      return
    }

    setSavingBudget(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const rows = buildBudgetInsertRows({
        userId: user.id,
        targetMonthKey,
        missingBudgets
      })

      if (rows.length === 0) throw new Error('No valid budget rows to copy')

      const { error } = await supabase.from('budgets').insert(rows)
      if (error) throw error

      setMessage(
        `Copied ${rows.length} budget categor${rows.length === 1 ? 'y' : 'ies'} into ${getMonthLabel(targetMonthKey)}.`
      )
      await loadMonthSetupData()
    } catch (error) {
      console.error('handleCopyBudgets error:', error)
      setMessage(error.message || 'Failed to copy budgets')
    } finally {
      setSavingBudget(false)
    }
  }

  async function handleAddBillsToCashflow() {
    const previewRows = buildBillCashflowInsertRows({
      userId: 'preview',
      targetMonthKey,
      billRows: autoEntryBillRows,
      billAccountMap
    })

    if (previewRows.length === 0) {
      setMessage('No ready bill entries to add. Review blocked bills, category mapping, or duplicates.')
      return
    }

    const confirmed = window.confirm(
      `Add ${previewRows.length} ready bill expense${previewRows.length === 1 ? '' : 's'} to Cashflow for ${getMonthLabel(targetMonthKey)}?`
    )

    if (!confirmed) return

    setSavingBills(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const insertRows = buildBillCashflowInsertRows({
        userId: user.id,
        targetMonthKey,
        billRows: autoEntryBillRows,
        billAccountMap
      })

      if (insertRows.length === 0) {
        throw new Error('No valid bill rows to insert.')
      }

      const { error } = await supabase.from('cashflow_entries').insert(insertRows)
      if (error) throw error

      setMessage(
        `Added ${insertRows.length} bill expense${insertRows.length === 1 ? '' : 's'} to Cashflow for ${getMonthLabel(targetMonthKey)}.`
      )
      await loadMonthSetupData()
    } catch (error) {
      console.error('handleAddBillsToCashflow error:', error)
      setMessage(error.message || 'Failed to add bills to cashflow')
    } finally {
      setSavingBills(false)
    }
  }

  const activeMonthlyBills = useMemo(() => getActiveMonthlyBills(bills), [bills])

  const billRows = useMemo(
    () =>
      getBillSetupRows({
        bills: activeMonthlyBills,
        cashflowEntries: targetCashflowEntries,
        targetMonthKey,
        dueSoonDays: appSettings.billDueSoonDays,
        billAccountMap
      }).map((row) => {
        const isDebtLinkedBill = isDebtLinkedBillTemplate(row.bill)
        if (!isDebtLinkedBill) return row

        return {
          ...row,
          isDebtLinkedBill: true,
          canAdd: false,
          status: row.alreadyAdded ? 'added' : 'net_worth',
          reason: row.alreadyAdded ? 'Posted' : 'Record in Net Worth'
        }
      }),
    [activeMonthlyBills, targetCashflowEntries, targetMonthKey, appSettings.billDueSoonDays, billAccountMap]
  )

  const autoEntryBillRows = useMemo(
    () => billRows.filter((row) => !row.isDebtLinkedBill),
    [billRows]
  )

  const debtLinkedBillRows = useMemo(
    () => billRows.filter((row) => row.isDebtLinkedBill),
    [billRows]
  )

  const billSummary = useMemo(() => summarizeBillRows(autoEntryBillRows), [autoEntryBillRows])

  const missingBudgets = useMemo(
    () => getMissingBudgetRows(previousBudgets, targetBudgets),
    [previousBudgets, targetBudgets]
  )

  const cashflowSummary = useMemo(
    () => summarizeCashflow(targetCashflowEntries),
    [targetCashflowEntries]
  )

  const categoryHealth = useMemo(
    () =>
      getCategoryHealth({
        targetBudgets,
        targetCashflowEntries
      }),
    [targetBudgets, targetCashflowEntries]
  )

  const previousBudgetTotal = previousBudgets.reduce(
    (sum, item) => sum + Number(item.planned_amount || 0),
    0
  )

  const targetBudgetTotal = targetBudgets.reduce(
    (sum, item) => sum + Number(item.planned_amount || 0),
    0
  )

  

  const checklist = [
    {
      label: 'Budget copied from previous month',
      done: targetBudgets.length > 0 && missingBudgets.length === 0,
      detail:
        previousBudgets.length === 0
          ? 'Previous month has no budget to copy.'
          : missingBudgets.length === 0
            ? 'Target month has all previous categories.'
            : `${missingBudgets.length} missing categor${missingBudgets.length === 1 ? 'y' : 'ies'}.`
    },
    {
      label: 'Active bills reviewed',
      done:
        activeMonthlyBills.length > 0 &&
        billSummary.ready === 0 &&
        billSummary.blocked === 0 &&
        billSummary.review === 0,
      detail:
        activeMonthlyBills.length === 0
          ? 'No active monthly bill templates found.'
          : `${billSummary.added}/${autoEntryBillRows.length} cashflow bills added · ${billSummary.ready} ready · ${billSummary.review} category review · ${billSummary.blocked} blocked · ${debtLinkedBillRows.length} Net Worth debt reminder${debtLinkedBillRows.length === 1 ? '' : 's'}.`
    },
    {
      label: 'Income entered for target month',
      done: cashflowSummary.incomeCount > 0,
      detail:
        cashflowSummary.incomeCount > 0
          ? `${cashflowSummary.incomeCount} income entr${cashflowSummary.incomeCount === 1 ? 'y' : 'ies'} found.`
          : 'No income entry found yet.'
    },
    {
      label: 'Expense categories match budget',
      done: categoryHealth.expensesWithoutBudget.length === 0,
      detail:
        categoryHealth.expensesWithoutBudget.length === 0
          ? 'No unmatched expense categories.'
          : `${categoryHealth.expensesWithoutBudget.length} expense categor${categoryHealth.expensesWithoutBudget.length === 1 ? 'y' : 'ies'} without budget.`
    },
    {
      label: 'Cash wallet / cash account reviewed',
      done: accounts.some((account) => account.account_type === 'cash'),
      detail: accounts.some((account) => account.account_type === 'cash')
        ? 'Cash Wallet account exists.'
        : 'No Cash Wallet account found. Add one in Accounts if you track physical cash.'
    }
  ]

const completedChecklistCount = checklist.filter((item) => item.done).length

const checklistScore =
  checklist.length > 0
    ? Math.round((completedChecklistCount / checklist.length) * 100)
    : 0
  return (
    <div>
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Bài 43 · Bills Auto-Entry / Rollover Pro</div>
          <h1 style={titleStyle}>Month Setup / Rollover Pro</h1>
          <p style={subtitleStyle}>
            Prepare a new month with budget rollover, bill auto-entry preview, duplicate protection,
            category safety, due-soon highlighting, and controlled batch insert.
          </p>
        </div>

        <div style={monthPickerCardStyle}>
          <label style={labelStyle}>Setup Target Month</label>
          <input
            type="month"
            value={targetMonthKey}
            onChange={(event) => setTargetMonthKey(event.target.value)}
            style={inputStyle}
          />
          <div style={quickButtonRowStyle}>
            <button type="button" onClick={() => setTargetMonthKey(getCurrentMonthKey())} style={smallButtonStyle}>
              Current
            </button>
            <button type="button" onClick={() => setTargetMonthKey(getNextMonthKey())} style={smallButtonStyle}>
              Next
            </button>
            <button type="button" onClick={loadMonthSetupData} style={smallButtonStyle}>
              Refresh
            </button>
          </div>
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={summaryGridStyle}>
        <SummaryCard
          label="Target Month"
          value={getMonthLabel(targetMonthKey)}
          note={`Copy from ${getMonthLabel(previousMonthKey)}`}
        />
        <SummaryCard
          label="Budget Setup"
          value={`${targetBudgets.length}/${previousBudgets.length}`}
          note={`Target $${formatMoney(targetBudgetTotal)} · Previous $${formatMoney(previousBudgetTotal)}`}
        />
        <SummaryCard
          label="Bills Auto-Entry"
          value={`${billSummary.added}/${autoEntryBillRows.length}`}
          note={`${billSummary.ready} ready · $${formatMoney(billSummary.amountReady)} ready value · ${debtLinkedBillRows.length} Net Worth only`}
          tone={billSummary.ready > 0 ? 'warning' : 'good'}
        />
        <SummaryCard
          label="Due Soon / Past Due"
          value={`${billSummary.dueSoon}/${billSummary.pastDue}`}
          note={`Window: ${appSettings.billDueSoonDays} day(s) from Settings`}
          tone={billSummary.pastDue > 0 ? 'danger' : billSummary.dueSoon > 0 ? 'warning' : 'good'}
        />
        <SummaryCard
          label="Cashflow Net"
          value={`$${formatMoney(cashflowSummary.net)}`}
          note={`Income $${formatMoney(cashflowSummary.income)} · Expense $${formatMoney(cashflowSummary.expense)}`}
          tone={cashflowSummary.net >= 0 ? 'good' : 'danger'}
        />
      </div>

      <div style={mainGridStyle}>
        <div style={leftColumnStyle}>
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>Monthly Checklist</h2>
                <p style={sectionSubtitleStyle}>
                  {completedChecklistCount}/{checklist.length} setup checks completed for {getMonthLabel(targetMonthKey)}.
                </p>
              </div>
              <span style={scoreBadgeStyle}>{checklistScore}%</span>
            </div>

            <div style={checklistStyle}>
              {checklist.map((item) => (
                <div key={item.label} style={checkItemStyle}>
                  <div style={item.done ? checkIconDoneStyle : checkIconWarningStyle}>
                    {item.done ? '✓' : '!'}
                  </div>
                  <div>
                    <div style={checkLabelStyle}>{item.label}</div>
                    <div style={checkDetailStyle}>{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>Bill Auto-Entry Control</h2>
                <p style={sectionSubtitleStyle}>
                  Choose a default account, apply it to ready bills, then batch-add only safe rows.
                </p>
              </div>
            </div>

            <div style={controlGridStyle}>
              <div>
                <label style={labelStyle}>Default Bill Account</label>
                <select
                  value={defaultBillAccountId}
                  onChange={(event) => setDefaultBillAccountId(event.target.value)}
                  style={inputStyle}
                >
                  <option value="">No default account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} {account.account_type ? `(${account.account_type})` : ''}
                    </option>
                  ))}
                </select>
                <div style={hintStyle}>
                  Account is optional, but recommended so Accounts and Money Plan stay cleaner.
                </div>
              </div>

              <div style={controlButtonStackStyle}>
                <button type="button" onClick={handleApplyDefaultAccountToReadyBills} style={primaryButtonStyle}>
                  Apply to Ready Bills
                </button>
                <button type="button" onClick={handleClearBillAccounts} style={secondaryButtonStyle}>
                  Clear Account Picks
                </button>
              </div>
            </div>
          </section>

          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>Category Review</h2>
                <p style={sectionSubtitleStyle}>
                  Category mismatch can make Budget and Money Plan less accurate.
                </p>
              </div>
            </div>

            <div style={warningGridStyle}>
              <CategoryWarningBox
                title="Expenses without budget"
                items={categoryHealth.expensesWithoutBudget}
                emptyText="All expense categories are covered by budget."
              />
              <CategoryWarningBox
                title="Budgets with no expense yet"
                items={categoryHealth.budgetsWithoutExpense}
                emptyText="Every budget category has activity."
              />
            </div>
          </section>
        </div>

        <div style={rightColumnStyle}>
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>Step 1 · Copy Budget</h2>
                <p style={sectionSubtitleStyle}>
                  Copy missing budget categories from {getMonthLabel(previousMonthKey)} into {getMonthLabel(targetMonthKey)}.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyBudgets}
                disabled={loading || savingBudget || missingBudgets.length === 0}
                style={missingBudgets.length === 0 ? disabledButtonStyle : primaryButtonStyle}
              >
                {savingBudget ? 'Copying...' : 'Copy Missing Budgets'}
              </button>
            </div>

            {loading ? (
              <div style={emptyStyle}>Loading budget data...</div>
            ) : previousBudgets.length === 0 ? (
              <div style={emptyStyle}>No budget found in previous month. Add budget first or choose another target month.</div>
            ) : missingBudgets.length === 0 ? (
              <div style={successBoxStyle}>Budget rollover looks complete. No missing categories from previous month.</div>
            ) : (
              <div style={tableWrapStyle}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Category</th>
                      <th style={thStyle}>Previous Plan</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingBudgets.map((budget) => (
                      <tr key={budget.id}>
                        <td style={tdStyle}>{budget.category || 'Uncategorized'}</td>
                        <td style={tdStyle}>${formatMoney(budget.planned_amount)}</td>
                        <td style={tdStyle}>
                          <span style={warningBadgeStyle}>missing</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>Step 2 · Bills Auto-Entry Preview</h2>
                <p style={sectionSubtitleStyle}>
                  Preview cashflow-safe monthly bills before inserting into Cashflow. Debt-linked reminders are separated and must be recorded from Net Worth.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddBillsToCashflow}
                disabled={loading || savingBills || billSummary.ready === 0}
                style={billSummary.ready === 0 ? disabledButtonStyle : greenButtonStyle}
              >
                {savingBills ? 'Adding...' : `Add ${billSummary.ready} Ready Bill${billSummary.ready === 1 ? '' : 's'}`}
              </button>
            </div>

            <div style={billSummaryGridStyle}>
              <BillSummaryPill label="Ready" value={billSummary.ready} tone="good" />
              <BillSummaryPill label="Already Added" value={billSummary.added} tone="info" />
              <BillSummaryPill label="Review" value={billSummary.review} tone="warning" />
              <BillSummaryPill label="Blocked" value={billSummary.blocked} tone="danger" />
              <BillSummaryPill label="Net Worth" value={debtLinkedBillRows.length} tone="neutral" />
            </div>

            {loading ? (
              <div style={emptyStyle}>Loading bills...</div>
            ) : activeMonthlyBills.length === 0 ? (
              <div style={emptyStyle}>No active monthly bills found.</div>
            ) : (
              <>
                {autoEntryBillRows.length === 0 ? (
                  <div style={emptyStyle}>
                    No regular cashflow bills are ready for auto-entry. Debt-linked reminders are shown below and should be recorded from Net Worth.
                  </div>
                ) : (
                  <div style={billListStyle}>
                    {autoEntryBillRows.map((row) => (
                      <div key={row.bill.id} style={getBillRowStyle(row)}>
                        <div style={{ minWidth: 0 }}>
                          <div style={billTitleRowStyle}>
                            <strong style={billNameStyle}>{row.bill.name || 'Unnamed Bill'}</strong>
                            <span style={getStatusBadgeStyle(row.status)}>
                              {row.reason}
                            </span>
                            <span style={getTimingBadgeStyle(row.timing?.tone)}>
                              {row.timing?.label}
                            </span>
                          </div>

                          <div style={mutedTextStyle}>
                            Category: {row.category || 'Missing'} · Amount: ${formatMoney(row.amount)} · Entry date: {row.entryDate}
                          </div>

                          <div style={detailTextStyle}>
                            Description: {row.description}
                          </div>

                          {row.needsCategoryId && (
                            <div style={reviewTextStyle}>
                              This bill still needs database category mapping. Fix in Category Cleanup or Bills before auto-entry.
                            </div>
                          )}
                        </div>

                        <div style={billRightControlStyle}>
                          <select
                            value={billAccountMap[row.bill.id] || ''}
                            onChange={(event) => handleBillAccountChange(row.bill.id, event.target.value)}
                            style={accountSelectStyle}
                            disabled={!row.canAdd}
                          >
                            <option value="">No account</option>
                            {accounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name} {account.account_type ? `(${account.account_type})` : ''}
                              </option>
                            ))}
                          </select>

                          <div style={accountPreviewStyle}>
                            {getBillAccountLabel(billAccountMap[row.bill.id], accounts)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {debtLinkedBillRows.length > 0 && (
                  <div style={debtBillSectionStyle}>
                    <div style={debtBillHeaderStyle}>
                      <div>
                        <h3 style={debtBillTitleStyle}>Debt bills · Record in Net Worth</h3>
                        <p style={debtBillSubtitleStyle}>
                          These reminders are linked to liabilities. Month Setup will not auto-add them to Cashflow, which prevents duplicate payments.
                        </p>
                      </div>
                      <span style={neutralBadgeStyle}>{debtLinkedBillRows.length} protected</span>
                    </div>

                    <div style={debtBillListStyle}>
                      {debtLinkedBillRows.map((row) => (
                        <div key={row.bill.id} style={debtBillRowStyle}>
                          <div style={{ minWidth: 0 }}>
                            <div style={billTitleRowStyle}>
                              <strong style={billNameStyle}>{row.bill.name || 'Unnamed Debt Bill'}</strong>
                              <span style={warningBadgeStyle}>Record in Net Worth</span>
                              <span style={getTimingBadgeStyle(row.timing?.tone)}>{row.timing?.label}</span>
                            </div>
                            <div style={mutedTextStyle}>
                              Category: {row.category || 'Debt Payment'} · Amount: ${formatMoney(row.amount)} · Reminder date: {row.entryDate}
                            </div>
                            <div style={detailTextStyle}>Description: {row.description}</div>
                            <div style={reviewTextStyle}>{getFriendlyDebtBillNote(row)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, note, tone = 'default' }) {
  return (
    <div style={summaryCardStyle}>
      <div style={summaryLabelStyle}>{label}</div>
      <div
        style={{
          ...summaryValueStyle,
          color:
            tone === 'good'
              ? '#22c55e'
              : tone === 'danger'
                ? '#ef4444'
                : tone === 'warning'
                  ? '#f59e0b'
                  : 'white'
        }}
      >
        {value}
      </div>
      {note && <div style={summaryNoteStyle}>{note}</div>}
    </div>
  )
}

function CategoryWarningBox({ title, items, emptyText }) {
  return (
    <div style={warningBoxStyle}>
      <div style={warningBoxTitleStyle}>{title}</div>
      {items.length === 0 ? (
        <div style={successTextStyle}>{emptyText}</div>
      ) : (
        <div style={tagWrapStyle}>
          {items.map((item) => (
            <span key={item} style={categoryTagStyle}>
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function BillSummaryPill({ label, value, tone }) {
  return (
    <div style={getBillSummaryPillStyle(tone)}>
      <div style={billSummaryValueStyle}>{value}</div>
      <div style={billSummaryLabelStyle}>{label}</div>
    </div>
  )
}

function getBillSummaryPillStyle(tone) {
  const color =
    tone === 'good'
      ? '#22c55e'
      : tone === 'danger'
        ? '#ef4444'
        : tone === 'warning'
          ? '#f59e0b'
          : '#38bdf8'

  return {
    padding: '12px',
    borderRadius: '13px',
    background: `${color}18`,
    border: `1px solid ${color}55`,
    color
  }
}

function getStatusBadgeStyle(status) {
  if (status === 'ready') return readyBadgeStyle
  if (status === 'added') return successBadgeStyle
  if (status === 'review') return warningBadgeStyle
  return dangerBadgeStyle
}

function getTimingBadgeStyle(tone) {
  if (tone === 'posted') return successBadgeStyle
  if (tone === 'danger') return dangerBadgeStyle
  if (tone === 'warning') return warningBadgeStyle
  return neutralBadgeStyle
}
function getBillRowStyle(row) {
  if (row.status === 'ready') return { ...billRowStyle, borderColor: 'rgba(34,197,94,0.34)' }
  if (row.status === 'added') return { ...billRowStyle, borderColor: 'rgba(56,189,248,0.28)' }
  if (row.status === 'review') return { ...billRowStyle, borderColor: 'rgba(245,158,11,0.34)' }
  return { ...billRowStyle, borderColor: 'rgba(239,68,68,0.34)' }
}

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '20px',
  marginBottom: '22px',
  color: 'var(--text-main, #f9fafb)'
}

const eyebrowStyle = {
  color: 'var(--accent, #38bdf8)',
  fontSize: '12px',
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: '8px'
}

const titleStyle = {
  margin: 0,
  fontSize: '32px',
  letterSpacing: '-0.04em',
  color: 'var(--text-main, #f9fafb)'
}

const subtitleStyle = {
  margin: '10px 0 0',
  maxWidth: '760px',
  color: 'var(--text-muted, #d1d5db)',
  lineHeight: 1.6
}

const monthPickerCardStyle = {
  width: '280px',
  padding: '16px',
  borderRadius: '16px',
  background: 'var(--bg-card, rgba(31, 41, 55, 0.82))',
  border: '1px solid var(--border-main, rgba(55, 65, 81, 0.85))',
  boxShadow: 'var(--shadow-card, 0 18px 40px rgba(0, 0, 0, 0.18))'
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  color: 'var(--text-soft, #d1d5db)',
  fontSize: '13px',
  fontWeight: 800
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 12px',
  borderRadius: '10px',
  border: '1px solid var(--border-soft, #4b5563)',
  background: 'var(--bg-elevated, #111827)',
  color: 'var(--text-main, #f9fafb)',
  colorScheme: 'auto',
  outline: 'none'
}

const quickButtonRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '8px',
  marginTop: '10px'
}

const smallButtonStyle = {
  padding: '8px 9px',
  borderRadius: '9px',
  border: '1px solid var(--border-main, #374151)',
  background: 'var(--bg-card-soft, #172033)',
  color: 'var(--text-main, #f9fafb)',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 800
}

const messageStyle = {
  marginBottom: '18px',
  padding: '13px 14px',
  borderRadius: '13px',
  background: 'var(--accent-soft, rgba(56, 189, 248, 0.1))',
  border: '1px solid color-mix(in srgb, var(--accent, #38bdf8) 28%, transparent)',
  color: 'var(--text-main, #e0f2fe)'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: '14px',
  marginBottom: '22px'
}

const summaryCardStyle = {
  padding: '16px',
  borderRadius: '16px',
  background: 'var(--bg-card, linear-gradient(180deg, rgba(31, 41, 55, 0.92), rgba(17, 24, 39, 0.92)))',
  border: '1px solid var(--border-main, rgba(55, 65, 81, 0.85))',
  boxShadow: 'var(--shadow-soft, none)',
  minWidth: 0,
  color: 'var(--text-main, #f9fafb)'
}

const summaryLabelStyle = {
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '12px',
  fontWeight: 800,
  marginBottom: '8px'
}

const summaryValueStyle = {
  fontSize: '22px',
  fontWeight: 900,
  letterSpacing: '-0.03em',
  color: 'var(--text-main, #f9fafb)'
}

const summaryNoteStyle = {
  marginTop: '8px',
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '12px',
  lineHeight: 1.45
}

const mainGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 0.78fr) minmax(0, 1.22fr)',
  gap: '22px',
  alignItems: 'start'
}

const leftColumnStyle = {
  display: 'grid',
  gap: '18px'
}

const rightColumnStyle = {
  display: 'grid',
  gap: '18px'
}

const cardStyle = {
  padding: '20px',
  borderRadius: '18px',
  background: 'var(--bg-card, rgba(31, 41, 55, 0.86))',
  border: '1px solid var(--border-main, rgba(55, 65, 81, 0.85))',
  boxShadow: 'var(--shadow-card, 0 18px 40px rgba(0, 0, 0, 0.16))',
  minWidth: 0,
  color: 'var(--text-main, #f9fafb)'
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
  fontSize: '21px',
  letterSpacing: '-0.02em',
  color: 'var(--text-main, #f9fafb)'
}

const sectionSubtitleStyle = {
  margin: '7px 0 0',
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '13px',
  lineHeight: 1.5
}

const checklistStyle = {
  display: 'grid',
  gap: '12px'
}

const checkItemStyle = {
  display: 'grid',
  gridTemplateColumns: '34px 1fr',
  gap: '12px',
  alignItems: 'flex-start',
  padding: '12px',
  borderRadius: '14px',
  background: 'var(--bg-card-soft, rgba(17, 24, 39, 0.66))',
  border: '1px solid var(--border-main, rgba(55, 65, 81, 0.7))'
}

const checkIconDoneStyle = {
  width: '30px',
  height: '30px',
  borderRadius: '999px',
  background: 'var(--success-soft, rgba(34, 197, 94, 0.14))',
  color: 'var(--success, #86efac)',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 900
}

const checkIconWarningStyle = {
  ...checkIconDoneStyle,
  background: 'var(--warning-soft, rgba(245, 158, 11, 0.14))',
  color: 'var(--warning, #fde68a)'
}

const checkLabelStyle = {
  color: 'var(--text-main, #f9fafb)',
  fontWeight: 850
}

const checkDetailStyle = {
  marginTop: '4px',
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '12px',
  lineHeight: 1.45
}

const scoreBadgeStyle = {
  padding: '8px 11px',
  borderRadius: '999px',
  background: 'var(--accent-soft, rgba(56, 189, 248, 0.12))',
  color: 'var(--accent, #7dd3fc)',
  border: '1px solid color-mix(in srgb, var(--accent, #38bdf8) 30%, transparent)',
  fontWeight: 900
}

const warningGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '12px'
}

const warningBoxStyle = {
  padding: '14px',
  borderRadius: '14px',
  background: 'var(--bg-card-soft, rgba(17, 24, 39, 0.66))',
  border: '1px solid var(--border-main, rgba(55, 65, 81, 0.7))'
}

const warningBoxTitleStyle = {
  color: 'var(--text-main, #f9fafb)',
  fontWeight: 850,
  marginBottom: '10px'
}

const successTextStyle = {
  color: 'var(--success, #86efac)',
  fontSize: '12px',
  lineHeight: 1.45
}

const tagWrapStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px'
}

const categoryTagStyle = {
  padding: '6px 9px',
  borderRadius: '999px',
  background: 'var(--warning-soft, rgba(245, 158, 11, 0.12))',
  color: 'var(--warning, #fde68a)',
  border: '1px solid color-mix(in srgb, var(--warning, #f59e0b) 28%, transparent)',
  fontSize: '12px',
  fontWeight: 750
}

const controlGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: '12px',
  alignItems: 'end'
}

const controlButtonStackStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '9px'
}

const hintStyle = {
  marginTop: '7px',
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '12px',
  lineHeight: 1.45
}

const primaryButtonStyle = {
  padding: '10px 13px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--accent, #2563eb)',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 850,
  whiteSpace: 'nowrap'
}

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  border: '1px solid var(--border-main, #374151)',
  background: 'var(--bg-card-soft, #374151)',
  color: 'var(--text-main, #f9fafb)'
}

const greenButtonStyle = {
  ...primaryButtonStyle,
  background: 'var(--success, #16a34a)',
  color: '#ffffff'
}

const disabledButtonStyle = {
  ...primaryButtonStyle,
  background: 'var(--bg-card-soft, #374151)',
  color: 'var(--text-muted, #9ca3af)',
  border: '1px solid var(--border-main, #374151)',
  cursor: 'not-allowed'
}

const tableWrapStyle = {
  overflowX: 'auto',
  borderRadius: '14px',
  border: '1px solid var(--border-main, transparent)'
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  background: 'var(--bg-card, transparent)'
}

const thStyle = {
  textAlign: 'left',
  padding: '11px',
  borderBottom: '1px solid var(--border-main, #374151)',
  color: 'var(--text-muted, #d1d5db)',
  fontSize: '13px',
  background: 'var(--bg-card-soft, transparent)'
}

const tdStyle = {
  padding: '11px',
  borderBottom: '1px solid var(--border-main, #374151)',
  color: 'var(--text-main, #f9fafb)',
  fontSize: '13px'
}

const successBoxStyle = {
  padding: '16px',
  borderRadius: '14px',
  background: 'var(--success-soft, rgba(34, 197, 94, 0.08))',
  border: '1px solid color-mix(in srgb, var(--success, #22c55e) 24%, transparent)',
  color: 'var(--success, #86efac)',
  lineHeight: 1.5
}

const emptyStyle = {
  padding: '16px',
  borderRadius: '14px',
  background: 'var(--bg-card-soft, rgba(17, 24, 39, 0.66))',
  border: '1px solid var(--border-main, rgba(55, 65, 81, 0.7))',
  color: 'var(--text-muted, #d1d5db)',
  lineHeight: 1.5
}

const billSummaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: '10px',
  marginBottom: '14px'
}

const billSummaryValueStyle = {
  fontWeight: 950,
  fontSize: '20px',
  color: 'var(--text-main, #f9fafb)'
}

const billSummaryLabelStyle = {
  marginTop: '4px',
  fontSize: '11px',
  fontWeight: 800,
  color: 'var(--text-muted, #d1d5db)'
}

const billListStyle = {
  display: 'grid',
  gap: '11px',
  maxHeight: '680px',
  overflowY: 'auto',
  paddingRight: '4px'
}

const billRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 280px)',
  gap: '12px',
  alignItems: 'center',
  padding: '14px',
  borderRadius: '15px',
  background: 'var(--bg-card-soft, rgba(17, 24, 39, 0.78))',
  border: '1px solid var(--border-main, rgba(55, 65, 81, 0.78))'
}

const billTitleRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
  marginBottom: '6px'
}

const billNameStyle = {
  color: 'var(--text-main, #f9fafb)',
  fontSize: '15px'
}

const mutedTextStyle = {
  color: 'var(--text-muted, #cbd5e1)',
  fontSize: '12px',
  lineHeight: 1.45
}

const detailTextStyle = {
  color: 'var(--accent, #93c5fd)',
  fontSize: '12px',
  lineHeight: 1.45,
  marginTop: '4px',
  fontWeight: 800
}

const reviewTextStyle = {
  color: 'var(--warning, #fde68a)',
  fontSize: '12px',
  lineHeight: 1.45,
  marginTop: '5px'
}

const billRightControlStyle = {
  display: 'grid',
  gap: '7px'
}

const accountSelectStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 11px',
  borderRadius: '10px',
  border: '1px solid var(--border-soft, #4b5563)',
  background: 'var(--bg-elevated, #111827)',
  color: 'var(--text-main, #f9fafb)',
  colorScheme: 'auto',
  outline: 'none'
}

const accountPreviewStyle = {
  color: 'var(--text-muted, #9ca3af)',
  fontSize: '11px',
  lineHeight: 1.35
}

const debtBillSectionStyle = {
  marginTop: '16px',
  padding: '14px',
  borderRadius: '16px',
  background: 'var(--warning-soft, rgba(245, 158, 11, 0.08))',
  border: '1px solid color-mix(in srgb, var(--warning, #f59e0b) 26%, transparent)'
}

const debtBillHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  marginBottom: '12px',
  flexWrap: 'wrap'
}

const debtBillTitleStyle = {
  margin: 0,
  color: 'var(--text-main, #f9fafb)',
  fontSize: '17px',
  letterSpacing: '-0.02em'
}

const debtBillSubtitleStyle = {
  margin: '6px 0 0',
  color: 'var(--warning, #fde68a)',
  fontSize: '12px',
  lineHeight: 1.45
}

const debtBillListStyle = {
  display: 'grid',
  gap: '10px'
}

const debtBillRowStyle = {
  padding: '13px',
  borderRadius: '14px',
  background: 'var(--bg-card, rgba(17, 24, 39, 0.72))',
  border: '1px solid color-mix(in srgb, var(--warning, #f59e0b) 22%, transparent)'
}

const baseBadgeStyle = {
  display: 'inline-block',
  padding: '5px 8px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 900,
  whiteSpace: 'nowrap'
}

const readyBadgeStyle = {
  ...baseBadgeStyle,
  background: 'var(--success-soft, rgba(34, 197, 94, 0.14))',
  color: 'var(--success, #86efac)',
  border: '1px solid color-mix(in srgb, var(--success, #22c55e) 28%, transparent)'
}

const successBadgeStyle = {
  ...baseBadgeStyle,
  background: 'var(--accent-soft, rgba(56, 189, 248, 0.14))',
  color: 'var(--accent, #7dd3fc)',
  border: '1px solid color-mix(in srgb, var(--accent, #38bdf8) 28%, transparent)'
}

const warningBadgeStyle = {
  ...baseBadgeStyle,
  background: 'var(--warning-soft, rgba(245, 158, 11, 0.14))',
  color: 'var(--warning, #fde68a)',
  border: '1px solid color-mix(in srgb, var(--warning, #f59e0b) 28%, transparent)'
}

const dangerBadgeStyle = {
  ...baseBadgeStyle,
  background: 'var(--danger-soft, rgba(239, 68, 68, 0.14))',
  color: 'var(--danger, #fca5a5)',
  border: '1px solid color-mix(in srgb, var(--danger, #ef4444) 28%, transparent)'
}

const neutralBadgeStyle = {
  ...baseBadgeStyle,
  background: 'color-mix(in srgb, var(--text-muted, #94a3b8) 12%, transparent)',
  color: 'var(--text-muted, #cbd5e1)',
  border: '1px solid color-mix(in srgb, var(--text-muted, #94a3b8) 25%, transparent)'
}
