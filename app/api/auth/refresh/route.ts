import { signAccessToken } from "@/lib/auth/jwt";
import { generateRefreshToken, hashToken } from "@/lib/auth/refresh-token";
import { query } from "@/lib/db";
import crypto from "crypto";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const clientType = req.headers.get("x-client-type");

  const refreshToken = cookieStore.get("refresh_token")?.value;

  if (!refreshToken) {
    return Response.json({ error: "Missing refresh token" }, { status: 401 });
  }

  const tokenHash = hashToken(refreshToken);

  // Find stored refresh token
  const storedResult = await query(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked = false AND expires_at > NOW() LIMIT 1`,
    [tokenHash]
  );
  const stored = storedResult.rows[0];

  if (!stored) {
    return Response.json({ error: "Invalid refresh token" }, { status: 401 });
  }

  await query("BEGIN");
  try {
    // Mark the old token as revoked BEFORE creating new refresh token
    await query(
      `UPDATE refresh_tokens SET revoked = true WHERE id = $1`,
      [stored.id]
    );

    const newRefreshToken = generateRefreshToken();
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked) VALUES ($1, $2, $3, $4, false)`,
      [
        crypto.randomUUID(),
        stored.user_id,
        hashToken(newRefreshToken),
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      ]
    );
    await query("COMMIT");

    // Now find user info
    const userResult = await query(
      `SELECT clientid, clienttype as role FROM pms_clients_master WHERE clientid = $1 LIMIT 1`,
      [stored.user_id]
    );
    const user = userResult.rows[0];

    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    // Use the correct sub value for the access token payload (should be clientid as string)
    const accessToken = await signAccessToken({
      sub: user.clientid,
      scope: ["research:run"],
    });

    if (clientType === "web") {
      const cookieStore = await cookies();
      // Clear the old refresh token before setting the new one
      cookieStore.set({
        name: "refresh_token",
        value: "",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh",
        maxAge: 0,
      });
      cookieStore.set({
        name: "refresh_token",
        value: newRefreshToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    return Response.json({
      accessToken,
      refreshToken: newRefreshToken,
    });

  } catch (error) {
    await query("ROLLBACK");
    console.error("Error during refresh token rotation:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
