'use client';

// First-run guided tour for the client portal. Device-local (localStorage) —
// once dismissed/finished it never shows again on this device, regardless of
// which client is logged in. Spotlights real elements via [data-tour="…"]
// selectors and floats a coach-mark card beside each.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowRight, ArrowLeft, Check } from 'lucide-react';

type Placement = 'top' | 'bottom' | 'center';
// `demo` steps run inside the request form, opened with sample data that is
// shown but never submitted — the host page opens/closes it via the callbacks.
type Step = { selector?: string; title: string; body: string; demo?: boolean };

const STEPS: Step[] = [
    { title: 'Welcome', body: '' }, // intro renders its own editorial card

    { selector: '[data-tour="overview"]', title: 'Your snapshot', body: 'Progress, billing, and what’s next — the health of your work at a glance, updated live.' },
    { selector: '[data-tour="projects"]', title: 'All your projects', body: 'Each card shows live status and completion. Tap one to open its features, delivery and billing.' },
    { selector: '[data-tour="request-project"]', title: 'Ask for new work', body: 'Need something built? Request a project right from here — let’s peek at how that works.' },
    { selector: '[data-tour="req-name"]', title: 'Describe the project', body: 'Give it a short name and an optional note — here’s a sample request so you can see it filled in.', demo: true },
    { selector: '[data-tour="req-features"]', title: 'Break it into features', body: 'Type a feature and press Enter to add it to the list. Add as many as you need — each entry can be edited or removed before you submit. This is a sample request; nothing is sent.', demo: true },
    { selector: '[data-tour="activity"]', title: 'Never miss an update', body: 'Every change is logged here in real time, and you can download the full history as a PDF anytime.' },
];

const STORAGE_KEY = 'portal_tour_v1_done';
const PAD = 10;

export default function Tutorial({ onDemoStart, onDemoEnd }: { onDemoStart?: () => void; onDemoEnd?: () => void }) {
    const [active, setActive] = useState(false);
    const [step, setStep] = useState(0);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const [vp, setVp] = useState({ w: 1200, h: 800 });
    const s = STEPS[step];

    // Open/close the sample request form as the tour enters/leaves demo steps.
    useEffect(() => {
        if (!active) return;
        if (s.demo) onDemoStart?.();
        else onDemoEnd?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, step]);

    // Show once per device.
    useEffect(() => {
        try {
            if (!localStorage.getItem(STORAGE_KEY)) {
                setVp({ w: window.innerWidth, h: window.innerHeight });
                const t = setTimeout(() => setActive(true), 650);
                return () => clearTimeout(t);
            }
        } catch { /* private mode etc. — just don't show */ }
    }, []);

    // Measure the current target (and scroll it into view). No target = centered.
    // Demo targets live inside a modal that mounts a tick after the step changes,
    // so retry briefly until the element exists.
    useEffect(() => {
        if (!active) return;
        let el: HTMLElement | null = null;
        let tries = 0;
        let retryT: ReturnType<typeof setTimeout> | null = null;
        let settleT: ReturnType<typeof setTimeout> | null = null;
        const measure = () => { if (el) { setRect(el.getBoundingClientRect()); setVp({ w: window.innerWidth, h: window.innerHeight }); } };
        const locate = () => {
            el = s.selector ? (document.querySelector(s.selector) as HTMLElement | null) : null;
            if (!el) {
                setRect(null);
                if (s.selector && tries++ < 10) retryT = setTimeout(locate, 80);
                return;
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            measure();
            settleT = setTimeout(measure, 380);
        };
        locate();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => { if (retryT) clearTimeout(retryT); if (settleT) clearTimeout(settleT); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
    }, [active, step]);

    const finish = () => { try { localStorage.setItem(STORAGE_KEY, '1'); } catch {} onDemoEnd?.(); setActive(false); };
    const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : finish());
    const back = () => setStep(Math.max(0, step - 1));

    if (!active) return null;

    const intro = step === 0;
    const cardW = Math.min(intro ? 460 : 360, vp.w - 32);
    const last = step === STEPS.length - 1;

    // Position the card relative to the spotlight (or centered when no target).
    let placement: Placement = 'center';
    let pos: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: cardW };
    if (rect) {
        placement = (vp.h - rect.bottom) < 240 ? 'top' : 'bottom';
        const left = Math.max(16, Math.min(rect.left + rect.width / 2 - cardW / 2, vp.w - cardW - 16));
        pos = placement === 'top'
            ? { left, bottom: vp.h - rect.top + 14, width: cardW }
            : { left, top: rect.bottom + 14, width: cardW };
    }

    return (
        <div className="fixed inset-0 z-[90]" aria-live="polite">
            {/* Interaction blocker. Dim comes from the spotlight's ring-shadow when
                a target exists; otherwise this layer carries the dim itself. The
                intro step blurs the whole page behind the welcome card. */}
            <div className={`absolute inset-0 ${intro ? 'backdrop-blur-md' : ''}`} style={{ background: rect ? 'transparent' : intro ? 'rgba(15,23,42,0.45)' : 'rgba(15,23,42,0.55)' }} />

            {/* Spotlight */}
            {rect && (
                <motion.div
                    initial={false}
                    animate={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                    className="absolute rounded-2xl pointer-events-none"
                    style={{ boxShadow: '0 0 0 9999px rgba(15,23,42,0.55)', border: '1.5px solid rgba(255,255,255,0.85)' }}
                />
            )}

            {/* Coach-mark card */}
            <div className="fixed z-10" style={pos}>
                <AnimatePresence mode="wait">
                    <motion.div
                        key={step}
                        initial={{ opacity: 0, y: 10, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="bg-white rounded-3xl shadow-2xl ring-1 ring-black/5 overflow-hidden"
                    >
                        {intro ? (
                            <div className="px-8 pt-8 pb-8">
                                <div className="flex items-start justify-between">
                                    <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-blue-600 mb-5">Getting started</p>
                                    <button onClick={finish} aria-label="Close tour" className="p-1.5 -mt-1.5 -mr-2 bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-all duration-200">
                                        <X size={14} />
                                    </button>
                                </div>
                                <h2 className="font-extrabold text-slate-900" style={{ fontSize: 'clamp(28px, 6vw, 36px)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
                                    Welcome to<br /><span className="text-slate-300">your portal.</span>
                                </h2>
                                <p className="text-sm text-slate-500 mt-4 leading-relaxed max-w-[38ch]">
                                    A 20-second tour of where everything lives — your projects, billing and updates. Skip anytime; it only shows once.
                                </p>
                                <div className="flex items-center justify-between mt-8">
                                    <button onClick={finish} className="text-[13px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
                                        Skip tour
                                    </button>
                                    <button onClick={next} className="inline-flex items-center gap-2 px-6 h-11 rounded-full bg-blue-600 text-white text-[14px] font-semibold shadow-sm shadow-blue-600/25 hover:bg-blue-700 hover:shadow-blue-600/40 active:scale-[0.98] transition-all">
                                        Take the tour <ArrowRight size={15} strokeWidth={2.5} />
                                    </button>
                                </div>
                            </div>
                        ) : (<>
                        <div className="px-6 pt-5 pb-5">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Getting started</h3>
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-semibold text-slate-400 tabular-nums">{step + 1} of {STEPS.length}</span>
                                    <button onClick={finish} aria-label="Close tour" className="p-1.5 -mr-1.5 bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-all duration-200">
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>
                            <h2 className="text-lg font-bold text-slate-900 tracking-tight leading-snug">{s.title}</h2>
                            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{s.body}</p>
                        </div>
                        <div className="px-6 py-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-3">
                            <button onClick={finish} className="text-[13px] font-semibold text-slate-400 hover:text-slate-600 transition-colors shrink-0">
                                Skip tour
                            </button>
                            <div className="flex items-center gap-2 shrink-0">
                                {step > 0 && (
                                    <button onClick={back} aria-label="Back" className="w-10 h-10 grid place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-white hover:border-slate-300 active:scale-[0.98] transition-all">
                                        <ArrowLeft size={15} />
                                    </button>
                                )}
                                <button onClick={next} className="inline-flex items-center gap-2 px-5 h-10 rounded-full bg-blue-600 text-white text-[13.5px] font-semibold shadow-sm shadow-blue-600/25 hover:bg-blue-700 hover:shadow-blue-600/40 active:scale-[0.98] transition-all">
                                    {last ? <>Done <Check size={15} strokeWidth={2.5} /></> : <>Next <ArrowRight size={15} strokeWidth={2.5} /></>}
                                </button>
                            </div>
                        </div>
                        </>)}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
}
