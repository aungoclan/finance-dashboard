import { supabase } from './supabase'

export async function saveNetWorthSnapshot({
  userId,
  netWorth,
  totalAssets,
  liabilities,
  investmentValue
}) {
  const today = new Date().toISOString().split('T')[0]

  // FIX: check kỹ hơn
  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .select('id')
    .eq('user_id', userId)
    .eq('snapshot_date', today)

  if (error) {
    console.error(error)
    return
  }

  // nếu đã có record hôm nay → KHÔNG insert nữa
  if (data && data.length > 0) {
    return
  }

  await supabase.from('net_worth_snapshots').insert({
    user_id: userId,
    snapshot_date: today,
    net_worth: netWorth,
    total_assets: totalAssets,
    liabilities: liabilities,
    investment_value: investmentValue
  })
}