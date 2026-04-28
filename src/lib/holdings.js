function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeType(type) {
  return String(type || '').trim().toLowerCase()
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase()
}

export function buildLatestPriceMap(priceQuotes = []) {
  const latestPriceMap = {}
  const latestQuoteMap = {}

  for (const quote of priceQuotes || []) {
    const assetId = quote.asset_id
    const price = toNumber(quote.price)

    if (!assetId || price <= 0) continue

    if (!latestPriceMap[assetId]) {
      latestPriceMap[assetId] = price
      latestQuoteMap[assetId] = quote
    }
  }

  return latestPriceMap
}

export function buildLatestQuoteMap(priceQuotes = []) {
  const latestQuoteMap = {}

  for (const quote of priceQuotes || []) {
    const assetId = quote.asset_id
    const price = toNumber(quote.price)

    if (!assetId || price <= 0) continue

    if (!latestQuoteMap[assetId]) {
      latestQuoteMap[assetId] = quote
    }
  }

  return latestQuoteMap
}

export function resolveMarketPrice(holding, latestPriceMap = {}) {
  const lockedPrice = toNumber(holding.locked_price)
  const latestPrice = toNumber(latestPriceMap[holding.asset_id])
  const averageCost = toNumber(holding.average_cost)

  if (holding.is_price_locked && lockedPrice > 0) {
    return {
      marketPrice: lockedPrice,
      priceSource: 'locked',
      hasMarketPrice: true
    }
  }

  if (latestPrice > 0) {
    return {
      marketPrice: latestPrice,
      priceSource: 'latest_quote',
      hasMarketPrice: true
    }
  }

  return {
    marketPrice: 0,
    fallbackPrice: averageCost,
    priceSource: 'missing',
    hasMarketPrice: false
  }
}

export function calculateHoldings(transactions = [], priceQuotes = []) {
  const latestPriceMap = buildLatestPriceMap(priceQuotes)
  const map = {}

  for (const tx of transactions || []) {
    const asset = tx.assets || {}
    const assetId = tx.asset_id || asset.id

    if (!assetId) continue

    if (!map[assetId]) {
      const symbol = normalizeSymbol(asset.symbol) || 'N/A'

      map[assetId] = {
        asset_id: assetId,
        symbol,
        display_name: asset.display_name || symbol,
        asset_type: asset.asset_type || 'unknown',
        is_price_locked: Boolean(asset.is_price_locked),
        locked_price: toNumber(asset.locked_price),
        quantity: 0,
        total_quantity: 0,
        average_cost: 0,
        cost_basis: 0,
        market_price: 0,
        market_value: 0,
        unrealized_pl: 0,
        unrealized_pl_percent: 0,
        price_source: 'missing',
        has_market_price: false
      }
    }

    const holding = map[assetId]
    const type = normalizeType(tx.type)
    const quantity = toNumber(tx.quantity)
    const unitPrice = toNumber(tx.unit_price)
    const fee = toNumber(tx.fee)

    if (quantity <= 0) continue

    const currentQuantity = toNumber(holding.quantity)
    const currentCostBasis = toNumber(holding.cost_basis)
    const currentAverageCost =
      currentQuantity > 0 ? currentCostBasis / currentQuantity : 0

    if (type === 'buy' || type === 'deposit') {
      holding.quantity = currentQuantity + quantity
      holding.total_quantity = holding.quantity
      holding.cost_basis = currentCostBasis + quantity * unitPrice + fee
      holding.average_cost =
        holding.quantity > 0 ? holding.cost_basis / holding.quantity : 0
    }

    if (type === 'sell' || type === 'withdraw') {
      const outgoingQuantity = Math.min(quantity, currentQuantity)
      holding.quantity = currentQuantity - outgoingQuantity
      holding.total_quantity = holding.quantity
      holding.cost_basis = currentCostBasis - outgoingQuantity * currentAverageCost

      if (holding.quantity <= 0.000000001) {
        holding.quantity = 0
        holding.total_quantity = 0
        holding.cost_basis = 0
        holding.average_cost = 0
      } else {
        holding.average_cost = holding.cost_basis / holding.quantity
      }
    }
  }

  return Object.values(map)
    .filter((item) => toNumber(item.quantity) > 0)
    .map((item) => {
      const resolved = resolveMarketPrice(item, latestPriceMap)
      const marketPrice = toNumber(resolved.marketPrice)
      const marketValue = item.quantity * marketPrice
      const unrealizedPL = marketValue - item.cost_basis
      const unrealizedPLPercent =
        item.cost_basis > 0 ? (unrealizedPL / item.cost_basis) * 100 : 0

      return {
        ...item,
        total_quantity: item.quantity,
        market_price: marketPrice,
        market_value: marketValue,
        unrealized_pl: unrealizedPL,
        unrealized_pl_percent: unrealizedPLPercent,
        price_source: resolved.priceSource,
        has_market_price: resolved.hasMarketPrice
      }
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
}

export function calculatePortfolioSummary(holdings = []) {
  const totalPositions = holdings.length

  const totalCostBasis = holdings.reduce(
    (sum, item) => sum + toNumber(item.cost_basis),
    0
  )

  const totalMarketValue = holdings.reduce(
    (sum, item) => sum + toNumber(item.market_value),
    0
  )

  const totalUnrealizedPL = holdings.reduce(
    (sum, item) => sum + toNumber(item.unrealized_pl),
    0
  )

  const totalUnrealizedPLPercent =
    totalCostBasis > 0 ? (totalUnrealizedPL / totalCostBasis) * 100 : 0

  return {
    totalPositions,
    totalCostBasis,
    totalMarketValue,
    totalUnrealizedPL,
    totalUnrealizedPLPercent
  }
}

export function formatNumber(value) {
  return toNumber(value).toLocaleString(undefined, {
    maximumFractionDigits: 8
  })
}

export function formatMoney(value) {
  return toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

export function formatPrice(value) {
  const n = toNumber(value)

  if (n > 0 && n < 1) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8
    })
  }

  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

export function formatPercent(value) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`
}
