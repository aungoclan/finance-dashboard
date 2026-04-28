import { supabase } from './supabase'

export async function refreshAllMarketPrices() {
  const {
    data: { session },
    error: sessionError
  } = await supabase.auth.getSession()

  if (sessionError || !session?.access_token) {
    throw new Error('Missing session. Please login again.')
  }

  const { data, error } = await supabase.functions.invoke('refresh-market-prices', {
    headers: {
      Authorization: `Bearer ${session.access_token}`
    }
  })

  if (error) {
    throw new Error(error.message || 'Failed to refresh market prices')
  }

  if (data?.error) {
    throw new Error(data.error)
  }

  return {
    updated: Number(data?.updated || 0),
    skipped: Number(data?.skipped || 0),
    failedSymbols: data?.failedSymbols || [],
    details: Array.isArray(data?.details) ? data.details : [],
    message: data?.message || 'Market prices refreshed'
  }
}