'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, X } from 'lucide-react'
import { useClient } from '@/contexts/ClientContext'

export default function LoginPage() {
  const [username, setUsername] = useState('') // Changed from email to username
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Forgot password modal state
  const [fpOpen, setFpOpen] = useState(false)
  const [fpEmail, setFpEmail] = useState('')
  const [fpSending, setFpSending] = useState(false)
  const [fpMsg, setFpMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const router = useRouter()
  const { refresh } = useClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      localStorage.removeItem('selectedClientCode')
      localStorage.removeItem('selectedClientId')
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }), // Send username instead of email
        credentials: 'include',
      })

      const data = await response.json()
      console.log('Login response:', response.status, data)

      if (!response.ok) throw new Error(data.error || 'Login failed')

      console.log('Triggering client data refresh')
      await refresh()
      console.log('Redirecting to dashboard')
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      console.error('Login error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFpMsg(null)
    setFpSending(true)
    try {
      const resp = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fpEmail.trim() }),
      })
      const data = await resp.json()

      if (!resp.ok) {
        throw new Error(data.error || 'Could not send reset email')
      }

      setFpMsg({
        type: 'success',
        text: 'If that email exists, a reset link has been sent.',
      })
    } catch (err) {
      setFpMsg({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.',
      })
    } finally {
      setFpSending(false)
    }
  }

  const closeForgot = () => {
    setFpOpen(false)
    setFpMsg(null)
    setFpEmail('')
  }

  return (
    <main className="min-h-screen flex flex-col items-center bg-background justify-center gap-8">
      <h1 className="font-serif text-4xl md:text-5xl text-primary font-bold text-center tracking-tight">myQode</h1>
      <div className="w-full max-w-sm rounded-lg bg-card p-6 card-shadow relative">
        <div className="mb-6">
          <p className="text-xl md:text-2xl text-muted-foreground text-center mt-1">Welcome Back!</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-600 text-center p-2 bg-red-50 rounded-md">
              {error}
            </div>
          )}

          <div className="grid">
            <label htmlFor="username" className="text-sm text-muted-foreground">
              Email or Account ID
            </label>
            <input
              id="username"
              name="username"
              type="text" // Changed to text to allow clientid
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-0 focus:border-ring"
              placeholder="Enter your email or Account ID"
              disabled={isLoading}
              autoComplete="email"
            />
          </div>

          <div className="grid">
            <label htmlFor="password" className="text-sm text-muted-foreground">Password</label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 rounded-md border w-full bg-background px-3 pr-10 text-sm outline-none ring-0 focus:border-ring"
                placeholder="Enter your password"
                disabled={isLoading}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                disabled={isLoading}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="text-primary" size={20} /> : <Eye className="text-primary" size={20} />}
              </button>
            </div>

            {/* Forgot password trigger */}
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setFpOpen(true)}
                className="text-xs text-primary hover:underline"
                disabled={isLoading}
              >
                Forgot password?
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm md:text-lg font-semibold bg-primary text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
        
      </div>

      <div className='text-xs md:text-sm text-wrap m-2 text-center'>
          © 2025 Qode Advisors LLP | SEBI Registered PMS No: INP000008914 | All Rights Reserved
        </div>

      {/* Forgot Password Modal */}
      {fpOpen && (
        <div
          aria-modal="true"
          role="dialog"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop */}
          <button
            aria-label="Close"
            onClick={closeForgot}
            className="absolute inset-0 bg-black/50"
          />
          {/* Card */}
          <div className="relative w-full max-w-md rounded-lg border bg-card p-5 mx-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Reset your password</h2>
              <button
                onClick={closeForgot}
                className="p-1 rounded-md hover:bg-muted/60"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
              Enter your account email. If it exists, we&apos;ll send a reset link.
            </p>

            {fpMsg && (
              <div
                className={`mb-3 rounded-md px-3 py-2 text-sm ${
                  fpMsg.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-600'
                }`}
              >
                {fpMsg.text}
              </div>
            )}

            <form onSubmit={handleForgotSubmit} className="space-y-3">
              <div className="grid gap-2">
                <label htmlFor="fp-email" className="text-sm font-medium">Email</label>
                <input
                  id="fp-email"
                  type="email"
                  required
                  value={fpEmail}
                  onChange={(e) => setFpEmail(e.target.value)}
                  className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-0 focus:border-ring"
                  placeholder="you@example.com"
                  disabled={fpSending}
                  autoComplete="email"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeForgot}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted/40"
                  disabled={fpSending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={fpSending || !fpEmail.trim()}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {fpSending ? 'Sending…' : 'Send reset link'}
                </button>
              </div>
            </form>

            <p className="mt-3 text-[11px] text-muted-foreground">
              Tip: The email may take a minute. Also check your spam folder.
            </p>
          </div>
        </div>
      )}
    </main>
  )
}
