// Forgot password: send OTP to email (any existing user)
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { Resend } from 'resend';

export async function POST(request: NextRequest) {
  try {
    const rawEmail = (await request.json()).email;
    if (!rawEmail || typeof rawEmail !== 'string') {
      return NextResponse.json(
        { error: 'Email address is required' },
        { status: 400 }
      );
    }
    const email = rawEmail.trim().toLowerCase();

    const result = await query(
      `SELECT clientid, clientcode, email, clientname
       FROM pms_clients_master 
       WHERE LOWER(TRIM(email)) = $1 
       LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'No account found with this email' },
        { status: 404 }
      );
    }

    const client = result.rows[0];
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await query(
      `UPDATE pms_clients_master 
       SET password_setup_token = $1, password_setup_expires = $2 
       WHERE LOWER(TRIM(email)) = $3`,
      [otp, otpExpires, email]
    );

    const resend = new Resend(process.env.RESEND_API_KEY);
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><style>
        body { font-family: Lato, Arial, sans-serif; line-height: 1.6; color: #002017; background-color: #EFECD3; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #02422B; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
        .content { background: #FFFFFF; padding: 20px; border: 1px solid #37584F; border-radius: 8px; }
        .otp-box { background: #EFECD3; padding: 20px; border-left: 4px solid #DABD38; margin: 20px 0; text-align: center; }
        .otp-code { font-size: 36px; font-weight: bold; color: #02422B; letter-spacing: 8px; font-family: 'Courier New', monospace; margin: 15px 0; }
        .security-box { background: #FFF3CD; padding: 15px; border-left: 4px solid #DABD38; margin: 15px 0; }
        h1 { font-family: 'Playfair Display', Georgia, serif; color: #DABD38; margin: 0; }
        h3 { font-family: 'Playfair Display', Georgia, serif; color: #37584F; margin-top: 0; }
      </style></head>
      <body>
        <div class="container">
          <div class="header"><h1>Password Reset Verification</h1></div>
          <div class="content">
            <p><strong>Hello ${(client.clientname || client.email || 'there')},</strong></p>
            <p>You requested to reset your password. Use the code below to continue.</p>
            <div class="otp-box">
              <h3>Your verification code:</h3>
              <div class="otp-code">${otp}</div>
              <p style="margin: 0; color: #37584F; font-size: 14px;">This code expires in 10 minutes.</p>
            </div>
            <div class="security-box">
              <p style="margin: 0;">Never share this code. If you didn't request this, ignore this email.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    if (resend) {
      await resend.emails.send({
        from: 'Qode Investor Relations <investor.relations@qodeinvest.com>',
        to: [email],
        subject: 'Your Qode Password Reset Code',
        html: emailHtml,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Verification code sent to your email',
    });
  } catch (error) {
    console.error('Send forgot OTP error:', error);
    return NextResponse.json(
      { error: 'Failed to send verification code' },
      { status: 500 }
    );
  }
}
