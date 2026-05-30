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
      ? 'var(--success)'
      : tone === 'red'
        ? 'var(--danger)'
        : tone === 'yellow'
          ? 'var(--warning)'
          : 'var(--accent)'

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
  background: 'var(--bg-card)',
  borderRadius: '20px',
  padding: '20px',
  border: '1px solid var(--border-main)',
  marginBottom: '22px',
  boxShadow: 'var(--shadow-card)',
  color: 'var(--text-main)'
}

const headerStyle = {
  marginBottom: '18px'
}

const titleStyle = {
  margin: 0,
  fontSize: '22px',
  fontWeight: 900,
  color: 'var(--text-main)'
}

const subtitleStyle = {
  marginTop: '6px',
  marginBottom: 0,
  color: 'var(--text-muted)',
  fontSize: '14px',
  lineHeight: 1.45
}

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px',
  marginBottom: '18px'
}

const cardStyle = {
  background: 'var(--bg-card-soft)',
  borderRadius: '16px',
  padding: '16px',
  border: '1px solid var(--border-main)',
  color: 'var(--text-main)'
}

const labelStyle = {
  color: 'var(--text-muted)',
  fontSize: '12px',
  fontWeight: 850,
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
}

const valueStyle = {
  marginTop: '8px',
  fontSize: '24px',
  fontWeight: 950
}

const detailStyle = {
  marginTop: '6px',
  color: 'var(--text-soft)',
  fontSize: '13px'
}

const allocationBoxStyle = {
  marginTop: '8px'
}

const sectionTitleStyle = {
  margin: '0 0 14px 0',
  fontSize: '16px',
  color: 'var(--text-main)',
  fontWeight: 900
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
  color: 'var(--text-main)',
  fontWeight: 900
}

const allocationValueStyle = {
  color: 'var(--text-soft)',
  fontSize: '13px',
  fontWeight: 700
}

const barTrackStyle = {
  height: '10px',
  background: 'var(--bg-card-soft)',
  borderRadius: '999px',
  overflow: 'hidden',
  border: '1px solid var(--border-main)'
}

const barFillStyle = {
  height: '100%',
  background: 'linear-gradient(90deg, var(--accent), var(--success))',
  borderRadius: '999px'
}

const warningStyle = {
  marginTop: '18px',
  padding: '14px',
  borderRadius: '14px',
  background: 'var(--warning-soft)',
  border: '1px solid color-mix(in srgb, var(--warning) 34%, transparent)',
  color: 'var(--warning)',
  fontSize: '14px',
  fontWeight: 800
}

const emptyStyle = {
  color: 'var(--text-muted)',
  fontSize: '14px'
}
