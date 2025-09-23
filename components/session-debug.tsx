// components/session-debug.tsx
"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCw, CheckCircle, XCircle, Clock, Info } from 'lucide-react';

interface SessionData {
  success: boolean;
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  expiresAt?: number;
  expiresIn?: number;
  error?: string;
}

export function SessionDebug() {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkSession = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/admin/session', {
        credentials: 'include', // Important for cookies
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      const data = await response.json();
      setSessionData(data);
      setLastChecked(new Date());
      
      console.log('Session check result:', data);
    } catch (error) {
      console.error('Session check failed:', error);
      setSessionData({
        success: false,
        authenticated: false,
        error: 'Network error'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  const getStatusIcon = () => {
    if (loading) return <RefreshCw className="h-4 w-4 animate-spin" />;
    if (sessionData?.authenticated) return <CheckCircle className="h-4 w-4 text-green-500" />;
    return <XCircle className="h-4 w-4 text-red-500" />;
  };

  const getStatusBadge = () => {
    if (loading) return <Badge variant="outline">Checking...</Badge>;
    if (sessionData?.authenticated) return <Badge className="bg-green-100 text-green-800">Authenticated</Badge>;
    return <Badge variant="destructive">Not Authenticated</Badge>;
  };

  const formatTimeRemaining = (expiresIn: number) => {
    const minutes = Math.floor(expiresIn / (1000 * 60));
    const seconds = Math.floor((expiresIn % (1000 * 60)) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          {getStatusIcon()}
          <span>Admin Session Debug</span>
          {getStatusBadge()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Last checked: {lastChecked ? lastChecked.toLocaleTimeString() : 'Never'}
          </span>
          <Button
            onClick={checkSession}
            disabled={loading}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {sessionData && (
          <div className="space-y-3">
            {sessionData.authenticated && sessionData.user && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <p><strong>User:</strong> {sessionData.user.name} ({sessionData.user.email})</p>
                    <p><strong>User ID:</strong> {sessionData.user.id}</p>
                    {sessionData.expiresAt && (
                      <p><strong>Expires:</strong> {new Date(sessionData.expiresAt).toLocaleString()}</p>
                    )}
                    {sessionData.expiresIn && (
                      <p><strong>Time Remaining:</strong> {formatTimeRemaining(sessionData.expiresIn)}</p>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {!sessionData.authenticated && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  <p><strong>Authentication Failed:</strong> {sessionData.error || 'Unknown error'}</p>
                </AlertDescription>
              </Alert>
            )}

            <div className="bg-muted p-3 rounded text-sm">
              <p className="font-medium mb-2">Raw Session Data:</p>
              <pre className="text-xs overflow-auto">
                {JSON.stringify(sessionData, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <p className="text-sm">
              This debug component checks your admin session status. 
              Remove this component from production builds.
            </p>
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <h4 className="font-medium text-sm">Quick Actions:</h4>
          <div className="flex space-x-2">
            <Button
              onClick={() => window.location.href = '/admin/login'}
              size="sm"
              variant="outline"
            >
              Go to Login
            </Button>
            <Button
              onClick={async () => {
                await fetch('/api/auth/admin/session', { method: 'DELETE' });
                checkSession();
              }}
              size="sm"
              variant="outline"
            >
              Clear Session
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}