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
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
  dataKey="label"
  stroke="#d1d5db"
  tickFormatter={(value) => value.slice(5)} // chỉ hiện MM-DD
/>
            <YAxis stroke="#d1d5db" />
            <Tooltip />
            <Line type="monotone" dataKey="netWorth" stroke="#22c55e" strokeWidth={3} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
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
const emptyStyle = {
  color: '#d1d5db'
}