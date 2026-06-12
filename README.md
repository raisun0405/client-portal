# Client Portal & Admin Dashboard

A modern, secure, and aesthetic client portal built with Next.js 14 and Supabase. This application allows clients to track real-time project progress, manage feature requests, and view financial overviews in a premium, responsive interface.

## 🚀 Live Demo
**URL:** [https://track.raisun.dev/](https://track.raisun.dev/)

## ✨ Features

### 🔐 Client Portal
- **Secure Key-Based Login:** Simple and secure access using unique project keys.
- **Project Overview:** Real-time visibility into project status, timeline, and health.
- **Financial Dashboard:**
  - Visual progress tracking of payments (Total, Paid, Pending).
  - Clear breakdown of "Core" vs. "Extra" costs.
- **Feature Tracking:**
  - View detailed status of feature requests (Requested, Approved, Working, Completed).
  - Mobile-responsive card view for developing on the go.
  - Sort functionality (by Status, Date, Cost).

### 🛠 Admin Dashboard
- **Project Management:** Create and manage multiple client projects.
- **Financials:** Log payments and track revenue streams (Core vs. Extras).
- **Feature Management:** Add, edit, and update status of features/tasks.
- **Secret Admin Access:** Hidden login route for internal management.

## 🏗 Tech Stack

- **Framework:** [Next.js 14 (App Router)](https://nextjs.org/)
- **Language:** TypeScript
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Animations:** Framer Motion
- **Database/Auth:** [Supabase](https://supabase.com/)
- **Deployment:** Vercel

## ⚙️ Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/raisun0405/client-portal.git
   cd client-portal
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   Create a `.env.local` file with your Supabase credentials:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ADMIN_PASSWORD=your_secure_admin_password
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

## 📱 Mobile Responsiveness
The interface is fully optimized for all devices, featuring a custom card-based layout for mobile users to ensure complex data remains readable on small screens.

## 🌐 Hosting & Routing

The app is a **single Next.js project** on Vercel serving **two domains**:

| Domain | Purpose | Allowed paths |
|---|---|---|
| `track.raisun.dev` | Public client portal | Everything **except** `/admin*` |
| `admin.raisun.dev` | Admin panel | Only `/admin*` (root `/` redirects to `/admin`) |

Routing is enforced at the edge by [middleware.ts](middleware.ts) using the `Host` header. Hostnames are centralised in [lib/hosts.ts](lib/hosts.ts).

### Behavior summary

- `track.raisun.dev/admin*` → **404** (admin is invisible on the public domain)
- `admin.raisun.dev/` → **redirects** to `/admin`
- `admin.raisun.dev/<not-admin>` → **404**
- Any other host (localhost, Vercel preview URLs) → middleware no-ops, both `/` and `/admin/*` work normally for dev

### Cross-domain navigation

Two places intentionally hop between subdomains. Both detect the current hostname and use a full URL when crossing, otherwise fall back to `router.push`:

- [app/page.tsx](app/page.tsx) — `Ctrl+Shift+A` shortcut: public → admin
- [app/admin/page.tsx](app/admin/page.tsx) — "Back to Portal" button: admin → public

### Auth isolation (intentional)

Supabase auth is stored in **localStorage**, which is scoped per-origin. This means an admin session on `admin.raisun.dev` cannot leak to `track.raisun.dev` and vice versa. The two clients in [lib/supabase.ts](lib/supabase.ts) (`supabase` with `persistSession: false` for public queries, `supabaseAdmin` with persistence for admin) remain unchanged.

### To change the domains

Edit the constants in [lib/hosts.ts](lib/hosts.ts) — `ADMIN_HOST` and `PUBLIC_HOST`. The middleware and both cross-domain navigation spots read from there.

### To revert to a single-domain setup

1. Delete [middleware.ts](middleware.ts) and [lib/hosts.ts](lib/hosts.ts).
2. In [app/page.tsx](app/page.tsx) restore the `Ctrl+Shift+A` handler to `router.push('/admin')` and remove the `hosts` import.
3. In [app/admin/page.tsx](app/admin/page.tsx) restore the "Back to Portal" `onClick` to `() => router.push('/')` and remove the `hosts` import.
4. In Vercel → Settings → Domains, remove `admin.raisun.dev` (and its DNS CNAME if no longer needed).

### DNS / Vercel setup (one-time)

1. Vercel project → **Settings → Domains** → add `admin.raisun.dev`.
2. At the DNS provider for `raisun.dev`, add a CNAME record `admin` → `cname.vercel-dns.com` (Vercel shows the exact target).
3. Wait for cert provisioning (Vercel marks it green).

---
Built with ❤️ for a premium client experience.
