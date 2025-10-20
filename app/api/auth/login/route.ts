import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'

interface ClientData {
  clientid: string;
  clientcode: string;
}

interface ExtendedClientData {
  clientid: string;
  clientcode: string;
  email: string;
  groupid: string;
  head_of_family: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const { username, password, action, otp, newPassword, confirmPassword } = await request.json()
    const isDevelopment = process.env.NODE_ENV === 'development'

    // DEV MODE: Bypass authentication for any email in development
    if (isDevelopment && action === 'dev-bypass-login') {
      return await handleDevBypassLogin(username)
    }

    // Handle OTP verification for password setup
    if (action === 'verify-setup-otp') {
      return await handleVerifySetupOtp(username, otp)
    }

    // Handle password setup completion
    if (action === 'complete-password-setup') {
      return await handleCompletePasswordSetup(username, otp, newPassword, confirmPassword)
    }

    // Handle sending OTP for password setup - redirect to separate API
    if (action === 'send-setup-otp') {
      return NextResponse.json(
        { error: 'Use /api/auth/send-setup-otp endpoint' },
        { status: 400 }
      )
    }

    // Handle password status check
    if (action === 'check-password-status') {
      return await handlePasswordStatusCheck(username)
    }

    // DEV MODE: Skip password validation entirely - login with just email/clientcode
    if (isDevelopment && username && !password) {
      return await handleDevPasswordlessLogin(username)
    }

    // Regular login flow - requires password
    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    // Check if password is set for this user
    const passwordCheck = await query(
      'SELECT password FROM pms_clients_master WHERE email = $1 OR clientcode = $1 LIMIT 1',
      [username]
    )

    if (passwordCheck.rows.length === 0) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    const currentPassword = passwordCheck.rows[0].password
    const isDefaultPassword = currentPassword === 'Qode@123' || !currentPassword

    if (isDefaultPassword) {
      return NextResponse.json(
        { requirePasswordSetup: true, message: 'Password setup required' },
        { status: 200 }
      )
    }

    // Proceed with regular login - get extended user data
    const initialResult = await query(
      `SELECT clientid, clientcode, email, groupid, password, head_of_family 
       FROM pms_clients_master 
       WHERE (email = $1 OR clientcode = $1)`,
      [username]
    )

    if (initialResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    const user = initialResult.rows[0]
    
    // Verify password (assuming bcrypt for hashed passwords)
    const isPasswordValid = await bcrypt.compare(password, user.password)
    
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Set session cookies with head of family information
    await setSessionCookies(user)

    // Get associated client records for response based on head of family status
    const { groupid, email, head_of_family } = user
    let result;
    
    if (head_of_family) {
      // If head of family, get all accounts in the group
      result = await query(
        'SELECT clientid, clientcode FROM pms_clients_master WHERE groupid = $1',
        [groupid]
      )
    } else {
      // If not head of family, get only accounts with this email
      result = await query(
        'SELECT clientid, clientcode FROM pms_clients_master WHERE email = $1',
        [email]
      )
    }

    const clientData: ClientData[] = result.rows.map(row => ({
      clientid: row.clientid,
      clientcode: row.clientcode
    }))

    return NextResponse.json({
      success: true,
      message: 'Login successful',
      clients: clientData,
      isHeadOfFamily: user.head_of_family
    })

  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DEV MODE: Passwordless login - login to any account without password
async function handleDevPasswordlessLogin(username: string) {
  try {
    if (!username || !username.trim()) {
      return NextResponse.json(
        { error: 'Email or Account ID is required' },
        { status: 400 }
      )
    }

    const trimmedUsername = username.trim()
    console.log(`[DEV] Passwordless login attempt for: ${trimmedUsername}`)

    // Try to find existing user by email or clientcode
    let userResult = await query(
      `SELECT clientid, clientcode, email, groupid, head_of_family 
       FROM pms_clients_master 
       WHERE email = $1 OR clientcode = $1 LIMIT 1`,
      [trimmedUsername]
    )

    let user;

    // If user exists, use their data
    if (userResult.rows.length > 0) {
      user = userResult.rows[0]
      console.log(`[DEV] Found existing user: ${user.email}`)
    } else {
      // If user doesn't exist, create mock user data
      console.log(`[DEV] Creating mock user for: ${trimmedUsername}`)
      user = {
        clientid: `DEV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        clientcode: `DEV-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        email: trimmedUsername,
        groupid: `group-${trimmedUsername.split('@')[0] || 'dev'}`,
        head_of_family: true
      }
    }

    // Set session cookies
    const cookieStore = await cookies()
    
    // Set authentication cookie
    cookieStore.set('qode-auth', '1', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    })
    
    // Client data
    const clientData: ClientData[] = [
      {
        clientid: user.clientid,
        clientcode: user.clientcode
      }
    ]

    // Set client data cookie
    cookieStore.set('qode-clients', JSON.stringify(clientData), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    })

    // Set head of family status cookie
    cookieStore.set('qode-head-of-family', 'true', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    })

    // Set user context cookie
    const userContext = {
      clientid: user.clientid,
      clientcode: user.clientcode,
      email: user.email,
      groupid: user.groupid,
      head_of_family: user.head_of_family
    }
    
    cookieStore.set('qode-user-context', JSON.stringify(userContext), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    })

    console.log(`[DEV] Passwordless login successful for: ${user.email}`)

    return NextResponse.json({
      success: true,
      message: 'Development: Passwordless login successful',
      clients: clientData,
      isHeadOfFamily: true,
      isDev: true,
      devUser: user.email
    })

  } catch (error) {
    console.error('[DEV] Passwordless login error:', error)
    return NextResponse.json(
      { error: 'Passwordless login failed' },
      { status: 500 }
    )
  }
}

// DEV MODE: Bypass login for any email in development
async function handleDevBypassLogin(email: string) {
  try {
    if (!email || !email.trim()) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const trimmedEmail = email.trim()

    // Try to find existing user
    let userResult = await query(
      `SELECT clientid, clientcode, email, groupid, head_of_family 
       FROM pms_clients_master 
       WHERE email = $1 LIMIT 1`,
      [trimmedEmail]
    )

    let user;

    // If user doesn't exist in development, create mock user data
    if (userResult.rows.length === 0) {
      console.warn(`[DEV] Creating mock session for non-existent email: ${trimmedEmail}`)
      
      // Generate mock data for development
      user = {
        clientid: `DEV-${Date.now()}`,
        clientcode: `DEV-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        email: trimmedEmail,
        groupid: `group-${trimmedEmail.split('@')[0]}`,
        head_of_family: true
      }
    } else {
      user = userResult.rows[0]
    }

    // Set session cookies
    const cookieStore = await cookies()
    
    // Set authentication cookie
    cookieStore.set('qode-auth', '1', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    })
    
    // Mock client data
    const clientData: ClientData[] = [
      {
        clientid: user.clientid,
        clientcode: user.clientcode
      }
    ]

    // Set client data cookie
    cookieStore.set('qode-clients', JSON.stringify(clientData), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    })

    // Set head of family status cookie
    cookieStore.set('qode-head-of-family', 'true', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    })

    // Set user context cookie
    const userContext = {
      clientid: user.clientid,
      clientcode: user.clientcode,
      email: user.email,
      groupid: user.groupid,
      head_of_family: user.head_of_family
    }
    
    cookieStore.set('qode-user-context', JSON.stringify(userContext), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24
    })

    return NextResponse.json({
      success: true,
      message: 'Dev bypass login successful',
      clients: clientData,
      isHeadOfFamily: true,
      isDev: true
    })

  } catch (error) {
    console.error('Dev bypass login error:', error)
    return NextResponse.json(
      { error: 'Dev bypass login failed' },
      { status: 500 }
    )
  }
}

async function setSessionCookies(user: ExtendedClientData) {
  const cookieStore = await cookies()
  
  // Get associated client records based on head of family status
  const { groupid, email, head_of_family } = user
  let result;
  
  if (head_of_family) {
    // If head of family, get all accounts in the group
    result = await query(
      'SELECT clientid, clientcode FROM pms_clients_master WHERE groupid = $1',
      [groupid]
    )
  } else {
    // If not head of family, get only accounts with this email
    result = await query(
      'SELECT clientid, clientcode FROM pms_clients_master WHERE email = $1',
      [email]
    )
  }

  const clientData: ClientData[] = result.rows.map(row => ({
    clientid: row.clientid,
    clientcode: row.clientcode
  }))

  // Set authentication cookie
  cookieStore.set('qode-auth', '1', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  })
  
  // Set client data cookie
  cookieStore.set('qode-clients', JSON.stringify(clientData), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  })

  // Set head of family status cookie
  cookieStore.set('qode-head-of-family', user.head_of_family ? 'true' : 'false', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  })

  // Set user context cookie for easy access
  const userContext = {
    clientid: user.clientid,
    clientcode: user.clientcode,
    email: user.email,
    groupid: user.groupid,
    head_of_family: user.head_of_family
  }
  
  cookieStore.set('qode-user-context', JSON.stringify(userContext), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  })
}

async function handlePasswordStatusCheck(username: string) {
  try {
    const result = await query(
      'SELECT password, email, clientname FROM pms_clients_master WHERE email = $1 OR clientcode = $1 LIMIT 1',
      [username]
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    const { password, email } = result.rows[0]
    const requirePasswordSetup = password === 'Qode@123' || !password

    return NextResponse.json({
      requirePasswordSetup,
      email: requirePasswordSetup ? email : undefined
    })

  } catch (error) {
    console.error('Password status check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function handleVerifySetupOtp(email: string, otp: string) {
  try {
    const result = await query(
      `SELECT clientid FROM pms_clients_master 
       WHERE email = $1 
       AND password_setup_token = $2 
       AND password_setup_expires > NOW()`,
      [email, otp]
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Verification code verified successfully'
    })

  } catch (error) {
    console.error('Verify setup OTP error:', error)
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500 }
    )
  }
}

async function handleCompletePasswordSetup(email: string, otp: string, newPassword: string, confirmPassword: string) {
  try {
    const isDevelopment = process.env.NODE_ENV === 'development'

    if (!newPassword || !confirmPassword) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      )
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: 'Passwords do not match' },
        { status: 400 }
      )
    }

    // Skip password validation in development
    if (!isDevelopment) {
      // Validate password strength only in production
      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: 'Password must be at least 8 characters long' },
          { status: 400 }
        )
      }

      const hasUppercase = /[A-Z]/.test(newPassword)
      const hasLowercase = /[a-z]/.test(newPassword)
      const hasNumbers = /\d/.test(newPassword)
      const hasSpecialChar = /[!@#$%^&*(),.?\":{}|<>]/.test(newPassword)

      if (!hasUppercase || !hasLowercase || !hasNumbers || !hasSpecialChar) {
        return NextResponse.json(
          { error: 'Password must contain uppercase, lowercase, numbers, and special characters' },
          { status: 400 }
        )
      }

      if (newPassword === 'Qode@123') {
        return NextResponse.json(
          { error: 'Please choose a different password than the default one' },
          { status: 400 }
        )
      }
    }

    // Verify OTP and get user data
    const otpResult = await query(
      `SELECT email, groupid, clientid, clientcode, head_of_family 
       FROM pms_clients_master 
       WHERE email = $1 
       AND password_setup_token = $2 
       AND password_setup_expires > NOW()
       LIMIT 1`,
      [email, otp]
    )

    if (otpResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    const userData = otpResult.rows[0]
    const { groupid } = userData

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12)

    // Update password for all accounts with this email
    await query(
      `UPDATE pms_clients_master 
       SET password = $1, 
           password_set_at = NOW(),
           onboarding_status = 'completed',
           password_setup_token = NULL,
           password_setup_expires = NULL,
           login_attempts = 0,
           locked_until = NULL,
           first_login_at = COALESCE(first_login_at, NOW())
       WHERE email = $2`,
      [hashedPassword, email]
    )

    // Set session cookies with head of family information
    await setSessionCookies({
      clientid: userData.clientid,
      clientcode: userData.clientcode,
      email: userData.email,
      groupid: userData.groupid,
      head_of_family: userData.head_of_family
    })

    // Get client data for response based on head of family status
    let clientResult;
    
    if (userData.head_of_family) {
      clientResult = await query(
        'SELECT clientid, clientcode FROM pms_clients_master WHERE groupid = $1',
        [groupid]
      )
    } else {
      clientResult = await query(
        'SELECT clientid, clientcode FROM pms_clients_master WHERE email = $1',
        [email]
      )
    }

    const clientData: ClientData[] = clientResult.rows.map(row => ({
      clientid: row.clientid,
      clientcode: row.clientcode
    }))

    return NextResponse.json({
      success: true,
      message: 'Password setup completed and logged in successfully',
      clients: clientData,
      isHeadOfFamily: userData.head_of_family
    })

  } catch (error) {
    console.error('Complete password setup error:', error)
    return NextResponse.json(
      { error: 'Password setup failed' },
      { status: 500 }
    )
  }
}