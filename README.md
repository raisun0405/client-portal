# Client Portal & Admin Dashboard

A modern, secure, and aesthetic client portal built with Next.js 14 and Supabase. This application allows clients to track real-time project progress, manage feature requests, and view financial overviews in a premium, responsive interface.

## 🚀 Live Demo
**URL:** [https://user-update.netlify.app/](https://user-update.netlify.app/)

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
- **Deployment:** Netlify

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

---
Built with ❤️ for a premium client experience.
