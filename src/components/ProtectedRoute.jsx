import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ProtectedRoute({ children }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)

  useEffect(() => {
    let mounted = true

    const loadSession = async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error('getSession error:', error.message)
      }

      if (mounted) {
        setSession(data.session || null)
        setLoading(false)
      }
    }

    loadSession()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession || null)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return <div style={{ color: 'var(--text-main)', padding: '24px' }}>Loading...</div>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return children
}
