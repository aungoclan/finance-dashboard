import { Component } from 'react'

function getErrorMessage(error) {
  if (!error) return 'Unknown error'
  if (typeof error === 'string') return error
  return error.message || String(error)
}

function getStackPreview(errorInfo) {
  const stack = errorInfo?.componentStack || ''

  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n')
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)

    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error
    }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })

    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  componentDidUpdate(previousProps) {
    const previousResetKey = previousProps.resetKey
    const currentResetKey = this.props.resetKey

    if (this.state.hasError && previousResetKey !== currentResetKey) {
      this.reset()
    }
  }

  reset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })
  }

  reloadPage = () => {
    window.location.reload()
  }

  goHome = () => {
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const title = this.props.title || 'This section could not load'
    const description =
      this.props.description ||
      'A page component crashed, but the rest of the app is still protected. Try reloading first. If it happens again, take a screenshot of this message and the browser console.'

    const errorMessage = getErrorMessage(this.state.error)
    const stackPreview = getStackPreview(this.state.errorInfo)
    const showDetails = import.meta.env.DEV || this.props.showDetails

    return (
      <div style={styles.shell}>
        <div style={styles.card}>
          <div style={styles.kicker}>Safety Layer</div>
          <h1 style={styles.title}>{title}</h1>
          <p style={styles.description}>{description}</p>

          <div style={styles.alertBox}>
            <div style={styles.alertTitle}>Error message</div>
            <div style={styles.errorText}>{errorMessage}</div>
          </div>

          {showDetails && stackPreview ? (
            <details style={styles.details}>
              <summary style={styles.summary}>Component stack</summary>
              <pre style={styles.pre}>{stackPreview}</pre>
            </details>
          ) : null}

          <div style={styles.actions}>
            <button type="button" onClick={this.reset} style={styles.primaryButton}>
              Try Again
            </button>
            <button type="button" onClick={this.reloadPage} style={styles.secondaryButton}>
              Reload Page
            </button>
            <button type="button" onClick={this.goHome} style={styles.ghostButton}>
              Back to Dashboard
            </button>
          </div>

          <div style={styles.note}>
            This does not fix the bug automatically, but it prevents a small component error from turning the whole app into a blank white screen.
          </div>
        </div>
      </div>
    )
  }
}

const styles = {
  shell: {
    minHeight: '60vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    color: '#f8fafc'
  },
  card: {
    width: '100%',
    maxWidth: '760px',
    background: '#111827',
    border: '1px solid rgba(148, 163, 184, 0.28)',
    borderRadius: '22px',
    boxShadow: '0 24px 70px rgba(0, 0, 0, 0.35)',
    padding: '28px'
  },
  kicker: {
    display: 'inline-flex',
    padding: '6px 10px',
    borderRadius: '999px',
    background: 'rgba(56, 189, 248, 0.12)',
    color: '#7dd3fc',
    fontSize: '12px',
    fontWeight: 900,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: '14px'
  },
  title: {
    margin: '0 0 10px',
    fontSize: '30px',
    lineHeight: 1.1,
    letterSpacing: '-0.04em'
  },
  description: {
    margin: '0 0 18px',
    color: '#cbd5e1',
    lineHeight: 1.65
  },
  alertBox: {
    padding: '14px',
    borderRadius: '16px',
    background: 'rgba(239, 68, 68, 0.10)',
    border: '1px solid rgba(248, 113, 113, 0.25)',
    marginBottom: '14px'
  },
  alertTitle: {
    color: '#fecaca',
    fontWeight: 850,
    marginBottom: '6px'
  },
  errorText: {
    color: '#fca5a5',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '13px',
    lineHeight: 1.5,
    wordBreak: 'break-word'
  },
  details: {
    marginTop: '12px',
    marginBottom: '16px',
    borderRadius: '14px',
    background: '#0f172a',
    border: '1px solid rgba(148, 163, 184, 0.22)',
    padding: '12px'
  },
  summary: {
    cursor: 'pointer',
    color: '#e2e8f0',
    fontWeight: 800
  },
  pre: {
    margin: '12px 0 0',
    whiteSpace: 'pre-wrap',
    color: '#cbd5e1',
    fontSize: '12px',
    lineHeight: 1.45
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    marginTop: '18px'
  },
  primaryButton: {
    border: 'none',
    borderRadius: '12px',
    padding: '11px 14px',
    background: '#2563eb',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 850
  },
  secondaryButton: {
    border: 'none',
    borderRadius: '12px',
    padding: '11px 14px',
    background: '#374151',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 850
  },
  ghostButton: {
    border: '1px solid rgba(148, 163, 184, 0.35)',
    borderRadius: '12px',
    padding: '11px 14px',
    background: 'transparent',
    color: '#e5e7eb',
    cursor: 'pointer',
    fontWeight: 850
  },
  note: {
    marginTop: '16px',
    color: '#94a3b8',
    fontSize: '12px',
    lineHeight: 1.5
  }
}
