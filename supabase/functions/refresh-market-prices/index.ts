import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const COINGECKO_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  XBT: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  LTC: 'litecoin',
  DOT: 'polkadot',
  SUI: 'sui',
  XLM: 'stellar',
  TAO: 'bittensor',
  RENDER: 'render-token',

  PEPE: 'pepe',
  PUMP: 'pump-fun',
  BABY: 'babylon',
  SEI: 'sei-network',
  GRT: 'the-graph',
  TRX: 'tron',
  ARB: 'arbitrum',
  FET: 'fetch-ai',
  HBAR: 'hedera-hashgraph',
  ATOM: 'cosmos',
  TON: 'the-open-network',
  UNI: 'uniswap',
  NEAR: 'near',
  ICP: 'internet-computer',
  FIL: 'filecoin',
  PENDLE: 'pendle',
  APT: 'aptos',
  PAXG: 'pax-gold',
  USDC: 'usd-coin',
  USDT: 'tether',
  USDG: 'global-dollar'
}

function normalizeSymbol(symbol: string | null | undefined) {
  return String(symbol || '').trim().toUpperCase()
}

function getCoinGeckoId(symbol: string) {
  return COINGECKO_MAP[normalizeSymbol(symbol)] || null
}

function isCryptoSymbol(symbol: string) {
  return Boolean(getCoinGeckoId(symbol))
}

function validatePrice({
  symbol,
  assetType,
  newPrice,
  oldPrice,
  source
}: {
  symbol: string
  assetType: string
  newPrice: number | null
  oldPrice: number | null
  source: string
}) {
  const normalizedSymbol = normalizeSymbol(symbol)
  const normalizedType = String(assetType || '').toLowerCase()
  const isCrypto = normalizedType === 'crypto' || isCryptoSymbol(normalizedSymbol)

  if (!newPrice || newPrice <= 0) {
    return {
      ok: false,
      flag: 'missing_price',
      reason: 'No valid price returned'
    }
  }

  if (newPrice > 1000000) {
    return {
      ok: false,
      flag: 'too_high',
      reason: `Suspicious price too high: ${newPrice}`
    }
  }

  if (newPrice < 0.000000000001) {
    return {
      ok: false,
      flag: 'too_low',
      reason: `Suspicious price too low: ${newPrice}`
    }
  }

  if (isCrypto && source === 'Stooq') {
    return {
      ok: false,
      flag: 'wrong_source',
      reason: `${normalizedSymbol} looks like crypto but price came from Stooq`
    }
  }

  if (oldPrice && oldPrice > 0) {
    const changePercent = Math.abs(newPrice - oldPrice) / oldPrice

    if (['USDC', 'USDT', 'USDG'].includes(normalizedSymbol) && changePercent > 0.15) {
      return {
        ok: false,
        flag: 'stablecoin_spike',
        reason: `Stablecoin price changed ${(changePercent * 100).toFixed(2)}%`
      }
    }

    if (isCrypto && changePercent > 0.9) {
      return {
        ok: false,
        flag: 'crypto_price_spike',
        reason: `Crypto price changed ${(changePercent * 100).toFixed(2)}% from previous price`
      }
    }

    if (!isCrypto && changePercent > 0.5) {
      return {
        ok: false,
        flag: 'stock_price_spike',
        reason: `Stock/ETF price changed ${(changePercent * 100).toFixed(2)}% from previous price`
      }
    }
  }

  return {
    ok: true,
    flag: 'ok',
    reason: null
  }
}

async function fetchCryptoPrices(symbols: string[]) {
  const uniqueSymbols = [...new Set(symbols.map(normalizeSymbol))].filter(Boolean)
  const ids = uniqueSymbols.map(getCoinGeckoId).filter(Boolean)

  if (ids.length === 0) return {}

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`

  const res = await fetch(url)

  if (!res.ok) {
    throw new Error('CoinGecko price fetch failed')
  }

  const data = await res.json()
  const result: Record<string, number> = {}

  for (const symbol of uniqueSymbols) {
    const id = getCoinGeckoId(symbol)
    const price = id ? Number(data?.[id]?.usd || 0) : 0

    if (price > 0) {
      result[symbol] = price
    }
  }

  return result
}

async function fetchAlphaVantagePrice(symbol: string, apiKey: string | null) {
  if (!apiKey) return null

  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(
    symbol
  )}&apikey=${encodeURIComponent(apiKey)}`

  const res = await fetch(url)
  if (!res.ok) return null

  const data = await res.json()
  const price = Number(data?.['Global Quote']?.['05. price'] || 0)

  return price > 0 ? price : null
}

function parseCsvLine(line: string) {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  result.push(current)
  return result.map((v) => v.trim().replace(/^"|"$/g, ''))
}

async function fetchStooqPrice(symbol: string) {
  const stooqSymbol = `${symbol.toLowerCase()}.us`
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`

  const res = await fetch(url)
  if (!res.ok) return null

  const text = await res.text()
  const lines = text.trim().split('\n')

  if (lines.length < 2) return null

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase())
  const values = parseCsvLine(lines[1])
  const closeIndex = headers.indexOf('close')

  if (closeIndex < 0) return null

  const raw = values[closeIndex]
  const price = Number(raw)

  if (!raw || raw.toLowerCase() === 'nan' || price <= 0) return null

  return price
}

async function fetchStockEtfPrice(symbol: string, alphaKey: string | null) {
  const alphaPrice = await fetchAlphaVantagePrice(symbol, alphaKey)

  if (alphaPrice) {
    return {
      price: alphaPrice,
      source: 'Alpha Vantage'
    }
  }

  const stooqPrice = await fetchStooqPrice(symbol)

  if (stooqPrice) {
    return {
      price: stooqPrice,
      source: 'Stooq'
    }
  }

  return {
    price: null,
    source: 'Alpha Vantage / Stooq'
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const alphaKey = Deno.env.get('ALPHA_VANTAGE_API_KEY') || null

    const authHeader = req.headers.get('Authorization') || ''

    const authClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    })

    const {
      data: { user },
      error: userError
    } = await authClient.auth.getUser()

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: transactions, error: txError } = await admin
      .from('investment_transactions')
      .select(`
        asset_id,
        assets (
          id,
          symbol,
          display_name,
          asset_type,
          is_price_locked,
          locked_price
        )
      `)
      .eq('user_id', user.id)

    if (txError) throw txError

    const assetMap: Record<string, any> = {}

    for (const row of transactions || []) {
      const asset = row.assets
      const symbol = normalizeSymbol(asset?.symbol)

      if (!asset?.id || !symbol) continue

      assetMap[symbol] = {
        id: asset.id,
        symbol,
        asset_type: String(asset.asset_type || '').toLowerCase(),
        is_price_locked: Boolean(asset.is_price_locked),
        locked_price: Number(asset.locked_price || 0)
      }
    }

    const assets = Object.values(assetMap)
    const details: any[] = []

    for (const asset of assets) {
      if (asset.is_price_locked && asset.locked_price > 0) {
        details.push({
          symbol: asset.symbol,
          source: 'Manual Lock',
          status: 'locked',
          price: asset.locked_price,
          previousPrice: asset.locked_price,
          flag: 'price_locked',
          reason: 'Skipped auto refresh because price is locked'
        })
      }
    }

    const refreshableAssets = assets.filter(
      (asset) => !asset.is_price_locked || !asset.locked_price
    )

    const { data: latestQuotes, error: quoteError } = await admin
      .from('price_quotes')
      .select(`
        asset_id,
        price,
        created_at
      `)
      .order('created_at', { ascending: false })

    if (quoteError) throw quoteError

    const oldPriceByAssetId: Record<string, number> = {}

    for (const quote of latestQuotes || []) {
      if (!oldPriceByAssetId[quote.asset_id]) {
        oldPriceByAssetId[quote.asset_id] = Number(quote.price || 0)
      }
    }

    const cryptoSymbols = refreshableAssets
      .filter((asset) => asset.asset_type === 'crypto' || getCoinGeckoId(asset.symbol))
      .map((asset) => asset.symbol)

    const stockEtfSymbols = refreshableAssets
      .filter((asset) => asset.asset_type !== 'crypto' && !getCoinGeckoId(asset.symbol))
      .map((asset) => asset.symbol)

    const failedSymbols: string[] = []
    const guardedSymbols: string[] = []

    let updated = 0
    let skipped = 0
    let guarded = 0
    let locked = assets.length - refreshableAssets.length

    const cryptoPrices = await fetchCryptoPrices(cryptoSymbols)

    for (const symbol of cryptoSymbols) {
      const asset = assetMap[symbol]
      const price = Number(cryptoPrices[symbol] || 0)
      const oldPrice = oldPriceByAssetId[asset.id] || null

      const validation = validatePrice({
        symbol,
        assetType: asset.asset_type,
        newPrice: price,
        oldPrice,
        source: 'CoinGecko'
      })

      if (!validation.ok) {
        guarded++
        guardedSymbols.push(symbol)

        details.push({
          symbol,
          source: 'CoinGecko',
          status: 'guarded',
          price: price || null,
          previousPrice: oldPrice,
          flag: validation.flag,
          reason: validation.reason
        })

        continue
      }

      const { error } = await admin.from('price_quotes').insert({
        asset_id: asset.id,
        price
      })

      if (error) throw error

      updated++

      details.push({
        symbol,
        source: 'CoinGecko',
        status: 'updated',
        price,
        previousPrice: oldPrice,
        flag: validation.flag,
        reason: '-'
      })
    }

    for (const symbol of stockEtfSymbols) {
      const asset = assetMap[symbol]
      const result = await fetchStockEtfPrice(symbol, alphaKey)
      const price = result.price ? Number(result.price) : null
      const oldPrice = oldPriceByAssetId[asset.id] || null

      const validation = validatePrice({
        symbol,
        assetType: asset.asset_type,
        newPrice: price,
        oldPrice,
        source: result.source
      })

      if (!validation.ok) {
        if (price) {
          guarded++
          guardedSymbols.push(symbol)

          details.push({
            symbol,
            source: result.source,
            status: 'guarded',
            price,
            previousPrice: oldPrice,
            flag: validation.flag,
            reason: validation.reason
          })
        } else {
          skipped++
          failedSymbols.push(symbol)

          details.push({
            symbol,
            source: result.source,
            status: 'failed',
            price: null,
            previousPrice: oldPrice,
            flag: validation.flag,
            reason: validation.reason
          })
        }

        continue
      }

      const { error } = await admin.from('price_quotes').insert({
        asset_id: asset.id,
        price
      })

      if (error) throw error

      updated++

      details.push({
        symbol,
        source: result.source,
        status: 'updated',
        price,
        previousPrice: oldPrice,
        flag: validation.flag,
        reason: '-'
      })
    }

    return new Response(
      JSON.stringify({
        updated,
        skipped,
        guarded,
        locked,
        failedSymbols,
        guardedSymbols,
        details,
        message:
          locked > 0 || guarded > 0
            ? `Updated ${updated}. Locked ${locked}. Guarded ${guarded}. Skipped ${skipped}.`
            : `Updated ${updated}. Skipped ${skipped}.`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})