# Deployment Guide for Netlify

## ✅ Pre-Deployment Checklist

| Item | Status |
|------|--------|
| Build passes (`npm run build`) | ✅ Passed |
| Environment variables secured (.gitignore) | ✅ .env* excluded |
| RLS Policies secured | ✅ Verified |
| Admin user created | ✅ Done |
| Supabase Auth implemented | ✅ Done |

---

## 🚀 Deploy to Netlify

### Step 1: Push to GitHub
```bash
cd "C:\Users\rohan\Downloads\Test unique\client-portal"
git init
git add .
git commit -m "Initial commit - Client Portal"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### Step 2: Connect to Netlify
1. Go to [netlify.com](https://netlify.com) and log in
2. Click **"Add new site"** → **"Import an existing project"**
3. Choose **GitHub** and select your repository

### Step 3: Configure Build Settings
| Setting | Value |
|---------|-------|
| Build command | `npm run build` |
| Publish directory | `.next` |
| Node version | 18 or higher |

### Step 4: Add Environment Variables ⚠️ CRITICAL
In Netlify: **Site Settings** → **Environment variables** → **Add variable**

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase URL (from Supabase Dashboard → Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase Anon Key (from same location) |

### Step 5: Install Next.js Plugin
Netlify needs a plugin for Next.js:
1. Go to **Site Settings** → **Build & deploy** → **Plugins**
2. Search for **"@netlify/plugin-nextjs"**
3. Install it

### Step 6: Deploy!
Click **"Deploy site"** and wait for the build to complete.

---

## 🔗 After Deployment

Your site will be live at: `https://your-site-name.netlify.app`

- **Client Portal**: `https://your-site-name.netlify.app/`
- **Admin Login**: `https://your-site-name.netlify.app/admin`

---

## ⚠️ Important Notes

1. **Never commit .env.local to Git** - It's already in .gitignore ✅
2. **Use Netlify environment variables** for production secrets
3. **Admin credentials** are in Supabase Auth, not in any code file
