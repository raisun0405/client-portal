'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export type SelectOption = { value: string; label: string };

// Warm-editorial custom dropdown (Inspo Option C palette) — admin shell only.
const C = {
    ink: '#1C1A17',
    muted: '#8A857C',
    faint: '#B5B0A6',
    border: '#E9E5DD',
    hoverBg: '#F6F4F0',
    accent: '#E8552E',
};

export function Select({
    value,
    onChange,
    options,
    placeholder,
    disabled,
}: {
    value: string;
    onChange: (v: string) => void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [flipUp, setFlipUp] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const toggle = () => {
        if (disabled) return;
        if (!open && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setFlipUp(window.innerHeight - rect.bottom < 240);
        }
        setOpen(o => !o);
    };

    const selected = options.find(o => o.value === value);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={toggle}
                onFocus={() => { if (!disabled && !open) setOpen(true); }}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                className="w-full h-10 px-3.5 rounded-xl bg-white text-[14px] flex items-center justify-between gap-2 transition-shadow outline-none disabled:opacity-50"
                style={{ boxShadow: open ? `0 0 0 1px ${C.accent}, 0 0 0 3px rgba(232,85,46,0.15)` : `0 0 0 1px ${C.border}` }}
            >
                <span className="truncate" style={{ color: selected ? C.ink : C.faint }}>{selected ? selected.label : (placeholder || 'Select…')}</span>
                <ChevronDown size={15} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: C.muted }} />
            </button>
            {open && (
                <div
                    role="listbox"
                    className={`absolute z-[70] w-full rounded-xl bg-white p-1.5 max-h-60 overflow-y-auto ${flipUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
                    style={{ boxShadow: `0 0 0 1px ${C.border}, 0 16px 40px -8px rgba(22,20,15,0.25)` }}
                >
                    {options.map(o => (
                        <button
                            key={o.value}
                            type="button"
                            role="option"
                            aria-selected={o.value === value}
                            onClick={() => { onChange(o.value); setOpen(false); }}
                            className="w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-[13px] rounded-lg transition-colors"
                            style={o.value === value ? { background: C.hoverBg, color: C.ink, fontWeight: 700 } : { color: '#5B5448' }}
                            onMouseEnter={e => { if (o.value !== value) e.currentTarget.style.background = C.hoverBg; }}
                            onMouseLeave={e => { if (o.value !== value) e.currentTarget.style.background = 'transparent'; }}
                        >
                            <span className="truncate">{o.label}</span>
                            {o.value === value && <Check size={13} className="shrink-0" style={{ color: C.accent }} strokeWidth={2.5} />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
