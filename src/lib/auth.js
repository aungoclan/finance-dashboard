import { supabase } from './supabase'

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    console.error('getCurrentUser error:', error.message)
    return null
  }

  return data.user || null
}

export async function ensureUserProfile(user) {
  if (!user) return

  const { data: existingProfile, error: selectError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (selectError) {
    console.error('Profile check error:', selectError.message)
    return
  }

  if (!existingProfile) {
    const { error: insertError } = await supabase.from('profiles').insert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || ''
    })

    if (insertError) {
      console.error('Profile insert error:', insertError.message)
    }
  }
}