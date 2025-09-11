// app/login/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { useClient } from '@/contexts/ClientContext'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()
  const { refresh } = useClient() // Get refresh function from context

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
        credentials: 'include', // Ensure cookies are sent
      })

      const data = await response.json()
      console.log('Login response:', response.status, data) // Debug log

      if (!response.ok) {
        throw new Error(data.error || 'Login failed')
      }

      // Refresh client data before redirecting
      console.log('Triggering client data refresh')
      await refresh() // Fetch client data
      console.log('Redirecting to dashboard')
      router.push('/dashboard')
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Login failed')
      console.error('Login error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center bg-background justify-center p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 card-shadow">
        <div className="mb-6">
          <h1 className="font-serif text-3xl text-primary font-bold text-center tracking-tight">myQode</h1>
          <p className="text-sm text-muted-foreground text-center mt-1">Sign in to access your dashboard.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-600 text-center p-2 bg-red-50 rounded-md">
              {error}
            </div>
          )}
          
          <div className="grid gap-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-0 focus:border-ring"
              placeholder="you@example.com"
              disabled={isLoading}
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 rounded-md border w-full bg-background px-3 pr-10 text-sm outline-none ring-0 focus:border-ring"
                placeholder="••••••••"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                disabled={isLoading}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}