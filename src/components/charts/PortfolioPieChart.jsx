
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
        <p style={emptyStyle}>No holdings yet.</p>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>Portfolio Allocation</h3>

      <div style={chartWrapStyle}>
       <ResponsiveContainer width="100%" height={280}>
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
            <Tooltip formatter={(value) => `$${Number(value || 0).toFixed(2)}`} />
            <Legend />
          </PieChart>
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