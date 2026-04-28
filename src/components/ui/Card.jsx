export default function Card({ children, style = {}, className = '', variant = 'default', flat = false }) {
  const variantClass = variant === 'soft' ? 'fd-card-soft' : ''
  const flatClass = flat ? 'fd-card-flat' : ''
  const classes = ['fd-card', variantClass, flatClass, className].filter(Boolean).join(' ')

  return (
    <div className={classes} style={{ padding: 18, ...style }}>
      {children}
    </div>
  )
}
