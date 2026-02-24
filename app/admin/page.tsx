'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ShieldCheck, Loader2, Lock, Mail, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';

export default function AdminLoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [isNavigating, setIsNavigating] = useState(false);
    const [error, setError] = useState('');
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const { error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (authError) {
            setError(authError.message);
            setLoading(false);
        } else {
            setIsNavigating(true);
            router.push('/admin/dashboard');
        }
    };

    // Full-screen loading overlay during navigation
    if (isNavigating) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 animate-fade-in">
                <div className="flex items-center gap-2 mb-6">
                    <span className="w-3 h-3 rounded-full bg-slate-900 loader-dot"></span>
                    <span className="w-3 h-3 rounded-full bg-slate-900 loader-dot"></span>
                    <span className="w-3 h-3 rounded-full bg-slate-900 loader-dot"></span>
                </div>
                <p className="text-slate-500 text-sm font-medium">Accessing admin panel...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-white to-blue-50/60 p-4 relative overflow-hidden">
            {/* Subtle ambient background shapes */}
            <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-blue-100/40 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute bottom-[-20%] left-[-10%] w-[400px] h-[400px] bg-violet-100/30 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute top-[40%] left-[60%] w-[300px] h-[300px] bg-amber-50/40 rounded-full blur-[80px] pointer-events-none" />

            <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-[400px] relative z-10"
            >
                {/* Back button */}
                <button
                    onClick={() => router.push('/')}
                    className="flex items-center gap-2 text-slate-400 hover:text-slate-700 text-sm font-medium mb-6 transition-colors group"
                >
                    <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
                    Back to Portal
                </button>

                {/* Main Card */}
                <div className="bg-white/70 backdrop-blur-2xl rounded-3xl p-8 sm:p-10 shadow-[0_8px_40px_rgba(0,0,0,0.06)] border border-white/80 ring-1 ring-slate-900/[0.04]">
                    {/* Header */}
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-14 h-14 bg-slate-900 text-white rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-slate-900/20">
                            <ShieldCheck size={26} strokeWidth={1.8} />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Admin Login</h1>
                        <p className="text-slate-400 text-sm mt-1.5 font-medium">Sign in to manage the portal</p>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleLogin} className="space-y-5">
                        {/* Email Field */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-500 ml-0.5 uppercase tracking-wider">Email</label>
                            <div className={`relative rounded-xl border transition-all duration-200 ${focusedField === 'email'
                                    ? 'border-slate-900 ring-4 ring-slate-900/[0.06] shadow-sm'
                                    : 'border-slate-200 hover:border-slate-300'
                                }`}>
                                <Mail className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-200 ${focusedField === 'email' ? 'text-slate-900' : 'text-slate-350'
                                    }`} size={17} strokeWidth={1.8} />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    onFocus={() => setFocusedField('email')}
                                    onBlur={() => setFocusedField(null)}
                                    placeholder="admin@example.com"
                                    className="w-full pl-11 pr-4 py-3.5 bg-transparent rounded-xl text-slate-900 placeholder:text-slate-300 focus:outline-none font-medium text-sm"
                                />
                            </div>
                        </div>

                        {/* Password Field */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-500 ml-0.5 uppercase tracking-wider">Password</label>
                            <div className={`relative rounded-xl border transition-all duration-200 ${focusedField === 'password'
                                    ? 'border-slate-900 ring-4 ring-slate-900/[0.06] shadow-sm'
                                    : 'border-slate-200 hover:border-slate-300'
                                }`}>
                                <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-200 ${focusedField === 'password' ? 'text-slate-900' : 'text-slate-350'
                                    }`} size={17} strokeWidth={1.8} />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onFocus={() => setFocusedField('password')}
                                    onBlur={() => setFocusedField(null)}
                                    placeholder="Enter your password"
                                    className="w-full pl-11 pr-12 py-3.5 bg-transparent rounded-xl text-slate-900 placeholder:text-slate-300 focus:outline-none font-medium text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-350 hover:text-slate-600 transition-colors p-0.5"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff size={17} strokeWidth={1.8} /> : <Eye size={17} strokeWidth={1.8} />}
                                </button>
                            </div>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="bg-red-50 border border-red-100 text-red-600 text-xs font-medium px-4 py-3 rounded-xl flex items-center gap-2"
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                                {error}
                            </motion.div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading || !email || !password}
                            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3.5 rounded-xl transition-all duration-200 shadow-lg shadow-slate-900/10 hover:shadow-xl hover:shadow-slate-900/15 active:scale-[0.98] disabled:opacity-50 disabled:hover:shadow-lg disabled:active:scale-100 flex items-center justify-center gap-2 text-sm"
                        >
                            {loading ? (
                                <Loader2 className="animate-spin" size={18} />
                            ) : (
                                'Sign in to Dashboard'
                            )}
                        </button>
                    </form>
                </div>

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-slate-300 text-xs font-medium">Protected Admin Area</p>
                </div>
            </motion.div>
        </div>
    );
}
