'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export type SelectOption = { value: string; label: string };

// Dark-themed custom dropdown replacing native <select> in the admin shell.
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
                className="w-full h-10 px-3 rounded-md bg-[#0a0a0a] text-[14px] font-geist flex items-center justify-between gap-2 transition-shadow outline-none disabled:opacity-50"
                style={{ boxShadow: open ? 'rgba(10,114,239,0.6) 0px 0px 0px 1px, rgba(10,114,239,0.20) 0px 0px 0px 3px' : 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
            >
                <span className={selected ? 'text-white truncate' : 'text-[#525252] truncate'}>{selected ? selected.label : (placeholder || 'Select…')}</span>
                <ChevronDown size={15} className={`text-[#737373] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div
                    role="listbox"
                    className={`absolute z-[70] w-full rounded-md bg-[#161616] p-1 max-h-60 overflow-y-auto ${flipUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
                    style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px, rgba(0,0,0,0.7) 0px 12px 32px -4px, rgba(0,0,0,0.5) 0px 4px 8px -2px' }}
                >
                    {options.map(o => (
                        <button
                            key={o.value}
                            type="button"
                            role="option"
                            aria-selected={o.value === value}
                            onClick={() => { onChange(o.value); setOpen(false); }}
                            className={`w-full flex items-center justify-between gap-2 text-left px-2.5 py-2 text-[13px] rounded transition-colors font-geist ${o.value === value ? 'bg-[#222] text-white' : 'text-[#a1a1a1] hover:text-white hover:bg-[#222]'}`}
                        >
                            <span className="truncate">{o.label}</span>
                            {o.value === value && <Check size={13} className="text-[#0a72ef] shrink-0" strokeWidth={2.5} />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
