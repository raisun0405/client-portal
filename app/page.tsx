'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loginClient, getClientSession } from './actions';
import { KeyRound, ArrowRight, Loader2, Check } from 'lucide-react';
import { motion } from 'framer-motion';

export default function LoginPage() {
  const [accessKey, setAccessKey] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  // Auto-redirect if a "Remember Me" session cookie exists
  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        const session = await getClientSession();
        if (session) {
          setIsNavigating(true);
          router.push('/dashboard');
          return;
        }
      } catch (err) {
        // No valid session, show login form
      }
      setCheckingSession(false);
    };
    checkExistingSession();
  }, [router]);

  // Hidden admin shortcut: Ctrl + Shift + A
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        router.push('/admin');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await loginClient(accessKey, rememberMe);

      if (result.success) {
        setIsNavigating(true);
        router.push('/dashboard');
      } else {
        setError(result.message || 'Login failed');
        setLoading(false);
      }
    } catch (err) {
      setError('An unexpected error occurred.');
      setLoading(false);
    }
  };

  // Show loading while checking session or navigating
  if (checkingSession || isNavigating) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-linear-to-br from-blue-50 to-indigo-50 animate-fade-in">
        <div className="flex items-center gap-2 mb-6">
          <span className="w-3 h-3 rounded-full bg-blue-500 loader-dot"></span>
          <span className="w-3 h-3 rounded-full bg-blue-500 loader-dot"></span>
          <span className="w-3 h-3 rounded-full bg-blue-500 loader-dot"></span>
        </div>
        <p className="text-slate-500 text-sm font-medium">Accessing your portal...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 to-indigo-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 border border-white/50">
          <div className="flex flex-col items-center mb-8">
            <div className="w-24 h-24 rounded-full p-1 bg-linear-to-tr from-blue-500 to-purple-500 shadow-lg mb-4">
              <div className="w-full h-full rounded-full overflow-hidden border-4 border-white">
                <img
                  src="https://raw.githubusercontent.com/raisun0405/Mescellanious/main/Spiderman%20listening%20to%20music.jpeg"
                  alt="Rai Sun PFP"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // Fallback to a generic avatar/color if image fails
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.parentElement!.style.backgroundColor = '#e2e8f0';
                  }}
                />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-1">RAI SUN</h1>
            <p className="text-slate-500 text-sm font-medium">Hi, I am Rai Sun! Please enter your key to get details.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <input
                type="text"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                placeholder="Access Key (e.g., client-demo-001)"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:placeholder:text-transparent focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-center tracking-wide"
              />

              <div className="flex items-center justify-between px-1 pt-2">
                <button
                  type="button"
                  onClick={() => setRememberMe(!rememberMe)}
                  className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 transition-colors group"
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${rememberMe ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-300 group-hover:border-slate-400'}`}>
                    {rememberMe && <Check size={10} className="text-white" />}
                  </div>
                  Remember me
                </button>
              </div>

              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-red-500 text-xs text-center font-medium pt-2"
                >
                  {error}
                </motion.p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !accessKey}
              className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-3.5 font-medium transition-all transform active:scale-95 disabled:opacity-70 disabled:active:scale-100"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <>
                  Access Portal <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-xs text-slate-400">Protected Client Area</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

