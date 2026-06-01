import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts'

export default function NetWorthChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={cardStyle}>
        <h3 style={titleStyle}>Net Worth Trend</h3>
        <p style={emptyStyle}>No net worth history yet</p>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>Net Worth Trend</h3>

      <div style={chartWrapStyle}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-main)" />
            <XAxis
  dataKey="label"
  stroke="var(--text-muted)"
  tick={{ fill: 'var(--text-muted)' }}
  tickFormatter={(value) => value.slice(5)} // chỉ hiện MM-DD
/>
            <YAxis stroke="var(--text-muted)" tick={{ fill: 'var(--text-muted)' }} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
            <Line type="monotone" dataKey="netWorth" stroke="var(--success)" strokeWidth={3} />
          </LineChart>
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

const emptyStyle = {
  color: 'var(--text-muted)'
}
