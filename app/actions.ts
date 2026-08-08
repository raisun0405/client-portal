'use server';

import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseService } from '@/lib/supabaseServer';

const COOKIE_NAME = 'portal_session';
const SESSION_SECRET = process.env.SESSION_SECRET;

// Sign a session payload as `<base64url(json)>.<base64url(hmac)>`. The signature
// is what makes the cookie unforgeable: getClientSession recomputes it and
// rejects any value whose signature doesn't match, so a client can't hand-craft
// a cookie for another client's id. Throws if SESSION_SECRET is unset so a
// misconfiguration fails loudly at login rather than silently trusting nothing.
function signSession(payload: Record<string, any>): string {
    if (!SESSION_SECRET) throw new Error('SESSION_SECRET is not configured.');
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    return `${data}.${sig}`;
}

// Verify + decode a signed session cookie. Returns null on any tampering,
// missing secret, or malformed value (fail closed). Uses a constant-time
// compare so the signature can't be brute-forced by timing.
function verifySession(value: string): any | null {
    if (!SESSION_SECRET) return null;
    const dot = value.lastIndexOf('.');
    if (dot < 1) return null;
    const data = value.slice(0, dot);
    const expected = createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    const got = Buffer.from(value.slice(dot + 1));
    const exp = Buffer.from(expected);
    if (got.length !== exp.length || !timingSafeEqual(got, exp)) return null;
    try {
        return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

export type ActionResponse = {
    success: boolean;
    message?: string;
    data?: any;
};

export async function loginClient(accessKey: string, rememberMe: boolean): Promise<ActionResponse> {
    try {
        // Trim input in case the user accidentally added whitespace in the admin panel or input field
        const cleanKey = accessKey.trim();

        // 1. Verify credentials with Supabase (secret key — the anon browser is
        // denied by RLS, and login must read the clients table server-side).
        const { data, error } = await supabaseService()
            .from('clients')
            .select('*')
            .eq('access_key', cleanKey)
            .single();

        if (error || !data) {
            return { success: false, message: 'Invalid Access Key. Please try again.' };
        }

        // 2. Set Secure HTTP-Only Cookie
        // HMAC-signed so it can't be forged (base64url output is cookie-safe).
        const sessionData = signSession({
            id: data.id,
            name: data.name,
            access_key: data.access_key,
            // Stored so the portal can pick the correct loading skeleton instantly
            // (per-feature vs package) without waiting on a live query. Live
            // packageInfo still overrides this once it loads.
            billing_mode: data.billing_mode ?? null
        });

        const cookieOptions: any = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax', // Changed from 'strict' to 'lax' for better compatibility
            path: '/',
        };

        // If "Remember Me" is checked, set maxAge to 30 days. Otherwise, it's a session cookie.
        if (rememberMe) {
            cookieOptions.maxAge = 30 * 24 * 60 * 60; // 30 days in seconds
        }

        const cookieStore = await cookies();
        cookieStore.set(COOKIE_NAME, sessionData, cookieOptions);

        // DO NOT return `data` - Next.js 14+ Server Actions throw fatal serialization errors for null-prototype objects returned by Supabase
        return { success: true };
    } catch (err) {
        console.error('Login error:', err);
        return { success: false, message: 'An unexpected error occurred during login.' };
    }
}

export async function getClientSession(): Promise<any | null> {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(COOKIE_NAME);

    if (!sessionCookie) return null;

    // Reject unsigned/tampered/legacy cookies — a null here just forces one
    // clean re-login, which re-issues a properly signed cookie.
    return verifySession(sessionCookie.value);
}

export async function logoutClient() {
    const cookieStore = await cookies();
    cookieStore.delete(COOKIE_NAME);
}


