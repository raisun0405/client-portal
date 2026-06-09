'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function toISO(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Dark-themed custom date picker replacing native <input type="date">.
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
                className="w-full h-10 px-3 rounded-md bg-[#0a0a0a] text-[14px] font-geist flex items-center justify-between gap-2 transition-shadow outline-none"
                style={{ boxShadow: open ? 'rgba(10,114,239,0.6) 0px 0px 0px 1px, rgba(10,114,239,0.20) 0px 0px 0px 3px' : 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
            >
                <span className={sel ? 'text-white' : 'text-[#525252]'}>{display}</span>
                <Calendar size={14} className="text-[#737373] shrink-0" />
            </button>
            {open && (
                <div
                    role="dialog"
                    className="absolute z-[70] top-full mt-1.5 w-[260px] rounded-lg bg-[#161616] p-3"
                    style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px, rgba(0,0,0,0.7) 0px 12px 32px -4px, rgba(0,0,0,0.5) 0px 4px 8px -2px' }}
                >
                    <div className="flex items-center justify-between mb-2">
                        <button type="button" onClick={prevMonth} aria-label="Previous month" className="h-7 w-7 rounded-md flex items-center justify-center text-[#a1a1a1] hover:text-white hover:bg-[#222] transition-colors"><ChevronLeft size={15} /></button>
                        <span className="text-[13px] font-semibold text-white font-geist">{MONTHS[viewM]} {viewY}</span>
                        <button type="button" onClick={nextMonth} aria-label="Next month" className="h-7 w-7 rounded-md flex items-center justify-center text-[#a1a1a1] hover:text-white hover:bg-[#222] transition-colors"><ChevronRight size={15} /></button>
                    </div>
                    <div className="grid grid-cols-7 gap-0.5 mb-1">
                        {WEEKDAYS.map((w, i) => (
                            <div key={i} className="h-6 flex items-center justify-center text-[10px] font-geistmono uppercase text-[#525252]">{w}</div>
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
                                    className={`h-8 rounded-md text-[12.5px] font-geist transition-colors ${isSelected ? 'bg-[#0a72ef] text-white font-semibold' : isToday ? 'text-[#0a72ef] hover:bg-[#222]' : 'text-[#d4d4d4] hover:bg-[#222]'}`}
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
