
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#84cc16', '#f97316']

export default function PortfolioPieChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={cardStyle}>
        <h3 style={titleStyle}>Portfolio Allocation</h3>
        <p style={emptyStyle}>No portfolio data yet</p>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>Portfolio Allocation</h3>

      <div style={chartWrapStyle}>
       <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              outerRadius={95}
              innerRadius={42}
              paddingAngle={2}
            >
              {data.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              formatter={(value) => `$${Number(value || 0).toFixed(2)}`}
            />
            <Legend wrapperStyle={legendStyle} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
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
