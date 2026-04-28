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
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="category"
              stroke="#d1d5db"
              tick={{ fill: '#d1d5db' }}
              interval={0}
            />
            <YAxis stroke="#d1d5db" tick={{ fill: '#d1d5db' }} />
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
  background: '#1f2937',
  padding: '20px',
  borderRadius: '12px',
  minHeight: '380px',
  display: 'flex',
  flexDirection: 'column'
}

const titleStyle = {
  marginTop: 0,
  marginBottom: '16px'
}

const chartWrapStyle = {
  height: '280px',
  width: '100%'
}

const tooltipStyle = {
  background: '#111827',
  border: '1px solid #374151',
  borderRadius: '10px',
  color: '#f9fafb',
  boxShadow: '0 12px 28px rgba(0, 0, 0, 0.28)'
}

const tooltipLabelStyle = {
  color: '#f9fafb',
  fontWeight: 700
}

const legendStyle = {
  color: '#d1d5db'
}

const emptyStyle = {
  color: '#d1d5db'
}