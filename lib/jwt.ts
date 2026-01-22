// lib/jwt.ts
import { jwtVerify, importSPKI } from 'jose';

// Load and import the public key ONCE (or cache it)
// Do NOT do this inside verifyJWT on every request → better to do at module level or cache
const publicKeyPromise = (async () => {
  const pem = process.env.JWT_PUBLIC_KEY;
  if (!pem) {
    throw new Error('JWT_PUBLIC_KEY is not set in environment variables');
  }
  // importSPKI expects SPKI format (which is what openssl pubout gives)
  return await importSPKI(pem, 'RS256');
})();

export async function verifyJWT(token: string) {
  const publicKey = await publicKeyPromise; // reuse imported CryptoKey

  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ['RS256'],
  });

  if (payload.type !== 'access') {
    throw new Error('Invalid token type');
  }

  return payload;
}