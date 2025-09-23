import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Resend } from 'resend';
// app/api/auth/complete-setup/route.ts
export async function POST(request: NextRequest) {
  try {
    const { token, password, confirmPassword } = await request.json();

    if (!token || !password || !confirmPassword) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: 'Passwords do not match' },
        { status: 400 }
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    // Find client by valid token
    const result = await query(
      'SELECT clientid, clientcode FROM pms_clients_master WHERE password_setup_token = $1 AND password_setup_expires > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 400 }
      );
    }

    const client = result.rows[0];

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update password and clear token
    await query(
      `UPDATE pms_clients_master 
       SET password = $1, 
           password_setup_token = NULL, 
           password_setup_expires = NULL,
           password_set_at = NOW(),
           onboarding_status = 'completed'
       WHERE clientcode = $2`,
      [hashedPassword, client.clientcode]
    );

    return NextResponse.json({
      success: true,
      message: 'Password setup completed successfully'
    });

  } catch (error) {
    console.error('Complete setup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Email sending function
// Email sending function
async function sendSetupEmail(email: string, clientName: string, setupLink: string) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    await resend.emails.send({
      from: 'Qode Advisors <noreply@qodeinvest.com>',
      to: [email],
      subject: 'Welcome to Qode - Set Up Your Dashboard Access',
      html: `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to myQode</title>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lato:wght@300;400;700&display=swap" rel="stylesheet">
        <style>
            body {
                margin: 0;
                padding: 0;
                font-family: 'Lato', Arial, sans-serif;
                background-color: #ffffff;
            }
            .email-container {
                max-width: 600px;
                margin: 0 auto;
                background-color: #ffffff;
                border-radius: 0;
                overflow: hidden;
                box-shadow: none;
            }
            .header {
                background-color: #fff;
                padding: 20px;
                text-align: center;
            }
            .header h1 {
                margin: 0;
                font-size: 36px;
                font-weight: 700;
                color : #02422b;
                letter-spacing: 2px;
                font-family: 'Playfair Display', serif;
            }
            .welcome-message {
                background-color: #02422b;
                color: white;
                padding: 15px 20px;
                font-size: 18px;
                font-weight: 600;
                font-family: 'Playfair Display', serif;
            }
            .border {
                background-color: #dabd38;
                height:2px;
                margin : 5px 12px;
                
            }
            .content {
                background-color: #fff;
                padding: 25px;
                line-height: 1.6;
                color: #333;
                font-family: 'Lato', Arial, sans-serif;
            }
            .greeting {
                font-size: 16px;
                margin-bottom: 15px;
                color: #333;
                font-weight: 400;
            }
            .intro-text {
                font-size: 14px;
                margin-bottom: 20px;
                color: #333;
                font-weight: 400;
            }
            .features-section {
                margin: 0 -25px;
                padding: 0;
            }
            .features-header {
                background-color: #008455;
                color: #efecd3;
                padding: 12px 20px;
                margin: 0;
                font-size: 16px;
                font-weight: 700;
                font-family: 'Lato', Arial, sans-serif;
            }
            .features-content {
                padding: 0;
            }
            .feature-item {
                padding: 15px 25px;
                font-size: 14px;
                color: #333;
                font-weight: 400;
                margin: 0;
            }
            .feature-item:nth-child(odd) {
                background-color: #efecd3;
            }
            .feature-item:nth-child(even) {
                background-color: #fff;
            }
            .feature-title {
                font-weight: 700;
                color: #02422b;
            }
            .feature-description {
                margin-top: 2px;
            }
            .usage-section {
                margin: 20px -25px 0;
                padding: 0;
            }
            .usage-header {
                background-color: #008455;
                color: #efecd3;
                padding: 12px 20px;
                margin: 0;
                font-size: 16px;
                font-weight: 700;
                font-family: 'Lato', Arial, sans-serif;
                border-radius: 2rem;
            }
            .usage-intro {
                background-color: #efecd3;
                padding: 15px 25px;
                font-size: 14px;
                color: #333;
                font-weight: 400;
                margin: 0;
            }
            .usage-list {
                background-color: #efecd3;
                padding: 0 25px 15px;
                margin: 0;
            }
            .usage-list ul {
                margin: 0;
                padding-left: 20px;
            }
            .usage-list li {
                font-size: 14px;
                color: #333;
                margin-bottom: 8px;
                line-height: 1.4;
            }
            .usage-list li strong {
                color: #02422b;
                font-weight: 700;
            }
            .contact-section {
                margin: 20px -25px 0;
                padding: 0;
            }
            .contact-header {
                background-color: #02422b;
                color: #efecd3;
                padding: 15px 20px;
                margin: 0;
                font-size: 16px;
                font-weight: 400;
                font-family: 'Lato', Arial, sans-serif;
                text-align: center;
            }
            .contact-button {
                background-color: #02422b;
                padding: 15px 20px;
                text-align: center;
                margin: 0;
            }
            .whatsapp-btn {
                background-color: #efecd3;
                color: #02422b;
                padding: 18px 20px;
                border: none;
                border-radius: 4px;
                font-size: 14px;
                font-weight: 600;
                font-family: 'Lato', Arial, sans-serif;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
            }
            .access-section {
                margin: 20px -25px 0;
                padding: 0;
            }
            .access-header {
                background-color: #008455;
                color: #efecd3;
                padding: 12px 20px;
                margin: 0;
                font-size: 16px;
                font-weight: 700;
                font-family: 'Lato', Arial, sans-serif;
                border-radius: 2rem;
            }
            .access-content {
                background-color: #fff;
                padding: 20px 25px;
                font-size: 14px;
                color: #333;
                line-height: 1.6;
            }
            .access-step {
                margin-bottom: 12px;
            }
            .access-step strong {
                color: #02422b;
                font-weight: 700;
            }
            .credentials {
                margin: 10px 0;
                padding-left: 20px;
            }
            .credentials li {
                margin-bottom: 5px;
            }
            .credentials strong {
                color: #02422b;
            }
            .access-note {
                margin: 15px 0;
                font-size: 14px;
            }
            .password-reset {
                font-style: italic;
                margin: 15px 0;
                font-size: 13px;
                color: #666;
            }
            .walkthrough-section {
                background-color: #efecd3;
                padding: 15px 25px;
                margin: 0 -25px;
            }
            .walkthrough-title {
                font-weight: 700;
                color: #02422b;
                margin-bottom: 8px;
            }
            .walkthrough-text {
                margin-bottom: 15px;
                font-size: 14px;
            }
            .walkthrough-btn {
                background-color: #02422b;
                color: white;
                padding: 20px 20px;
                border: none;
                border-radius: 14px;
                font-size: 14px;
                font-weight: 600;
                font-family: 'Lato', Arial, sans-serif;
                cursor: pointer;
                display: block;
                margin: 0 auto;
                text-decoration: none;
            }
            .feedback-section {
                background-color: #e8e8e8;
                padding: 20px 25px;
                margin: 0 -25px;
            }
            .feedback-title {
                font-weight: 700;
                color: #02422b;
                margin-bottom: 10px;
            }
            .feedback-text {
                font-size: 14px;
                line-height: 1.6;
            }
            .client-login-link {
                color: #0066cc;
                text-decoration: underline;
            }
            .setup-button {
                background-color: #02422b;
                color: white;
                padding: 16px 40px;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                font-family: 'Lato', Arial, sans-serif;
                cursor: pointer;
                display: inline-block;
                margin: 10px 0;
                text-decoration: none;
            }
            .setup-button:hover {
                background-color: #dabd38;
                color: #02422b;
            }
            
            /* Footer Styles */
            .footer {
                background-color: #f8f8f8;
                padding: 30px 25px 20px;
                margin: 0 -25px;
                text-align: center;
                font-family: 'Lato', Arial, sans-serif;
                border-top: 1px solid #e0e0e0;
            }
            .footer-logo {
                font-size: 32px;
                font-weight: 700;
                color: #02422b;
                font-family: 'Playfair Display', serif;
                margin-bottom: 15px;
                letter-spacing: 1px;
            }
            .footer-contact {
                margin-bottom: 15px;
                font-size: 14px;
                color: #333;
            }
            .footer-contact a {
                color: #02422b;
                text-decoration: none;
            }
            .footer-contact a:hover {
                text-decoration: underline;
            }
            .footer-copyright {
                font-size: 12px;
                color: #666;
                margin-bottom: 15px;
            }
            .footer-links {
                font-size: 12px;
            }
            .footer-links a {
                color: #02422b;
                text-decoration: underline;
                margin: 0 5px;
            }
            .footer-links a:hover {
                color: #008455;
            }

            /* Responsive Design */
            @media only screen and (max-width: 600px) {
                .email-container {
                    width: 100% !important;
                    margin: 0 !important;
                }
                .header {
                    padding: 15px !important;
                }
                .header h1 {
                    font-size: 28px !important;
                }
                .welcome-message {
                    font-size: 16px !important;
                    padding: 12px 15px !important;
                }
                .content {
                    padding: 20px 15px !important;
                }
                .features-section, .usage-section, .contact-section, .access-section {
                    margin: 15px -15px 0 !important;
                }
                .features-header, .usage-header, .access-header {
                    font-size: 14px !important;
                    padding: 10px 15px !important;
                }
                .feature-item, .usage-intro, .usage-list, .access-content {
                    padding: 12px 15px !important;
                }
                .walkthrough-section, .feedback-section {
                    margin: 15px -15px !important;
                    padding: 15px !important;
                }
                .footer {
                    padding: 20px 15px !important;
                    margin: 0 -15px !important;
                }
                .footer-logo {
                    font-size: 24px !important;
                }
                .setup-button {
                    padding: 14px 30px !important;
                    font-size: 14px !important;
                }
                .walkthrough-btn {
                    padding: 16px 20px !important;
                    font-size: 13px !important;
                }
            }

            @media only screen and (max-width: 480px) {
                .header h1 {
                    font-size: 24px !important;
                }
                .welcome-message {
                    font-size: 14px !important;
                }
                .features-header, .usage-header, .access-header {
                    font-size: 13px !important;
                }
                .setup-button {
                    padding: 12px 25px !important;
                    font-size: 13px !important;
                }
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <!-- Header -->
            <div class="header">
                <h1>Qode</h1>
            </div>
            
            <!-- Welcome Message -->
            <div class="welcome-message">
                Welcome to myQode - your investment dashboard
            </div>
            
            <div class="border"></div>
            
            <!-- Main Content -->
            <div class="content">
                <div class="greeting">
                    Hi ${clientName},
                </div>
                
                <div class="intro-text">
                    With myQode, you now have a single platform to track, manage, and grow your investments. From real-time performance updates to seamless SIPs and withdrawals, everything is designed to give you clarity and control over your portfolio.
                </div>
                
                <!-- Features Section -->
                <div class="features-section">
                    <div class="features-header" style="border-radius:2rem;margin-bottom:10px;text-align:center;">
                        Key Features and Highlights
                    </div>
                    
                    <div class="features-content">
                        <div class="feature-item">
                            <div class="feature-title">Portfolio & Performance:</div>
                            <div class="feature-description">Real-time snapshots, strategy/sector allocation, and benchmark comparisons.</div>
                        </div>
                        
                        <div class="feature-item">
                            <div class="feature-title">Reports:</div>
                            <div class="feature-description">View performance, allocations, transactions, and tax packs via our secure reporting portal, Fact Spectrum.</div>
                        </div>
                        
                        <div class="feature-item">
                            <div class="feature-title">Video Tutorials:</div>
                            <div class="feature-description">Video guides to help you navigate myQode, with quick walkthroughs designed to make every feature simple.</div>
                        </div>
                        
                        <div class="feature-item">
                            <div class="feature-title">Transactions & Cash Flows:</div>
                            <div class="feature-description">Clear log of purchases, sales, top-ups, withdrawals, and corporate actions all in one place.</div>
                        </div>
                    </div>
                </div>

                <!-- Usage Section -->
                <div class="usage-section">
                    <div class="usage-header" style="margin-bottom:10px;text-align:center;">
                        Everything You Can Do Using myQode
                    </div>
                    
                    <div class="usage-intro">
                        Manage your investments with ease:
                    </div>
                    
                    <div class="usage-list">
                        <ul>
                            <li><strong>Add Funds or SIP:</strong> Top up anytime or set a disciplined SIP.</li>
                            <li><strong>Switch Strategy:</strong> Reallocate between Qode strategies as goals/markets evolve.</li>
                            <li><strong>Withdraw Funds:</strong> Request withdrawals with proceeds to your registered bank account.</li>
                            <li><strong>Track Transactions:</strong> View one-time and SIP history in a clean ledger.</li>
                            <li><strong>Account Mapping:</strong> See all your Qode accounts in one place - myQode consolidates family accounts so holdings and reports are organized together.</li>
                            <li><strong>Reports & Reviews:</strong> Monthly performance updates, quarterly SEBI disclosures, annual one-on-one reviews, and quick query resolution with defined SLAs.</li>
                        </ul>
                    </div>
                </div>

                <!-- Contact Section -->
                <div class="contact-section">
                    <div class="contact-header">
                        To know more about myQode
                    </div>
                    
                    <div class="contact-button">
                        <a href="https://wa.me/919820300028" class="whatsapp-btn">Connect on WhatsApp</a>
                    </div>
                </div>

                <!-- Access Section -->
                <div class="access-section">
                    <div class="access-header" style="text-align:center;">
                        How to Access myQode (step-by-step)
                    </div>
                    
                    <div class="access-content">
                        <div class="access-step">
                            <strong>Step 1:</strong> Click <a href="https://myqode.qodeinvest.com/login" class="client-login-link">[Client Login]</a>
                        </div>
                        
                        <div class="access-step">
                            <strong>Step 2:</strong> Enter your login credentials
                            <ul class="credentials">
                                <li><strong>Username:</strong> ${email}</li>
                                <li><strong>Password:</strong> 
                                    <div style="text-align: center; margin-top: 15px;">
                                        <a href="${setupLink}" class="setup-button">Set Up My Password</a>
                                    </div>
                                </li>
                            </ul>
                        </div>
                        
                        <div class="access-note">
                            You'll now be in myQode with full access to your portfolio, transactions, and reports.
                        </div>
                    </div>
                </div>
                
                <div class="walkthrough-section">
                    <div class="walkthrough-title">Prefer a quick walkthrough?</div>
                    <div class="walkthrough-text">We are happy to give you a live myQode walkthrough.</div>
                </div>
                
                <div style="margin:10px 0px; text-align: center;">
                    <a href="mailto:support@qodeinvest.com?subject=Request%20for%20myQode%20Walkthrough" class="walkthrough-btn">Request a live walkthrough</a>
                </div>
                
                <div class="feedback-section">
                    <div class="feedback-title">Feedback and Referrals</div>
                    <div class="feedback-text">
                        Share your thoughts directly inside myQode - your feedback helps us improve your experience. Refer friends or family and earn ₹15,000 for every ₹50 lakh of fresh investments you bring in (T&Cs apply).
                    </div>
                </div>
                
                <div class="border"></div>
                
                <!-- Footer -->
                <div class="footer">
                    <div class="footer-logo">Qode</div>
                    
                    <div class="footer-contact">
                        <a href="tel:+919820300028">+91 98203 00028</a><br>
                        <a href="mailto:investor.relations@qodeinvest.com">investor.relations@qodeinvest.com</a><br>
                        <a href="https://www.qodeinvest.com">www.qodeinvest.com</a>
                    </div>
                    
                    <div class="footer-copyright">
                        © 2025 Qode Advisors LLP. All rights reserved.
                    </div>
                    
                    <div class="footer-links">
                        <a href="#">update your preferences</a> or <a href="#">unsubscribe</a>
                    </div>
                </div>
            
            </div>
        </div>
    </body>
    </html>
  `
    });
  } catch (error) {
    console.error('Resend email error:', error);
    throw error;
  }
}