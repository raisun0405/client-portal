
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client used for all data queries (projects, features, etc.)
// persistSession:false prevents a stale admin auth JWT in localStorage from
// corrupting anon queries and causing "JWT expired" errors on the client portal.
export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
    }
})

// Separate client for admin auth — needs session persistence so the
// admin doesn't get logged out on page refresh.
export const supabaseAdmin = createClient(supabaseUrl, supabaseKey)
