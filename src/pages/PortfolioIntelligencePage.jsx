import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  calculateHoldings,
  calculatePortfolioSummary,
  formatMoney,
  formatPercent
} from '../lib/holdings'

const RISK_LIMITS = {
  singlePositionHigh: 35,
  singlePositionMedium: 20,
  cryptoHigh: 60,
  cryptoMedium: 35,
  missingPriceHigh: 1,
  loserHigh: -25,
  loserMedium: -12
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function money(value) {
  return `$${formatMoney(value)}`
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function typeLabel(type) {
  const value = normalize(type) || 'unknown'
  const labels = {
    stock: 'Stock',
    etf: 'ETF',
    crypto: 'Crypto',
    cash: 'Cash',
    other: 'Other',
    unknown: 'Unknown'
  }

  return labels[value] || value.toUpperCase()
}

function getToneColor(tone) {
  if (tone === 'green') return 'var(--success)'
  if (tone === 'red') return 'var(--danger)'
  if (tone === 'yellow') return 'var(--warning)'
  return 'var(--accent-strong)'
}

function getRiskLevel(score) {
  if (score >= 75) return { label: 'High Risk', tone: 'red' }
  if (score >= 45) return { label: 'Medium Risk', tone: 'yellow' }
  return { label: 'Balanced', tone: 'green' }
}

export default function PortfolioIntelligencePage() {
  const [transactions, setTransactions] = useState([])
  const [priceQuotes, setPriceQuotes] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [assetTypeFilter, setAssetTypeFilter] = useState('all')
  const [sortBy, setSortBy] = useState('allocation')

  useEffect(() => {
    loadPortfolioData()
  }, [])

  async function loadPortfolioData() {
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

      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (accountError) throw accountError

      setTransactions(txData || [])
      setPriceQuotes(quoteData || [])
      setAccounts(accountData || [])
    } catch (error) {
      console.error('loadPortfolioData error:', error)
      setMessage(error.message || 'Failed to load portfolio intelligence data')
    } finally {
      setLoading(false)
    }
  }

  const intelligence = useMemo(() => {
    const holdings = calculateHoldings(transactions, priceQuotes)
    const summary = calculatePortfolioSummary(holdings)
    const totalValue = toNumber(summary.totalMarketValue)
    const totalCost = toNumber(summary.totalCostBasis)

    const holdingsWithAllocation = holdings.map((item) => ({
      ...item,
      allocationPercent:
        totalValue > 0 ? (toNumber(item.market_value) / totalValue) * 100 : 0
    }))

    const allocationByType = Object.values(
      holdingsWithAllocation.reduce((map, item) => {
        const type = normalize(item.asset_type) || 'unknown'

        if (!map[type]) {
          map[type] = {
            type,
            label: typeLabel(type),
            value: 0,
            costBasis: 0,
            unrealizedPL: 0,
            count: 0
          }
        }

        map[type].value += toNumber(item.market_value)
        map[type].costBasis += toNumber(item.cost_basis)
        map[type].unrealizedPL += toNumber(item.unrealized_pl)
        map[type].count += 1

        return map
      }, {})
    )
      .map((item) => ({
        ...item,
        percent: totalValue > 0 ? (item.value / totalValue) * 100 : 0,
        plPercent: item.costBasis > 0 ? (item.unrealizedPL / item.costBasis) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value)

    const accountNameMap = accounts.reduce((map, account) => {
      map[account.id] = account.name || 'Unnamed Account'
      return map
    }, {})

    const accountRows = Object.values(
      transactions.reduce((map, tx) => {
        const accountId = tx.account_id || 'unassigned'

        if (!map[accountId]) {
          map[accountId] = {
            accountId,
            name: accountId === 'unassigned' ? 'Unassigned Activity' : accountNameMap[accountId] || 'Unknown Account',
            transactions: []
          }
        }

        map[accountId].transactions.push(tx)
        return map
      }, {})
    )
      .map((account) => {
        const accountHoldings = calculateHoldings(account.transactions, priceQuotes)
        const accountSummary = calculatePortfolioSummary(accountHoldings)
        const value = toNumber(accountSummary.totalMarketValue)

        return {
          ...account,
          holdings: accountHoldings,
          value,
          costBasis: toNumber(accountSummary.totalCostBasis),
          unrealizedPL: toNumber(accountSummary.totalUnrealizedPL),
          unrealizedPLPercent: toNumber(accountSummary.totalUnrealizedPLPercent),
          percent: totalValue > 0 ? (value / totalValue) * 100 : 0
        }
      })
      .filter((item) => item.value > 0 || item.transactions.length > 0)
      .sort((a, b) => b.value - a.value)

    const sortedByValue = [...holdingsWithAllocation].sort(
      (a, b) => toNumber(b.market_value) - toNumber(a.market_value)
    )

    const sortedByWinner = [...holdingsWithAllocation].sort(
      (a, b) => toNumber(b.unrealized_pl_percent) - toNumber(a.unrealized_pl_percent)
    )

    const sortedByLoser = [...holdingsWithAllocation].sort(
      (a, b) => toNumber(a.unrealized_pl_percent) - toNumber(b.unrealized_pl_percent)
    )

    const missingPriceHoldings = holdingsWithAllocation.filter(
      (item) => !item.has_market_price || toNumber(item.market_price) <= 0
    )

    const lockedPriceHoldings = holdingsWithAllocation.filter(
      (item) => item.price_source === 'locked' || item.is_price_locked
    )

    const cryptoAllocation = allocationByType.find((item) => item.type === 'crypto')
    const topPosition = sortedByValue[0] || null
    const topLoser = sortedByLoser[0] || null

    const warnings = []
    let riskScore = 0

    if (topPosition?.allocationPercent >= RISK_LIMITS.singlePositionHigh) {
      riskScore += 35
      warnings.push({
        tone: 'red',
        title: 'High concentration risk',
        detail: `${topPosition.symbol} is ${formatPercent(topPosition.allocationPercent)} of your portfolio.`
      })
    } else if (topPosition?.allocationPercent >= RISK_LIMITS.singlePositionMedium) {
      riskScore += 18
      warnings.push({
        tone: 'yellow',
        title: 'Moderate concentration',
        detail: `${topPosition.symbol} is ${formatPercent(topPosition.allocationPercent)} of your portfolio.`
      })
    }

    if (cryptoAllocation?.percent >= RISK_LIMITS.cryptoHigh) {
      riskScore += 30
      warnings.push({
        tone: 'red',
        title: 'Crypto-heavy allocation',
        detail: `Crypto is ${formatPercent(cryptoAllocation.percent)} of your portfolio.`
      })
    } else if (cryptoAllocation?.percent >= RISK_LIMITS.cryptoMedium) {
      riskScore += 15
      warnings.push({
        tone: 'yellow',
        title: 'Crypto allocation watch',
        detail: `Crypto is ${formatPercent(cryptoAllocation.percent)} of your portfolio.`
      })
    }

    if (missingPriceHoldings.length >= RISK_LIMITS.missingPriceHigh) {
      riskScore += 20
      warnings.push({
        tone: 'yellow',
        title: 'Missing market prices',
        detail: `${missingPriceHoldings.length} holding(s) need a valid price.`
      })
    }

    if (topLoser?.unrealized_pl_percent <= RISK_LIMITS.loserHigh) {
      riskScore += 15
      warnings.push({
        tone: 'red',
        title: 'Large unrealized loser',
        detail: `${topLoser.symbol} is down ${formatPercent(Math.abs(topLoser.unrealized_pl_percent))}.`
      })
    } else if (topLoser?.unrealized_pl_percent <= RISK_LIMITS.loserMedium) {
      riskScore += 8
      warnings.push({
        tone: 'yellow',
        title: 'Unrealized loser watch',
        detail: `${topLoser.symbol} is down ${formatPercent(Math.abs(topLoser.unrealized_pl_percent))}.`
      })
    }

    if (warnings.length === 0 && holdingsWithAllocation.length > 0) {
      warnings.push({
        tone: 'green',
        title: 'No major risk flags',
        detail: 'Your current holdings do not show major concentration or price-data issues.'
      })
    }

    const risk = getRiskLevel(Math.min(riskScore, 100))

    return {
      holdings: holdingsWithAllocation,
      summary,
      totalValue,
      totalCost,
      allocationByType,
      accountRows,
      topPositions: sortedByValue.slice(0, 8),
      winners: sortedByWinner.slice(0, 5),
      losers: sortedByLoser.slice(0, 5),
      missingPriceHoldings,
      lockedPriceHoldings,
      warnings,
      riskScore: Math.min(riskScore, 100),
      risk
    }
  }, [transactions, priceQuotes, accounts])

  const filteredHoldings = useMemo(() => {
    let rows = [...intelligence.holdings]

    if (assetTypeFilter !== 'all') {
      rows = rows.filter((item) => normalize(item.asset_type) === assetTypeFilter)
    }

    if (sortBy === 'value') {
      rows.sort((a, b) => toNumber(b.market_value) - toNumber(a.market_value))
    } else if (sortBy === 'pl') {
      rows.sort((a, b) => toNumber(b.unrealized_pl) - toNumber(a.unrealized_pl))
    } else if (sortBy === 'loss') {
      rows.sort((a, b) => toNumber(a.unrealized_pl) - toNumber(b.unrealized_pl))
    } else {
      rows.sort((a, b) => toNumber(b.allocationPercent) - toNumber(a.allocationPercent))
    }

    return rows
  }, [intelligence.holdings, assetTypeFilter, sortBy])

  const availableTypes = useMemo(() => {
    const types = new Set(intelligence.holdings.map((item) => normalize(item.asset_type) || 'unknown'))
    return [...types].sort()
  }, [intelligence.holdings])

  if (loading) {
    return <div style={pageStyle}>Loading portfolio intelligence...</div>
  }

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>PORTFOLIO INTELLIGENCE</div>
          <h1 style={heroTitleStyle}>Portfolio IQ</h1>
          <p style={heroSubtitleStyle}>
            Review allocation, concentration, winners, losers, price-data health,
            and account exposure in one safe read-only page.
          </p>
        </div>

        <button type="button" onClick={loadPortfolioData} style={refreshButtonStyle}>
          Refresh
        </button>
      </section>

      {message && <div style={messageStyle}>{message}</div>}

      <section style={statGridStyle}>
        <StatCard title="Portfolio Value" value={money(intelligence.summary.totalMarketValue)} detail={`Cost basis ${money(intelligence.summary.totalCostBasis)}`} tone="blue" />
        <StatCard title="Unrealized P&L" value={money(intelligence.summary.totalUnrealizedPL)} detail={formatPercent(intelligence.summary.totalUnrealizedPLPercent)} tone={intelligence.summary.totalUnrealizedPL >= 0 ? 'green' : 'red'} />
        <StatCard title="Positions" value={String(intelligence.summary.totalPositions)} detail={`${intelligence.missingPriceHoldings.length} missing price · ${intelligence.lockedPriceHoldings.length} locked`} tone={intelligence.missingPriceHoldings.length > 0 ? 'yellow' : 'green'} />
        <StatCard title="Risk Level" value={intelligence.risk.label} detail={`Risk score ${intelligence.riskScore}/100`} tone={intelligence.risk.tone} />
      </section>

      <section style={twoColumnStyle}>
        <Panel title="Allocation by Asset Type" subtitle="Shows where your market value is concentrated.">
          {intelligence.allocationByType.length === 0 ? (
            <EmptyState text="No holdings yet." />
          ) : (
            <div style={stackStyle}>
              {intelligence.allocationByType.map((item) => (
                <ProgressRow
                  key={item.type}
                  title={item.label}
                  subtitle={`${item.count} position(s) · P&L ${money(item.unrealizedPL)} (${formatPercent(item.plPercent)})`}
                  value={`${money(item.value)} · ${formatPercent(item.percent)}`}
                  percent={item.percent}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Risk Flags" subtitle="Read-only notes. Use Holdings or Data Health to fix details.">
          <div style={stackStyle}>
            {intelligence.warnings.map((item) => (
              <div key={`${item.title}-${item.detail}`} style={warningCardStyle(item.tone)}>
                <div style={warningTitleStyle}>{item.title}</div>
                <div style={warningDetailStyle}>{item.detail}</div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section style={twoColumnStyle}>
        <Panel title="Top Holdings" subtitle="Largest positions by current market value. Scroll inside this box when there are many positions.">
          {intelligence.topPositions.length === 0 ? (
            <EmptyState text="No positions yet." />
          ) : (
            <div style={scrollListStyle}>
              <div style={stackStyle}>
                {intelligence.topPositions.map((item) => (
                  <ProgressRow
                    key={item.asset_id}
                    title={item.symbol}
                    subtitle={`${typeLabel(item.asset_type)} · ${item.display_name || item.symbol}`}
                    value={`${money(item.market_value)} · ${formatPercent(item.allocationPercent)}`}
                    percent={item.allocationPercent}
                  />
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Account Allocation" subtitle="Investment value grouped by account.">
          {intelligence.accountRows.length === 0 ? (
            <EmptyState text="No account exposure yet." />
          ) : (
            <div style={stackStyle}>
              {intelligence.accountRows.map((item) => (
                <ProgressRow
                  key={item.accountId}
                  title={item.name}
                  subtitle={`${item.holdings.length} position(s) · P&L ${money(item.unrealizedPL)} (${formatPercent(item.unrealizedPLPercent)})`}
                  value={`${money(item.value)} · ${formatPercent(item.percent)}`}
                  percent={item.percent}
                />
              ))}
            </div>
          )}
        </Panel>
      </section>

      <section style={twoColumnStyle}>
        <Panel title="Winners" subtitle="Best unrealized performance by percent.">
          <MiniHoldingList rows={intelligence.winners} emptyText="No winners yet." />
        </Panel>

        <Panel title="Losers" subtitle="Worst unrealized performance by percent.">
          <MiniHoldingList rows={intelligence.losers} emptyText="No losers yet." />
        </Panel>
      </section>

      <section style={panelStyle}>
        <div style={panelHeaderStyle}>
          <div>
            <h2 style={panelTitleStyle}>Holding Detail Review</h2>
            <p style={panelSubtitleStyle}>
              Sort and filter your current positions without editing any data.
            </p>
          </div>

          <div style={controlsStyle}>
            <select value={assetTypeFilter} onChange={(e) => setAssetTypeFilter(e.target.value)} style={selectStyle}>
              <option value="all">All types</option>
              {availableTypes.map((type) => (
                <option key={type} value={type}>{typeLabel(type)}</option>
              ))}
            </select>

            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={selectStyle}>
              <option value="allocation">Sort by allocation</option>
              <option value="value">Sort by value</option>
              <option value="pl">Sort by P&L</option>
              <option value="loss">Sort by loss</option>
            </select>
          </div>
        </div>

        {filteredHoldings.length === 0 ? (
          <EmptyState text="No holdings match this filter." />
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th>Type</Th>
                  <Th align="right">Value</Th>
                  <Th align="right">Allocation</Th>
                  <Th align="right">Cost</Th>
                  <Th align="right">P&L</Th>
                  <Th align="right">Price</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {filteredHoldings.map((item) => (
                  <tr key={item.asset_id} style={tableRowStyle}>
                    <Td>
                      <div style={symbolStyle}>{item.symbol}</div>
                      <div style={mutedSmallStyle}>{item.display_name || item.symbol}</div>
                    </Td>
                    <Td>{typeLabel(item.asset_type)}</Td>
                    <Td align="right">{money(item.market_value)}</Td>
                    <Td align="right">{formatPercent(item.allocationPercent)}</Td>
                    <Td align="right">{money(item.cost_basis)}</Td>
                    <Td align="right">
                      <span style={{ color: item.unrealized_pl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 800 }}>
                        {money(item.unrealized_pl)}
                      </span>
                      <div style={mutedSmallStyle}>{formatPercent(item.unrealized_pl_percent)}</div>
                    </Td>
                    <Td align="right">{money(item.market_price)}</Td>
                    <Td>
                      {item.price_source === 'locked' ? (
                        <Badge tone="yellow">Locked</Badge>
                      ) : item.has_market_price ? (
                        <Badge tone="green">Live</Badge>
                      ) : (
                        <Badge tone="red">Missing</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({ title, value, detail, tone }) {
  return (
    <div style={statCardStyle}>
      <div style={statTitleStyle}>{title}</div>
      <div style={{ ...statValueStyle, color: getToneColor(tone) }}>{value}</div>
      <div style={statDetailStyle}>{detail}</div>
    </div>
  )
}

function Panel({ title, subtitle, children }) {
  return (
    <section style={panelStyle}>
      <div style={panelHeaderStyle}>
        <div>
          <h2 style={panelTitleStyle}>{title}</h2>
          <p style={panelSubtitleStyle}>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function ProgressRow({ title, subtitle, value, percent }) {
  return (
    <div style={progressRowStyle}>
      <div style={progressTopStyle}>
        <div>
          <div style={progressTitleStyle}>{title}</div>
          <div style={mutedSmallStyle}>{subtitle}</div>
        </div>
        <div style={progressValueStyle}>{value}</div>
      </div>
      <div style={barTrackStyle}>
        <div style={{ ...barFillStyle, width: `${Math.min(Math.max(toNumber(percent), 0), 100)}%` }} />
      </div>
    </div>
  )
}

function MiniHoldingList({ rows, emptyText }) {
  if (!rows.length) return <EmptyState text={emptyText} />

  return (
    <div style={stackStyle}>
      {rows.map((item) => (
        <div key={item.asset_id} style={miniRowStyle}>
          <div>
            <div style={progressTitleStyle}>{item.symbol}</div>
            <div style={mutedSmallStyle}>{typeLabel(item.asset_type)} · {money(item.market_value)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: item.unrealized_pl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 900 }}>
              {money(item.unrealized_pl)}
            </div>
            <div style={mutedSmallStyle}>{formatPercent(item.unrealized_pl_percent)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ text }) {
  return <div style={emptyStyle}>{text}</div>
}

function Badge({ tone, children }) {
  return <span style={badgeStyle(tone)}>{children}</span>
}

function Th({ children, align = 'left' }) {
  return <th style={{ ...thStyle, textAlign: align }}>{children}</th>
}

function Td({ children, align = 'left' }) {
  return <td style={{ ...tdStyle, textAlign: align }}>{children}</td>
}

const pageStyle = {
  width: '100%',
  maxWidth: '1500px',
  margin: '0 auto',
  display: 'grid',
  gap: '22px',
  color: 'var(--text-main)'
}

const heroStyle = {
  background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-strong) 12%, transparent), var(--bg-card) 58%, color-mix(in srgb, var(--success) 10%, transparent))',
  border: '1px solid var(--border-main)',
  borderRadius: '22px',
  padding: '28px',
  display: 'flex',
  justifyContent: 'space-between',
  gap: '18px',
  alignItems: 'flex-start'
}

const eyebrowStyle = {
  color: 'var(--accent-strong)',
  letterSpacing: '0.16em',
  fontWeight: 900,
  fontSize: '13px',
  marginBottom: '10px'
}

const heroTitleStyle = {
  margin: 0,
  fontSize: '38px',
  lineHeight: 1.05,
  fontWeight: 900
}

const heroSubtitleStyle = {
  margin: '14px 0 0 0',
  color: 'var(--text-muted)',
  fontSize: '17px',
  lineHeight: 1.5,
  maxWidth: '850px'
}

const refreshButtonStyle = {
  border: '1px solid var(--accent-strong)',
  background: 'var(--accent-strong)',
  color: 'white',
  borderRadius: '12px',
  padding: '12px 18px',
  fontWeight: 900,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}

const messageStyle = {
  padding: '14px 16px',
  borderRadius: '14px',
  border: '1px solid var(--warning)',
  background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  color: 'var(--warning)'
}

const statGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: '16px'
}

const statCardStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-main)',
  borderRadius: '18px',
  padding: '20px'
}

const statTitleStyle = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  marginBottom: '12px'
}

const statValueStyle = {
  fontSize: '30px',
  lineHeight: 1.1,
  fontWeight: 900
}

const statDetailStyle = {
  color: 'var(--text-muted)',
  marginTop: '10px',
  fontSize: '14px'
}

const twoColumnStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
  gap: '18px',
  alignItems: 'start'
}

const panelStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-main)',
  borderRadius: '20px',
  padding: '22px',
  minWidth: 0
}

const panelHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '18px',
  flexWrap: 'wrap',
  marginBottom: '18px'
}

const panelTitleStyle = {
  margin: 0,
  fontSize: '24px',
  fontWeight: 900
}

const panelSubtitleStyle = {
  margin: '8px 0 0 0',
  color: 'var(--text-muted)',
  lineHeight: 1.45
}

const stackStyle = {
  display: 'grid',
  gap: '14px'
}

const scrollListStyle = {
  maxHeight: '430px',
  overflowY: 'auto',
  paddingRight: '6px',
  overscrollBehavior: 'contain'
}

const progressRowStyle = {
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  borderRadius: '14px',
  padding: '14px'
}

const progressTopStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '14px',
  alignItems: 'flex-start',
  marginBottom: '10px'
}

const progressTitleStyle = {
  fontWeight: 900,
  color: 'var(--text-main)'
}

const progressValueStyle = {
  color: 'var(--text-main)',
  fontWeight: 800,
  whiteSpace: 'nowrap',
  textAlign: 'right'
}

const mutedSmallStyle = {
  color: 'var(--text-muted)',
  fontSize: '13px',
  marginTop: '4px'
}

const barTrackStyle = {
  height: '9px',
  borderRadius: '999px',
  background: 'var(--bg-card)',
  overflow: 'hidden'
}

const barFillStyle = {
  height: '100%',
  borderRadius: '999px',
  background: 'linear-gradient(90deg, var(--accent-strong), var(--success))'
}

const warningCardStyle = (tone) => ({
  background: tone === 'red' ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : tone === 'yellow' ? 'color-mix(in srgb, var(--warning) 12%, transparent)' : 'color-mix(in srgb, var(--success) 12%, transparent)',
  border: `1px solid ${tone === 'red' ? 'var(--danger)' : tone === 'yellow' ? 'var(--warning)' : 'var(--success)'}`,
  borderRadius: '14px',
  padding: '14px'
})

const warningTitleStyle = {
  fontWeight: 900,
  color: 'var(--text-main)',
  marginBottom: '6px'
}

const warningDetailStyle = {
  color: 'var(--text-main)',
  lineHeight: 1.45
}

const miniRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '14px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  borderRadius: '14px',
  padding: '14px'
}

const controlsStyle = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap'
}

const selectStyle = {
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  border: '1px solid var(--border-main)',
  borderRadius: '12px',
  padding: '11px 12px',
  minWidth: '170px',
  fontSize: '15px'
}

const tableWrapStyle = {
  overflowX: 'auto',
  border: '1px solid var(--border-main)',
  borderRadius: '16px'
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: '900px'
}

const thStyle = {
  padding: '14px 14px',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-muted)',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  borderBottom: '1px solid var(--border-main)'
}

const tdStyle = {
  padding: '14px',
  borderBottom: '1px solid var(--border-main)',
  color: 'var(--text-main)',
  verticalAlign: 'top'
}

const tableRowStyle = {
  background: 'var(--bg-card)'
}

const symbolStyle = {
  fontWeight: 900,
  color: 'var(--text-main)'
}

const badgeStyle = (tone) => ({
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '999px',
  padding: '5px 10px',
  fontSize: '12px',
  fontWeight: 900,
  color: tone === 'red' ? 'var(--danger)' : tone === 'yellow' ? 'var(--warning)' : 'var(--success)',
  background: tone === 'red' ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : tone === 'yellow' ? 'color-mix(in srgb, var(--warning) 12%, transparent)' : 'color-mix(in srgb, var(--success) 12%, transparent)',
  border: `1px solid ${tone === 'red' ? 'var(--danger)' : tone === 'yellow' ? 'var(--warning)' : 'var(--success)'}`
})

const emptyStyle = {
  padding: '24px',
  border: '1px dashed var(--border-main)',
  borderRadius: '14px',
  color: 'var(--text-muted)',
  textAlign: 'center'
}
