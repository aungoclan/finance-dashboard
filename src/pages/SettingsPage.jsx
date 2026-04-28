import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  DEFAULT_APP_SETTINGS,
  loadUserSettings,
  normalizeSettings,
  saveUserSettings
} from '../lib/appSettings'

const ACCOUNT_TYPES = ['All', 'Cash', 'Checking', 'Savings', 'Brokerage', 'Crypto', 'Credit', 'Loan', 'Business', 'Other']
const CURRENCY_OPTIONS = ['USD', 'VND', 'EUR', 'CAD', 'AUD', 'JPY']

export default function SettingsPage() {
  const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS)
  const [savedSettings, setSavedSettings] = useState(DEFAULT_APP_SETTINGS)
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showJson, setShowJson] = useState(false)
  const [jsonDraft, setJsonDraft] = useState('')

  useEffect(() => {
    loadPage()
  }, [])

  async function loadPage() {
    setLoading(true)
    setError('')
    setMessage('')

    try {
      const [loadedSettings, accountResult] = await Promise.all([
        loadUserSettings(),
        supabase.from('accounts').select('id, name, account_type, currency').order('name', { ascending: true })
      ])

      if (accountResult.error) throw accountResult.error

      setSettings(loadedSettings)
      setSavedSettings(loadedSettings)
      setJsonDraft(JSON.stringify(loadedSettings, null, 2))
      setAccounts(accountResult.data || [])
    } catch (err) {
      setError(err.message || 'Unable to load settings.')
    } finally {
      setLoading(false)
    }
  }

  function updateSetting(key, value) {
    setSettings((current) => normalizeSettings({ ...current, [key]: value }))
    setMessage('')
    setError('')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const normalized = await saveUserSettings(settings)
      setSettings(normalized)
      setSavedSettings(normalized)
      setJsonDraft(JSON.stringify(normalized, null, 2))
      setMessage('Settings saved online to Supabase.')
    } catch (err) {
      setError(err.message || 'Unable to save settings.')
    } finally {
      setSaving(false)
    }
  }

  async function handleResetDefaults() {
    const ok = window.confirm('Reset settings to the default values? You can still review before saving.')
    if (!ok) return
    const next = normalizeSettings(DEFAULT_APP_SETTINGS)
    setSettings(next)
    setJsonDraft(JSON.stringify(next, null, 2))
    setMessage('Defaults loaded. Click Save Settings to store them online.')
    setError('')
  }

  function handleApplyJson() {
    try {
      const parsed = JSON.parse(jsonDraft)
      const next = normalizeSettings(parsed)
      setSettings(next)
      setJsonDraft(JSON.stringify(next, null, 2))
      setMessage('JSON applied. Click Save Settings to store it online.')
      setError('')
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`)
    }
  }

  const hasChanges = useMemo(() => {
    return JSON.stringify(normalizeSettings(settings)) !== JSON.stringify(normalizeSettings(savedSettings))
  }, [settings, savedSettings])

  const activeAccounts = useMemo(() => {
    return (accounts || []).filter((account) => !String(account.name || '').startsWith('[ARCHIVED]'))
  }, [accounts])

  const selectedDefaultAccount = activeAccounts.find((account) => account.id === settings.defaultAccountId)
  const selectedImportAccount = activeAccounts.find((account) => account.id === settings.defaultImportAccountId)

  if (loading) {
    return (
      <div style={pageStyle}>
        <section style={heroStyle}>
          <div>
            <div style={eyebrowStyle}>CONTROL PANEL</div>
            <h1 style={titleStyle}>Settings</h1>
            <p style={subtitleStyle}>Loading your online settings...</p>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>CONTROL PANEL · SUPABASE PRO</div>
          <h1 style={titleStyle}>Settings</h1>
          <p style={subtitleStyle}>
            Manage dashboard rules, warning thresholds, defaults, and app behavior from one online control center.
          </p>
        </div>

        <div style={heroActionsStyle}>
          <button type="button" onClick={loadPage} style={ghostButtonStyle}>
            Refresh
          </button>
          <button type="button" onClick={handleSave} disabled={saving} style={primaryButtonStyle}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </section>

      {message && <div style={successStyle}>{message}</div>}
      {error && <div style={errorStyle}>{error}</div>}
      {hasChanges && <div style={warningStyle}>You have unsaved changes. Click Save Settings when you are done.</div>}

      <section style={summaryGridStyle}>
        <SummaryCard title="Default Currency" value={settings.defaultCurrency} subtitle="Used as the main dashboard currency" />
        <SummaryCard
          title="Default Account"
          value={selectedDefaultAccount?.name || 'Not set'}
          subtitle="Preferred cashflow account"
        />
        <SummaryCard
          title="Bill Reminder"
          value={`${settings.billDueSoonDays} days`}
          subtitle="Action Center due soon window"
        />
        <SummaryCard
          title="Risk Threshold"
          value={`${settings.portfolioConcentrationThreshold}%`}
          subtitle="Single holding concentration alert"
        />
      </section>

      <section style={mainGridStyle}>
        <div style={leftColumnStyle}>
          <Panel title="General Defaults" subtitle="Set the values future pages can reuse instead of hard-coded rules.">
            <Field label="Default Currency">
              <select
                value={settings.defaultCurrency}
                onChange={(event) => updateSetting('defaultCurrency', event.target.value)}
                style={inputStyle}
              >
                {CURRENCY_OPTIONS.map((currency) => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </Field>

            <Field label="Default Cashflow Account">
              <select
                value={settings.defaultAccountId}
                onChange={(event) => updateSetting('defaultAccountId', event.target.value)}
                style={inputStyle}
              >
                <option value="">No default account</option>
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.account_type || 'unknown'} · {account.currency || 'USD'}
                  </option>
                ))}
              </select>
              <p style={fieldHintStyle}>Current: {selectedDefaultAccount?.name || 'Not set'}</p>
            </Field>

            <Field label="Default Import Account">
              <select
                value={settings.defaultImportAccountId}
                onChange={(event) => updateSetting('defaultImportAccountId', event.target.value)}
                style={inputStyle}
              >
                <option value="">No default import account</option>
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.account_type || 'unknown'} · {account.currency || 'USD'}
                  </option>
                ))}
              </select>
              <p style={fieldHintStyle}>Current: {selectedImportAccount?.name || 'Not set'}</p>
            </Field>

            <Field label="Show Archived Accounts">
              <Toggle
                checked={settings.showArchivedAccounts}
                onChange={(checked) => updateSetting('showArchivedAccounts', checked)}
                label={settings.showArchivedAccounts ? 'Show archived accounts in supported views' : 'Hide archived accounts by default'}
              />
            </Field>
          </Panel>

          <Panel title="Dashboard Behavior" subtitle="These settings are ready for Dashboard and Action Center upgrades.">
            <Field label="Dashboard Snapshot Auto Save">
              <Toggle
                checked={settings.dashboardSnapshotEnabled}
                onChange={(checked) => updateSetting('dashboardSnapshotEnabled', checked)}
                label={settings.dashboardSnapshotEnabled ? 'Enabled' : 'Disabled'}
              />
            </Field>

            <Field label="Compact Dashboard Mode">
              <Toggle
                checked={settings.compactDashboard}
                onChange={(checked) => updateSetting('compactDashboard', checked)}
                label={settings.compactDashboard ? 'Compact mode enabled' : 'Standard dashboard spacing'}
              />
            </Field>
<Field label="Default Money Plan Mode">
  <select
    value={settings.moneyPlanDefaultMode}
    onChange={(event) => updateSetting('moneyPlanDefaultMode', event.target.value)}
    style={inputStyle}
  >
    <option value="conservative">Conservative</option>
    <option value="balanced">Balanced</option>
    <option value="aggressive">Aggressive</option>
  </select>
  <p style={fieldHintStyle}>
    Used by Money Plan Pro when loading the page.
  </p>
</Field>
          </Panel>
        </div>

        <div style={rightColumnStyle}>
          <Panel title="Warning Thresholds" subtitle="Centralize rules so pages do not disagree with each other.">
            <NumberField
              label="Bills Due Soon Window"
              value={settings.billDueSoonDays}
              suffix="days"
              min={1}
              max={60}
              onChange={(value) => updateSetting('billDueSoonDays', value)}
            />

            <NumberField
              label="Budget Warning"
              value={settings.budgetWarningPercent}
              suffix="%"
              min={1}
              max={300}
              onChange={(value) => updateSetting('budgetWarningPercent', value)}
            />

            <NumberField
              label="Budget Danger"
              value={settings.budgetDangerPercent}
              suffix="%"
              min={1}
              max={500}
              onChange={(value) => updateSetting('budgetDangerPercent', value)}
            />

            <NumberField
              label="Single Holding Concentration"
              value={settings.portfolioConcentrationThreshold}
              suffix="%"
              min={1}
              max={100}
              onChange={(value) => updateSetting('portfolioConcentrationThreshold', value)}
            />

            <NumberField
              label="Crypto Allocation Warning"
              value={settings.cryptoAllocationWarningPercent}
              suffix="%"
              min={1}
              max={100}
              onChange={(value) => updateSetting('cryptoAllocationWarningPercent', value)}
            />

            <NumberField
              label="Stale Price Warning"
              value={settings.stalePriceDays}
              suffix="days"
              min={1}
              max={30}
              onChange={(value) => updateSetting('stalePriceDays', value)}
            />
          </Panel>

          <Panel title="Settings Tools" subtitle="Backup, inspect, or reset the online settings payload.">
            <div style={buttonRowStyle}>
              <button type="button" onClick={handleResetDefaults} style={dangerOutlineButtonStyle}>
                Load Defaults
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !showJson
                  setShowJson(next)
                  if (next) setJsonDraft(JSON.stringify(settings, null, 2))
                }}
                style={ghostButtonStyle}
              >
                {showJson ? 'Hide JSON' : 'Show JSON'}
              </button>
            </div>

            {showJson && (
              <div style={jsonBoxStyle}>
                <textarea
                  value={jsonDraft}
                  onChange={(event) => setJsonDraft(event.target.value)}
                  style={textareaStyle}
                  spellCheck="false"
                />
                <button type="button" onClick={handleApplyJson} style={smallPrimaryButtonStyle}>
                  Apply JSON
                </button>
              </div>
            )}
          </Panel>
        </div>
      </section>
    </div>
  )
}

function SummaryCard({ title, value, subtitle }) {
  return (
    <div style={cardStyle}>
      <div style={cardLabelStyle}>{title}</div>
      <div style={cardValueStyle}>{value}</div>
      <div style={cardSubStyle}>{subtitle}</div>
    </div>
  )
}

function Panel({ title, subtitle, children }) {
  return (
    <section style={panelStyle}>
      <h2 style={panelTitleStyle}>{title}</h2>
      {subtitle && <p style={panelSubtitleStyle}>{subtitle}</p>}
      <div style={panelContentStyle}>{children}</div>
    </section>
  )
}

function Field({ label, children }) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  )
}

function NumberField({ label, value, suffix, min, max, onChange }) {
  return (
    <Field label={label}>
      <div style={numberRowStyle}>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(event) => onChange(event.target.value)}
          style={numberInputStyle}
        />
        <span style={suffixStyle}>{suffix}</span>
      </div>
    </Field>
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        ...toggleButtonStyle,
        background: checked ? 'rgba(34, 197, 94, 0.16)' : 'rgba(15, 23, 42, 0.72)',
        borderColor: checked ? 'rgba(34, 197, 94, 0.46)' : '#334155'
      }}
    >
      <span
        style={{
          ...toggleDotStyle,
          transform: checked ? 'translateX(24px)' : 'translateX(0px)',
          background: checked ? '#22c55e' : '#94a3b8'
        }}
      />
      <span style={toggleLabelStyle}>{label}</span>
    </button>
  )
}

const pageStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  maxWidth: '1500px',
  margin: '0 auto',
  paddingBottom: '48px'
}

const heroStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '20px',
  padding: '28px',
  border: '1px solid #334155',
  borderRadius: '22px',
  background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.22), rgba(15, 23, 42, 0.92), rgba(20, 184, 166, 0.14))',
  boxShadow: '0 18px 45px rgba(2, 6, 23, 0.28)',
  flexWrap: 'wrap'
}

const eyebrowStyle = {
  color: '#93c5fd',
  letterSpacing: '0.18em',
  fontSize: '13px',
  fontWeight: 900,
  textTransform: 'uppercase',
  marginBottom: '8px'
}

const titleStyle = {
  margin: 0,
  fontSize: '36px',
  lineHeight: 1.05,
  fontWeight: 900
}

const subtitleStyle = {
  margin: '12px 0 0',
  maxWidth: '880px',
  color: '#bfdbfe',
  fontSize: '18px',
  lineHeight: 1.55
}

const heroActionsStyle = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap'
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: '16px'
}

const cardStyle = {
  padding: '22px',
  border: '1px solid #334155',
  borderRadius: '18px',
  background: '#111827'
}

const cardLabelStyle = {
  color: '#bfdbfe',
  fontSize: '15px',
  marginBottom: '12px'
}

const cardValueStyle = {
  fontSize: '28px',
  fontWeight: 900,
  color: '#f8fafc',
  wordBreak: 'break-word'
}

const cardSubStyle = {
  marginTop: '8px',
  color: '#94a3b8',
  fontSize: '14px'
}

const mainGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 0.92fr) minmax(360px, 1.08fr)',
  gap: '20px',
  alignItems: 'start'
}

const leftColumnStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
  minWidth: 0
}

const rightColumnStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
  minWidth: 0
}

const panelStyle = {
  padding: '24px',
  border: '1px solid #334155',
  borderRadius: '20px',
  background: '#111827'
}

const panelTitleStyle = {
  margin: 0,
  fontSize: '26px',
  fontWeight: 900
}

const panelSubtitleStyle = {
  margin: '8px 0 0',
  color: '#bfdbfe',
  lineHeight: 1.5,
  fontSize: '16px'
}

const panelContentStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  marginTop: '20px'
}

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
}

const labelStyle = {
  color: '#e5e7eb',
  fontWeight: 800,
  fontSize: '15px'
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '13px 14px',
  borderRadius: '12px',
  border: '1px solid #334155',
  background: '#020617',
  color: '#f8fafc',
  fontSize: '16px',
  outline: 'none'
}

const fieldHintStyle = {
  margin: 0,
  color: '#94a3b8',
  fontSize: '13px'
}

const numberRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px'
}

const numberInputStyle = {
  ...inputStyle,
  maxWidth: '180px'
}

const suffixStyle = {
  color: '#bfdbfe',
  fontWeight: 800
}

const toggleButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '14px',
  width: '100%',
  padding: '12px 14px',
  borderRadius: '14px',
  border: '1px solid #334155',
  color: '#f8fafc',
  cursor: 'pointer',
  textAlign: 'left'
}

const toggleDotStyle = {
  width: '24px',
  height: '24px',
  borderRadius: '999px',
  transition: 'transform 0.18s ease, background 0.18s ease',
  flexShrink: 0
}

const toggleLabelStyle = {
  fontWeight: 800,
  color: '#e5e7eb'
}

const buttonRowStyle = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap'
}

const primaryButtonStyle = {
  border: '1px solid #60a5fa',
  background: '#2563eb',
  color: 'white',
  borderRadius: '12px',
  padding: '12px 18px',
  fontWeight: 900,
  cursor: 'pointer',
  fontSize: '15px'
}

const smallPrimaryButtonStyle = {
  ...primaryButtonStyle,
  alignSelf: 'flex-start'
}

const ghostButtonStyle = {
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#bfdbfe',
  borderRadius: '12px',
  padding: '12px 18px',
  fontWeight: 900,
  cursor: 'pointer',
  fontSize: '15px'
}

const dangerOutlineButtonStyle = {
  border: '1px solid rgba(248, 113, 113, 0.55)',
  background: 'rgba(127, 29, 29, 0.12)',
  color: '#fecaca',
  borderRadius: '12px',
  padding: '12px 18px',
  fontWeight: 900,
  cursor: 'pointer',
  fontSize: '15px'
}

const successStyle = {
  padding: '14px 18px',
  border: '1px solid rgba(34, 197, 94, 0.5)',
  background: 'rgba(22, 101, 52, 0.2)',
  color: '#86efac',
  borderRadius: '14px',
  fontWeight: 800
}

const errorStyle = {
  padding: '14px 18px',
  border: '1px solid rgba(248, 113, 113, 0.5)',
  background: 'rgba(127, 29, 29, 0.2)',
  color: '#fecaca',
  borderRadius: '14px',
  fontWeight: 800
}

const warningStyle = {
  padding: '14px 18px',
  border: '1px solid rgba(251, 191, 36, 0.5)',
  background: 'rgba(120, 53, 15, 0.24)',
  color: '#fde68a',
  borderRadius: '14px',
  fontWeight: 800
}

const jsonBoxStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px'
}

const textareaStyle = {
  minHeight: '260px',
  resize: 'vertical',
  width: '100%',
  boxSizing: 'border-box',
  padding: '14px',
  borderRadius: '14px',
  border: '1px solid #334155',
  background: '#020617',
  color: '#dbeafe',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '13px',
  lineHeight: 1.5,
  outline: 'none'
}
