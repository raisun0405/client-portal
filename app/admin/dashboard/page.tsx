'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { logActivity, type ActivityLog } from '@/lib/activityLogger';
import { sendNotification, sendDigestNotification } from '@/lib/notifications';
import { deriveProjectStatus, resolveProjectStatus, type DisplayStatus } from '@/lib/projectStatus';
import { computeProjectStats } from '@/lib/billing';
import { packageSchedule, todayLocalISO, coveragePeriod, shiftDaysISO, shiftMonthsISO, type Cadence } from '@/lib/packageDates';
import { Select } from '@/components/Select';
import { DatePicker } from '@/components/DatePicker';
import { Plus, FolderPlus, Trash2, ArrowLeft, X, Loader2, Pencil, LogOut, ArrowUp, ArrowDown, Mail, MailCheck, Send, CheckCircle2, Clock, Zap, CreditCard, FileText, Link2, Activity, RefreshCw, PackagePlus, ArrowRight, EyeOff, Eye, Search, Copy, Check, UserPlus, MoreHorizontal, ArrowUpRight, ChevronDown, Home, Folder } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';

// Warm Editorial (Inspo Option C) typefaces — scoped to the admin shell only.
const hankenFont = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken' });
const jbMonoFont = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jbmono' });


// --- Types ---
type Client = {
    id: string;
    name: string;
    email: string | null;
    access_key: string;
    created_at: string;
    // Client-level monthly package (retainer). 'per_feature' = bill per feature.
    billing_mode?: string | null;
    package_fee?: number | null;
    package_cadence?: string | null;
    package_status?: string | null;
    package_started_on?: string | null;
    package_anchor_day?: number | null;
};

type ClientStats = {
    projectCount: number;
    completedProjects: number;
    totalValue: number;
    paidValue: number;
    pendingValue: number;
    progress: number;
};

type ClientWithStats = Client & { stats: ClientStats };

type ClientSortField = 'recent' | 'name' | 'projects' | 'value';

type Project = {
    id: string;
    client_id: string;
    category: string;
    description: string;
    status: string;
    status_override?: string | null;
    links: { title: string; url: string }[];
    created_at: string;
};

type Feature = {
    id: string;
    project_id: string;
    description: string;
    estimation: string;
    amount: number;
    paid_amount: number;
    status: string;
    payment_status: string;
    is_new_request: boolean;
    payment_confirmed: boolean;
    created_at: string;
};

type BillingPeriod = {
    id: string;
    client_id: string;
    period_start: string;
    period_end: string;
    fee_amount: number;
    paid_amount: number;
    payment_status: string;
    origin?: string;
    note?: string | null;
};

// Sorting types
type SortField = 'amount' | 'status' | 'created_at';
type SortOrder = 'asc' | 'desc';

// Enhanced Project type with calculated stats
type ProjectWithStats = Project & {
    displayStatus: DisplayStatus;
    stats: {
        total: number;
        paid: number;
        pending: number;
        progress: number;
        totalFeatures: number;
        completedFeatures: number;
    };
};

// ===== Cool Slate design tokens (Inspo Option C layout · reference palette) =====
const T = {
    bg: '#EEF1F5',          // beige canvas
    card: '#FFFFFF',
    ink: '#1C2128',
    dark: '#1A1D25',        // dark hero card / SHIP pill / active rail
    muted: '#6E7686',
    faint: '#A8AEBC',
    border: '#E4E7ED',
    borderSoft: '#EDEFF3',
    hairline: '#DFE3EA',    // editorial row separators
    railBorder: '#DCE0E8',
    label: '#959DAD',       // small-caps section labels
    accent: '#EE4D2D',
    accentSoft: '#FCE9E4',
    green: '#1F8A5B',
    greenSoft: '#E4F2EB',
    amber: '#A86B2D',
    amberSoft: '#F7EDD8',
};

const AVATAR_HUES = ['#EE4D2D', '#1A1D25', '#5B7CB5', '#4A515E'];
const hueFor = (name: string) => AVATAR_HUES[(name || ' ').split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_HUES.length];

function WarmAvatar({ name, size = 44 }: { name: string; size?: number }) {
    return (
        <div
            className="rounded-full grid place-items-center text-white font-bold shrink-0 select-none"
            style={{ width: size, height: size, background: hueFor(name), fontSize: Math.round(size * 0.38), letterSpacing: '0.02em' }}
        >
            {(name || '?').charAt(0).toUpperCase()}
        </div>
    );
}

// Stage pill tones — REAL statuses, Option C pill anatomy (soft bg, dot, small caps).
type PillTone = { bg: string; fg: string; dot: string };
const PROJECT_STAGE: Record<string, PillTone> = {
    'Not Started': { bg: '#EAEDF2', fg: '#5E6675', dot: '#A0A7B4' },
    'In Progress': { bg: '#FCE9E4', fg: '#EE4D2D', dot: '#EE4D2D' },
    'Completed': { bg: '#1A1D25', fg: '#FFFFFF', dot: '#FFFFFF' },
    'On Hold': { bg: '#F7EDD8', fg: '#A86B2D', dot: '#A86B2D' },
    'Cancelled': { bg: '#EDEFF3', fg: '#6E7686', dot: '#A8AEBC' },
};
const FEATURE_STAGE: Record<string, PillTone> = {
    Requested: { bg: '#EAEDF2', fg: '#5E6675', dot: '#A0A7B4' },
    Approved: { bg: '#EDEFF3', fg: '#4A515E', dot: '#4A515E' },
    Working: { bg: '#FCE9E4', fg: '#EE4D2D', dot: '#EE4D2D' },
    Updating: { bg: '#FCE9E4', fg: '#EE4D2D', dot: '#EE4D2D' },
    Completed: { bg: '#1A1D25', fg: '#FFFFFF', dot: '#FFFFFF' },
};

function StagePill({ label, tone, size = 'md' }: { label: string; tone: PillTone; size?: 'sm' | 'md' }) {
    return (
        <span
            className="inline-flex items-center gap-1.5 rounded-full whitespace-nowrap font-bold uppercase shrink-0"
            style={{ background: tone.bg, color: tone.fg, padding: size === 'sm' ? '3px 9px' : '5px 11px', fontSize: size === 'sm' ? 10 : 11, letterSpacing: '0.05em' }}
        >
            <span className="rounded-full shrink-0" style={{ width: 5, height: 5, background: tone.dot }} />
            {label}
        </span>
    );
}

// Editorial section header — 2px ink underline, oversized title, small-caps meta.
function SectionHead({ title, meta, right }: { title: string; meta?: string; right?: React.ReactNode }) {
    return (
        <div className="flex items-baseline gap-3.5 pb-3.5 flex-wrap" style={{ borderBottom: `2px solid ${T.ink}` }}>
            <h2 className="font-extrabold" style={{ fontSize: 24, letterSpacing: '-0.02em', margin: 0, color: T.ink }}>{title}</h2>
            {meta && <span className="text-[11.5px] font-extrabold uppercase" style={{ letterSpacing: '0.14em', color: T.label }}>{meta}</span>}
            {right && <div className="ml-auto">{right}</div>}
        </div>
    );
}

function EmptyBlock({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
    return (
        <div className="py-16 px-6 text-center" style={{ borderBottom: `1px solid ${T.hairline}` }}>
            <div className="inline-grid place-items-center w-12 h-12 rounded-2xl mb-4" style={{ background: '#EAEDF2', color: '#5E6675' }}>{icon}</div>
            <p className="font-extrabold" style={{ fontSize: 19, letterSpacing: '-0.02em', color: T.ink }}>{title}</p>
            <p className="text-[13.5px] mt-1.5 max-w-sm mx-auto" style={{ color: T.muted }}>{sub}</p>
        </div>
    );
}

// Option C's dark hero card — collection % + split bar, real money only.
function DarkPanel({ heading, pct, collected, outstanding }: { heading: string; pct: number; collected: number; outstanding: number }) {
    const fmt = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;
    return (
        <section className="rounded-[26px] text-white px-7 sm:px-9 pt-7 pb-8" style={{ background: T.dark }}>
            <div className="flex items-baseline">
                <div className="text-[11.5px] font-extrabold uppercase" style={{ letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)' }}>{heading}</div>
                <div className="ml-auto flex gap-1.5">
                    {[T.accent, '#FFFFFF', '#5E6675'].map((h, i) => <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: h }} />)}
                </div>
            </div>
            <div className="flex flex-col lg:flex-row lg:items-end gap-8 lg:gap-14 mt-7">
                <div className="shrink-0">
                    <div className="font-extrabold tabular-nums" style={{ fontSize: 'clamp(44px, 5vw, 56px)', letterSpacing: '-0.04em', lineHeight: 1, color: T.accent }}>{pct}%</div>
                    <div className="text-[13.5px] mt-2 max-w-[190px] leading-[1.5]" style={{ color: 'rgba(255,255,255,0.55)' }}>of contracted value collected to date</div>
                </div>
                <div className="flex-1 w-full min-w-0">
                    <div className="flex h-[14px] rounded-full overflow-hidden gap-[3px]">
                        {pct > 0 && <div className="rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: T.accent }} />}
                        {pct < 100 && <div className="flex-1 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />}
                    </div>
                    <div className="flex mt-4 gap-4 flex-wrap">
                        <div>
                            <div className="text-[20px] sm:text-[22px] font-extrabold tabular-nums">{fmt(collected)}</div>
                            <div className="text-[11px] font-bold mt-0.5" style={{ color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em' }}>REALIZED REVENUE</div>
                        </div>
                        <div className="ml-auto text-right">
                            <div className="text-[20px] sm:text-[22px] font-extrabold tabular-nums" style={{ color: 'rgba(255,255,255,0.75)' }}>{fmt(outstanding)}</div>
                            <div className="text-[11px] font-bold mt-0.5" style={{ color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em' }}>AWAITING — {Math.max(100 - pct, 0)}%</div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

// Slim icon-rail button (Option C left rail).
function RailBtn({ icon: Icon, active, disabled, onClick, title }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; active?: boolean; disabled?: boolean; onClick?: () => void; title: string }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            aria-label={title}
            className="w-11 h-11 rounded-[14px] grid place-items-center transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
            style={active ? { background: T.dark, color: '#fff' } : { color: '#828A99' }}
            onMouseEnter={e => { if (!active && !disabled) e.currentTarget.style.background = 'rgba(26,29,37,0.06)'; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
        >
            <Icon size={19} strokeWidth={1.8} />
        </button>
    );
}

// Shared warm form-control styling (modals).
const wLabelCls = 'block text-[10.5px] font-extrabold uppercase tracking-[0.12em] mb-2';
const wInputCls = 'w-full h-10 px-3.5 rounded-xl bg-white text-[14px] outline-none transition-shadow';
const wInputStyle: React.CSSProperties = { boxShadow: `0 0 0 1px ${T.border}`, color: T.ink };
const wFocus = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.boxShadow = `0 0 0 1px ${T.accent}, 0 0 0 3px rgba(238,77,45,0.15)`; };
const wBlur = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.boxShadow = `0 0 0 1px ${T.border}`; };

export default function AdminDashboard() {
    const router = useRouter();
    const [view, setView] = useState<'clients' | 'projects' | 'features' | 'links' | 'activity'>('clients');

    // Data State
    const [clients, setClients] = useState<ClientWithStats[]>([]);
    const [clientSearch, setClientSearch] = useState('');
    const [clientSort, setClientSort] = useState<ClientSortField>('recent');
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [menuFlipUp, setMenuFlipUp] = useState(false);
    const [sortOpen, setSortOpen] = useState(false);
    const [projects, setProjects] = useState<ProjectWithStats[]>([]);
    const [features, setFeatures] = useState<Feature[]>([]);
    const [links, setLinks] = useState<{ title: string; url: string }[]>([]);

    // Selection State
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [selectedProject, setSelectedProject] = useState<ProjectWithStats | null>(null);

    // Loading State
    const [loading, setLoading] = useState(false);

    // Form State
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState<any>({});

    // Convert-client-to-Package modal (preview-first; writes nothing until confirmed)
    const [packageClient, setPackageClient] = useState<ClientWithStats | null>(null);
    const [packageForm, setPackageForm] = useState<{ startDate: string; fee: string; disposition: string }>({ startDate: '', fee: '', disposition: 'writeoff' });
    const [packageSaving, setPackageSaving] = useState(false);

    // Manage-package modal (record monthly payments, generate periods)
    const [managePackageClient, setManagePackageClient] = useState<ClientWithStats | null>(null);
    const [managePeriods, setManagePeriods] = useState<BillingPeriod[]>([]);
    const [periodPayInputs, setPeriodPayInputs] = useState<Record<string, string>>({});
    const [periodsLoading, setPeriodsLoading] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingLinkIndex, setEditingLinkIndex] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);

    // Sorting state for features
    const [sortField, setSortField] = useState<SortField>('created_at');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

    // Recent activity across ALL clients (overview's "Recent" column)
    const [recentLogs, setRecentLogs] = useState<ActivityLog[]>([]);

    // Activity log state
    const [activityLogs, setActivityLogs] = useState<(ActivityLog & { notified_at: string | null })[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
    const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set());
    const [sendingDigest, setSendingDigest] = useState(false);

    useEffect(() => {
        // Check Supabase Auth Session
        const checkAuth = async () => {
            const { data: { session } } = await supabaseAdmin.auth.getSession();
            if (!session) {
                router.push('/admin');
            } else {
                fetchClients();
            }
        };
        checkAuth();
    }, [router]);

    // Close dropdown menus on outside click / escape
    useEffect(() => {
        if (!openMenuId && !sortOpen) return;
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('[data-menu-root]')) {
                setOpenMenuId(null);
                setSortOpen(false);
            }
        };
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setOpenMenuId(null); setSortOpen(false); }
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [openMenuId, sortOpen]);

    // --- Remote Fetchers ---
    const fetchClients = async () => {
        setLoading(true);
        const { data: clientsData } = await supabaseAdmin.from('clients').select('*').order('created_at', { ascending: false });
        if (!clientsData) { setClients([]); setLoading(false); return; }

        // Fetch all projects and features in parallel for aggregate stats
        // (+ the latest activity across all clients for the overview's Recent column)
        const [{ data: projectsData }, { data: featuresData }, { data: recentData }] = await Promise.all([
            supabaseAdmin.from('projects').select('id, client_id, status, status_override'),
            supabaseAdmin.from('features').select('project_id, amount, paid_amount, status, payment_confirmed'),
            supabaseAdmin.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(10),
        ]);
        setRecentLogs(((recentData || []) as ActivityLog[]).filter(l => !l.is_hidden).slice(0, 6));

        const projectsByClient = new Map<string, { id: string; status: string; status_override?: string | null }[]>();
        (projectsData || []).forEach((p: any) => {
            if (!projectsByClient.has(p.client_id)) projectsByClient.set(p.client_id, []);
            projectsByClient.get(p.client_id)!.push({ id: p.id, status: p.status, status_override: p.status_override });
        });

        const featuresByProject = new Map<string, any[]>();
        (featuresData || []).forEach((f: any) => {
            if (!featuresByProject.has(f.project_id)) featuresByProject.set(f.project_id, []);
            featuresByProject.get(f.project_id)!.push(f);
        });

        const withStats: ClientWithStats[] = clientsData.map((c: Client) => {
            const clientProjects = projectsByClient.get(c.id) || [];
            let totalValue = 0, paidValue = 0, totalFeatures = 0, completedFeatures = 0;
            clientProjects.forEach(p => {
                const feats = featuresByProject.get(p.id) || [];
                const s = computeProjectStats(feats);
                totalValue += s.total;
                paidValue += s.paid;
                totalFeatures += feats.length;
                completedFeatures += feats.filter((f: any) => f.status === 'Completed').length;
            });
            const completedProjects = clientProjects.filter(p =>
                resolveProjectStatus(p.status_override, featuresByProject.get(p.id) || []) === 'Completed'
            ).length;
            const progress = totalFeatures > 0 ? Math.round((completedFeatures / totalFeatures) * 100) : 0;
            return {
                ...c,
                stats: {
                    projectCount: clientProjects.length,
                    completedProjects,
                    totalValue,
                    paidValue,
                    pendingValue: Math.max(totalValue - paidValue, 0),
                    progress,
                },
            };
        });

        setClients(withStats);
        setLoading(false);
    };

    const copyAccessKey = async (key: string) => {
        try {
            await navigator.clipboard.writeText(key);
            setCopiedKey(key);
            setTimeout(() => setCopiedKey(null), 1500);
        } catch {
            // silent fail
        }
    };

    const fetchProjects = async (clientId: string) => {
        setLoading(true);

        // 1. Fetch all projects for this client
        const { data: projectsData } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        if (projectsData && projectsData.length > 0) {
            // 2. Fetch ALL features for these projects to calculate stats
            const projectIds = projectsData.map(p => p.id);
            const { data: featuresData } = await supabaseAdmin
                .from('features')
                .select('*')
                .in('project_id', projectIds);

            // 3. Calculate stats for each project
            const enhancedProjects: ProjectWithStats[] = projectsData.map(project => {
                const projectFeatures = featuresData?.filter(f => f.project_id === project.id) || [];
                // Per-project feature money (see lib/billing.ts)
                const { total, paid } = computeProjectStats(projectFeatures);

                // Progress Calculation
                const totalFeatures = projectFeatures.length;
                const completedFeatures = projectFeatures.filter(f => f.status === 'Completed').length;
                const progress = totalFeatures > 0 ? Math.round((completedFeatures / totalFeatures) * 100) : 0;

                return {
                    ...project,
                    links: project.links || [],
                    displayStatus: resolveProjectStatus(project.status_override, projectFeatures),
                    stats: {
                        total,
                        paid,
                        pending: total - paid,
                        progress,
                        totalFeatures,
                        completedFeatures
                    }
                };
            });
            setProjects(enhancedProjects);
        } else {
            setProjects([]);
        }
        setLoading(false);
    };

    const fetchFeatures = async (projectId: string) => {
        setLoading(true);
        const { data } = await supabaseAdmin.from('features').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
        if (data) setFeatures(data);
        setLoading(false);
    };

    // --- Handlers ---
    const handleClientSelect = (client: Client) => {
        setSelectedClient(client);
        fetchProjects(client.id);
        setView('projects');
    };

    const handleProjectSelect = (project: ProjectWithStats) => {
        setSelectedProject(project);
        fetchFeatures(project.id);
        setView('features');
    };

    const handleProjectLinksSelect = (project: ProjectWithStats) => {
        setSelectedProject(project);
        setLinks(project.links || []);
        setView('links');
    };

    // Jump straight back to the overview from anywhere (icon rail home).
    const goOverview = () => {
        setView('clients');
        setSelectedClient(null);
        setSelectedProject(null);
        setFeatures([]);
        setLinks([]);
        setActivityLogs([]);
    };

    const handleBack = () => {
        if (view === 'features' || view === 'links') {
            setView('projects');
            setSelectedProject(null);
            setFeatures([]);
            setLinks([]);
        } else if (view === 'projects' || view === 'activity') {
            setView('clients');
            setSelectedClient(null);
            setProjects([]);
            setActivityLogs([]);
        }
    };

    // --- Edit Handlers (opens modal with existing data) ---
    const handleEditClient = (client: Client) => {
        setFormData({ name: client.name, email: client.email || '', access_key: client.access_key });
        setEditingId(client.id);
        setShowModal(true);
    };

    const openPackageModal = (client: ClientWithStats) => {
        const today = todayLocalISO();
        setPackageClient(client);
        setPackageForm({ startDate: today, fee: '', disposition: 'writeoff' });
    };

    // Commit a client -> monthly package. Writes the before_state undo record FIRST,
    // so the whole thing is reversible via handleUndoPackage.
    const handleConfirmPackage = async () => {
        if (!packageClient) return;
        const client = packageClient;
        const fee = Number(packageForm.fee) || 0;
        const startDate = packageForm.startDate;
        const disp = packageForm.disposition;
        if (!startDate || fee <= 0) { alert('Please set a start date and a monthly fee.'); return; }
        setPackageSaving(true);
        try {
            // Guard against double-conversion (e.g. a stale second tab): re-read live billing_mode.
            const { data: fresh } = await supabaseAdmin.from('clients').select('billing_mode').eq('id', client.id).single();
            if (fresh?.billing_mode === 'package') {
                alert('This client is already on a monthly package.');
                return;
            }

            // 1. The client's pending confirmed features (across ALL their projects)
            const { data: projs } = await supabaseAdmin.from('projects').select('id').eq('client_id', client.id);
            const projectIds = (projs || []).map((p: any) => p.id);
            let pendingFeats: any[] = [];
            if (projectIds.length > 0) {
                const { data: feats } = await supabaseAdmin
                    .from('features')
                    .select('id, amount, paid_amount, payment_status, payment_confirmed')
                    .in('project_id', projectIds);
                pendingFeats = (feats || []).filter((f: any) => f.payment_confirmed !== false && (Number(f.amount) || 0) > (Number(f.paid_amount) || 0));
            }
            const pendingSnapshot = pendingFeats.reduce((s, f) => s + ((Number(f.amount) || 0) - (Number(f.paid_amount) || 0)), 0);

            // 2. before_state undo buffer
            const beforeState = {
                client: {
                    billing_mode: client.billing_mode || 'per_feature',
                    package_fee: client.package_fee ?? 0,
                    package_status: client.package_status ?? 'active',
                    package_started_on: client.package_started_on ?? null,
                    package_anchor_day: client.package_anchor_day ?? null,
                    package_cadence: client.package_cadence ?? 'monthly',
                },
                features: pendingFeats.map(f => ({ id: f.id, amount: f.amount, paid_amount: f.paid_amount, payment_status: f.payment_status })),
            };

            // 3. Write the undo record FIRST
            const { error: migErr } = await supabaseAdmin.from('package_migrations').insert([{
                client_id: client.id,
                status: 'committed',
                pending_disposition: disp,
                pending_snapshot: pendingSnapshot,
                affected_feature_ids: pendingFeats.map(f => f.id),
                before_state: beforeState,
            }]);
            if (migErr) throw new Error(migErr.message);

            // 4. Apply the disposition to the pending features
            //    writeoff / settle / roll_into_first all clear the pending (mark paid);
            //    keep_one_time leaves them outstanding.
            if (disp !== 'keep_one_time') {
                for (const f of pendingFeats) {
                    await supabaseAdmin.from('features').update({ paid_amount: f.amount, payment_status: 'Paid' }).eq('id', f.id);
                }
            }

            // 5. Flip the client to package mode (anchor day = start date's day-of-month)
            const anchorDay = Number(startDate.split('-')[2]);
            const { error: cliErr } = await supabaseAdmin.from('clients').update({
                billing_mode: 'package',
                package_fee: fee,
                package_status: 'active',
                package_started_on: startDate,
                package_anchor_day: anchorDay,
                package_cadence: 'monthly',
            }).eq('id', client.id);
            if (cliErr) throw new Error(cliErr.message);

            // 6. First billing period — billed on startDate, covers the PRIOR month (arrears)
            const cov = coveragePeriod(startDate, 'monthly');
            const firstFee = disp === 'roll_into_first' ? fee + pendingSnapshot : fee;
            await supabaseAdmin.from('billing_periods').insert([{
                client_id: client.id,
                period_start: cov.start,
                period_end: cov.end,
                fee_amount: firstFee,
                paid_amount: 0,
                payment_status: 'Pending',
                origin: 'manual',
                note: disp === 'roll_into_first' && pendingSnapshot > 0 ? `Includes carried-over balance of ₹${pendingSnapshot.toLocaleString('en-IN')}` : null,
            }]);

            // 7. Activity log (client-level)
            const dispLabel = disp === 'writeoff' ? 'written off' : disp === 'settle' ? 'settled' : disp === 'roll_into_first' ? 'rolled into the first invoice' : 'kept as a one-time balance';
            await logActivity({
                clientId: client.id,
                projectId: null,
                actionType: 'package_started',
                title: 'Switched to Monthly Package',
                description: `${client.name} is now on a ₹${fee.toLocaleString('en-IN')}/month package${pendingSnapshot > 0 ? ` — pending ₹${pendingSnapshot.toLocaleString('en-IN')} ${dispLabel}` : ''}`,
                metadata: { amount: fee, monthlyFee: fee, pendingBefore: pendingSnapshot, disposition: disp },
            });

            setPackageClient(null);
            fetchClients();
        } catch (err: any) {
            alert('Conversion failed: ' + (err?.message || 'unknown error'));
        } finally {
            setPackageSaving(false);
        }
    };

    // Reverse the most recent package conversion for a client (replays before_state).
    const handleUndoPackage = async (client: ClientWithStats) => {
        if (!confirm(`Undo the package conversion for ${client.name}? This restores their per-feature billing and any written-off balances.`)) return;
        setPackageSaving(true);
        try {
            // Block undo if any billing period has a recorded payment — undoing would
            // orphan/lose that payment history. Admin must zero it out first.
            const { data: paidPeriods } = await supabaseAdmin
                .from('billing_periods')
                .select('id')
                .eq('client_id', client.id)
                .gt('paid_amount', 0);
            if (paidPeriods && paidPeriods.length > 0) {
                alert('This package has recorded payments, so it can’t be undone automatically. Zero out those payments in "Manage package" first, or keep the package.');
                return;
            }

            const { data: migs } = await supabaseAdmin
                .from('package_migrations')
                .select('*')
                .eq('client_id', client.id)
                .eq('status', 'committed')
                .order('performed_at', { ascending: false })
                .limit(1);
            const mig = migs && migs[0];
            if (!mig) { alert('No package conversion found to undo.'); setPackageSaving(false); return; }

            const before = mig.before_state || {};
            // Restore each affected feature's original money state
            for (const f of (before.features || [])) {
                await supabaseAdmin.from('features').update({ paid_amount: f.paid_amount, payment_status: f.payment_status }).eq('id', f.id);
            }
            // Restore the client's prior billing fields
            const c = before.client || {};
            await supabaseAdmin.from('clients').update({
                billing_mode: c.billing_mode || 'per_feature',
                package_fee: c.package_fee ?? 0,
                package_status: c.package_status ?? 'active',
                package_started_on: c.package_started_on ?? null,
                package_anchor_day: c.package_anchor_day ?? null,
                package_cadence: c.package_cadence ?? 'monthly',
            }).eq('id', client.id);
            // Remove this client's package billing periods. Safe: we verified above
            // that none have a recorded payment, so no payment history is lost.
            await supabaseAdmin.from('billing_periods').delete().eq('client_id', client.id);
            // Mark the migration reverted
            await supabaseAdmin.from('package_migrations').update({ status: 'reverted', reverted_at: new Date().toISOString() }).eq('id', mig.id);

            await logActivity({
                clientId: client.id,
                projectId: null,
                actionType: 'package_reverted',
                title: 'Package Conversion Undone',
                description: `${client.name} reverted to per-feature billing`,
                metadata: {},
            });
            fetchClients();
        } catch (err: any) {
            alert('Undo failed: ' + (err?.message || 'unknown error'));
        } finally {
            setPackageSaving(false);
        }
    };

    const fetchClientPeriods = async (clientId: string) => {
        setPeriodsLoading(true);
        const { data } = await supabaseAdmin.from('billing_periods').select('*').eq('client_id', clientId).order('period_start', { ascending: false });
        setManagePeriods((data as BillingPeriod[]) || []);
        const inputs: Record<string, string> = {};
        (data || []).forEach((p: any) => { inputs[p.id] = String(p.paid_amount ?? ''); });
        setPeriodPayInputs(inputs);
        setPeriodsLoading(false);
    };

    const openManagePackage = (client: ClientWithStats) => {
        setManagePackageClient(client);
        setManagePeriods([]);
        fetchClientPeriods(client.id);
    };

    // Record (set) the amount paid for a billing period and recompute its status.
    const recordPeriodPayment = async (period: BillingPeriod) => {
        if (!managePackageClient) return;
        const newPaid = Number(periodPayInputs[period.id]) || 0;
        const fee = Number(period.fee_amount) || 0;
        const oldPaid = Number(period.paid_amount) || 0;
        const status = (fee > 0 && newPaid >= fee) ? 'Paid' : newPaid > 0 ? 'Partial' : 'Pending';
        setPackageSaving(true);
        try {
            const { error } = await supabaseAdmin.from('billing_periods').update({ paid_amount: newPaid, payment_status: status }).eq('id', period.id);
            if (error) throw new Error(error.message);
            await logActivity({
                clientId: managePackageClient.id,
                projectId: null,
                actionType: 'payment_received',
                title: newPaid > oldPaid ? `Package Payment — ₹${(newPaid - oldPaid).toLocaleString('en-IN')}` : 'Package Payment Updated',
                description: `${period.period_start} – ${period.period_end}: ₹${newPaid.toLocaleString('en-IN')} of ₹${fee.toLocaleString('en-IN')} (${status})`,
                metadata: { amount: fee, paidAmount: newPaid, oldPaidAmount: oldPaid },
            });
            await fetchClientPeriods(managePackageClient.id);
            fetchClients();
        } catch (err: any) {
            alert('Could not record payment: ' + (err?.message || 'unknown error'));
        } finally {
            setPackageSaving(false);
        }
    };

    // Create the next consecutive billing period for a package client (arrears).
    const generateNextPeriod = async (client: ClientWithStats) => {
        if (!client.package_started_on) return;
        const cadence = (client.package_cadence || 'monthly') as Cadence;
        let nextStart: string, nextEnd: string;
        if (managePeriods.length) {
            // Next coverage month starts the day after the latest one ends.
            nextStart = shiftDaysISO(managePeriods[0].period_end, 1);
            nextEnd = shiftDaysISO(shiftMonthsISO(nextStart, 1), -1);
        } else {
            const cov = coveragePeriod(client.package_started_on, cadence);
            nextStart = cov.start; nextEnd = cov.end;
        }
        setPackageSaving(true);
        try {
            const { error } = await supabaseAdmin.from('billing_periods').insert([{
                client_id: client.id, period_start: nextStart, period_end: nextEnd,
                fee_amount: Number(client.package_fee) || 0, paid_amount: 0, payment_status: 'Pending', origin: 'manual',
            }]);
            if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
            await fetchClientPeriods(client.id);
        } catch (err: any) {
            alert('Could not generate period: ' + (err?.message || 'unknown error'));
        } finally {
            setPackageSaving(false);
        }
    };

    // Create every billing period that is already due but not yet generated.
    const generateMissingPeriods = async (client: ClientWithStats, missingStarts: string[]) => {
        if (!client.package_started_on || missingStarts.length === 0) return;
        setPackageSaving(true);
        try {
            for (const start of missingStarts) {
                const end = shiftDaysISO(shiftMonthsISO(start, 1), -1);
                const { error } = await supabaseAdmin.from('billing_periods').insert([{
                    client_id: client.id, period_start: start, period_end: end,
                    fee_amount: Number(client.package_fee) || 0, paid_amount: 0, payment_status: 'Pending', origin: 'auto',
                }]);
                if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
            }
            await fetchClientPeriods(client.id);
        } catch (err: any) {
            alert('Could not generate periods: ' + (err?.message || 'unknown error'));
        } finally {
            setPackageSaving(false);
        }
    };

    const handleEditProject = (project: ProjectWithStats) => {
        setFormData({ description: project.description, category: project.category, status_override: project.status_override || '' });
        setEditingId(project.id);
        setShowModal(true);
    };

    const handleEditFeature = (feature: Feature) => {
        setFormData({
            description: feature.description,
            estimation: feature.estimation,
            amount: feature.amount,
            paid_amount: feature.paid_amount,
            status: feature.status,
            payment_status: feature.payment_status,
            is_new_request: feature.is_new_request ? 'true' : 'false',
            payment_confirmed: feature.payment_confirmed !== false
        });
        setEditingId(feature.id);
        setShowModal(true);
    };

    // --- Create/Update Handlers ---
    const handleSaveClient = async () => {
        if (editingId) {
            // UPDATE
            const { error } = await supabaseAdmin.from('clients').update({
                name: formData.name,
                email: formData.email || null,
                access_key: formData.access_key
            }).eq('id', editingId);
            if (!error) {
                fetchClients();
            } else {
                alert('Error: ' + error.message);
            }
        } else {
            // CREATE
            const { data, error } = await supabaseAdmin.from('clients').insert([{
                name: formData.name,
                email: formData.email || null,
                access_key: formData.access_key
            }]).select();
            if (!error && data) {
                const newClient: ClientWithStats = {
                    ...(data[0] as Client),
                    stats: { projectCount: 0, completedProjects: 0, totalValue: 0, paidValue: 0, pendingValue: 0, progress: 0 },
                };
                setClients([newClient, ...clients]);
            } else {
                alert('Error: ' + error?.message);
            }
        }
        setShowModal(false);
        setFormData({});
        setEditingId(null);
    };

    const handleSaveProject = async () => {
        // Project status is derived from features; the only manual lever is the
        // override ('On Hold' / 'Cancelled'). Empty / 'Auto' clears the override.
        const newOverride = (formData.status_override === 'On Hold' || formData.status_override === 'Cancelled')
            ? formData.status_override
            : null;

        if (editingId) {
            // UPDATE
            const oldProject = projects.find(p => p.id === editingId);
            const { error } = await supabaseAdmin.from('projects').update({
                category: formData.category,
                description: formData.description,
                status_override: newOverride
            }).eq('id', editingId);
            if (!error && selectedClient) {
                fetchProjects(selectedClient.id);
                // Log activity
                if (oldProject) {
                    const oldOverride = oldProject.status_override || null;
                    const overrideChanged = oldOverride !== newOverride;
                    const nameChanged = oldProject.description !== formData.description;
                    const categoryChanged = oldProject.category !== formData.category;
                    const overrideLabel = (v: string | null) => v || 'Auto (follow features)';

                    const changes: string[] = [];
                    const structuredChanges: Record<string, { old: any; new: any }> = {};

                    if (nameChanged) {
                        changes.push(`Name: "${oldProject.description}" → "${formData.description}"`);
                        structuredChanges['Project Name'] = { old: oldProject.description, new: formData.description };
                    }
                    if (categoryChanged) {
                        changes.push(`Category: ${oldProject.category} → ${formData.category}`);
                        structuredChanges['Category'] = { old: oldProject.category, new: formData.category };
                    }
                    if (overrideChanged) {
                        changes.push(`Status: ${overrideLabel(oldOverride)} → ${overrideLabel(newOverride)}`);
                        structuredChanges['Status'] = { old: overrideLabel(oldOverride), new: overrideLabel(newOverride) };
                    }

                    const actionType = 'project_updated';
                    let title = 'Project Updated';
                    let desc = `"${formData.description}" was updated`;

                    if (nameChanged && !overrideChanged && !categoryChanged) {
                        title = 'Project Renamed';
                        desc = `Project renamed from "${oldProject.description}" to "${formData.description}"`;
                    } else if (changes.length > 0) {
                        desc = `"${formData.description}" — ${changes.join(', ')}`;
                    }

                    await logActivity({
                        clientId: selectedClient.id,
                        projectId: editingId,
                        actionType,
                        title,
                        description: desc,
                        metadata: {
                            category: formData.category,
                            statusOverride: newOverride,
                            changes: structuredChanges
                        },
                    });
                }
            } else {
                alert('Error: ' + error?.message);
            }
        } else {
            // CREATE
            const payload = {
                client_id: selectedClient?.id,
                category: formData.category || 'General',
                description: formData.description || 'New Project',
                status: 'Not Started',
                status_override: newOverride,
                links: []
            };
            const { data, error } = await supabaseAdmin.from('projects').insert([payload]).select();
            if (!error && data && selectedClient) {
                const newProject: ProjectWithStats = {
                    ...data[0],
                    displayStatus: resolveProjectStatus(newOverride, []),
                    stats: { total: 0, paid: 0, pending: 0, progress: 0, totalFeatures: 0, completedFeatures: 0 }
                };
                setProjects([newProject, ...projects]);
                // Log activity
                await logActivity({
                    clientId: selectedClient.id,
                    projectId: data[0].id,
                    actionType: 'project_created',
                    title: 'New Project Created',
                    description: `"${payload.description}" was created under ${payload.category}`,
                    metadata: { category: payload.category, status: payload.status },
                });
            } else {
                alert('Error: ' + error?.message);
            }
        }
        setShowModal(false);
        setFormData({});
        setEditingId(null);
    };

    const handleAddLink = async () => {
        if (!selectedProject || saving) return;
        setSaving(true);

        try {
        const isEditing = editingLinkIndex !== null;
        const updatedLinks = [...(selectedProject.links || [])];

        if (isEditing) {
            // Edit existing link
            const oldLink = updatedLinks[editingLinkIndex];
            updatedLinks[editingLinkIndex] = { title: formData.link_title, url: formData.link_url };

            const { error } = await supabaseAdmin
                .from('projects')
                .update({ links: updatedLinks })
                .eq('id', selectedProject.id);

            if (!error) {
                const updatedProject = { ...selectedProject, links: updatedLinks };
                setSelectedProject(updatedProject);
                setLinks(updatedLinks);
                setProjects(projects.map(p => p.id === selectedProject.id ? updatedProject : p));

                if (selectedClient) {
                    await logActivity({
                        clientId: selectedClient.id,
                        projectId: selectedProject.id,
                        actionType: 'link_updated',
                        title: 'Link Updated',
                        description: `"${oldLink.title}" link was updated in "${selectedProject.description}"`,
                        metadata: {
                            changes: {
                                ...(oldLink.title !== formData.link_title ? { title: { old: oldLink.title, new: formData.link_title } } : {}),
                                ...(oldLink.url !== formData.link_url ? { url: { old: oldLink.url, new: formData.link_url } } : {}),
                            },
                        },
                    });
                }

                setShowModal(false);
                setFormData({});
                setEditingLinkIndex(null);
            } else {
                alert('Error updating link: ' + error.message);
            }
        } else {
            // Add new link
            const newLink = { title: formData.link_title, url: formData.link_url };
            updatedLinks.push(newLink);

            const { error } = await supabaseAdmin
                .from('projects')
                .update({ links: updatedLinks })
                .eq('id', selectedProject.id);

            if (!error) {
                const updatedProject = { ...selectedProject, links: updatedLinks };
                setSelectedProject(updatedProject);
                setLinks(updatedLinks);
                setProjects(projects.map(p => p.id === selectedProject.id ? updatedProject : p));

                if (selectedClient) {
                    await logActivity({
                        clientId: selectedClient.id,
                        projectId: selectedProject.id,
                        actionType: 'link_added',
                        title: 'Link Added',
                        description: `"${formData.link_title}" link was added to "${selectedProject.description}"`,
                        metadata: { link_title: formData.link_title, link_url: formData.link_url },
                    });
                }

                setShowModal(false);
                setFormData({});
            } else {
                alert('Error adding link: ' + error.message);
            }
        }
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteLink = async (index: number) => {
        if (!selectedProject || !confirm("Delete this link?")) return;
        const updatedLinks = [...(selectedProject.links || [])];
        const deletedLink = updatedLinks[index];
        updatedLinks.splice(index, 1);

        const { error } = await supabaseAdmin
            .from('projects')
            .update({ links: updatedLinks })
            .eq('id', selectedProject.id);

        if (!error) {
            const updatedProject = { ...selectedProject, links: updatedLinks };
            setSelectedProject(updatedProject);
            setLinks(updatedLinks);
            setProjects(projects.map(p => p.id === selectedProject.id ? updatedProject : p));

            if (selectedClient && deletedLink) {
                await logActivity({
                    clientId: selectedClient.id,
                    projectId: selectedProject.id,
                    actionType: 'link_removed',
                    title: 'Link Removed',
                    description: `"${deletedLink.title}" link was removed from "${selectedProject.description}"`,
                    metadata: { link_title: deletedLink.title, link_url: deletedLink.url },
                });
            }
        }
    };

    // Fire a "Project Completed" activity when a feature change makes EVERY feature
    // of the project Completed (and it wasn't before). Skipped while a manual
    // override (On Hold / Cancelled) is in effect.
    const logProjectCompletedIfNeeded = async (
        project: ProjectWithStats | null,
        clientId: string | undefined,
        featuresBefore: { status?: string | null }[],
        featuresAfter: { status?: string | null }[]
    ) => {
        if (!project || !clientId || project.status_override) return;
        const wasComplete = deriveProjectStatus(featuresBefore) === 'Completed';
        const nowComplete = deriveProjectStatus(featuresAfter) === 'Completed';
        if (nowComplete && !wasComplete) {
            await logActivity({
                clientId,
                projectId: project.id,
                actionType: 'project_completed',
                title: 'Project Completed',
                description: `"${project.description}" was completed — all features are done`,
                metadata: { auto: true },
            });
        }
    };

    const handleSaveFeature = async () => {
        const isPaymentConfirmed = formData.payment_confirmed !== false;
        const amount = isPaymentConfirmed ? (Number(formData.amount) || 0) : 0;
        const paidAmount = isPaymentConfirmed ? (Number(formData.paid_amount) || 0) : 0;

        let paymentStatus = 'Pending';
        if (!isPaymentConfirmed) paymentStatus = 'Pending';
        else if (amount === 0) paymentStatus = 'Paid';
        else if (paidAmount >= amount) paymentStatus = 'Paid';
        else if (paidAmount > 0) paymentStatus = 'Partial';

        const payload = {
            description: formData.description,
            estimation: formData.estimation || '',
            amount: amount,
            paid_amount: paidAmount,
            status: formData.status || 'Requested',
            payment_status: paymentStatus,
            is_new_request: formData.is_new_request === 'true',
            payment_confirmed: isPaymentConfirmed
        };

        if (editingId) {
            // Capture old feature data BEFORE updating for comparison
            const oldFeature = features.find(f => f.id === editingId);
            const oldAmount = oldFeature ? Number(oldFeature.amount) || 0 : 0;
            const oldPaidAmount = oldFeature ? Number(oldFeature.paid_amount) || 0 : 0;
            const oldStatus = oldFeature?.status || '';

            // UPDATE
            const { error } = await supabaseAdmin.from('features').update(payload).eq('id', editingId);
            if (!error && selectedProject) {
                fetchFeatures(selectedProject.id);
                if (selectedClient) fetchProjects(selectedClient.id); // Refresh stats

                // Log activity with detailed change tracking
                if (selectedClient) {
                    const oldPaymentConfirmed = oldFeature?.payment_confirmed !== false;
                    const paymentConfirmedChanged = isPaymentConfirmed !== oldPaymentConfirmed;
                    const isCompleted = payload.status === 'Completed' && oldStatus !== 'Completed';
                    const amountChanged = amount !== oldAmount;
                    const paymentChanged = paidAmount !== oldPaidAmount;

                    // Build detailed change descriptions and structured diffs
                    const changes: string[] = [];
                    const structuredChanges: Record<string, { old: any; new: any }> = {};

                    if (paymentConfirmedChanged) {
                        changes.push(isPaymentConfirmed ? 'Rate confirmed' : 'Rate set to pending');
                        structuredChanges['Payment Status'] = { old: oldPaymentConfirmed ? 'Confirmed' : 'Pending', new: isPaymentConfirmed ? 'Confirmed' : 'Pending' };
                    }
                    if (isPaymentConfirmed && amountChanged) {
                        changes.push(`Amount: ₹${oldAmount.toLocaleString()} → ₹${amount.toLocaleString()}`);
                        structuredChanges['Total Amount'] = { old: `₹${oldAmount.toLocaleString()}`, new: `₹${amount.toLocaleString()}` };
                    }
                    if (isPaymentConfirmed && paymentChanged) {
                        changes.push(`Payment: ₹${oldPaidAmount.toLocaleString()} → ₹${paidAmount.toLocaleString()}`);
                        structuredChanges['Amount Paid'] = { old: `₹${oldPaidAmount.toLocaleString()}`, new: `₹${paidAmount.toLocaleString()}` };
                    }
                    if (payload.status !== oldStatus) {
                        if (!isCompleted) changes.push(`Status: ${oldStatus} → ${payload.status}`);
                        structuredChanges['Status'] = { old: oldStatus, new: payload.status };
                    }

                    let actionType: 'feature_completed' | 'payment_received' | 'feature_updated' | 'status_changed' | 'rate_confirmed' | 'rate_pending' = 'feature_updated';
                    let title = 'Feature Updated';
                    let desc = `"${payload.description}" in "${selectedProject.description}" was updated`;

                    // Priority: rate_confirmed > completed > payment > amount > general
                    if (paymentConfirmedChanged && isPaymentConfirmed) {
                        actionType = 'rate_confirmed';
                        title = amount > 0 ? `Rate Confirmed — ₹${amount.toLocaleString()}` : 'Rate Confirmed';
                        desc = `Rate for "${payload.description}" in "${selectedProject.description}" has been confirmed${amount > 0 ? ` at ₹${amount.toLocaleString()}` : ''}`;
                    } else if (paymentConfirmedChanged && !isPaymentConfirmed) {
                        actionType = 'rate_pending';
                        title = 'Rate Set to Pending';
                        desc = `Rate for "${payload.description}" in "${selectedProject.description}" is now pending confirmation`;
                    } else if (isCompleted) {
                        actionType = 'feature_completed';
                        title = 'Feature Completed';
                        desc = `"${payload.description}" in "${selectedProject.description}" was completed`;
                        if (isPaymentConfirmed && amount > 0) desc += ` (₹${amount.toLocaleString()})`;
                    } else if (isPaymentConfirmed && paymentChanged && paidAmount > oldPaidAmount) {
                        actionType = 'payment_received';
                        const paymentDiff = paidAmount - oldPaidAmount;
                        title = `Payment Received — ₹${paymentDiff.toLocaleString()}`;
                        desc = `₹${paymentDiff.toLocaleString()} received for "${payload.description}" (Total paid: ₹${paidAmount.toLocaleString()}/${amount.toLocaleString()})`;
                    } else if (isPaymentConfirmed && amountChanged) {
                        title = 'Amount Updated';
                        desc = `"${payload.description}" — ₹${oldAmount.toLocaleString()} → ₹${amount.toLocaleString()}`;
                    } else if (changes.length > 0) {
                        desc = `"${payload.description}" — ${changes.join(', ')}`;
                    }

                    await logActivity({
                        clientId: selectedClient.id,
                        projectId: selectedProject.id,
                        actionType,
                        title,
                        description: desc,
                        metadata: {
                            feature: payload.description,
                            amount: isPaymentConfirmed ? amount : null,
                            paidAmount: isPaymentConfirmed ? paidAmount : null,
                            changes: structuredChanges,
                        },
                    });

                    await logProjectCompletedIfNeeded(
                        selectedProject,
                        selectedClient.id,
                        features,
                        features.map(f => f.id === editingId ? { ...f, status: payload.status } : f)
                    );
                }
            } else {
                alert('Error: ' + error?.message);
            }
        } else {
            // CREATE
            const insertPayload = { ...payload, project_id: selectedProject?.id };
            const { data, error } = await supabaseAdmin.from('features').insert([insertPayload]).select();
            if (!error && data) {
                setFeatures([...features, data[0]]);
                if (selectedClient) {
                    fetchProjects(selectedClient.id);
                    // Log activity
                    const logTitle = isPaymentConfirmed && amount > 0
                        ? `New Feature Added — ₹${amount.toLocaleString()}`
                        : isPaymentConfirmed
                            ? 'New Feature Added'
                            : 'New Feature Added (Rate Pending)';
                    const logDesc = isPaymentConfirmed
                        ? `"${payload.description}" was added to "${selectedProject?.description}"${amount > 0 ? ` with cost ₹${amount.toLocaleString()}` : ''}`
                        : `"${payload.description}" was added to "${selectedProject?.description}" — rate is pending confirmation`;
                    await logActivity({
                        clientId: selectedClient.id,
                        projectId: selectedProject?.id || null,
                        actionType: 'feature_added',
                        title: logTitle,
                        description: logDesc,
                        metadata: { feature: payload.description, amount: isPaymentConfirmed ? amount : null, paidAmount: 0, status: payload.status, isNewRequest: payload.is_new_request, paymentConfirmed: isPaymentConfirmed },
                    });

                    await logProjectCompletedIfNeeded(
                        selectedProject,
                        selectedClient.id,
                        features,
                        [...features, { status: payload.status }]
                    );
                }
            } else {
                alert('Error: ' + error?.message);
            }
        }
        setShowModal(false);
        setFormData({});
        setEditingId(null);
    };

    const handleDelete = async (id: string, table: string) => {
        if (!confirm("Are you sure you want to delete this?")) return;

        // Get info before deleting for activity log
        let deletedItemDesc = '';
        if (table === 'features') {
            const feature = features.find(f => f.id === id);
            deletedItemDesc = feature?.description || 'Unknown feature';
        } else if (table === 'projects') {
            const project = projects.find(p => p.id === id);
            deletedItemDesc = project?.description || 'Unknown project';
        }

        await supabaseAdmin.from(table).delete().eq('id', id);

        if (table === 'clients') fetchClients();
        if (table === 'projects' && selectedClient) {
            fetchProjects(selectedClient.id);
            // Log activity
            await logActivity({
                clientId: selectedClient.id,
                projectId: id,
                actionType: 'project_updated',
                title: 'Project Removed',
                description: `"${deletedItemDesc}" was removed`,
                metadata: { deleted: true },
            });
        }
        if (table === 'features' && selectedProject) {
            fetchFeatures(selectedProject.id);
            // Also refresh project stats
            if (selectedClient) {
                fetchProjects(selectedClient.id);
                // Log activity
                await logActivity({
                    clientId: selectedClient.id,
                    projectId: selectedProject.id,
                    actionType: 'feature_deleted',
                    title: 'Feature Removed',
                    description: `"${deletedItemDesc}" was removed from "${selectedProject.description}"`,
                    metadata: { deleted: true },
                });

                await logProjectCompletedIfNeeded(
                    selectedProject,
                    selectedClient.id,
                    features,
                    features.filter(f => f.id !== id)
                );
            }
        }
    };

    // Check if payment status field should show
    const showPaymentStatus = ['Approved', 'Working', 'Updating', 'Completed'].includes(formData.status);

    // --- Activity Log Helpers ---
    const fetchActivityLogs = async (clientId: string) => {
        setLoadingLogs(true);
        const { data } = await supabaseAdmin
            .from('activity_logs')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false })
            .limit(50);
        if (data) setActivityLogs(data);
        setLoadingLogs(false);
    };

    const handleViewActivity = (client: Client) => {
        setSelectedClient(client);
        fetchActivityLogs(client.id);
        setView('activity');
        setSelectedLogIds(new Set());
    };

    const handleSendSingle = async (logId: string) => {
        if (!selectedClient?.email) {
            alert('This client has no email address. Edit the client to add one.');
            return;
        }
        setSendingIds(prev => new Set(prev).add(logId));
        const result = await sendNotification(logId, selectedClient.email, selectedClient.name);
        if (result.success) {
            // Refresh logs to get updated notified_at
            fetchActivityLogs(selectedClient.id);
        } else {
            alert(result.message);
        }
        setSendingIds(prev => { const n = new Set(prev); n.delete(logId); return n; });
    };

    const handleSendDigest = async () => {
        if (!selectedClient?.email) {
            alert('This client has no email address. Edit the client to add one.');
            return;
        }
        if (selectedLogIds.size === 0) {
            alert('Select at least one log to send as digest.');
            return;
        }
        setSendingDigest(true);
        const result = await sendDigestNotification(Array.from(selectedLogIds), selectedClient.email, selectedClient.name);
        if (result.success) {
            fetchActivityLogs(selectedClient.id);
            setSelectedLogIds(new Set());
        } else {
            alert(result.message);
        }
        setSendingDigest(false);
    };

    const handleToggleHideLog = async (logId: string, hide: boolean) => {
        const { error } = await supabaseAdmin
            .from('activity_logs')
            .update({ is_hidden: hide })
            .eq('id', logId);
        if (!error) {
            setActivityLogs(prev => prev.map(l => l.id === logId ? { ...l, is_hidden: hide } : l));
        } else {
            alert('Failed to update log: ' + error.message);
        }
    };

    const handleDeleteLog = async (logId: string) => {
        if (!confirm('Permanently delete this log entry? This cannot be undone.')) return;
        const { error } = await supabaseAdmin
            .from('activity_logs')
            .delete()
            .eq('id', logId);
        if (!error) {
            setActivityLogs(prev => prev.filter(l => l.id !== logId));
            setSelectedLogIds(prev => { const n = new Set(prev); n.delete(logId); return n; });
        } else {
            alert('Failed to delete log: ' + error.message);
        }
    };

    const toggleLogSelection = (logId: string) => {
        setSelectedLogIds(prev => {
            const n = new Set(prev);
            if (n.has(logId)) n.delete(logId); else n.add(logId);
            return n;
        });
    };

    const getActivityMeta = (actionType: string) => {
        switch (actionType) {
            case 'project_created': return { icon: <PackagePlus size={14} />, color: 'bg-blue-500', bgLight: 'bg-blue-50', textColor: 'text-blue-600', label: 'New Project' };
            case 'project_updated': return { icon: <RefreshCw size={14} />, color: 'bg-slate-500', bgLight: 'bg-slate-50', textColor: 'text-slate-600', label: 'Updated' };
            case 'project_completed': return { icon: <CheckCircle2 size={14} />, color: 'bg-emerald-500', bgLight: 'bg-emerald-50', textColor: 'text-emerald-600', label: 'Completed' };
            case 'feature_added': return { icon: <Zap size={14} />, color: 'bg-violet-500', bgLight: 'bg-violet-50', textColor: 'text-violet-600', label: 'Feature Added' };
            case 'feature_updated': return { icon: <FileText size={14} />, color: 'bg-sky-500', bgLight: 'bg-sky-50', textColor: 'text-sky-600', label: 'Updated' };
            case 'feature_completed': return { icon: <CheckCircle2 size={14} />, color: 'bg-emerald-500', bgLight: 'bg-emerald-50', textColor: 'text-emerald-600', label: 'Done' };
            case 'feature_deleted': return { icon: <Trash2 size={14} />, color: 'bg-red-500', bgLight: 'bg-red-50', textColor: 'text-red-600', label: 'Removed' };
            case 'payment_received': return { icon: <CreditCard size={14} />, color: 'bg-amber-500', bgLight: 'bg-amber-50', textColor: 'text-amber-600', label: 'Payment' };
            case 'rate_confirmed': return { icon: <CheckCircle2 size={14} />, color: 'bg-green-500', bgLight: 'bg-green-50', textColor: 'text-green-600', label: 'Rate Confirmed' };
            case 'rate_pending': return { icon: <Clock size={14} />, color: 'bg-orange-500', bgLight: 'bg-orange-50', textColor: 'text-orange-600', label: 'Rate Pending' };
            case 'link_added': return { icon: <Link2 size={14} />, color: 'bg-indigo-500', bgLight: 'bg-indigo-50', textColor: 'text-indigo-600', label: 'Link Added' };
            case 'link_updated': return { icon: <Pencil size={14} />, color: 'bg-indigo-500', bgLight: 'bg-indigo-50', textColor: 'text-indigo-600', label: 'Link Updated' };
            case 'link_removed': return { icon: <Trash2 size={14} />, color: 'bg-rose-500', bgLight: 'bg-rose-50', textColor: 'text-rose-600', label: 'Link Removed' };
            case 'status_changed': return { icon: <RefreshCw size={14} />, color: 'bg-teal-500', bgLight: 'bg-teal-50', textColor: 'text-teal-600', label: 'Status Changed' };
            case 'package_started': return { icon: <CreditCard size={14} />, color: 'bg-violet-500', bgLight: 'bg-violet-50', textColor: 'text-violet-600', label: 'Monthly Package' };
            case 'package_reverted': return { icon: <RefreshCw size={14} />, color: 'bg-slate-500', bgLight: 'bg-slate-50', textColor: 'text-slate-600', label: 'Package Ended' };
            default: return { icon: <Activity size={14} />, color: 'bg-slate-400', bgLight: 'bg-slate-50', textColor: 'text-slate-500', label: 'Activity' };
        }
    };

    const getRelativeTime = (dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    const signOut = async () => { await supabaseAdmin.auth.signOut(); router.push('/admin'); };

    return (
        <div className={`${hankenFont.variable} ${jbMonoFont.variable} warm-root font-hanken min-h-screen antialiased`} style={{ background: T.bg, color: T.ink }}>
            {/* Cool Slate canvas (reference palette) — Hanken Grotesk + JetBrains Mono */}
            <style>{`
                .font-hanken { font-family: var(--font-hanken), 'Hanken Grotesk', system-ui, sans-serif; }
                .font-jbmono { font-family: var(--font-jbmono), 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-feature-settings: "tnum"; }
                /* Override globals.css body bg so overscroll doesn't flash the portal's slate */
                html, body { background-color: #EEF1F5 !important; overscroll-behavior: none; }
                .warm-root ::selection { background: rgba(238,77,45,0.22); }
                .warm-root .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(28,33,40,0.16); }
                .warm-root .custom-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(28,33,40,0.16) transparent; }
                .warm-root input[type='checkbox'] { accent-color: #EE4D2D; }
                .warm-root input[type=number]::-webkit-outer-spin-button, .warm-root input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
            `}</style>

            {/* ===== ICON RAIL (desktop) ===== */}
            <aside
                className="hidden md:flex fixed left-0 top-0 bottom-0 w-[76px] flex-col items-center py-7 z-40"
                style={{ borderRight: `1px solid ${T.railBorder}`, background: T.bg }}
            >
                <button
                    onClick={goOverview}
                    title="Overview"
                    className="w-[38px] h-[38px] rounded-xl grid place-items-center text-white font-extrabold text-[18px] mb-9 transition-transform hover:scale-105"
                    style={{ background: T.accent }}
                >
                    R
                </button>
                <nav className="flex flex-col gap-2.5">
                    <RailBtn icon={Home} title="Overview" active={view === 'clients'} onClick={goOverview} />
                    <RailBtn icon={Folder} title="Projects" active={view === 'projects'} disabled={!selectedClient} onClick={() => selectedClient && handleClientSelect(selectedClient)} />
                    <RailBtn icon={Zap} title="Features" active={view === 'features'} disabled={!selectedProject} onClick={() => selectedProject && handleProjectSelect(selectedProject)} />
                    <RailBtn icon={Link2} title="Links" active={view === 'links'} disabled={!selectedProject} onClick={() => selectedProject && handleProjectLinksSelect(selectedProject)} />
                    <RailBtn icon={Activity} title="Activity log" active={view === 'activity'} disabled={!selectedClient} onClick={() => selectedClient && handleViewActivity(selectedClient)} />
                </nav>
                <div className="mt-auto flex flex-col items-center gap-3">
                    <RailBtn icon={LogOut} title="Sign out" onClick={signOut} />
                    <div className="w-10 h-10 rounded-full grid place-items-center text-white font-bold text-[15px] select-none" style={{ background: '#4A515E' }}>R</div>
                </div>
            </aside>

            <main className="md:pl-[76px]">
                <div className="max-w-[1240px] mx-auto px-4 sm:px-8 lg:px-12 py-6 md:py-8">
                    {/* Mobile top bar (rail is hidden) */}
                    <div className="md:hidden flex items-center gap-3 mb-6">
                        <button onClick={goOverview} title="Overview" className="w-9 h-9 rounded-xl grid place-items-center text-white font-extrabold text-[16px]" style={{ background: T.accent }}>R</button>
                        <span className="text-[11.5px] font-extrabold uppercase" style={{ letterSpacing: '0.14em', color: T.label }}>Admin</span>
                        <button
                            onClick={signOut}
                            aria-label="Sign out"
                            className="ml-auto w-9 h-9 rounded-full grid place-items-center transition-colors"
                            style={{ border: `1px solid ${T.hairline}`, color: '#6E7686' }}
                        >
                            <LogOut size={14} strokeWidth={2} />
                        </button>
                    </div>

                    {loading && (
                        <div className="flex flex-col items-center justify-center py-24">
                            <div className="flex items-center gap-2 mb-4">
                                <span className="w-2 h-2 rounded-full loader-dot" style={{ background: T.accent }}></span>
                                <span className="w-2 h-2 rounded-full loader-dot" style={{ background: T.dark }}></span>
                                <span className="w-2 h-2 rounded-full loader-dot" style={{ background: T.amber }}></span>
                            </div>
                            <p className="font-jbmono text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: T.label }}>Loading</p>
                        </div>
                    )}

                    {/* ========== CLIENTS OVERVIEW ========== */}
                    {view === 'clients' && !loading && (() => {
                        // Overall portfolio stats
                        const totalClients = clients.length;
                        const totalProjects = clients.reduce((a, c) => a + c.stats.projectCount, 0);
                        const shippedProjects = clients.reduce((a, c) => a + c.stats.completedProjects, 0);
                        const activeProjects = totalProjects - shippedProjects;
                        const totalValue = clients.reduce((a, c) => a + c.stats.totalValue, 0);
                        const totalPaid = clients.reduce((a, c) => a + c.stats.paidValue, 0);
                        const totalPending = Math.max(totalValue - totalPaid, 0);
                        const paidPct = totalValue > 0 ? Math.round((totalPaid / totalValue) * 100) : 0;

                        // Filter + sort
                        const q = clientSearch.trim().toLowerCase();
                        const filtered = (q
                            ? clients.filter(c =>
                                c.name.toLowerCase().includes(q) ||
                                (c.email || '').toLowerCase().includes(q) ||
                                c.access_key.toLowerCase().includes(q))
                            : [...clients]
                        ).sort((a, b) => {
                            if (clientSort === 'name') return a.name.localeCompare(b.name);
                            if (clientSort === 'projects') return b.stats.projectCount - a.stats.projectCount;
                            if (clientSort === 'value') return b.stats.totalValue - a.stats.totalValue;
                            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                        });

                        const sortLabels: Record<ClientSortField, string> = {
                            recent: 'Recently added',
                            name: 'Name (A–Z)',
                            projects: 'Most projects',
                            value: 'Highest value',
                        };
                        const fmtINR = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;
                        const formatK = (n: number) => n >= 100000 ? `₹${(n / 1000).toFixed(0)}k` : n >= 1000 ? `₹${(n / 1000).toFixed(1)}k` : `₹${n}`;

                        // Aggregate per-client stage from REAL project statuses
                        const clientStage = (c: ClientWithStats): { label: string; tone: PillTone } | null =>
                            c.stats.projectCount === 0 ? null
                                : c.stats.completedProjects === c.stats.projectCount ? { label: 'Complete', tone: PROJECT_STAGE['Completed'] }
                                    : c.stats.progress > 0 ? { label: 'In Progress', tone: PROJECT_STAGE['In Progress'] }
                                        : { label: 'Not Started', tone: PROJECT_STAGE['Not Started'] };

                        const debtors = clients.filter(c => c.stats.pendingValue > 0).sort((a, b) => b.stats.pendingValue - a.stats.pendingValue);

                        const searchPill = (
                            <div className="flex items-center gap-2.5 rounded-full h-11 px-4.5 min-w-0" style={{ border: `1px solid ${T.hairline}`, paddingLeft: 18, paddingRight: 14 }}>
                                <Search size={15} style={{ color: '#828A99' }} strokeWidth={2} />
                                <input
                                    type="text"
                                    name="client_search"
                                    autoComplete="off"
                                    spellCheck={false}
                                    data-form-type="other"
                                    placeholder="Search clients…"
                                    className="bg-transparent outline-none text-[13.5px] w-full min-w-0 placeholder:text-[#828A99]"
                                    style={{ color: T.ink }}
                                    value={clientSearch}
                                    onChange={(e) => setClientSearch(e.target.value)}
                                />
                                {clientSearch && (
                                    <button type="button" onClick={() => setClientSearch('')} aria-label="Clear search" className="shrink-0 grid place-items-center w-5 h-5 rounded-full transition-colors hover:bg-[rgba(26,29,37,0.08)]" style={{ color: '#828A99' }}>
                                        <X size={11} strokeWidth={2.5} />
                                    </button>
                                )}
                            </div>
                        );

                        return (
                            <div className="relative">
                                {/* ===== TOP BAR ===== */}
                                <header className="flex items-center gap-3">
                                    <div className="text-[11.5px] font-extrabold uppercase shrink-0" style={{ letterSpacing: '0.14em', color: T.label }}>
                                        Admin — Overview
                                    </div>
                                    <div className="ml-auto flex items-center gap-3 min-w-0">
                                        <div className="hidden sm:block w-[240px]">{searchPill}</div>
                                        <button
                                            onClick={() => { setFormData({}); setEditingId(null); setEditingLinkIndex(null); setShowModal(true); }}
                                            className="rounded-full h-11 px-5 text-[14px] font-bold text-white flex items-center gap-2 whitespace-nowrap transition-opacity hover:opacity-90 shrink-0"
                                            style={{ background: T.dark }}
                                        >
                                            <Plus size={15} strokeWidth={2.5} /> New client
                                        </button>
                                    </div>
                                </header>

                                {/* ===== EDITORIAL HERO ===== */}
                                <div className="flex flex-wrap items-end gap-x-10 gap-y-8 mt-10 mb-9">
                                    {totalClients === 0 ? (
                                        <h1 className="font-extrabold" style={{ fontSize: 'clamp(40px, 5.2vw, 74px)', letterSpacing: '-0.045em', lineHeight: 0.98, margin: 0 }}>
                                            Empty<br /><span style={{ color: '#AAB1BE' }}>portfolio.</span>
                                        </h1>
                                    ) : (
                                        <h1 className="font-extrabold tabular-nums" style={{ fontSize: 'clamp(40px, 5.2vw, 74px)', letterSpacing: '-0.045em', lineHeight: 0.98, margin: 0 }}>
                                            {fmtINR(totalValue)}<br />
                                            <span style={{ color: '#AAB1BE' }}>in contracted work.</span>
                                        </h1>
                                    )}
                                    {totalClients > 0 && (
                                    <div className="ml-auto flex flex-wrap gap-7 lg:gap-9 pb-2">
                                        {[
                                            { v: totalClients, l: 'Clients' },
                                            { v: totalProjects, l: 'Projects' },
                                            { v: activeProjects, l: 'Active' },
                                            { v: shippedProjects, l: 'Shipped' },
                                        ].map((s, i) => (
                                            <div key={i} style={{ borderLeft: `1px solid ${T.hairline}`, paddingLeft: 18 }}>
                                                <div className="font-extrabold tabular-nums" style={{ fontSize: 34, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.v}</div>
                                                <div className="text-[11.5px] font-extrabold uppercase mt-1.5" style={{ letterSpacing: '0.14em', color: T.label }}>{s.l}</div>
                                            </div>
                                        ))}
                                    </div>
                                    )}
                                </div>

                                {/* ===== DARK PIPELINE CARD ===== */}
                                {totalValue > 0 && (
                                    <DarkPanel
                                        heading="Pipeline — Collections"
                                        pct={paidPct}
                                        collected={totalPaid}
                                        outstanding={totalPending}
                                    />
                                )}

                                {/* Mobile search */}
                                <div className="sm:hidden mt-8">{searchPill}</div>

                                {/* ===== DIRECTORY + RECENT ===== */}
                                <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-x-14 gap-y-12 mt-10 items-start">
                                    {/* Directory — hairline editorial, no card chrome */}
                                    <section className="min-w-0">
                                        <SectionHead
                                            title="All clients"
                                            meta={`${filtered.length} of ${clients.length}`}
                                            right={
                                                <div className="relative" data-menu-root>
                                                    <button
                                                        onClick={() => setSortOpen(o => !o)}
                                                        aria-expanded={sortOpen}
                                                        aria-haspopup="listbox"
                                                        className="flex items-center gap-2 text-[13px] font-bold transition-colors hover:text-[#1C2128]"
                                                        style={{ color: '#6E7686' }}
                                                    >
                                                        {sortLabels[clientSort]}
                                                        <ChevronDown size={14} strokeWidth={2.2} className={`transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
                                                    </button>
                                                    {sortOpen && (
                                                        <motion.div
                                                            initial={{ opacity: 0, y: -4 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            className="absolute right-0 top-full mt-2 w-52 rounded-xl z-50 overflow-hidden p-1.5 bg-white"
                                                            style={{ boxShadow: `0 0 0 1px ${T.border}, 0 16px 40px -8px rgba(26,29,37,0.25)` }}
                                                        >
                                                            {(['recent', 'name', 'projects', 'value'] as ClientSortField[]).map(key => (
                                                                <button
                                                                    key={key}
                                                                    onClick={() => { setClientSort(key); setSortOpen(false); }}
                                                                    className="w-full flex items-center justify-between text-left px-3 py-2 text-[13px] rounded-lg transition-colors"
                                                                    style={clientSort === key ? { background: '#F1F3F7', color: T.ink, fontWeight: 700 } : { color: '#4A515E' }}
                                                                    onMouseEnter={e => { if (clientSort !== key) e.currentTarget.style.background = '#F1F3F7'; }}
                                                                    onMouseLeave={e => { if (clientSort !== key) e.currentTarget.style.background = 'transparent'; }}
                                                                >
                                                                    {sortLabels[key]}
                                                                    {clientSort === key && <Check size={13} style={{ color: T.accent }} strokeWidth={2.5} />}
                                                                </button>
                                                            ))}
                                                        </motion.div>
                                                    )}
                                                </div>
                                            }
                                        />

                                        {filtered.length === 0 ? (
                                            <EmptyBlock
                                                icon={clients.length === 0 ? <UserPlus size={18} strokeWidth={2} /> : <Search size={18} strokeWidth={2} />}
                                                title={clients.length === 0 ? 'No clients yet' : 'No matches'}
                                                sub={clients.length === 0 ? 'Click "New client" to onboard your first client.' : `Nothing matches "${clientSearch}".`}
                                            />
                                        ) : filtered.map((client, idx) => {
                                            const isCopied = copiedKey === client.access_key;
                                            const paidPctClient = client.stats.totalValue > 0 ? Math.round((client.stats.paidValue / client.stats.totalValue) * 100) : 0;
                                            const stage = clientStage(client);
                                            const isPkg = client.billing_mode === 'package';
                                            return (
                                                <motion.div
                                                    key={client.id}
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    transition={{ delay: Math.min(idx * 0.03, 0.3), duration: 0.2 }}
                                                    className="py-[18px]"
                                                    style={{ borderBottom: `1px solid ${T.hairline}` }}
                                                >
                                                    <div className="grid grid-cols-[1fr_auto] lg:grid-cols-[2.1fr_1.2fr_0.7fr_1.6fr_44px] gap-x-4 gap-y-3 items-center">
                                                        {/* Profile */}
                                                        <div className="flex items-center gap-3.5 min-w-0">
                                                            <WarmAvatar name={client.name} size={44} />
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <h3 className="font-bold truncate" style={{ fontSize: 15.5, color: T.ink }}>{client.name}</h3>
                                                                    {isPkg && (
                                                                        <span className="shrink-0 font-extrabold uppercase rounded-full" style={{ fontSize: 10, letterSpacing: '0.06em', color: T.accent, border: `1px solid ${T.accent}`, padding: '1px 8px' }} title="Monthly package client">
                                                                            Package
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-[12.5px] truncate mt-0.5" style={{ color: '#828A99' }}>
                                                                    {client.email || <span style={{ color: T.accent }}>No email on file</span>}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Kebab — mobile position (top right) */}
                                                        <div className="lg:hidden relative justify-self-end" data-menu-root>
                                                            <button
                                                                onClick={(e) => {
                                                                    if (openMenuId === client.id) { setOpenMenuId(null); return; }
                                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                                    setMenuFlipUp(window.innerHeight - rect.bottom < 236);
                                                                    setOpenMenuId(client.id);
                                                                }}
                                                                aria-label="Open actions menu"
                                                                aria-expanded={openMenuId === client.id}
                                                                aria-haspopup="menu"
                                                                className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]"
                                                                style={{ color: '#6E7686' }}
                                                            >
                                                                <MoreHorizontal size={16} />
                                                            </button>
                                                        </div>

                                                        {/* Access key */}
                                                        <div className="min-w-0 col-span-2 lg:col-span-1">
                                                            <button
                                                                onClick={() => copyAccessKey(client.access_key)}
                                                                className="inline-flex items-center gap-2 rounded-[9px] px-2.5 h-8 max-w-full transition-colors hover:bg-white"
                                                                style={{ border: `1px solid ${T.border}`, background: '#F1F3F7' }}
                                                                title={isCopied ? 'Copied' : 'Click to copy'}
                                                            >
                                                                <span className="font-jbmono text-[12px] truncate" style={{ color: '#5E6675' }}>{client.access_key}</span>
                                                                {isCopied
                                                                    ? <Check size={13} className="shrink-0" style={{ color: T.green }} strokeWidth={2.5} />
                                                                    : <Copy size={13} className="shrink-0" style={{ color: T.faint }} strokeWidth={1.8} />}
                                                            </button>
                                                        </div>

                                                        {/* Projects */}
                                                        <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 700 }}>
                                                            {client.stats.projectCount > 0 ? (
                                                                <>
                                                                    <span className="lg:hidden text-[11px] font-extrabold uppercase mr-2" style={{ letterSpacing: '0.1em', color: T.label }}>Projects</span>
                                                                    {client.stats.completedProjects}<span style={{ color: '#AAB1BE', fontWeight: 600 }}>/{client.stats.projectCount}</span>
                                                                </>
                                                            ) : (
                                                                <span style={{ color: '#AAB1BE' }}>—</span>
                                                            )}
                                                        </div>

                                                        {/* Contract + stage */}
                                                        <div className="flex items-center gap-4 lg:justify-self-end">
                                                            <div className="lg:text-right">
                                                                {isPkg ? (
                                                                    <>
                                                                        <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 700 }}>{fmtINR(Number(client.package_fee) || 0)}<span style={{ color: '#828A99', fontWeight: 600 }}>/mo</span></div>
                                                                        <div className="text-[11.5px] font-semibold" style={{ color: '#828A99' }}>retainer</div>
                                                                    </>
                                                                ) : client.stats.totalValue > 0 ? (
                                                                    <>
                                                                        <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 700 }}>{formatK(client.stats.totalValue)}</div>
                                                                        <div className="text-[11.5px] font-semibold tabular-nums" style={{ color: paidPctClient === 100 ? T.green : '#828A99' }}>{paidPctClient}% paid</div>
                                                                    </>
                                                                ) : (
                                                                    <div style={{ color: '#AAB1BE', fontWeight: 600, fontSize: 14 }}>—</div>
                                                                )}
                                                            </div>
                                                            {stage && <StagePill label={stage.label} tone={stage.tone} />}
                                                        </div>

                                                        {/* Kebab — desktop */}
                                                        <div className="hidden lg:block relative justify-self-end" data-menu-root>
                                                            <button
                                                                onClick={(e) => {
                                                                    if (openMenuId === client.id) { setOpenMenuId(null); return; }
                                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                                    setMenuFlipUp(window.innerHeight - rect.bottom < 236);
                                                                    setOpenMenuId(client.id);
                                                                }}
                                                                aria-label="Open actions menu"
                                                                aria-expanded={openMenuId === client.id}
                                                                aria-haspopup="menu"
                                                                className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]"
                                                                style={{ color: '#6E7686' }}
                                                            >
                                                                <MoreHorizontal size={16} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Shared actions menu (anchored to whichever kebab opened it) */}
                                                    {openMenuId === client.id && (
                                                        <div className="relative" data-menu-root>
                                                            <motion.div
                                                                role="menu"
                                                                initial={{ opacity: 0, y: menuFlipUp ? 4 : -4 }}
                                                                animate={{ opacity: 1, y: 0 }}
                                                                className={`absolute right-0 w-56 rounded-xl z-50 overflow-hidden p-1.5 bg-white ${menuFlipUp ? 'bottom-[64px]' : 'top-1'}`}
                                                                style={{ boxShadow: `0 0 0 1px ${T.border}, 0 16px 40px -8px rgba(26,29,37,0.25)` }}
                                                            >
                                                                {[
                                                                    { icon: <FolderPlus size={14} />, label: 'Projects', fn: () => handleClientSelect(client) },
                                                                    { icon: <Activity size={14} />, label: 'Activity log', fn: () => handleViewActivity(client) },
                                                                    ...(client.billing_mode !== 'package'
                                                                        ? [{ icon: <PackagePlus size={14} />, label: 'Convert to package', fn: () => openPackageModal(client) }]
                                                                        : [
                                                                            { icon: <CreditCard size={14} />, label: 'Manage package', fn: () => openManagePackage(client) },
                                                                            { icon: <RefreshCw size={14} />, label: 'Undo package', fn: () => handleUndoPackage(client) },
                                                                        ]),
                                                                ].map((item, i) => (
                                                                    <button
                                                                        key={i}
                                                                        role="menuitem"
                                                                        onClick={() => { setOpenMenuId(null); item.fn(); }}
                                                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-semibold rounded-lg transition-colors text-left"
                                                                        style={{ color: '#4A515E' }}
                                                                        onMouseEnter={e => { e.currentTarget.style.background = '#F1F3F7'; e.currentTarget.style.color = T.ink; }}
                                                                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#4A515E'; }}
                                                                    >
                                                                        {item.icon}{item.label}
                                                                    </button>
                                                                ))}
                                                                <div className="h-px my-1.5 mx-2" style={{ background: T.borderSoft }} />
                                                                <button
                                                                    role="menuitem"
                                                                    onClick={() => { setOpenMenuId(null); handleEditClient(client); }}
                                                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-semibold rounded-lg transition-colors text-left"
                                                                    style={{ color: '#4A515E' }}
                                                                    onMouseEnter={e => { e.currentTarget.style.background = '#F1F3F7'; e.currentTarget.style.color = T.ink; }}
                                                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#4A515E'; }}
                                                                >
                                                                    <Pencil size={14} />Edit
                                                                </button>
                                                                <button
                                                                    role="menuitem"
                                                                    onClick={() => { setOpenMenuId(null); handleDelete(client.id, 'clients'); }}
                                                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-semibold rounded-lg transition-colors text-left"
                                                                    style={{ color: '#B3331D' }}
                                                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(179,51,29,0.08)'; }}
                                                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                                                                >
                                                                    <Trash2 size={14} />Delete
                                                                </button>
                                                            </motion.div>
                                                        </div>
                                                    )}
                                                </motion.div>
                                            );
                                        })}
                                    </section>

                                    {/* Recent — latest activity across all clients */}
                                    <section className="min-w-0">
                                        <SectionHead title="Recent" />
                                        {recentLogs.length === 0 ? (
                                            <p className="text-[13px] py-6" style={{ color: T.muted }}>No activity yet — changes will appear here.</p>
                                        ) : recentLogs.map((log) => {
                                            const cl = clients.find(c => c.id === log.client_id);
                                            const amount = Number(log.metadata?.amount) || 0;
                                            const isMoneyIn = log.action_type === 'payment_received' || log.action_type === 'rate_confirmed';
                                            return (
                                                <button
                                                    key={log.id}
                                                    onClick={() => cl && handleViewActivity(cl)}
                                                    className="w-full flex items-center gap-3 py-4 text-left transition-colors hover:bg-[rgba(26,29,37,0.025)]"
                                                    style={{ borderBottom: `1px solid ${T.hairline}` }}
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <div className="font-bold truncate" style={{ fontSize: 14 }}>{log.title}</div>
                                                        <div className="text-[12.5px] mt-0.5 truncate" style={{ color: '#828A99' }}>
                                                            {cl?.name || 'Unknown client'} · {getRelativeTime(log.created_at)}
                                                        </div>
                                                    </div>
                                                    {amount > 0 && (
                                                        <div className="text-right shrink-0">
                                                            <div className="font-bold tabular-nums" style={{ fontSize: 13.5 }}>₹{amount.toLocaleString('en-IN')}</div>
                                                            <div className="text-[10.5px] font-extrabold uppercase mt-0.5" style={{ letterSpacing: '0.05em', color: isMoneyIn ? T.green : '#6E7686' }}>
                                                                {isMoneyIn ? 'Paid' : getActivityMeta(log.action_type).label}
                                                            </div>
                                                        </div>
                                                    )}
                                                </button>
                                            );
                                        })}

                                        {/* Outstanding note card */}
                                        {debtors.length > 0 && (
                                            <div className="mt-6 rounded-[18px] px-5 py-[18px]" style={{ background: '#E5E9F1' }}>
                                                <div className="font-bold" style={{ fontSize: 13.5 }}>
                                                    {debtors.length} {debtors.length === 1 ? 'client has' : 'clients have'} dues
                                                </div>
                                                <div className="text-[12.5px] mt-1 leading-[1.5]" style={{ color: '#6E7686' }}>
                                                    ₹{debtors.reduce((a, c) => a + c.stats.pendingValue, 0).toLocaleString('en-IN')} awaiting collection from {debtors.slice(0, 2).map(c => c.name.split(' ')[0]).join(' & ')}{debtors.length > 2 ? ` +${debtors.length - 2} more` : ''}.
                                                </div>
                                            </div>
                                        )}
                                    </section>
                                </div>
                            </div>
                        );
                    })()}

                    {/* ========== PROJECTS VIEW ========== */}
                    {view === 'projects' && !loading && (() => {
                        const projectsCount = projects.length;
                        const completedCount = projects.filter(p => p.displayStatus === 'Completed').length;
                        const activeCount = projectsCount - completedCount;
                        const totalValue = projects.reduce((a, p) => a + (p.stats?.total ?? 0), 0);
                        const totalPaid = projects.reduce((a, p) => a + (p.stats?.paid ?? 0), 0);
                        const totalPending = Math.max(totalValue - totalPaid, 0);
                        const paidPct = totalValue > 0 ? Math.round((totalPaid / totalValue) * 100) : 0;
                        const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString('en-IN')}`;
                        const isPkgClient = selectedClient?.billing_mode === 'package';

                        return (
                            <div>
                                {/* ===== TOP BAR ===== */}
                                <header className="flex items-center gap-3">
                                    <button onClick={handleBack} aria-label="Back to clients" className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)] shrink-0" style={{ border: `1px solid ${T.hairline}`, color: '#6E7686' }}>
                                        <ArrowLeft size={15} strokeWidth={2} />
                                    </button>
                                    <div className="text-[11.5px] font-extrabold uppercase truncate" style={{ letterSpacing: '0.14em', color: T.label }}>
                                        Admin — <span style={{ color: T.ink }}>{selectedClient?.name || '—'}</span>
                                    </div>
                                    <div className="ml-auto shrink-0">
                                        <button
                                            onClick={() => { setFormData({}); setEditingId(null); setEditingLinkIndex(null); setShowModal(true); }}
                                            className="rounded-full h-11 px-5 text-[14px] font-bold text-white flex items-center gap-2 whitespace-nowrap transition-opacity hover:opacity-90"
                                            style={{ background: T.dark }}
                                        >
                                            <Plus size={15} strokeWidth={2.5} /> New project
                                        </button>
                                    </div>
                                </header>

                                {/* ===== EDITORIAL HERO ===== */}
                                <div className="mt-10 mb-9 max-w-3xl">
                                    <h1 className="font-extrabold break-words" style={{ fontSize: 'clamp(34px, 4.4vw, 56px)', letterSpacing: '-0.04em', lineHeight: 1.0, margin: 0 }}>
                                        {selectedClient?.name || 'Client'}.<br />
                                        <span style={{ color: '#AAB1BE' }}>
                                            {projectsCount === 0 ? 'No projects yet.' : `${projectsCount} ${projectsCount === 1 ? 'project' : 'projects'}.`}
                                        </span>
                                    </h1>
                                    <p className="text-[15.5px] mt-5 leading-[1.55] max-w-xl" style={{ color: T.muted }}>
                                        {projectsCount === 0
                                            ? 'Create the first project for this client to begin tracking features and collections.'
                                            : isPkgClient
                                                ? <>On a monthly retainer of <span className="font-bold tabular-nums" style={{ color: T.ink }}>{fmtINR(Number(selectedClient?.package_fee) || 0)}</span> — {activeCount} active · {completedCount} shipped.</>
                                                : totalValue > 0
                                                    ? <>Tracking <span className="font-bold tabular-nums" style={{ color: T.ink }}>{fmtINR(totalValue)}</span> in contracted work{paidPct === 100 ? '. Fully collected.' : paidPct === 0 ? '. Awaiting first collection.' : <>. <span className="font-bold tabular-nums" style={{ color: T.ink }}>{paidPct}%</span> collected.</>}</>
                                                    : <>{activeCount} active · {completedCount} shipped. No financials recorded yet.</>}
                                    </p>
                                </div>

                                {/* ===== DARK PIPELINE (client-scoped) ===== */}
                                {totalValue > 0 && (
                                    <div className="mb-10">
                                        <DarkPanel heading={`Pipeline — ${selectedClient?.name || 'Client'}`} pct={paidPct} collected={totalPaid} outstanding={totalPending} />
                                    </div>
                                )}

                                {/* ===== PROJECT LIST ===== */}
                                <section>
                                    <SectionHead title="All projects" meta={projectsCount > 0 ? `${completedCount} shipped of ${projectsCount}` : undefined} />
                                    {projectsCount === 0 ? (
                                        <EmptyBlock icon={<PackagePlus size={18} strokeWidth={2} />} title="No projects yet" sub={'Click "New project" to create the first deliverable for this client.'} />
                                    ) : projects.map((project, idx) => {
                                        const ds = project.displayStatus;
                                        const tone = PROJECT_STAGE[ds] || PROJECT_STAGE['Not Started'];
                                        const progress = project.stats?.progress ?? 0;
                                        const total = project.stats?.total ?? 0;
                                        const paid = project.stats?.paid ?? 0;
                                        const pending = project.stats?.pending ?? Math.max(total - paid, 0);
                                        const projPaidPct = total > 0 ? Math.round((paid / total) * 100) : 0;
                                        return (
                                            <motion.article
                                                key={project.id}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ delay: Math.min(idx * 0.04, 0.3), duration: 0.25 }}
                                                className="grid grid-cols-1 lg:grid-cols-[44px_minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_auto] gap-x-5 gap-y-4 lg:items-center py-6"
                                                style={{ borderBottom: `1px solid ${T.hairline}` }}
                                            >
                                                {/* Index */}
                                                <div className="hidden lg:block font-jbmono text-[12.5px]" style={{ color: '#6E7686' }}>
                                                    {String(idx + 1).padStart(2, '0')}
                                                </div>

                                                {/* Title + meta */}
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-3 flex-wrap">
                                                        <h3 className="font-bold" style={{ fontSize: 17, letterSpacing: '-0.01em' }}>{project.description}</h3>
                                                        <StagePill label={ds} tone={tone} size="sm" />
                                                    </div>
                                                    <div className="text-[11.5px] font-extrabold uppercase mt-1.5" style={{ letterSpacing: '0.1em', color: T.label }}>
                                                        {project.category} <span style={{ color: '#BFC5D0' }}>·</span> {new Date(project.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                    </div>
                                                </div>

                                                {/* Progress */}
                                                <div className="min-w-0 max-w-[260px]">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: T.borderSoft }}>
                                                            <motion.div
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${progress}%` }}
                                                                transition={{ duration: 0.7, ease: 'easeOut', delay: 0.1 + Math.min(idx * 0.04, 0.3) }}
                                                                className="h-full rounded-full"
                                                                style={{ background: progress === 100 ? T.green : T.dark }}
                                                            />
                                                        </div>
                                                        <span className="text-[12.5px] font-semibold tabular-nums shrink-0" style={{ color: T.muted }}>{progress}%</span>
                                                    </div>
                                                    <div className="text-[11.5px] font-semibold mt-1.5 tabular-nums" style={{ color: '#828A99' }}>
                                                        {project.stats?.completedFeatures ?? 0}/{project.stats?.totalFeatures ?? 0} features done
                                                    </div>
                                                </div>

                                                {/* Money */}
                                                <div className="lg:text-right">
                                                    {total > 0 ? (
                                                        <>
                                                            <div className="font-bold tabular-nums" style={{ fontSize: 15 }}>{fmtINR(total)}</div>
                                                            <div className="text-[11.5px] font-semibold tabular-nums mt-0.5" style={{ color: pending > 0 ? T.accent : T.green }}>
                                                                {pending > 0 ? `${fmtINR(pending)} due` : `${projPaidPct}% paid`}
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div style={{ color: '#AAB1BE', fontWeight: 600, fontSize: 14 }}>{isPkgClient ? 'covered' : '—'}</div>
                                                    )}
                                                </div>

                                                {/* Actions */}
                                                <div className="flex items-center gap-1.5 lg:justify-end flex-wrap">
                                                    <button
                                                        onClick={() => handleProjectLinksSelect(project)}
                                                        className="rounded-full h-9 px-4 text-[12.5px] font-bold flex items-center gap-1.5 transition-colors hover:bg-[rgba(26,29,37,0.06)]"
                                                        style={{ border: `1px solid ${T.hairline}`, color: '#4A515E' }}
                                                    >
                                                        <Link2 size={13} strokeWidth={2} /> Links
                                                    </button>
                                                    <button
                                                        onClick={() => handleProjectSelect(project)}
                                                        className="rounded-full h-9 px-4 text-[12.5px] font-bold text-white flex items-center gap-1.5 whitespace-nowrap transition-opacity hover:opacity-90"
                                                        style={{ background: T.dark }}
                                                    >
                                                        Features <ArrowRight size={13} strokeWidth={2.5} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleEditProject(project)}
                                                        aria-label="Edit project"
                                                        className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]"
                                                        style={{ color: '#6E7686' }}
                                                    >
                                                        <Pencil size={14} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(project.id, 'projects')}
                                                        aria-label="Delete project"
                                                        className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(179,51,29,0.08)]"
                                                        style={{ color: '#6E7686' }}
                                                        onMouseEnter={e => { e.currentTarget.style.color = '#B3331D'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.color = '#6E7686'; }}
                                                    >
                                                        <Trash2 size={14} strokeWidth={2} />
                                                    </button>
                                                </div>
                                            </motion.article>
                                        );
                                    })}
                                </section>
                            </div>
                        );
                    })()}

                    {/* ========== LINKS VIEW ========== */}
                    {view === 'links' && !loading && (
                        <div>
                            {/* ===== TOP BAR ===== */}
                            <header className="flex items-center gap-3">
                                <button onClick={handleBack} aria-label="Back to projects" className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)] shrink-0" style={{ border: `1px solid ${T.hairline}`, color: '#6E7686' }}>
                                    <ArrowLeft size={15} strokeWidth={2} />
                                </button>
                                <div className="text-[11.5px] font-extrabold uppercase truncate" style={{ letterSpacing: '0.14em', color: T.label }}>
                                    {selectedClient?.name || 'Admin'} — <span style={{ color: T.ink }}>Links</span>
                                </div>
                                <div className="ml-auto shrink-0">
                                    <button
                                        onClick={() => { setFormData({}); setEditingId(null); setEditingLinkIndex(null); setShowModal(true); }}
                                        className="rounded-full h-11 px-5 text-[14px] font-bold text-white flex items-center gap-2 whitespace-nowrap transition-opacity hover:opacity-90"
                                        style={{ background: T.dark }}
                                    >
                                        <Plus size={15} strokeWidth={2.5} /> New link
                                    </button>
                                </div>
                            </header>

                            {/* ===== EDITORIAL HERO ===== */}
                            <div className="mt-10 mb-9 max-w-3xl">
                                <h1 className="font-extrabold break-words" style={{ fontSize: 'clamp(32px, 4vw, 52px)', letterSpacing: '-0.04em', lineHeight: 1.02, margin: 0 }}>
                                    {selectedProject?.description || 'Project'}.<br />
                                    <span style={{ color: '#AAB1BE' }}>{links.length} {links.length === 1 ? 'link' : 'links'}.</span>
                                </h1>
                                <p className="text-[15.5px] mt-5 leading-[1.55] max-w-xl" style={{ color: T.muted }}>
                                    {links.length === 0
                                        ? 'Pin design files, deployments, repos, or any reference URL the client should see.'
                                        : 'Resources visible to the client on their portal.'}
                                </p>
                            </div>

                            {/* ===== LINK LIST ===== */}
                            <section>
                                <SectionHead title="All links" meta={links.length > 0 ? `${links.length} total` : undefined} />
                                {links.length === 0 ? (
                                    <EmptyBlock icon={<Link2 size={18} strokeWidth={2} />} title="No links yet" sub={'Click "New link" to attach a URL to this project.'} />
                                ) : links.map((link, index) => (
                                    <motion.div
                                        key={index}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: Math.min(index * 0.04, 0.3), duration: 0.25 }}
                                        className="flex items-center gap-4 py-[18px]"
                                        style={{ borderBottom: `1px solid ${T.hairline}` }}
                                    >
                                        <div className="shrink-0 w-10 h-10 rounded-xl grid place-items-center" style={{ background: '#EAEDF2', color: '#5E6675' }}>
                                            <Link2 size={15} strokeWidth={2} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <h4 className="font-bold truncate" style={{ fontSize: 15 }}>{link.title}</h4>
                                            <a
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-jbmono text-[12px] truncate block mt-0.5 transition-colors"
                                                style={{ color: '#6E7686' }}
                                                onMouseEnter={e => { e.currentTarget.style.color = T.accent; }}
                                                onMouseLeave={e => { e.currentTarget.style.color = '#6E7686'; }}
                                            >
                                                {link.url}
                                            </a>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <a
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                aria-label="Open link"
                                                className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]"
                                                style={{ color: '#6E7686' }}
                                            >
                                                <ArrowUpRight size={14} strokeWidth={2} />
                                            </a>
                                            <button
                                                onClick={() => { setEditingLinkIndex(index); setFormData({ link_title: link.title, link_url: link.url }); setShowModal(true); }}
                                                aria-label="Edit link"
                                                className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]"
                                                style={{ color: '#6E7686' }}
                                            >
                                                <Pencil size={14} strokeWidth={2} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteLink(index)}
                                                aria-label="Delete link"
                                                className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(179,51,29,0.08)]"
                                                style={{ color: '#6E7686' }}
                                                onMouseEnter={e => { e.currentTarget.style.color = '#B3331D'; }}
                                                onMouseLeave={e => { e.currentTarget.style.color = '#6E7686'; }}
                                            >
                                                <Trash2 size={14} strokeWidth={2} />
                                            </button>
                                        </div>
                                    </motion.div>
                                ))}
                            </section>
                        </div>
                    )}

                    {/* ========== FEATURES VIEW ========== */}
                    {view === 'features' && !loading && (() => {
                        const featuresCount = features.length;
                        const completedCount = features.filter(f => f.status === 'Completed').length;
                        const totalAmount = features.reduce((a, f) => a + (Number(f.amount) || 0), 0);
                        const paidAmount = features.reduce((a, f) => a + (Number(f.paid_amount) || 0), 0);
                        const pendingAmount = Math.max(totalAmount - paidAmount, 0);
                        const paidPct = totalAmount > 0 ? Math.round((paidAmount / totalAmount) * 100) : 0;
                        const ratePendingCount = features.filter(f => f.payment_confirmed === false).length;
                        const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString('en-IN')}`;

                        const sorted = [...features].sort((a, b) => {
                            let cmp = 0;
                            if (sortField === 'amount') cmp = (a.amount || 0) - (b.amount || 0);
                            else if (sortField === 'status') {
                                const order = ['Requested', 'Approved', 'Working', 'Updating', 'Completed'];
                                cmp = order.indexOf(a.status) - order.indexOf(b.status);
                            } else if (sortField === 'created_at') {
                                cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                            }
                            return sortOrder === 'asc' ? cmp : -cmp;
                        });

                        const payColor = (s: string) => s === 'Paid' ? T.green : s === 'Partial' ? T.amber : T.accent;

                        return (
                            <div>
                                {/* ===== TOP BAR ===== */}
                                <header className="flex items-center gap-3">
                                    <button onClick={handleBack} aria-label="Back to projects" className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)] shrink-0" style={{ border: `1px solid ${T.hairline}`, color: '#6E7686' }}>
                                        <ArrowLeft size={15} strokeWidth={2} />
                                    </button>
                                    <div className="text-[11.5px] font-extrabold uppercase truncate" style={{ letterSpacing: '0.14em', color: T.label }}>
                                        {selectedClient?.name || 'Admin'} — <span style={{ color: T.ink }}>Features</span>
                                    </div>
                                    <div className="ml-auto shrink-0">
                                        <button
                                            onClick={() => { setFormData({}); setEditingId(null); setEditingLinkIndex(null); setShowModal(true); }}
                                            className="rounded-full h-11 px-5 text-[14px] font-bold text-white flex items-center gap-2 whitespace-nowrap transition-opacity hover:opacity-90"
                                            style={{ background: T.dark }}
                                        >
                                            <Plus size={15} strokeWidth={2.5} /> New feature
                                        </button>
                                    </div>
                                </header>

                                {/* ===== EDITORIAL HERO + METRIC CLUSTER ===== */}
                                <div className="flex flex-wrap items-end gap-x-10 gap-y-8 mt-10 mb-9">
                                    <div className="max-w-xl">
                                        <h1 className="font-extrabold break-words" style={{ fontSize: 'clamp(32px, 4vw, 52px)', letterSpacing: '-0.04em', lineHeight: 1.02, margin: 0 }}>
                                            {selectedProject?.description || 'Project'}.<br />
                                            <span style={{ color: '#AAB1BE' }}>{featuresCount} {featuresCount === 1 ? 'feature' : 'features'}.</span>
                                        </h1>
                                        <p className="text-[15.5px] mt-5 leading-[1.55]" style={{ color: T.muted }}>
                                            {featuresCount === 0
                                                ? 'Add the first feature to break this project into deliverables.'
                                                : totalAmount > 0
                                                    ? <>Tracking <span className="font-bold tabular-nums" style={{ color: T.ink }}>{fmtINR(totalAmount)}</span> across this project — <span className="font-bold tabular-nums" style={{ color: T.ink }}>{paidPct}%</span> collected.</>
                                                    : <>{completedCount} shipped · {featuresCount - completedCount} in flight{ratePendingCount > 0 ? ` · rate pending on ${ratePendingCount}` : ''}.</>}
                                        </p>
                                    </div>
                                    {featuresCount > 0 && (
                                        <div className="ml-auto flex flex-wrap gap-7 lg:gap-9 pb-1">
                                            {[
                                                { v: String(featuresCount), l: 'Features', c: T.ink },
                                                { v: fmtINR(totalAmount), l: 'Total', c: T.ink },
                                                { v: fmtINR(paidAmount), l: 'Paid', c: T.green },
                                                { v: fmtINR(pendingAmount), l: 'Pending', c: pendingAmount > 0 ? T.accent : T.ink },
                                            ].map((s, i) => (
                                                <div key={i} style={{ borderLeft: `1px solid ${T.hairline}`, paddingLeft: 18 }}>
                                                    <div className="font-extrabold tabular-nums" style={{ fontSize: 26, letterSpacing: '-0.03em', lineHeight: 1, color: s.c }}>{s.v}</div>
                                                    <div className="text-[11.5px] font-extrabold uppercase mt-1.5" style={{ letterSpacing: '0.14em', color: T.label }}>{s.l}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* ===== FEATURE TABLE ===== */}
                                <section>
                                    <SectionHead
                                        title="All features"
                                        meta={featuresCount > 0 ? `${completedCount} shipped of ${featuresCount}` : undefined}
                                        right={featuresCount > 1 ? (
                                            <div className="flex items-center gap-1 rounded-full p-1" style={{ border: `1px solid ${T.hairline}` }}>
                                                {(['amount', 'status', 'created_at'] as SortField[]).map(field => (
                                                    <button
                                                        key={field}
                                                        onClick={() => {
                                                            if (sortField === field) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                            else { setSortField(field); setSortOrder('asc'); }
                                                        }}
                                                        className="rounded-full h-7 px-3 text-[11px] font-extrabold uppercase flex items-center gap-1 transition-colors"
                                                        style={sortField === field
                                                            ? { background: T.dark, color: '#fff', letterSpacing: '0.05em' }
                                                            : { color: '#6E7686', letterSpacing: '0.05em' }}
                                                    >
                                                        {field === 'created_at' ? 'Date' : field}
                                                        {sortField === field && (sortOrder === 'asc' ? <ArrowUp size={10} strokeWidth={2.5} /> : <ArrowDown size={10} strokeWidth={2.5} />)}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : undefined}
                                    />

                                    {featuresCount === 0 ? (
                                        <EmptyBlock icon={<Zap size={18} strokeWidth={2} />} title="No features yet" sub={'Click "New feature" to break this project into deliverables.'} />
                                    ) : (
                                        <>
                                            {/* Desktop — hairline table */}
                                            <div className="hidden lg:block">
                                                <div className="grid grid-cols-[minmax(0,2.6fr)_0.9fr_0.9fr_1.3fr_0.8fr_1.6fr_84px] gap-x-4 items-center pt-4 pb-2.5 text-[10.5px] font-extrabold uppercase" style={{ letterSpacing: '0.12em', color: T.label, borderBottom: `1px solid ${T.hairline}` }}>
                                                    <div>Description</div>
                                                    <div>Date</div>
                                                    <div>Estimate</div>
                                                    <div className="text-right">Amount</div>
                                                    <div>Type</div>
                                                    <div>Status</div>
                                                    <div className="text-right">Actions</div>
                                                </div>
                                                {sorted.map((feature, idx) => {
                                                    const tone = FEATURE_STAGE[feature.status] || FEATURE_STAGE.Requested;
                                                    const ratePending = feature.payment_confirmed === false;
                                                    return (
                                                        <motion.div
                                                            key={feature.id}
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            transition={{ delay: Math.min(idx * 0.025, 0.3), duration: 0.2 }}
                                                            className="grid grid-cols-[minmax(0,2.6fr)_0.9fr_0.9fr_1.3fr_0.8fr_1.6fr_84px] gap-x-4 items-center py-4 transition-colors hover:bg-[rgba(26,29,37,0.02)]"
                                                            style={{ borderBottom: `1px solid ${T.hairline}` }}
                                                        >
                                                            <div className="min-w-0">
                                                                <p className="font-semibold truncate" style={{ fontSize: 14.5 }}>{feature.description}</p>
                                                            </div>
                                                            <div className="font-jbmono text-[11.5px] tabular-nums" style={{ color: '#6E7686' }}>
                                                                {feature.created_at ? new Date(feature.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                                                            </div>
                                                            <div className="font-jbmono text-[11.5px] truncate" style={{ color: '#828A99' }}>
                                                                {feature.estimation || '—'}
                                                            </div>
                                                            <div className="text-right">
                                                                {ratePending ? (
                                                                    <span className="inline-flex items-center gap-1.5 rounded-full font-bold uppercase whitespace-nowrap" style={{ background: T.amberSoft, color: T.amber, padding: '3px 9px', fontSize: 10, letterSpacing: '0.05em' }}>
                                                                        <span className="w-[5px] h-[5px] rounded-full animate-pulse" style={{ background: T.amber }} />
                                                                        Rate pending
                                                                    </span>
                                                                ) : (
                                                                    <>
                                                                        <div className="font-bold tabular-nums" style={{ fontSize: 14.5 }}>{fmtINR(feature.amount || 0)}</div>
                                                                        {(feature.paid_amount || 0) > 0 && (feature.paid_amount || 0) < (feature.amount || 0) && (
                                                                            <div className="font-jbmono text-[10.5px] tabular-nums" style={{ color: '#828A99' }}>{fmtINR(feature.paid_amount || 0)} paid</div>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <span className="inline-flex rounded-full font-extrabold uppercase whitespace-nowrap" style={feature.is_new_request
                                                                    ? { background: T.accentSoft, color: T.accent, padding: '3px 9px', fontSize: 10, letterSpacing: '0.06em' }
                                                                    : { background: '#EAEDF2', color: '#5E6675', padding: '3px 9px', fontSize: 10, letterSpacing: '0.06em' }}>
                                                                    {feature.is_new_request ? 'Extra' : 'Core'}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <StagePill label={feature.status} tone={tone} size="sm" />
                                                                {!ratePending && (
                                                                    <span className="font-jbmono text-[10px] font-medium uppercase tabular-nums truncate" style={{ color: payColor(feature.payment_status) }}>
                                                                        {feature.payment_status}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center justify-end gap-1">
                                                                <button onClick={() => handleEditFeature(feature)} aria-label="Edit feature" className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]" style={{ color: '#6E7686' }}>
                                                                    <Pencil size={13} strokeWidth={2} />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDelete(feature.id, 'features')}
                                                                    aria-label="Delete feature"
                                                                    className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-[rgba(179,51,29,0.08)]"
                                                                    style={{ color: '#6E7686' }}
                                                                    onMouseEnter={e => { e.currentTarget.style.color = '#B3331D'; }}
                                                                    onMouseLeave={e => { e.currentTarget.style.color = '#6E7686'; }}
                                                                >
                                                                    <Trash2 size={13} strokeWidth={2} />
                                                                </button>
                                                            </div>
                                                        </motion.div>
                                                    );
                                                })}
                                            </div>

                                            {/* Mobile — white cards on beige */}
                                            <div className="lg:hidden space-y-3 pt-4">
                                                {sorted.map((feature, idx) => {
                                                    const tone = FEATURE_STAGE[feature.status] || FEATURE_STAGE.Requested;
                                                    const ratePending = feature.payment_confirmed === false;
                                                    return (
                                                        <motion.div
                                                            key={feature.id}
                                                            initial={{ opacity: 0, y: 4 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            transition={{ delay: Math.min(idx * 0.03, 0.3), duration: 0.2 }}
                                                            className="rounded-[18px] bg-white p-4"
                                                            style={{ boxShadow: `0 0 0 1px ${T.border}, 0 1px 2px rgba(28,33,40,0.04)` }}
                                                        >
                                                            <div className="flex items-start justify-between gap-3">
                                                                <h4 className="font-bold flex-1 leading-snug" style={{ fontSize: 15 }}>{feature.description}</h4>
                                                                <div className="flex items-center gap-1 shrink-0">
                                                                    <button onClick={() => handleEditFeature(feature)} aria-label="Edit" className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]" style={{ color: '#6E7686' }}>
                                                                        <Pencil size={13} strokeWidth={2} />
                                                                    </button>
                                                                    <button onClick={() => handleDelete(feature.id, 'features')} aria-label="Delete" className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-[rgba(179,51,29,0.08)]" style={{ color: '#B3331D' }}>
                                                                        <Trash2 size={13} strokeWidth={2} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-2 mt-3">
                                                                <StagePill label={feature.status} tone={tone} size="sm" />
                                                                <span className="inline-flex rounded-full font-extrabold uppercase" style={feature.is_new_request
                                                                    ? { background: T.accentSoft, color: T.accent, padding: '3px 9px', fontSize: 10, letterSpacing: '0.06em' }
                                                                    : { background: '#EAEDF2', color: '#5E6675', padding: '3px 9px', fontSize: 10, letterSpacing: '0.06em' }}>
                                                                    {feature.is_new_request ? 'Extra' : 'Core'}
                                                                </span>
                                                                {feature.estimation && (
                                                                    <span className="font-jbmono text-[10.5px] uppercase" style={{ color: '#828A99' }}>Est · {feature.estimation}</span>
                                                                )}
                                                            </div>
                                                            <div className="grid grid-cols-3 mt-4 pt-3" style={{ borderTop: `1px solid ${T.borderSoft}` }}>
                                                                <div>
                                                                    <div className="text-[10px] font-extrabold uppercase mb-1" style={{ letterSpacing: '0.1em', color: T.label }}>Amount</div>
                                                                    {ratePending
                                                                        ? <span className="font-bold uppercase text-[10.5px]" style={{ color: T.amber }}>Pending</span>
                                                                        : <span className="font-bold tabular-nums" style={{ fontSize: 14 }}>{fmtINR(feature.amount || 0)}</span>}
                                                                </div>
                                                                <div>
                                                                    <div className="text-[10px] font-extrabold uppercase mb-1" style={{ letterSpacing: '0.1em', color: T.label }}>Paid</div>
                                                                    {ratePending
                                                                        ? <span style={{ color: '#AAB1BE' }}>—</span>
                                                                        : <span className="font-bold tabular-nums" style={{ fontSize: 14, color: (feature.paid_amount || 0) > 0 ? T.green : '#AAB1BE' }}>{fmtINR(feature.paid_amount || 0)}</span>}
                                                                </div>
                                                                <div>
                                                                    <div className="text-[10px] font-extrabold uppercase mb-1" style={{ letterSpacing: '0.1em', color: T.label }}>Date</div>
                                                                    <span className="font-jbmono text-[11.5px] tabular-nums" style={{ color: '#6E7686' }}>
                                                                        {feature.created_at ? new Date(feature.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                </section>
                            </div>
                        );
                    })()}

                    {/* ========== ACTIVITY VIEW ========== */}
                    {view === 'activity' && !loading && selectedClient && (() => {
                        const sentCount = activityLogs.filter(l => !!l.notified_at).length;
                        const hiddenCount = activityLogs.filter(l => !!l.is_hidden).length;
                        const totalLogs = activityLogs.length;
                        const pendingCount = totalLogs - sentCount;

                        // Warm-palette action colors (money green, new things accent, shipped ink)
                        const warmAction: Record<string, string> = {
                            payment_received: T.green, rate_confirmed: T.green,
                            rate_pending: T.amber,
                            feature_added: T.accent, link_added: T.accent, project_created: T.accent, package_started: T.accent,
                            feature_completed: T.dark, project_completed: T.dark,
                            feature_deleted: '#B3331D', link_removed: '#B3331D',
                            feature_updated: '#4A515E', link_updated: '#4A515E', project_updated: '#4A515E', status_changed: '#4A515E', package_reverted: '#4A515E',
                        };

                        return (
                            <div>
                                {/* ===== TOP BAR ===== */}
                                <header className="flex items-center gap-3">
                                    <button onClick={handleBack} aria-label="Back to clients" className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)] shrink-0" style={{ border: `1px solid ${T.hairline}`, color: '#6E7686' }}>
                                        <ArrowLeft size={15} strokeWidth={2} />
                                    </button>
                                    <div className="text-[11.5px] font-extrabold uppercase truncate" style={{ letterSpacing: '0.14em', color: T.label }}>
                                        {selectedClient?.name || 'Admin'} — <span style={{ color: T.ink }}>Activity</span>
                                    </div>
                                </header>

                                {/* ===== EDITORIAL HERO ===== */}
                                <div className="mt-10 mb-9 max-w-3xl">
                                    <h1 className="font-extrabold break-words" style={{ fontSize: 'clamp(32px, 4vw, 52px)', letterSpacing: '-0.04em', lineHeight: 1.02, margin: 0 }}>
                                        {selectedClient?.name}.<br />
                                        <span style={{ color: '#AAB1BE' }}>Activity log.</span>
                                    </h1>
                                    <p className="text-[15.5px] mt-5 leading-[1.55] max-w-xl" style={{ color: T.muted }}>
                                        {totalLogs === 0
                                            ? 'No activity recorded yet for this client.'
                                            : <><span className="font-bold tabular-nums" style={{ color: T.ink }}>{totalLogs}</span> {totalLogs === 1 ? 'event' : 'events'} captured · <span className="font-bold tabular-nums" style={{ color: T.ink }}>{sentCount}</span> notified · <span className="tabular-nums">{pendingCount}</span> awaiting send.</>}
                                    </p>
                                </div>

                                {/* ===== EMAIL STATUS ===== */}
                                {!selectedClient.email ? (
                                    <div className="rounded-[18px] p-5 flex flex-wrap items-center gap-4 mb-8" style={{ background: T.amberSoft, border: '1px solid #E8D5B5' }}>
                                        <div className="shrink-0 w-10 h-10 rounded-xl grid place-items-center" style={{ background: 'rgba(168,107,45,0.14)', color: T.amber }}>
                                            <Mail size={16} strokeWidth={2} />
                                        </div>
                                        <div className="flex-1 min-w-[180px]">
                                            <p className="text-[10.5px] font-extrabold uppercase mb-0.5" style={{ letterSpacing: '0.12em', color: T.amber }}>No email on file</p>
                                            <p className="text-[13px] leading-[1.45]" style={{ color: '#7A5A24' }}>Add an email to enable notifications and digests.</p>
                                        </div>
                                        <button
                                            onClick={() => handleEditClient(selectedClient)}
                                            className="rounded-full h-9 px-4 text-[12.5px] font-bold flex items-center gap-1.5 text-white transition-opacity hover:opacity-90"
                                            style={{ background: T.amber }}
                                        >
                                            <Plus size={13} strokeWidth={2.5} /> Add email
                                        </button>
                                    </div>
                                ) : (
                                    <div className="rounded-[18px] px-5 py-4 flex items-center gap-3 mb-8" style={{ background: T.greenSoft, border: '1px solid #CBE4D6' }}>
                                        <MailCheck size={15} className="shrink-0" style={{ color: T.green }} strokeWidth={2} />
                                        <p className="text-[13px]" style={{ color: '#1C5E40' }}>
                                            Notifications go to <span className="font-jbmono font-medium" style={{ color: T.ink }}>{selectedClient.email}</span>
                                        </p>
                                    </div>
                                )}

                                {/* ===== BATCH ACTIONS ===== */}
                                {selectedLogIds.size > 0 && selectedClient.email && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="sticky top-3 z-20 rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3 mb-8 text-white"
                                        style={{ background: T.dark, boxShadow: '0 16px 40px -12px rgba(26,29,37,0.45)' }}
                                    >
                                        <span className="text-[12px] font-extrabold uppercase tabular-nums" style={{ letterSpacing: '0.1em' }}>
                                            {selectedLogIds.size} <span style={{ color: 'rgba(255,255,255,0.55)' }}>selected</span>
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setSelectedLogIds(new Set())}
                                                className="rounded-full h-9 px-4 text-[12.5px] font-bold transition-colors hover:bg-white/10"
                                                style={{ border: '1px solid rgba(255,255,255,0.25)', color: 'rgba(255,255,255,0.85)' }}
                                            >
                                                Clear
                                            </button>
                                            <button
                                                onClick={handleSendDigest}
                                                disabled={sendingDigest}
                                                className="rounded-full h-9 px-4 text-[12.5px] font-bold bg-white flex items-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50"
                                                style={{ color: T.ink }}
                                            >
                                                {sendingDigest ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} strokeWidth={2.5} />}
                                                Send digest
                                            </button>
                                        </div>
                                    </motion.div>
                                )}

                                {/* ===== TIMELINE ===== */}
                                <section>
                                    <SectionHead
                                        title="All events"
                                        meta={totalLogs > 0 ? `${sentCount} sent · ${pendingCount} pending${hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}` : undefined}
                                    />
                                    {loadingLogs ? (
                                        <div className="flex justify-center py-16">
                                            <Loader2 className="animate-spin" size={22} style={{ color: T.accent }} />
                                        </div>
                                    ) : totalLogs === 0 ? (
                                        <EmptyBlock icon={<Activity size={18} strokeWidth={2} />} title="No activity yet" sub="Events will appear here as you make changes to projects, features, and payments." />
                                    ) : activityLogs.map((log) => {
                                        const meta = getActivityMeta(log.action_type);
                                        const tone = warmAction[log.action_type] || '#4A515E';
                                        const isSent = !!log.notified_at;
                                        const isSending = sendingIds.has(log.id);
                                        const isSelected = selectedLogIds.has(log.id);
                                        const isHidden = !!log.is_hidden;
                                        return (
                                            <div
                                                key={log.id}
                                                className={`flex flex-wrap items-start gap-3 py-5 transition-colors ${isHidden ? 'opacity-55' : ''}`}
                                                style={{ borderBottom: `1px solid ${T.hairline}`, background: isSelected ? 'rgba(238,77,45,0.05)' : 'transparent' }}
                                            >
                                                <label className="pt-1.5 shrink-0 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleLogSelection(log.id)}
                                                        className="w-4 h-4 rounded cursor-pointer"
                                                    />
                                                </label>

                                                <div className="shrink-0 w-9 h-9 rounded-xl grid place-items-center mt-0.5" style={{ background: log.action_type.includes('completed') ? T.dark : `${tone}1f`, color: log.action_type.includes('completed') ? '#fff' : tone }}>
                                                    {meta.icon}
                                                </div>

                                                <div className="flex-1 min-w-0 basis-[58%] sm:basis-auto">
                                                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                                        <span className="inline-flex items-center rounded-full font-extrabold uppercase whitespace-nowrap" style={{ background: log.action_type.includes('completed') ? T.dark : `${tone}1a`, color: log.action_type.includes('completed') ? '#fff' : tone, padding: '3px 9px', fontSize: 10, letterSpacing: '0.06em' }}>
                                                            {meta.label}
                                                        </span>
                                                        {isHidden && (
                                                            <span className="inline-flex items-center gap-1 rounded-full font-extrabold uppercase" style={{ border: `1px solid ${T.hairline}`, color: '#6E7686', padding: '2px 8px', fontSize: 10, letterSpacing: '0.06em' }}>
                                                                <EyeOff size={9} /> Hidden
                                                            </span>
                                                        )}
                                                        {log.action_type === 'payment_received' && log.metadata?.paidAmount != null && (
                                                            <span className="inline-flex items-center rounded-full font-extrabold uppercase tabular-nums" style={{ background: T.greenSoft, color: T.green, padding: '3px 9px', fontSize: 10, letterSpacing: '0.04em' }}>
                                                                +₹{Number(log.metadata.paidAmount - (log.metadata.oldPaidAmount || 0)).toLocaleString('en-IN')}
                                                            </span>
                                                        )}
                                                        {log.action_type === 'feature_added' && log.metadata?.amount > 0 && (
                                                            <span className="inline-flex items-center rounded-full font-extrabold uppercase tabular-nums" style={{ background: T.accentSoft, color: T.accent, padding: '3px 9px', fontSize: 10, letterSpacing: '0.04em' }}>
                                                                ₹{Number(log.metadata.amount).toLocaleString('en-IN')}
                                                            </span>
                                                        )}
                                                        {log.action_type === 'rate_confirmed' && log.metadata?.amount > 0 && (
                                                            <span className="inline-flex items-center rounded-full font-extrabold uppercase tabular-nums" style={{ background: T.greenSoft, color: T.green, padding: '3px 9px', fontSize: 10, letterSpacing: '0.04em' }}>
                                                                ₹{Number(log.metadata.amount).toLocaleString('en-IN')}
                                                            </span>
                                                        )}
                                                        <span className="font-jbmono text-[10px] uppercase tabular-nums" style={{ color: T.faint }}>{getRelativeTime(log.created_at)}</span>
                                                    </div>
                                                    <p className="font-bold leading-snug" style={{ fontSize: 14.5 }}>{log.title}</p>
                                                    {log.description && (
                                                        <p className="text-[12.5px] mt-1 line-clamp-2 leading-[1.5]" style={{ color: T.muted }}>{log.description}</p>
                                                    )}

                                                    {log.metadata?.changes && Object.keys(log.metadata.changes).length > 0 && (
                                                        <div className="mt-2.5 space-y-1 rounded-xl p-3" style={{ background: '#F1F3F7' }}>
                                                            {Object.entries(log.metadata.changes).map(([key, diff]: [string, any], i) => (
                                                                <div key={i} className="flex items-center gap-1.5 text-[10.5px] font-jbmono flex-wrap">
                                                                    <span className="uppercase" style={{ color: '#828A99' }}>{key}</span>
                                                                    <span className="line-through" style={{ color: T.faint }}>{diff.old || 'none'}</span>
                                                                    <ArrowRight size={9} style={{ color: T.faint }} />
                                                                    <span className="font-medium tabular-nums" style={{ color: T.ink }}>{diff.new}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {log.action_type === 'payment_received' && log.metadata?.amount > 0 && (
                                                        <div className="mt-2.5 flex items-center gap-2.5">
                                                            <div className="flex-1 h-[4px] rounded-full overflow-hidden max-w-[140px]" style={{ background: T.borderSoft }}>
                                                                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min((Number(log.metadata.paidAmount) / Number(log.metadata.amount)) * 100, 100)}%`, background: T.green }} />
                                                            </div>
                                                            <span className="text-[10.5px] font-jbmono tabular-nums" style={{ color: '#828A99' }}>
                                                                ₹{Number(log.metadata.paidAmount).toLocaleString('en-IN')}/₹{Number(log.metadata.amount).toLocaleString('en-IN')}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="w-full sm:w-auto sm:shrink-0 flex items-center sm:flex-col sm:items-end gap-2 justify-end pl-12 sm:pl-0 mt-1 sm:mt-0">
                                                    {isSent && (
                                                        <span className="inline-flex items-center gap-1 rounded-full font-extrabold uppercase whitespace-nowrap shrink-0" style={{ background: T.greenSoft, color: T.green, padding: '3px 9px', fontSize: 10, letterSpacing: '0.05em' }}>
                                                            <MailCheck size={9} />
                                                            <span className="hidden sm:inline">Sent · {getRelativeTime(log.notified_at!)}</span>
                                                            <span className="sm:hidden">Sent</span>
                                                        </span>
                                                    )}
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            onClick={() => handleSendSingle(log.id)}
                                                            disabled={isSending || !selectedClient?.email}
                                                            className="rounded-full h-8 px-3 text-[11.5px] font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[rgba(26,29,37,0.06)]"
                                                            style={{ border: `1px solid ${T.hairline}`, color: '#4A515E' }}
                                                            title={!selectedClient?.email ? 'Add client email first' : isSent ? 'Resend' : 'Send'}
                                                        >
                                                            {isSending ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} strokeWidth={2.2} />}
                                                            {isSent ? 'Resend' : 'Send'}
                                                        </button>
                                                        <button
                                                            onClick={() => handleToggleHideLog(log.id, !isHidden)}
                                                            className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]"
                                                            style={{ color: '#6E7686' }}
                                                            title={isHidden ? 'Unhide' : 'Hide from client'}
                                                            aria-label={isHidden ? 'Unhide log' : 'Hide log'}
                                                        >
                                                            {isHidden ? <Eye size={12} strokeWidth={2} /> : <EyeOff size={12} strokeWidth={2} />}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteLog(log.id)}
                                                            className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-[rgba(179,51,29,0.08)]"
                                                            style={{ color: '#6E7686' }}
                                                            onMouseEnter={e => { e.currentTarget.style.color = '#B3331D'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.color = '#6E7686'; }}
                                                            title="Delete"
                                                            aria-label="Delete log"
                                                        >
                                                            <Trash2 size={12} strokeWidth={2} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </section>
                            </div>
                        );
                    })()}
                </div>
            </main>

            {/* ========== CREATE / EDIT MODAL ========== */}
            <AnimatePresence>
                {showModal && (() => {
                    const entityLabel = view === 'clients' ? 'client' : view === 'projects' ? 'project' : view === 'links' ? 'link' : 'feature';
                    const isEditing = !!(editingId || editingLinkIndex !== null);
                    const helpCls = 'text-[11.5px] mt-1.5';
                    return (
                        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 backdrop-blur-sm" style={{ background: 'rgba(26,29,37,0.5)' }}>
                            <motion.div
                                initial={{ opacity: 0, y: 30, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 30, scale: 0.98 }}
                                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                                className="font-hanken w-full sm:max-w-md rounded-t-[22px] sm:rounded-[22px] overflow-hidden max-h-[92vh] sm:max-h-[88vh] flex flex-col"
                                style={{ background: '#FBFCFE', color: T.ink, boxShadow: `0 0 0 1px ${T.border}, 0 24px 64px -12px rgba(26,29,37,0.4)` }}
                            >
                                <div className="px-5 sm:px-6 py-4 flex justify-between items-center shrink-0" style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-[10.5px] font-extrabold uppercase" style={{ letterSpacing: '0.12em', color: T.accent }}>
                                            {isEditing ? 'Edit' : 'New'}
                                        </span>
                                        <span style={{ color: T.faint }}>/</span>
                                        <h3 className="text-[15.5px] font-bold capitalize truncate">{entityLabel}</h3>
                                    </div>
                                    <button
                                        onClick={() => { setShowModal(false); setEditingId(null); setEditingLinkIndex(null); }}
                                        aria-label="Close"
                                        className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]"
                                        style={{ color: '#6E7686' }}
                                    >
                                        <X size={15} strokeWidth={2} />
                                    </button>
                                </div>

                                <div className="p-5 sm:p-6 space-y-5 overflow-y-auto custom-scrollbar">
                                    {/* ===== CLIENT FORM ===== */}
                                    {view === 'clients' && (
                                        <>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Client name</label>
                                                <input value={formData.name || ''} autoComplete="off" data-form-type="other" placeholder="Acme Studio" className={wInputCls} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Access key</label>
                                                <input value={formData.access_key || ''} autoComplete="off" data-form-type="other" placeholder="acme-9281" className={`${wInputCls} font-jbmono`} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, access_key: e.target.value })} />
                                                <p className={helpCls} style={{ color: T.faint }}>Unique identifier the client will use to log in.</p>
                                            </div>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Email <span className="normal-case" style={{ color: T.faint }}>(optional)</span></label>
                                                <input value={formData.email || ''} type="email" autoComplete="off" data-form-type="other" placeholder="hello@acme.com" className={wInputCls} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                                <p className={helpCls} style={{ color: T.faint }}>Required for sending notifications.</p>
                                            </div>
                                        </>
                                    )}

                                    {/* ===== PROJECT FORM ===== */}
                                    {view === 'projects' && (
                                        <>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Description</label>
                                                <input value={formData.description || ''} placeholder="Marketing site redesign" className={wInputCls} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Category</label>
                                                <input value={formData.category || ''} placeholder="Web Development" className={wInputCls} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, category: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Status</label>
                                                <Select
                                                    value={formData.status_override || ''}
                                                    onChange={v => setFormData({ ...formData, status_override: v })}
                                                    options={[
                                                        { value: '', label: 'Auto — follow feature progress' },
                                                        { value: 'On Hold', label: 'On Hold' },
                                                        { value: 'Cancelled', label: 'Cancelled' },
                                                    ]}
                                                />
                                                <p className={helpCls} style={{ color: T.muted }}>Status is set automatically from feature progress (Not Started → In Progress → Completed). Use an override only to pause or cancel.</p>
                                            </div>
                                        </>
                                    )}

                                    {/* ===== LINK FORM ===== */}
                                    {view === 'links' && (
                                        <>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Title</label>
                                                <input value={formData.link_title || ''} placeholder="Figma design" className={wInputCls} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, link_title: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>URL</label>
                                                <input value={formData.link_url || ''} placeholder="https://..." className={`${wInputCls} font-jbmono`} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, link_url: e.target.value })} />
                                            </div>
                                        </>
                                    )}

                                    {/* ===== FEATURE FORM ===== */}
                                    {view === 'features' && (
                                        <>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Feature description</label>
                                                <input value={formData.description || ''} placeholder="Dark mode toggle" className={wInputCls} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Estimation</label>
                                                <input value={formData.estimation || ''} placeholder="2 days" className={wInputCls} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, estimation: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Type</label>
                                                <Select
                                                    value={formData.is_new_request || 'false'}
                                                    onChange={v => setFormData({ ...formData, is_new_request: v })}
                                                    options={[
                                                        { value: 'false', label: 'No · Core feature' },
                                                        { value: 'true', label: 'Yes · Extra request' },
                                                    ]}
                                                />
                                            </div>
                                            <div>
                                                <label className={wLabelCls} style={{ color: T.label }}>Status</label>
                                                <Select
                                                    value={formData.status || 'Requested'}
                                                    onChange={v => setFormData({ ...formData, status: v })}
                                                    options={['Requested', 'Approved', 'Working', 'Updating', 'Completed'].map(s => ({ value: s, label: s }))}
                                                />
                                            </div>

                                            {/* Payment Confirmed Toggle */}
                                            <div className="rounded-2xl p-4 bg-white" style={{ boxShadow: `0 0 0 1px ${T.border}` }}>
                                                <div className="flex items-center justify-between gap-4">
                                                    <div className="min-w-0">
                                                        <label className={wLabelCls.replace('mb-2', 'mb-1')} style={{ color: T.label }}>Payment confirmed</label>
                                                        <p className="text-[12.5px] leading-[1.45]" style={{ color: T.muted }}>
                                                            {formData.payment_confirmed !== false
                                                                ? 'Rate locked — amount fields visible to client.'
                                                                : 'Rate pending — client sees "Rate pending".'}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        role="switch"
                                                        aria-checked={formData.payment_confirmed !== false}
                                                        onClick={() => setFormData({ ...formData, payment_confirmed: !formData.payment_confirmed })}
                                                        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none"
                                                        style={{ background: formData.payment_confirmed !== false ? T.accent : T.hairline }}
                                                    >
                                                        <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200 ${formData.payment_confirmed !== false ? 'translate-x-6' : 'translate-x-1'}`} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Amount fields */}
                                            {formData.payment_confirmed !== false && (
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className={wLabelCls} style={{ color: T.label }}>Amount <span className="normal-case" style={{ color: T.faint }}>(₹)</span></label>
                                                        <input value={formData.amount ?? ''} type="number" placeholder="5000" className={`${wInputCls} tabular-nums font-jbmono`} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, amount: e.target.value })} />
                                                    </div>
                                                    <div>
                                                        <label className={wLabelCls} style={{ color: T.label }}>Paid <span className="normal-case" style={{ color: T.faint }}>(₹)</span></label>
                                                        <input value={formData.paid_amount ?? ''} type="number" placeholder="2500" className={`${wInputCls} tabular-nums font-jbmono`} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setFormData({ ...formData, paid_amount: e.target.value })} />
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* Footer actions */}
                                    <div className="flex items-center gap-2 pt-2">
                                        <button
                                            onClick={() => { setShowModal(false); setEditingId(null); setEditingLinkIndex(null); }}
                                            className="rounded-full h-11 px-5 text-[13.5px] font-bold transition-colors hover:bg-[rgba(26,29,37,0.06)]"
                                            style={{ border: `1px solid ${T.hairline}`, color: '#4A515E' }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={view === 'clients' ? handleSaveClient : view === 'projects' ? handleSaveProject : view === 'links' ? handleAddLink : handleSaveFeature}
                                            disabled={saving}
                                            className="flex-1 rounded-full h-11 px-5 text-[13.5px] font-bold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                                            style={{ background: T.dark }}
                                        >
                                            {saving ? <><Loader2 size={13} className="animate-spin" /> Saving</> : isEditing ? 'Update' : 'Create'}
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    );
                })()}
            </AnimatePresence>

            {/* ===== CONVERT CLIENT TO MONTHLY PACKAGE (preview-first; writes nothing) ===== */}
            {packageClient && (() => {
                const today = todayLocalISO();
                const start = packageForm.startDate || today;
                const fee = Number(packageForm.fee) || 0;
                const disp = packageForm.disposition;
                const before = {
                    total: packageClient.stats.totalValue,
                    paid: packageClient.stats.paidValue,
                    pending: packageClient.stats.pendingValue,
                };
                const sched = packageSchedule(start, null, 'monthly', today);
                const fmt = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

                let firstCharge = fee;
                let balanceLine = '';
                if (disp === 'writeoff') balanceLine = `Pending ${fmt(before.pending)} across all projects → written off. Client owes ₹0 on past work.`;
                else if (disp === 'settle') balanceLine = `Collect pending ${fmt(before.pending)} now, then the monthly retainer begins.`;
                else if (disp === 'roll_into_first') { firstCharge = fee + before.pending; balanceLine = `Pending ${fmt(before.pending)} rolled into the first invoice.`; }
                else balanceLine = `Pending ${fmt(before.pending)} stays as a separate balance, alongside the monthly retainer.`;

                const close = () => setPackageClient(null);

                return (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm font-hanken" style={{ background: 'rgba(26,29,37,0.5)' }} onClick={close}>
                        <div className="w-full max-w-lg rounded-[22px] overflow-hidden" style={{ background: '#FBFCFE', color: T.ink, boxShadow: `0 0 0 1px ${T.border}, 0 24px 64px -12px rgba(26,29,37,0.4)` }} onClick={e => e.stopPropagation()}>
                            <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                                <div className="min-w-0">
                                    <p className="text-[10.5px] font-extrabold uppercase" style={{ letterSpacing: '0.12em', color: T.accent }}>Convert to Monthly Package</p>
                                    <h3 className="text-[16.5px] font-bold mt-0.5 truncate">{packageClient.name}</h3>
                                    <p className="text-[11.5px] mt-0.5" style={{ color: T.muted }}>Retainer covers all of this client&apos;s projects</p>
                                </div>
                                <button onClick={close} aria-label="Close" className="w-9 h-9 shrink-0 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]" style={{ color: '#6E7686' }}><X size={16} /></button>
                            </div>

                            <div className="px-6 py-5 flex flex-col gap-4">
                                <div>
                                    <label className={wLabelCls} style={{ color: T.label }}>Start / first billing date</label>
                                    <DatePicker value={packageForm.startDate} onChange={v => setPackageForm({ ...packageForm, startDate: v })} />
                                </div>
                                <div>
                                    <label className={wLabelCls} style={{ color: T.label }}>Monthly fee (₹)</label>
                                    <input type="number" min="0" value={packageForm.fee} placeholder="20000" className={`${wInputCls} tabular-nums font-jbmono`} style={wInputStyle} onFocus={wFocus} onBlur={wBlur} onChange={e => setPackageForm({ ...packageForm, fee: e.target.value })} />
                                </div>
                                <div>
                                    <label className={wLabelCls} style={{ color: T.label }}>Existing pending balance</label>
                                    <Select
                                        value={packageForm.disposition}
                                        onChange={v => setPackageForm({ ...packageForm, disposition: v })}
                                        options={[
                                            { value: 'writeoff', label: 'Write off · forgive the old balance' },
                                            { value: 'settle', label: 'Settle now · collect it' },
                                            { value: 'roll_into_first', label: 'Roll into first invoice' },
                                            { value: 'keep_one_time', label: 'Keep as a separate one-time balance' },
                                        ]}
                                    />
                                </div>

                                <div className="rounded-[16px] p-4 flex flex-col gap-3" style={{ background: '#F1F3F7', border: `1px solid ${T.borderSoft}` }}>
                                    <p className="text-[10.5px] font-extrabold uppercase" style={{ letterSpacing: '0.12em', color: T.label }}>Preview · nothing is saved yet</p>
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div><p className="text-[10px] font-extrabold uppercase" style={{ letterSpacing: '0.08em', color: T.label }}>Total</p><p className="text-[14.5px] font-bold tabular-nums mt-0.5">{fmt(before.total)}</p></div>
                                        <div><p className="text-[10px] font-extrabold uppercase" style={{ letterSpacing: '0.08em', color: T.label }}>Paid</p><p className="text-[14.5px] font-bold tabular-nums mt-0.5" style={{ color: T.green }}>{fmt(before.paid)}</p></div>
                                        <div><p className="text-[10px] font-extrabold uppercase" style={{ letterSpacing: '0.08em', color: T.label }}>Pending</p><p className="text-[14.5px] font-bold tabular-nums mt-0.5" style={{ color: before.pending > 0 ? T.accent : T.ink }}>{fmt(before.pending)}</p></div>
                                    </div>
                                    <div className="h-px" style={{ background: T.hairline }} />
                                    <p className="text-[12.5px] leading-relaxed" style={{ color: T.muted }}>{balanceLine}</p>
                                    <ul className="text-[12.5px] flex flex-col gap-1" style={{ color: T.muted }}>
                                        <li>Monthly fee: <span className="font-bold" style={{ color: T.ink }}>{fmt(fee)}</span></li>
                                        <li>First charge: <span className="font-bold" style={{ color: T.ink }}>{fmt(firstCharge)}</span> on <span style={{ color: T.ink }}>{start}</span> · for <span style={{ color: T.ink }}>{new Date(coveragePeriod(start, 'monthly').start + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span></li>
                                        <li>Then <span className="font-bold" style={{ color: T.ink }}>{fmt(fee)}</span> on <span style={{ color: T.ink }}>{sched.nextChargeDate}</span> · for <span style={{ color: T.ink }}>{new Date(coveragePeriod(sched.nextChargeDate, 'monthly').start + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span></li>
                                        {sched.duePeriodStarts.length > 1 && <li className="font-semibold" style={{ color: T.accent }}>{sched.duePeriodStarts.length} months already due — bill them in Manage package.</li>}
                                    </ul>
                                </div>
                            </div>

                            <div className="px-6 py-4 flex items-center gap-2" style={{ borderTop: `1px solid ${T.borderSoft}` }}>
                                <button onClick={close} disabled={packageSaving} className="rounded-full h-11 px-5 text-[13.5px] font-bold transition-colors hover:bg-[rgba(26,29,37,0.06)] disabled:opacity-50" style={{ border: `1px solid ${T.hairline}`, color: '#4A515E' }}>Cancel</button>
                                <button onClick={handleConfirmPackage} disabled={packageSaving || fee <= 0 || !start} className="flex-1 rounded-full h-11 px-5 text-[13.5px] font-bold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: T.dark }}>
                                    {packageSaving ? <><Loader2 size={13} className="animate-spin" /> Converting…</> : 'Confirm conversion'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ===== MANAGE PACKAGE (record monthly payments, generate periods) ===== */}
            {managePackageClient && (() => {
                const client = managePackageClient;
                const fee = Number(client.package_fee) || 0;
                const fmt = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;
                const fmtDate = (iso?: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                const close = () => setManagePackageClient(null);
                const badgeFor = (s: string): React.CSSProperties => s === 'Paid'
                    ? { background: T.greenSoft, color: T.green }
                    : s === 'Partial'
                        ? { background: T.amberSoft, color: T.amber }
                        : { background: T.accentSoft, color: T.accent };

                // Detect periods that are already due but not yet generated.
                const mToday = todayLocalISO();
                const mAnchor = client.package_anchor_day ?? (client.package_started_on ? Number(client.package_started_on.split('-')[2]) : 1);
                const dueBillingDates = client.package_started_on
                    ? packageSchedule(client.package_started_on, mAnchor, (client.package_cadence || 'monthly') as Cadence, mToday).duePeriodStarts
                    : [];
                const existingStarts = new Set(managePeriods.map(p => p.period_start));
                // Each due billing date covers the prior month (arrears); compare those.
                const missingStarts = dueBillingDates
                    .map(d => coveragePeriod(d, (client.package_cadence || 'monthly') as Cadence).start)
                    .filter(s => !existingStarts.has(s));

                return (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm font-hanken" style={{ background: 'rgba(26,29,37,0.5)' }} onClick={close}>
                        <div className="w-full max-w-xl rounded-[22px] overflow-hidden flex flex-col max-h-[85vh]" style={{ background: '#FBFCFE', color: T.ink, boxShadow: `0 0 0 1px ${T.border}, 0 24px 64px -12px rgba(26,29,37,0.4)` }} onClick={e => e.stopPropagation()}>
                            <div className="px-6 py-5 flex items-center justify-between shrink-0" style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                                <div className="min-w-0">
                                    <p className="text-[10.5px] font-extrabold uppercase" style={{ letterSpacing: '0.12em', color: T.accent }}>Manage Package</p>
                                    <h3 className="text-[16.5px] font-bold mt-0.5 truncate">{client.name} · {fmt(fee)}/mo</h3>
                                </div>
                                <button onClick={close} aria-label="Close" className="w-9 h-9 shrink-0 rounded-full grid place-items-center transition-colors hover:bg-[rgba(26,29,37,0.06)]" style={{ color: '#6E7686' }}><X size={16} /></button>
                            </div>

                            <div className="px-6 py-4 flex items-center justify-between gap-3 shrink-0" style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                                <span className="text-[10.5px] font-extrabold uppercase" style={{ letterSpacing: '0.12em', color: T.label }}>{managePeriods.length} billing period{managePeriods.length === 1 ? '' : 's'}</span>
                                <button
                                    onClick={() => generateNextPeriod(client)}
                                    disabled={packageSaving || periodsLoading}
                                    className="rounded-full h-9 px-4 flex items-center gap-1.5 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                                    style={{ background: T.dark }}
                                >
                                    <Plus size={13} strokeWidth={2.5} /> Generate next period
                                </button>
                            </div>

                            {!periodsLoading && missingStarts.length > 0 && (
                                <div className="mx-6 mt-4 rounded-[14px] p-3.5 flex items-center justify-between gap-3 shrink-0" style={{ background: T.amberSoft, border: '1px solid #E8D5B5' }}>
                                    <span className="text-[12.5px] font-semibold" style={{ color: '#7A5A24' }}>{missingStarts.length} due period{missingStarts.length === 1 ? '' : 's'} not yet generated.</span>
                                    <button onClick={() => generateMissingPeriods(client, missingStarts)} disabled={packageSaving || periodsLoading} className="rounded-full h-8 px-3.5 text-[12px] font-bold text-white whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-50" style={{ background: T.amber }}>
                                        Generate {missingStarts.length}
                                    </button>
                                </div>
                            )}

                            <div className="px-6 py-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
                                {periodsLoading && (
                                    <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={20} style={{ color: T.accent }} /></div>
                                )}
                                {!periodsLoading && managePeriods.length === 0 && (
                                    <p className="text-[13px] text-center py-6" style={{ color: T.muted }}>No billing periods yet. Click &quot;Generate next period&quot; to create one.</p>
                                )}
                                {managePeriods.map(p => (
                                    <div key={p.id} className="rounded-[16px] p-4 flex flex-col gap-3 bg-white" style={{ boxShadow: `0 0 0 1px ${T.border}` }}>
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="text-[13.5px] font-bold">{fmtDate(p.period_start)} – {fmtDate(p.period_end)}</p>
                                                {p.note && <p className="text-[11.5px] mt-0.5" style={{ color: T.muted }}>{p.note}</p>}
                                            </div>
                                            <span className="rounded-full font-extrabold uppercase shrink-0" style={{ ...badgeFor(p.payment_status), padding: '4px 10px', fontSize: 10, letterSpacing: '0.06em' }}>{p.payment_status}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11.5px] font-jbmono whitespace-nowrap" style={{ color: T.muted }}>Paid of {fmt(Number(p.fee_amount) || 0)}</span>
                                            <input
                                                type="number"
                                                min="0"
                                                value={periodPayInputs[p.id] ?? ''}
                                                onChange={e => setPeriodPayInputs({ ...periodPayInputs, [p.id]: e.target.value })}
                                                className="flex-1 h-10 px-3.5 rounded-xl bg-white text-[13.5px] outline-none tabular-nums font-jbmono transition-shadow"
                                                style={wInputStyle}
                                                onFocus={wFocus}
                                                onBlur={wBlur}
                                                placeholder="0"
                                            />
                                            <button
                                                onClick={() => recordPeriodPayment(p)}
                                                disabled={packageSaving}
                                                className="rounded-full h-10 px-4 text-[12.5px] font-bold transition-colors hover:bg-[rgba(26,29,37,0.06)] disabled:opacity-50"
                                                style={{ border: `1px solid ${T.hairline}`, color: '#4A515E' }}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="px-6 py-4 shrink-0 flex justify-end" style={{ borderTop: `1px solid ${T.borderSoft}` }}>
                                <button onClick={close} className="rounded-full h-11 px-6 text-[13.5px] font-bold text-white transition-opacity hover:opacity-90" style={{ background: T.dark }}>Done</button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

