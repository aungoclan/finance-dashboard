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
        <p style={emptyStyle}>No data yet.</p>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>Net Worth Trend</h3>

      <div style={chartWrapStyle}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-main)" />
            <XAxis
              dataKey="label"
              stroke="var(--text-muted)"
              tick={{ fill: 'var(--text-muted)' }}
              tickFormatter={(value) => String(value || '').slice(5)}
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

const emptyStyle = {
  color: 'var(--text-muted)'
}
