import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/holdings'

const ARCHIVE_PREFIX = '[ARCHIVED] '
const RECONCILE_TOLERANCE = 0.01
const ADJUSTMENT_CATEGORY = 'Cash Adjustment'

function money(value) {
  return `$${formatMoney(Number(value || 0))}`
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function getCurrentMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
}

function parseMonthKey(monthKey) {
  const [yearText, monthText] = String(monthKey || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    const now = new Date()
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1
    }
  }

  return { year, month }
}

function getMonthRange(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const next = new Date(year, month, 1)

  return {
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-01`
  }
}

function getMonthEndDate(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const lastDay = new Date(year, month, 0)
  return `${lastDay.getFullYear()}-${pad2(lastDay.getMonth() + 1)}-${pad2(lastDay.getDate())}`
}

function shiftMonthKey(monthKey, offset) {
  const { year, month } = parseMonthKey(monthKey)
  const shifted = new Date(year, month - 1 + offset, 1)
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}`
}

function getMonthLabel(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const date = new Date(year, month - 1, 1)

  return date.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  })
}

function isArchivedName(name) {
  return String(name || '').startsWith(ARCHIVE_PREFIX)
}

function displayName(name) {
  const value = String(name || '').trim()
  return isArchivedName(value)
    ? value.slice(ARCHIVE_PREFIX.length).trim() || 'Archived Account'
    : value || 'Unnamed Account'
}

function getEntryAmount(entry) {
  return Math.abs(toNumber(entry?.amount))
}

function isCashAdjustmentEntry(entry, monthKey) {
  const category = normalize(entry?.category)
  const description = normalize(entry?.description)

  return (
    category === normalize(ADJUSTMENT_CATEGORY) ||
    description.startsWith(`cash adjustment: ${normalize(monthKey)}`)
  )
}

function calculateMovement(entries, accountId, monthKey) {
  const { startDate, endDate } = getMonthRange(monthKey)
  const monthEntries = entries.filter(
    (entry) =>
      entry.account_id === accountId &&
      entry.entry_date >= startDate &&
      entry.entry_date < endDate
  )

  return monthEntries.reduce(
    (acc, entry) => {
      const amount = getEntryAmount(entry)
      const type = normalize(entry.type)

      if (type === 'income') {
        acc.cashIn += amount
      } else if (type === 'expense') {
        acc.cashOut += amount
      }

      acc.entryCount += 1
      return acc
    },
    {
      cashIn: 0,
      cashOut: 0,
      entryCount: 0
    }
  )
}

function calculateAllTimeBefore(entries, accountId, monthKey) {
  const { startDate } = getMonthRange(monthKey)

  return entries.reduce((sum, entry) => {
    if (entry.account_id !== accountId || entry.entry_date >= startDate) return sum

    const amount = getEntryAmount(entry)
    const type = normalize(entry.type)

    if (type === 'income') return sum + amount
    if (type === 'expense') return sum - amount
    return sum
  }, 0)
}

function calculateAllTimeNet(entries, accountId) {
  return entries.reduce((sum, entry) => {
    if (entry.account_id !== accountId) return sum

    const amount = getEntryAmount(entry)
    const type = normalize(entry.type)

    if (type === 'income') return sum + amount
    if (type === 'expense') return sum - amount
    return sum
  }, 0)
}

function getStatusLabel(status) {
  if (status === 'reconciled') return 'Reconciled'
  if (status === 'needs_review') return 'Needs Review'
  return 'Open'
}

function getStatusTone(status) {
  if (status === 'reconciled') return 'good'
  if (status === 'needs_review') return 'bad'
  return 'neutral'
}

function sortLedgerDesc(a, b) {
  return String(b.month_key || '').localeCompare(String(a.month_key || ''))
}

export default function CashWalletLedgerPage() {
  const [accounts, setAccounts] = useState([])
  const [cashflowEntries, setCashflowEntries] = useState([])
  const [ledgerRows, setLedgerRows] = useState([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [monthKey, setMonthKey] = useState(getCurrentMonthKey())
  const [actualCashCount, setActualCashCount] = useState('')
  const [openingBalance, setOpeningBalance] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadLedgerData()
  }, [])

  async function loadLedgerData() {
    setLoading(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .select('id, user_id, name, account_type, currency, created_at')
        .eq('user_id', user.id)
        .eq('account_type', 'cash')
        .order('created_at', { ascending: false })

      if (accountError) throw accountError

      const { data: entryData, error: entryError } = await supabase
        .from('cashflow_entries')
        .select('id, user_id, account_id, entry_date, type, amount, category, description, created_at')
        .eq('user_id', user.id)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (entryError) throw entryError

      const { data: ledgerData, error: ledgerError } = await supabase
        .from('cash_wallet_monthly_ledger')
        .select('*')
        .eq('user_id', user.id)
        .order('month_key', { ascending: false })
        .order('updated_at', { ascending: false })

      if (ledgerError) {
        if (ledgerError.code === '42P01') {
          throw new Error('Missing table cash_wallet_monthly_ledger. Run the Bài 48A SQL first, then refresh this page.')
        }
        throw ledgerError
      }

      const cleanAccounts = (accountData || []).filter((account) => !isArchivedName(account.name))
      const nextSelectedId = selectedAccountId || cleanAccounts[0]?.id || accountData?.[0]?.id || ''

      setAccounts(accountData || [])
      setCashflowEntries(entryData || [])
      setLedgerRows(ledgerData || [])
      setSelectedAccountId(nextSelectedId)

      syncFormFromLedger({
        accountId: nextSelectedId,
        month: monthKey,
        entries: entryData || [],
        ledgers: ledgerData || []
      })
    } catch (error) {
      console.error('loadLedgerData error:', error)
      setMessage(error.message || 'Failed to load Cash Wallet Ledger')
    } finally {
      setLoading(false)
    }
  }

  function syncFormFromLedger({ accountId, month, entries = cashflowEntries, ledgers = ledgerRows }) {
    if (!accountId) {
      setOpeningBalance('')
      setActualCashCount('')
      setNote('')
      return
    }

    const existing = ledgers.find(
      (row) => row.cash_account_id === accountId && row.month_key === month
    )

    if (existing) {
      setOpeningBalance(String(toNumber(existing.opening_balance)))
      setActualCashCount(
        existing.actual_cash_count === null || existing.actual_cash_count === undefined
          ? ''
          : String(toNumber(existing.actual_cash_count))
      )
      setNote(existing.note || '')
      return
    }

    const previousMonth = shiftMonthKey(month, -1)
    const previousLedger = ledgers.find(
      (row) => row.cash_account_id === accountId && row.month_key === previousMonth
    )

    const suggestedOpening =
      previousLedger && previousLedger.actual_cash_count !== null && previousLedger.actual_cash_count !== undefined
        ? toNumber(previousLedger.actual_cash_count)
        : calculateAllTimeBefore(entries, accountId, month)

    setOpeningBalance(String(Number(suggestedOpening.toFixed(2))))
    setActualCashCount('')
    setNote('')
  }

  function handleAccountChange(e) {
    const nextAccountId = e.target.value
    setSelectedAccountId(nextAccountId)
    syncFormFromLedger({ accountId: nextAccountId, month: monthKey })
  }

  function handleMonthChange(e) {
    const nextMonth = e.target.value || getCurrentMonthKey()
    setMonthKey(nextMonth)
    syncFormFromLedger({ accountId: selectedAccountId, month: nextMonth })
  }

  const cashAccounts = useMemo(
    () => accounts.filter((account) => account.account_type === 'cash'),
    [accounts]
  )

  const selectedAccount = useMemo(
    () => cashAccounts.find((account) => account.id === selectedAccountId) || null,
    [cashAccounts, selectedAccountId]
  )

  const currentLedger = useMemo(
    () =>
      ledgerRows.find(
        (row) => row.cash_account_id === selectedAccountId && row.month_key === monthKey
      ) || null,
    [ledgerRows, selectedAccountId, monthKey]
  )

  const currentMovement = useMemo(
    () => calculateMovement(cashflowEntries, selectedAccountId, monthKey),
    [cashflowEntries, selectedAccountId, monthKey]
  )

  const calculated = useMemo(() => {
    const opening = toNumber(openingBalance)
    const cashIn = currentMovement.cashIn
    const cashOut = currentMovement.cashOut
    const expectedClosing = opening + cashIn - cashOut
    const actual = actualCashCount === '' ? null : toNumber(actualCashCount)
    const difference = actual === null ? null : actual - expectedClosing
    const absDifference = Math.abs(toNumber(difference))

    let status = 'open'
    if (actual !== null && absDifference <= RECONCILE_TOLERANCE) {
      status = 'reconciled'
    } else if (actual !== null && absDifference > RECONCILE_TOLERANCE) {
      status = 'needs_review'
    }

    return {
      opening,
      cashIn,
      cashOut,
      expectedClosing,
      actual,
      difference,
      status
    }
  }, [openingBalance, actualCashCount, currentMovement])

  const selectedAllTimeNet = useMemo(
    () => calculateAllTimeNet(cashflowEntries, selectedAccountId),
    [cashflowEntries, selectedAccountId]
  )

  const previousLedger = useMemo(() => {
    const previousMonth = shiftMonthKey(monthKey, -1)
    return (
      ledgerRows.find(
        (row) => row.cash_account_id === selectedAccountId && row.month_key === previousMonth
      ) || null
    )
  }, [ledgerRows, selectedAccountId, monthKey])

  const ledgerHistory = useMemo(() => {
    if (!selectedAccountId) return []

    return ledgerRows
      .filter((row) => row.cash_account_id === selectedAccountId)
      .sort(sortLedgerDesc)
      .slice(0, 12)
  }, [ledgerRows, selectedAccountId])

  const movementChanged = useMemo(() => {
    if (!currentLedger) return false
    const savedIn = toNumber(currentLedger.cash_in)
    const savedOut = toNumber(currentLedger.cash_out)
    return (
      Math.abs(savedIn - currentMovement.cashIn) > RECONCILE_TOLERANCE ||
      Math.abs(savedOut - currentMovement.cashOut) > RECONCILE_TOLERANCE
    )
  }, [currentLedger, currentMovement])

  const adjustmentEntriesThisMonth = useMemo(() => {
    if (!selectedAccountId) return []
    const { startDate, endDate } = getMonthRange(monthKey)

    return cashflowEntries.filter(
      (entry) =>
        entry.account_id === selectedAccountId &&
        entry.entry_date >= startDate &&
        entry.entry_date < endDate &&
        isCashAdjustmentEntry(entry, monthKey)
    )
  }, [cashflowEntries, selectedAccountId, monthKey])

  const existingAdjustmentForMonth = adjustmentEntriesThisMonth[0] || null

  const adjustmentSuggestion = useMemo(() => {
    if (calculated.difference === null || calculated.difference === undefined) {
      return null
    }

    const diff = toNumber(calculated.difference)
    const absDifference = Math.abs(diff)

    if (absDifference <= RECONCILE_TOLERANCE) {
      return {
        needed: false,
        type: null,
        amount: 0,
        entryDate: getMonthEndDate(monthKey),
        label: 'No adjustment needed',
        description: 'Actual cash matches expected closing.'
      }
    }

    const type = diff > 0 ? 'income' : 'expense'

    return {
      needed: true,
      type,
      amount: Number(absDifference.toFixed(2)),
      entryDate: getMonthEndDate(monthKey),
      label: type === 'income' ? 'Cash overage adjustment' : 'Cash shortage adjustment',
      description:
        type === 'income'
          ? 'Actual cash is higher than expected, so this creates a cash income adjustment.'
          : 'Actual cash is lower than expected, so this creates a cash expense adjustment.'
    }
  }, [calculated.difference, monthKey])

  async function saveLedger({ lock = false } = {}) {
    if (!selectedAccountId) {
      setMessage('Please select a Cash Wallet account first.')
      return
    }

    if (!monthKey) {
      setMessage('Please select a month first.')
      return
    }

    if (currentLedger?.locked && !lock) {
      setMessage('This month is locked. Unlock it before editing the ledger.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const payload = {
        user_id: user.id,
        cash_account_id: selectedAccountId,
        month_key: monthKey,
        opening_balance: Number(calculated.opening.toFixed(2)),
        cash_in: Number(calculated.cashIn.toFixed(2)),
        cash_out: Number(calculated.cashOut.toFixed(2)),
        expected_closing_balance: Number(calculated.expectedClosing.toFixed(2)),
        actual_cash_count:
          calculated.actual === null ? null : Number(calculated.actual.toFixed(2)),
        difference:
          calculated.difference === null ? null : Number(calculated.difference.toFixed(2)),
        status: calculated.status,
        note: note.trim() || null,
        locked: lock ? true : Boolean(currentLedger?.locked),
        reconciled_at: lock && calculated.status === 'reconciled' ? new Date().toISOString() : currentLedger?.reconciled_at || null
      }

      const { error } = await supabase
        .from('cash_wallet_monthly_ledger')
        .upsert(payload, {
          onConflict: 'user_id,cash_account_id,month_key'
        })

      if (error) throw error

      setMessage(lock ? 'Cash Wallet month reconciled and locked.' : 'Cash Wallet ledger saved.')
      await loadLedgerData()
    } catch (error) {
      console.error('saveLedger error:', error)
      setMessage(error.message || 'Failed to save Cash Wallet ledger')
    } finally {
      setSaving(false)
    }
  }

  async function unlockLedger() {
    if (!currentLedger) return

    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const { error } = await supabase
        .from('cash_wallet_monthly_ledger')
        .update({ locked: false })
        .eq('id', currentLedger.id)
        .eq('user_id', user.id)

      if (error) throw error

      setMessage('Ledger unlocked. You can edit and save again.')
      await loadLedgerData()
    } catch (error) {
      console.error('unlockLedger error:', error)
      setMessage(error.message || 'Failed to unlock ledger')
    } finally {
      setSaving(false)
    }
  }

  async function deleteLedger() {
    if (!currentLedger) return

    const confirmed = window.confirm(
      `Delete Cash Wallet ledger for ${getMonthLabel(monthKey)}? This only deletes the monthly snapshot, not cashflow entries.`
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const { error } = await supabase
        .from('cash_wallet_monthly_ledger')
        .delete()
        .eq('id', currentLedger.id)
        .eq('user_id', user.id)

      if (error) throw error

      setMessage('Ledger snapshot deleted.')
      await loadLedgerData()
    } catch (error) {
      console.error('deleteLedger error:', error)
      setMessage(error.message || 'Failed to delete ledger')
    } finally {
      setSaving(false)
    }
  }

  async function createCashAdjustment() {
    if (!selectedAccountId) {
      setMessage('Please select a Cash Wallet account first.')
      return
    }

    if (currentLedger?.locked) {
      setMessage('This month is locked. Unlock it before creating a cash adjustment.')
      return
    }

    if (!adjustmentSuggestion || !adjustmentSuggestion.needed) {
      setMessage('No cash adjustment is needed for this month.')
      return
    }

    if (existingAdjustmentForMonth) {
      setMessage('A Cash Adjustment entry already exists for this month. Review or edit that entry in Cashflow instead of creating a duplicate.')
      return
    }

    const confirmed = window.confirm(
      `Create a ${adjustmentSuggestion.type} adjustment for ${money(adjustmentSuggestion.amount)} on ${adjustmentSuggestion.entryDate}? This will add one Cashflow entry and update Cash Wallet movement.`
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const description =
        adjustmentSuggestion.type === 'income'
          ? `Cash Adjustment: ${monthKey} · actual cash higher than expected`
          : `Cash Adjustment: ${monthKey} · actual cash lower than expected`

      const payload = {
        user_id: user.id,
        account_id: selectedAccountId,
        entry_date: adjustmentSuggestion.entryDate,
        type: adjustmentSuggestion.type,
        amount: adjustmentSuggestion.amount,
        category_id: null,
        category: ADJUSTMENT_CATEGORY,
        description
      }

      const { data, error } = await supabase
        .from('cashflow_entries')
        .insert(payload)
        .select('id, user_id, account_id, entry_date, type, amount, category, description, created_at')
        .single()

      if (error) throw error

      if (data) {
        setCashflowEntries((prev) => [data, ...prev])
      }

      setMessage(
        `Cash adjustment created: ${adjustmentSuggestion.type} ${money(adjustmentSuggestion.amount)}. Review the updated difference, then Save Ledger or Reconcile & Lock.`
      )
    } catch (error) {
      console.error('createCashAdjustment error:', error)
      setMessage(error.message || 'Failed to create Cash Adjustment entry')
    } finally {
      setSaving(false)
    }
  }

  const canLock =
    selectedAccountId &&
    actualCashCount !== '' &&
    calculated.status === 'reconciled' &&
    !currentLedger?.locked

  return (
    <div>
      <div style={pageHeaderStyle}>
        <div>
          <div style={eyebrowStyle}>Bài 48A + 48B + 48C · Cash Wallet ledger</div>
          <h1 style={titleStyle}>Cash Wallet Monthly Ledger</h1>
          <p style={subtitleStyle}>
            Track opening balance, monthly cash in/out, expected closing, actual cash count, month-end variance, and optional cash adjustment for physical cash.
          </p>
        </div>

        <div style={headerActionsStyle}>
          <label style={fieldCompactStyle}>
            Cash Wallet
            <select value={selectedAccountId} onChange={handleAccountChange} style={selectStyle}>
              {cashAccounts.length === 0 ? (
                <option value="">No Cash Wallet account</option>
              ) : (
                cashAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {displayName(account.name)} {isArchivedName(account.name) ? '(Archived)' : ''}
                  </option>
                ))
              )}
            </select>
          </label>

          <label style={fieldCompactStyle}>
            Ledger Month
            <input type="month" value={monthKey} onChange={handleMonthChange} style={monthInputStyle} />
          </label>

          <button type="button" onClick={loadLedgerData} disabled={loading} style={refreshButtonStyle}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      {cashAccounts.length === 0 && !loading && (
        <div style={warningStyle}>
          <strong>No Cash Wallet account found.</strong>
          <div>Create one account with account type “Cash Wallet” in Accounts first, then return here.</div>
        </div>
      )}

      {currentLedger?.locked && (
        <div style={lockedNoticeStyle}>
          <strong>{getMonthLabel(monthKey)} is locked.</strong>
          <div>This monthly cash snapshot is closed. Unlock only if you need to correct the count or resave updated cashflow movement.</div>
        </div>
      )}

      {movementChanged && (
        <div style={warningStyle}>
          <strong>Cashflow changed after this ledger was saved.</strong>
          <div>
            Saved movement: in {money(currentLedger.cash_in)} / out {money(currentLedger.cash_out)}. Current movement: in {money(currentMovement.cashIn)} / out {money(currentMovement.cashOut)}. Save again to refresh the snapshot.
          </div>
        </div>
      )}

      <div style={summaryGridStyle}>
        <StatCard label="Opening Balance" value={money(calculated.opening)} sub="Start of selected month" tone="neutral" />
        <StatCard label="Cash In" value={money(calculated.cashIn)} sub={`${currentMovement.entryCount} cashflow entries this month`} tone="good" />
        <StatCard label="Cash Out" value={money(calculated.cashOut)} sub="Physical cash expenses" tone="bad" />
        <StatCard label="Expected Closing" value={money(calculated.expectedClosing)} sub="Opening + in - out" tone={calculated.expectedClosing >= 0 ? 'good' : 'bad'} />
        <StatCard
          label="Actual Cash Count"
          value={calculated.actual === null ? 'Not counted' : money(calculated.actual)}
          sub="Manual count at month-end"
          tone={calculated.actual === null ? 'neutral' : 'good'}
        />
        <StatCard
          label="Difference"
          value={calculated.difference === null ? '—' : money(calculated.difference)}
          sub={getStatusLabel(calculated.status)}
          tone={getStatusTone(calculated.status)}
        />
      </div>

      <div style={mainGridStyle}>
        <div style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={{ margin: 0 }}>Month-End Cash Count</h2>
              <p style={smallTextStyle}>
                Ledger saves a monthly snapshot only. It does not create or edit cashflow entries.
              </p>
            </div>
            <StatusBadge status={currentLedger?.status || calculated.status} locked={Boolean(currentLedger?.locked)} />
          </div>

          <div style={formGridStyle}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Opening Balance</label>
              <input
                type="number"
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                disabled={currentLedger?.locked}
                style={inputStyle}
              />
              <div style={helperTextStyle}>
                Suggested from prior actual cash count. If no prior ledger exists, it uses all-time cashflow before this month.
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Actual Cash Count</label>
              <input
                type="number"
                step="0.01"
                value={actualCashCount}
                onChange={(e) => setActualCashCount(e.target.value)}
                placeholder="Example: 820.00"
                disabled={currentLedger?.locked}
                style={inputStyle}
              />
              <div style={helperTextStyle}>Enter the real cash you counted at month-end.</div>
            </div>
          </div>

          <div style={formulaBoxStyle}>
            <div>
              <strong>Formula</strong>
              <div style={mutedStyle}>
                {money(calculated.opening)} opening + {money(calculated.cashIn)} cash in - {money(calculated.cashOut)} cash out = {money(calculated.expectedClosing)} expected closing
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <strong>{calculated.difference === null ? 'No count yet' : money(calculated.difference)}</strong>
              <div style={mutedStyle}>Actual - expected</div>
            </div>
          </div>

          <div style={adjustmentBoxStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h3 style={{ margin: 0 }}>Bài 48C · Cash Adjustment Helper</h3>
                <p style={smallTextStyle}>
                  Use this only when counted cash is different from expected closing and you want Cashflow to match real cash.
                </p>
              </div>
              {existingAdjustmentForMonth ? (
                <span style={warnBadgeStyle}>Adjustment exists</span>
              ) : adjustmentSuggestion?.needed ? (
                <span style={badBadgeStyle}>Adjustment needed</span>
              ) : adjustmentSuggestion ? (
                <span style={goodBadgeStyle}>Clean</span>
              ) : (
                <span style={neutralBadgeStyle}>No count yet</span>
              )}
            </div>

            {!adjustmentSuggestion && (
              <div style={mutedStyle}>Enter Actual Cash Count first. The helper will decide whether to create an income or expense adjustment.</div>
            )}

            {adjustmentSuggestion && !adjustmentSuggestion.needed && (
              <div style={successNoticeStyle}>
                <strong>No adjustment needed.</strong> Actual cash matches expected closing within {money(RECONCILE_TOLERANCE)}.
              </div>
            )}

            {adjustmentSuggestion?.needed && (
              <>
                <div style={adjustmentPreviewGridStyle}>
                  <ContextRow label="Adjustment type" value={adjustmentSuggestion.type === 'income' ? 'Income adjustment' : 'Expense adjustment'} />
                  <ContextRow label="Amount" value={money(adjustmentSuggestion.amount)} />
                  <ContextRow label="Entry date" value={adjustmentSuggestion.entryDate} />
                  <ContextRow label="Category" value={ADJUSTMENT_CATEGORY} />
                </div>

                <div style={helperTextStyle}>
                  {adjustmentSuggestion.description} This creates one Cashflow entry tied to the selected Cash Wallet account.
                </div>

                {existingAdjustmentForMonth && (
                  <div style={warningMiniStyle}>
                    Existing adjustment found: {existingAdjustmentForMonth.entry_date} · {existingAdjustmentForMonth.type} · {money(existingAdjustmentForMonth.amount)}. Edit/delete it from Cashflow if it is wrong.
                  </div>
                )}

                <button
                  type="button"
                  onClick={createCashAdjustment}
                  disabled={saving || loading || currentLedger?.locked || Boolean(existingAdjustmentForMonth)}
                  style={
                    saving || loading || currentLedger?.locked || existingAdjustmentForMonth
                      ? disabledButtonStyle
                      : warnButtonStyle
                  }
                >
                  Create Cash Adjustment Entry
                </button>
              </>
            )}
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Reconciliation Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={currentLedger?.locked}
              placeholder="Example: Difference likely from small cash tips / untracked snack purchase / manual correction needed."
              rows={4}
              style={textareaStyle}
            />
          </div>

          <div style={actionRowStyle}>
            <button
              type="button"
              onClick={() => saveLedger({ lock: false })}
              disabled={saving || loading || !selectedAccountId || currentLedger?.locked}
              style={primaryButtonStyle}
            >
              {saving ? 'Saving...' : 'Save Ledger'}
            </button>

            <button
              type="button"
              onClick={() => saveLedger({ lock: true })}
              disabled={saving || loading || !canLock}
              title={canLock ? 'Save and lock this reconciled month' : 'Actual count must match expected closing before locking'}
              style={canLock ? successButtonStyle : disabledButtonStyle}
            >
              Reconcile & Lock
            </button>

            {currentLedger?.locked && (
              <button type="button" onClick={unlockLedger} disabled={saving} style={warnButtonStyle}>
                Unlock
              </button>
            )}

            {currentLedger && !currentLedger.locked && (
              <button type="button" onClick={deleteLedger} disabled={saving} style={dangerButtonStyle}>
                Delete Snapshot
              </button>
            )}
          </div>
        </div>

        <div style={sideColumnStyle}>
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Cash Wallet Context</h2>
            {selectedAccount ? (
              <div style={contextListStyle}>
                <ContextRow label="Selected account" value={displayName(selectedAccount.name)} />
                <ContextRow label="Current all-time net" value={money(selectedAllTimeNet)} />
                <ContextRow label="Previous month" value={getMonthLabel(shiftMonthKey(monthKey, -1))} />
                <ContextRow
                  label="Previous actual count"
                  value={previousLedger?.actual_cash_count === null || previousLedger?.actual_cash_count === undefined ? 'No prior ledger' : money(previousLedger.actual_cash_count)}
                />
                <ContextRow label="Current snapshot" value={currentLedger ? 'Saved' : 'Not saved yet'} />
                <ContextRow label="Adjustment entries" value={String(adjustmentEntriesThisMonth.length)} />
              </div>
            ) : (
              <p style={mutedStyle}>Select a Cash Wallet account to see context.</p>
            )}
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>How to Use</h2>
            <div style={ruleListStyle}>
              <div>1. Pick the Cash Wallet account and month.</div>
              <div>2. Review opening, cash in, cash out, and expected closing.</div>
              <div>3. Count your real cash and enter Actual Cash Count.</div>
              <div>4. If difference is not zero, write a note and review missing cashflow.</div>
              <div>5. If needed, create one Cash Adjustment entry to make Cashflow match real cash.</div>
              <div>6. Lock only when the month is clean.</div>
            </div>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={{ margin: 0 }}>Ledger History</h2>
            <p style={smallTextStyle}>Latest 12 monthly snapshots for the selected Cash Wallet account.</p>
          </div>
        </div>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Month</th>
                <th style={thRightStyle}>Opening</th>
                <th style={thRightStyle}>Cash In</th>
                <th style={thRightStyle}>Cash Out</th>
                <th style={thRightStyle}>Expected</th>
                <th style={thRightStyle}>Actual</th>
                <th style={thRightStyle}>Difference</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Note</th>
              </tr>
            </thead>
            <tbody>
              {ledgerHistory.length === 0 ? (
                <tr>
                  <td colSpan="9" style={emptyTdStyle}>
                    No Cash Wallet ledger snapshots yet.
                  </td>
                </tr>
              ) : (
                ledgerHistory.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>
                      <strong>{getMonthLabel(row.month_key)}</strong>
                      <div style={mutedStyle}>{row.month_key}</div>
                    </td>
                    <td style={tdRightStyle}>{money(row.opening_balance)}</td>
                    <td style={tdRightStyle}>{money(row.cash_in)}</td>
                    <td style={tdRightStyle}>{money(row.cash_out)}</td>
                    <td style={tdRightStyle}>{money(row.expected_closing_balance)}</td>
                    <td style={tdRightStyle}>
                      {row.actual_cash_count === null || row.actual_cash_count === undefined
                        ? '—'
                        : money(row.actual_cash_count)}
                    </td>
                    <td style={tdRightStyle}>
                      {row.difference === null || row.difference === undefined ? (
                        '—'
                      ) : (
                        <span style={Math.abs(toNumber(row.difference)) <= RECONCILE_TOLERANCE ? positiveTextStyle : negativeTextStyle}>
                          {money(row.difference)}
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <StatusBadge status={row.status} locked={Boolean(row.locked)} />
                    </td>
                    <td style={tdStyle}>{row.note || <span style={mutedStyle}>No note</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, tone }) {
  const color =
    tone === 'good' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : 'var(--text-main)'

  return (
    <div style={statCardStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={{ ...statValueStyle, color }}>{value}</div>
      <div style={statSubStyle}>{sub}</div>
    </div>
  )
}

function StatusBadge({ status, locked }) {
  const tone = getStatusTone(status)
  const style = tone === 'good' ? goodBadgeStyle : tone === 'bad' ? badBadgeStyle : neutralBadgeStyle
  return <span style={style}>{locked ? 'Locked · ' : ''}{getStatusLabel(status)}</span>
}

function ContextRow({ label, value }) {
  return (
    <div style={contextRowStyle}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const pageHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '20px',
  alignItems: 'flex-start',
  marginBottom: '22px',
  flexWrap: 'wrap'
}

const eyebrowStyle = {
  color: 'var(--accent)',
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: '8px'
}

const titleStyle = {
  margin: 0,
  fontSize: '34px',
  lineHeight: 1.05,
  letterSpacing: '-0.04em'
}

const subtitleStyle = {
  color: 'var(--text-muted)',
  maxWidth: '820px',
  margin: '10px 0 0',
  lineHeight: 1.6
}

const headerActionsStyle = {
  display: 'flex',
  gap: '12px',
  alignItems: 'flex-end',
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
}

const fieldCompactStyle = {
  display: 'grid',
  gap: '7px',
  minWidth: '190px',
  color: 'var(--text-soft)',
  fontSize: '12px',
  fontWeight: 800
}

const selectStyle = {
  minHeight: '42px',
  borderRadius: '12px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  padding: '10px 12px',
  outline: 'none'
}

const monthInputStyle = {
  ...selectStyle,
  minWidth: '160px'
}

const refreshButtonStyle = {
  minHeight: '42px',
  border: '1px solid var(--accent-strong)',
  background: 'var(--accent-strong)',
  color: 'white',
  borderRadius: '12px',
  padding: '10px 14px',
  fontWeight: 850
}

const messageStyle = {
  border: '1px solid color-mix(in srgb, var(--accent-strong) 28%, transparent)',
  background: 'color-mix(in srgb, var(--accent-strong) 10%, transparent)',
  color: 'var(--text-main)',
  borderRadius: '16px',
  padding: '13px 15px',
  marginBottom: '18px',
  lineHeight: 1.55
}

const warningStyle = {
  border: '1px solid color-mix(in srgb, var(--warning) 34%, transparent)',
  background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  color: 'var(--warning)',
  borderRadius: '16px',
  padding: '13px 15px',
  marginBottom: '18px',
  lineHeight: 1.55
}

const lockedNoticeStyle = {
  border: '1px solid color-mix(in srgb, var(--success) 34%, transparent)',
  background: 'color-mix(in srgb, var(--success) 12%, transparent)',
  color: 'var(--success)',
  borderRadius: '16px',
  padding: '13px 15px',
  marginBottom: '18px',
  lineHeight: 1.55
}

const successNoticeStyle = {
  border: '1px solid color-mix(in srgb, var(--success) 34%, transparent)',
  background: 'color-mix(in srgb, var(--success) 12%, transparent)',
  color: 'var(--success)',
  borderRadius: '14px',
  padding: '12px 13px',
  lineHeight: 1.55
}

const warningMiniStyle = {
  border: '1px solid color-mix(in srgb, var(--warning) 34%, transparent)',
  background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  color: 'var(--warning)',
  borderRadius: '14px',
  padding: '11px 12px',
  fontSize: '12px',
  lineHeight: 1.5
}

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '14px',
  marginBottom: '18px'
}

const statCardStyle = {
  border: '1px solid var(--border-main)',
  borderRadius: '18px',
  background: 'var(--bg-card)',
  padding: '16px',
  boxShadow: 'var(--shadow-card)'
}

const statLabelStyle = {
  color: 'var(--text-muted)',
  fontSize: '12px',
  fontWeight: 850,
  textTransform: 'uppercase',
  letterSpacing: '0.08em'
}

const statValueStyle = {
  marginTop: '8px',
  fontSize: '24px',
  fontWeight: 950,
  letterSpacing: '-0.03em'
}

const statSubStyle = {
  color: 'var(--text-muted)',
  marginTop: '6px',
  fontSize: '12px',
  lineHeight: 1.45
}

const mainGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.6fr) minmax(300px, 0.7fr)',
  gap: '18px',
  alignItems: 'start',
  marginBottom: '18px'
}

const sideColumnStyle = {
  display: 'grid',
  gap: '18px'
}

const cardStyle = {
  border: '1px solid var(--border-main)',
  borderRadius: '18px',
  background: 'var(--bg-card)',
  padding: '18px',
  boxShadow: 'var(--shadow-card)',
  marginBottom: '18px'
}

const sectionHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '14px',
  alignItems: 'flex-start',
  marginBottom: '16px',
  flexWrap: 'wrap'
}

const smallTextStyle = {
  color: 'var(--text-muted)',
  lineHeight: 1.55,
  margin: '8px 0 0'
}

const formGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '14px'
}

const fieldStyle = {
  display: 'grid',
  gap: '8px',
  marginBottom: '14px'
}

const labelStyle = {
  color: 'var(--text-main)',
  fontSize: '13px',
  fontWeight: 850
}

const inputStyle = {
  minHeight: '42px',
  borderRadius: '12px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  padding: '10px 12px',
  outline: 'none'
}

const textareaStyle = {
  ...inputStyle,
  minHeight: '110px',
  resize: 'vertical'
}

const helperTextStyle = {
  color: 'var(--text-muted)',
  fontSize: '12px',
  lineHeight: 1.45
}

const formulaBoxStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '14px',
  alignItems: 'center',
  border: '1px solid color-mix(in srgb, var(--accent-strong) 28%, transparent)',
  background: 'color-mix(in srgb, var(--accent-strong) 10%, transparent)',
  borderRadius: '16px',
  padding: '14px',
  margin: '16px 0',
  flexWrap: 'wrap'
}

const adjustmentBoxStyle = {
  border: '1px solid color-mix(in srgb, var(--warning) 34%, transparent)',
  background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  borderRadius: '18px',
  padding: '15px',
  margin: '16px 0',
  display: 'grid',
  gap: '12px'
}

const adjustmentPreviewGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '10px'
}

const mutedStyle = {
  color: 'var(--text-muted)',
  fontSize: '12px',
  lineHeight: 1.45
}

const actionRowStyle = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  marginTop: '14px'
}

const baseButtonStyle = {
  minHeight: '40px',
  borderRadius: '12px',
  padding: '10px 14px',
  fontWeight: 850,
  color: 'white'
}

const primaryButtonStyle = {
  ...baseButtonStyle,
  border: '1px solid var(--accent-strong)',
  background: 'var(--accent-strong)'
}

const successButtonStyle = {
  ...baseButtonStyle,
  border: '1px solid var(--success)',
  background: 'var(--success)'
}

const warnButtonStyle = {
  ...baseButtonStyle,
  border: '1px solid var(--warning)',
  background: 'var(--warning)'
}

const dangerButtonStyle = {
  ...baseButtonStyle,
  border: '1px solid var(--danger)',
  background: 'var(--danger)'
}

const disabledButtonStyle = {
  ...baseButtonStyle,
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-muted)',
  cursor: 'not-allowed'
}

const contextListStyle = {
  display: 'grid',
  gap: '10px'
}

const contextRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  borderBottom: '1px solid var(--border-soft)',
  paddingBottom: '10px',
  color: 'var(--text-soft)'
}

const ruleListStyle = {
  display: 'grid',
  gap: '10px',
  color: 'var(--text-soft)',
  fontSize: '13px',
  lineHeight: 1.55
}

const tableWrapStyle = {
  overflowX: 'auto',
  border: '1px solid var(--border-main)',
  borderRadius: '16px'
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: '980px'
}

const thStyle = {
  textAlign: 'left',
  padding: '12px',
  borderBottom: '1px solid var(--border-main)',
  color: 'var(--text-muted)',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  background: 'var(--bg-card-soft)'
}

const thRightStyle = {
  ...thStyle,
  textAlign: 'right'
}

const tdStyle = {
  padding: '12px',
  borderBottom: '1px solid var(--border-soft)',
  verticalAlign: 'top'
}

const tdRightStyle = {
  ...tdStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums'
}

const emptyTdStyle = {
  ...tdStyle,
  textAlign: 'center',
  color: 'var(--text-muted)',
  padding: '24px'
}

const positiveTextStyle = {
  color: 'var(--success)',
  fontWeight: 850
}

const negativeTextStyle = {
  color: 'var(--danger)',
  fontWeight: 850
}

const badgeBaseStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '999px',
  padding: '5px 9px',
  fontSize: '11px',
  fontWeight: 900,
  whiteSpace: 'nowrap'
}

const goodBadgeStyle = {
  ...badgeBaseStyle,
  color: 'var(--success)',
  background: 'color-mix(in srgb, var(--success) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--success) 34%, transparent)'
}

const badBadgeStyle = {
  ...badgeBaseStyle,
  color: 'var(--danger)',
  background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--danger) 34%, transparent)'
}

const warnBadgeStyle = {
  ...badgeBaseStyle,
  color: 'var(--warning)',
  background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--warning) 34%, transparent)'
}

const neutralBadgeStyle = {
  ...badgeBaseStyle,
  color: 'var(--text-soft)',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-soft)'
}
