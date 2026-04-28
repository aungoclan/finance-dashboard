import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { refreshAllMarketPrices } from '../lib/marketPrice'
import {
  calculateHoldings,
  calculatePortfolioSummary,
  formatMoney,
  formatPercent,
  formatPrice
} from '../lib/holdings'

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatQuantity(value) {
  return toNumber(value).toLocaleString(undefined, {
    maximumFractionDigits: 8
  })
}

export default function HoldingsPage() {
  const [transactions, setTransactions] = useState([])
  const [priceQuotes, setPriceQuotes] = useState([])
  const [assets, setAssets] = useState([])

  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [marketPrice, setMarketPrice] = useState('')
  const [lockSelectedAsset, setLockSelectedAsset] = useState(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshingPrices, setRefreshingPrices] = useState(false)
  const [message, setMessage] = useState('')
  const [priceRefreshDetails, setPriceRefreshDetails] = useState([])

  useEffect(() => {
    loadHoldingsData()
  }, [])

  const selectedAsset = useMemo(() => {
    return assets.find((asset) => asset.id === selectedAssetId) || null
  }, [assets, selectedAssetId])

  const loadHoldingsData = async (clearMessage = true) => {
    setLoading(true)
    if (clearMessage) setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const { data: txData, error: txError } = await supabase
        .from('investment_transactions')
        .select(`
          id,
          user_id,
          account_id,
          asset_id,
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

      if (txError) throw txError

      const { data: quoteData, error: quoteError } = await supabase
        .from('price_quotes')
        .select('*')
        .order('created_at', { ascending: false })

      if (quoteError) throw quoteError

      const { data: assetData, error: assetError } = await supabase
        .from('assets')
        .select('*')
        .order('symbol', { ascending: true })

      if (assetError) throw assetError

      setTransactions(txData || [])
      setPriceQuotes(quoteData || [])
      setAssets(assetData || [])
    } catch (error) {
      console.error('loadHoldingsData error:', error)
      setMessage(error.message || 'Failed to load holdings')
    } finally {
      setLoading(false)
    }
  }

  const holdings = useMemo(() => {
    return calculateHoldings(transactions, priceQuotes)
  }, [transactions, priceQuotes])

  const summary = useMemo(() => {
    return calculatePortfolioSummary(holdings)
  }, [holdings])

  const handleSelectedAssetChange = (assetId) => {
    setSelectedAssetId(assetId)

    const asset = assets.find((item) => item.id === assetId)

    if (asset?.is_price_locked) {
      setLockSelectedAsset(true)
      setMarketPrice(asset.locked_price ? String(asset.locked_price) : '')
    } else {
      setLockSelectedAsset(false)
      setMarketPrice('')
    }
  }

  const handleSaveManualPrice = async (e) => {
    e.preventDefault()

    if (!selectedAssetId) {
      setMessage('Please select an asset')
      return
    }

    const numericPrice = Number(marketPrice)

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setMessage('Please enter a valid market price greater than 0')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const { error } = await supabase.from('price_quotes').insert({
        asset_id: selectedAssetId,
        price: numericPrice
      })

      if (error) throw error

      if (lockSelectedAsset) {
        const { error: lockError } = await supabase
          .from('assets')
          .update({
            is_price_locked: true,
            locked_price: numericPrice,
            price_lock_note: 'Manual lock from Holdings page',
            price_locked_at: new Date().toISOString()
          })
          .eq('id', selectedAssetId)

        if (lockError) throw lockError
      }

      setSelectedAssetId('')
      setMarketPrice('')
      setLockSelectedAsset(false)
      setMessage(
        lockSelectedAsset
          ? 'Manual price saved and locked'
          : 'Manual market price saved successfully'
      )

      await loadHoldingsData(false)
    } catch (error) {
      console.error('handleSaveManualPrice error:', error)
      setMessage(error.message || 'Failed to save manual price')
    } finally {
      setSaving(false)
    }
  }

  const handleUnlockPrice = async () => {
    if (!selectedAssetId) {
      setMessage('Please select an asset to unlock')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const { error } = await supabase
        .from('assets')
        .update({
          is_price_locked: false,
          locked_price: null,
          price_lock_note: null,
          price_locked_at: null
        })
        .eq('id', selectedAssetId)

      if (error) throw error

      setLockSelectedAsset(false)
      setMarketPrice('')
      setMessage('Price unlocked. Auto refresh can update this asset again.')
      await loadHoldingsData(false)
    } catch (error) {
      console.error('handleUnlockPrice error:', error)
      setMessage(error.message || 'Failed to unlock price')
    } finally {
      setSaving(false)
    }
  }

  const handleRefreshAllPrices = async () => {
    setRefreshingPrices(true)
    setMessage('Updating market prices...')
    setPriceRefreshDetails([])

    try {
      const result = await refreshAllMarketPrices()
      await loadHoldingsData(false)
      setMessage(result.message || 'Market prices refreshed')
      setPriceRefreshDetails(result.details || [])
    } catch (error) {
      console.error('handleRefreshAllPrices error:', error)
      setMessage(error.message || 'Failed to refresh market prices')
    } finally {
      setRefreshingPrices(false)
    }
  }

  return (
    <div>
      <div style={headerRowStyle}>
        <div>
          <h1 style={{ marginBottom: '8px' }}>Holdings</h1>
          <p style={{ marginTop: 0, color: '#d1d5db' }}>
            View your current positions, market value, and unrealized profit/loss.
          </p>
        </div>

        <div style={actionButtonRowStyle}>
          <button
            onClick={handleRefreshAllPrices}
            disabled={refreshingPrices}
            style={{
              ...refreshButtonStyle,
              opacity: refreshingPrices ? 0.7 : 1,
              cursor: refreshingPrices ? 'not-allowed' : 'pointer'
            }}
          >
            {refreshingPrices ? 'Updating...' : 'Refresh All Market Prices'}
          </button>

          <button onClick={() => loadHoldingsData()} style={secondaryButtonStyle}>
            Refresh Holdings
          </button>
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      {priceRefreshDetails.length > 0 && (
        <div style={priceStatusCardStyle}>
          <h2 style={{ marginTop: 0 }}>Price Refresh Status</h2>

          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Symbol</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Price</th>
                  <th style={thStyle}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {priceRefreshDetails.map((item, index) => {
                  const statusColor =
                    item.status === 'updated'
                      ? '#22c55e'
                      : item.status === 'locked'
                        ? '#fbbf24'
                        : item.status === 'guarded'
                          ? '#f59e0b'
                          : '#ef4444'

                  return (
                    <tr key={`${item.symbol}-${index}`}>
                      <td style={tdStyle}>{item.symbol}</td>
                      <td style={tdStyle}>{item.source || '-'}</td>
                      <td
                        style={{
                          ...tdStyle,
                          color: statusColor,
                          fontWeight: 700
                        }}
                      >
                        {item.status || '-'}
                      </td>
                      <td style={tdStyle}>
                        {item.price != null ? `$${formatPrice(item.price)}` : '-'}
                      </td>
                      <td style={tdStyle}>{item.reason || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={summaryGridStyle}>
        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>Total Cost Basis</div>
          <div style={summaryValueStyle}>${formatMoney(summary.totalCostBasis)}</div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>Total Market Value</div>
          <div style={summaryValueStyle}>${formatMoney(summary.totalMarketValue)}</div>
        </div>

        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>Unrealized P&amp;L</div>
          <div
            style={{
              ...summaryValueStyle,
              color: summary.totalUnrealizedPL >= 0 ? '#22c55e' : '#ef4444'
            }}
          >
            ${formatMoney(summary.totalUnrealizedPL)}
          </div>
          <div
            style={{
              marginTop: '8px',
              color: summary.totalUnrealizedPLPercent >= 0 ? '#22c55e' : '#ef4444',
              fontSize: '14px'
            }}
          >
            {formatPercent(summary.totalUnrealizedPLPercent)}
          </div>
        </div>
      </div>

      <div style={contentGridStyle}>
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Update Market Price</h2>

          <form onSubmit={handleSaveManualPrice}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Asset</label>
              <select
                value={selectedAssetId}
                onChange={(e) => handleSelectedAssetChange(e.target.value)}
                style={inputStyle}
              >
                <option value="">Select asset</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.symbol} ({asset.display_name || asset.symbol})
                    {asset.is_price_locked ? ' 🔒' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Market Price</label>
              <input
                type="number"
                step="0.00000001"
                value={marketPrice}
                onChange={(e) => setMarketPrice(e.target.value)}
                placeholder="Example: 52.45"
                style={inputStyle}
              />
            </div>

            <div style={lockBoxStyle}>
              <label style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  checked={lockSelectedAsset}
                  onChange={(e) => setLockSelectedAsset(e.target.checked)}
                />
                <span>Lock this price and prevent auto refresh overwrite</span>
              </label>

              {selectedAsset?.is_price_locked && (
                <div style={lockedInfoStyle}>
                  🔒 Currently locked at ${formatPrice(selectedAsset.locked_price)}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              style={{
                ...primaryButtonStyle,
                opacity: saving ? 0.7 : 1,
                cursor: saving ? 'not-allowed' : 'pointer'
              }}
            >
              {saving ? 'Saving...' : 'Save Manual Price'}
            </button>

            {selectedAsset?.is_price_locked && (
              <button
                type="button"
                onClick={handleUnlockPrice}
                disabled={saving}
                style={{
                  ...unlockButtonStyle,
                  opacity: saving ? 0.7 : 1,
                  cursor: saving ? 'not-allowed' : 'pointer'
                }}
              >
                Unlock Price
              </button>
            )}
          </form>

          <div style={helperTextStyle}>
            Auto refresh uses CoinGecko for crypto and Alpha Vantage / Stooq for
            stocks and ETFs. Manual locked prices will not be overwritten.
          </div>
        </div>

        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Current Holdings</h2>

          {loading ? (
            <p>Loading holdings...</p>
          ) : holdings.length === 0 ? (
            <p>No holdings yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Symbol</th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Qty</th>
                    <th style={thStyle}>Avg Cost</th>
                    <th style={thStyle}>Cost Basis</th>
                    <th style={thStyle}>Market Price</th>
                    <th style={thStyle}>Market Value</th>
                    <th style={thStyle}>Unrealized P&amp;L</th>
                    <th style={thStyle}>P&amp;L %</th>
                    <th style={thStyle}>Lock</th>
                  </tr>
                </thead>

                <tbody>
                  {holdings.map((item, index) => (
                    <tr key={`${item.asset_id || item.symbol}-${index}`}>
                      <td style={tdStyle}>{item.symbol}</td>
                      <td style={tdStyle}>{item.display_name || item.symbol}</td>
                      <td style={tdStyle}>{formatQuantity(item.quantity)}</td>
                      <td style={tdStyle}>${formatMoney(item.average_cost)}</td>
                      <td style={tdStyle}>${formatMoney(item.cost_basis)}</td>
                      <td style={tdStyle}>
                        {item.market_price > 0 ? `$${formatPrice(item.market_price)}` : '-'}
                      </td>
                      <td style={tdStyle}>${formatMoney(item.market_value)}</td>
                      <td
                        style={{
                          ...tdStyle,
                          color: item.unrealized_pl >= 0 ? '#22c55e' : '#ef4444'
                        }}
                      >
                        ${formatMoney(item.unrealized_pl)}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color: item.unrealized_pl_percent >= 0 ? '#22c55e' : '#ef4444'
                        }}
                      >
                        {formatPercent(item.unrealized_pl_percent)}
                      </td>
                      <td style={tdStyle}>{item.is_price_locked ? '🔒' : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
  marginBottom: '24px',
  flexWrap: 'wrap'
}

const actionButtonRowStyle = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap'
}

const refreshButtonStyle = {
  padding: '10px 14px',
  border: 'none',
  borderRadius: '10px',
  background: '#16a34a',
  color: 'white'
}

const secondaryButtonStyle = {
  padding: '10px 14px',
  border: 'none',
  borderRadius: '10px',
  background: '#2563eb',
  color: 'white',
  cursor: 'pointer'
}

const messageStyle = {
  marginTop: '16px',
  marginBottom: '16px',
  padding: '12px',
  borderRadius: '10px',
  background: '#374151',
  border: '1px solid #4b5563',
  color: '#f3f4f6'
}

const priceStatusCardStyle = {
  marginTop: '16px',
  marginBottom: '16px',
  background: '#1f2937',
  padding: '20px',
  borderRadius: '12px',
  border: '1px solid #374151'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
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
  fontSize: '26px',
  fontWeight: 700,
  color: 'white'
}

const contentGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
  gap: '24px',
  marginTop: '24px'
}

const cardStyle = {
  background: '#1f2937',
  padding: '20px',
  borderRadius: '12px',
  border: '1px solid #374151'
}

const fieldStyle = {
  marginBottom: '16px'
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  color: '#f9fafb'
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid #4b5563',
  background: '#111827',
  color: 'white',
  boxSizing: 'border-box'
}

const primaryButtonStyle = {
  width: '100%',
  padding: '12px',
  border: 'none',
  borderRadius: '8px',
  background: '#2563eb',
  color: 'white'
}

const unlockButtonStyle = {
  width: '100%',
  marginTop: '10px',
  padding: '12px',
  border: 'none',
  borderRadius: '8px',
  background: '#f59e0b',
  color: '#111827',
  fontWeight: 800
}

const lockBoxStyle = {
  marginBottom: '16px',
  padding: '12px',
  borderRadius: '10px',
  background: '#111827',
  border: '1px solid #374151'
}

const checkboxRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: '#f9fafb',
  fontSize: '14px',
  lineHeight: 1.5
}

const lockedInfoStyle = {
  marginTop: '10px',
  color: '#fbbf24',
  fontSize: '14px',
  fontWeight: 700
}

const helperTextStyle = {
  marginTop: '16px',
  color: '#d1d5db',
  fontSize: '14px',
  lineHeight: 1.6
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse'
}

const thStyle = {
  textAlign: 'left',
  padding: '12px',
  borderBottom: '1px solid #374151',
  color: '#d1d5db',
  fontWeight: 600,
  fontSize: '14px',
  whiteSpace: 'nowrap'
}

const tdStyle = {
  padding: '12px',
  borderBottom: '1px solid #374151',
  color: 'white',
  fontSize: '14px',
  whiteSpace: 'nowrap'
}