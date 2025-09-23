// app/admin/login/page.tsx
"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Shield, AlertTriangle, Info } from 'lucide-react';

const errorMessages = {
  oauth_error: 'OAuth authentication failed.',
  missing_code: 'Authentication response was incomplete.',
  invalid_state: 'Security validation failed. Please try again.',
  token_exchange_failed: 'Failed to exchange authorization code for access token.',
  profile_fetch_failed: 'Failed to fetch user profile from Microsoft.',
  unauthorized: 'Your Microsoft account is not authorized for admin access.',
  callback_error: 'An unexpected error occurred during authentication.',
  session_expired: 'Your session has expired. Please log in again.',
};

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  
  const error = searchParams.get('error') as keyof typeof errorMessages;
  const errorDetails = searchParams.get('details');
  const userEmail = searchParams.get('email');
  const redirectTo = searchParams.get('redirect') || '/admin/onboarding';

  useEffect(() => {
    // Check if already authenticated
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/admin/session');
      if (response.ok) {
        const data = await response.json();
        if (data.authenticated) {
          router.replace(redirectTo);
          return;
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setChecking(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setLoading(true);
    try {
      const loginUrl = `/api/auth/microsoft?redirect=${encodeURIComponent(redirectTo)}`;
      window.location.href = loginUrl;
    } catch (error) {
      console.error('Login failed:', error);
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Admin Access</CardTitle>
          <p className="text-muted-foreground">
            Sign in with your Microsoft account to access the admin dashboard
          </p>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p><strong>Error:</strong> {errorMessages[error] || 'An unexpected error occurred.'}</p>
                  {errorDetails && (
                    <details className="text-xs">
                      <summary className="cursor-pointer font-medium">Technical Details</summary>
                      <pre className="mt-2 p-2 bg-destructive/10 rounded text-xs overflow-auto">
                        {decodeURIComponent(errorDetails)}
                      </pre>
                    </details>
                  )}
                  {userEmail && (
                    <p className="text-xs">
                      <strong>Account:</strong> {userEmail}
                    </p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Environment Check Info */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <div className="text-xs space-y-1">
                <p><strong>Debug Info:</strong></p>
                <p>• Environment: {process.env.NODE_ENV}</p>
                <p>• Base URL: {typeof window !== 'undefined' ? window.location.origin : 'Loading...'}</p>
                <p>• Redirect: {redirectTo}</p>
              </div>
            </AlertDescription>
          </Alert>

          <Button 
            onClick={handleMicrosoftLogin}
            disabled={loading}
            className="w-full bg-emerald-900  h-12"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                  <path fill="#f35325" d="M1 1h10v10H1z"/>
                  <path fill="#81bc06" d="M13 1h10v10H13z"/>
                  <path fill="#05a6f0" d="M1 13h10v10H1z"/>
                  <path fill="#ffba08" d="M13 13h10v10H13z"/>
                </svg>
                Sign in with Microsoft
              </>
            )}
          </Button>

          <div className="text-center text-sm text-muted-foreground space-y-2">
            <p>Only authorized administrators can access this area.</p>
            <p>Contact your IT administrator if you need access.</p>
            
            {/* Development help */}
            {process.env.NODE_ENV === 'development' && (
              <details className="text-xs mt-4">
                <summary className="cursor-pointer font-medium">Development Setup Help</summary>
                <div className="mt-2 p-3 bg-muted rounded text-left space-y-2">
                  <p><strong>Required Environment Variables:</strong></p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>MICROSOFT_CLIENT_ID</li>
                    <li>MICROSOFT_CLIENT_SECRET</li>
                    <li>MICROSOFT_TENANT_ID</li>
                    <li>NEXTAUTH_URL</li>
                    <li>NEXTAUTH_SECRET</li>
                    <li>ADMIN_AUTHORIZED_EMAILS (optional)</li>
                  </ul>
                  <p className="text-xs mt-2">
                    Check console logs for detailed error information.
                  </p>
                </div>
              </details>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}