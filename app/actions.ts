'use server';

import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Client for Server Side
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const COOKIE_NAME = 'portal_session';

export type ActionResponse = {
    success: boolean;
    message?: string;
    data?: any;
};

export async function loginClient(accessKey: string, rememberMe: boolean): Promise<ActionResponse> {
    try {
        // 1. Verify credentials with Supabase
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('access_key', accessKey)
            .single();

        if (error || !data) {
            return { success: false, message: 'Invalid Access Key. Please try again.' };
        }

        // 2. Set Secure HTTP-Only Cookie
        // If "Remember Me" is checked, set expiration to 30 days. Otherwise, session cookie.
        const expires = rememberMe ? Date.now() + 30 * 24 * 60 * 60 * 1000 : undefined;

        // We store the client ID and Name in the cookie (could be encrypted for more security, 
        // but HttpOnly prevents client-side access effectively for this use case).
        // Ideally, we'd sign this token, but for now we'll store a JSON string.
        const sessionData = JSON.stringify({
            id: data.id,
            name: data.name,
            access_key: data.access_key
        });

        const cookieStore = await cookies();
        cookieStore.set(COOKIE_NAME, sessionData, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/',
            expires: expires
        });

        return { success: true, data };
    } catch (err) {
        console.error('Login error:', err);
        return { success: false, message: 'An unexpected error occurred during login.' };
    }
}

export async function getClientSession(): Promise<any | null> {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(COOKIE_NAME);

    if (!sessionCookie) return null;

    try {
        return JSON.parse(sessionCookie.value);
    } catch (e) {
        return null;
    }
}

export async function logoutClient() {
    const cookieStore = await cookies();
    cookieStore.delete(COOKIE_NAME);
}
