// app/reset-password/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react'

export default function ResetPasswordPage() {
  const router = useRouter()
  const search = useSearchParams()
  const token = search.get('token') || ''
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showPw2, setShowPw2] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!token) setError('Invalid or missing reset token. Please use the link from your email.')
  }, [token])

  const pwValid = useMemo(() => {
    // Simple policy: at least 8 chars; tweak as needed
    return newPassword.length >= 8
  }, [newPassword])

  const matchValid = useMemo(() => {
    return newPassword.length > 0 && newPassword === confirmPassword
  }, [newPassword, confirmPassword])

  const canSubmit = token && pwValid && matchValid && !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setSuccess(null)
    setSubmitting(true)

    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unable to reset password')

      setSuccess('Password reset successful. You can now sign in with your new password.')
      // small delay to let user read the success message, then redirect
      setTimeout(() => router.replace('/login'), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center bg-background justify-center p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 card-shadow">
        <div className="mb-6 text-center">
          <h1 className="font-serif text-3xl text-primary font-bold tracking-tight">Reset Password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose a new password for your account.
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
            <XCircle size={18} className="mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-start gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle size={18} className="mt-0.5" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <label htmlFor="new-password" className="text-sm font-medium">
              New Password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 pr-10 text-sm outline-none ring-0 focus:border-ring"
                placeholder="At least 8 characters"
                autoComplete="new-password"
                disabled={!token || submitting}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                aria-label={showPw ? 'Hide password' : 'Show password'}
                disabled={submitting}
              >
                {showPw ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            <PasswordHints okLen={pwValid} />
          </div>

          <div className="grid gap-2">
            <label htmlFor="confirm-password" className="text-sm font-medium">
              Confirm Password
            </label>
            <div className="relative">
              <input
                id="confirm-password"
                type={showPw2 ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 pr-10 text-sm outline-none ring-0 focus:border-ring"
                placeholder="Re-enter new password"
                autoComplete="new-password"
                disabled={!token || submitting}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw2((s) => !s)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                aria-label={showPw2 ? 'Hide password' : 'Show password'}
                disabled={submitting}
              >
                {showPw2 ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {confirmPassword.length > 0 && (
              <p
                className={`text-xs ${matchValid ? 'text-emerald-600' : 'text-red-600'}`}
              >
                {matchValid ? 'Passwords match' : 'Passwords do not match'}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Updating…' : 'Update password'}
          </button>

          <button
            type="button"
            onClick={() => router.push('/login')}
            className="mt-1 inline-flex h-10 w-full items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted/40"
            disabled={submitting}
          >
            Back to sign in
          </button>
        </form>
      </div>
    </main>
  )
}

function PasswordHints({ okLen }: { okLen: boolean }) {
  return (
    <div className="mt-1 text-xs">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-2 w-2 rounded-full ${okLen ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <span className={`${okLen ? 'text-emerald-600' : 'text-red-600'}`}>
          At least 8 characters
        </span>
      </div>
    </div>
  )
}
