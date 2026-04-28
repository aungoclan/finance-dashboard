import { useMemo } from 'react'

export default function PortfolioIntelligencePanel({ holdings = [] }) {
  const insights = useMemo(() => {
    const totalValue = holdings.reduce(
      (sum, item) => sum + Number(item.market_value || 0),
      0
    )

    const allocationMap = {}

    for (const item of holdings) {
      const type = item.asset_type || 'unknown'
      const value = Number(item.market_value || 0)

      if (!allocationMap[type]) {
        allocationMap[type] = 0
      }

      allocationMap[type] += value
    }

    const allocations = Object.entries(allocationMap)
      .map(([type, value]) => ({
        type,
        value,
        percent: totalValue > 0 ? (value / totalValue) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value)

    const sortedByPercent = [...holdings].sort(
      (a, b) =>
        Number(b.unrealized_pl_percent || 0) -
        Number(a.unrealized_pl_percent || 0)
    )

    const topWinner = sortedByPercent[0] || null
    const topLoser = sortedByPercent[sortedByPercent.length - 1] || null

    const concentration = holdings
      .map((item) => ({
        ...item,
        allocationPercent:
          totalValue > 0
            ? (Number(item.market_value || 0) / totalValue) * 100
            : 0
      }))
      .sort((a, b) => b.allocationPercent - a.allocationPercent)[0]

    const missingPrices = holdings.filter(
      (item) => Number(item.market_price || 0) <= 0
    )

    const highRisk =
      concentration && Number(concentration.allocationPercent || 0) >= 50

    return {
      totalValue,
      allocations,
      topWinner,
      topLoser,
      concentration,
      missingPrices,
      highRisk
    }
  }, [holdings])

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <h2 style={titleStyle}>Portfolio Intelligence</h2>
          <p style={subtitleStyle}>
            Smart insights based on allocation, winners, losers, and risk.
          </p>
        </div>
      </div>

      <div style={gridStyle}>
        <InsightCard
          title="Top Winner"
          value={insights.topWinner?.symbol || 'N/A'}
          detail={
            insights.topWinner
              ? `${formatPercent(insights.topWinner.unrealized_pl_percent)} · $${formatMoney(insights.topWinner.unrealized_pl)}`
              : 'No data yet'
          }
          tone="green"
        />

        <InsightCard
          title="Top Loser"
          value={insights.topLoser?.symbol || 'N/A'}
          detail={
            insights.topLoser
              ? `${formatPercent(insights.topLoser.unrealized_pl_percent)} · $${formatMoney(insights.topLoser.unrealized_pl)}`
              : 'No data yet'
          }
          tone="red"
        />

        <InsightCard
          title="Concentration Risk"
          value={insights.concentration?.symbol || 'N/A'}
          detail={
            insights.concentration
              ? `${formatPercent(insights.concentration.allocationPercent)} of portfolio`
              : 'No data yet'
          }
          tone={insights.highRisk ? 'red' : 'green'}
        />

        <InsightCard
          title="Missing Prices"
          value={String(insights.missingPrices.length)}
          detail={
            insights.missingPrices.length > 0
              ? insights.missingPrices.map((item) => item.symbol).join(', ')
              : 'All holdings have prices'
          }
          tone={insights.missingPrices.length > 0 ? 'yellow' : 'green'}
        />
      </div>

      <div style={allocationBoxStyle}>
        <h3 style={sectionTitleStyle}>Allocation by Asset Type</h3>

        {insights.allocations.length === 0 ? (
          <div style={emptyStyle}>No allocation data yet.</div>
        ) : (
          <div style={allocationListStyle}>
            {insights.allocations.map((item) => (
              <div key={item.type} style={allocationRowStyle}>
                <div style={allocationTopStyle}>
                  <span style={assetTypeStyle}>{item.type.toUpperCase()}</span>
                  <span style={allocationValueStyle}>
                    ${formatMoney(item.value)} · {formatPercent(item.percent)}
                  </span>
                </div>

                <div style={barTrackStyle}>
                  <div
                    style={{
                      ...barFillStyle,
                      width: `${Math.min(item.percent, 100)}%`
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {insights.highRisk && (
        <div style={warningStyle}>
          ⚠️ {insights.concentration.symbol} is taking more than 50% of your portfolio.
          Consider diversifying to reduce risk.
        </div>
      )}
    </div>
  )
}

function InsightCard({ title, value, detail, tone }) {
  const color =
    tone === 'green'
      ? '#22c55e'
      : tone === 'red'
        ? '#ef4444'
        : tone === 'yellow'
          ? '#f59e0b'
          : '#60a5fa'

  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{title}</div>
      <div style={{ ...valueStyle, color }}>{value}</div>
      <div style={detailStyle}>{detail}</div>
    </div>
  )
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`
}

const panelStyle = {
  background: '#111827',
  borderRadius: '20px',
  padding: '20px',
  border: '1px solid rgba(255,255,255,0.08)',
  marginBottom: '22px'
}

const headerStyle = {
  marginBottom: '18px'
}

const titleStyle = {
  margin: 0,
  fontSize: '22px',
  fontWeight: 800,
  color: '#f9fafb'
}

const subtitleStyle = {
  marginTop: '6px',
  marginBottom: 0,
  color: '#94a3b8',
  fontSize: '14px'
}

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px',
  marginBottom: '18px'
}

const cardStyle = {
  background: '#0f172a',
  borderRadius: '16px',
  padding: '16px',
  border: '1px solid rgba(255,255,255,0.08)'
}

const labelStyle = {
  color: '#94a3b8',
  fontSize: '12px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
}

const valueStyle = {
  marginTop: '8px',
  fontSize: '24px',
  fontWeight: 900
}

const detailStyle = {
  marginTop: '6px',
  color: '#cbd5e1',
  fontSize: '13px'
}

const allocationBoxStyle = {
  marginTop: '8px'
}

const sectionTitleStyle = {
  margin: '0 0 14px 0',
  fontSize: '16px',
  color: '#f9fafb'
}

const allocationListStyle = {
  display: 'grid',
  gap: '12px'
}

const allocationRowStyle = {
  display: 'grid',
  gap: '8px'
}

const allocationTopStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px'
}

const assetTypeStyle = {
  color: '#f9fafb',
  fontWeight: 800
}

const allocationValueStyle = {
  color: '#cbd5e1',
  fontSize: '13px'
}

const barTrackStyle = {
  height: '10px',
  background: '#1f2937',
  borderRadius: '999px',
  overflow: 'hidden'
}

const barFillStyle = {
  height: '100%',
  background: 'linear-gradient(90deg, #2563eb, #22c55e)',
  borderRadius: '999px'
}

const warningStyle = {
  marginTop: '18px',
  padding: '14px',
  borderRadius: '14px',
  background: 'rgba(245,158,11,0.12)',
  border: '1px solid rgba(245,158,11,0.3)',
  color: '#fde68a',
  fontSize: '14px'
}

const emptyStyle = {
  color: '#94a3b8',
  fontSize: '14px'
}