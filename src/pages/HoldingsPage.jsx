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
  const [accounts, setAccounts] = useState([])

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

      // Bài 62K Fix:
      // Do not embed accounts inside investment_transactions here.
      // investment_transactions has two relationships to accounts (account_id and funding_account_id),
      // so accounts(...) is ambiguous in Supabase/PostgREST. Load accounts separately and join in JS.
      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', user.id)

      if (accountError) throw accountError

      setTransactions(txData || [])
      setPriceQuotes(quoteData || [])
      setAssets(assetData || [])
      setAccounts(accountData || [])
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

  const accountById = useMemo(() => {
    const map = new Map()
    for (const account of accounts || []) {
      map.set(account.id, account)
    }
    return map
  }, [accounts])

  const holdingByAssetId = useMemo(() => {
    const map = new Map()
    for (const holding of holdings || []) {
      map.set(holding.asset_id, holding)
    }
    return map
  }, [holdings])

  const accountBreakdownByAssetId = useMemo(() => {
    const latestHoldingPrice = (assetId) => toNumber(holdingByAssetId.get(assetId)?.market_price)
    const map = new Map()

    for (const tx of transactions || []) {
      const asset = tx.assets || {}
      const assetId = tx.asset_id || asset.id
      const accountId = tx.account_id || 'unassigned'
      if (!assetId) continue

      const type = String(tx.type || '').trim().toLowerCase()
      const quantity = toNumber(tx.quantity)
      const unitPrice = toNumber(tx.unit_price)
      const fee = toNumber(tx.fee)
      if (quantity <= 0) continue

      const assetMap = map.get(assetId) || new Map()
      const account = accountById.get(accountId) || null
      const key = accountId
      const row = assetMap.get(key) || {
        assetId,
        accountId,
        accountName: account?.name || (accountId === 'unassigned' ? 'Unassigned' : 'Unknown Account'),
        accountType: account?.account_type || '',
        quantity: 0,
        costBasis: 0,
        transactionCount: 0
      }

      const currentQuantity = toNumber(row.quantity)
      const currentCostBasis = toNumber(row.costBasis)
      const currentAverageCost = currentQuantity > 0 ? currentCostBasis / currentQuantity : 0

      if (type === 'buy' || type === 'deposit') {
        row.quantity = currentQuantity + quantity
        row.costBasis = currentCostBasis + quantity * unitPrice + fee
        row.transactionCount += 1
      }

      if (type === 'sell' || type === 'withdraw') {
        const outgoingQuantity = Math.min(quantity, currentQuantity)
        row.quantity = currentQuantity - outgoingQuantity
        row.costBasis = currentCostBasis - outgoingQuantity * currentAverageCost
        row.transactionCount += 1

        if (row.quantity <= 0.000000001) {
          row.quantity = 0
          row.costBasis = 0
        }
      }

      assetMap.set(key, row)
      map.set(assetId, assetMap)
    }

    const result = {}
    for (const [assetId, accountMap] of map.entries()) {
      const marketPrice = latestHoldingPrice(assetId)
      result[assetId] = Array.from(accountMap.values())
        .filter((row) => toNumber(row.quantity) > 0)
        .map((row) => ({
          ...row,
          marketValue: toNumber(row.quantity) * marketPrice
        }))
        .sort((a, b) => a.accountName.localeCompare(b.accountName))
    }

    return result
  }, [transactions, accountById, holdingByAssetId])

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
          <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
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

          <div style={priceStatusTableScrollStyle}>
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

      <div style={currentHoldingsCardStyle}>
          <h2 style={{ marginTop: 0 }}>Current Holdings</h2>

          {loading ? (
            <p>Loading holdings...</p>
          ) : holdings.length === 0 ? (
            <p>No holdings yet.</p>
          ) : (
            <div style={holdingsTableScrollStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Symbol</th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Qty</th>
                    <th style={thStyle}>Accounts</th>
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
                  {holdings.map((item, index) => {
                    const accountRows = accountBreakdownByAssetId[item.asset_id] || []

                    return (
                      <tr key={`${item.asset_id || item.symbol}-${index}`}>
                        <td style={tdStyle}>{item.symbol}</td>
                        <td style={tdStyle}>{item.display_name || item.symbol}</td>
                        <td style={tdStyle}>{formatQuantity(item.quantity)}</td>
                        <td style={{ ...tdStyle, minWidth: '220px' }}>
                          {accountRows.length === 0 ? (
                            '-'
                          ) : (
                            <div style={accountListStyle}>
                              {accountRows.map((row) => (
                                <div key={`${item.asset_id}-${row.accountId}`} style={accountLineStyle}>
                                  <span>{row.accountName}</span>
                                  <strong>{formatQuantity(row.quantity)}</strong>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
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
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      <div style={updatePriceWrapperStyle}>
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
      </div>

      {holdings.length > 0 && (
        <div style={breakdownCardStyle}>
          <h2 style={{ marginTop: 0 }}>Account Breakdown</h2>
          <p style={breakdownHelperStyle}>
            Holdings are still totaled by symbol above. This section shows where each symbol is held by account, so taxable brokerage and IRA/Roth positions stay clear.
          </p>

          <div style={breakdownTableScrollStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Symbol</th>
                  <th style={thStyle}>Account</th>
                  <th style={thStyle}>Account Type</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Cost Basis</th>
                  <th style={thStyle}>Market Value</th>
                  <th style={thStyle}>Tx Count</th>
                </tr>
              </thead>
              <tbody>
                {holdings.flatMap((item) => {
                  const rows = accountBreakdownByAssetId[item.asset_id] || []

                  return rows.map((row) => (
                    <tr key={`${item.asset_id}-${row.accountId}`}>
                      <td style={tdStyle}>{item.symbol}</td>
                      <td style={tdStyle}>{row.accountName}</td>
                      <td style={tdStyle}>{row.accountType || '-'}</td>
                      <td style={tdStyle}>{formatQuantity(row.quantity)}</td>
                      <td style={tdStyle}>${formatMoney(row.costBasis)}</td>
                      <td style={tdStyle}>${formatMoney(row.marketValue)}</td>
                      <td style={tdStyle}>{row.transactionCount}</td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
  background: 'var(--success)',
  color: 'white'
}

const secondaryButtonStyle = {
  padding: '10px 14px',
  border: 'none',
  borderRadius: '10px',
  background: 'var(--accent-strong)',
  color: 'white',
  cursor: 'pointer'
}

const messageStyle = {
  marginTop: '16px',
  marginBottom: '16px',
  padding: '12px',
  borderRadius: '10px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-main)'
}

const priceStatusCardStyle = {
  marginTop: '16px',
  marginBottom: '16px',
  background: 'var(--bg-card)',
  padding: '20px',
  borderRadius: '12px',
  border: '1px solid var(--border-main)'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '16px'
}

const summaryCardStyle = {
  background: 'var(--bg-card)',
  padding: '20px',
  borderRadius: '12px'
}

const summaryLabelStyle = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  marginBottom: '10px'
}

const summaryValueStyle = {
  fontSize: '26px',
  fontWeight: 700,
  color: 'var(--text-main)'
}

const contentGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
  gap: '24px',
  marginTop: '24px'
}

const cardStyle = {
  background: 'var(--bg-card)',
  padding: '20px',
  borderRadius: '12px',
  border: '1px solid var(--border-main)'
}

const currentHoldingsCardStyle = {
  ...cardStyle,
  marginTop: '24px'
}

const updatePriceWrapperStyle = {
  marginTop: '24px',
  maxWidth: '520px'
}

const fieldStyle = {
  marginBottom: '16px'
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  color: 'var(--text-main)'
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  boxSizing: 'border-box'
}

const primaryButtonStyle = {
  width: '100%',
  padding: '12px',
  border: 'none',
  borderRadius: '8px',
  background: 'var(--accent-strong)',
  color: 'white'
}

const unlockButtonStyle = {
  width: '100%',
  marginTop: '10px',
  padding: '12px',
  border: 'none',
  borderRadius: '8px',
  background: 'var(--warning)',
  color: '#111827',
  fontWeight: 800
}

const lockBoxStyle = {
  marginBottom: '16px',
  padding: '12px',
  borderRadius: '10px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)'
}

const checkboxRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: 'var(--text-main)',
  fontSize: '14px',
  lineHeight: 1.5
}

const lockedInfoStyle = {
  marginTop: '10px',
  color: 'var(--warning)',
  fontSize: '14px',
  fontWeight: 700
}

const helperTextStyle = {
  marginTop: '16px',
  color: 'var(--text-muted)',
  fontSize: '14px',
  lineHeight: 1.6
}


const priceStatusTableScrollStyle = {
  overflowX: 'auto',
  maxHeight: '360px',
  overflowY: 'auto',
  borderRadius: '10px'
}

const holdingsTableScrollStyle = {
  overflowX: 'auto',
  maxHeight: '620px',
  overflowY: 'auto',
  borderRadius: '10px'
}

const breakdownTableScrollStyle = {
  overflowX: 'auto',
  maxHeight: '460px',
  overflowY: 'auto',
  borderRadius: '10px'
}


const breakdownCardStyle = {
  marginTop: '24px',
  background: 'var(--bg-card)',
  padding: '20px',
  borderRadius: '12px',
  border: '1px solid var(--border-main)'
}

const breakdownHelperStyle = {
  marginTop: 0,
  marginBottom: '16px',
  color: 'var(--text-muted)',
  fontSize: '14px',
  lineHeight: 1.6
}

const accountListStyle = {
  display: 'grid',
  gap: '6px'
}

const accountLineStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  color: 'var(--text-main)',
  fontSize: '13px'
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse'
}

const thStyle = {
  textAlign: 'left',
  padding: '12px',
  borderBottom: '1px solid var(--border-main)',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: '14px',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--bg-card)'
}

const tdStyle = {
  padding: '12px',
  borderBottom: '1px solid var(--border-main)',
  color: 'var(--text-main)',
  fontSize: '14px',
  whiteSpace: 'nowrap'
}
