'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Warm-editorial palette (Inspo Option C) — admin shell only.
const C = {
    ink: '#1C1A17',
    dark: '#16140F',
    muted: '#8A857C',
    faint: '#B5B0A6',
    border: '#E9E5DD',
    hoverBg: '#F6F4F0',
    accent: '#E8552E',
    label: '#A29A86',
};

function toISO(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Custom date picker replacing native <input type="date">.
// Opens on focus/click. `value` is 'YYYY-MM-DD'.
export function DatePicker({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const sel = value ? { y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1, d: Number(value.slice(8, 10)) } : null;
    const today = new Date();
    const [viewY, setViewY] = useState(sel ? sel.y : today.getFullYear());
    const [viewM, setViewM] = useState(sel ? sel.m : today.getMonth());

    useEffect(() => {
        if (!open) return;
        // Re-center the calendar on the selected month each time it opens.
        if (sel) { setViewY(sel.y); setViewM(sel.m); }
        const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const prevMonth = () => { setViewM(m => { if (m === 0) { setViewY(y => y - 1); return 11; } return m - 1; }); };
    const nextMonth = () => { setViewM(m => { if (m === 11) { setViewY(y => y + 1); return 0; } return m + 1; }); };

    const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
    const leadingBlanks = new Date(viewY, viewM, 1).getDay();
    const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());

    const display = sel ? `${sel.d} ${MONTHS[sel.m].slice(0, 3)} ${sel.y}` : (placeholder || 'Select a date');

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                onFocus={() => setOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={open}
                className="w-full h-10 px-3.5 rounded-xl bg-white text-[14px] flex items-center justify-between gap-2 transition-shadow outline-none"
                style={{ boxShadow: open ? `0 0 0 1px ${C.accent}, 0 0 0 3px rgba(232,85,46,0.15)` : `0 0 0 1px ${C.border}` }}
            >
                <span style={{ color: sel ? C.ink : C.faint }}>{display}</span>
                <Calendar size={14} className="shrink-0" style={{ color: C.muted }} />
            </button>
            {open && (
                <div
                    role="dialog"
                    className="absolute z-[70] top-full mt-1.5 w-[268px] rounded-xl bg-white p-3"
                    style={{ boxShadow: `0 0 0 1px ${C.border}, 0 16px 40px -8px rgba(22,20,15,0.25)` }}
                >
                    <div className="flex items-center justify-between mb-2">
                        <button type="button" onClick={prevMonth} aria-label="Previous month" className="h-8 w-8 rounded-full flex items-center justify-center transition-colors" style={{ color: C.muted }} onMouseEnter={e => { e.currentTarget.style.background = C.hoverBg; e.currentTarget.style.color = C.ink; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted; }}><ChevronLeft size={15} /></button>
                        <span className="text-[13px] font-bold" style={{ color: C.ink }}>{MONTHS[viewM]} {viewY}</span>
                        <button type="button" onClick={nextMonth} aria-label="Next month" className="h-8 w-8 rounded-full flex items-center justify-center transition-colors" style={{ color: C.muted }} onMouseEnter={e => { e.currentTarget.style.background = C.hoverBg; e.currentTarget.style.color = C.ink; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted; }}><ChevronRight size={15} /></button>
                    </div>
                    <div className="grid grid-cols-7 gap-0.5 mb-1">
                        {WEEKDAYS.map((w, i) => (
                            <div key={i} className="h-6 flex items-center justify-center text-[10px] font-extrabold uppercase" style={{ color: C.label, letterSpacing: '0.08em' }}>{w}</div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7 gap-0.5">
                        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} className="h-8" />)}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const iso = toISO(viewY, viewM, day);
                            const isSelected = value === iso;
                            const isToday = todayISO === iso;
                            return (
                                <button
                                    key={day}
                                    type="button"
                                    onClick={() => { onChange(iso); setOpen(false); }}
                                    className="h-8 rounded-lg text-[12.5px] font-semibold transition-colors tabular-nums"
                                    style={isSelected
                                        ? { background: C.dark, color: '#fff', fontWeight: 700 }
                                        : isToday
                                            ? { color: C.accent, fontWeight: 700 }
                                            : { color: '#5B5448' }}
                                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.hoverBg; }}
                                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                                >
                                    {day}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
