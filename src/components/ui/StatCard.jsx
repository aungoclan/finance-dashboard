import Card from './Card'

export default function StatCard({ label, value, sub, tone = 'default', right, style = {} }) {
  const toneStyle = getToneStyle(tone)

  return (
    <Card className="fd-stat-card" style={style}>
      <div className="fd-stat-card-top-row">
        <div className="fd-stat-card-label">{label}</div>
        {right ? <div>{right}</div> : null}
      </div>

      <div className="fd-stat-card-value" style={{ color: toneStyle.color }}>
        {value || '-'}
      </div>

      {sub ? <div className="fd-stat-card-sub">{sub}</div> : null}
    </Card>
  )
}

function getToneStyle(tone) {
  if (tone === 'success') return { color: '#22c55e' }
  if (tone === 'danger') return { color: '#ef4444' }
  if (tone === 'warning') return { color: '#f59e0b' }
  if (tone === 'info') return { color: '#38bdf8' }

  return { color: '#f9fafb' }
}
