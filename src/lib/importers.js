import Papa from 'papaparse'

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/_/g, ' ')
    .replace(/"/g, '')
}

function getValue(row, candidates) {
  const keys = Object.keys(row || {})
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeHeader(candidate)
    const match = keys.find((key) => normalizeHeader(key) === normalizedCandidate)
    if (match) return row[match]
  }
  return undefined
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null

  let cleaned = String(value).trim()
  if (!cleaned || cleaned === '--') return null

  const isNegativeByParens = cleaned.startsWith('(') && cleaned.endsWith(')')

  cleaned = cleaned
    .replace(/[,$]/g, '')
    .replace(/[()]/g, '')
    .trim()

  const num = Number(cleaned)
  if (Number.isNaN(num)) return null

  return isNegativeByParens ? -num : num
}

function toUpperSafe(value) {
  return String(value || '').trim().toUpperCase()
}

function normalizeDate(value) {
  if (!value) return ''

  const raw = String(value).trim()
  if (!raw) return ''

  if (raw.includes('T')) {
    const isoDatePart = raw.split('T')[0]
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoDatePart)) return isoDatePart
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10)
  }

  const commaSplit = raw.split(',')
  const datePart = commaSplit[0]?.trim() || raw

  if (datePart.includes('/')) {
    const parts = datePart.split('/').map((p) => p.trim())
    if (parts.length === 3) {
      const [m, d, y] = parts
      if (y.length === 4) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      }
    }
  }

  const d = new Date(raw)
  if (!Number.isNaN(d.getTime())) {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  return ''
}

function parseRobinhoodType(rawType = '') {
  const v = String(rawType).trim().toLowerCase()

  if (v.includes('buy')) return 'buy'
  if (v.includes('sell')) return 'sell'
  if (v.includes('dividend')) return 'dividend'
  if (v.includes('interest')) return 'interest'
  if (v.includes('fee')) return 'fee'

  return null
}

function normalizeKrakenSymbol(value) {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) return ''

  const base = raw.includes('/') ? raw.split('/')[0] : raw

  return base
    .replace(/^XBT$/, 'BTC')
    .replace(/^XXBT$/, 'BTC')
    .replace(/^XETH$/, 'ETH')
    .replace(/^ZUSD$/, 'USD')
    .replace(/^USD$/, 'USD')
}

function symbolFromPair(pair) {
  return normalizeKrakenSymbol(pair)
}

function inferAssetType(symbol, sourceName = '') {
  const s = String(symbol || '').toUpperCase()
  const source = String(sourceName || '').toLowerCase()

  const knownCrypto = [
    'BTC', 'XBT', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA',
    'LINK', 'LTC', 'AVAX', 'DOT', 'ATOM', 'MATIC', 'SUI',
    'PAXG', 'GRT', 'TRX', 'SEI', 'USDG', 'USDC', 'USDT',
    'TAO', 'RENDER', 'XLM', 'PEPE', 'PUMP', 'NEAR', 'BABY'
  ]

  if (knownCrypto.includes(s)) return 'crypto'

  // Kraken CSV mặc định là crypto nếu không chắc
  if (source.includes('kraken')) return 'crypto'

  return 'stock'
}
export function parseCsvText(fileText) {
  return Papa.parse(fileText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => String(header || '').trim().replace(/^"|"$/g, '')
  })
}

export function buildTransactionHash(row) {
  return [
    row.transaction_date,
    row.symbol,
    row.type,
    row.quantity,
    row.unit_price
  ].join('|')
}

export function detectCsvSource(rows = []) {
  if (!rows.length) return null

  const headers = Object.keys(rows[0]).map((h) => normalizeHeader(h))

  if (
    headers.includes('time entered') &&
    headers.includes('side') &&
    headers.includes('average price')
  ) {
    return 'robinhood'
  }

  if (
    headers.includes('txid') &&
    headers.includes('ordertxid') &&
    headers.includes('pair') &&
    headers.includes('vol')
  ) {
    return 'kraken'
  }

  if (
    headers.includes('txid') &&
    headers.includes('refid') &&
    headers.includes('asset') &&
    headers.includes('amount') &&
    headers.includes('amountusd')
  ) {
    return 'kraken'
  }

  if (
    headers.includes('received quantity') &&
    headers.includes('sent quantity')
  ) {
    return 'kraken'
  }

  return null
}

export function normalizeRobinhoodRows(rows = []) {
  const normalized = []
  const skipped = []

  rows.forEach((row, index) => {
    const rowNumber = index + 2

    const rawState = getValue(row, ['state', 'status']) || ''
    const state = String(rawState).trim().toLowerCase()

    if (state && state !== 'filled') {
      skipped.push({
        rowNumber,
        reason: `Skipped non-filled order: ${rawState}`,
        raw: row
      })
      return
    }

    const rawType =
      getValue(row, ['side', 'action', 'type', 'transaction type', 'activity type']) || ''

    const type = parseRobinhoodType(rawType)

    const symbol = toUpperSafe(
      getValue(row, ['symbol', 'ticker', 'instrument', 'asset'])
    )

    const transactionDate = normalizeDate(
      getValue(row, [
        'time entered',
        'date',
        'activity date',
        'process date',
        'settlement date',
        'created at',
        'created_at',
        'updated_at',
        'timestamp',
        'time'
      ])
    )

    const quantity = toNumber(
      getValue(row, ['quantity', 'shares', 'filled quantity'])
    )

    const unitPrice = toNumber(
      getValue(row, ['average price', 'price', 'filled price', 'unit price', 'entered price'])
    )

    const fee = toNumber(getValue(row, ['fee', 'fees'])) ?? 0
    const displayName = getValue(row, ['description', 'name', 'instrument name']) || symbol

    if (!type) {
      skipped.push({ rowNumber, reason: 'Unsupported or missing transaction type', raw: row })
      return
    }

    if (!symbol) {
      skipped.push({ rowNumber, reason: 'Missing symbol', raw: row })
      return
    }

    if (!transactionDate) {
      skipped.push({ rowNumber, reason: 'Missing or invalid date', raw: row })
      return
    }

    if ((type === 'buy' || type === 'sell') && (!quantity || !unitPrice)) {
      skipped.push({ rowNumber, reason: 'Buy/Sell row missing quantity or average price', raw: row })
      return
    }

    normalized.push({
      transaction_date: transactionDate,
      symbol,
      display_name: displayName,
asset_type: inferAssetType(symbol, 'Robinhood'),
      type,
      quantity,
      unit_price: unitPrice,
      fee,
      source_name: 'Robinhood'
    })
  })

  return { normalized, skipped }
}

function normalizeKrakenSpotTradeRows(rows = []) {
  const normalized = []
  const skipped = []

  rows.forEach((row, index) => {
    const rowNumber = index + 2

    const rawType = String(getValue(row, ['type']) || '').trim().toLowerCase()
    const transactionDate = normalizeDate(getValue(row, ['time', 'date']))
    const symbol = symbolFromPair(getValue(row, ['pair']))

    const quantity = Math.abs(toNumber(getValue(row, ['vol', 'volume', 'quantity'])) || 0)
    const price = toNumber(getValue(row, ['price']))
    const cost = Math.abs(toNumber(getValue(row, ['cost', 'costusd'])) || 0)
    const fee = Math.abs(toNumber(getValue(row, ['fee', 'cfee'])) || 0)

    const unitPrice = price || (cost && quantity ? cost / quantity : null)

    if (!['buy', 'sell'].includes(rawType)) {
      skipped.push({ rowNumber, reason: `Skipped unsupported Kraken spot type: ${rawType || 'unknown'}`, raw: row })
      return
    }

    if (!transactionDate) {
      skipped.push({ rowNumber, reason: 'Missing or invalid date', raw: row })
      return
    }

    if (!symbol || symbol === 'USD') {
      skipped.push({ rowNumber, reason: 'Missing or unsupported symbol', raw: row })
      return
    }

    if (!quantity || !unitPrice) {
      skipped.push({ rowNumber, reason: 'Spot trade missing quantity or price', raw: row })
      return
    }

    normalized.push({
      transaction_date: transactionDate,
      symbol,
      display_name: symbol,
asset_type: inferAssetType(symbol, 'Kraken'),
      type: rawType,
      quantity,
      unit_price: unitPrice,
      fee,
      source_name: 'Kraken'
    })
  })

  return { normalized, skipped }
}

function normalizeKrakenTaxRows(rows = []) {
  const normalized = []
  const skipped = []

  rows.forEach((row, index) => {
    const rowNumber = index + 2

    const rawType = String(getValue(row, ['type']) || '').trim().toLowerCase()
    const transactionDate = normalizeDate(getValue(row, ['date', 'time', 'created at', 'created_at']))

    if (!transactionDate) {
      skipped.push({ rowNumber, reason: 'Missing or invalid date', raw: row })
      return
    }

    if (rawType === 'trade') {
      const receivedQty = Math.abs(toNumber(getValue(row, ['received quantity'])) || 0)
      const receivedCurrency = normalizeKrakenSymbol(getValue(row, ['received currency']))
      const receivedCostBasis = Math.abs(toNumber(getValue(row, ['received cost basis (usd)', 'received cost basis'])) || 0)

      const sentQty = Math.abs(toNumber(getValue(row, ['sent quantity'])) || 0)
      const sentCurrency = normalizeKrakenSymbol(getValue(row, ['sent currency']))
      const sentCostBasis = Math.abs(toNumber(getValue(row, ['sent cost basis (usd)', 'sent cost basis'])) || 0)

      const fee = Math.abs(toNumber(getValue(row, ['fee amount', 'fee'])) || 0)

      if (receivedQty && receivedCurrency && receivedCurrency !== 'USD' && sentCurrency === 'USD') {
        const symbol = receivedCurrency
        const unitPrice = receivedCostBasis
          ? receivedCostBasis / receivedQty
          : sentQty
            ? sentQty / receivedQty
            : null

        if (!unitPrice) {
          skipped.push({ rowNumber, reason: 'Kraken trade buy missing usable price', raw: row })
          return
        }

        normalized.push({
          transaction_date: transactionDate,
          symbol,
          display_name: symbol,
asset_type: inferAssetType(symbol, 'Kraken'),
          type: 'buy',
          quantity: receivedQty,
          unit_price: unitPrice,
          fee,
          source_name: 'Kraken'
        })
        return
      }

      if (sentQty && sentCurrency && sentCurrency !== 'USD' && receivedCurrency === 'USD') {
        const symbol = sentCurrency
        const unitPrice = receivedQty ? receivedQty / sentQty : sentCostBasis ? sentCostBasis / sentQty : null

        if (!unitPrice) {
          skipped.push({ rowNumber, reason: 'Kraken trade sell missing usable price', raw: row })
          return
        }

        normalized.push({
          transaction_date: transactionDate,
          symbol,
          display_name: symbol,
asset_type: inferAssetType(symbol, 'Kraken'),
          type: 'sell',
          quantity: sentQty,
          unit_price: unitPrice,
          fee,
          source_name: 'Kraken'
        })
        return
      }

      skipped.push({ rowNumber, reason: 'Unsupported Kraken trade row shape', raw: row })
      return
    }

    if (rawType === 'income' || rawType === 'earn' || rawType === 'reward') {
      const qty = Math.abs(toNumber(getValue(row, ['received quantity', 'amount'])) || 0)
      const symbol = normalizeKrakenSymbol(getValue(row, ['received currency', 'asset']))
      const costBasis = Math.abs(toNumber(getValue(row, ['received cost basis (usd)', 'received cost basis', 'amountusd'])) || 0)
      const fee = Math.abs(toNumber(getValue(row, ['fee amount', 'fee'])) || 0)

      if (!qty || !symbol || symbol === 'USD') {
        skipped.push({ rowNumber, reason: 'Kraken income row missing quantity or symbol', raw: row })
        return
      }

      normalized.push({
        transaction_date: transactionDate,
        symbol,
        display_name: symbol,
asset_type: inferAssetType(symbol, 'Kraken'),
        type: 'interest',
        quantity: Math.max(qty - fee, 0) || qty,
        unit_price: costBasis && qty ? costBasis / qty : 0,
        fee,
        source_name: 'Kraken'
      })
      return
    }

    skipped.push({
      rowNumber,
      reason: `Skipped unsupported Kraken type: ${rawType || 'unknown'}`,
      raw: row
    })
  })

  return { normalized, skipped }
}

function normalizeKrakenLedgerRows(rows = []) {
  const normalized = []
  const skipped = []

  const groups = {}

  rows.forEach((row, index) => {
    const refid = String(getValue(row, ['refid']) || '').trim()
    const type = String(getValue(row, ['type']) || '').trim().toLowerCase()

    if (type === 'earn' || type === 'reward') {
      const rowNumber = index + 2
      const transactionDate = normalizeDate(getValue(row, ['time', 'date']))
      const symbol = normalizeKrakenSymbol(getValue(row, ['asset']))
      const amount = Math.abs(toNumber(getValue(row, ['amount'])) || 0)
      const fee = Math.abs(toNumber(getValue(row, ['fee'])) || 0)
      const amountUsd = Math.abs(toNumber(getValue(row, ['amountusd'])) || 0)

      if (!transactionDate || !symbol || symbol === 'USD' || !amount) {
        skipped.push({ rowNumber, reason: 'Kraken earn row missing date, symbol, or amount', raw: row })
        return
      }

      normalized.push({
        transaction_date: transactionDate,
        symbol,
        display_name: symbol,
asset_type: inferAssetType(symbol, 'Kraken'),
        type: 'interest',
        quantity: Math.max(amount - fee, 0) || amount,
        unit_price: amountUsd && amount ? amountUsd / amount : 0,
        fee,
        source_name: 'Kraken'
      })
      return
    }

    if (!refid) {
      skipped.push({
        rowNumber: index + 2,
        reason: 'Kraken ledger row missing refid',
        raw: row
      })
      return
    }

    if (!groups[refid]) groups[refid] = []
    groups[refid].push({ row, rowNumber: index + 2 })
  })

  Object.entries(groups).forEach(([refid, group]) => {
    const first = group[0]
    const rowsInGroup = group.map((g) => g.row)
    const rowNumber = first.rowNumber

    const types = rowsInGroup.map((row) => String(getValue(row, ['type']) || '').toLowerCase())
    const hasTradeLike = types.some((t) => ['trade', 'spend', 'receive'].includes(t))

    if (!hasTradeLike) {
      rowsInGroup.forEach((row, i) => {
        skipped.push({
          rowNumber: group[i].rowNumber,
          reason: `Skipped Kraken ledger type: ${getValue(row, ['type']) || 'unknown'}`,
          raw: row
        })
      })
      return
    }

    const transactionDate = normalizeDate(getValue(first.row, ['time', 'date']))

    const nonUsdRows = rowsInGroup.filter((row) => {
      const asset = normalizeKrakenSymbol(getValue(row, ['asset']))
      return asset && asset !== 'USD'
    })

    const usdRows = rowsInGroup.filter((row) => {
      const asset = normalizeKrakenSymbol(getValue(row, ['asset']))
      return asset === 'USD'
    })

    const cryptoPositive = nonUsdRows.find((row) => Number(toNumber(getValue(row, ['amount'])) || 0) > 0)
    const cryptoNegative = nonUsdRows.find((row) => Number(toNumber(getValue(row, ['amount'])) || 0) < 0)

    const usdPositive = usdRows.find((row) => Number(toNumber(getValue(row, ['amount'])) || 0) > 0)
    const usdNegative = usdRows.find((row) => Number(toNumber(getValue(row, ['amount'])) || 0) < 0)

    if (!transactionDate) {
      skipped.push({ rowNumber, reason: 'Kraken ledger group missing date', raw: first.row })
      return
    }

    if (cryptoPositive && usdNegative) {
      const symbol = normalizeKrakenSymbol(getValue(cryptoPositive, ['asset']))
      const grossQty = Math.abs(toNumber(getValue(cryptoPositive, ['amount'])) || 0)
      const cryptoFee = Math.abs(toNumber(getValue(cryptoPositive, ['fee'])) || 0)
      const quantity = Math.max(grossQty - cryptoFee, 0) || grossQty

      const usdAmount =
        Math.abs(toNumber(getValue(usdNegative, ['amountusd'])) || 0) ||
        Math.abs(toNumber(getValue(usdNegative, ['amount'])) || 0) ||
        Math.abs(toNumber(getValue(cryptoPositive, ['amountusd'])) || 0)

      const unitPrice = usdAmount && quantity ? usdAmount / quantity : null

      if (!symbol || !quantity || !unitPrice) {
        skipped.push({ rowNumber, reason: 'Kraken ledger buy missing symbol, quantity, or price', raw: first.row })
        return
      }

      normalized.push({
        transaction_date: transactionDate,
        symbol,
        display_name: symbol,
asset_type: inferAssetType(symbol, 'Kraken'),
        type: 'buy',
        quantity,
        unit_price: unitPrice,
        fee: cryptoFee,
        source_name: 'Kraken'
      })
      return
    }

    if (cryptoNegative && usdPositive) {
      const symbol = normalizeKrakenSymbol(getValue(cryptoNegative, ['asset']))
      const quantity = Math.abs(toNumber(getValue(cryptoNegative, ['amount'])) || 0)
      const fee = Math.abs(toNumber(getValue(cryptoNegative, ['fee'])) || 0)

      const usdAmount =
        Math.abs(toNumber(getValue(usdPositive, ['amountusd'])) || 0) ||
        Math.abs(toNumber(getValue(usdPositive, ['amount'])) || 0)

      const unitPrice = usdAmount && quantity ? usdAmount / quantity : null

      if (!symbol || !quantity || !unitPrice) {
        skipped.push({ rowNumber, reason: 'Kraken ledger sell missing symbol, quantity, or price', raw: first.row })
        return
      }

      normalized.push({
        transaction_date: transactionDate,
        symbol,
        display_name: symbol,
asset_type: inferAssetType(symbol, 'Kraken'),
        type: 'sell',
        quantity,
        unit_price: unitPrice,
        fee,
        source_name: 'Kraken'
      })
      return
    }

    rowsInGroup.forEach((row, i) => {
      skipped.push({
        rowNumber: group[i].rowNumber,
        reason: `Skipped Kraken ledger group ${refid}: no supported buy/sell pair`,
        raw: row
      })
    })
  })

  return { normalized, skipped }
}

export function normalizeKrakenRows(rows = []) {
  if (!rows.length) return { normalized: [], skipped: [] }

  const headers = Object.keys(rows[0]).map((h) => normalizeHeader(h))

  if (
    headers.includes('txid') &&
    headers.includes('ordertxid') &&
    headers.includes('pair') &&
    headers.includes('vol')
  ) {
    return normalizeKrakenSpotTradeRows(rows)
  }

  if (
    headers.includes('txid') &&
    headers.includes('refid') &&
    headers.includes('asset') &&
    headers.includes('amount') &&
    headers.includes('amountusd')
  ) {
    return normalizeKrakenLedgerRows(rows)
  }

  if (
    headers.includes('received quantity') &&
    headers.includes('sent quantity')
  ) {
    return normalizeKrakenTaxRows(rows)
  }

  return {
    normalized: [],
    skipped: rows.map((row, index) => ({
      rowNumber: index + 2,
      reason: 'Unsupported Kraken CSV format',
      raw: row
    }))
  }
}

export function normalizeRowsBySource(source, rows) {
  if (source === 'robinhood') {
    return normalizeRobinhoodRows(rows)
  }

  if (source === 'kraken') {
    return normalizeKrakenRows(rows)
  }

  return {
    normalized: [],
    skipped: [{ rowNumber: 0, reason: 'Unsupported source', raw: {} }]
  }
}