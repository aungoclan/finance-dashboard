import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  parseCsvText,
  normalizeRowsBySource,
  detectCsvSource,
  buildTransactionHash
} from '../lib/importers'

const ASSET_TYPE_OPTIONS = ['stock', 'etf', 'crypto', 'cash', 'other']
const TRANSACTION_TYPE_OPTIONS = ['buy', 'sell', 'dividend', 'interest', 'fee', 'deposit', 'withdraw']

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeSymbol(value) {
  return normalizeText(value).toUpperCase()
}

function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function formatMoney(value) {
  const num = Number(value || 0)
  return num.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function buildRowHash(row) {
  return buildTransactionHash({
    transaction_date: row.transaction_date,
    symbol: normalizeSymbol(row.symbol),
    type: row.type,
    quantity: row.quantity,
    unit_price: row.unit_price
  })
}

function getRowErrors(row) {
  const errors = []
  const symbol = normalizeSymbol(row.symbol)
  const type = normalizeText(row.type).toLowerCase()
  const assetType = normalizeText(row.asset_type).toLowerCase()
  const quantity = toNumberOrNull(row.quantity)
  const unitPrice = toNumberOrNull(row.unit_price)

  if (!row.account_id) errors.push('Select account')
  if (!row.transaction_date) errors.push('Missing date')
  if (!symbol) errors.push('Missing symbol')
  if (!TRANSACTION_TYPE_OPTIONS.includes(type)) errors.push('Invalid type')
  if (!ASSET_TYPE_OPTIONS.includes(assetType)) errors.push('Invalid asset type')

  if (['buy', 'sell'].includes(type)) {
    if (!quantity || quantity <= 0) errors.push('Buy/Sell needs quantity')
    if (unitPrice === null || unitPrice < 0) errors.push('Buy/Sell needs price')
  }

  if (['dividend', 'interest', 'deposit', 'withdraw'].includes(type)) {
    if (quantity !== null && quantity < 0) errors.push('Quantity cannot be negative')
    if (unitPrice !== null && unitPrice < 0) errors.push('Price cannot be negative')
  }

  if (type === 'fee' && row.fee !== null && row.fee !== undefined && Number(row.fee) < 0) {
    errors.push('Fee cannot be negative')
  }

  return errors
}

function normalizeEditableRow(row, accountId = '') {
  const normalized = {
    ...row,
    account_id: row.account_id || accountId || '',
    symbol: normalizeSymbol(row.symbol),
    display_name: normalizeText(row.display_name) || normalizeSymbol(row.symbol),
    asset_type: normalizeText(row.asset_type).toLowerCase() || 'stock',
    type: normalizeText(row.type).toLowerCase(),
    quantity: row.quantity === undefined ? null : row.quantity,
    unit_price: row.unit_price === undefined ? null : row.unit_price,
    fee: row.fee ?? 0,
    source_name: row.source_name || 'CSV'
  }

  return {
    ...normalized,
    hash: buildRowHash(normalized),
    preview_status: normalized.preview_status || 'New'
  }
}

export default function ImportPage() {
  const [accounts, setAccounts] = useState([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedSource, setSelectedSource] = useState('robinhood')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [previewRows, setPreviewRows] = useState([])
  const [skippedRows, setSkippedRows] = useState([])
  const [importJobs, setImportJobs] = useState([])

  const [loading, setLoading] = useState(true)
  const [parsing, setParsing] = useState(false)
  const [checkingDuplicates, setCheckingDuplicates] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [filterMode, setFilterMode] = useState('all') // all | new | duplicate | review
  const [previewPage, setPreviewPage] = useState(1)
  const [previewPageSize, setPreviewPageSize] = useState(25)

  useEffect(() => {
    loadInitialData()
  }, [])

  useEffect(() => {
    if (!selectedAccountId || previewRows.length === 0) return

    const rowsNeedingDefaultAccount = previewRows.some((row) => !row.account_id)
    if (rowsNeedingDefaultAccount) {
      setPreviewRows((currentRows) =>
        currentRows.map((row) =>
          row.account_id
            ? row
            : normalizeEditableRow({ ...row, account_id: selectedAccountId, preview_status: 'Needs Check' }, selectedAccountId)
        )
      )
      return
    }

    markDuplicateRows()
  }, [selectedAccountId])

  useEffect(() => {
    setPreviewPage(1)
  }, [filterMode, previewPageSize, previewRows.length])

  const loadInitialData = async () => {
    setLoading(true)
    setMessage('')

    try {
      await Promise.all([loadAccounts(), loadImportJobs()])
    } catch (error) {
      console.error(error)
      setMessage('Failed to load import page data')
    }

    setLoading(false)
  }

  const loadAccounts = async () => {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      throw new Error('Unable to get current user')
    }

    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) throw error

    setAccounts(data || [])
  }

  const loadImportJobs = async () => {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      throw new Error('Unable to get current user')
    }

    const { data, error } = await supabase
      .from('import_jobs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8)

    if (error) throw error

    setImportJobs(data || [])
  }

  const resetPreview = () => {
    setPreviewRows([])
    setSkippedRows([])
    setSelectedFileName('')
    setFilterMode('all')
    setPreviewPage(1)
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setParsing(true)
    setMessage('')
    setSelectedFileName(file.name)
    setPreviewRows([])
    setSkippedRows([])
    setFilterMode('all')
    setPreviewPage(1)

    try {
      const text = await file.text()
      const parsed = parseCsvText(text)

      if (parsed.errors?.length) {
        console.warn('CSV parse warnings:', parsed.errors)
      }

      const detectedSource = detectCsvSource(parsed.data || [])

      if (detectedSource) {
        setSelectedSource(detectedSource)
      }

      const effectiveSource = detectedSource || selectedSource

      const { normalized, skipped } = normalizeRowsBySource(
        effectiveSource,
        parsed.data || []
      )

      const rowsWithMeta = normalized.map((row) =>
        normalizeEditableRow(
          {
            ...row,
            account_id: selectedAccountId || '',
            preview_status: selectedAccountId ? 'New' : 'Needs Review'
          },
          selectedAccountId
        )
      )

      setPreviewRows(rowsWithMeta)
      setSkippedRows(skipped || [])

      if (selectedAccountId) {
        await markDuplicateRows(rowsWithMeta)
      } else {
        setMessage(
          `Parsed ${rowsWithMeta.length} valid rows. Skipped ${(skipped || []).length} rows. Select an account or assign accounts in the review table before importing.${detectedSource ? ` Auto-detected source: ${detectedSource}.` : ''}`
        )
      }
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to parse CSV')
      setPreviewRows([])
      setSkippedRows([])
    }

    setParsing(false)
  }

  const markDuplicateRows = async (rowsArg = previewRows) => {
    if (rowsArg.length === 0) return

    const rowsWithAccounts = rowsArg.filter((row) => row.account_id)
    if (rowsWithAccounts.length === 0) {
      setPreviewRows(rowsArg.map((row) => ({ ...row, preview_status: 'Needs Review' })))
      setMessage('Select an account for each row before duplicate checking.')
      return
    }

    setCheckingDuplicates(true)
    setMessage('Checking duplicates...')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      const accountIds = [...new Set(rowsWithAccounts.map((row) => row.account_id))]

      const { data: existingTransactions, error } = await supabase
        .from('investment_transactions')
        .select(`
          id,
          transaction_date,
          type,
          quantity,
          unit_price,
          account_id,
          assets (
            symbol
          )
        `)
        .eq('user_id', user.id)
        .in('account_id', accountIds)

      if (error) throw error

      const existingHashSet = new Set(
        (existingTransactions || []).map((tx) => {
          const symbol = normalizeSymbol(tx.assets?.symbol)
          const hash = [
            tx.transaction_date,
            symbol,
            tx.type,
            tx.quantity,
            tx.unit_price
          ].join('|')

          return `${tx.account_id}|${hash}`
        })
      )

      const updatedRows = rowsArg.map((row) => {
        const cleanRow = normalizeEditableRow(row)
        const rowErrors = getRowErrors(cleanRow)

        if (rowErrors.length > 0) {
          return {
            ...cleanRow,
            preview_status: 'Needs Review'
          }
        }

        return {
          ...cleanRow,
          preview_status: existingHashSet.has(`${cleanRow.account_id}|${cleanRow.hash}`)
            ? 'Duplicate'
            : 'New'
        }
      })

      setPreviewRows(updatedRows)

      const duplicateCount = updatedRows.filter((row) => row.preview_status === 'Duplicate').length
      const newCount = updatedRows.filter((row) => row.preview_status === 'New').length
      const reviewCount = updatedRows.filter((row) => getRowErrors(row).length > 0).length

      setMessage(
        `Preview ready. ${newCount} new rows, ${duplicateCount} duplicate rows, ${reviewCount} rows need review, ${skippedRows.length} skipped rows.`
      )
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Failed to check duplicates')
    }

    setCheckingDuplicates(false)
  }

  const updatePreviewRow = (rowIndex, field, value) => {
    setPreviewRows((currentRows) =>
      currentRows.map((row, index) => {
        if (index !== rowIndex) return row

        const updated = normalizeEditableRow({
          ...row,
          [field]: field === 'quantity' || field === 'unit_price' || field === 'fee'
            ? toNumberOrNull(value)
            : value,
          preview_status: 'Needs Check'
        })

        return updated
      })
    )
  }

  const removePreviewRow = (rowIndex) => {
    setPreviewRows((currentRows) => currentRows.filter((_, index) => index !== rowIndex))
  }

  const applyAccountToAllRows = () => {
    if (!selectedAccountId) {
      setMessage('Select an account first, then apply it to all preview rows.')
      return
    }

    setPreviewRows((currentRows) =>
      currentRows.map((row) =>
        normalizeEditableRow({
          ...row,
          account_id: selectedAccountId,
          preview_status: 'Needs Check'
        })
      )
    )

    setMessage('Applied selected account to all preview rows. Run duplicate check before importing.')
  }

  const ensureAssetExists = async (row) => {
    const symbol = normalizeSymbol(row.symbol)
    const assetType = normalizeText(row.asset_type).toLowerCase()

    const { data: existing, error: existingError } = await supabase
      .from('assets')
      .select('*')
      .eq('symbol', symbol)
      .eq('asset_type', assetType)
      .maybeSingle()

    if (existingError) throw existingError
    if (existing) return existing.id

    const { data: created, error: createError } = await supabase
      .from('assets')
      .insert({
        symbol,
        display_name: normalizeText(row.display_name) || symbol,
        asset_type: assetType,
        currency: 'USD'
      })
      .select()
      .single()

    if (createError) throw createError

    return created.id
  }

  const handleImport = async () => {
    if (previewRows.length === 0) {
      setMessage('There are no valid rows to import')
      return
    }

    const rowsWithErrors = previewRows.filter((row) => getRowErrors(row).length > 0)
    if (rowsWithErrors.length > 0) {
      setMessage(`Fix ${rowsWithErrors.length} row${rowsWithErrors.length === 1 ? '' : 's'} that need review before importing.`)
      setFilterMode('review')
      return
    }

    const needsDuplicateCheck = previewRows.some((row) => row.preview_status === 'Needs Check' || row.preview_status === 'Needs Review')
    if (needsDuplicateCheck) {
      setMessage('Run duplicate check after editing rows before importing.')
      return
    }

    const newRows = previewRows.filter((row) => row.preview_status === 'New')

    if (newRows.length === 0) {
      setMessage('There are no new rows to import. Everything in preview is duplicate or removed.')
      return
    }

    setImporting(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) {
        throw new Error('Unable to get current user')
      }

      let importedCount = 0
      let duplicateCount = 0

      for (const row of newRows) {
        const cleanRow = normalizeEditableRow(row)
        const assetId = await ensureAssetExists(cleanRow)

        const { data: existing, error: existingError } = await supabase
          .from('investment_transactions')
          .select('id')
          .eq('user_id', user.id)
          .eq('account_id', cleanRow.account_id)
          .eq('asset_id', assetId)
          .eq('transaction_date', cleanRow.transaction_date)
          .eq('type', cleanRow.type)
          .eq('quantity', cleanRow.quantity)
          .eq('unit_price', cleanRow.unit_price)
          .limit(1)

        if (existingError) throw existingError

        if (existing && existing.length > 0) {
          duplicateCount++
          continue
        }

        const { error } = await supabase.from('investment_transactions').insert({
          user_id: user.id,
          account_id: cleanRow.account_id,
          asset_id: assetId,
          transaction_date: cleanRow.transaction_date,
          type: cleanRow.type,
          quantity: cleanRow.quantity,
          unit_price: cleanRow.unit_price,
          fee: cleanRow.fee ?? 0
        })

        if (error) throw error

        importedCount++
      }

      const { error: importLogError } = await supabase.from('import_jobs').insert({
        user_id: user.id,
        source: selectedSource,
        file_name: selectedFileName,
        total_rows: previewRows.length,
        imported_rows: importedCount,
        skipped_rows: skippedRows.length + duplicateCount + previewRows.filter((r) => r.preview_status === 'Duplicate').length
      })

      if (importLogError) throw importLogError

      setMessage(
        `Import completed. Imported ${importedCount} new rows. Skipped ${skippedRows.length} invalid rows and ${previewRows.filter((r) => r.preview_status === 'Duplicate').length + duplicateCount} duplicate rows.`
      )

      resetPreview()
      await loadImportJobs()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Import failed')
    }

    setImporting(false)
  }

  const stats = useMemo(() => {
    const valid = previewRows.length
    const newRows = previewRows.filter((row) => row.preview_status === 'New').length
    const duplicates = previewRows.filter((row) => row.preview_status === 'Duplicate').length
    const review = previewRows.filter((row) => getRowErrors(row).length > 0 || row.preview_status === 'Needs Review' || row.preview_status === 'Needs Check').length
    const skipped = skippedRows.length

    return { valid, newRows, duplicates, review, skipped }
  }, [previewRows, skippedRows])

  const filteredPreviewRows = useMemo(() => {
    const rowsWithIndex = previewRows.map((row, index) => ({ row, originalIndex: index }))

    if (filterMode === 'new') {
      return rowsWithIndex.filter(({ row }) => row.preview_status === 'New')
    }

    if (filterMode === 'duplicate') {
      return rowsWithIndex.filter(({ row }) => row.preview_status === 'Duplicate')
    }

    if (filterMode === 'review') {
      return rowsWithIndex.filter(({ row }) => getRowErrors(row).length > 0 || row.preview_status === 'Needs Review' || row.preview_status === 'Needs Check')
    }

    return rowsWithIndex
  }, [previewRows, filterMode])

  const totalPreviewPages = Math.max(1, Math.ceil(filteredPreviewRows.length / previewPageSize))
  const safePreviewPage = Math.min(previewPage, totalPreviewPages)
  const previewStartIndex = filteredPreviewRows.length === 0 ? 0 : (safePreviewPage - 1) * previewPageSize + 1
  const previewEndIndex = Math.min(safePreviewPage * previewPageSize, filteredPreviewRows.length)

  const paginatedPreviewRows = useMemo(() => {
    const start = (safePreviewPage - 1) * previewPageSize
    return filteredPreviewRows.slice(start, start + previewPageSize)
  }, [filteredPreviewRows, safePreviewPage, previewPageSize])

  const importDisabled =
    importing ||
    parsing ||
    checkingDuplicates ||
    stats.newRows === 0 ||
    stats.review > 0

  return (
    <div>
      <div style={headerRowStyle}>
        <div>
          <h1 style={{ marginBottom: '8px' }}>CSV Imports</h1>
          <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
            Import investment transactions from Robinhood or Kraken CSV files, review every row, then import clean data.
          </p>
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      <div style={statsGridStyle}>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>Valid Rows</div>
          <div style={statValueStyle}>{stats.valid}</div>
        </div>

        <div style={statCardStyle}>
          <div style={statLabelStyle}>New Rows</div>
          <div style={{ ...statValueStyle, color: 'var(--success)' }}>{stats.newRows}</div>
        </div>

        <div style={statCardStyle}>
          <div style={statLabelStyle}>Duplicates</div>
          <div style={{ ...statValueStyle, color: 'var(--warning)' }}>{stats.duplicates}</div>
        </div>

        <div style={statCardStyle}>
          <div style={statLabelStyle}>Needs Review</div>
          <div style={{ ...statValueStyle, color: stats.review > 0 ? 'var(--warning)' : 'var(--success)' }}>{stats.review}</div>
        </div>

        <div style={statCardStyle}>
          <div style={statLabelStyle}>Skipped</div>
          <div style={{ ...statValueStyle, color: 'var(--danger)' }}>{stats.skipped}</div>
        </div>
      </div>

      <div style={mainGridStyle}>
        <div style={{ display: 'grid', gap: '24px', minWidth: 0 }}>
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Import Setup</h2>

            <div style={fieldStyle}>
              <label style={labelStyle}>Detected / Selected Source</label>
              <select
                value={selectedSource}
                onChange={(e) => {
                  setSelectedSource(e.target.value)
                  resetPreview()
                }}
                style={inputStyle}
                disabled={parsing || importing || checkingDuplicates}
              >
                <option value="robinhood">Robinhood</option>
                <option value="kraken">Kraken</option>
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Default Account</label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                style={inputStyle}
                disabled={loading || parsing || importing || checkingDuplicates}
              >
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.account_type})
                  </option>
                ))}
              </select>
              <div style={helperTextStyle}>Used as the default destination. You can still edit account per row in preview.</div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>CSV File</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                style={fileInputStyle}
                disabled={parsing || importing || checkingDuplicates}
              />
            </div>

            {selectedFileName && (
              <div style={helperTextStyle}>
                File: {selectedFileName}
              </div>
            )}

            <div style={{ display: 'grid', gap: '10px', marginTop: '16px' }}>
              <button
                type="button"
                onClick={applyAccountToAllRows}
                disabled={previewRows.length === 0 || !selectedAccountId || parsing || importing || checkingDuplicates}
                style={secondaryButtonStyle}
              >
                Apply Default Account to All Rows
              </button>

              <button
                type="button"
                onClick={() => markDuplicateRows()}
                disabled={previewRows.length === 0 || parsing || importing || checkingDuplicates}
                style={secondaryButtonStyle}
              >
                {checkingDuplicates ? 'Checking...' : 'Check Duplicates'}
              </button>

              <button
                type="button"
                onClick={handleImport}
                disabled={importDisabled}
                style={importDisabled ? disabledButtonStyle : buttonStyle}
              >
                {importing ? 'Importing...' : `Import ${stats.newRows} New Rows`}
              </button>
            </div>

            <div style={{ marginTop: '16px', color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.6 }}>
              <div><strong>Review first:</strong> edit symbol, asset type, transaction type, account, quantity, price, and fee before importing.</div>
              <div><strong>Duplicates:</strong> same account, asset, date, type, quantity, and unit price are skipped.</div>
              <div><strong>Tip:</strong> after editing rows, click <strong>Check Duplicates</strong> again before import.</div>
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Recent Imports</h2>

            {importJobs.length === 0 ? (
              <p>No import history yet.</p>
            ) : (
              <div style={recentImportsShellStyle}>
                {importJobs.map((job) => (
                  <div key={job.id} style={historyItemStyle}>
                    <div style={historyFileNameStyle} title={job.file_name}>{job.file_name}</div>
                    <div style={historySubText}>Source: {job.source}</div>
                    <div style={historySubText}>
                      Imported: {job.imported_rows} / {job.total_rows}
                    </div>
                    <div style={historySubText}>
                      Skipped: {job.skipped_rows}
                    </div>
                    <div style={historySubText}>
                      {new Date(job.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: '24px', minWidth: 0 }}>
          <div style={cardStyle}>
            <div style={previewHeaderStyle}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: '6px' }}>Import Review</h2>
                <div style={helperTextStyle}>Edit rows here before they are saved to Supabase.</div>
              </div>

              <div style={filterRowStyle}>
                <button
                  type="button"
                  onClick={() => { setFilterMode('all'); setPreviewPage(1) }}
                  style={filterMode === 'all' ? activeFilterButtonStyle : filterButtonStyle}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => { setFilterMode('new'); setPreviewPage(1) }}
                  style={filterMode === 'new' ? activeFilterButtonStyle : filterButtonStyle}
                >
                  New
                </button>
                <button
                  type="button"
                  onClick={() => { setFilterMode('duplicate'); setPreviewPage(1) }}
                  style={filterMode === 'duplicate' ? activeFilterButtonStyle : filterButtonStyle}
                >
                  Duplicates
                </button>
                <button
                  type="button"
                  onClick={() => { setFilterMode('review'); setPreviewPage(1) }}
                  style={filterMode === 'review' ? activeFilterButtonStyle : filterButtonStyle}
                >
                  Needs Review
                </button>
              </div>
            </div>

            {filteredPreviewRows.length > 0 && (
              <div style={previewToolbarStyle}>
                <div style={helperTextStyle}>
                  Showing {previewStartIndex}-{previewEndIndex} of {filteredPreviewRows.length} rows. Import will still process all valid New rows, not just this page.
                </div>

                <div style={paginationControlsStyle}>
                  <select
                    value={previewPageSize}
                    onChange={(e) => setPreviewPageSize(Number(e.target.value))}
                    style={pageSizeSelectStyle}
                    disabled={parsing || importing || checkingDuplicates}
                  >
                    <option value={10}>10 rows</option>
                    <option value={25}>25 rows</option>
                    <option value={50}>50 rows</option>
                    <option value={100}>100 rows</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}
                    disabled={safePreviewPage <= 1}
                    style={safePreviewPage <= 1 ? disabledSmallButtonStyle : smallButtonStyle}
                  >
                    Prev
                  </button>

                  <div style={pageTextStyle}>Page {safePreviewPage} / {totalPreviewPages}</div>

                  <button
                    type="button"
                    onClick={() => setPreviewPage((page) => Math.min(totalPreviewPages, page + 1))}
                    disabled={safePreviewPage >= totalPreviewPages}
                    style={safePreviewPage >= totalPreviewPages ? disabledSmallButtonStyle : smallButtonStyle}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {parsing ? (
              <p>Parsing CSV...</p>
            ) : checkingDuplicates ? (
              <p>Checking duplicates for selected account...</p>
            ) : filteredPreviewRows.length === 0 ? (
              <p>No preview rows for the selected filter. Upload a CSV file first.</p>
            ) : (
              <div style={previewTableShellStyle}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>Symbol</th>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Asset Type</th>
                      <th style={thStyle}>Tx Type</th>
                      <th style={thStyle}>Account</th>
                      <th style={thStyle}>Qty</th>
                      <th style={thStyle}>Price</th>
                      <th style={thStyle}>Fee</th>
                      <th style={thStyle}>Est. Value</th>
                      <th style={thStyle}>Source</th>
                      <th style={thStyle}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedPreviewRows.map(({ row, originalIndex }) => {
                      const errors = getRowErrors(row)
                      const estimate = Number(row.quantity || 0) * Number(row.unit_price || 0)

                      return (
                        <tr key={`${row.hash}-${originalIndex}`}>
                          <td style={tdStyle}>
                            {errors.length > 0 ? (
                              <div>
                                <span style={reviewBadgeStyle}>Review</span>
                                <div style={errorTextStyle}>{errors.join(', ')}</div>
                              </div>
                            ) : row.preview_status === 'Duplicate' ? (
                              <span style={duplicateBadgeStyle}>Duplicate</span>
                            ) : row.preview_status === 'Needs Check' ? (
                              <span style={checkBadgeStyle}>Check</span>
                            ) : (
                              <span style={newBadgeStyle}>New</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            <input
                              type="date"
                              value={row.transaction_date || ''}
                              onChange={(e) => updatePreviewRow(originalIndex, 'transaction_date', e.target.value)}
                              style={smallInputStyle}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              value={row.symbol || ''}
                              onChange={(e) => updatePreviewRow(originalIndex, 'symbol', e.target.value)}
                              style={{ ...smallInputStyle, width: '90px' }}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              value={row.display_name || ''}
                              onChange={(e) => updatePreviewRow(originalIndex, 'display_name', e.target.value)}
                              style={{ ...smallInputStyle, width: '160px' }}
                            />
                          </td>
                          <td style={tdStyle}>
                            <select
                              value={row.asset_type || 'stock'}
                              onChange={(e) => updatePreviewRow(originalIndex, 'asset_type', e.target.value)}
                              style={smallSelectStyle}
                            >
                              {ASSET_TYPE_OPTIONS.map((type) => (
                                <option key={type} value={type}>{type}</option>
                              ))}
                            </select>
                          </td>
                          <td style={tdStyle}>
                            <select
                              value={row.type || 'buy'}
                              onChange={(e) => updatePreviewRow(originalIndex, 'type', e.target.value)}
                              style={smallSelectStyle}
                            >
                              {TRANSACTION_TYPE_OPTIONS.map((type) => (
                                <option key={type} value={type}>{type}</option>
                              ))}
                            </select>
                          </td>
                          <td style={tdStyle}>
                            <select
                              value={row.account_id || ''}
                              onChange={(e) => updatePreviewRow(originalIndex, 'account_id', e.target.value)}
                              style={{ ...smallSelectStyle, width: '170px' }}
                            >
                              <option value="">Select account</option>
                              {accounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={tdStyle}>
                            <input
                              type="number"
                              step="any"
                              value={row.quantity ?? ''}
                              onChange={(e) => updatePreviewRow(originalIndex, 'quantity', e.target.value)}
                              style={{ ...smallInputStyle, width: '110px' }}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              type="number"
                              step="any"
                              value={row.unit_price ?? ''}
                              onChange={(e) => updatePreviewRow(originalIndex, 'unit_price', e.target.value)}
                              style={{ ...smallInputStyle, width: '110px' }}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              type="number"
                              step="any"
                              value={row.fee ?? 0}
                              onChange={(e) => updatePreviewRow(originalIndex, 'fee', e.target.value)}
                              style={{ ...smallInputStyle, width: '90px' }}
                            />
                          </td>
                          <td style={tdStyle}>{formatMoney(estimate)}</td>
                          <td style={tdStyle}>{row.source_name}</td>
                          <td style={tdStyle}>
                            <button
                              type="button"
                              onClick={() => removePreviewRow(originalIndex)}
                              style={dangerButtonStyle}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Skipped Rows</h2>

            {skippedRows.length === 0 ? (
              <p>No skipped rows.</p>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {skippedRows.slice(0, 30).map((item, index) => (
                  <div key={`${item.rowNumber}-${index}`} style={skippedRowStyle}>
                    <div><strong>Row {item.rowNumber}</strong></div>
                    <div style={{ color: 'var(--danger)', marginTop: '6px' }}>{item.reason}</div>
                  </div>
                ))}
                {skippedRows.length > 30 && (
                  <div style={helperTextStyle}>
                    Showing first 30 skipped rows only.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const headerRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  marginBottom: '24px'
}

const statsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '16px',
  marginTop: '16px'
}

const mainGridStyle = {
  display: 'grid',
  gridTemplateColumns: '360px minmax(0, 1fr)',
  gap: '24px',
  marginTop: '24px',
  alignItems: 'start'
}

const statCardStyle = {
  background: 'var(--bg-card)',
  padding: '18px',
  borderRadius: '12px',
  border: '1px solid var(--border-main)',
  minWidth: 0
}

const statLabelStyle = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  marginBottom: '10px'
}

const statValueStyle = {
  fontSize: '28px',
  fontWeight: 700,
  color: 'var(--text-main)'
}

const previewHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  marginBottom: '16px',
  flexWrap: 'wrap'
}

const filterRowStyle = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap'
}

const filterButtonStyle = {
  padding: '8px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  cursor: 'pointer'
}

const activeFilterButtonStyle = {
  ...filterButtonStyle,
  background: 'var(--accent-strong)',
  border: '1px solid var(--accent-strong)',
  color: 'white'
}


const previewToolbarStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '14px',
  flexWrap: 'wrap'
}

const paginationControlsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap'
}

const pageSizeSelectStyle = {
  padding: '8px 10px',
  borderRadius: '8px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  fontSize: '13px'
}

const smallButtonStyle = {
  padding: '8px 10px',
  borderRadius: '8px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 700
}

const disabledSmallButtonStyle = {
  ...smallButtonStyle,
  opacity: 0.45,
  cursor: 'not-allowed'
}

const pageTextStyle = {
  color: 'var(--text-muted)',
  fontSize: '13px',
  minWidth: '84px',
  textAlign: 'center'
}

const previewTableShellStyle = {
  overflow: 'auto',
  maxHeight: '620px',
  border: '1px solid var(--border-main)',
  borderRadius: '12px'
}

const messageStyle = {
  marginTop: '16px',
  padding: '12px',
  borderRadius: '10px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-main)'
}

const cardStyle = {
  background: 'var(--bg-card)',
  padding: '20px',
  borderRadius: '12px',
  border: '1px solid var(--border-main)',
  minWidth: 0
}

const fieldStyle = {
  marginBottom: '16px'
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px'
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)'
}

const fileInputStyle = {
  width: '100%',
  padding: '10px 0',
  color: 'var(--text-main)'
}

const helperTextStyle = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  lineHeight: 1.45,
  marginTop: '6px'
}

const buttonStyle = {
  width: '100%',
  padding: '12px',
  border: 'none',
  borderRadius: '8px',
  background: 'var(--accent-strong)',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 700
}

const secondaryButtonStyle = {
  ...buttonStyle,
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)',
  color: 'var(--text-main)'
}

const disabledButtonStyle = {
  ...buttonStyle,
  opacity: 0.55,
  cursor: 'not-allowed'
}

const dangerButtonStyle = {
  padding: '7px 10px',
  borderRadius: '8px',
  border: '1px solid var(--danger)',
  background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
  color: 'var(--danger)',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 700
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  minWidth: '1320px'
}

const thStyle = {
  textAlign: 'left',
  padding: '12px',
  borderBottom: '1px solid var(--border-main)',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: '14px',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--bg-card-soft)'
}

const tdStyle = {
  padding: '10px',
  borderBottom: '1px solid var(--border-main)',
  color: 'var(--text-main)',
  fontSize: '14px',
  whiteSpace: 'nowrap',
  verticalAlign: 'top'
}

const smallInputStyle = {
  width: '130px',
  padding: '8px 10px',
  borderRadius: '8px',
  border: '1px solid var(--border-main)',
  background: 'var(--bg-card-soft)',
  color: 'var(--text-main)',
  fontSize: '13px'
}

const smallSelectStyle = {
  ...smallInputStyle,
  width: '120px'
}

const skippedRowStyle = {
  padding: '12px',
  borderRadius: '10px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)'
}

const historyItemStyle = {
  padding: '12px',
  borderRadius: '10px',
  background: 'var(--bg-card-soft)',
  border: '1px solid var(--border-main)'
}

const recentImportsShellStyle = {
  display: 'grid',
  gap: '12px',
  maxHeight: '420px',
  overflowY: 'auto',
  paddingRight: '4px'
}

const historyFileNameStyle = {
  fontWeight: 700,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  lineHeight: 1.25
}

const historySubText = {
  color: 'var(--text-muted)',
  fontSize: '13px',
  marginTop: '4px'
}

const newBadgeStyle = {
  display: 'inline-block',
  padding: '4px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--success)',
  background: 'color-mix(in srgb, var(--success) 12%, transparent)',
  border: '1px solid var(--success)'
}

const duplicateBadgeStyle = {
  display: 'inline-block',
  padding: '4px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--warning)',
  background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  border: '1px solid var(--warning)'
}

const reviewBadgeStyle = {
  display: 'inline-block',
  padding: '4px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--warning)',
  background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  border: '1px solid var(--warning)'
}

const checkBadgeStyle = {
  display: 'inline-block',
  padding: '4px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--accent-strong)',
  background: 'color-mix(in srgb, var(--accent-strong) 12%, transparent)',
  border: '1px solid var(--accent-strong)'
}

const errorTextStyle = {
  color: 'var(--danger)',
  fontSize: '11px',
  marginTop: '6px',
  whiteSpace: 'normal',
  maxWidth: '180px',
  lineHeight: 1.35
}
