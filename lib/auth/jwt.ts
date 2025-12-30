import { SignJWT, jwtVerify, importPKCS8, importSPKI, errors as joseErrors, JWTExpired } from "jose";

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

/**
 * Verifies the JWT access token.
 * Throws a custom error string 'JWT_EXPIRED' if the token is expired.
 * Throws 'JWT_INVALID' on other JWT errors.
 *
 * @param {string} token
 * @returns {Promise<any>}
 * @throws {string}
 */
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
    // Native: rewrite JWT expiration error to string for easier handling
    if (
      err &&
      (err.name === "JWTExpired" ||
        err.code === "ERR_JWT_EXPIRED" ||
        err.message?.includes('"exp" claim timestamp check failed'))
    ) {
      // Optionally, attach payload or additional info as needed
      const customError: any = new Error("JWT_EXPIRED");
      customError.code = "JWT_EXPIRED";
      throw customError;
    }
    // All other errors are invalid token
    const customError: any = new Error("JWT_INVALID");
    customError.code = "JWT_INVALID";
    throw customError;
  }
}
