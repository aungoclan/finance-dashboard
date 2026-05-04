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
        <ResponsiveContainer width="100%" height={280}>
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
            <Bar dataKey="planned" fill="#3b82f6" radius={[6, 6, 0, 0]} />
            <Bar dataKey="actual" fill="#f59e0b" radius={[6, 6, 0, 0]} />
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
  padding: '20px',
  borderRadius: '16px',
  minHeight: '380px',
  display: 'flex',
  flexDirection: 'column',
  color: 'var(--text-main)'
}

const titleStyle = {
  marginTop: 0,
  marginBottom: '16px',
  color: 'var(--text-main)',
  fontWeight: 900
}

const chartWrapStyle = {
  height: '280px',
  width: '100%'
}

const tooltipStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-main)',
  borderRadius: '10px',
  color: 'var(--text-main)',
  boxShadow: 'var(--shadow-card)'
}

const tooltipLabelStyle = {
  color: 'var(--text-main)',
  fontWeight: 800
}

const legendStyle = {
  color: 'var(--text-muted)'
}

const emptyStyle = {
  color: 'var(--text-muted)'
}
