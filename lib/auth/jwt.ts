import { SignJWT, jwtVerify, importPKCS8, importSPKI, errors as joseErrors } from "jose";

const ALG = "RS256";

// Convert PRIVATE key (PEM → CryptoKey)
async function getPrivateKey() {
  const key = process.env.JWT_PRIVATE_KEY;
  if (!key) {
    throw new Error("JWT_PRIVATE_KEY env not set");
  }
  return importPKCS8(key.replace(/\\n/g, "\n"), ALG);
}

async function getPublicKey() {
  const key = process.env.JWT_PUBLIC_KEY;
  if (!key) {
    throw new Error("JWT_PUBLIC_KEY env not set");
  }
  return importSPKI(key.replace(/\\n/g, "\n"), ALG);
}

export async function signAccessToken(payload: {
  sub: string;
  scope?: string[];
}) {
  const privateKey = await getPrivateKey();

  // Ensure sub is provided and string
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Payload 'sub' is required and must be a string.");
  }

  const issuer = process.env.JWT_ISSUER;
  if (!issuer) {
    throw new Error("JWT_ISSUER env not set");
  }

  return new SignJWT({ scope: payload.scope })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(issuer)
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(privateKey);
}

export async function verifyToken(token: string) {
  const publicKey = await getPublicKey();
  const issuer = process.env.JWT_ISSUER;
  if (!issuer) {
    throw new Error("JWT_ISSUER env not set");
  }

  if (typeof token !== "string" || !token.trim()) {
    throw new joseErrors.JWSInvalid("No or invalid token provided");
  }

  try {
    const { payload } = await jwtVerify(token, publicKey, {
      issuer,
      algorithms: [ALG],
    });
    return payload;
  } catch (err: any) {
    throw err;
  }
}
