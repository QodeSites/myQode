'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, X, ArrowLeft, Mail, Lock, Shield, Zap } from 'lucide-react'
import { useClient } from '@/contexts/ClientContext'

type LoginStep = 'username' | 'password' | 'otp-verification' | 'password-setup' | 'dev-bypass'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  
  const [currentStep, setCurrentStep] = useState<LoginStep>('username')
  const [userEmail, setUserEmail] = useState('')
  const [requirePasswordSetup, setRequirePasswordSetup] = useState(false)
  
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Forgot password modal state
  const [fpOpen, setFpOpen] = useState(false)
  const [fpEmail, setFpEmail] = useState('')
  const [fpSending, setFpSending] = useState(false)
  const [fpMsg, setFpMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const router = useRouter()
  const { refresh } = useClient()
  
  // Check if in development
  const isDevelopment = process.env.NODE_ENV === 'development'

  const checkPasswordStatus = async () => {
    if (!username.trim()) {
      setError('Please enter your email or Account ID')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          action: 'check-password-status', 
          username: username.trim() 
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to check password status')
      }

      if (data.requirePasswordSetup) {
        setRequirePasswordSetup(true)
        setUserEmail(data.email)
        setCurrentStep('username')
        setError('Password setup required. Click "Send Verification Code" to continue.')
      } else {
        setCurrentStep('password')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check password status')
    } finally {
      setIsLoading(false)
    }
  }

  const devBypassLogin = async () => {
    if (!userEmail.trim()) {
      setError('Please enter an email address')
      return
    }

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
        body: JSON.stringify({ 
          action: 'dev-bypass-login', 
          username: userEmail.trim()
        }),
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Dev bypass login failed')
      }

      await refresh()
      router.push('/portfolio/performance')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dev bypass login failed')
    } finally {
      setIsLoading(false)
    }
  }

  const sendSetupOtp = async () => {
    setIsLoading(true)
    setError('')

    try {
      // In development, skip OTP and go directly to password setup
      if (isDevelopment) {
        setOtp('000000')
        setCurrentStep('password-setup')
        return
      }

      const response = await fetch('/api/auth/send-setup-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          email: userEmail
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send verification code')
      }

      setCurrentStep('otp-verification')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code')
    } finally {
      setIsLoading(false)
    }
  }

  const verifyOtp = async () => {
    if (!otp.trim()) {
      setError('Please enter the verification code')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          action: 'verify-setup-otp', 
          username: userEmail, 
          otp: otp.trim() 
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Invalid verification code')
      }

      setCurrentStep('password-setup')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsLoading(false)
    }
  }

  const completePasswordSetup = async () => {
    if (!newPassword || !confirmPassword) {
      setError('Please fill in all fields')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

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
        body: JSON.stringify({ 
          action: 'complete-password-setup', 
          username: userEmail, 
          otp: otp.trim(),
          newPassword,
          confirmPassword 
        }),
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Password setup failed')
      }

      await refresh()
      router.push('/portfolio/performance')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password setup failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegularLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // In dev mode, password is optional
    if (!isDevelopment && (!username || !password)) {
      setError('Username and password are required')
      return
    }
    
    if (!username) {
      setError('Please enter your email or Account ID')
      return
    }

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
        body: JSON.stringify({ 
          username, 
          password: isDevelopment ? '' : password // Send empty password in dev mode
        }),
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Login failed')

      await refresh()
      router.push('/portfolio/performance')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  const goBack = () => {
    setError('')
    if (currentStep === 'password') {
      setCurrentStep('username')
      setPassword('')
    } else if (currentStep === 'otp-verification') {
      setCurrentStep('username')
      setOtp('')
      setRequirePasswordSetup(false)
      setUserEmail('')
    } else if (currentStep === 'password-setup') {
      setCurrentStep('otp-verification')
      setNewPassword('')
      setConfirmPassword('')
    } else if (currentStep === 'dev-bypass') {
      setCurrentStep('username')
      setUserEmail('')
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
        text: 'If that email exists, a reset link has been sent. Be sure to check your email',
      })

      setTimeout(() => {
        closeForgot()
      }, 2000)
      
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

  const getStepTitle = () => {
    switch (currentStep) {
      case 'username': return 'Welcome!'
      case 'password': return 'Enter Password'
      case 'otp-verification': return 'Email Verification'
      case 'password-setup': return 'Set Your Password'
      case 'dev-bypass': return 'Dev Mode Login'
      default: return 'Welcome!'
    }
  }

  const getStepIcon = () => {
    switch (currentStep) {
      case 'username': return <Mail className="w-5 h-5 text-primary" />
      case 'password': return <Lock className="w-5 h-5 text-primary" />
      case 'otp-verification': return <Shield className="w-5 h-5 text-primary" />
      case 'password-setup': return <Lock className="w-5 h-5 text-primary" />
      case 'dev-bypass': return <Zap className="w-5 h-5 text-amber-500" />
      default: return <Mail className="w-5 h-5 text-primary" />
    }
  }

  // Check password strength
  const passwordStrength = {
    length: newPassword.length >= 8,
    uppercase: /[A-Z]/.test(newPassword),
    lowercase: /[a-z]/.test(newPassword),
    numbers: /\d/.test(newPassword),
    special: /[!@#$%^&*(),.?\":{}|<>]/.test(newPassword),
  }

  const isPasswordValid = isDevelopment 
    ? newPassword.length > 0 && confirmPassword.length > 0
    : Object.values(passwordStrength).every(Boolean)

  return (
    <main className="min-h-screen flex flex-col items-center bg-background justify-center gap-8">
      <h1 className="font-serif text-4xl md:text-5xl text-primary font-bold text-center tracking-tight">
        <sub className="text-2xl">my</sub>Qode
      </h1>
      
      <div className="w-full max-w-sm rounded-lg bg-card p-6 card-shadow relative">
        {/* Header with back button */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            {currentStep !== 'username' && (
              <button
                onClick={goBack}
                className="p-2 hover:bg-muted/60 rounded-md transition-colors"
                disabled={isLoading}
              >
                <ArrowLeft className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            <div className="flex-1 flex items-center justify-center gap-2">
              {getStepIcon()}
            </div>
            {currentStep !== 'username' && <div className="w-8" />}
          </div>
          <p className="text-xl md:text-2xl text-muted-foreground text-center mt-2">
            {getStepTitle()}
          </p>
          
          {currentStep === 'otp-verification' && (
            <p className="text-sm text-muted-foreground text-center mt-2">
              We've sent a verification code to {userEmail}
            </p>
          )}

          {isDevelopment && currentStep === 'password-setup' && (
            <p className="text-xs bg-amber-50 text-amber-700 rounded px-2 py-1 mt-2 text-center">
              Development mode: Password validation skipped
            </p>
          )}

          {isDevelopment && currentStep === 'dev-bypass' && (
            <p className="text-xs bg-amber-50 text-amber-700 rounded px-2 py-1 mt-2 text-center">
              Development mode: Bypass any email
            </p>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-600 text-center p-2 bg-red-50 rounded-md mb-4">
            {error}
          </div>
        )}

        {/* Username Step */}
        {currentStep === 'username' && (
          <div className="space-y-4">
            <div className="grid gap-2">
              <label htmlFor="username" className="text-sm font-medium">
                Email or Account ID
              </label>
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-0 focus:border-ring"
                placeholder="you@example.com or Account ID"
                disabled={isLoading || requirePasswordSetup}
                autoComplete="email"
                onKeyPress={(e) => e.key === 'Enter' && !requirePasswordSetup && checkPasswordStatus()}
              />
            </div>

            {!requirePasswordSetup ? (
              <button
                onClick={checkPasswordStatus}
                disabled={isLoading || !username.trim()}
                className="inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm md:text-lg font-semibold bg-primary text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {isLoading ? 'Checking...' : 'Continue'}
              </button>
            ) : (
              <>
                <div className="text-sm text-blue-600 text-center p-2 bg-blue-50 rounded-md">
                  Password setup required for {userEmail}
                </div>
                <button
                  onClick={sendSetupOtp}
                  disabled={isLoading}
                  className="inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm md:text-lg font-semibold bg-primary text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
                >
                  {isLoading ? 'Sending...' : isDevelopment ? 'Continue to Setup' : 'Send Verification Code'}
                </button>
              </>
            )}

            {/* Dev Mode Bypass Button */}
            {isDevelopment && !requirePasswordSetup && (
              <button
                onClick={() => {
                  setCurrentStep('dev-bypass')
                  setUserEmail('')
                  setError('')
                }}
                disabled={isLoading}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm md:text-lg font-semibold bg-amber-100 text-amber-900 border border-amber-300 transition-colors hover:bg-amber-200 disabled:opacity-50"
              >
                <Zap className="w-4 h-4" />
                Dev Mode: Bypass Login
              </button>
            )}
          </div>
        )}

        {/* Password Step */}
        {currentStep === 'password' && (
          <form onSubmit={handleRegularLogin} className="space-y-4">
            <div className="grid gap-2">
              <label htmlFor="current-username" className="text-sm text-muted-foreground">
                Account
              </label>
              <input
                id="current-username"
                type="text"
                value={username}
                disabled
                className="h-10 rounded-md border bg-muted px-3 text-sm outline-none"
              />
            </div>

            <div className="grid">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm text-muted-foreground">
                  Password
                  {isDevelopment && <span className="text-xs text-amber-600 ml-2">(optional in dev)</span>}
                </label>
              </div>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required={!isDevelopment}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 rounded-md border w-full bg-background px-3 pr-10 text-sm outline-none ring-0 focus:border-ring"
                  placeholder={isDevelopment ? "Leave blank in dev mode (optional)" : "Enter your password"}
                  disabled={isLoading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                  disabled={isLoading}
                >
                  {showPassword ? <EyeOff className="text-primary" size={20} /> : <Eye className="text-primary" size={20} />}
                </button>
              </div>

              <div className="flex items-center justify-end mt-1">
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

            {isDevelopment && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-2">
                <p className="text-xs text-amber-700">
                  <strong>Development Mode:</strong> Leave password blank to login to any account instantly
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm md:text-lg font-semibold bg-primary text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {isLoading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
        )}

        {/* OTP Verification Step */}
        {currentStep === 'otp-verification' && (
          <div className="space-y-4">
            <div className="grid gap-2">
              <label htmlFor="otp" className="text-sm font-medium">
                Verification Code
              </label>
              <input
                id="otp"
                name="otp"
                type="text"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-0 focus:border-ring text-center text-lg tracking-widest"
                placeholder="000000"
                disabled={isLoading}
                autoComplete="one-time-code"
                onKeyPress={(e) => e.key === 'Enter' && verifyOtp()}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={sendSetupOtp}
                disabled={isLoading}
                className="text-sm text-primary hover:underline disabled:opacity-50"
              >
                Resend code
              </button>
            </div>

            <button
              onClick={verifyOtp}
              disabled={isLoading || otp.length !== 6}
              className="inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm md:text-lg font-semibold bg-primary text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {isLoading ? 'Verifying...' : 'Verify Code'}
            </button>
          </div>
        )}

        {/* Password Setup Step */}
        {currentStep === 'password-setup' && (
          <div className="space-y-4">
            <div className="grid gap-2">
              <label htmlFor="new-password" className="text-sm font-medium">
                New Password
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  name="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-10 rounded-md border w-full bg-background px-3 pr-10 text-sm outline-none ring-0 focus:border-ring"
                  placeholder="Create a strong password"
                  disabled={isLoading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                  disabled={isLoading}
                >
                  {showNewPassword ? <EyeOff className="text-primary" size={20} /> : <Eye className="text-primary" size={20} />}
                </button>
              </div>
            </div>

            <div className="grid gap-2">
              <label htmlFor="confirm-password" className="text-sm font-medium">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-10 rounded-md border w-full bg-background px-3 pr-10 text-sm outline-none ring-0 focus:border-ring"
                  placeholder="Confirm your password"
                  disabled={isLoading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                  disabled={isLoading}
                >
                  {showConfirmPassword ? <EyeOff className="text-primary" size={20} /> : <Eye className="text-primary" size={20} />}
                </button>
              </div>
            </div>

            {/* Only show password requirements in production */}
            {!isDevelopment && (
              <div className="text-xs text-muted-foreground">
                Password must contain:
                <ul className="mt-1 space-y-1 pl-4">
                  <li className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${passwordStrength.length ? 'bg-green-500' : 'bg-gray-300'}`} />
                    At least 8 characters
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${passwordStrength.uppercase ? 'bg-green-500' : 'bg-gray-300'}`} />
                    Uppercase letter
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${passwordStrength.lowercase ? 'bg-green-500' : 'bg-gray-300'}`} />
                    Lowercase letter
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${passwordStrength.numbers ? 'bg-green-500' : 'bg-gray-300'}`} />
                    Number
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${passwordStrength.special ? 'bg-green-500' : 'bg-gray-300'}`} />
                    Special character
                  </li>
                </ul>
              </div>
            )}

            <button
              onClick={completePasswordSetup}
              disabled={isLoading || !newPassword || !confirmPassword || (!isDevelopment && !isPasswordValid)}
              className="inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm md:text-lg font-semibold bg-primary text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {isLoading ? 'Setting Password...' : 'Complete Setup & Sign In'}
            </button>
          </div>
        )}

        {/* Dev Bypass Step */}
        {currentStep === 'dev-bypass' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-2">
              <p className="text-xs text-amber-700">
                <strong>Development mode:</strong> Enter any email address to bypass authentication
              </p>
            </div>

            <div className="grid gap-2">
              <label htmlFor="dev-email" className="text-sm font-medium">
                Email Address
              </label>
              <input
                id="dev-email"
                name="dev-email"
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-0 focus:border-ring"
                placeholder="any@example.com"
                disabled={isLoading}
                autoComplete="email"
                onKeyPress={(e) => e.key === 'Enter' && devBypassLogin()}
              />
            </div>

            <button
              onClick={devBypassLogin}
              disabled={isLoading || !userEmail.trim()}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm md:text-lg font-semibold bg-amber-500 text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
            >
              <Zap className="w-4 h-4" />
              {isLoading ? 'Logging In...' : 'Login'}
            </button>
          </div>
        )}
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
          <button
            aria-label="Close"
            onClick={closeForgot}
            className="absolute inset-0 bg-black/50"
          />
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