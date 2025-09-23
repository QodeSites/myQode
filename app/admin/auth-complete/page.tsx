// app/admin/auth-complete/page.tsx
"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function AuthCompletePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('processing');

  useEffect(() => {
    completeAuth();
  }, []);

  const completeAuth = async () => {
    try {
      const token = searchParams.get('token');
      const redirect = searchParams.get('redirect') || '/admin/onboarding';

      if (!token) {
        setStatus('error');
        return;
      }

      // Send token to server to set cookie
      const response = await fetch('/api/auth/admin/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (response.ok) {
        setStatus('success');
        // Small delay to ensure cookie is set
        setTimeout(() => {
          router.replace(redirect);
        }, 500);
      } else {
        setStatus('error');
      }
    } catch (error) {
      console.error('Auth completion error:', error);
      setStatus('error');
    }
  };

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-red-600">Authentication Failed</p>
          <button 
            onClick={() => router.push('/admin/login')}
            className="mt-4 px-4 py-2 bg-primary text-white rounded"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          {status === 'processing' ? 'Completing authentication...' : 'Redirecting to dashboard...'}
        </p>
      </div>
    </div>
  );
}