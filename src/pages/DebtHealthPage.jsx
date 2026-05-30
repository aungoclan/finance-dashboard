import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculateHoldings, calculatePortfolioSummary } from '../lib/holdings'
import { calculateDebtPayoff } from '../lib/debt'

const HIGH_APR_THRESHOLD = 18
const WATCH_APR_THRESHOLD = 10
const DANGER_DEBT_TO_ASSET_RATIO = 70
const WARNING_DEBT_TO_ASSET_RATIO = 45
const DANGER_PAYMENT_BURDEN = 35
const WARNING_PAYMENT_BURDEN = 20

function toNumber(value) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatMoney(value) {
  return toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatCompactMoney(value) {
  const numeric = toNumber(value)

  if (Math.abs(numeric) >= 1000000) {
    return `$${(numeric / 1000000).toFixed(2)}M`
  }

  if (Math.abs(numeric) >= 1000) {
    return `$${(numeric / 1000).toFixed(1)}K`
  }

  return `$${formatMoney(numeric)}`
}

function formatPercent(value) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`
}

function getMonthKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function getMonthRange(monthKey) {
  const [yearText, monthText] = monthKey.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const start = new Date(year, monthIndex, 1)
  const end = new Date(year, monthIndex + 1, 1)

  return {
    startDate: formatDateForInput(start),
    endDate: formatDateForInput(end)
  }
}

function formatDateForInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getLiabilityTypeLabel(type) {
  const labels = {
    credit_card: 'Credit Card',
    auto_loan: 'Auto Loan',
    personal_loan: 'Personal Loan',
    student_loan: 'Student Loan',
    mortgage: 'Mortgage',
    tax: 'Tax Debt',
    medical: 'Medical',
    other: 'Other'
  }

  return labels[type] || type || 'Other'
}

function getDebtTone({ apr, balance, minimumPayment, monthlyInterest }) {
  if (balance <= 0) return 'success'
  if (apr >= HIGH_APR_THRESHOLD) return 'danger'
  if (minimumPayment <= 0) return 'danger'
  if (monthlyInterest > 0 && minimumPayment <= monthlyInterest) return 'danger'
  if (apr >= WATCH_APR_THRESHOLD) return 'warning'
  return 'success'
}

function getDebtStatus({ apr, balance, minimumPayment, monthlyInterest }) {
  if (balance <= 0) return 'Paid Off'
  if (minimumPayment <= 0) return 'Missing Payment'
  if (monthlyInterest > 0 && minimumPayment <= monthlyInterest) return 'Payment Too Low'
  if (apr >= HIGH_APR_THRESHOLD) return 'High APR'
  if (apr >= WATCH_APR_THRESHOLD) return 'Watch APR'
  return 'Healthy'
}

function buildDebtRows(liabilities) {
  return liabilities
    .map((item) => {
      const balance = toNumber(item.current_balance)
      const apr = toNumber(item.interest_rate)
      const minimumPayment = toNumber(item.minimum_payment)
      const monthlyInterest = balance * (apr / 100 / 12)
      const payoff =
        balance > 0 && minimumPayment > 0
          ? calculateDebtPayoff({
              balance,
              apr,
              minimumPayment,
              extraPayment: 0,
              startDate: new Date()
            })
          : null

      const tone = getDebtTone({ apr, balance, minimumPayment, monthlyInterest })
      const status = getDebtStatus({ apr, balance, minimumPayment, monthlyInterest })

      return {
        ...item,
        balance,
        apr,
        minimumPayment,
        monthlyInterest,
        annualInterestEstimate: monthlyInterest * 12,
        payoff,
        status,
        tone,
        typeLabel: getLiabilityTypeLabel(item.liability_type)
      }
    })
    .filter((item) => item.balance > 0)
}

function getHealthSummary({ totalDebt, totalAssets, debtToAssetRatio, paymentBurden, highAprCount, dangerousPaymentCount }) {
  if (totalDebt <= 0) {
    return {
      label: 'Debt Free',
      tone: 'success',
      description: 'No active debt balance found in liabilities.'
    }
  }

  if (
    debtToAssetRatio >= DANGER_DEBT_TO_ASSET_RATIO ||
    paymentBurden >= DANGER_PAYMENT_BURDEN ||
    highAprCount > 0 ||
    dangerousPaymentCount > 0
  ) {
    return {
      label: 'Needs Attention',
      tone: 'danger',
      description: 'Debt pressure or interest cost needs review before adding aggressive new goals.'
    }
  }

  if (
    debtToAssetRatio >= WARNING_DEBT_TO_ASSET_RATIO ||
    paymentBurden >= WARNING_PAYMENT_BURDEN
  ) {
    return {
      label: 'Watch Closely',
      tone: 'warning',
      description: 'Debt is manageable, but the monthly burden or asset ratio is getting elevated.'
    }
  }

  if (totalAssets <= 0) {
    return {
      label: 'Needs More Data',
      tone: 'neutral',
      description: 'Add assets and liabilities to get a stronger debt health score.'
    }
  }

  return {
    label: 'Controlled',
    tone: 'success',
    description: 'Debt pressure looks controlled based on current balances, assets, APRs, and payments.'
  }
}

function getPriorityReason(row) {
  if (row.minimumPayment <= 0) return 'Missing minimum payment — update liability data first.'
  if (row.monthlyInterest > 0 && row.minimumPayment <= row.monthlyInterest) {
    return 'Minimum payment does not cover estimated monthly interest.'
  }
  if (row.apr >= HIGH_APR_THRESHOLD) return 'High APR — likely first priority for extra payoff.'
  if (row.apr >= WATCH_APR_THRESHOLD) return 'Moderate APR — watch interest cost.'
  return 'Lower APR — can usually wait behind higher-interest debt.'
}

export default function DebtHealthPage() {
  const [assetAccounts, setAssetAccounts] = useState([])
  const [liabilities, setLiabilities] = useState([])
  const [investmentMarketValue, setInvestmentMarketValue] = useState(0)
  const [cashflowEntries, setCashflowEntries] = useState([])
  const [monthKey, setMonthKey] = useState(getMonthKey())
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadDebtHealthData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey])

  const loadDebtHealthData = async () => {
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

      const { startDate, endDate } = getMonthRange(monthKey)

      const [assetResult, liabilityResult, txResult, priceResult, cashflowResult] =
        await Promise.all([
          supabase
            .from('asset_accounts')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),

          supabase
            .from('liabilities')
            .select('*')
            .eq('user_id', user.id)
            .order('current_balance', { ascending: false }),

          supabase
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
            .order('created_at', { ascending: true }),

          supabase
            .from('price_quotes')
            .select('id, asset_id, price, created_at')
            .order('created_at', { ascending: false }),

          supabase
            .from('cashflow_entries')
            .select('*')
            .eq('user_id', user.id)
            .gte('entry_date', startDate)
            .lt('entry_date', endDate)
        ])

      if (assetResult.error) throw assetResult.error
      if (liabilityResult.error) throw liabilityResult.error
      if (txResult.error) throw txResult.error
      if (priceResult.error) throw priceResult.error
      if (cashflowResult.error) throw cashflowResult.error

      const holdings = calculateHoldings(txResult.data || [], priceResult.data || [])
      const portfolioSummary = calculatePortfolioSummary(holdings)

      setAssetAccounts(assetResult.data || [])
      setLiabilities(liabilityResult.data || [])
      setInvestmentMarketValue(portfolioSummary.totalMarketValue || 0)
      setCashflowEntries(cashflowResult.data || [])
    } catch (error) {
      console.error('DebtHealthPage load error:', error)
      setMessage(error.message || 'Failed to load debt health data.')
    } finally {
      setLoading(false)
    }
  }

  const summary = useMemo(() => {
    const debtRows = buildDebtRows(liabilities)

    const externalAssetsTotal = assetAccounts.reduce(
      (sum, item) => sum + toNumber(item.current_value),
      0
    )
    const totalAssets = externalAssetsTotal + toNumber(investmentMarketValue)
    const totalDebt = debtRows.reduce((sum, item) => sum + item.balance, 0)
    const netWorthAfterDebt = totalAssets - totalDebt
    const totalMinimumPayment = debtRows.reduce((sum, item) => sum + item.minimumPayment, 0)
    const estimatedMonthlyInterest = debtRows.reduce((sum, item) => sum + item.monthlyInterest, 0)
    const estimatedAnnualInterest = estimatedMonthlyInterest * 12
    const currentMonthIncome = cashflowEntries
      .filter((entry) => entry.type === 'income')
      .reduce((sum, entry) => sum + toNumber(entry.amount), 0)
    const debtToAssetRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0
    const paymentBurden = currentMonthIncome > 0 ? (totalMinimumPayment / currentMonthIncome) * 100 : 0
    const highAprDebts = debtRows.filter((item) => item.apr >= HIGH_APR_THRESHOLD)
    const dangerousPaymentDebts = debtRows.filter(
      (item) => item.monthlyInterest > 0 && item.minimumPayment <= item.monthlyInterest
    )
    const missingPaymentDebts = debtRows.filter((item) => item.minimumPayment <= 0)

    const avalanchePriority = [...debtRows].sort((a, b) => {
      if (a.apr !== b.apr) return b.apr - a.apr
      return b.balance - a.balance
    })

    const snowballPriority = [...debtRows].sort((a, b) => {
      if (a.balance !== b.balance) return a.balance - b.balance
      return b.apr - a.apr
    })

    const health = getHealthSummary({
      totalDebt,
      totalAssets,
      debtToAssetRatio,
      paymentBurden,
      highAprCount: highAprDebts.length,
      dangerousPaymentCount: dangerousPaymentDebts.length
    })

    return {
      debtRows,
      externalAssetsTotal,
      totalAssets,
      investmentMarketValue,
      totalDebt,
      netWorthAfterDebt,
      totalMinimumPayment,
      estimatedMonthlyInterest,
      estimatedAnnualInterest,
      currentMonthIncome,
      debtToAssetRatio,
      paymentBurden,
      highAprDebts,
      dangerousPaymentDebts,
      missingPaymentDebts,
      avalanchePriority,
      snowballPriority,
      health
    }
  }, [assetAccounts, cashflowEntries, investmentMarketValue, liabilities])

  const reviewItems = useMemo(() => {
    const items = []

    if (summary.totalDebt <= 0) {
      items.push({
        tone: 'success',
        title: 'No active debt balance',
        detail: 'No active liabilities with positive balance were found.'
      })
      return items
    }

    if (summary.highAprDebts.length > 0) {
      items.push({
        tone: 'danger',
        title: `${summary.highAprDebts.length} high APR debt${summary.highAprDebts.length > 1 ? 's' : ''}`,
        detail: `APR at or above ${HIGH_APR_THRESHOLD}% should usually be reviewed before extra investing.`
      })
    }

    if (summary.dangerousPaymentDebts.length > 0) {
      items.push({
        tone: 'danger',
        title: 'Payment may not cover interest',
        detail: 'One or more debts have minimum payment less than or equal to estimated monthly interest.'
      })
    }

    if (summary.missingPaymentDebts.length > 0) {
      items.push({
        tone: 'warning',
        title: 'Missing minimum payment data',
        detail: 'Update minimum payment so payoff pressure and strategy can be calculated correctly.'
      })
    }

    if (summary.debtToAssetRatio >= WARNING_DEBT_TO_ASSET_RATIO) {
      items.push({
        tone: summary.debtToAssetRatio >= DANGER_DEBT_TO_ASSET_RATIO ? 'danger' : 'warning',
        title: 'Debt-to-asset ratio elevated',
        detail: `Current ratio is ${formatPercent(summary.debtToAssetRatio)}.`
      })
    }

    if (summary.paymentBurden >= WARNING_PAYMENT_BURDEN) {
      items.push({
        tone: summary.paymentBurden >= DANGER_PAYMENT_BURDEN ? 'danger' : 'warning',
        title: 'Minimum payment burden elevated',
        detail: `Minimum payments are ${formatPercent(summary.paymentBurden)} of selected month income.`
      })
    }

    if (items.length === 0) {
      items.push({
        tone: 'success',
        title: 'Debt health looks controlled',
        detail: 'No high APR, missing payment, or major pressure warnings were found.'
      })
    }

    return items
  }, [summary])

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.eyebrow}>Bài 49 Mini</div>
          <h1 style={styles.title}>Debt Health Summary Pro</h1>
          <p style={styles.subtitle}>
            Read-only debt control center. It summarizes liabilities, APR pressure, minimum payments, net worth pressure, and payoff priority without changing your existing debt logic.
          </p>
        </div>

        <div style={styles.headerActions}>
          <label style={styles.monthLabel}>Income month</label>
          <input
            type="month"
            value={monthKey}
            onChange={(event) => setMonthKey(event.target.value || getMonthKey())}
            style={styles.monthInput}
          />
          <button onClick={loadDebtHealthData} style={styles.refreshButton}>
            Refresh
          </button>
        </div>
      </div>

      {message && <div style={styles.message}>{message}</div>}

      <div style={styles.healthBanner(summary.health.tone)}>
        <div>
          <div style={styles.bannerLabel}>Debt Health</div>
          <div style={styles.bannerTitle}>{loading ? 'Loading...' : summary.health.label}</div>
          <div style={styles.bannerDescription}>{summary.health.description}</div>
        </div>
        <div style={styles.bannerPill(summary.health.tone)}>
          {summary.debtRows.length} Active Debt{summary.debtRows.length === 1 ? '' : 's'}
        </div>
      </div>

      <div style={styles.statGrid}>
        <MetricCard
          label="Total Debt"
          value={loading ? '...' : formatCompactMoney(summary.totalDebt)}
          note="Positive liability balances"
          tone={summary.totalDebt > 0 ? 'warning' : 'success'}
        />
        <MetricCard
          label="Total Assets"
          value={loading ? '...' : formatCompactMoney(summary.totalAssets)}
          note="Asset accounts + investment market value"
          tone="neutral"
        />
        <MetricCard
          label="Debt / Assets"
          value={loading ? '...' : formatPercent(summary.debtToAssetRatio)}
          note="Lower is safer"
          tone={summary.debtToAssetRatio >= WARNING_DEBT_TO_ASSET_RATIO ? 'warning' : 'success'}
        />
        <MetricCard
          label="Net Worth After Debt"
          value={loading ? '...' : formatCompactMoney(summary.netWorthAfterDebt)}
          note="Assets minus liabilities"
          tone={summary.netWorthAfterDebt >= 0 ? 'success' : 'danger'}
        />
      </div>

      <div style={styles.statGrid}>
        <MetricCard
          label="Minimum Payments"
          value={loading ? '...' : formatCompactMoney(summary.totalMinimumPayment)}
          note="Monthly required debt payments"
          tone="neutral"
        />
        <MetricCard
          label="Payment Burden"
          value={loading ? '...' : formatPercent(summary.paymentBurden)}
          note={`Compared with ${monthKey} income`}
          tone={summary.paymentBurden >= WARNING_PAYMENT_BURDEN ? 'warning' : 'success'}
        />
        <MetricCard
          label="Est. Monthly Interest"
          value={loading ? '...' : formatCompactMoney(summary.estimatedMonthlyInterest)}
          note="Approximation from APR / 12"
          tone={summary.estimatedMonthlyInterest > 0 ? 'warning' : 'success'}
        />
        <MetricCard
          label="High APR Debts"
          value={loading ? '...' : String(summary.highAprDebts.length)}
          note={`APR >= ${HIGH_APR_THRESHOLD}%`}
          tone={summary.highAprDebts.length > 0 ? 'danger' : 'success'}
        />
      </div>

      <div style={styles.twoColumnGrid}>
        <section style={styles.card}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Review Queue</h2>
              <p style={styles.sectionSubtitle}>Items that deserve attention before you add more complexity.</p>
            </div>
          </div>

          <div style={styles.reviewList}>
            {reviewItems.map((item) => (
              <div key={`${item.title}-${item.detail}`} style={styles.reviewItem(item.tone)}>
                <div style={styles.reviewDot(item.tone)} />
                <div>
                  <div style={styles.reviewTitle}>{item.title}</div>
                  <div style={styles.reviewDetail}>{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Payoff Priority</h2>
              <p style={styles.sectionSubtitle}>Read-only recommendation. No transactions are changed.</p>
            </div>
          </div>

          <div style={styles.priorityGrid}>
            <PriorityList title="Avalanche" subtitle="Highest APR first" rows={summary.avalanchePriority.slice(0, 5)} />
            <PriorityList title="Snowball" subtitle="Smallest balance first" rows={summary.snowballPriority.slice(0, 5)} />
          </div>
        </section>
      </div>

      <section style={styles.card}>
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.sectionTitle}>Debt Detail</h2>
            <p style={styles.sectionSubtitle}>
              Source: liabilities table. This page does not edit balances, payments, or Net Worth.
            </p>
          </div>
        </div>

        {loading ? (
          <div style={styles.emptyState}>Loading debt health...</div>
        ) : summary.debtRows.length === 0 ? (
          <div style={styles.emptyState}>No active liabilities with positive balance found.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Debt</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Balance</th>
                  <th style={styles.th}>APR</th>
                  <th style={styles.th}>Min Payment</th>
                  <th style={styles.th}>Est. Monthly Interest</th>
                  <th style={styles.th}>Payoff</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {summary.debtRows.map((row) => (
                  <tr key={row.id}>
                    <td style={styles.tdStrong}>{row.name || 'Unnamed Debt'}</td>
                    <td style={styles.td}>{row.typeLabel}</td>
                    <td style={styles.td}>${formatMoney(row.balance)}</td>
                    <td style={styles.td}>{formatPercent(row.apr)}</td>
                    <td style={styles.td}>${formatMoney(row.minimumPayment)}</td>
                    <td style={styles.td}>${formatMoney(row.monthlyInterest)}</td>
                    <td style={styles.td}>
                      {row.payoff?.valid ? row.payoff.payoffDateLabel : 'Needs data'}
                    </td>
                    <td style={styles.td}>
                      <span style={styles.statusPill(row.tone)}>{row.status}</span>
                    </td>
                    <td style={styles.tdMuted}>{getPriorityReason(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={styles.notesCard}>
        <h2 style={styles.sectionTitle}>How to use this page</h2>
        <div style={styles.noteGrid}>
          <div style={styles.noteItem}>
            <div style={styles.noteTitle}>Keep this read-only for now</div>
            <p style={styles.noteText}>
              This page is a health check. It should not post payments, update liabilities, or sync Net Worth automatically yet.
            </p>
          </div>
          <div style={styles.noteItem}>
            <div style={styles.noteTitle}>Use Avalanche for math</div>
            <p style={styles.noteText}>
              Extra money usually goes to the highest APR debt first if your goal is to reduce interest cost.
            </p>
          </div>
          <div style={styles.noteItem}>
            <div style={styles.noteTitle}>Use Snowball for motivation</div>
            <p style={styles.noteText}>
              Smaller balances first can feel better psychologically, even when it may cost more interest.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function MetricCard({ label, value, note, tone = 'neutral' }) {
  return (
    <div style={styles.metricCard(tone)}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
      <div style={styles.metricNote}>{note}</div>
    </div>
  )
}

function PriorityList({ title, subtitle, rows }) {
  return (
    <div style={styles.priorityCard}>
      <div style={styles.priorityHeading}>{title}</div>
      <div style={styles.prioritySubtitle}>{subtitle}</div>

      {rows.length === 0 ? (
        <div style={styles.emptyMini}>No active debts.</div>
      ) : (
        <div style={styles.priorityRows}>
          {rows.map((row, index) => (
            <div key={`${title}-${row.id}`} style={styles.priorityRow}>
              <div style={styles.rankBadge}>{index + 1}</div>
              <div style={{ minWidth: 0 }}>
                <div style={styles.priorityName}>{row.name || 'Unnamed Debt'}</div>
                <div style={styles.priorityMeta}>
                  ${formatMoney(row.balance)} · {formatPercent(row.apr)} APR · ${formatMoney(row.minimumPayment)} min
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const colors = {
  bg: 'var(--bg-main, #f8fafc)',
  panel: 'var(--bg-card, #ffffff)',
  panel2: 'var(--bg-card-soft, #f1f5f9)',
  border: 'var(--border-main, #dbe4f0)',
  borderSoft: 'var(--border-main, rgba(148, 163, 184, 0.26))',
  text: 'var(--text-main, #0f172a)',
  muted: 'var(--text-muted, #64748b)',
  muted2: 'var(--text-muted, #64748b)',
  blue: 'var(--accent-strong, #2563eb)',
  green: 'var(--success, #16a34a)',
  amber: 'var(--warning, #d97706)',
  red: 'var(--danger, #dc2626)',
  cardShadow: 'var(--shadow-card, 0 18px 40px rgba(15, 23, 42, 0.08))',
  softBlueBg: 'color-mix(in srgb, var(--accent-strong) 10%, transparent)'
}

const toneColor = (tone) => {
  if (tone === 'success') return colors.green
  if (tone === 'warning') return colors.amber
  if (tone === 'danger') return colors.red
  return colors.blue
}

const toneBg = (tone) => {
  if (tone === 'success') return 'color-mix(in srgb, var(--success) 12%, transparent)'
  if (tone === 'warning') return 'color-mix(in srgb, var(--warning) 12%, transparent)'
  if (tone === 'danger') return 'color-mix(in srgb, var(--danger) 12%, transparent)'
  return 'color-mix(in srgb, var(--accent-strong) 12%, transparent)'
}

const styles = {
  page: {
    display: 'grid',
    gap: '24px',
    color: colors.text
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '20px',
    flexWrap: 'wrap'
  },
  eyebrow: {
    color: colors.blue,
    fontSize: '13px',
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: '8px'
  },
  title: {
    margin: 0,
    fontSize: '34px',
    letterSpacing: '-0.04em'
  },
  subtitle: {
    margin: '10px 0 0',
    maxWidth: '850px',
    color: colors.muted,
    lineHeight: 1.6
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
    background: colors.panel,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: '16px',
    padding: '12px'
  },
  monthLabel: {
    color: colors.muted2,
    fontSize: '13px',
    fontWeight: 700
  },
  monthInput: {
    background: colors.bg,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: '10px',
    padding: '10px 12px'
  },
  refreshButton: {
    border: 0,
    borderRadius: '10px',
    padding: '11px 14px',
    background: colors.blue,
    color: '#ffffff',
    fontWeight: 800,
    cursor: 'pointer'
  },
  message: {
    background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
    border: '1px solid var(--danger)',
    color: colors.red,
    borderRadius: '14px',
    padding: '14px 16px'
  },
  healthBanner: (tone) => ({
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    alignItems: 'center',
    flexWrap: 'wrap',
    background: `linear-gradient(135deg, ${toneBg(tone)}, ${colors.panel})`,
    border: `1px solid ${toneColor(tone)}`,
    borderRadius: '24px',
    padding: '22px'
  }),
  bannerLabel: {
    color: colors.muted2,
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.1em'
  },
  bannerTitle: {
    fontSize: '30px',
    fontWeight: 900,
    marginTop: '8px'
  },
  bannerDescription: {
    color: colors.muted,
    marginTop: '8px',
    lineHeight: 1.5
  },
  bannerPill: (tone) => ({
    color: toneColor(tone),
    background: toneBg(tone),
    border: `1px solid ${toneColor(tone)}`,
    padding: '10px 14px',
    borderRadius: '999px',
    fontWeight: 900
  }),
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: '16px'
  },
  metricCard: (tone) => ({
    background: colors.panel,
    border: `1px solid ${tone === 'neutral' ? colors.borderSoft : toneColor(tone)}`,
    borderRadius: '18px',
    padding: '18px',
    boxShadow: colors.cardShadow
  }),
  metricLabel: {
    color: colors.muted2,
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  },
  metricValue: {
    fontSize: '28px',
    fontWeight: 900,
    marginTop: '10px'
  },
  metricNote: {
    color: colors.muted,
    fontSize: '13px',
    marginTop: '8px',
    lineHeight: 1.45
  },
  twoColumnGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
    gap: '18px'
  },
  card: {
    background: colors.panel,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: '22px',
    padding: '20px',
    boxShadow: colors.cardShadow
  },
  notesCard: {
    background: `linear-gradient(135deg, ${colors.softBlueBg}, ${colors.panel})`,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: '22px',
    padding: '20px'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '14px',
    alignItems: 'flex-start',
    marginBottom: '16px'
  },
  sectionTitle: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 900
  },
  sectionSubtitle: {
    margin: '6px 0 0',
    color: colors.muted2,
    fontSize: '14px',
    lineHeight: 1.5
  },
  reviewList: {
    display: 'grid',
    gap: '12px'
  },
  reviewItem: (tone) => ({
    display: 'grid',
    gridTemplateColumns: '12px 1fr',
    gap: '12px',
    alignItems: 'flex-start',
    padding: '14px',
    borderRadius: '16px',
    background: toneBg(tone),
    border: `1px solid ${toneColor(tone)}`
  }),
  reviewDot: (tone) => ({
    width: '10px',
    height: '10px',
    borderRadius: '999px',
    background: toneColor(tone),
    marginTop: '5px'
  }),
  reviewTitle: {
    fontWeight: 900
  },
  reviewDetail: {
    color: colors.muted,
    fontSize: '13px',
    lineHeight: 1.45,
    marginTop: '4px'
  },
  priorityGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
    gap: '14px'
  },
  priorityCard: {
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: '18px',
    padding: '16px'
  },
  priorityHeading: {
    fontSize: '17px',
    fontWeight: 900
  },
  prioritySubtitle: {
    color: colors.muted2,
    fontSize: '13px',
    marginTop: '4px'
  },
  priorityRows: {
    display: 'grid',
    gap: '10px',
    marginTop: '14px'
  },
  priorityRow: {
    display: 'grid',
    gridTemplateColumns: '32px 1fr',
    gap: '10px',
    alignItems: 'center',
    padding: '10px',
    borderRadius: '14px',
    background: colors.panel
  },
  rankBadge: {
    width: '30px',
    height: '30px',
    borderRadius: '10px',
    display: 'grid',
    placeItems: 'center',
    background: colors.softBlueBg,
    color: colors.blue,
    fontWeight: 900
  },
  priorityName: {
    fontWeight: 800,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  priorityMeta: {
    color: colors.muted2,
    fontSize: '12px',
    marginTop: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  tableWrap: {
    overflowX: 'auto',
    borderRadius: '16px',
    border: `1px solid ${colors.border}`
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '1060px'
  },
  th: {
    textAlign: 'left',
    padding: '12px',
    background: colors.bg,
    color: colors.muted2,
    borderBottom: `1px solid ${colors.border}`,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  },
  td: {
    padding: '12px',
    borderBottom: `1px solid ${colors.borderSoft}`,
    color: colors.text,
    fontSize: '14px',
    whiteSpace: 'nowrap'
  },
  tdStrong: {
    padding: '12px',
    borderBottom: `1px solid ${colors.borderSoft}`,
    color: colors.text,
    fontSize: '14px',
    fontWeight: 900,
    whiteSpace: 'nowrap'
  },
  tdMuted: {
    padding: '12px',
    borderBottom: `1px solid ${colors.borderSoft}`,
    color: colors.muted,
    fontSize: '13px',
    minWidth: '230px'
  },
  statusPill: (tone) => ({
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: '999px',
    padding: '5px 9px',
    fontSize: '12px',
    fontWeight: 900,
    color: toneColor(tone),
    background: toneBg(tone),
    border: `1px solid ${toneColor(tone)}`
  }),
  noteGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '14px',
    marginTop: '14px'
  },
  noteItem: {
    background: colors.panel,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: '16px',
    padding: '16px'
  },
  noteTitle: {
    fontWeight: 900,
    color: colors.text
  },
  noteText: {
    margin: '8px 0 0',
    color: colors.muted,
    lineHeight: 1.5,
    fontSize: '14px'
  },
  emptyState: {
    padding: '28px',
    borderRadius: '16px',
    border: `1px dashed ${colors.border}`,
    color: colors.muted,
    textAlign: 'center'
  },
  emptyMini: {
    marginTop: '14px',
    color: colors.muted2,
    fontSize: '13px'
  }
}
