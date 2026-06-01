import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend
} from 'recharts'

export default function BudgetChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={cardStyle}>
        <h3 style={titleStyle}>Budget Usage</h3>
        <p style={emptyStyle}>No budget data yet.</p>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>Budget Usage</h3>

      <div style={chartWrapStyle}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-main)" />
            <XAxis
              dataKey="category"
              stroke="var(--text-muted)"
              tick={{ fill: 'var(--text-muted)' }}
              interval={0}
            />
            <YAxis stroke="var(--text-muted)" tick={{ fill: 'var(--text-muted)' }} />
            <Tooltip
              cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              formatter={(value, name) => [`$${formatChartMoney(value)}`, name]}
            />
            <Legend wrapperStyle={legendStyle} />
            <Bar dataKey="planned" fill="var(--accent-strong)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="actual" fill="var(--warning)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function formatChartMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

const cardStyle = {
  background: 'var(--bg-card)',
  color: 'var(--text-main)',
  padding: '20px',
  borderRadius: '12px',
  border: '1px solid var(--border-main)',
  minHeight: '340px',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0
}

const titleStyle = {
  marginTop: 0,
  marginBottom: '16px'
}

const chartWrapStyle = {
  height: 'clamp(220px, 56vw, 280px)',
  minHeight: '220px',
  width: '100%',
  minWidth: 0
}

const tooltipStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-main)',
  borderRadius: '10px',
  color: 'var(--text-main)',
  boxShadow: 'var(--shadow-soft)'
}

const tooltipLabelStyle = {
  color: 'var(--text-main)',
  fontWeight: 700
}

const legendStyle = {
  color: 'var(--text-muted)'
}

const emptyStyle = {
  color: 'var(--text-muted)'
}
