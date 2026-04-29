import { useEffect, useMemo, useState } from 'react'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import { calculateHoldings, calculatePortfolioSummary } from '../lib/holdings'
import { supabase } from '../lib/supabase'

const BUY_TYPES = new Set(['buy', 'deposit'])
const SELL_TYPES = new Set(['sell', 'withdraw'])
const INCOME_TYPES = new Set(['dividend', 'interest'])

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function formatMoney(value) {
  return toNumber(value).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatPrice(value) {
  const n = toNumber(value)
  if (n > 0 && n < 1) {
    return n.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 8
    })
  }
  return formatMoney(n)
}

function formatPercent(value) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`
}

function formatQuantity(value) {
  return toNumber(value).toLocaleString(undefined, { maximumFractionDigits: 8 })
}

function getDateKey(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function getMonthKey(value) {
  return getDateKey(value).slice(0, 7)
}

function getPnlTone(value) {
  const n = toNumber(value)
  if (n > 0) return 'success'
  if (n < 0) return 'danger'
  return 'default'
}

function getPnlColor(value) {
  const n = toNumber(value)
  if (n > 0) return '#22c55e'
  if (n < 0) return '#ef4444'
  return '#f9fafb'
}

function getAssetKey(tx) {
  return tx.asset_id || tx.assets?.id || `unknown-${normalizeText(tx.assets?.symbol || tx.id)}`
}

function getAccountKey(tx) {
  return tx.account_id || 'unassigned'
}

function getAccountName(tx, accountMap) {
  return accountMap[tx.account_id] || 'Unassigned'
}

function getSymbol(tx) {
  return tx.assets?.symbol || 'Unknown'
}

function getTransactionCashValue(tx) {
  const quantity = Math.abs(toNumber(tx.quantity))
  const unitPrice = Math.abs(toNumber(tx.unit_price))
  const fee = Math.abs(toNumber(tx.fee))
  if (quantity > 0 && unitPrice > 0) return quantity * unitPrice + fee
  return 0
}

function getIncomeAmount(tx) {
  const quantity = Math.abs(toNumber(tx.quantity))
  const unitPrice = Math.abs(toNumber(tx.unit_price))
  const fee = Math.abs(toNumber(tx.fee))
  if (quantity > 0 && unitPrice > 0) return Math.max(quantity * unitPrice - fee, 0)
  return 0
}

function getBuyCost(tx) {
  const quantity = Math.abs(toNumber(tx.quantity))
  const unitPrice = Math.abs(toNumber(tx.unit_price))
  const fee = Math.abs(toNumber(tx.fee))
  if (quantity > 0 && unitPrice > 0) return quantity * unitPrice + fee
  return 0
}

function getSellProceeds(tx) {
  const quantity = Math.abs(toNumber(tx.quantity))
  const unitPrice = Math.abs(toNumber(tx.unit_price))
  const fee = Math.abs(toNumber(tx.fee))
  if (quantity > 0 && unitPrice > 0) return Math.max(quantity * unitPrice - fee, 0)
  return 0
}

function sortRows(rows, sortMode) {
  const copy = [...rows]
  if (sortMode === 'totalReturnDesc') return copy.sort((a, b) => b.totalReturn - a.totalReturn)
  if (sortMode === 'totalReturnAsc') return copy.sort((a, b) => a.totalReturn - b.totalReturn)
  if (sortMode === 'realizedDesc') return copy.sort((a, b) => b.realizedPL - a.realizedPL)
  if (sortMode === 'realizedAsc') return copy.sort((a, b) => a.realizedPL - b.realizedPL)
  if (sortMode === 'unrealizedDesc') return copy.sort((a, b) => b.unrealizedPL - a.unrealizedPL)
  if (sortMode === 'unrealizedAsc') return copy.sort((a, b) => a.unrealizedPL - b.unrealizedPL)
  if (sortMode === 'dividendDesc') return copy.sort((a, b) => b.dividendIncome - a.dividendIncome)
  if (sortMode === 'marketValueDesc') return copy.sort((a, b) => b.marketValue - a.marketValue)
  return copy.sort((a, b) => a.symbol.localeCompare(b.symbol))
}

function buildAccountNameMap(accounts) {
  const map = {}
  for (const account of accounts || []) map[account.id] = account.name || 'Unnamed account'
  return map
}

function getCurrentYear() {
  return new Date().getFullYear().toString()
}

function getYearsFromTransactions(transactions) {
  const years = new Set()
  for (const tx of transactions || []) {
    const year = getDateKey(tx.transaction_date).slice(0, 4)
    if (year) years.add(year)
  }
  return Array.from(years).sort((a, b) => b.localeCompare(a))
}

function buildRealizedFifoRows(transactions, accountMap) {
  const groups = new Map()
  const warnings = []
  const sorted = [...(transactions || [])].sort((a, b) => {
    const aKey = `${getDateKey(a.transaction_date)} ${a.created_at || ''}`
    const bKey = `${getDateKey(b.transaction_date)} ${b.created_at || ''}`
    return aKey.localeCompare(bKey)
  })

  for (const tx of sorted) {
    const type = normalizeText(tx.type)
    if (!BUY_TYPES.has(type) && !SELL_TYPES.has(type)) continue

    const assetKey = getAssetKey(tx)
    const accountKey = getAccountKey(tx)
    const groupKey = `${accountKey}::${assetKey}`

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        assetKey,
        accountKey,
        symbol: getSymbol(tx),
        displayName: tx.assets?.display_name || getSymbol(tx),
        assetType: tx.assets?.asset_type || 'unknown',
        accountName: getAccountName(tx, accountMap),
        lots: [],
        realizedRows: []
      })
    }

    const group = groups.get(groupKey)
    const quantity = Math.abs(toNumber(tx.quantity))
    if (quantity <= 0) continue

    if (BUY_TYPES.has(type)) {
      const totalCost = getBuyCost(tx)
      if (totalCost <= 0) continue
      group.lots.push({
        id: tx.id,
        date: getDateKey(tx.transaction_date),
        originalQuantity: quantity,
        remainingQuantity: quantity,
        costPerUnit: totalCost / quantity
      })
    }

    if (SELL_TYPES.has(type)) {
      const proceeds = getSellProceeds(tx)
      const proceedsPerUnit = quantity > 0 ? proceeds / quantity : 0
      let remainingToSell = quantity
      let matchedQuantity = 0
      let costBasis = 0
      const matchedLots = []

      for (const lot of group.lots) {
        if (remainingToSell <= 0) break
        if (lot.remainingQuantity <= 0) continue
        const consumeQuantity = Math.min(remainingToSell, lot.remainingQuantity)
        const consumeCost = consumeQuantity * lot.costPerUnit
        lot.remainingQuantity -= consumeQuantity
        remainingToSell -= consumeQuantity
        matchedQuantity += consumeQuantity
        costBasis += consumeCost
        matchedLots.push({ date: lot.date, quantity: consumeQuantity, costPerUnit: lot.costPerUnit })
      }

      const unmatchedQuantity = Math.max(remainingToSell, 0)
      const matchedProceeds = matchedQuantity * proceedsPerUnit
      const realizedPL = matchedProceeds - costBasis

      if (unmatchedQuantity > 0.00000001) {
        warnings.push({
          id: `${tx.id}-unmatched`,
          date: getDateKey(tx.transaction_date),
          symbol: group.symbol,
          accountName: group.accountName,
          detail: `Sell quantity ${formatQuantity(quantity)} exceeded available FIFO lots by ${formatQuantity(unmatchedQuantity)}.`
        })
      }

      group.realizedRows.push({
        id: tx.id,
        transactionDate: getDateKey(tx.transaction_date),
        yearKey: getDateKey(tx.transaction_date).slice(0, 4),
        monthKey: getMonthKey(tx.transaction_date),
        assetKey,
        accountKey,
        symbol: group.symbol,
        displayName: group.displayName,
        assetType: group.assetType,
        accountName: group.accountName,
        quantity,
        matchedQuantity,
        unmatchedQuantity,
        proceeds,
        matchedProceeds,
        costBasis,
        realizedPL,
        realizedPLPercent: costBasis > 0 ? (realizedPL / costBasis) * 100 : 0,
        matchedLots
      })
    }
  }

  const rows = []
  for (const group of groups.values()) rows.push(...group.realizedRows)
  return { rows: rows.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)), warnings }
}

export default function PnLCenterPage() {
  const [transactions, setTransactions] = useState([])
  const [priceQuotes, setPriceQuotes] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [accountFilter, setAccountFilter] = useState('all')
  const [assetTypeFilter, setAssetTypeFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [sortMode, setSortMode] = useState('totalReturnDesc')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setMessage('')

    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser()

      if (userError || !user) throw new Error('Unable to get current user')

      const [accountsResult, txResult, quoteResult] = await Promise.all([
        supabase.from('accounts').select('*').eq('user_id', user.id).order('name', { ascending: true }),
        supabase
          .from('investment_transactions')
          .select(`
            id,
            user_id,
            account_id,
            asset_id,
            transaction_date,
            type,
            quantity,
            unit_price,
            fee,
            created_at,
            assets ( id, symbol, display_name, asset_type, is_price_locked, locked_price )
          `)
          .eq('user_id', user.id)
          .order('transaction_date', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase.from('price_quotes').select('*').order('created_at', { ascending: false })
      ])

      if (accountsResult.error) throw accountsResult.error
      if (txResult.error) throw txResult.error
      if (quoteResult.error) throw quoteResult.error

      setAccounts(accountsResult.data || [])
      setTransactions(txResult.data || [])
      setPriceQuotes(quoteResult.data || [])
    } catch (error) {
      console.error('PnLCenterPage loadData error:', error)
      setMessage(error.message || 'Failed to load P&L Center data')
    }

    setLoading(false)
  }

  const accountNameMap = useMemo(() => buildAccountNameMap(accounts), [accounts])
  const availableYears = useMemo(() => getYearsFromTransactions(transactions), [transactions])

  const assetTypes = useMemo(() => {
    const types = new Set()
    for (const tx of transactions || []) types.add(tx.assets?.asset_type || 'unknown')
    return Array.from(types).sort((a, b) => a.localeCompare(b))
  }, [transactions])

  const baseFilteredTransactions = useMemo(() => {
    let rows = [...transactions]

    if (accountFilter !== 'all') {
      rows = accountFilter === 'unassigned'
        ? rows.filter((tx) => !tx.account_id)
        : rows.filter((tx) => tx.account_id === accountFilter)
    }

    if (assetTypeFilter !== 'all') {
      rows = rows.filter((tx) => (tx.assets?.asset_type || 'unknown') === assetTypeFilter)
    }

    if (searchText.trim()) {
      const q = normalizeText(searchText)
      rows = rows.filter((tx) => {
        const symbol = normalizeText(tx.assets?.symbol)
        const name = normalizeText(tx.assets?.display_name)
        const accountName = normalizeText(accountNameMap[tx.account_id])
        return symbol.includes(q) || name.includes(q) || accountName.includes(q)
      })
    }

    return rows
  }, [accountFilter, accountNameMap, assetTypeFilter, searchText, transactions])

  const holdings = useMemo(() => calculateHoldings(baseFilteredTransactions, priceQuotes), [baseFilteredTransactions, priceQuotes])
  const summary = useMemo(() => calculatePortfolioSummary(holdings), [holdings])

  const incomeTransactions = useMemo(() => {
    return baseFilteredTransactions
      .filter((tx) => INCOME_TYPES.has(normalizeText(tx.type)))
      .map((tx) => ({
        ...tx,
        incomeAmount: getIncomeAmount(tx),
        yearKey: getDateKey(tx.transaction_date).slice(0, 4),
        monthKey: getMonthKey(tx.transaction_date),
        symbol: getSymbol(tx),
        accountName: getAccountName(tx, accountNameMap)
      }))
  }, [accountNameMap, baseFilteredTransactions])

  const filteredIncomeTransactions = useMemo(() => {
    if (yearFilter === 'all') return incomeTransactions
    return incomeTransactions.filter((tx) => tx.yearKey === yearFilter)
  }, [incomeTransactions, yearFilter])

  const fifoResult = useMemo(() => buildRealizedFifoRows(baseFilteredTransactions, accountNameMap), [accountNameMap, baseFilteredTransactions])
  const realizedRows = useMemo(() => {
    if (yearFilter === 'all') return fifoResult.rows
    return fifoResult.rows.filter((row) => row.yearKey === yearFilter)
  }, [fifoResult.rows, yearFilter])

  const dividendsByAsset = useMemo(() => {
    const map = {}
    for (const tx of filteredIncomeTransactions) {
      const assetKey = getAssetKey(tx)
      map[assetKey] = toNumber(map[assetKey]) + tx.incomeAmount
    }
    return map
  }, [filteredIncomeTransactions])

  const realizedByAsset = useMemo(() => {
    const map = {}
    for (const row of realizedRows) map[row.assetKey] = toNumber(map[row.assetKey]) + row.realizedPL
    return map
  }, [realizedRows])

  const pnlRows = useMemo(() => {
    const map = new Map()

    for (const holding of holdings) {
      const assetKey = holding.asset_id
      const dividendIncome = toNumber(dividendsByAsset[assetKey])
      const realizedPL = toNumber(realizedByAsset[assetKey])
      const totalReturn = toNumber(holding.unrealized_pl) + dividendIncome + realizedPL
      const totalReturnPercent = holding.cost_basis > 0 ? (totalReturn / holding.cost_basis) * 100 : 0

      map.set(assetKey, {
        assetId: assetKey,
        symbol: holding.symbol || 'Unknown',
        displayName: holding.display_name || holding.symbol || 'Unknown',
        assetType: holding.asset_type || 'unknown',
        quantity: toNumber(holding.quantity),
        averageCost: toNumber(holding.average_cost),
        costBasis: toNumber(holding.cost_basis),
        marketPrice: toNumber(holding.market_price),
        marketValue: toNumber(holding.market_value),
        unrealizedPL: toNumber(holding.unrealized_pl),
        unrealizedPLPercent: toNumber(holding.unrealized_pl_percent),
        realizedPL,
        dividendIncome,
        totalReturn,
        totalReturnPercent,
        hasMarketPrice: Boolean(holding.has_market_price),
        priceSource: holding.price_source || 'missing'
      })
    }

    for (const tx of filteredIncomeTransactions) {
      const assetKey = getAssetKey(tx)
      if (map.has(assetKey)) continue
      const dividendIncome = toNumber(dividendsByAsset[assetKey])
      const realizedPL = toNumber(realizedByAsset[assetKey])
      map.set(assetKey, {
        assetId: assetKey,
        symbol: tx.symbol || 'Unknown',
        displayName: tx.assets?.display_name || tx.symbol || 'Unknown',
        assetType: tx.assets?.asset_type || 'unknown',
        quantity: 0,
        averageCost: 0,
        costBasis: 0,
        marketPrice: 0,
        marketValue: 0,
        unrealizedPL: 0,
        unrealizedPLPercent: 0,
        realizedPL,
        dividendIncome,
        totalReturn: dividendIncome + realizedPL,
        totalReturnPercent: 0,
        hasMarketPrice: false,
        priceSource: 'income-only'
      })
    }

    for (const row of realizedRows) {
      if (map.has(row.assetKey)) continue
      const realizedPL = toNumber(realizedByAsset[row.assetKey])
      map.set(row.assetKey, {
        assetId: row.assetKey,
        symbol: row.symbol || 'Unknown',
        displayName: row.displayName || row.symbol || 'Unknown',
        assetType: row.assetType || 'unknown',
        quantity: 0,
        averageCost: 0,
        costBasis: 0,
        marketPrice: 0,
        marketValue: 0,
        unrealizedPL: 0,
        unrealizedPLPercent: 0,
        realizedPL,
        dividendIncome: 0,
        totalReturn: realizedPL,
        totalReturnPercent: 0,
        hasMarketPrice: false,
        priceSource: 'closed-only'
      })
    }

    return sortRows(Array.from(map.values()), sortMode)
  }, [dividendsByAsset, filteredIncomeTransactions, holdings, realizedByAsset, realizedRows, sortMode])

  const totalDividendIncome = useMemo(() => filteredIncomeTransactions.reduce((sum, tx) => sum + tx.incomeAmount, 0), [filteredIncomeTransactions])
  const totalRealizedPL = useMemo(() => realizedRows.reduce((sum, row) => sum + row.realizedPL, 0), [realizedRows])
  const totalRealizedProceeds = useMemo(() => realizedRows.reduce((sum, row) => sum + row.matchedProceeds, 0), [realizedRows])

  const totalReturn = summary.totalUnrealizedPL + totalDividendIncome + totalRealizedPL
  const totalReturnPercent = summary.totalCostBasis > 0 ? (totalReturn / summary.totalCostBasis) * 100 : 0

  const accountRows = useMemo(() => {
    const accountIds = new Set()
    for (const tx of baseFilteredTransactions) accountIds.add(tx.account_id || 'unassigned')

    return Array.from(accountIds).map((accountId) => {
      const accountTransactions = baseFilteredTransactions.filter((tx) => (tx.account_id || 'unassigned') === accountId)
      const accountHoldings = calculateHoldings(accountTransactions, priceQuotes)
      const accountSummary = calculatePortfolioSummary(accountHoldings)
      const accountDividendIncome = filteredIncomeTransactions
        .filter((tx) => (tx.account_id || 'unassigned') === accountId)
        .reduce((sum, tx) => sum + tx.incomeAmount, 0)
      const accountRealizedPL = realizedRows
        .filter((row) => row.accountKey === accountId)
        .reduce((sum, row) => sum + row.realizedPL, 0)
      const accountTotalReturn = accountSummary.totalUnrealizedPL + accountDividendIncome + accountRealizedPL

      return {
        accountId,
        accountName: accountId === 'unassigned' ? 'Unassigned' : accountNameMap[accountId] || 'Unknown account',
        positions: accountHoldings.length,
        marketValue: accountSummary.totalMarketValue,
        costBasis: accountSummary.totalCostBasis,
        unrealizedPL: accountSummary.totalUnrealizedPL,
        realizedPL: accountRealizedPL,
        dividendIncome: accountDividendIncome,
        totalReturn: accountTotalReturn,
        totalReturnPercent: accountSummary.totalCostBasis > 0 ? (accountTotalReturn / accountSummary.totalCostBasis) * 100 : 0
      }
    }).sort((a, b) => b.totalReturn - a.totalReturn)
  }, [accountNameMap, baseFilteredTransactions, filteredIncomeTransactions, priceQuotes, realizedRows])

  const transactionStats = useMemo(() => {
    const buys = baseFilteredTransactions.filter((tx) => BUY_TYPES.has(normalizeText(tx.type)))
    const sells = baseFilteredTransactions.filter((tx) => SELL_TYPES.has(normalizeText(tx.type)))
    const missingPrice = holdings.filter((item) => !item.has_market_price)
    return {
      buyCount: buys.length,
      sellCount: sells.length,
      buyCash: buys.reduce((sum, tx) => sum + getTransactionCashValue(tx), 0),
      sellCash: sells.reduce((sum, tx) => sum + getSellProceeds(tx), 0),
      missingPriceCount: missingPrice.length,
      missingPriceSymbols: missingPrice.slice(0, 8).map((item) => item.symbol).join(', ')
    }
  }, [baseFilteredTransactions, holdings])

  const topWinners = useMemo(() => [...pnlRows].filter((row) => row.totalReturn > 0).sort((a, b) => b.totalReturn - a.totalReturn).slice(0, 5), [pnlRows])
  const topLosers = useMemo(() => [...pnlRows].filter((row) => row.totalReturn < 0).sort((a, b) => a.totalReturn - b.totalReturn).slice(0, 5), [pnlRows])

  const monthlyPerformanceRows = useMemo(() => {
    const map = new Map()
    for (const tx of incomeTransactions) {
      if (!tx.monthKey) continue
      if (!map.has(tx.monthKey)) map.set(tx.monthKey, { monthKey: tx.monthKey, income: 0, realized: 0 })
      map.get(tx.monthKey).income += tx.incomeAmount
    }
    for (const row of fifoResult.rows) {
      if (!row.monthKey) continue
      if (!map.has(row.monthKey)) map.set(row.monthKey, { monthKey: row.monthKey, income: 0, realized: 0 })
      map.get(row.monthKey).realized += row.realizedPL
    }
    return Array.from(map.values())
      .map((row) => ({ ...row, total: row.income + row.realized }))
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
      .slice(0, 12)
  }, [fifoResult.rows, incomeTransactions])

  const rightActions = (
    <button type="button" className="fd-button" onClick={loadData} disabled={loading}>
      {loading ? 'Refreshing...' : 'Refresh P&L'}
    </button>
  )

  return (
    <div>
      <PageHeader
        title="P&L Center"
        subtitle="Track unrealized P&L, FIFO realized P&L, dividend income, total return, account breakdowns, and data quality warnings."
        right={rightActions}
      />

      {message ? <div style={styles.message}>{message}</div> : null}

      <Card style={styles.filterCard}>
        <div style={styles.filterGrid}>
          <label style={styles.field}>
            <span style={styles.label}>Account</span>
            <select className="fd-input" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="all">All accounts</option>
              <option value="unassigned">Unassigned</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Asset Type</span>
            <select className="fd-input" value={assetTypeFilter} onChange={(event) => setAssetTypeFilter(event.target.value)}>
              <option value="all">All asset types</option>
              {assetTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Income / Realized Year</span>
            <select className="fd-input" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
              <option value="all">All years</option>
              {availableYears.map((year) => <option key={year} value={year}>{year}{year === getCurrentYear() ? ' · current' : ''}</option>)}
            </select>
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Sort</span>
            <select className="fd-input" value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
              <option value="totalReturnDesc">Total return · high to low</option>
              <option value="totalReturnAsc">Total return · low to high</option>
              <option value="realizedDesc">Realized P&L · high to low</option>
              <option value="realizedAsc">Realized P&L · low to high</option>
              <option value="unrealizedDesc">Unrealized P&L · high to low</option>
              <option value="unrealizedAsc">Unrealized P&L · low to high</option>
              <option value="dividendDesc">Dividend income · high to low</option>
              <option value="marketValueDesc">Market value · high to low</option>
              <option value="symbolAsc">Symbol · A to Z</option>
            </select>
          </label>

          <label style={{ ...styles.field, gridColumn: '1 / -1' }}>
            <span style={styles.label}>Search symbol, name, or account</span>
            <input className="fd-input" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search SCHD, JEPQ, Robinhood..." />
          </label>
        </div>
      </Card>

      <div style={styles.statGrid}>
        <StatCard label="Market Value" value={formatMoney(summary.totalMarketValue)} sub={`${summary.totalPositions} open position${summary.totalPositions === 1 ? '' : 's'}`} tone="info" />
        <StatCard label="Cost Basis" value={formatMoney(summary.totalCostBasis)} sub="Open positions only" />
        <StatCard label="Unrealized P&L" value={formatMoney(summary.totalUnrealizedPL)} sub={formatPercent(summary.totalUnrealizedPLPercent)} tone={getPnlTone(summary.totalUnrealizedPL)} />
        <StatCard label="Realized P&L" value={formatMoney(totalRealizedPL)} sub={`${realizedRows.length} closed sale${realizedRows.length === 1 ? '' : 's'} · ${formatMoney(totalRealizedProceeds)} proceeds`} tone={getPnlTone(totalRealizedPL)} />
        <StatCard label="Dividend / Interest" value={formatMoney(totalDividendIncome)} sub={yearFilter === 'all' ? 'All selected income records' : `Income in ${yearFilter}`} tone="success" />
        <StatCard label="Total Return" value={formatMoney(totalReturn)} sub={formatPercent(totalReturnPercent)} tone={getPnlTone(totalReturn)} />
      </div>

      <div style={styles.twoColumnGrid}>
        <RankCard title="Top Winners" subtitle="Ranked by total return: unrealized, realized, plus dividend income." rows={topWinners} empty="No positive total return positions found yet." />
        <RankCard title="Top Losers / Review" subtitle="Symbols with negative total return under the current filters." rows={topLosers} empty="No negative total return positions found under the current filters." />
      </div>

      <Card>
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.cardTitle}>P&L by Symbol</h2>
            <p style={styles.cardSub}>Unrealized P&L uses current market price. Realized P&L uses FIFO lot matching on closed sells. Dividend income is included in total return.</p>
          </div>
          <span className="fd-badge">{pnlRows.length} symbol{pnlRows.length === 1 ? '' : 's'}</span>
        </div>
        <div style={styles.symbolTableScroll}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.stickyThFirst}>Symbol</th>
                <th style={styles.stickyThRight}>Qty</th>
                <th style={styles.stickyThRight}>Avg Cost</th>
                <th style={styles.stickyThRight}>Market Price</th>
                <th style={styles.stickyThRight}>Cost Basis</th>
                <th style={styles.stickyThRight}>Market Value</th>
                <th style={styles.stickyThRight}>Unrealized P&L</th>
                <th style={styles.stickyThRight}>Realized P&L</th>
                <th style={styles.stickyThRight}>Div / Interest</th>
                <th style={styles.stickyThRight}>Total Return</th>
                <th style={styles.stickyTh}>Price</th>
              </tr>
            </thead>
            <tbody>
              {pnlRows.length === 0 ? (
                <tr><td style={styles.emptyCell} colSpan={11}>No P&L rows found. Add investment transactions or adjust filters.</td></tr>
              ) : pnlRows.map((row) => (
                <tr key={row.assetId}>
                  <td style={styles.tdFirst}><div style={styles.symbol}>{row.symbol}</div><div style={styles.muted}>{row.displayName}</div><div style={styles.muted}>{row.assetType}</div></td>
                  <td style={styles.tdRight}>{formatQuantity(row.quantity)}</td>
                  <td style={styles.tdRight}>{row.averageCost ? formatPrice(row.averageCost) : '-'}</td>
                  <td style={styles.tdRight}>{row.marketPrice ? formatPrice(row.marketPrice) : '-'}</td>
                  <td style={styles.tdRight}>{formatMoney(row.costBasis)}</td>
                  <td style={styles.tdRight}>{formatMoney(row.marketValue)}</td>
                  <td style={{ ...styles.tdRight, color: getPnlColor(row.unrealizedPL) }}><strong>{formatMoney(row.unrealizedPL)}</strong><div style={styles.muted}>{formatPercent(row.unrealizedPLPercent)}</div></td>
                  <td style={{ ...styles.tdRight, color: getPnlColor(row.realizedPL) }}><strong>{formatMoney(row.realizedPL)}</strong></td>
                  <td style={styles.tdRight}>{formatMoney(row.dividendIncome)}</td>
                  <td style={{ ...styles.tdRight, color: getPnlColor(row.totalReturn) }}><strong>{formatMoney(row.totalReturn)}</strong><div style={styles.muted}>{formatPercent(row.totalReturnPercent)}</div></td>
                  <td style={styles.td}><span className="fd-badge">{row.hasMarketPrice ? row.priceSource : 'missing'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={styles.twoColumnGrid}>
        <Card>
          <div style={styles.sectionHeader}>
            <div><h2 style={styles.cardTitle}>P&L by Account</h2><p style={styles.cardSub}>Compare Robinhood, Kraken, brokerage, and retirement accounts.</p></div>
          </div>
          <div className="fd-scroll-x">
            <table style={styles.accountTable}>
              <thead>
                <tr>
                  <th style={styles.th}>Account</th>
                  <th style={styles.thRight}>Positions</th>
                  <th style={styles.thRight}>Market Value</th>
                  <th style={styles.thRight}>Unrealized</th>
                  <th style={styles.thRight}>Realized</th>
                  <th style={styles.thRight}>Div / Interest</th>
                  <th style={styles.thRight}>Total Return</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.length === 0 ? (
                  <tr><td style={styles.emptyCell} colSpan={7}>No account P&L rows yet.</td></tr>
                ) : accountRows.map((row) => (
                  <tr key={row.accountId}>
                    <td style={styles.td}>{row.accountName}</td>
                    <td style={styles.tdRight}>{row.positions}</td>
                    <td style={styles.tdRight}>{formatMoney(row.marketValue)}</td>
                    <td style={{ ...styles.tdRight, color: getPnlColor(row.unrealizedPL) }}>{formatMoney(row.unrealizedPL)}</td>
                    <td style={{ ...styles.tdRight, color: getPnlColor(row.realizedPL) }}>{formatMoney(row.realizedPL)}</td>
                    <td style={styles.tdRight}>{formatMoney(row.dividendIncome)}</td>
                    <td style={{ ...styles.tdRight, color: getPnlColor(row.totalReturn) }}><strong>{formatMoney(row.totalReturn)}</strong><div style={styles.muted}>{formatPercent(row.totalReturnPercent)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div style={styles.sectionHeader}>
            <div><h2 style={styles.cardTitle}>Realized + Income Trend</h2><p style={styles.cardSub}>Recent FIFO realized P&L plus dividend and interest income by month.</p></div>
          </div>
          {monthlyPerformanceRows.length === 0 ? (
            <div style={styles.emptyState}>No realized P&L, dividend, or interest records yet.</div>
          ) : (
            <div style={styles.stack}>
              {monthlyPerformanceRows.map((row) => (
                <div key={row.monthKey} style={styles.monthRow}>
                  <div><div style={styles.symbol}>{row.monthKey}</div><div style={styles.muted}>Income {formatMoney(row.income)} · Realized {formatMoney(row.realized)}</div></div>
                  <strong style={{ color: getPnlColor(row.total) }}>{formatMoney(row.total)}</strong>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.cardTitle}>Realized P&L FIFO Ledger</h2>
            <p style={styles.cardSub}>Read-only closed-sale calculation. FIFO means oldest buy lots are matched first. This is for dashboard tracking, not final tax filing.</p>
          </div>
          <span className="fd-badge">{realizedRows.length} sale{realizedRows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="fd-scroll-x">
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Symbol</th>
                <th style={styles.th}>Account</th>
                <th style={styles.thRight}>Sold Qty</th>
                <th style={styles.thRight}>Matched Qty</th>
                <th style={styles.thRight}>Proceeds</th>
                <th style={styles.thRight}>FIFO Cost</th>
                <th style={styles.thRight}>Realized P&L</th>
                <th style={styles.thRight}>Return %</th>
              </tr>
            </thead>
            <tbody>
              {realizedRows.length === 0 ? (
                <tr><td style={styles.emptyCell} colSpan={9}>No sell transactions found under the current filters.</td></tr>
              ) : realizedRows.map((row) => (
                <tr key={row.id}>
                  <td style={styles.td}>{row.transactionDate || '-'}</td>
                  <td style={styles.td}><div style={styles.symbol}>{row.symbol}</div><div style={styles.muted}>{row.displayName}</div></td>
                  <td style={styles.td}>{row.accountName}</td>
                  <td style={styles.tdRight}>{formatQuantity(row.quantity)}</td>
                  <td style={styles.tdRight}>{formatQuantity(row.matchedQuantity)}{row.unmatchedQuantity > 0 ? <div style={{ ...styles.muted, color: '#f59e0b' }}>Unmatched {formatQuantity(row.unmatchedQuantity)}</div> : null}</td>
                  <td style={styles.tdRight}>{formatMoney(row.matchedProceeds)}</td>
                  <td style={styles.tdRight}>{formatMoney(row.costBasis)}</td>
                  <td style={{ ...styles.tdRight, color: getPnlColor(row.realizedPL) }}><strong>{formatMoney(row.realizedPL)}</strong></td>
                  <td style={{ ...styles.tdRight, color: getPnlColor(row.realizedPL) }}>{formatPercent(row.realizedPLPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div style={styles.sectionHeader}>
          <div><h2 style={styles.cardTitle}>Data Warnings</h2><p style={styles.cardSub}>These warnings do not change data. They show what can make P&L incomplete.</p></div>
        </div>
        <div style={styles.warningGrid}>
          <WarningItem title="Realized P&L uses FIFO" detail={`FIFO realized P&L is enabled for dashboard tracking. It matched ${realizedRows.length} closed sale${realizedRows.length === 1 ? '' : 's'} under the current filters.`} tone="success" />
          <WarningItem title="FIFO lot matching" detail={fifoResult.warnings.length > 0 ? `${fifoResult.warnings.length} sell transaction${fifoResult.warnings.length === 1 ? '' : 's'} had more sold quantity than available buy lots. First issue: ${fifoResult.warnings[0].symbol} · ${fifoResult.warnings[0].detail}` : 'All sell transactions had enough available buy lots under the current filters.'} tone={fifoResult.warnings.length > 0 ? 'warning' : 'success'} />
          <WarningItem title="Missing market prices" detail={transactionStats.missingPriceCount > 0 ? `${transactionStats.missingPriceCount} open position${transactionStats.missingPriceCount === 1 ? '' : 's'} need market price review: ${transactionStats.missingPriceSymbols}` : 'All open positions have usable market prices under the current filters.'} tone={transactionStats.missingPriceCount > 0 ? 'warning' : 'success'} />
          <WarningItem title="Transaction coverage" detail={`${transactionStats.buyCount} buy/deposit transactions and ${transactionStats.sellCount} sell/withdraw transactions under the current filters. Buy cash: ${formatMoney(transactionStats.buyCash)} · Sell cash: ${formatMoney(transactionStats.sellCash)}.`} />
          <WarningItem title="Tax note" detail="FIFO realized P&L here is for personal dashboard tracking. It does not replace brokerage 1099s, exchange tax reports, or CPA/tax filing calculations." />
        </div>
      </Card>
    </div>
  )
}

function RankCard({ title, subtitle, rows, empty }) {
  return (
    <Card>
      <div style={styles.sectionHeader}>
        <div><h2 style={styles.cardTitle}>{title}</h2><p style={styles.cardSub}>{subtitle}</p></div>
      </div>
      {rows.length === 0 ? <div style={styles.emptyState}>{empty}</div> : (
        <div style={styles.stack}>{rows.map((row, index) => <MiniRankRow key={row.assetId} row={row} index={index} />)}</div>
      )}
    </Card>
  )
}

function MiniRankRow({ row, index }) {
  return (
    <div style={styles.rankRow}>
      <div style={styles.rankNumber}>{index + 1}</div>
      <div style={{ minWidth: 0 }}><div style={styles.symbol}>{row.symbol}</div><div style={styles.muted}>{row.displayName}</div></div>
      <div style={styles.rankValue}><strong style={{ color: getPnlColor(row.totalReturn) }}>{formatMoney(row.totalReturn)}</strong><div style={styles.muted}>{formatPercent(row.totalReturnPercent)}</div></div>
    </div>
  )
}

function WarningItem({ title, detail, tone = 'default' }) {
  const borderColor = tone === 'warning' ? '#f59e0b' : tone === 'success' ? '#22c55e' : '#334155'
  return <div style={{ ...styles.warningItem, borderColor }}><div style={styles.symbol}>{title}</div><p style={styles.warningText}>{detail}</p></div>
}

const styles = {
  message: { marginBottom: 16, padding: 14, borderRadius: 16, border: '1px solid rgba(56, 189, 248, 0.28)', background: 'rgba(14, 165, 233, 0.08)', color: '#dbeafe' },
  filterCard: { marginBottom: 18 },
  filterGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, alignItems: 'end' },
  field: { display: 'grid', gap: 8 },
  label: { color: '#9ca3af', fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16, marginBottom: 18 },
  twoColumnGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, marginBottom: 18 },
  sectionHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 },
  cardTitle: { margin: 0, color: '#f9fafb', fontSize: 22, fontWeight: 850, letterSpacing: '-0.03em' },
  cardSub: { margin: '7px 0 0', color: '#9ca3af', fontSize: 13, lineHeight: 1.5 },
  stack: { display: 'grid', gap: 10 },
  rankRow: { display: 'grid', gridTemplateColumns: '38px minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: 12, borderRadius: 16, border: '1px solid rgba(148, 163, 184, 0.18)', background: 'rgba(15, 23, 42, 0.52)' },
  rankNumber: { width: 32, height: 32, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'rgba(37, 99, 235, 0.88)', color: '#fff', fontWeight: 900 },
  rankValue: { textAlign: 'right' },
  symbol: { color: '#f9fafb', fontWeight: 850 },
  muted: { color: '#9ca3af', fontSize: 12, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  emptyState: { padding: 18, borderRadius: 16, border: '1px dashed rgba(148, 163, 184, 0.25)', color: '#9ca3af', background: 'rgba(15, 23, 42, 0.38)' },
  symbolTableScroll: { maxHeight: 560, overflow: 'auto', borderRadius: 16, border: '1px solid rgba(148, 163, 184, 0.14)', background: 'rgba(15, 23, 42, 0.18)' },
  table: { width: '100%', minWidth: 1180, borderCollapse: 'separate', borderSpacing: 0 },
  accountTable: { width: '100%', minWidth: 900, borderCollapse: 'collapse' },
  th: { padding: '12px 14px', textAlign: 'left', color: '#cbd5e1', fontSize: 12, fontWeight: 850, borderBottom: '1px solid rgba(148, 163, 184, 0.18)', whiteSpace: 'nowrap' },
  thRight: { padding: '12px 14px', textAlign: 'right', color: '#cbd5e1', fontSize: 12, fontWeight: 850, borderBottom: '1px solid rgba(148, 163, 184, 0.18)', whiteSpace: 'nowrap' },
  stickyTh: { padding: '12px 14px', textAlign: 'left', color: '#cbd5e1', fontSize: 12, fontWeight: 850, borderBottom: '1px solid rgba(148, 163, 184, 0.18)', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 3, background: '#111827' },
  stickyThRight: { padding: '12px 14px', textAlign: 'right', color: '#cbd5e1', fontSize: 12, fontWeight: 850, borderBottom: '1px solid rgba(148, 163, 184, 0.18)', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 3, background: '#111827' },
  stickyThFirst: { padding: '12px 14px', textAlign: 'left', color: '#cbd5e1', fontSize: 12, fontWeight: 850, borderBottom: '1px solid rgba(148, 163, 184, 0.18)', whiteSpace: 'nowrap', position: 'sticky', top: 0, left: 0, zIndex: 5, background: '#111827' },
  td: { padding: '13px 14px', color: '#e5e7eb', borderBottom: '1px solid rgba(148, 163, 184, 0.11)', verticalAlign: 'top' },
  tdFirst: { padding: '13px 14px', color: '#e5e7eb', borderBottom: '1px solid rgba(148, 163, 184, 0.11)', verticalAlign: 'top', position: 'sticky', left: 0, zIndex: 2, background: '#111827', minWidth: 210 },
  tdRight: { padding: '13px 14px', color: '#e5e7eb', borderBottom: '1px solid rgba(148, 163, 184, 0.11)', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' },
  emptyCell: { padding: 22, color: '#9ca3af', textAlign: 'center' },
  monthRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: 12, borderRadius: 16, border: '1px solid rgba(148, 163, 184, 0.16)', background: 'rgba(15, 23, 42, 0.46)' },
  warningGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 },
  warningItem: { padding: 14, borderRadius: 16, border: '1px solid #334155', background: 'rgba(15, 23, 42, 0.42)' },
  warningText: { margin: '7px 0 0', color: '#9ca3af', fontSize: 13, lineHeight: 1.5 }
}
