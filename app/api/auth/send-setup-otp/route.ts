// app/api/auth/send-setup-otp/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { Resend } from 'resend';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email address is required' },
        { status: 400 }
      );
    }

    // Find client by email
    const result = await query(
      `SELECT clientid, clientcode, email, clientname, password, onboarding_status
       FROM pms_clients_master 
       WHERE email = $1 
       AND (password = 'Qode@123' OR onboarding_status = 'pending')
       LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Email not found or password already set up' },
        { status: 404 }
      );
    }

    const client = result.rows[0];

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    await query(
      `UPDATE pms_clients_master 
       SET password_setup_token = $1, 
           password_setup_expires = $2 
       WHERE email = $3`,
      [otp, otpExpires, email]
    );

    // Send OTP via Resend
    const resend = new Resend(process.env.RESEND_API_KEY);
    
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Lato, Arial, sans-serif; line-height: 1.6; color: #002017; background-color: #EFECD3; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #02422B; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
          .content { background: #FFFFFF; padding: 20px; border: 1px solid #37584F; border-radius: 8px; }
          .otp-box { background: #EFECD3; padding: 20px; border-left: 4px solid #DABD38; margin: 20px 0; text-align: center; }
          .otp-code { font-size: 36px; font-weight: bold; color: #02422B; letter-spacing: 8px; font-family: 'Courier New', monospace; margin: 15px 0; }
          .security-box { background: #FFF3CD; padding: 15px; border-left: 4px solid #DABD38; margin: 15px 0; }
          h1 { font-family: 'Playfair Display', Georgia, serif; color: #DABD38; margin: 0; }
          h3 { font-family: 'Playfair Display', Georgia, serif; color: #37584F; margin-top: 0; }
          .footer-text { margin-top: 20px; font-size: 14px; color: #37584F; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Setup Verification</h1>
          </div>
          <div class="content">
            <p><strong>Hello ${client.clientname},</strong></p>
            <p><strong>Request Type:</strong> Password Setup</p>
            <p><strong>Verification via:</strong> myQode Portal</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            
            <div class="otp-box">
              <h3>Your Verification Code:</h3>
              <div class="otp-code">${otp}</div>
              <p style="margin: 0; color: #37584F; font-size: 14px;"><strong>This code expires in 10 minutes</strong></p>
            </div>
            
            <p>You requested to set up your password for your Qode investment dashboard. Please enter this verification code to proceed with your password setup.</p>
            
            <div class="security-box">
              <h3>Security Notice:</h3>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li>Never share this verification code with anyone</li>
                <li>Qode staff will never ask for your verification code</li>
                <li>If you didn't request this, please ignore this email</li>
                <li>This code is valid for 10 minutes only</li>
              </ul>
            </div>
            
            <p class="footer-text">
              This message was sent from the myQode Portal. If you have any questions about your account setup, please contact our support team.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    await resend.emails.send({
      from: 'Qode Investor Relations <investor.relations@qodeinvest.com>',
      to: [email],
      subject: 'Your Qode Password Setup Verification Code',
      html: emailHtml
    });

    return NextResponse.json({
      success: true,
      message: 'OTP sent successfully',
      clientname: client.clientname
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    return NextResponse.json(
      { error: 'Failed to send OTP' },
      { status: 500 }
    );
  }
}
