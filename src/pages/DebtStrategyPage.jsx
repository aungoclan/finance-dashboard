import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculateMultiDebtPayoff, formatMoney } from '../lib/debtStrategy'

export default function DebtStrategyPage() {
  const [liabilities, setLiabilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [strategy, setStrategy] = useState('avalanche')
  const [extraMonthlyPayment, setExtraMonthlyPayment] = useState('0')

  useEffect(() => {
    loadLiabilities()
  }, [])

  const loadLiabilities = async () => {
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

      const { data, error } = await supabase
        .from('liabilities')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) {
        throw error
      }

      setLiabilities(data || [])
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to load liabilities')
    }

    setLoading(false)
  }

  const result = useMemo(() => {
    return calculateMultiDebtPayoff({
      liabilities,
      strategy,
      extraMonthlyPayment,
      startDate: new Date()
    })
  }, [liabilities, strategy, extraMonthlyPayment])

  const totalCurrentDebt = useMemo(() => {
    return liabilities.reduce((sum, item) => sum + toNumber(item.current_balance), 0)
  }, [liabilities])

  const totalMinimumPayment = useMemo(() => {
    return liabilities.reduce((sum, item) => sum + toNumber(item.minimum_payment), 0)
  }, [liabilities])

  return (
    <div className="debt-strategy-page">
      <style>{debtStrategyCss}</style>

      <div className="ds-page-header">
        <div>
          <div className="ds-kicker">Planning / Debt Strategy</div>
          <h1>Multi-Debt Strategy</h1>
          <p>
            Compare Snowball and Avalanche payoff strategies without changing your saved debt records.
          </p>
        </div>

        <button className="ds-primary-btn" onClick={loadLiabilities} type="button">
          Refresh Liabilities
        </button>
      </div>

      {message && <div className="ds-message">{message}</div>}

      <section className="ds-panel ds-control-panel">
        <div className="ds-control-grid">
          <div>
            <label>Strategy</label>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="avalanche">Avalanche — Highest APR first</option>
              <option value="snowball">Snowball — Smallest balance first</option>
            </select>
          </div>

          <div>
            <label>Extra Monthly Payment</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={extraMonthlyPayment}
              onChange={(e) => setExtraMonthlyPayment(e.target.value)}
              placeholder="Example: 200"
            />
          </div>

          <div className="ds-mini-stat">
            <span>Total Current Debt</span>
            <strong>${formatMoney(totalCurrentDebt)}</strong>
          </div>

          <div className="ds-mini-stat">
            <span>Total Minimums</span>
            <strong>${formatMoney(totalMinimumPayment)}</strong>
          </div>
        </div>

        <div className="ds-tip-row">
          <div>
            <strong>Avalanche</strong> usually saves more interest.
          </div>
          <div>
            <strong>Snowball</strong> can feel easier because smaller balances disappear sooner.
          </div>
        </div>
      </section>

      <section className="ds-panel">
        <div className="ds-section-header">
          <div>
            <h2>Included Liabilities</h2>
            <p>These records are pulled from your existing liabilities table.</p>
          </div>
          <span className="ds-badge">{liabilities.length} debts</span>
        </div>

        {loading ? (
          <div className="ds-empty">Loading liabilities...</div>
        ) : liabilities.length === 0 ? (
          <div className="ds-empty">No liabilities found yet.</div>
        ) : (
          <div className="ds-liability-grid">
            {liabilities.map((item) => (
              <div className="ds-liability-card" key={item.id}>
                <div className="ds-liability-name">{item.name}</div>
                <div className="ds-liability-meta">
                  <span>Balance</span>
                  <strong>${formatMoney(item.current_balance)}</strong>
                </div>
                <div className="ds-liability-meta">
                  <span>APR</span>
                  <strong>{toNumber(item.interest_rate).toFixed(2)}%</strong>
                </div>
                <div className="ds-liability-meta">
                  <span>Minimum</span>
                  <strong>${formatMoney(item.minimum_payment)}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {!result.valid ? (
        <section className="ds-panel">
          <h2>Calculation Result</h2>
          <div className="ds-error">{result.error}</div>
        </section>
      ) : (
        <>
          <section className="ds-summary-grid">
            <SummaryCard label="Strategy" value={result.strategy === 'avalanche' ? 'Avalanche' : 'Snowball'} />
            <SummaryCard label="Debt-Free In" value={`${result.monthsToDebtFree} months`} />
            <SummaryCard label="Debt-Free Date" value={result.payoffDateLabel} />
            <SummaryCard label="Extra Payment" value={`$${formatMoney(result.extraMonthlyPayment)}`} accent="green" />
            <SummaryCard label="Total Interest Paid" value={`$${formatMoney(result.totalInterestPaid)}`} accent="red" />
            <SummaryCard label="Total Paid" value={`$${formatMoney(result.totalPaid)}`} />
            <SummaryCard label="Debts Included" value={result.debtResults.length} />
            <SummaryCard label="Final Active Debts" value="0" />
          </section>

          <section className="ds-panel">
            <div className="ds-section-header">
              <div>
                <h2>Payoff Order</h2>
                <p>The recommended order based on your selected strategy.</p>
              </div>
            </div>

            {result.payoffOrder.length === 0 ? (
              <div className="ds-empty">No payoff order available.</div>
            ) : (
              <div className="ds-payoff-grid">
                {result.payoffOrder.map((item, index) => (
                  <div className="ds-payoff-item" key={item.id}>
                    <div className="ds-payoff-number">{index + 1}</div>
                    <div>
                      <div className="ds-payoff-name">{item.name}</div>
                      <div className="ds-muted">
                        Paid off in month {item.monthNumber} · {item.payoffDate}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="ds-panel">
            <div className="ds-section-header">
              <div>
                <h2>Debt-by-Debt Results</h2>
                <p>Detailed payoff math for each liability.</p>
              </div>
            </div>

            <div className="ds-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Debt</th>
                    <th>APR</th>
                    <th>Starting Balance</th>
                    <th>Minimum</th>
                    <th>Interest</th>
                    <th>Total Paid</th>
                    <th>Payoff Date</th>
                  </tr>
                </thead>
                <tbody>
                  {result.debtResults.map((row) => (
                    <tr key={row.id}>
                      <td className="ds-debt-name-cell">{row.name}</td>
                      <td>{row.apr}%</td>
                      <td>${formatMoney(row.originalBalance)}</td>
                      <td>${formatMoney(row.minimumPayment)}</td>
                      <td>${formatMoney(row.totalInterestPaid)}</td>
                      <td>${formatMoney(row.totalPaid)}</td>
                      <td>{row.payoffDateLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ds-panel">
            <div className="ds-section-header">
              <div>
                <h2>Balance Trend Preview</h2>
                <p>Showing the first 12 months of total remaining debt balance.</p>
              </div>
            </div>

            <div className="ds-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Date</th>
                    <th>Remaining Balance</th>
                    <th>Active Debts</th>
                  </tr>
                </thead>
                <tbody>
                  {result.monthlySnapshots.slice(0, 12).map((row) => (
                    <tr key={row.monthNumber}>
                      <td>{row.monthNumber}</td>
                      <td>{row.paymentDate}</td>
                      <td>${formatMoney(row.remainingTotalBalance)}</td>
                      <td>{row.activeDebts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, accent }) {
  return (
    <div className="ds-summary-card">
      <div>{label}</div>
      <strong className={accent ? `is-${accent}` : ''}>{value}</strong>
    </div>
  )
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const debtStrategyCss = `
  .debt-strategy-page {
    width: 100%;
    max-width: 1180px;
    min-width: 0;
    margin: 0 auto;
    display: grid;
    gap: 18px;
    overflow-x: hidden;
  }

  .ds-page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
  }

  .ds-kicker {
    margin-bottom: 8px;
    color: var(--accent, #38bdf8);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .ds-page-header h1 {
    margin: 0;
    color: var(--text-main, #f8fafc);
    font-size: clamp(28px, 4vw, 42px);
    line-height: 1.05;
    letter-spacing: -0.04em;
  }

  .ds-page-header p {
    max-width: 760px;
    margin: 10px 0 0;
    color: var(--text-muted, #cbd5e1);
    font-size: 16px;
    line-height: 1.55;
  }

  .ds-primary-btn {
    border: 1px solid rgba(59, 130, 246, 0.45);
    border-radius: 14px;
    padding: 11px 15px;
    background: var(--button-bg, linear-gradient(135deg, #2563eb, #1d4ed8));
    color: var(--button-text, white);
    font-weight: 800;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: var(--shadow-button, 0 14px 35px rgba(37, 99, 235, 0.22));
  }

  .ds-message,
  .ds-panel,
  .ds-summary-card {
    border: 1px solid var(--border-main, rgba(148, 163, 184, 0.14));
    background: var(--bg-card, rgba(15, 23, 42, 0.72));
    box-shadow: var(--shadow-card, 0 18px 45px rgba(0, 0, 0, 0.18));
    backdrop-filter: blur(16px);
  }

  .ds-message {
    border-radius: 16px;
    padding: 14px 16px;
    color: var(--text-main, #f8fafc);
  }

  .ds-panel {
    min-width: 0;
    border-radius: 22px;
    padding: 18px;
  }

  .ds-control-panel {
    padding: 16px;
  }

  .ds-control-grid {
    display: grid;
    grid-template-columns: minmax(220px, 1.4fr) minmax(180px, 0.9fr) repeat(2, minmax(150px, 0.7fr));
    gap: 12px;
    align-items: end;
  }

  .ds-control-grid label {
    display: block;
    margin-bottom: 7px;
    color: var(--text-muted, #cbd5e1);
    font-size: 13px;
    font-weight: 800;
  }

  .ds-control-grid select,
  .ds-control-grid input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border: 1px solid var(--border-main, rgba(148, 163, 184, 0.24));
    border-radius: 14px;
    padding: 12px 13px;
    background: var(--bg-input, rgba(2, 6, 23, 0.55));
    color: var(--text-main, #f8fafc);
    outline: none;
  }

  .ds-control-grid select option {
    background: var(--bg-card, #0f172a);
    color: var(--text-main, #f8fafc);
  }

  .ds-mini-stat {
    min-width: 0;
    border: 1px solid var(--border-main, rgba(148, 163, 184, 0.14));
    border-radius: 16px;
    padding: 11px 13px;
    background: var(--bg-card-soft, rgba(2, 6, 23, 0.38));
  }

  .ds-mini-stat span,
  .ds-summary-card div,
  .ds-muted,
  .ds-section-header p {
    color: var(--text-muted, #cbd5e1);
  }

  .ds-mini-stat span {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 800;
  }

  .ds-mini-stat strong {
    color: var(--text-main, #f8fafc);
    font-size: 18px;
  }

  .ds-tip-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 12px;
  }

  .ds-tip-row > div {
    border: 1px solid var(--border-soft, rgba(148, 163, 184, 0.12));
    border-radius: 14px;
    padding: 11px 12px;
    color: var(--text-muted, #cbd5e1);
    background: var(--bg-card-soft, rgba(15, 23, 42, 0.55));
    font-size: 13px;
    line-height: 1.45;
  }

  .ds-tip-row strong {
    color: var(--text-main, #f8fafc);
  }

  .ds-section-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .ds-section-header h2 {
    margin: 0;
    color: var(--text-main, #f8fafc);
    font-size: 22px;
    letter-spacing: -0.03em;
  }

  .ds-section-header p {
    margin: 6px 0 0;
    font-size: 14px;
    line-height: 1.45;
  }

  .ds-badge {
    border: 1px solid color-mix(in srgb, var(--accent, #22d3ee) 35%, transparent);
    border-radius: 999px;
    padding: 7px 10px;
    background: color-mix(in srgb, var(--accent, #22d3ee) 14%, transparent);
    color: var(--accent, #67e8f9);
    font-size: 12px;
    font-weight: 900;
    white-space: nowrap;
  }

  .ds-liability-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }

  .ds-liability-card,
  .ds-payoff-item {
    min-width: 0;
    border: 1px solid var(--border-main, rgba(148, 163, 184, 0.14));
    border-radius: 16px;
    background: var(--bg-card-soft, rgba(2, 6, 23, 0.4));
  }

  .ds-liability-card {
    padding: 14px;
  }

  .ds-liability-name {
    margin-bottom: 12px;
    color: var(--text-main, #f8fafc);
    font-size: 15px;
    font-weight: 900;
    overflow-wrap: anywhere;
  }

  .ds-liability-meta {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-top: 7px;
    color: var(--text-muted, #cbd5e1);
    font-size: 13px;
  }

  .ds-liability-meta strong {
    color: var(--text-main, #f8fafc);
  }

  .ds-summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    min-width: 0;
  }

  .ds-summary-card {
    min-width: 0;
    border-radius: 18px;
    padding: 16px;
  }

  .ds-summary-card div {
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 800;
  }

  .ds-summary-card strong {
    color: var(--text-main, #f8fafc);
    font-size: clamp(19px, 2.2vw, 27px);
    line-height: 1.1;
    letter-spacing: -0.04em;
    overflow-wrap: anywhere;
  }

  .ds-summary-card strong.is-red {
    color: var(--danger, #fb7185);
  }

  .ds-summary-card strong.is-green {
    color: var(--success, #22c55e);
  }

  .ds-payoff-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
  }

  .ds-payoff-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 13px;
  }

  .ds-payoff-number {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: var(--accent, #2563eb);
    color: var(--text-main, #f8fafc);
    font-weight: 900;
  }

  .ds-payoff-name {
    color: var(--text-main, #f8fafc);
    font-weight: 900;
    overflow-wrap: anywhere;
  }

  .ds-muted {
    margin-top: 5px;
    font-size: 13px;
    line-height: 1.4;
  }

  .ds-table-wrap {
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--border-soft, rgba(148, 163, 184, 0.12));
    border-radius: 16px;
    background: var(--bg-card-soft, rgba(2, 6, 23, 0.25));
  }

  .ds-table-wrap table {
    width: 100%;
    min-width: 760px;
    border-collapse: collapse;
  }

  .ds-table-wrap th,
  .ds-table-wrap td {
    padding: 13px 14px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    text-align: left;
    white-space: nowrap;
    font-size: 14px;
  }

  .ds-table-wrap th {
    color: var(--text-muted, #cbd5e1);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .ds-table-wrap td {
    color: var(--text-main, #f8fafc);
  }

  .ds-table-wrap tbody tr:last-child td {
    border-bottom: 0;
  }

  .ds-debt-name-cell {
    max-width: 260px;
    white-space: normal !important;
    overflow-wrap: anywhere;
    font-weight: 800;
  }

  .ds-empty,
  .ds-error {
    border-radius: 16px;
    padding: 14px;
  }

  .ds-empty {
    border: 1px dashed var(--border-main, rgba(148, 163, 184, 0.22));
    color: var(--text-muted, #cbd5e1);
    background: var(--bg-card-soft, rgba(2, 6, 23, 0.25));
  }

  .ds-error {
    border: 1px solid color-mix(in srgb, var(--danger, #f87171) 40%, transparent);
    background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
    color: var(--danger, #fecaca);
  }

  @media (max-width: 1100px) {
    .ds-control-grid,
    .ds-summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 720px) {
    .debt-strategy-page {
      gap: 14px;
    }

    .ds-page-header,
    .ds-section-header {
      flex-direction: column;
      align-items: stretch;
    }

    .ds-primary-btn {
      width: 100%;
    }

    .ds-control-grid,
    .ds-tip-row,
    .ds-summary-grid {
      grid-template-columns: 1fr;
    }

    .ds-panel,
    .ds-control-panel {
      padding: 14px;
      border-radius: 18px;
    }
  }
`
