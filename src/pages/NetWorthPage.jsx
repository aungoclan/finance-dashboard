import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculateHoldings, calculatePortfolioSummary } from '../lib/holdings'
import { calculateNetWorthSummary, formatMoney } from '../lib/networth'

export default function NetWorthPage() {
  const [assetAccounts, setAssetAccounts] = useState([])
  const [liabilities, setLiabilities] = useState([])
  const [investmentMarketValue, setInvestmentMarketValue] = useState(0)

  const [loading, setLoading] = useState(true)
  const [savingAsset, setSavingAsset] = useState(false)
  const [savingLiability, setSavingLiability] = useState(false)
  const [message, setMessage] = useState('')

  const [editingAssetId, setEditingAssetId] = useState(null)
  const [editingLiabilityId, setEditingLiabilityId] = useState(null)

  const [assetForm, setAssetForm] = useState({
    name: '',
    asset_class: 'cash',
    current_value: '',
    notes: ''
  })

  const [liabilityForm, setLiabilityForm] = useState({
    name: '',
    liability_type: 'credit_card',
    current_balance: '',
    interest_rate: '',
    minimum_payment: '',
    notes: ''
  })

  useEffect(() => {
    loadNetWorthData()
  }, [])

  const loadNetWorthData = async () => {
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

      const { data: assetAccountData, error: assetAccountError } = await supabase
        .from('asset_accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (assetAccountError) {
        throw assetAccountError
      }

      const { data: liabilityData, error: liabilityError } = await supabase
        .from('liabilities')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (liabilityError) {
        throw liabilityError
      }

      const { data: txData, error: txError } = await supabase
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
        .order('created_at', { ascending: true })

      if (txError) {
        throw txError
      }

      const { data: pricesData, error: pricesError } = await supabase
        .from('price_quotes')
        .select(`
          id,
          asset_id,
          price,
          created_at
        `)
        .order('created_at', { ascending: false })

      if (pricesError) {
        throw pricesError
      }

      const holdings = calculateHoldings(txData || [], pricesData || [])
      const portfolioSummary = calculatePortfolioSummary(holdings)

      setAssetAccounts(assetAccountData || [])
      setLiabilities(liabilityData || [])
      setInvestmentMarketValue(portfolioSummary.totalMarketValue || 0)
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to load net worth data')
    }

    setLoading(false)
  }

  const resetAssetForm = () => {
    setAssetForm({
      name: '',
      asset_class: 'cash',
      current_value: '',
      notes: ''
    })
    setEditingAssetId(null)
  }

  const resetLiabilityForm = () => {
    setLiabilityForm({
      name: '',
      liability_type: 'credit_card',
      current_balance: '',
      interest_rate: '',
      minimum_payment: '',
      notes: ''
    })
    setEditingLiabilityId(null)
  }

  const handleAssetChange = (e) => {
    const { name, value } = e.target
    setAssetForm((prev) => ({
      ...prev,
      [name]: value
    }))
  }

  const handleLiabilityChange = (e) => {
    const { name, value } = e.target
    setLiabilityForm((prev) => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSaveAsset = async (e) => {
    e.preventDefault()
    setSavingAsset(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const name = assetForm.name.trim()
      if (!name) {
        throw new Error('Asset name is required')
      }

      const currentValue = Number(assetForm.current_value)
      if (Number.isNaN(currentValue) || currentValue < 0) {
        throw new Error('Current value must be a valid positive number')
      }

      const payload = {
        name,
        asset_class: assetForm.asset_class,
        current_value: currentValue,
        notes: assetForm.notes.trim() || null
      }

      if (editingAssetId) {
        const { error } = await supabase
          .from('asset_accounts')
          .update(payload)
          .eq('id', editingAssetId)
          .eq('user_id', user.id)

        if (error) {
          throw error
        }

        setMessage('Asset updated successfully')
      } else {
        const { error } = await supabase.from('asset_accounts').insert({
          user_id: user.id,
          ...payload
        })

        if (error) {
          throw error
        }

        setMessage('Asset added successfully')
      }

      resetAssetForm()
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to save asset')
    }

    setSavingAsset(false)
  }

  const handleSaveLiability = async (e) => {
    e.preventDefault()
    setSavingLiability(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const name = liabilityForm.name.trim()
      if (!name) {
        throw new Error('Liability name is required')
      }

      const currentBalance = Number(liabilityForm.current_balance)
      if (Number.isNaN(currentBalance) || currentBalance < 0) {
        throw new Error('Current balance must be a valid positive number')
      }

      const interestRate =
        liabilityForm.interest_rate === '' ? null : Number(liabilityForm.interest_rate)
      const minimumPayment =
        liabilityForm.minimum_payment === '' ? null : Number(liabilityForm.minimum_payment)

      const payload = {
        name,
        liability_type: liabilityForm.liability_type,
        current_balance: currentBalance,
        interest_rate: interestRate,
        minimum_payment: minimumPayment,
        notes: liabilityForm.notes.trim() || null
      }

      if (editingLiabilityId) {
        const { error } = await supabase
          .from('liabilities')
          .update(payload)
          .eq('id', editingLiabilityId)
          .eq('user_id', user.id)

        if (error) {
          throw error
        }

        setMessage('Liability updated successfully')
      } else {
        const { error } = await supabase.from('liabilities').insert({
          user_id: user.id,
          ...payload
        })

        if (error) {
          throw error
        }

        setMessage('Liability added successfully')
      }

      resetLiabilityForm()
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to save liability')
    }

    setSavingLiability(false)
  }

  const handleEditAsset = (item) => {
    setEditingAssetId(item.id)
    setAssetForm({
      name: item.name || '',
      asset_class: item.asset_class || 'cash',
      current_value: item.current_value ?? '',
      notes: item.notes || ''
    })
    setMessage('')
  }

  const handleDeleteAsset = async (id) => {
    const confirmed = window.confirm('Are you sure you want to delete this asset?')
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
        .from('asset_accounts')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) {
        throw error
      }

      if (editingAssetId === id) {
        resetAssetForm()
      }

      setMessage('Asset deleted successfully')
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to delete asset')
    }
  }

  const handleEditLiability = (item) => {
    setEditingLiabilityId(item.id)
    setLiabilityForm({
      name: item.name || '',
      liability_type: item.liability_type || 'credit_card',
      current_balance: item.current_balance ?? '',
      interest_rate: item.interest_rate ?? '',
      minimum_payment: item.minimum_payment ?? '',
      notes: item.notes || ''
    })
    setMessage('')
  }

  const handleDeleteLiability = async (id) => {
    const confirmed = window.confirm('Are you sure you want to delete this liability?')
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
        .from('liabilities')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) {
        throw error
      }

      if (editingLiabilityId === id) {
        resetLiabilityForm()
      }

      setMessage('Liability deleted successfully')
      await loadNetWorthData()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to delete liability')
    }
  }

  const summary = calculateNetWorthSummary(assetAccounts, liabilities, investmentMarketValue)

  return (
    <div>
      <div style={headerRowStyle}>
        <div>
          <h1 style={{ marginBottom: '8px' }}>Net Worth</h1>
          <p style={{ marginTop: 0, color: '#d1d5db' }}>
            Track your assets, liabilities, and total net worth.
          </p>
        </div>

        <button onClick={loadNetWorthData} style={refreshButtonStyle}>
          Refresh Net Worth
        </button>
      </div>

      <div style={summaryGridStyle}>
        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>Investment Assets</div>
          <div style={summaryValueStyle}>${formatMoney(summary.investmentAssetsTotal)}</div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>External Assets</div>
          <div style={summaryValueStyle}>${formatMoney(summary.externalAssetsTotal)}</div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>Total Assets</div>
          <div style={summaryValueStyle}>${formatMoney(summary.totalAssets)}</div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>Liabilities</div>
          <div style={{ ...summaryValueStyle, color: '#ef4444' }}>
            ${formatMoney(summary.liabilitiesTotal)}
          </div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>Net Worth</div>
          <div
            style={{
              ...summaryValueStyle,
              color: summary.netWorth >= 0 ? '#22c55e' : '#ef4444'
            }}
          >
            ${formatMoney(summary.netWorth)}
          </div>
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={{ display: 'grid', gap: '24px', marginTop: '24px' }}>
        <div style={twoColumnGridStyle}>
          <div style={cardStyle}>
            <div style={formHeaderStyle}>
              <h2 style={{ marginTop: 0, marginBottom: 0 }}>
                {editingAssetId ? 'Edit Asset' : 'Add External Asset'}
              </h2>

              {editingAssetId && (
                <button type="button" onClick={resetAssetForm} style={secondaryButtonStyle}>
                  Cancel Edit
                </button>
              )}
            </div>

            <form onSubmit={handleSaveAsset}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Name</label>
                <input
                  type="text"
                  name="name"
                  value={assetForm.name}
                  onChange={handleAssetChange}
                  placeholder="Example: Car, House, Savings"
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Asset Class</label>
                <select
                  name="asset_class"
                  value={assetForm.asset_class}
                  onChange={handleAssetChange}
                  style={inputStyle}
                >
                  <option value="cash">Cash</option>
                  <option value="real_estate">Real Estate</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="business">Business</option>
                  <option value="personal_property">Personal Property</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Current Value</label>
                <input
                  type="number"
                  step="0.01"
                  name="current_value"
                  value={assetForm.current_value}
                  onChange={handleAssetChange}
                  placeholder="Example: 12000"
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Notes</label>
                <textarea
                  name="notes"
                  value={assetForm.notes}
                  onChange={handleAssetChange}
                  placeholder="Optional notes"
                  style={textareaStyle}
                />
              </div>

              <button type="submit" disabled={savingAsset} style={buttonStyle}>
                {savingAsset ? 'Saving...' : editingAssetId ? 'Update Asset' : 'Add Asset'}
              </button>
            </form>
          </div>

          <div style={cardStyle}>
            <div style={formHeaderStyle}>
              <h2 style={{ marginTop: 0, marginBottom: 0 }}>
                {editingLiabilityId ? 'Edit Liability' : 'Add Liability'}
              </h2>

              {editingLiabilityId && (
                <button
                  type="button"
                  onClick={resetLiabilityForm}
                  style={secondaryButtonStyle}
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <form onSubmit={handleSaveLiability}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Name</label>
                <input
                  type="text"
                  name="name"
                  value={liabilityForm.name}
                  onChange={handleLiabilityChange}
                  placeholder="Example: Credit Card, Mortgage"
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Liability Type</label>
                <select
                  name="liability_type"
                  value={liabilityForm.liability_type}
                  onChange={handleLiabilityChange}
                  style={inputStyle}
                >
                  <option value="credit_card">Credit Card</option>
                  <option value="mortgage">Mortgage</option>
                  <option value="auto_loan">Auto Loan</option>
                  <option value="personal_loan">Personal Loan</option>
                  <option value="student_loan">Student Loan</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Current Balance</label>
                <input
                  type="number"
                  step="0.01"
                  name="current_balance"
                  value={liabilityForm.current_balance}
                  onChange={handleLiabilityChange}
                  placeholder="Example: 8500"
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Interest Rate (%)</label>
                <input
                  type="number"
                  step="0.01"
                  name="interest_rate"
                  value={liabilityForm.interest_rate}
                  onChange={handleLiabilityChange}
                  placeholder="Optional"
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Minimum Payment</label>
                <input
                  type="number"
                  step="0.01"
                  name="minimum_payment"
                  value={liabilityForm.minimum_payment}
                  onChange={handleLiabilityChange}
                  placeholder="Optional"
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Notes</label>
                <textarea
                  name="notes"
                  value={liabilityForm.notes}
                  onChange={handleLiabilityChange}
                  placeholder="Optional notes"
                  style={textareaStyle}
                />
              </div>

              <button type="submit" disabled={savingLiability} style={buttonStyle}>
                {savingLiability
                  ? 'Saving...'
                  : editingLiabilityId
                  ? 'Update Liability'
                  : 'Add Liability'}
              </button>
            </form>
          </div>
        </div>

        <div style={twoColumnGridStyle}>
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>External Assets</h2>

            {loading ? (
              <p>Loading assets...</p>
            ) : assetAccounts.length === 0 ? (
              <p>No external assets yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {assetAccounts.map((item) => (
                  <div key={item.id} style={listItemStyle}>
                    <div>
                      <strong>{item.name}</strong>
                      <div style={mutedText}>Class: {item.asset_class}</div>
                      <div style={mutedText}>Value: ${formatMoney(item.current_value)}</div>
                      {item.notes && <div style={mutedText}>Notes: {item.notes}</div>}
                    </div>

                    <div style={actionRowStyle}>
                      <button
                        type="button"
                        onClick={() => handleEditAsset(item)}
                        style={editButtonStyle}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAsset(item.id)}
                        style={deleteButtonStyle}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Liabilities</h2>

            {loading ? (
              <p>Loading liabilities...</p>
            ) : liabilities.length === 0 ? (
              <p>No liabilities yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {liabilities.map((item) => (
                  <div key={item.id} style={listItemStyle}>
                    <div>
                      <strong>{item.name}</strong>
                      <div style={mutedText}>Type: {item.liability_type}</div>
                      <div style={mutedText}>Balance: ${formatMoney(item.current_balance)}</div>
                      {item.interest_rate != null && (
                        <div style={mutedText}>Interest: {item.interest_rate}%</div>
                      )}
                      {item.minimum_payment != null && (
                        <div style={mutedText}>
                          Minimum Payment: ${formatMoney(item.minimum_payment)}
                        </div>
                      )}
                      {item.notes && <div style={mutedText}>Notes: {item.notes}</div>}
                    </div>

                    <div style={actionRowStyle}>
                      <button
                        type="button"
                        onClick={() => handleEditLiability(item)}
                        style={editButtonStyle}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteLiability(item.id)}
                        style={deleteButtonStyle}
                      >
                        Delete
                      </button>
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
  background: '#2563eb',
  color: 'white',
  cursor: 'pointer'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: '16px'
}

const summaryCardStyle = {
  background: '#1f2937',
  padding: '20px',
  borderRadius: '12px'
}

const summaryLabelStyle = {
  color: '#d1d5db',
  fontSize: '14px',
  marginBottom: '10px'
}

const summaryValueStyle = {
  fontSize: '24px',
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

const twoColumnGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '24px'
}

const cardStyle = {
  background: '#1f2937',
  padding: '20px',
  borderRadius: '12px'
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
  marginBottom: '8px'
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid #4b5563',
  background: '#111827',
  color: 'white'
}

const textareaStyle = {
  width: '100%',
  minHeight: '90px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid #4b5563',
  background: '#111827',
  color: 'white',
  resize: 'vertical'
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

const listItemStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  padding: '16px',
  borderRadius: '10px',
  background: '#111827',
  border: '1px solid #374151'
}

const mutedText = {
  marginTop: '6px',
  color: '#d1d5db',
  fontSize: '14px'
}

const actionRowStyle = {
  display: 'flex',
  gap: '8px',
  alignItems: 'flex-start'
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