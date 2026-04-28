import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function InvestmentsPage() {
  const [accounts, setAccounts] = useState([])
  const [assets, setAssets] = useState([])
  const [transactions, setTransactions] = useState([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState(null)

  const [searchText, setSearchText] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sortMode, setSortMode] = useState('newest')

  const [formData, setFormData] = useState({
    account_id: '',
    symbol: '',
    display_name: '',
    asset_type: 'stock',
    transaction_date: new Date().toISOString().split('T')[0],
    type: 'buy',
    quantity: '',
    unit_price: '',
    fee: '0'
  })

  useEffect(() => {
    loadInitialData()
  }, [])

  const loadInitialData = async () => {
    setLoading(true)
    setMessage('')

    try {
      await Promise.all([loadAccounts(), loadAssets(), loadTransactions()])
    } catch (error) {
      console.error(error)
      setMessage('Failed to load investment data')
    }

    setLoading(false)
  }

  const loadAccounts = async () => {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) throw new Error('Unable to get current user')

    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) throw error

    setAccounts(data || [])
  }

  const loadAssets = async () => {
    const { data, error } = await supabase
      .from('assets')
      .select('*')
      .order('symbol', { ascending: true })

    if (error) throw error

    setAssets(data || [])
  }

  const loadTransactions = async () => {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) throw new Error('Unable to get current user')

    const { data, error } = await supabase
      .from('investment_transactions')
      .select(`
        id,
        account_id,
        asset_id,
        transaction_date,
        type,
        quantity,
        unit_price,
        fee,
        created_at,
        accounts (
          id,
          name,
          account_type
        ),
        assets (
          id,
          symbol,
          display_name,
          asset_type
        )
      `)
      .eq('user_id', user.id)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) throw error

    setTransactions(data || [])
  }

  const resetForm = () => {
    setFormData({
      account_id: '',
      symbol: '',
      display_name: '',
      asset_type: 'stock',
      transaction_date: new Date().toISOString().split('T')[0],
      type: 'buy',
      quantity: '',
      unit_price: '',
      fee: '0'
    })
    setEditingId(null)
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSymbolChange = (e) => {
    const value = e.target.value.toUpperCase()

    setFormData((prev) => ({
      ...prev,
      symbol: value
    }))

    const matchedAsset = assets.find(
      (asset) => asset.symbol.toUpperCase() === value.toUpperCase()
    )

    if (matchedAsset) {
      setFormData((prev) => ({
        ...prev,
        symbol: matchedAsset.symbol,
        display_name: matchedAsset.display_name || '',
        asset_type: matchedAsset.asset_type
      }))
    }
  }

  const ensureAssetExists = async () => {
    const symbol = formData.symbol.trim().toUpperCase()

    if (!symbol) throw new Error('Symbol is required')

    const existingAsset = assets.find(
      (asset) => asset.symbol.toUpperCase() === symbol
    )

    if (existingAsset) return existingAsset.id

    const { data, error } = await supabase
      .from('assets')
      .insert({
        symbol,
        display_name: formData.display_name.trim() || symbol,
        asset_type: formData.asset_type,
        currency: 'USD'
      })
      .select()
      .single()

    if (error) throw error

    setAssets((prev) => [...prev, data])

    return data.id
  }

  const handleAddOrUpdateTransaction = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')
      if (!formData.account_id) throw new Error('Please select an account')
      if (!formData.transaction_date) throw new Error('Transaction date is required')
      if (!formData.type) throw new Error('Transaction type is required')

      const assetId = await ensureAssetExists()

      const quantityValue = formData.quantity === '' ? null : Number(formData.quantity)
      const unitPriceValue = formData.unit_price === '' ? null : Number(formData.unit_price)
      const feeValue = formData.fee === '' ? 0 : Number(formData.fee)

      if (
        (formData.type === 'buy' || formData.type === 'sell') &&
        (!quantityValue || !unitPriceValue)
      ) {
        throw new Error('Buy/Sell transactions require quantity and unit price')
      }

      if (editingId) {
        const { error } = await supabase
          .from('investment_transactions')
          .update({
            account_id: formData.account_id,
            asset_id: assetId,
            transaction_date: formData.transaction_date,
            type: formData.type,
            quantity: quantityValue,
            unit_price: unitPriceValue,
            fee: feeValue
          })
          .eq('id', editingId)
          .eq('user_id', user.id)

        if (error) throw error

        setMessage('Transaction updated successfully')
      } else {
        const { error } = await supabase.from('investment_transactions').insert({
          user_id: user.id,
          account_id: formData.account_id,
          asset_id: assetId,
          transaction_date: formData.transaction_date,
          type: formData.type,
          quantity: quantityValue,
          unit_price: unitPriceValue,
          fee: feeValue
        })

        if (error) throw error

        setMessage('Transaction added successfully')
      }

      resetForm()
      await Promise.all([loadAssets(), loadTransactions()])
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to save transaction')
    }

    setSaving(false)
  }

  const handleEdit = (tx) => {
    setEditingId(tx.id)
    setFormData({
      account_id: tx.account_id || '',
      symbol: tx.assets?.symbol || '',
      display_name: tx.assets?.display_name || '',
      asset_type: tx.assets?.asset_type || 'stock',
      transaction_date: tx.transaction_date,
      type: tx.type,
      quantity: tx.quantity ?? '',
      unit_price: tx.unit_price ?? '',
      fee: tx.fee ?? '0'
    })
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (txId) => {
    const confirmed = window.confirm('Are you sure you want to delete this investment transaction?')
    if (!confirmed) return

    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const { error } = await supabase
        .from('investment_transactions')
        .delete()
        .eq('id', txId)
        .eq('user_id', user.id)

      if (error) throw error

      if (editingId === txId) resetForm()

      setMessage('Transaction deleted successfully')
      await loadTransactions()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to delete transaction')
    }
  }

  const filteredTransactions = useMemo(() => {
    let rows = [...transactions]

    if (typeFilter !== 'all') {
      rows = rows.filter((tx) => tx.type === typeFilter)
    }

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      rows = rows.filter((tx) => {
        const symbol = tx.assets?.symbol?.toLowerCase() || ''
        const name = tx.assets?.display_name?.toLowerCase() || ''
        const account = tx.accounts?.name?.toLowerCase() || ''
        return symbol.includes(q) || name.includes(q) || account.includes(q)
      })
    }

    if (sortMode === 'newest') {
      rows.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date))
    }

    if (sortMode === 'oldest') {
      rows.sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date))
    }

    if (sortMode === 'value_high') {
      rows.sort((a, b) => getTxValue(b) - getTxValue(a))
    }

    if (sortMode === 'value_low') {
      rows.sort((a, b) => getTxValue(a) - getTxValue(b))
    }

    return rows
  }, [transactions, searchText, typeFilter, sortMode])

  const totalValue = filteredTransactions.reduce((sum, tx) => sum + getTxValue(tx), 0)

  return (
    <div>
      <div style={pageHeaderStyle}>
        <div>
          <h1 style={titleStyle}>Investments</h1>
          <p style={subtitleStyle}>Add, edit, search, and review your investment transactions.</p>
        </div>

        <button type="button" onClick={loadInitialData} style={refreshButtonStyle}>
          Refresh
        </button>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={layoutStyle}>
        <div style={formCardStyle}>
          <div style={formHeaderStyle}>
            <div>
              <h2 style={cardTitleStyle}>
                {editingId ? 'Edit Transaction' : 'Add Transaction'}
              </h2>
              <p style={cardSubtitleStyle}>
                {editingId ? 'Update the selected transaction.' : 'Record a new buy, sell, dividend, fee, or interest.'}
              </p>
            </div>

            {editingId && (
              <button type="button" onClick={resetForm} style={secondaryButtonStyle}>
                Cancel
              </button>
            )}
          </div>

          <form onSubmit={handleAddOrUpdateTransaction}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Account</label>
              <select name="account_id" value={formData.account_id} onChange={handleChange} style={inputStyle}>
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.account_type})
                  </option>
                ))}
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Symbol</label>
              <input
                type="text"
                name="symbol"
                value={formData.symbol}
                onChange={handleSymbolChange}
                placeholder="Example: AAPL, BTC, JEPQ"
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Display Name</label>
              <input
                type="text"
                name="display_name"
                value={formData.display_name}
                onChange={handleChange}
                placeholder="Example: Apple Inc."
                style={inputStyle}
              />
            </div>

            <div style={twoColumnStyle}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Asset Type</label>
                <select name="asset_type" value={formData.asset_type} onChange={handleChange} style={inputStyle}>
                  <option value="stock">Stock</option>
                  <option value="etf">ETF</option>
                  <option value="crypto">Crypto</option>
                  <option value="cash">Cash</option>
                </select>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Type</label>
                <select name="type" value={formData.type} onChange={handleChange} style={inputStyle}>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                  <option value="dividend">Dividend</option>
                  <option value="fee">Fee</option>
                  <option value="interest">Interest</option>
                </select>
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Transaction Date</label>
              <input
                type="date"
                name="transaction_date"
                value={formData.transaction_date}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>

            <div style={twoColumnStyle}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Quantity</label>
                <input
                  type="number"
                  step="0.00000001"
                  name="quantity"
                  value={formData.quantity}
                  onChange={handleChange}
                  placeholder="10"
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Unit Price</label>
                <input
                  type="number"
                  step="0.00000001"
                  name="unit_price"
                  value={formData.unit_price}
                  onChange={handleChange}
                  placeholder="185.50"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Fee</label>
              <input
                type="number"
                step="0.00000001"
                name="fee"
                value={formData.fee}
                onChange={handleChange}
                placeholder="0"
                style={inputStyle}
              />
            </div>

            <button type="submit" disabled={saving} style={buttonStyle}>
              {saving ? 'Saving...' : editingId ? 'Update Transaction' : 'Add Transaction'}
            </button>
          </form>
        </div>

        <div style={listCardStyle}>
          <div style={stickyHeaderStyle}>
            <div style={listTopStyle}>
              <div>
                <h2 style={cardTitleStyle}>Investment Transactions</h2>
                <p style={cardSubtitleStyle}>
                  Showing {filteredTransactions.length} of {transactions.length} transactions.
                </p>
              </div>

              <div style={summaryPillStyle}>
                Total: ${formatMoney(totalValue)}
              </div>
            </div>

            <div style={filterGridStyle}>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search symbol, name, account..."
                style={inputStyle}
              />

              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={inputStyle}>
                <option value="all">All types</option>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="dividend">Dividend</option>
                <option value="fee">Fee</option>
                <option value="interest">Interest</option>
              </select>

              <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} style={inputStyle}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="value_high">Value high to low</option>
                <option value="value_low">Value low to high</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div style={emptyStyle}>Loading transactions...</div>
          ) : filteredTransactions.length === 0 ? (
            <div style={emptyStyle}>No matching transactions.</div>
          ) : (
            <div style={transactionListStyle}>
              {filteredTransactions.map((tx) => {
                const value = getTxValue(tx)

                return (
                  <div key={tx.id} style={transactionItemStyle}>
                    <div style={transactionMainStyle}>
                      <div>
                        <div style={transactionTitleRowStyle}>
                          <strong style={symbolStyle}>{tx.assets?.symbol || 'N/A'}</strong>
                          <span style={getTypeBadgeStyle(tx.type)}>{tx.type.toUpperCase()}</span>
                        </div>

                        <div style={mutedText}>
                          {tx.assets?.display_name || tx.assets?.symbol || 'Unknown Asset'}
                        </div>

                        <div style={mutedText}>
                          {tx.accounts?.name || 'Unknown Account'} · {tx.transaction_date}
                        </div>
                      </div>

                      <div style={transactionRightStyle}>
                        <div style={valueStyle}>${formatMoney(value)}</div>
                        <div style={mutedText}>Qty: {formatNumber(tx.quantity)}</div>
                        <div style={mutedText}>Price: ${formatMoney(tx.unit_price)}</div>
                      </div>
                    </div>

                    <div style={actionRowStyle}>
                      <span style={mutedText}>Fee: ${formatMoney(tx.fee)}</span>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" onClick={() => handleEdit(tx)} style={editButtonStyle}>
                          Edit
                        </button>

                        <button type="button" onClick={() => handleDelete(tx.id)} style={deleteButtonStyle}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getTxValue(tx) {
  const quantity = Number(tx.quantity || 0)
  const unitPrice = Number(tx.unit_price || 0)
  const fee = Number(tx.fee || 0)
  return quantity * unitPrice + fee
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-'

  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 8
  })
}

function getTypeBadgeStyle(type) {
  const base = {
    padding: '4px 9px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 800,
    letterSpacing: '0.04em'
  }

  if (type === 'buy') {
    return {
      ...base,
      background: 'rgba(34,197,94,0.14)',
      color: '#86efac',
      border: '1px solid rgba(34,197,94,0.28)'
    }
  }

  if (type === 'sell') {
    return {
      ...base,
      background: 'rgba(239,68,68,0.14)',
      color: '#fca5a5',
      border: '1px solid rgba(239,68,68,0.28)'
    }
  }

  return {
    ...base,
    background: 'rgba(96,165,250,0.14)',
    color: '#93c5fd',
    border: '1px solid rgba(96,165,250,0.28)'
  }
}

const pageHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  marginBottom: '20px'
}

const titleStyle = {
  margin: 0,
  fontSize: '34px',
  fontWeight: 800
}

const subtitleStyle = {
  marginTop: '8px',
  color: '#cbd5e1',
  fontSize: '16px'
}

const layoutStyle = {
  display: 'grid',
  gridTemplateColumns: '420px minmax(0, 1fr)',
  gap: '24px',
  alignItems: 'start'
}

const formCardStyle = {
  background: '#1f2937',
  padding: '22px',
  borderRadius: '18px',
  border: '1px solid rgba(255,255,255,0.08)',
  position: 'sticky',
  top: '20px'
}

const listCardStyle = {
  background: '#1f2937',
  padding: '22px',
  borderRadius: '18px',
  border: '1px solid rgba(255,255,255,0.08)',
  minWidth: 0
}

const stickyHeaderStyle = {
  position: 'sticky',
  top: 0,
  zIndex: 20,
  background: '#1f2937',
  paddingBottom: '14px'
}

const listTopStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  marginBottom: '16px'
}

const cardTitleStyle = {
  margin: 0,
  fontSize: '24px',
  fontWeight: 800
}

const cardSubtitleStyle = {
  marginTop: '6px',
  marginBottom: 0,
  color: '#94a3b8',
  fontSize: '14px'
}

const formHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  marginBottom: '18px'
}

const fieldStyle = {
  marginBottom: '16px'
}

const twoColumnStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px'
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  color: '#e5e7eb',
  fontWeight: 700
}

const inputStyle = {
  width: '100%',
  padding: '11px 12px',
  borderRadius: '10px',
  border: '1px solid #4b5563',
  background: '#111827',
  color: 'white',
  outline: 'none'
}

const buttonStyle = {
  width: '100%',
  padding: '13px',
  border: 'none',
  borderRadius: '10px',
  background: '#2563eb',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 800
}

const refreshButtonStyle = {
  padding: '11px 14px',
  border: 'none',
  borderRadius: '10px',
  background: '#2563eb',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 800
}

const secondaryButtonStyle = {
  padding: '9px 12px',
  border: 'none',
  borderRadius: '10px',
  background: '#4b5563',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 700
}

const messageStyle = {
  marginBottom: '16px',
  padding: '12px 14px',
  borderRadius: '12px',
  background: '#111827',
  border: '1px solid #374151',
  color: '#f3f4f6'
}

const filterGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1.4fr 0.8fr 0.9fr',
  gap: '12px'
}

const summaryPillStyle = {
  padding: '10px 12px',
  borderRadius: '999px',
  background: 'rgba(37,99,235,0.16)',
  border: '1px solid rgba(96,165,250,0.24)',
  color: '#bfdbfe',
  fontWeight: 800,
  whiteSpace: 'nowrap'
}

const transactionListStyle = {
  maxHeight: '680px',
  overflowY: 'auto',
  paddingRight: '6px',
  display: 'grid',
  gap: '12px'
}

const transactionItemStyle = {
  padding: '16px',
  borderRadius: '14px',
  background: '#111827',
  border: '1px solid #374151'
}

const transactionMainStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '18px'
}

const transactionTitleRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  marginBottom: '8px'
}

const symbolStyle = {
  fontSize: '20px',
  fontWeight: 900
}

const transactionRightStyle = {
  textAlign: 'right',
  minWidth: '150px'
}

const valueStyle = {
  fontWeight: 900,
  fontSize: '18px',
  marginBottom: '6px'
}

const mutedText = {
  marginTop: '5px',
  color: '#cbd5e1',
  fontSize: '14px'
}

const actionRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  marginTop: '14px',
  paddingTop: '12px',
  borderTop: '1px solid rgba(255,255,255,0.08)'
}

const editButtonStyle = {
  padding: '8px 12px',
  border: 'none',
  borderRadius: '10px',
  background: '#2563eb',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 700
}

const deleteButtonStyle = {
  padding: '8px 12px',
  border: 'none',
  borderRadius: '10px',
  background: '#dc2626',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 700
}

const emptyStyle = {
  padding: '24px',
  borderRadius: '14px',
  background: '#111827',
  border: '1px solid #374151',
  color: '#cbd5e1',
  textAlign: 'center'
}