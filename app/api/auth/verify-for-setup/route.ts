// app/api/auth/verify-for-setup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
    try {
        const { identifier, currentPassword } = await request.json();

        if (!identifier || !currentPassword) {
            return NextResponse.json(
                { error: 'Email and current password are required' },
                { status: 400 }
            );
        }

        // Find client by email (can have multiple client codes)
        const result = await query(
            `SELECT clientid, clientcode, email, clientname, password, onboarding_status, 
              login_attempts, locked_until
       FROM pms_clients_master 
       WHERE email = $1
       LIMIT 1`,
            [identifier]
        );

        if (result.rows.length === 0) {
            return NextResponse.json(
                { error: 'Email address not found' },
                { status: 404 }
            );
        }

        const client = result.rows[0];

        // Check if account is locked
        if (client.locked_until && new Date(client.locked_until) > new Date()) {
            const lockTime = Math.ceil((new Date(client.locked_until).getTime() - Date.now()) / (1000 * 60));
            return NextResponse.json(
                { error: `Account locked. Try again in ${lockTime} minutes.` },
                { status: 423 }
            );
        }

        // Verify current password
        let passwordValid = false;
        if (client.password === 'Qode@123') {
            // Handle default password (plain text)
            passwordValid = currentPassword === 'Qode@123';
        } else {
            // Handle hashed password
            passwordValid = await bcrypt.compare(currentPassword, client.password);
        }

        if (!passwordValid) {
            // Increment login attempts for all accounts with this email
            const newAttempts = (client.login_attempts || 0) + 1;
            let lockUntil = null;

            if (newAttempts >= 5) {
                lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
            }

            await query(
                'UPDATE pms_clients_master SET login_attempts = $1, locked_until = $2 WHERE email = $3',
                [newAttempts, lockUntil, identifier]
            );

            return NextResponse.json(
                { error: 'Invalid current password' },
                { status: 401 }
            );
        }

        // Check if client needs password setup
        if (client.password === 'Qode@123' || client.onboarding_status === 'pending') {
            // Reset login attempts on successful verification for all accounts with this email
            await query(
                'UPDATE pms_clients_master SET login_attempts = 0, locked_until = NULL WHERE email = $1',
                [identifier]
            );

            return NextResponse.json({
                requiresSetup: true,
                clientname: client.clientname,
                message: 'Ready for password setup'
            });
        }

        // Client has already completed setup
        return NextResponse.json({
            requiresSetup: false,
            message: 'Password already set up'
        });

    } catch (error) {
        console.error('Verify for setup error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}