import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  calculateDebtPayoff,
  formatMoney,
  formatPercent
} from '../lib/debt'

export default function DebtPayoffPage() {
  const [liabilities, setLiabilities] = useState([])
  const [selectedLiabilityId, setSelectedLiabilityId] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const [formData, setFormData] = useState({
    balance: '',
    apr: '',
    minimumPayment: '',
    extraPayment: '0'
  })

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

  const handleLiabilityChange = (e) => {
    const liabilityId = e.target.value
    setSelectedLiabilityId(liabilityId)

    const selected = liabilities.find((item) => item.id === liabilityId)

    if (!selected) {
      setFormData({
        balance: '',
        apr: '',
        minimumPayment: '',
        extraPayment: '0'
      })
      return
    }

    setFormData({
      balance: selected.current_balance ?? '',
      apr: selected.interest_rate ?? '',
      minimumPayment: selected.minimum_payment ?? '',
      extraPayment: '0'
    })
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }))
  }

  const selectedLiability = liabilities.find((item) => item.id === selectedLiabilityId)

  const result = useMemo(() => {
    if (!formData.balance || !formData.minimumPayment) return null

    return calculateDebtPayoff({
      balance: formData.balance,
      apr: formData.apr || 0,
      minimumPayment: formData.minimumPayment,
      extraPayment: formData.extraPayment || 0,
      startDate: new Date()
    })
  }, [formData])

  return (
    <div>
      <style>{debtPayoffCss}</style>
      <div style={headerRowStyle}>
        <div>
          <h1 style={{ marginBottom: '8px' }}>Debt Payoff Calculator</h1>
          <p style={{ marginTop: 0, color: 'var(--text-muted, #d1d5db)' }}>
            Estimate how long it will take to pay off a debt using APR, minimum payment, and extra monthly payment.
          </p>
        </div>

        <button onClick={loadLiabilities} style={refreshButtonStyle}>
          Refresh Liabilities
        </button>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div
        className="debt-payoff-main-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 380px) minmax(0, 1fr)',
          gap: '24px',
          marginTop: '24px'
        }}
      >
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Calculator Inputs</h2>

          <div style={fieldStyle}>
            <label style={labelStyle}>Choose Liability</label>
            <select
              value={selectedLiabilityId}
              onChange={handleLiabilityChange}
              style={inputStyle}
              disabled={loading}
            >
              <option value="">Select liability</option>
              {liabilities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.liability_type})
                </option>
              ))}
            </select>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Current Balance</label>
            <input
              type="number"
              step="0.01"
              name="balance"
              value={formData.balance}
              onChange={handleChange}
              placeholder="Example: 8500"
              style={inputStyle}
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>APR (%)</label>
            <input
              type="number"
              step="0.01"
              name="apr"
              value={formData.apr}
              onChange={handleChange}
              placeholder="Example: 24"
              style={inputStyle}
            />
            <div style={helperTextStyle}>
              Annual Percentage Rate, not monthly rate.
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Minimum Payment</label>
            <input
              type="number"
              step="0.01"
              name="minimumPayment"
              value={formData.minimumPayment}
              onChange={handleChange}
              placeholder="Example: 160"
              style={inputStyle}
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Extra Monthly Payment</label>
            <input
              type="number"
              step="0.01"
              name="extraPayment"
              value={formData.extraPayment}
              onChange={handleChange}
              placeholder="Example: 100"
              style={inputStyle}
            />
          </div>

          {selectedLiability && (
            <div style={selectedCardStyle}>
              <div style={{ fontWeight: 700 }}>{selectedLiability.name}</div>
              <div style={mutedText}>Type: {selectedLiability.liability_type}</div>
              {selectedLiability.notes && (
                <div style={mutedText}>Notes: {selectedLiability.notes}</div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: '24px' }}>
          {!result ? (
            <div style={cardStyle}>
              <p>Select a liability or enter balance/payment values to calculate payoff.</p>
            </div>
          ) : !result.valid ? (
            <div style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>Calculation Result</h2>
              <div style={errorBoxStyle}>{result.error}</div>
            </div>
          ) : (
            <>
              <div style={summaryGridStyle}>
                <div style={summaryCardStyle}>
                  <div style={summaryLabelStyle}>Monthly Payment</div>
                  <div style={summaryValueStyle}>${formatMoney(result.monthlyPayment)}</div>
                </div>

                <div style={summaryCardStyle}>
                  <div style={summaryLabelStyle}>Months to Payoff</div>
                  <div style={summaryValueStyle}>{result.monthsToPayoff}</div>
                </div>

                <div style={summaryCardStyle}>
                  <div style={summaryLabelStyle}>Payoff Date</div>
                  <div style={summaryValueStyle}>{result.payoffDateLabel}</div>
                </div>

                <div style={summaryCardStyle}>
                  <div style={summaryLabelStyle}>Monthly Interest Rate</div>
                  <div style={summaryValueStyle}>{formatPercent(result.monthlyRatePercent)}</div>
                </div>
              </div>

              <div style={summaryGridStyle}>
                <div style={summaryCardStyle}>
                  <div style={summaryLabelStyle}>Starting Balance</div>
                  <div style={summaryValueStyle}>${formatMoney(result.startingBalance)}</div>
                </div>

                <div style={summaryCardStyle}>
                  <div style={summaryLabelStyle}>Total Interest Paid</div>
                  <div style={{ ...summaryValueStyle, color: 'var(--danger, #ef4444)' }}>
                    ${formatMoney(result.totalInterestPaid)}
                  </div>
                </div>

                <div style={summaryCardStyle}>
                  <div style={summaryLabelStyle}>Total Paid</div>
                  <div style={summaryValueStyle}>${formatMoney(result.totalPaid)}</div>
                </div>

                <div style={summaryCardStyle}>
                  <div style={summaryLabelStyle}>Extra Monthly Payment</div>
                  <div style={{ ...summaryValueStyle, color: 'var(--success, #22c55e)' }}>
                    ${formatMoney(result.extraPayment)}
                  </div>
                </div>
              </div>

              <div style={cardStyle}>
                <h2 style={{ marginTop: 0 }}>Payoff Schedule Preview</h2>
                <div style={helperTextStyle}>
                  Showing the first 12 months of the payoff schedule.
                </div>

                <div style={{ overflowX: 'auto', marginTop: '16px' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Month</th>
                        <th style={thStyle}>Payment Date</th>
                        <th style={thStyle}>Payment</th>
                        <th style={thStyle}>Interest</th>
                        <th style={thStyle}>Principal</th>
                        <th style={thStyle}>Remaining Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.schedule.slice(0, 12).map((row) => (
                        <tr key={row.monthNumber}>
                          <td style={tdStyle}>{row.monthNumber}</td>
                          <td style={tdStyle}>{row.paymentDate}</td>
                          <td style={tdStyle}>${formatMoney(row.payment)}</td>
                          <td style={tdStyle}>${formatMoney(row.interest)}</td>
                          <td style={tdStyle}>${formatMoney(row.principal)}</td>
                          <td style={tdStyle}>${formatMoney(row.remainingBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


const debtPayoffCss = `
  select option {
    background: var(--bg-card, #111827);
    color: var(--text-main, #f8fafc);
  }

  @media (max-width: 980px) {
    .debt-payoff-main-grid {
      grid-template-columns: 1fr !important;
    }
  }
`

const headerRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  marginBottom: '24px'
}

const refreshButtonStyle = {
  padding: '10px 14px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--accent-strong)',
  color: 'white',
  cursor: 'pointer'
}

const messageStyle = {
  marginTop: '16px',
  padding: '12px',
  borderRadius: '10px',
  background: 'var(--bg-card, #1f2937)',
  border: '1px solid var(--border-main, #374151)',
  color: 'var(--text-main, #f3f4f6)'
}

const cardStyle = {
  background: 'var(--bg-card, #1f2937)',
  border: '1px solid var(--border-main, #374151)',
  padding: '20px',
  borderRadius: '12px'
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
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border-main, #4b5563)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main, white)'
}

const helperTextStyle = {
  color: 'var(--text-muted, #d1d5db)',
  fontSize: '14px',
  marginTop: '8px'
}

const selectedCardStyle = {
  marginTop: '20px',
  padding: '14px',
  borderRadius: '10px',
  background: 'var(--bg-card-soft, #111827)',
  border: '1px solid var(--border-main, #374151)'
}

const mutedText = {
  color: 'var(--text-muted, #d1d5db)',
  fontSize: '14px',
  marginTop: '6px'
}

const errorBoxStyle = {
  padding: '14px',
  borderRadius: '10px',
  background: 'rgba(239, 68, 68, 0.12)',
  border: '1px solid rgba(239, 68, 68, 0.35)',
  color: 'var(--danger, #fca5a5)'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '16px'
}

const summaryCardStyle = {
  background: 'var(--bg-card, #1f2937)',
  border: '1px solid var(--border-main, #374151)',
  padding: '20px',
  borderRadius: '12px'
}

const summaryLabelStyle = {
  color: 'var(--text-muted, #d1d5db)',
  fontSize: '14px',
  marginBottom: '10px'
}

const summaryValueStyle = {
  fontSize: '24px',
  fontWeight: 700,
  color: 'var(--text-main, white)'
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse'
}

const thStyle = {
  textAlign: 'left',
  padding: '12px',
  borderBottom: '1px solid var(--border-main, #374151)',
  color: 'var(--text-muted, #d1d5db)',
  fontWeight: 600,
  fontSize: '14px',
  whiteSpace: 'nowrap'
}

const tdStyle = {
  padding: '12px',
  borderBottom: '1px solid var(--border-main, #374151)',
  color: 'var(--text-main, white)',
  fontSize: '14px',
  whiteSpace: 'nowrap'
}
