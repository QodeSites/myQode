// app/auth/setup-password/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff, Check, X, Mail, Timer } from "lucide-react";

export default function SetupPasswordPage() {
  const [step, setStep] = useState<'email' | 'otp' | 'setup'>('email');
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [clientInfo, setClientInfo] = useState<{clientname: string} | null>(null);
  const [otpTimer, setOtpTimer] = useState(0);
  const [canResendOtp, setCanResendOtp] = useState(true);

  const router = useRouter();

  // OTP Timer countdown
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (otpTimer > 0) {
      interval = setInterval(() => {
        setOtpTimer(prev => {
          if (prev <= 1) {
            setCanResendOtp(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [otpTimer]);

  // Password strength validation
  const passwordRequirements = [
    { text: "At least 8 characters", check: newPassword.length >= 8 },
    { text: "Contains uppercase letter", check: /[A-Z]/.test(newPassword) },
    { text: "Contains lowercase letter", check: /[a-z]/.test(newPassword) },
    { text: "Contains number", check: /\d/.test(newPassword) },
    { text: "Contains special character", check: /[!@#$%^&*(),.?\":{}|<>]/.test(newPassword) },
  ];

  const isPasswordValid = passwordRequirements.every(req => req.check);
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch('/api/auth/send-setup-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send OTP');
      }

      setClientInfo({ clientname: data.clientname });
      setStep('otp');
      setOtpTimer(60); // 60 seconds cooldown
      setCanResendOtp(false);
      setSuccess("OTP sent to your email address. Please check your inbox.");

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!canResendOtp) return;
    
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch('/api/auth/send-setup-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to resend OTP');
      }

      setOtpTimer(60);
      setCanResendOtp(false);
      setSuccess("New OTP sent to your email address.");

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend OTP');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch('/api/auth/verify-setup-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Invalid OTP');
      }

      setStep('setup');
      setSuccess("");

    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isPasswordValid) {
      setError("Please ensure your password meets all requirements");
      return;
    }

    if (!passwordsMatch) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch('/api/auth/complete-otp-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          otp,
          newPassword,
          confirmPassword
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to setup password');
      }

      setSuccess("Password setup completed successfully! Redirecting to login...");
      
      setTimeout(() => {
        router.push('/login?message=setup-complete');
      }, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-primary-bg flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-serif font-bold text-logo-green mb-2">Qode</h1>
          <p className="text-card-text-secondary">Set Up Your Secure Password</p>
        </div>

        <Card className="card-shadow bg-white/50 backdrop-blur-sm border-0">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-heading text-card-text">
              {step === 'email' && 'Enter Your Email'}
              {step === 'otp' && 'Verify OTP'}
              {step === 'setup' && `Welcome, ${clientInfo?.clientname}!`}
            </CardTitle>
            <p className="text-sm text-card-text-secondary mt-2">
              {step === 'email' && 'We\'ll send an OTP to verify your identity'}
              {step === 'otp' && 'Enter the 6-digit code sent to your email'}
              {step === 'setup' && 'Create your new secure password'}
            </p>
          </CardHeader>
          <CardContent>
            {success && (
              <Alert className="mb-4">
                <Check className="h-4 w-4" />
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            {step === 'email' && (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-card-text-secondary mb-1">
                    Email Address
                  </label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email address"
                    required
                    className="bg-primary-bg border-card-text-secondary/30 text-card-text placeholder:text-card-text-secondary"
                  />
                </div>

                {error && (
                  <Alert variant="destructive">
                    <X className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button
                  type="submit"
                  className="w-full bg-logo-green text-button-text font-heading text-lg hover:bg-logo-green/90"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <div className="flex items-center space-x-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                      <span>Sending OTP...</span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <Mail className="h-4 w-4" />
                      <span>Send OTP</span>
                    </div>
                  )}
                </Button>
              </form>
            )}

            {step === 'otp' && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="bg-primary-bg/50 p-3 rounded border text-center">
                  <p className="text-sm text-card-text-secondary">
                    OTP sent to: <strong>{email}</strong>
                  </p>
                </div>

                <div>
                  <label htmlFor="otp" className="block text-sm font-medium text-card-text-secondary mb-1">
                    Enter OTP
                  </label>
                  <Input
                    id="otp"
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 6-digit OTP"
                    maxLength={6}
                    required
                    className="bg-primary-bg border-card-text-secondary/30 text-card-text placeholder:text-card-text-secondary text-center text-lg tracking-widest"
                  />
                </div>

                {error && (
                  <Alert variant="destructive">
                    <X className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button
                  type="submit"
                  className="w-full bg-logo-green text-button-text font-heading text-lg hover:bg-logo-green/90"
                  disabled={isLoading || otp.length !== 6}
                >
                  {isLoading ? "Verifying..." : "Verify OTP"}
                </Button>

                <div className="text-center space-y-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleResendOtp}
                    disabled={!canResendOtp || isLoading}
                    className="text-sm"
                  >
                    {canResendOtp ? (
                      "Resend OTP"
                    ) : (
                      <div className="flex items-center space-x-1">
                        <Timer className="h-3 w-3" />
                        <span>Resend in {formatTime(otpTimer)}</span>
                      </div>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep('email')}
                    className="w-full"
                    disabled={isLoading}
                  >
                    Change Email
                  </Button>
                </div>
              </form>
            )}

            {step === 'setup' && (
              <form onSubmit={handlePasswordSetup} className="space-y-4">
                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-card-text-secondary mb-1">
                    New Password
                  </label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter your new password"
                      required
                      className="bg-primary-bg border-card-text-secondary/30 text-card-text placeholder:text-card-text-secondary pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-card-text-secondary"
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {newPassword.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {passwordRequirements.map((req, index) => (
                        <div key={index} className="flex items-center text-xs">
                          {req.check ? (
                            <Check className="h-3 w-3 text-green-600 mr-2" />
                          ) : (
                            <X className="h-3 w-3 text-red-500 mr-2" />
                          )}
                          <span className={req.check ? "text-green-600" : "text-red-500"}>
                            {req.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-card-text-secondary mb-1">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your new password"
                      required
                      className="bg-primary-bg border-card-text-secondary/30 text-card-text placeholder:text-card-text-secondary pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-card-text-secondary"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {confirmPassword.length > 0 && (
                    <div className="mt-1 flex items-center text-xs">
                      {passwordsMatch ? (
                        <Check className="h-3 w-3 text-green-600 mr-2" />
                      ) : (
                        <X className="h-3 w-3 text-red-500 mr-2" />
                      )}
                      <span className={passwordsMatch ? "text-green-600" : "text-red-500"}>
                        {passwordsMatch ? "Passwords match" : "Passwords do not match"}
                      </span>
                    </div>
                  )}
                </div>

                {error && (
                  <Alert variant="destructive">
                    <X className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button
                  type="submit"
                  className="w-full bg-logo-green text-button-text font-heading text-lg hover:bg-logo-green/90"
                  disabled={isLoading || !isPasswordValid || !passwordsMatch}
                >
                  {isLoading ? "Setting up..." : "Complete Setup"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep('otp')}
                  className="w-full"
                  disabled={isLoading}
                >
                  Back to OTP
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      
      <div className="mt-10 text-center font-heading text-sm text-card-text">
        © 2025 Qode Advisors LLP | SEBI Registered PMS No: INP000008914 | All Rights Reserved
      </div>
    </div>
  );
}