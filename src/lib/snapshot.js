import { supabase } from './supabase'

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function getTodayKey() {
  return new Date().toISOString().split('T')[0]
}

export async function saveNetWorthSnapshot({
  userId,
  netWorth,
  totalAssets,
  liabilities,
  investmentValue
}) {
  if (!userId) {
    console.warn('saveNetWorthSnapshot skipped: missing userId')
    return null
  }

  const snapshotDate = getTodayKey()

  const payload = {
    user_id: userId,
    snapshot_date: snapshotDate,
    net_worth: toNumber(netWorth),
    total_assets: toNumber(totalAssets),
    liabilities: toNumber(liabilities),
    investment_value: toNumber(investmentValue)
  }

  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .upsert(payload, {
      onConflict: 'user_id,snapshot_date'
    })
    .select('id, snapshot_date')
    .single()

  if (error) {
    console.error('saveNetWorthSnapshot upsert error:', error)
    return null
  }

  return data
}