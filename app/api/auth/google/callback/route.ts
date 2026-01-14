import { OAuth2Client } from 'google-auth-library';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { query } from '@/lib/db';
import { signAccessToken } from '@/lib/auth/jwt';
import { generateRefreshToken, hashToken } from '@/lib/auth/refresh-token';

// POST handler for google login
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, redirectUri } = body;

    if (!code) {
      return NextResponse.json({ error: 'Authorization code is required' }, { status: 400 });
    }

    // Initialize Google OAuth2 Client
    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    // Exchange the code for tokens
    const { tokens } = await oauth2Client.getToken({
      code,
      redirect_uri: redirectUri || 'https://auth.expo.io/@qodetech/myQode'
    });
    oauth2Client.setCredentials(tokens);

    // Verify Google id-token and get user info
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();

    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    const { email, name, sub: googleId, picture } = payload;

    const initialResult = await query(
      `SELECT id, clientid, clientcode, clienttype, email, groupid, password, head_of_family 
       FROM pms_clients_master 
       WHERE email = $1`,
      [email]
    );

    if (initialResult.rows.length === 0) {
      // Optionally: register user here if you want to auto-create new clients for Google SSO
      return NextResponse.json(
        { error: 'User not found, please register your account first.' },
        { status: 404 }
      );
    }

    const user = initialResult.rows[0];

    // Consider password check bypassed for Google login

    // Update user login info
    await query(
      `UPDATE pms_clients_master 
       SET last_login_at = NOW(), 
           login_count = COALESCE(login_count, 0) + 1
       WHERE clientcode = $1`,
      [user.clientcode]
    );

    // Set session cookies with head of family information as in the regular login
    await setSessionCookies(user);

    // Get associated client records based on head of family status
    const { groupid, head_of_family } = user;
    let result;

    if (head_of_family) {
      result = await query(
        'SELECT clientid, clientcode FROM pms_clients_master WHERE groupid = $1',
        [groupid]
      );
    } else {
      result = await query(
        'SELECT clientid, clientcode FROM pms_clients_master WHERE email = $1',
        [email]
      );
    }

    const clientData = result.rows.map((row: any) => ({
      clientid: row.clientid,
      clientcode: row.clientcode,
    }));

    // Issue access/refresh tokens as per the regular login logic
    const accessToken = await signAccessToken({
      sub: user.clientcode,
      scope: ["research:run", "portfolio:read"],
    });

    const refreshToken = generateRefreshToken();

    await query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked) VALUES ($1, $2, $3, $4, false)`,
      [
        crypto.randomUUID(),
        user.clientcode,
        hashToken(refreshToken),
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ]
    );

    // Set refreshToken cookie for web clients (SAME logic as web client in normal login)
    const clientType = body.clientType || "web";
    if (clientType === "web") {
      const cookieStore = await cookies();
      cookieStore.set({
        name: "refresh_token",
        value: refreshToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Google login successful',
      clients: clientData,
      accessToken,
      refreshToken,
      isHeadOfFamily: !!user.head_of_family,
      user: {
        email: user.email,
        name: name,
        googleId,
        picture,
      }
    });
  } catch (error: any) {
    console.error('[Google OAuth Error]:', error);
    return NextResponse.json({
      error: 'Google authentication failed',
      detail: error?.message || error?.toString()
    }, { status: 500 });
  }
}

// Import from login/route.ts
async function setSessionCookies(user: any) {
  const cookieStore = await cookies()
  const { groupid, email, head_of_family } = user
  let result
  if (head_of_family) {
    result = await query(
      'SELECT clientid, clientcode FROM pms_clients_master WHERE groupid = $1',
      [groupid]
    );
  } else {
    result = await query(
      'SELECT clientid, clientcode FROM pms_clients_master WHERE email = $1',
      [email]
    );
  }

  const clientData = result.rows.map((row: any) => ({
    clientid: row.clientid,
    clientcode: row.clientcode
  }));

  cookieStore.set('qode-auth', '1', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  });

  cookieStore.set('qode-clients', JSON.stringify(clientData), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  });

  cookieStore.set('qode-head-of-family', user.head_of_family ? 'true' : 'false', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  });

  const userContext = {
    clientid: user.clientid,
    clientcode: user.clientcode,
    email: user.email,
    groupid: user.groupid,
    head_of_family: user.head_of_family
  };

  cookieStore.set('qode-user-context', JSON.stringify(userContext), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  });
}
