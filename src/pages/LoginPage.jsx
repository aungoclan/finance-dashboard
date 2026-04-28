import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ensureUserProfile } from '../lib/auth'

export default function LoginPage() {
  const navigate = useNavigate()

  const [mode, setMode] = useState('login') // login | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const checkExistingSession = async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error('getSession error:', error.message)
        return
      }

      if (data.session?.user) {
        await ensureUserProfile(data.session.user)
        navigate('/')
      }
    }

    checkExistingSession()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await ensureUserProfile(session.user)
        navigate('/')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [navigate])

  const handleLogin = async (e) => {
    e.preventDefault()
    setMessage('')

    if (!email.trim()) {
      setMessage('Please enter your email')
      return
    }

    if (!password.trim()) {
      setMessage('Please enter your password')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    })

    if (error) {
      setMessage(error.message)
    } else {
      setMessage('Login successful')
    }

    setLoading(false)
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setMessage('')

    if (!email.trim()) {
      setMessage('Please enter your email')
      return
    }

    if (!password.trim()) {
      setMessage('Please enter your password')
      return
    }

    if (password.length < 6) {
      setMessage('Password must be at least 6 characters')
      return
    }

    if (password !== confirmPassword) {
      setMessage('Passwords do not match')
      return
    }

    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password
    })

    if (error) {
      setMessage(error.message)
      setLoading(false)
      return
    }

    if (data.user) {
      setMessage('Sign up successful. You can now log in.')
      setMode('login')
      setPassword('')
      setConfirmPassword('')
    } else {
      setMessage('Sign up completed. Please check your email if confirmation is required.')
    }

    setLoading(false)
  }

  const handleSubmit = (e) => {
    if (mode === 'login') {
      handleLogin(e)
    } else {
      handleSignUp(e)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#111827',
        color: 'white',
        padding: '24px'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          background: '#1f2937',
          padding: '28px',
          borderRadius: '16px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)'
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: '8px' }}>
          {mode === 'login' ? 'Login' : 'Sign Up'}
        </h1>

        <p style={{ marginTop: 0, marginBottom: '20px', color: '#d1d5db' }}>
          {mode === 'login'
            ? 'Sign in to access your financial dashboard.'
            : 'Create your account to get started.'}
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              autoComplete="email"
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {mode === 'signup' && (
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Confirm Password</label>
              <input
                type="password"
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={inputStyle}
                autoComplete="new-password"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              border: 'none',
              borderRadius: '10px',
              background: loading ? '#6b7280' : '#2563eb',
              color: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '15px',
              fontWeight: 600,
              marginTop: '8px'
            }}
          >
            {loading
              ? 'Please wait...'
              : mode === 'login'
              ? 'Login'
              : 'Create Account'}
          </button>
        </form>

        {message && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              borderRadius: '10px',
              background: '#111827',
              color: '#e5e7eb',
              border: '1px solid #374151',
              fontSize: '14px'
            }}
          >
            {message}
          </div>
        )}

        <div style={{ marginTop: '18px', textAlign: 'center' }}>
          {mode === 'login' ? (
            <p style={{ margin: 0, color: '#d1d5db' }}>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('signup')
                  setMessage('')
                  setPassword('')
                  setConfirmPassword('')
                }}
                style={switchButtonStyle}
              >
                Sign Up
              </button>
            </p>
          ) : (
            <p style={{ margin: 0, color: '#d1d5db' }}>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('login')
                  setMessage('')
                  setPassword('')
                  setConfirmPassword('')
                }}
                style={switchButtonStyle}
              >
                Login
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  fontSize: '14px',
  color: '#e5e7eb'
}

const inputStyle = {
  width: '100%',
  padding: '12px',
  borderRadius: '10px',
  border: '1px solid #4b5563',
  background: '#111827',
  color: 'white',
  outline: 'none'
}

const switchButtonStyle = {
  background: 'transparent',
  border: 'none',
  color: '#60a5fa',
  cursor: 'pointer',
  padding: 0,
  fontSize: '14px',
  fontWeight: 600
}