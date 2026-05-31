import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_APP_SETTINGS, loadUserSettings } from '../lib/appSettings'
import {
  buildMoneyPlanSummary,
  getPreviousMonthKey,
  getMonthKey,
  getTodayKey,
  toNumber
} from '../lib/moneyPlanCalculations'

const ALLOCATION_MODES = {
  conservative: {
    label: 'Conservative',
    description: 'Ưu tiên giữ cash buffer và giảm rủi ro trước.',
    buffer: 40,
    debt: 25,
    goals: 20,
    investment: 15
  },
  balanced: {
    label: 'Balanced',
    description: 'Cân bằng giữa buffer, debt, goals và đầu tư.',
    buffer: 25,
    debt: 25,
    goals: 25,
    investment: 25
  },
  aggressive: {
    label: 'Aggressive',
    description: 'Ưu tiên goals và investment nhiều hơn, chỉ hợp khi cashflow ổn.',
    buffer: 15,
    debt: 20,
    goals: 25,
    investment: 40
  }
}

function formatMoney(value) {
  return toNumber(value).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatPercent(value) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`
}

function getMonthRange(date = new Date()) {
  const year = date.getFullYear()
  const monthIndex = date.getMonth()
  const start = new Date(year, monthIndex, 1)
  const end = new Date(year, monthIndex + 1, 1)

  return {
    year,
    month: monthIndex + 1,
    monthIndex,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    label: date.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric'
    })
  }
}

function buildInsights(plan) {
  const insights = []

  if (plan.actualIncome <= 0) {
    insights.push({
      tone: 'warning',
      title: 'Income chưa có trong tháng này',
      text: 'Money Plan cần income tháng hiện tại để tính Safe-to-Spend chính xác hơn.'
    })
  }

  if (plan.unpostedBillReserve > 0) {
    insights.push({
      tone: 'warning',
      title: 'Còn bill chưa đưa vào Cashflow',
      text: `Bạn còn ${formatMoney(plan.unpostedBillReserve)} active monthly bills chưa được post vào Cashflow tháng này.`
    })
  }

  if (plan.overdueUnpostedBills.length > 0) {
    insights.push({
      tone: 'danger',
      title: 'Có bill quá hạn nhưng chưa post',
      text: `${plan.overdueUnpostedBills.length} bill đã qua due date nhưng chưa thấy trong Cashflow. Nên kiểm tra ở Bills hoặc Month Setup.`
    })
  }

  if (plan.safeToSpend < 0) {
    insights.push({
      tone: 'danger',
      title: 'Safe-to-Spend đang âm',
      text: `Bạn đang thiếu khoảng ${formatMoney(Math.abs(plan.safeToSpend))} sau khi giữ tiền cho bill/debt cần thiết.`
    })
  } else if (plan.safeToSpend > 0) {
    insights.push({
      tone: 'success',
      title: 'Có tiền dư để phân bổ',
      text: `Safe-to-Spend hiện khoảng ${formatMoney(plan.safeToSpend)}. Có thể chia cho buffer, debt, goals hoặc investment theo mode đã chọn.`
    })
  }

  if (plan.cashBufferGap > 0) {
    insights.push({
      tone: 'info',
      title: 'Cash buffer chưa đủ mục tiêu',
      text: `Cash buffer còn thiếu khoảng ${formatMoney(plan.cashBufferGap)} so với target 1 tháng essential reserve.`
    })
  }

  if (plan.overBudgetRows.length > 0) {
    const top = plan.overBudgetRows[0]
    insights.push({
      tone: 'danger',
      title: 'Có budget bị vượt',
      text: `${top.category} đang dùng ${formatPercent(top.usagePercent)} của plan. Nên hạn chế chi thêm ở category này.`
    })
  }

  if (plan.goalMonthlyNeedTotal > plan.allocation.goals && plan.allocatableAmount > 0) {
    insights.push({
      tone: 'warning',
      title: 'Goal need cao hơn phần gợi ý',
      text: `Goals cần khoảng ${formatMoney(plan.goalMonthlyNeedTotal)}/tháng, nhưng allocation mode hiện chỉ gợi ý ${formatMoney(plan.allocation.goals)}.`
    })
  }

  if (!insights.length) {
    insights.push({
      tone: 'neutral',
      title: 'Dữ liệu hiện khá ổn',
      text: 'Money Plan chưa phát hiện vấn đề lớn. Tiếp tục cập nhật income, expense, bills và goals đều đặn.'
    })
  }

  return insights
}

function getToneStyle(tone) {
  if (tone === 'success') return styles.successPill
  if (tone === 'danger') return styles.dangerPill
  if (tone === 'warning') return styles.warningPill
  if (tone === 'info') return styles.infoPill
  return styles.neutralPill
}

export default function MoneyPlanPage() {
  const monthInfo = useMemo(() => getMonthRange(), [])
  const today = useMemo(() => new Date(`${getTodayKey()}T00:00:00`), [])

  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [cashflowEntries, setCashflowEntries] = useState([])
  const [allCashflowEntries, setAllCashflowEntries] = useState([])
  const [budgets, setBudgets] = useState([])
  const [bills, setBills] = useState([])
  const [goals, setGoals] = useState([])
  const [liabilities, setLiabilities] = useState([])
  const [liabilityStatements, setLiabilityStatements] = useState([])
  const [accounts, setAccounts] = useState([])
  const [cashWalletLedgers, setCashWalletLedgers] = useState([])
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS)
  const [allocationMode, setAllocationMode] = useState('balanced')

  useEffect(() => {
    loadMoneyPlan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadMoneyPlan() {
    setLoading(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user.')
      }

const loadedSettings = await loadUserSettings()
setAppSettings(loadedSettings)

if (
  loadedSettings.moneyPlanDefaultMode &&
  ALLOCATION_MODES[loadedSettings.moneyPlanDefaultMode]
) {
  setAllocationMode(loadedSettings.moneyPlanDefaultMode)
}

      const [
        cashflowResult,
        allCashflowResult,
        budgetResult,
        billResult,
        goalResult,
        liabilityResult,
        liabilityStatementResult,
        accountResult,
        cashLedgerResult
      ] = await Promise.all([
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
              group_name,
              icon,
              color
            )
          `)
          .eq('user_id', user.id)
          .gte('entry_date', monthInfo.startDate)
          .lt('entry_date', monthInfo.endDate)
          .order('entry_date', { ascending: false })
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
            created_at
          `)
          .eq('user_id', user.id)
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false }),

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
          .eq('month', monthInfo.month)
          .eq('year', monthInfo.year)
          .order('category', { ascending: true }),

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
          .from('financial_goals')
          .select('*')
          .eq('user_id', user.id)
          .order('priority', { ascending: true })
          .order('target_date', { ascending: true, nullsFirst: false }),

        supabase
          .from('liabilities')
          .select('*')
          .eq('user_id', user.id)
          .order('current_balance', { ascending: false }),

        supabase
          .from('liability_monthly_statements')
          .select('*')
          .eq('user_id', user.id)
          .eq('month_key', getMonthKey(monthInfo))
          .order('created_at', { ascending: false }),

        supabase
          .from('accounts')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),

        supabase
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
          .in('month_key', [getMonthKey(monthInfo), getPreviousMonthKey(monthInfo)])
          .order('created_at', { ascending: false })
      ])

      if (cashflowResult.error) throw cashflowResult.error
      if (allCashflowResult.error) throw allCashflowResult.error
      if (budgetResult.error) throw budgetResult.error
      if (billResult.error) throw billResult.error
      if (goalResult.error) throw goalResult.error
      if (liabilityResult.error) throw liabilityResult.error
      if (liabilityStatementResult.error) throw liabilityStatementResult.error
      if (accountResult.error) throw accountResult.error
      if (cashLedgerResult.error) {
        console.warn('Cash Wallet Ledger unavailable in Money Plan:', cashLedgerResult.error.message)
      }

      setCashflowEntries(cashflowResult.data || [])
      setAllCashflowEntries(allCashflowResult.data || [])
      setBudgets(budgetResult.data || [])
      setBills(billResult.data || [])
      setGoals(goalResult.data || [])
      setLiabilities(liabilityResult.data || [])
      setLiabilityStatements(liabilityStatementResult.data || [])
      setAccounts(accountResult.data || [])
      setCashWalletLedgers(cashLedgerResult.error ? [] : cashLedgerResult.data || [])
    } catch (error) {
      console.error('MoneyPlanPage load error:', error)
      setMessage(error.message || 'Failed to load money plan.')
    } finally {
      setLoading(false)
    }
  }

  const plan = useMemo(() => {
    const summary = buildMoneyPlanSummary({
      accounts,
      allCashflowEntries,
      allocationMode,
      allocationModes: ALLOCATION_MODES,
      bills,
      budgets,
      cashflowEntries,
      cashWalletLedgers,
      goals,
      liabilities,
      liabilityStatements,
      monthInfo,
      today
    })

    return {
      ...summary,
      insights: buildInsights(summary)
    }
  }, [
    accounts,
    allCashflowEntries,
    allocationMode,
    bills,
    budgets,
    cashflowEntries,
    cashWalletLedgers,
    goals,
    liabilities,
    liabilityStatements,
    monthInfo,
    today
  ])

  const selectedMode = ALLOCATION_MODES[allocationMode]
  const topBudgetRows = plan.budgetRows.slice(0, 6)
  const topGoals = plan.activeGoals.slice(0, 5)
  const topBills = plan.unpostedBills.slice(0, 6)
  const hiddenBillCount = Math.max(plan.unpostedBills.length - topBills.length, 0)
  const topDebts = plan.liabilities.slice(0, 5)

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Bài 37 · Money Plan Pro</div>
          <h1 style={styles.title}>Money Plan Pro</h1>
          <p style={styles.subtitle}>
            Monthly command center for safe-to-spend, bill reserve, debt minimums, goals,
            cash buffer and suggested allocation. This page only reads your current data and does not create new records.
          </p>
        </div>

        <div style={styles.headerRight}>
          <div style={styles.monthBadge}>{monthInfo.label}</div>
          <button type="button" style={styles.refreshButton} onClick={loadMoneyPlan}>
            Refresh Plan
          </button>
        </div>
      </div>

      {message ? <div style={styles.message}>{message}</div> : null}

      {loading ? (
        <div style={styles.loadingCard}>Loading Money Plan Pro...</div>
      ) : (
        <>
          <section style={styles.heroGrid}>
            <div style={styles.heroCard}>
              <div style={styles.cardLabel}>Safe-to-Spend</div>
              <div style={styles.heroStatusRow}>
                <div style={styles.heroValue}>{plan.planStatus}</div>
                <span style={{ ...styles.statusPill, ...getToneStyle(plan.planTone) }}>
                  {plan.safeToSpend >= 0 ? 'Positive' : 'Shortfall'}
                </span>
              </div>

              <div
                style={{
                  ...styles.bigNumber,
                  color: plan.safeToSpend >= 0 ? 'var(--success)' : 'var(--danger)'
                }}
              >
                {formatMoney(plan.safeToSpend)}
              </div>

              <div style={styles.heroSubtext}>
                Current cash balance minus unposted active bills and remaining debt minimum reserve.
              </div>
            </div>

            <StatBox
              label="Income This Month"
              value={formatMoney(plan.actualIncome)}
              sub={`${plan.accountCount} account${plan.accountCount === 1 ? '' : 's'} connected`}
              tone="success"
            />

            <StatBox
              label="Posted Expenses"
              value={formatMoney(plan.actualExpenses)}
              sub={`Posted net: ${formatMoney(plan.postedNet)}`}
              tone={plan.postedNet >= 0 ? 'success' : 'danger'}
            />

            <StatBox
              label="Essential Reserve"
              value={formatMoney(plan.essentialReserve)}
              sub={`Bills ${formatMoney(plan.unpostedBillReserve)} · Debt ${formatMoney(plan.debtMinimumRemaining)}`}
              tone={plan.essentialReserve > 0 ? 'warning' : 'success'}
            />
          </section>

          <section style={styles.gridTwo}>
            <div style={styles.card}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Allocation Mode</h2>
<p style={styles.sectionSubtitle}>
  {selectedMode.description} Default mode from Settings: {appSettings.moneyPlanDefaultMode}.
</p>                </div>
              </div>

              <div style={styles.modeRow}>
                {Object.entries(ALLOCATION_MODES).map(([key, mode]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAllocationMode(key)}
                    style={allocationMode === key ? styles.activeModeButton : styles.modeButton}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {plan.allocatableAmount <= 0 ? (
                <div style={styles.emptyState}>
                  No positive Safe-to-Spend available for allocation yet. Focus on required bills,
                  minimum payments and reducing flexible spending first.
                </div>
              ) : (
                <div style={styles.allocationGrid}>
                  <AllocationItem
                    label="Cash Buffer"
                    value={plan.allocation.buffer}
                    percent={`${selectedMode.buffer}%`}
                    note="Build safety first"
                  />
                  <AllocationItem
                    label="Extra Debt"
                    value={plan.allocation.debt}
                    percent={`${selectedMode.debt}%`}
                    note="Reduce interest"
                  />
                  <AllocationItem
                    label="Goals"
                    value={plan.allocation.goals}
                    percent={`${selectedMode.goals}%`}
                    note="Fund priorities"
                  />
                  <AllocationItem
                    label="Investment DCA"
                    value={plan.allocation.investment}
                    percent={`${selectedMode.investment}%`}
                    note="Long-term growth"
                  />
                </div>
              )}
            </div>

            <div style={styles.card}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Action Center</h2>
                  <p style={styles.sectionSubtitle}>What needs attention this month.</p>
                </div>
              </div>

              <div style={styles.insightList}>
                {plan.insights.map((item, index) => (
                  <div key={`${item.title}-${index}`} style={styles.insightItem}>
                    <span style={{ ...styles.dot, ...getToneStyle(item.tone) }} />
                    <div>
                      <div style={styles.insightTitle}>{item.title}</div>
                      <div style={styles.insightText}>{item.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section style={styles.gridFour}>
            <MiniPanel
              label="Spendable Cash"
              value={formatMoney(plan.cashBufferCurrent)}
              sub={`${formatPercent(plan.cashBufferPercent)} of ${formatMoney(plan.cashBufferTarget)} target · ${plan.cashBufferHasLedger ? 'ledger synced' : 'cashflow fallback'}`}
              tone={plan.cashBufferGap <= 0 ? 'success' : 'warning'}
            />
            <MiniPanel
              label="Unposted Bills"
              value={formatMoney(plan.unpostedBillReserve)}
              sub={`${plan.unpostedBills.length} active monthly bill${plan.unpostedBills.length === 1 ? '' : 's'} not posted`}
              tone={plan.unpostedBillReserve > 0 ? 'warning' : 'success'}
            />
            <MiniPanel
              label="Reserve Cash"
              value={formatMoney(plan.reserveCash)}
              sub={`Savings available if needed · liquid total ${formatMoney(plan.totalLiquidCash)}`}
              tone={plan.reserveCash > 0 ? 'info' : 'neutral'}
            />
            <MiniPanel
              label="Budget Remaining"
              value={formatMoney(plan.budgetRemaining)}
              sub={`${formatPercent(plan.budgetUsagePercent)} used`}
              tone={plan.budgetRemaining >= 0 ? 'success' : 'danger'}
            />
            <MiniPanel
              label="Goal Monthly Need"
              value={formatMoney(plan.goalMonthlyNeedTotal)}
              sub={`${plan.activeGoals.length} active goal${plan.activeGoals.length === 1 ? '' : 's'}`}
              tone={plan.goalMonthlyNeedTotal > 0 ? 'info' : 'success'}
            />
          </section>

          <section style={styles.gridThree}>
            <PlanPanel title="Bills Reserve" subtitle={formatMoney(plan.unpostedBillReserve)}>
              {topBills.length ? (
                <>
                  <div style={styles.panelNote}>
                    Includes all unpaid monthly bills for this month.
                    {hiddenBillCount > 0
                      ? ` Showing ${topBills.length} of ${plan.unpostedBills.length}; ${hiddenBillCount} more included in reserve.`
                      : ''}
                  </div>
                  <div style={styles.list}>
                  {topBills.map((bill) => (
                    <div key={bill.id} style={styles.listRow}>
                      <div>
                        <div style={styles.listTitle}>{bill.name}</div>
                        <div style={styles.listSub}>
                          Due {bill.dueDateLabel} · {bill.categoryLabel}
                        </div>
                      </div>
                      <div style={styles.rightText}>
                        <div style={bill.isPastDue ? styles.negativeText : styles.warningText}>
                          {formatMoney(bill.amount)}
                        </div>
                        <div style={styles.miniText}>{bill.isPastDue ? 'past due' : 'reserve'}</div>
                      </div>
                    </div>
                  ))}
                  </div>
                </>
              ) : (
                <div style={styles.emptyState}>
                  All active monthly bills appear to be posted to Cashflow for this month.
                </div>
              )}
            </PlanPanel>

            <PlanPanel title="Budget Watch" subtitle={`${formatPercent(plan.budgetUsagePercent)} used`}>
              {topBudgetRows.length ? (
                <div style={styles.list}>
                  {topBudgetRows.map((row) => (
                    <div key={row.id || row.category} style={styles.listRow}>
                      <div>
                        <div style={styles.listTitle}>{row.category}</div>
                        <div style={styles.listSub}>
                          {formatMoney(row.actual)} / {formatMoney(row.planned)}
                        </div>
                      </div>
                      <div style={styles.rightText}>
                        <div style={row.remaining >= 0 ? styles.positiveText : styles.negativeText}>
                          {row.remaining >= 0
                            ? `${formatMoney(row.remaining)} left`
                            : `${formatMoney(Math.abs(row.remaining))} over`}
                        </div>
                        <div style={styles.miniText}>{row.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.emptyState}>No budget rows for this month yet.</div>
              )}
            </PlanPanel>

            <PlanPanel
              title="Goals Pace"
              subtitle={`${topGoals.length} active priority goal${topGoals.length === 1 ? '' : 's'}`}
            >
              {topGoals.length ? (
                <div style={styles.list}>
                  {topGoals.map((goal) => (
                    <div key={goal.id} style={styles.listRow}>
                      <div>
                        <div style={styles.listTitle}>{goal.name}</div>
                        <div style={styles.listSub}>
                          {formatPercent(goal.progress)} funded · {goal.priority || 'Medium'}
                        </div>
                      </div>
                      <div style={styles.rightText}>
                        <div style={styles.infoText}>{formatMoney(goal.monthlyNeeded)}</div>
                        <div style={styles.miniText}>needed/mo</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.emptyState}>No active goal needing monthly funding.</div>
              )}
            </PlanPanel>
          </section>

          <section style={styles.gridTwo}>
            <div style={styles.card}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Debt Snapshot</h2>
                  <p style={styles.sectionSubtitle}>
                    Minimum payments and balances from your liabilities data.
                  </p>
                </div>
                <div style={styles.sectionMetric}>
                  {formatMoney(plan.debtMinimumTotal)}
                  <span> minimum/mo</span>
                </div>
              </div>

              {topDebts.length ? (
                <div style={styles.list}>
                  {topDebts.map((debt) => (
                    <div key={debt.id} style={styles.listRow}>
                      <div>
                        <div style={styles.listTitle}>{debt.name}</div>
                        <div style={styles.listSub}>
                          {debt.liability_type || 'Debt'} · APR {formatPercent(debt.interest_rate)}
                        </div>
                      </div>
                      <div style={styles.rightText}>
                        <div style={styles.negativeText}>{formatMoney(debt.current_balance)}</div>
                        <div style={styles.miniText}>Min {formatMoney(debt.minimum_payment)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.emptyState}>No liabilities found.</div>
              )}
            </div>

            <div style={styles.card}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Safe-to-Spend Formula</h2>
                  <p style={styles.sectionSubtitle}>
                    Uses spendable cash first. Savings is shown as reserve cash, but it is not automatically counted as Safe-to-Spend.
                  </p>
                </div>
              </div>

              <div style={styles.formulaBox}>
                <FormulaRow label="Spendable cash" value={plan.cashBufferCurrent} />
                <FormulaRow label="Unposted active bills" value={-plan.unpostedBillReserve} />
                <FormulaRow label="Debt minimum remaining" value={-plan.debtMinimumRemaining} />
                <div style={styles.formulaDivider} />
                <FormulaRow label="Safe-to-Spend" value={plan.safeToSpend} strong />
              </div>

              <div style={styles.noteBox}>
                Source: {plan.cashBufferSourceLabel} Reserve cash is {formatMoney(plan.reserveCash)} and total liquid cash is {formatMoney(plan.totalLiquidCash)}.
                Reserve can still be used for investing or emergencies, but it is not treated as automatic spending money.
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function StatBox({ label, value, sub, tone }) {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'danger'
        ? 'var(--danger)'
        : tone === 'warning'
          ? 'var(--warning)'
          : 'var(--accent-strong)'

  return (
    <div style={styles.statCard}>
      <div style={styles.cardLabel}>{label}</div>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statSub}>{sub}</div>
    </div>
  )
}

function MiniPanel({ label, value, sub, tone }) {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'danger'
        ? 'var(--danger)'
        : tone === 'warning'
          ? 'var(--warning)'
          : 'var(--accent-strong)'

  return (
    <div style={styles.miniPanel}>
      <div style={styles.cardLabel}>{label}</div>
      <div style={{ ...styles.miniPanelValue, color }}>{value}</div>
      <div style={styles.statSub}>{sub}</div>
    </div>
  )
}

function AllocationItem({ label, value, percent, note }) {
  return (
    <div style={styles.allocationItem}>
      <div style={styles.allocationTop}>
        <div style={styles.allocationLabel}>{label}</div>
        <div style={styles.allocationPercent}>{percent}</div>
      </div>
      <div style={styles.allocationValue}>{formatMoney(value)}</div>
      <div style={styles.allocationNote}>{note}</div>
    </div>
  )
}

function PlanPanel({ title, subtitle, children }) {
  return (
    <div style={styles.card}>
      <div style={styles.panelHeader}>
        <div>
          <h2 style={styles.sectionTitle}>{title}</h2>
          <p style={styles.sectionSubtitle}>{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function FormulaRow({ label, value, strong = false, positive = false }) {
  const isPositive = value >= 0 || positive

  return (
    <div style={strong ? styles.formulaRowStrong : styles.formulaRow}>
      <span>{label}</span>
      <strong style={isPositive ? styles.positiveText : styles.negativeText}>
        {value < 0 ? '-' : ''}
        {formatMoney(Math.abs(value))}
      </strong>
    </div>
  )
}

const styles = {
  page: {
    color: 'var(--text-main)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    alignItems: 'flex-start',
    marginBottom: 24
  },
  kicker: {
    color: 'var(--accent-strong)',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 8
  },
  title: {
    margin: 0,
    color: 'var(--text-main)',
    fontSize: 36,
    lineHeight: 1.05,
    letterSpacing: '-0.04em',
    fontWeight: 900
  },
  subtitle: {
    margin: '10px 0 0',
    maxWidth: 820,
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    fontSize: 14
  },
  headerRight: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  monthBadge: {
    border: '1px solid var(--border-main)',
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 800,
    fontSize: 13,
    boxShadow: 'var(--shadow-soft)'
  },
  refreshButton: {
    border: '1px solid var(--accent-strong)',
    background: 'var(--accent-strong)',
    color: 'white',
    borderRadius: 12,
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: 'var(--shadow-soft)'
  },
  message: {
    border: '1px solid var(--warning)',
    background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
    color: 'var(--warning)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 18
  },
  loadingCard: {
    border: '1px solid var(--border-main)',
    background: 'var(--bg-card)',
    borderRadius: 18,
    padding: 24,
    color: 'var(--text-muted)',
    boxShadow: 'var(--shadow-card)'
  },
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 1.35fr) repeat(3, minmax(190px, 1fr))',
    gap: 16,
    marginBottom: 16
  },
  heroCard: {
    border: '1px solid var(--border-main)',
    borderRadius: 20,
    padding: 22,
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    boxShadow: 'var(--shadow-card)'
  },
  statCard: {
    border: '1px solid var(--border-main)',
    borderRadius: 20,
    padding: 18,
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    boxShadow: 'var(--shadow-card)'
  },
  miniPanel: {
    border: '1px solid var(--border-main)',
    borderRadius: 18,
    padding: 18,
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    boxShadow: 'var(--shadow-card)'
  },
  card: {
    border: '1px solid var(--border-main)',
    borderRadius: 20,
    padding: 20,
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    boxShadow: 'var(--shadow-card)'
  },
  cardLabel: {
    color: 'var(--text-soft)',
    fontSize: 13,
    fontWeight: 800
  },
  heroStatusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 12
  },
  heroValue: {
    color: 'var(--text-main)',
    fontSize: 30,
    fontWeight: 900,
    letterSpacing: '-0.04em'
  },
  heroSubtext: {
    marginTop: 12,
    color: 'var(--text-muted)',
    fontSize: 13,
    lineHeight: 1.55,
    maxWidth: 520
  },
  bigNumber: {
    marginTop: 18,
    fontSize: 44,
    fontWeight: 950,
    letterSpacing: '-0.05em'
  },
  statValue: {
    marginTop: 14,
    fontSize: 27,
    fontWeight: 900,
    letterSpacing: '-0.04em'
  },
  miniPanelValue: {
    marginTop: 12,
    fontSize: 25,
    fontWeight: 900,
    letterSpacing: '-0.04em'
  },
  statSub: {
    marginTop: 9,
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.45
  },
  gridTwo: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 16,
    marginBottom: 16
  },
  gridThree: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 16,
    marginBottom: 16
  },
  gridFour: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 16,
    marginBottom: 16
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'flex-start',
    marginBottom: 16
  },
  panelHeader: {
    marginBottom: 16
  },
  sectionTitle: {
    margin: 0,
    color: 'var(--text-main)',
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: '-0.02em'
  },
  sectionSubtitle: {
    margin: '6px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.45
  },
  sectionMetric: {
    color: 'var(--text-main)',
    fontWeight: 900,
    textAlign: 'right'
  },
  modeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16
  },
  modeButton: {
    border: '1px solid var(--border-soft)',
    background: 'var(--bg-card-soft)',
    color: 'var(--text-main)',
    borderRadius: 999,
    padding: '10px 13px',
    cursor: 'pointer',
    fontWeight: 850
  },
  activeModeButton: {
    border: '1px solid var(--accent-strong)',
    background: 'var(--accent-strong)',
    color: 'white',
    borderRadius: 999,
    padding: '10px 13px',
    cursor: 'pointer',
    fontWeight: 850
  },
  allocationGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12
  },
  allocationItem: {
    border: '1px solid var(--border-main)',
    borderRadius: 16,
    padding: 14,
    background: 'var(--bg-card-soft)',
    color: 'var(--text-main)'
  },
  allocationTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center'
  },
  allocationLabel: {
    fontSize: 13,
    color: 'var(--text-soft)',
    fontWeight: 800
  },
  allocationPercent: {
    color: 'var(--accent-strong)',
    fontWeight: 900,
    fontSize: 12
  },
  allocationValue: {
    marginTop: 10,
    color: 'var(--text-main)',
    fontSize: 22,
    fontWeight: 900
  },
  allocationNote: {
    marginTop: 5,
    color: 'var(--text-muted)',
    fontSize: 12
  },
  insightList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  },
  insightItem: {
    display: 'grid',
    gridTemplateColumns: '12px 1fr',
    gap: 11,
    alignItems: 'flex-start',
    border: '1px solid var(--border-main)',
    borderRadius: 16,
    padding: 13,
    background: 'var(--bg-card-soft)',
    color: 'var(--text-main)'
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 5
  },
  insightTitle: {
    color: 'var(--text-main)',
    fontWeight: 900,
    fontSize: 13
  },
  insightText: {
    marginTop: 5,
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.5
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  listRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    border: '1px solid var(--border-main)',
    borderRadius: 15,
    padding: 12,
    background: 'var(--bg-card-soft)',
    color: 'var(--text-main)'
  },
  listTitle: {
    color: 'var(--text-main)',
    fontWeight: 850,
    fontSize: 13
  },
  listSub: {
    marginTop: 5,
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.35
  },
  rightText: {
    textAlign: 'right',
    flexShrink: 0,
    fontWeight: 850
  },
  miniText: {
    color: 'var(--text-muted)',
    fontSize: 11,
    marginTop: 4,
    fontWeight: 700
  },
  panelNote: {
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.45,
    marginBottom: 10
  },
  emptyState: {
    border: '1px dashed var(--border-soft)',
    borderRadius: 16,
    padding: 16,
    color: 'var(--text-muted)',
    fontSize: 13,
    lineHeight: 1.55,
    background: 'var(--bg-card-soft)'
  },
  formulaBox: {
    border: '1px solid var(--border-main)',
    borderRadius: 16,
    padding: 14,
    background: 'var(--bg-card-soft)',
    color: 'var(--text-main)'
  },
  formulaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    padding: '8px 0',
    color: 'var(--text-soft)',
    fontSize: 13
  },
  formulaRowStrong: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    padding: '10px 0 4px',
    color: 'var(--text-main)',
    fontSize: 15,
    fontWeight: 900
  },
  formulaDivider: {
    height: 1,
    background: 'var(--border-main)',
    margin: '8px 0'
  },
  noteBox: {
    marginTop: 13,
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.55
  },
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 900
  },
  successPill: {
    background: 'color-mix(in srgb, var(--success) 12%, transparent)',
    color: 'var(--success)',
    border: '1px solid var(--success)'
  },
  dangerPill: {
    background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
    color: 'var(--danger)',
    border: '1px solid var(--danger)'
  },
  warningPill: {
    background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
    color: 'var(--warning)',
    border: '1px solid var(--warning)'
  },
  infoPill: {
    background: 'color-mix(in srgb, var(--accent-strong) 12%, transparent)',
    color: 'var(--accent-strong)',
    border: '1px solid var(--accent-strong)'
  },
  neutralPill: {
    background: 'var(--bg-card-soft)',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-soft)'
  },
  positiveText: {
    color: 'var(--success)'
  },
  negativeText: {
    color: 'var(--danger)'
  },
  warningText: {
    color: 'var(--warning)'
  },
  infoText: {
    color: 'var(--accent-strong)'
  }
}
