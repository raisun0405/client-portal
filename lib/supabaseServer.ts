import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Privileged, SERVER-ONLY Supabase client keyed by the Secret API key
// (sb_secret_...). It bypasses Row Level Security, so it must never reach the
// browser. Two things keep it server-side:
//   1. It reads SUPABASE_SECRET_KEY, a non-public env var — Next strips those
//      from client bundles, so in a browser it would be undefined and throw.
//   2. The explicit `window` guard below turns any accidental client import
//      into an immediate, obvious error.
//
// Use it in server actions / server libs to read or write on behalf of an
// already-authorized caller — ALWAYS scoped to that caller's verified
// client_id. It is the counterpart to RLS: once RLS denies the anon browser,
// all legitimate client-portal data flows through here.
let cached: SupabaseClient | null = null;

export function supabaseService(): SupabaseClient {
    if (typeof window !== 'undefined') {
        throw new Error('supabaseService() is server-only and must not be used in the browser.');
    }
    if (cached) return cached;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) {
        throw new Error('Supabase server client not configured: set SUPABASE_SECRET_KEY.');
    }

    cached = createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return cached;
}
