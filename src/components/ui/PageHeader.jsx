export default function PageHeader({ title, subtitle, right }) {
  return (
    <div className="fd-page-header">
      <div className="fd-page-header-main">
        <h1 className="fd-page-title">{title}</h1>
        {subtitle ? <p className="fd-page-subtitle">{subtitle}</p> : null}
      </div>

      {right ? <div className="fd-page-header-right">{right}</div> : null}
    </div>
  )
}
