import { supabase } from './supabase'

export async function getNetWorthHistory(userId) {
  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .select('*')
    .eq('user_id', userId)
    .order('snapshot_date', { ascending: true })

  if (error) throw error

  return data.map((row) => ({
    label: row.snapshot_date,
    netWorth: Number(row.net_worth || 0)
  }))
}