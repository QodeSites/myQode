// app/api/admin/impersonate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { setSessionCookies, type ExtendedClientData } from '@/lib/auth';
import axios, { AxiosError } from 'axios';

interface AuthServiceTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in?: number;
  user?: Record<string, unknown>;
}

interface TokenData {
  adminImpersonation?: boolean;
  clientData?: { clientid: string; clientcode: string }[];
  userContext?: {
    clientid: string;
    clientcode: string;
    email: string;
    groupid: string;
    head_of_family: boolean;
  };
  clientType?: string;
  targetClientName?: string;
  clientCode?: string;
  timestamp?: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Invalid impersonation token' }, { status: 400 });
    }

    let tokenData: TokenData;
    try {
      tokenData = JSON.parse(Buffer.from(token, 'base64').toString());
    } catch {
      return NextResponse.json({ error: 'Invalid token format' }, { status: 400 });
    }

    if (!tokenData.adminImpersonation || !tokenData.userContext?.email || !tokenData.timestamp) {
      return NextResponse.json({ error: 'Invalid impersonation data' }, { status: 400 });
    }

    const tokenAge = Date.now() - tokenData.timestamp;
    if (tokenAge > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Impersonation token expired' }, { status: 400 });
    }

    const email = tokenData.userContext.email.trim().toLowerCase();
    const resolvedClientId =
      process.env.NEXT_ADMIN_AUTH_ID ||
      '';

    if (!process.env.API_AUTH_URL || !resolvedClientId) {
      return NextResponse.json(
        { error: 'Auth service configuration missing' },
        { status: 500 }
      );
    }

    let authTokens: AuthServiceTokenResponse;
    try {
      const apiRes = await axios.post<AuthServiceTokenResponse>(
        `${process.env.API_AUTH_URL}/admin/admin-login/`,
        { email },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Auth-Id': resolvedClientId,
            'x-client-id': process.env.NEXT_PUBLIC_X_CLIENT_ID || '',
          },
        }
      );
      authTokens = apiRes.data;
    } catch (err) {
      const error = err as AxiosError<{ detail?: string; error?: string; message?: string }>;
      const status = error.response?.status;
      const data = error.response?.data;
      const detail =
        typeof data?.detail === 'string'
          ? data.detail
          : typeof data?.error === 'string'
            ? data.error
            : typeof data?.message === 'string'
              ? data.message
              : undefined;

      if (status === 400 || status === 401) {
        return NextResponse.json(
          { error: detail ?? 'Impersonation not allowed' },
          { status: 401 }
        );
      }
      // Log backend response for 5xx / network errors (avoid logging full toJSON in prod if sensitive)
      console.error(
        'Auth service admin-login error:',
        status ?? error.code,
        detail ?? (data && JSON.stringify(data)) ?? error.message
      );
      const clientMessage =
        process.env.NODE_ENV === 'development' && detail
          ? `Auth service error: ${detail}`
          : 'Authentication service unavailable';
      return NextResponse.json(
        { error: clientMessage },
        { status: 502 }
      );
    }

    const { rows } = await query(
      'SELECT clientid, clientcode, email, groupid, head_of_family FROM pms_clients_master WHERE LOWER(TRIM(email)) = $1 LIMIT 1',
      [email]
    );
    const user = rows[0] as ExtendedClientData | undefined;

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const cookieStore = await cookies();
    const accessTokenMaxAge =
      authTokens.expires_in != null && Number.isFinite(authTokens.expires_in)
        ? authTokens.expires_in
        : 60 * 60;

    cookieStore.set('qode-access-token', authTokens.access_token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: accessTokenMaxAge,
    });

    cookieStore.set('qode-refresh-token', authTokens.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
    });

    await setSessionCookies(user);

    cookieStore.set(
      'qode-admin-impersonation',
      JSON.stringify({
        isImpersonating: true,
        targetClient: tokenData.clientCode ?? user.clientcode,
        targetClientName: tokenData.targetClientName ?? '',
        isHeadOfFamily: user.head_of_family,
        impersonatedAt: new Date().toISOString(),
        adminSession: true,
      }),
      {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24,
      }
    );

    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;
    const redirectPath =
      tokenData.clientType === 'DISTRIBUTORS'
        ? '/distributor/fees-distribution'
        : '/portfolio/performance';

    return NextResponse.redirect(`${baseUrl}${redirectPath}`);
  } catch (error) {
    console.error('Impersonation error:', error);
    return NextResponse.json({ error: 'Impersonation failed' }, { status: 500 });
  }
}
