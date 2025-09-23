// lib/auth-config.ts (Updated with validation)
export const microsoftAuthConfig = {
  clientId: process.env.MICROSOFT_CLIENT_ID!,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
  tenantId: process.env.MICROSOFT_TENANT_ID!,
  redirectUri: `${process.env.NEXTAUTH_URL}/api/auth/microsoft/callback`,
  scope: 'openid profile email User.Read',
  authorizeUrl: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`,
  tokenUrl: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
}

// Validation function
export function validateMicrosoftConfig() {
  const issues = []
  
  if (!process.env.MICROSOFT_CLIENT_ID) {
    issues.push('MICROSOFT_CLIENT_ID is missing')
  }
  
  if (!process.env.MICROSOFT_CLIENT_SECRET) {
    issues.push('MICROSOFT_CLIENT_SECRET is missing')
  }
  
  if (!process.env.MICROSOFT_TENANT_ID) {
    issues.push('MICROSOFT_TENANT_ID is missing')
  }
  
  if (!process.env.NEXTAUTH_URL) {
    issues.push('NEXTAUTH_URL is missing')
  }
  
  if (!process.env.NEXTAUTH_SECRET) {
    issues.push('NEXTAUTH_SECRET is missing')
  }

  // Validate URL format
  if (process.env.NEXTAUTH_URL && !process.env.NEXTAUTH_URL.startsWith('http')) {
    issues.push('NEXTAUTH_URL must start with http:// or https://')
  }

  // Validate GUID formats
  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  
  if (process.env.MICROSOFT_CLIENT_ID && !guidRegex.test(process.env.MICROSOFT_CLIENT_ID)) {
    issues.push('MICROSOFT_CLIENT_ID should be a valid GUID format')
  }
  
  if (process.env.MICROSOFT_TENANT_ID && !guidRegex.test(process.env.MICROSOFT_TENANT_ID)) {
    issues.push('MICROSOFT_TENANT_ID should be a valid GUID format')
  }

  return {
    isValid: issues.length === 0,
    issues,
    config: {
      hasClientId: !!process.env.MICROSOFT_CLIENT_ID,
      hasClientSecret: !!process.env.MICROSOFT_CLIENT_SECRET,
      hasTenantId: !!process.env.MICROSOFT_TENANT_ID,
      hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
      hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
      redirectUri: microsoftAuthConfig.redirectUri,
      authorizeUrl: microsoftAuthConfig.authorizeUrl,
      tokenUrl: microsoftAuthConfig.tokenUrl
    }
  }
}

