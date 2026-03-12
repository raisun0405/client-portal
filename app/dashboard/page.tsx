'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchActivityLogs, type ActivityLog } from '@/lib/activityLogger';
import { getClientSession, logoutClient } from '../actions'; // Import server actions
import { LayoutGrid, LogOut, FolderOpen, Loader2, X, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, Calendar, ArrowRight, TrendingUp, Wallet, CheckCircle2, Clock, FileText, Zap, CreditCard, Link2, Trash2, RefreshCw, PackagePlus, Activity, Download } from 'lucide-react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Sector } from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Types
type Project = {
    id: string;
    category: string;
    description: string;
    status: string;
    links: { title: string; url: string }[];
    created_at: string;
};

type Feature = {
    id: string;
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

// Sorting types
type SortField = 'amount' | 'status' | 'created_at';
type SortOrder = 'asc' | 'desc';

// Enhanced Project type with calculated stats
type ProjectWithStats = Project & {
    stats: {
        total: number;
        paid: number;
        pending: number;
        progress: number;
    };
};

export default function DashboardPage() {
    const router = useRouter();
    const [client, setClient] = useState<any>(null);
    const [projects, setProjects] = useState<ProjectWithStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null); // New error state
    const [selectedProject, setSelectedProject] = useState<ProjectWithStats | null>(null);
    const [features, setFeatures] = useState<Feature[]>([]);
    const [loadingFeatures, setLoadingFeatures] = useState(false);

    // Sorting state
    const [sortField, setSortField] = useState<SortField>('created_at');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

    // Activity logs state
    const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    // Donut chart active segment index
    const [activeDonutIndex, setActiveDonutIndex] = useState<number | null>(null);

    useEffect(() => {
        const verifySession = async () => {
            try {
                const session = await getClientSession();
                if (!session) {
                    router.push('/');
                    return;
                }
                setClient(session);
                fetchProjects(session.id);
                loadActivityLogs(session.id);
            } catch (err) {
                console.error("Session verification failed", err);
                router.push('/');
            }
        };
        verifySession();
    }, [router]);

    const fetchProjects = async (clientId: string) => {
        setLoading(true);
        setError(null);

        try {
            // 1. Fetch all projects for this client
            const { data: projectsData, error: projectsError } = await supabase
                .from('projects')
                .select('*')
                .eq('client_id', clientId)
                .order('created_at', { ascending: false });

            if (projectsError) throw new Error(projectsError.message);

            if (projectsData && projectsData.length > 0) {
                // 2. Fetch ALL features for these projects to calculate stats
                const projectIds = projectsData.map(p => p.id);
                const { data: featuresData, error: featuresError } = await supabase
                    .from('features')
                    .select('*')
                    .in('project_id', projectIds);

                if (featuresError) throw new Error(featuresError.message);

                // 3. Calculate stats for each project
                const enhancedProjects: ProjectWithStats[] = projectsData.map(project => {
                    const projectFeatures = featuresData?.filter(f => f.project_id === project.id) || [];
                    // Only include confirmed features in financial calculations
                    const confirmedFeatures = projectFeatures.filter(f => f.payment_confirmed !== false);
                    const total = confirmedFeatures.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
                    const paid = confirmedFeatures.reduce((sum, f) => sum + (Number(f.paid_amount) || 0), 0);

                    // Progress Calculation
                    const totalFeatures = projectFeatures.length;
                    const completedFeatures = projectFeatures.filter(f => f.status === 'Completed').length;
                    const progress = totalFeatures > 0 ? Math.round((completedFeatures / totalFeatures) * 100) : 0;

                    return {
                        ...project,
                        links: project.links || [],
                        stats: {
                            total,
                            paid,
                            pending: total - paid,
                            progress
                        }
                    };
                });
                setProjects(enhancedProjects);
            } else {
                setProjects([]);
            }
        } catch (err: any) {
            console.error("Error fetching projects:", err);
            setError(err.message || "Failed to load projects.");
        } finally {
            setLoading(false);
        }
    };

    const fetchFeatures = async (projectId: string) => {
        setLoadingFeatures(true);
        try {
            const { data, error } = await supabase
                .from('features')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            if (data) setFeatures(data);
        } catch (err: any) {
            console.error("Error fetching features:", err);
            // We could show a toast or local error here, but for now just logging
        } finally {
            setLoadingFeatures(false);
        }
    };

    const handleProjectClick = async (project: ProjectWithStats) => {
        setSelectedProject(project);
        await fetchFeatures(project.id);
    };

    const closeModal = () => {
        setSelectedProject(null);
        setFeatures([]);
    };

    const handleLogout = async () => {
        try {
            await logoutClient();
        } catch (err) {
            console.error('Logout failed:', err);
        } finally {
            // Always redirect to login regardless of whether logout succeeded
            router.push('/');
        }
    };

    const loadActivityLogs = async (clientId: string) => {
        setLoadingLogs(true);
        const logs = await fetchActivityLogs(clientId, 25);
        setActivityLogs(logs);
        setLoadingLogs(false);
    };

    // Helper: get icon and color for activity type
    const getActivityMeta = (actionType: string) => {
        switch (actionType) {
            case 'project_created':
                return { icon: <PackagePlus size={16} />, color: 'bg-blue-500', bgLight: 'bg-blue-50', textColor: 'text-blue-600', label: 'New Project' };
            case 'project_updated':
                return { icon: <RefreshCw size={16} />, color: 'bg-slate-500', bgLight: 'bg-slate-50', textColor: 'text-slate-600', label: 'Updated' };
            case 'project_completed':
                return { icon: <CheckCircle2 size={16} />, color: 'bg-emerald-500', bgLight: 'bg-emerald-50', textColor: 'text-emerald-600', label: 'Completed' };
            case 'feature_added':
                return { icon: <Zap size={16} />, color: 'bg-violet-500', bgLight: 'bg-violet-50', textColor: 'text-violet-600', label: 'Feature Added' };
            case 'feature_updated':
                return { icon: <FileText size={16} />, color: 'bg-sky-500', bgLight: 'bg-sky-50', textColor: 'text-sky-600', label: 'Feature Updated' };
            case 'feature_completed':
                return { icon: <CheckCircle2 size={16} />, color: 'bg-emerald-500', bgLight: 'bg-emerald-50', textColor: 'text-emerald-600', label: 'Feature Done' };
            case 'feature_deleted':
                return { icon: <Trash2 size={16} />, color: 'bg-red-500', bgLight: 'bg-red-50', textColor: 'text-red-600', label: 'Removed' };
            case 'payment_received':
                return { icon: <CreditCard size={16} />, color: 'bg-amber-500', bgLight: 'bg-amber-50', textColor: 'text-amber-600', label: 'Payment' };
            case 'link_added':
                return { icon: <Link2 size={16} />, color: 'bg-indigo-500', bgLight: 'bg-indigo-50', textColor: 'text-indigo-600', label: 'Link Added' };
            case 'link_removed':
                return { icon: <Trash2 size={16} />, color: 'bg-rose-500', bgLight: 'bg-rose-50', textColor: 'text-rose-600', label: 'Link Removed' };
            case 'status_changed':
                return { icon: <RefreshCw size={16} />, color: 'bg-teal-500', bgLight: 'bg-teal-50', textColor: 'text-teal-600', label: 'Status Changed' };
            case 'rate_confirmed':
                return { icon: <CheckCircle2 size={16} />, color: 'bg-green-500', bgLight: 'bg-green-50', textColor: 'text-green-600', label: 'Rate Confirmed' };
            case 'rate_pending':
                return { icon: <Clock size={16} />, color: 'bg-orange-500', bgLight: 'bg-orange-50', textColor: 'text-orange-600', label: 'Rate Pending' };
            default:
                return { icon: <Activity size={16} />, color: 'bg-slate-400', bgLight: 'bg-slate-50', textColor: 'text-slate-500', label: 'Activity' };
        }
    };

    // Helper: get plain-text label for activity type (for PDF)
    const getActivityLabel = (actionType: string): string => {
        const labels: Record<string, string> = {
            project_created: 'New Project',
            project_updated: 'Updated',
            project_completed: 'Completed',
            feature_added: 'Feature Added',
            feature_updated: 'Feature Updated',
            feature_completed: 'Feature Done',
            feature_deleted: 'Removed',
            payment_received: 'Payment',
            link_added: 'Link Added',
            link_removed: 'Link Removed',
            status_changed: 'Status Changed',
            rate_confirmed: 'Rate Confirmed',
            rate_pending: 'Rate Pending',
        };
        return labels[actionType] || 'Activity';
    };

    // Helper: get hex color for activity type (for PDF)
    const getActivityColor = (actionType: string): string => {
        const colors: Record<string, string> = {
            project_created: '#3b82f6',
            project_updated: '#64748b',
            project_completed: '#10b981',
            feature_added: '#8b5cf6',
            feature_updated: '#0ea5e9',
            feature_completed: '#10b981',
            feature_deleted: '#ef4444',
            payment_received: '#f59e0b',
            link_added: '#6366f1',
            link_removed: '#f43f5e',
            status_changed: '#14b8a6',
            rate_confirmed: '#22c55e',
            rate_pending: '#f97316',
        };
        return colors[actionType] || '#94a3b8';
    };

    // Sanitize text for jsPDF (default fonts only support Windows-1252)
    const sanitize = (text: string): string => {
        if (!text) return '';
        return text
            .replace(/[\u2018\u2019\u201A]/g, "'")    // curly single quotes
            .replace(/[\u201C\u201D\u201E]/g, '"')     // curly double quotes
            .replace(/\u2026/g, '...')                  // ellipsis
            .replace(/\u2013/g, '-')                    // en dash
            .replace(/\u2014/g, '--')                   // em dash
            .replace(/\u20B9/g, 'Rs.')                  // ₹ rupee sign
            .replace(/\u2192/g, '->')                   // → arrow
            .replace(/\u2190/g, '<-')                   // ← arrow
            .replace(/[^\x00-\xFF]/g, '');              // strip anything outside Latin-1
    };

    // Download activity log as PDF
    const downloadActivityPDF = () => {
        if (activityLogs.length === 0) return;

        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();

        // -- Header band --
        doc.setFillColor(15, 23, 42); // slate-900
        doc.rect(0, 0, pageWidth, 38, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('Activity Log', 14, 18);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text(sanitize(client?.name || 'Client Portal'), 14, 28);

        const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
        doc.text('Generated: ' + today, pageWidth - 14, 28, { align: 'right' });

        // -- Summary line --
        doc.setTextColor(100, 116, 139); // slate-500
        doc.setFontSize(9);
        doc.text(activityLogs.length + ' log entries', 14, 48);

        // -- Build table rows --
        const rows = activityLogs.map((log) => {
            const date = new Date(log.created_at);
            const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

            const label = getActivityLabel(log.action_type);
            const title = sanitize(log.title || '');
            let details = sanitize(log.description || '');

            // Append amount info
            if (log.action_type === 'payment_received' && log.metadata?.paidAmount) {
                const payment = Number(log.metadata.paidAmount - (log.metadata.oldPaidAmount || 0));
                details += (details ? '\n' : '') + 'Payment: Rs.' + payment.toLocaleString();
                if (log.metadata?.amount) {
                    details += ' of Rs.' + Number(log.metadata.amount).toLocaleString();
                }
            } else if (log.action_type === 'feature_added' && log.metadata?.amount > 0) {
                details += (details ? '\n' : '') + 'Amount: Rs.' + Number(log.metadata.amount).toLocaleString();
            } else if (log.action_type === 'feature_updated' && log.metadata?.oldAmount !== undefined && log.metadata?.amount !== log.metadata?.oldAmount) {
                details += (details ? '\n' : '') + 'Rs.' + Number(log.metadata.oldAmount).toLocaleString() + ' -> Rs.' + Number(log.metadata.amount).toLocaleString();
            } else if (log.action_type === 'rate_confirmed' && log.metadata?.amount > 0) {
                details += (details ? '\n' : '') + 'Amount: Rs.' + Number(log.metadata.amount).toLocaleString();
            }

            // Append change diffs
            if (log.metadata?.changes && Object.keys(log.metadata.changes).length > 0) {
                const diffs = Object.entries(log.metadata.changes)
                    .map(([key, diff]: [string, any]) => sanitize(key) + ': ' + sanitize(String(diff.old || 'none')) + ' -> ' + sanitize(String(diff.new)))
                    .join('\n');
                details += (details ? '\n' : '') + diffs;
            }

            return [dateStr + '\n' + timeStr, label, title, details];
        });

        // -- Render table --
        autoTable(doc, {
            startY: 54,
            head: [['Date & Time', 'Type', 'Title', 'Details']],
            body: rows,
            theme: 'grid',
            styles: {
                fontSize: 8.5,
                cellPadding: { top: 4, right: 5, bottom: 4, left: 5 },
                lineColor: [226, 232, 240], // slate-200
                lineWidth: 0.3,
                textColor: [30, 41, 59], // slate-800
                overflow: 'linebreak',
            },
            headStyles: {
                fillColor: [241, 245, 249], // slate-100
                textColor: [71, 85, 105], // slate-600
                fontStyle: 'bold',
                fontSize: 8,
                halign: 'left',
            },
            columnStyles: {
                0: { cellWidth: 32, textColor: [100, 116, 139], fontSize: 7.5 }, // Date
                1: { cellWidth: 28, fontStyle: 'bold', fontSize: 8 }, // Type
                2: { cellWidth: 55 }, // Title
                3: { cellWidth: 'auto', textColor: [100, 116, 139], fontSize: 7.5 }, // Details
            },
            didParseCell: (data: any) => {
                // Color-code the "Type" column
                if (data.section === 'body' && data.column.index === 1) {
                    const log = activityLogs[data.row.index];
                    if (log) {
                        const hex = getActivityColor(log.action_type);
                        const r = parseInt(hex.slice(1, 3), 16);
                        const g = parseInt(hex.slice(3, 5), 16);
                        const b = parseInt(hex.slice(5, 7), 16);
                        data.cell.styles.textColor = [r, g, b];
                    }
                }
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252], // slate-50
            },
            margin: { left: 14, right: 14 },
        });

        // -- Footer on every page --
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            const pageHeight = doc.internal.pageSize.getHeight();
            doc.setFontSize(7);
            doc.setTextColor(148, 163, 184);
            doc.text('Client Portal - Activity Log', 14, pageHeight - 8);
            doc.text('Page ' + i + ' of ' + pageCount, pageWidth - 14, pageHeight - 8, { align: 'right' });
        }

        // -- Save --
        const safeName = sanitize(client?.name || 'client').toLowerCase().replace(/\s+/g, '-');
        const filename = 'activity-log-' + safeName + '-' + new Date().toISOString().slice(0, 10) + '.pdf';
        doc.save(filename);
    };

    // Helper: format relative time
    const getRelativeTime = (dateStr: string) => {
        const now = new Date();
        const date = new Date(dateStr);
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    if (loading && !client) return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center animate-fade-in">
            <div className="flex items-center gap-2 mb-6">
                <span className="w-3 h-3 rounded-full bg-blue-500 loader-dot"></span>
                <span className="w-3 h-3 rounded-full bg-blue-500 loader-dot"></span>
                <span className="w-3 h-3 rounded-full bg-blue-500 loader-dot"></span>
            </div>
            <p className="text-slate-500 text-sm font-medium">Loading your dashboard...</p>
        </div>
    );

    if (error && !loading) return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
            <div className="bg-red-50 text-red-600 p-6 rounded-2xl max-w-md text-center border border-red-100 mb-6">
                <AlertCircle className="mx-auto mb-3" size={32} />
                <h2 className="text-lg font-bold mb-2">Unable to Load Dashboard</h2>
                <p className="text-sm opacity-90">{error}</p>
            </div>
            <button
                onClick={() => window.location.reload()}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors"
            >
                Retry
            </button>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-10 px-6 py-4 flex justify-between items-center">
                <Link href="/" className="flex items-center gap-3 group">
                    <div className="bg-blue-100/50 p-1 rounded-xl text-blue-600 transition-colors group-hover:bg-blue-100">
                        <img
                            src="https://raw.githubusercontent.com/raisun0405/Mescellanious/main/Spiderman%20listening%20to%20music.jpeg"
                            alt="Logo"
                            className="w-8 h-8 object-cover rounded-lg"
                        />
                    </div>
                    <h1 className="font-semibold text-slate-800 transition-colors group-hover:text-blue-600">Projects Overview</h1>
                </Link>
                <div className="flex items-center gap-4">
                    <span className="text-sm text-slate-500 hidden sm:block">Welcome, <span className="font-medium text-slate-900">{client?.name}</span></span>
                    <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors" title="Sign Out">
                        <LogOut size={20} />
                    </button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto p-6 md:p-10">
                <div className="mb-6 sm:mb-8">
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h2>
                    <p className="text-sm text-slate-500 mt-1">Overview of all your projects & financials.</p>
                </div>

                {/* Skeleton Loading State */}
                {loading && projects.length === 0 && (
                    <div className="animate-fade-in">
                        {/* Skeleton Stat Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-sm">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="skeleton w-8 h-8 rounded-lg" />
                                        <div className="skeleton h-3 w-16 rounded-md" />
                                    </div>
                                    <div className="skeleton h-7 w-24 rounded-lg" />
                                </div>
                            ))}
                        </div>

                        {/* Skeleton Charts Row */}
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6 mb-10">
                            {/* Skeleton Donut Chart */}
                            <div className="lg:col-span-2 bg-white rounded-2xl p-5 sm:p-6 border border-slate-100 shadow-sm">
                                <div className="skeleton h-3 w-32 rounded-md mb-2" />
                                <div className="skeleton h-2.5 w-48 rounded-md mb-6" />
                                <div className="flex items-center justify-center py-4">
                                    <div className="skeleton w-[160px] h-[160px] rounded-full" style={{ background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite' }} />
                                </div>
                                <div className="flex justify-center gap-6 mt-4">
                                    <div className="flex items-center gap-2">
                                        <div className="skeleton w-2.5 h-2.5 rounded-full" />
                                        <div className="skeleton h-3 w-10 rounded-md" />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="skeleton w-2.5 h-2.5 rounded-full" />
                                        <div className="skeleton h-3 w-14 rounded-md" />
                                    </div>
                                </div>
                            </div>

                            {/* Skeleton Activity Log */}
                            <div className="lg:col-span-3 bg-white rounded-2xl p-5 sm:p-6 border border-slate-100 shadow-sm">
                                <div className="skeleton h-3 w-24 rounded-md mb-2" />
                                <div className="skeleton h-2.5 w-56 rounded-md mb-6" />
                                <div className="space-y-4">
                                    {[...Array(4)].map((_, i) => (
                                        <div key={i} className="flex items-start gap-3">
                                            <div className="skeleton w-[30px] h-[30px] rounded-full shrink-0" />
                                            <div className="flex-1 space-y-1.5">
                                                <div className="flex items-center gap-2">
                                                    <div className="skeleton h-3 w-16 rounded-md" />
                                                    <div className="skeleton h-2.5 w-10 rounded-md" />
                                                </div>
                                                <div className="skeleton h-3 w-3/4 rounded-md" />
                                                <div className="skeleton h-2.5 w-1/2 rounded-md" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Skeleton Progress Bar */}
                        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-100 shadow-sm mb-10">
                            <div className="flex justify-between mb-3">
                                <div className="skeleton h-3 w-28 rounded-md" />
                                <div className="skeleton h-3 w-12 rounded-md" />
                            </div>
                            <div className="skeleton h-4 w-full rounded-full" />
                        </div>

                        {/* Skeleton Project Cards */}
                        <div className="mb-6">
                            <div className="skeleton h-5 w-32 rounded-md mb-2" />
                            <div className="skeleton h-3 w-64 rounded-md" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {[...Array(3)].map((_, i) => (
                                <div key={i} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                                    <div className="skeleton h-5 w-20 rounded-full mb-4" />
                                    <div className="skeleton h-5 w-3/4 rounded-md mb-2" />
                                    <div className="skeleton h-3 w-1/2 rounded-md mb-4" />
                                    <div className="skeleton h-2 w-full rounded-full mb-4" />
                                    <div className="border border-slate-100 rounded-lg overflow-hidden">
                                        <div className="skeleton h-8 w-full rounded-none" />
                                        <div className="skeleton h-8 w-full rounded-none" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {projects.length === 0 && !loading ? (
                    <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-300">
                        <p className="text-slate-400">No projects found for this account.</p>
                    </div>
                ) : !loading && (
                    <>
                        {/* ========== ANALYTICS DASHBOARD ========== */}
                        {projects.length > 0 && (() => {
                            // Compute aggregate stats
                            const totalInvestment = projects.reduce((s, p) => s + p.stats.total, 0);
                            const totalPaid = projects.reduce((s, p) => s + p.stats.paid, 0);
                            const totalPending = projects.reduce((s, p) => s + p.stats.pending, 0);
                            const completedProjects = projects.filter(p => p.status === 'Completed').length;
                            const activeProjects = projects.filter(p => p.status !== 'Completed').length;
                            const avgProgress = projects.length > 0 ? Math.round(projects.reduce((s, p) => s + p.stats.progress, 0) / projects.length) : 0;
                            const paymentPercent = totalInvestment > 0 ? Math.round((totalPaid / totalInvestment) * 100) : 0;

                            // Donut chart data
                            const paymentDonutData = [
                                { name: 'Paid', value: totalPaid },
                                { name: 'Pending', value: totalPending },
                            ];
                            const DONUT_COLORS = ['#10b981', '#f59e0b'];

                            return (
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.5 }}
                                    className="mb-10"
                                >
                                    {/* Summary Stat Cards */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
                                        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="p-1.5 bg-blue-50 rounded-lg"><Wallet size={14} className="text-blue-600" /></div>
                                                <span className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Value</span>
                                            </div>
                                            <p className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight">₹{totalInvestment.toLocaleString()}</p>
                                        </div>
                                        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="p-1.5 bg-emerald-50 rounded-lg"><TrendingUp size={14} className="text-emerald-600" /></div>
                                                <span className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider">Paid</span>
                                            </div>
                                            <p className="text-lg sm:text-2xl font-bold text-emerald-600 tracking-tight">₹{totalPaid.toLocaleString()}</p>
                                        </div>
                                        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="p-1.5 bg-amber-50 rounded-lg"><Clock size={14} className="text-amber-600" /></div>
                                                <span className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider">Pending</span>
                                            </div>
                                            <p className="text-lg sm:text-2xl font-bold text-amber-600 tracking-tight">₹{totalPending.toLocaleString()}</p>
                                        </div>
                                        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="p-1.5 bg-violet-50 rounded-lg"><CheckCircle2 size={14} className="text-violet-600" /></div>
                                                <span className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider">Projects</span>
                                            </div>
                                            <p className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight">
                                                {completedProjects}<span className="text-slate-400 text-sm font-normal">/{projects.length}</span>
                                                <span className="text-xs sm:text-sm font-normal text-slate-400 ml-1">done</span>
                                            </p>
                                        </div>
                                    </div>

                                    {/* Charts Row */}
                                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
                                        {/* Donut Chart - Payment Overview */}
                                        <div className="lg:col-span-2 bg-white rounded-2xl p-5 sm:p-6 border border-slate-100 shadow-sm">
                                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Payment Overview</h3>
                                            <p className="text-[11px] text-slate-400 mb-4">{paymentPercent}% of total value has been paid</p>
                                            <div className="relative" style={{ overflow: 'visible' }}>
                                                <ResponsiveContainer width="100%" height={220} style={{ overflow: 'visible' }}>
                                                    <PieChart style={{ overflow: 'visible' }}>
                                                        <Pie
                                                            data={paymentDonutData.filter(d => d.value > 0)}
                                                            cx="50%"
                                                            cy="50%"
                                                            innerRadius={55}
                                                            outerRadius={80}
                                                            paddingAngle={totalPaid > 0 && totalPending > 0 ? 4 : 0}
                                                            dataKey="value"
                                                            stroke="none"
                                                            startAngle={90}
                                                            endAngle={-270}
                                                            {...{ activeIndex: activeDonutIndex !== null ? activeDonutIndex : undefined } as any}
                                                            activeShape={(props: any) => {
                                                                const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, value } = props;
                                                                const RADIAN = Math.PI / 180;
                                                                const midAngle = (startAngle + endAngle) / 2;
                                                                const sin = Math.sin(-RADIAN * midAngle);
                                                                const cos = Math.cos(-RADIAN * midAngle);
                                                                const mx = cx + (outerRadius + 16) * cos;
                                                                const my = cy + (outerRadius + 16) * sin;
                                                                const ex = cx + (outerRadius + 32) * cos;
                                                                const ey = cy + (outerRadius + 32) * sin;
                                                                const textAnchor = cos >= 0 ? 'start' : 'end';

                                                                return (
                                                                    <g>
                                                                        <Sector
                                                                            cx={cx} cy={cy}
                                                                            innerRadius={innerRadius - 3}
                                                                            outerRadius={outerRadius + 6}
                                                                            startAngle={startAngle}
                                                                            endAngle={endAngle}
                                                                            fill={fill}
                                                                            opacity={0.95}
                                                                        />
                                                                        <Sector
                                                                            cx={cx} cy={cy}
                                                                            innerRadius={outerRadius + 8}
                                                                            outerRadius={outerRadius + 11}
                                                                            startAngle={startAngle}
                                                                            endAngle={endAngle}
                                                                            fill={fill}
                                                                            opacity={0.3}
                                                                        />
                                                                        <line x1={mx} y1={my} x2={ex} y2={ey} stroke={fill} strokeWidth={1.5} />
                                                                        <circle cx={ex} cy={ey} r={2.5} fill={fill} />
                                                                        <text x={ex + (cos >= 0 ? 6 : -6)} y={ey - 7} textAnchor={textAnchor} fill="#334155" fontSize={11} fontWeight={700}>
                                                                            {payload.name}
                                                                        </text>
                                                                        <text x={ex + (cos >= 0 ? 6 : -6)} y={ey + 7} textAnchor={textAnchor} fill="#64748b" fontSize={10} fontWeight={600}>
                                                                            {`Rs.${Number(value).toLocaleString()}`}
                                                                        </text>
                                                                    </g>
                                                                );
                                                            }}
                                                            onMouseEnter={(_, index) => setActiveDonutIndex(index)}
                                                            onMouseLeave={() => setActiveDonutIndex(null)}
                                                        >
                                                            {paymentDonutData.map((entry, index) => (
                                                                entry.value > 0 ? <Cell key={`cell-${index}`} fill={DONUT_COLORS[index]} /> : null
                                                            ))}
                                                        </Pie>
                                                    </PieChart>
                                                </ResponsiveContainer>
                                                {/* Center label */}
                                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ zIndex: 1 }}>
                                                    <span className="text-2xl font-black text-slate-900">{paymentPercent}%</span>
                                                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Paid</span>
                                                </div>
                                            </div>
                                            {/* Legend */}
                                            <div className="flex justify-center gap-6 mt-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                                    <span className="text-xs text-slate-600 font-medium">Paid</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                                                    <span className="text-xs text-slate-600 font-medium">Pending</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Activity Log Timeline */}
                                        <div className="lg:col-span-3 bg-white rounded-2xl p-5 sm:p-6 border border-slate-100 shadow-sm">
                                            <div className="flex items-center justify-between mb-4">
                                                <div>
                                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Activity Log</h3>
                                                    <p className="text-[11px] text-slate-400">Recent changes and updates across your projects</p>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        onClick={downloadActivityPDF}
                                                        disabled={activityLogs.length === 0 || loadingLogs}
                                                        className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed group/dl"
                                                        title="Download activity log as PDF"
                                                    >
                                                        <Download size={13} className="text-slate-400 group-hover/dl:text-slate-600 transition-colors" />
                                                    </button>
                                                    <div className="p-1.5 bg-violet-50 rounded-lg">
                                                        <Activity size={14} className="text-violet-500" />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="overflow-y-auto max-h-[260px] custom-scrollbar pr-1">
                                                {loadingLogs ? (
                                                    <div className="flex flex-col items-center justify-center py-10">
                                                        <Loader2 className="animate-spin text-slate-300 mb-2" size={24} />
                                                        <p className="text-xs text-slate-400">Loading activity...</p>
                                                    </div>
                                                ) : activityLogs.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-10 text-center">
                                                        <div className="p-3 bg-slate-50 rounded-full mb-3">
                                                            <Activity size={20} className="text-slate-300" />
                                                        </div>
                                                        <p className="text-sm text-slate-400 font-medium">No activity yet</p>
                                                        <p className="text-xs text-slate-300 mt-1">Changes will appear here as they happen</p>
                                                    </div>
                                                ) : (
                                                    <div className="relative">
                                                        {/* Timeline line */}
                                                        <div className="absolute left-[19px] top-[25px] bottom-[25px] w-px bg-gradient-to-b from-slate-200 via-slate-200 to-transparent" />

                                                        <div className="space-y-0.5">
                                                            {activityLogs.map((log, idx) => {
                                                                const meta = getActivityMeta(log.action_type);
                                                                return (
                                                                    <motion.div
                                                                        key={log.id}
                                                                        initial={{ opacity: 0, x: -10 }}
                                                                        animate={{ opacity: 1, x: 0 }}
                                                                        transition={{ delay: idx * 0.04, duration: 0.3 }}
                                                                        className="relative flex items-start gap-3 py-2.5 px-1 rounded-lg hover:bg-slate-50/80 transition-colors group"
                                                                    >
                                                                        {/* Icon dot */}
                                                                        <div className={`relative z-10 shrink-0 w-[30px] h-[30px] rounded-full ${meta.color} flex items-center justify-center text-white shadow-sm ring-2 ring-white`}>
                                                                            {meta.icon}
                                                                        </div>

                                                                        {/* Content */}
                                                                        <div className="flex-1 min-w-0 pt-0.5">
                                                                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                                                                <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.textColor} ${meta.bgLight} px-1.5 py-0.5 rounded`}>
                                                                                    {meta.label}
                                                                                </span>

                                                                                {/* ₹ Amount Badge for payment/amount logs */}
                                                                                {log.action_type === 'payment_received' && log.metadata?.paidAmount && (
                                                                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                                                                        ₹{Number(log.metadata.paidAmount - (log.metadata.oldPaidAmount || 0)).toLocaleString()}
                                                                                    </span>
                                                                                )}
                                                                                {log.action_type === 'feature_added' && log.metadata?.amount > 0 && (
                                                                                    <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                                                                                        ₹{Number(log.metadata.amount).toLocaleString()}
                                                                                    </span>
                                                                                )}
                                                                                {log.action_type === 'feature_updated' && log.metadata?.oldAmount !== undefined && log.metadata?.amount !== log.metadata?.oldAmount && (
                                                                                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                                                                        ₹{Number(log.metadata.oldAmount).toLocaleString()} → ₹{Number(log.metadata.amount).toLocaleString()}
                                                                                    </span>
                                                                                )}
                                                                                {log.action_type === 'rate_confirmed' && log.metadata?.amount > 0 && (
                                                                                    <span className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                                                                                        ₹{Number(log.metadata.amount).toLocaleString()}
                                                                                    </span>
                                                                                )}

                                                                                <span className="text-[10px] text-slate-500 font-semibold">
                                                                                    {getRelativeTime(log.created_at)}
                                                                                </span>
                                                                            </div>
                                                                            <p className="text-xs font-semibold text-slate-800 leading-snug">{log.title}</p>
                                                                            {log.description && (
                                                                                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed truncate">
                                                                                    {log.description}
                                                                                </p>
                                                                            )}

                                                                            {/* Visual Diff for object changes */}
                                                                            {log.metadata?.changes && Object.keys(log.metadata.changes).length > 0 && (
                                                                                <div className="mt-1.5 space-y-1 bg-slate-50 border border-slate-100 rounded-lg p-2">
                                                                                    {Object.entries(log.metadata.changes).map(([key, diff]: [string, any], i) => (
                                                                                        <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono">
                                                                                            <span className="text-slate-500 font-semibold">{key}:</span>
                                                                                            <span className="text-slate-400 line-through decoration-red-300/60">{diff.old || 'none'}</span>
                                                                                            <ArrowRight size={10} className="text-slate-300" />
                                                                                            <span className="text-emerald-600 font-bold bg-emerald-50 px-1 rounded">{diff.new}</span>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}

                                                                            {/* Payment progress mini bar */}
                                                                            {log.action_type === 'payment_received' && log.metadata?.amount > 0 && (
                                                                                <div className="mt-1.5 flex items-center gap-2">
                                                                                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[120px]">
                                                                                        <div
                                                                                            className="h-full bg-emerald-400 rounded-full transition-all"
                                                                                            style={{ width: `${Math.min((Number(log.metadata.paidAmount) / Number(log.metadata.amount)) * 100, 100)}%` }}
                                                                                        />
                                                                                    </div>
                                                                                    <span className="text-[9px] text-slate-400 font-mono">
                                                                                        ₹{Number(log.metadata.paidAmount).toLocaleString()}/{Number(log.metadata.amount).toLocaleString()}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </motion.div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Overall Progress Bar */}
                                    <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-100 shadow-sm mt-4 sm:mt-6">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                                            <div>
                                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Overall Progress</h3>
                                                <p className="text-[11px] text-slate-400 mt-0.5">Average completion across all projects</p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-2xl font-black text-slate-900">{avgProgress}%</span>
                                                <div className="text-right hidden sm:block">
                                                    <p className="text-[11px] text-emerald-600 font-bold">{completedProjects} completed</p>
                                                    <p className="text-[11px] text-blue-600 font-medium">{activeProjects} in progress</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="relative h-4 w-full bg-slate-100 rounded-full overflow-hidden ring-1 ring-slate-200/50">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${avgProgress}%` }}
                                                transition={{ duration: 1.2, ease: 'easeOut' }}
                                                className={`absolute inset-y-0 left-0 rounded-full ${avgProgress === 100 ? 'bg-linear-to-r from-emerald-500 to-emerald-400' : 'bg-linear-to-r from-blue-600 to-blue-400'}`}
                                            />
                                            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.15)_50%,transparent_100%)]" />
                                        </div>
                                        {/* Mobile summary */}
                                        <div className="flex justify-between mt-2 sm:hidden text-[11px]">
                                            <span className="text-emerald-600 font-bold">{completedProjects} completed</span>
                                            <span className="text-blue-600 font-medium">{activeProjects} in progress</span>
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })()}

                        {/* ========== PROJECTS HEADING ========== */}
                        <div className="mb-6">
                            <h3 className="text-lg font-bold text-slate-900 tracking-tight">Your Projects</h3>
                            <p className="text-sm text-slate-500 mt-0.5">Select a project to view detailed status and feature requests.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {projects.map((project, idx) => (
                                <motion.div
                                    key={project.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.1 }}
                                    onClick={() => handleProjectClick(project)}
                                    className="group bg-white rounded-2xl p-6 shadow-sm hover:shadow-xl hover:shadow-blue-900/5 border border-slate-100 hover:border-blue-100 transition-all cursor-pointer relative overflow-hidden"
                                >
                                    <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <FolderOpen size={20} className="text-blue-400" />
                                    </div>

                                    <div className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 mb-4">
                                        {project.category}
                                    </div>

                                    <h3 className="text-lg font-semibold text-slate-900 mb-2 leading-snug">{project.description}</h3>

                                    <div className="flex items-center gap-3 mb-4">
                                        <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${project.status === 'Completed' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                                            }`}>
                                            {project.status}
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                                            <Calendar size={12} />
                                            {new Date(project.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </span>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="mb-5">
                                        <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                                            <span className="font-medium">Completion</span>
                                            <span className="font-bold text-slate-700">{project.stats.progress}%</span>
                                        </div>
                                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500 rounded-full transition-all duration-700 ease-out"
                                                style={{ width: `${project.stats.progress}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* Financial Table */}
                                    <div className="border border-slate-100 rounded-lg overflow-hidden">
                                        <table className="w-full text-center text-xs">
                                            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                                                <tr>
                                                    <th className="py-2 border-r border-slate-100">Total</th>
                                                    <th className="py-2 border-r border-slate-100">Paid</th>
                                                    <th className="py-2">Pending</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white text-slate-900 font-semibold">
                                                <tr>
                                                    <td className="py-2 border-r border-slate-100">₹{project.stats.total}</td>
                                                    <td className="py-2 border-r border-slate-100 text-green-600">₹{project.stats.paid}</td>
                                                    <td className="py-2 text-amber-600">₹{project.stats.pending}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </>
                )}
            </main>

            {/* Detail Modal / Overlay */}
            {selectedProject && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={closeModal} />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col relative z-50 overflow-hidden ring-1 ring-black/5"
                    >
                        {/* Modal Header */}
                        <div className="px-5 py-5 sm:px-8 sm:py-6 border-b border-slate-100 bg-white/50 backdrop-blur-xl sticky top-0 z-10 flex justify-between items-start gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-3">
                                    <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] sm:text-xs font-bold tracking-wide uppercase border border-blue-100 whitespace-nowrap">
                                        {selectedProject.category}
                                    </span>
                                    <span className={`px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-bold tracking-wide uppercase border whitespace-nowrap ${selectedProject.status === 'Completed' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'
                                        }`}>
                                        {selectedProject.status}
                                    </span>
                                </div>
                                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight leading-tight wrap-break-word">{selectedProject.description}</h2>
                                <p className="text-slate-400 text-xs sm:text-sm mt-1.5 font-medium flex items-center gap-1.5">
                                    <Calendar size={14} className="shrink-0" />
                                    Started on {new Date(selectedProject.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                                </p>
                            </div>
                            <button
                                onClick={closeModal}
                                className="shrink-0 p-2 sm:p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-all duration-200"
                            >
                                <X size={20} className="sm:w-6 sm:h-6" />
                            </button>
                        </div>

                        {/* Modal Content - Scrollable */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8 bg-slate-50/50">

                            {/* Top Section: Financials & Links Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 sm:mb-10">
                                {/* Financial Health Card */}
                                <div className="lg:col-span-2 bg-slate-50/50 rounded-3xl p-4 sm:p-6 border border-slate-100">
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Financial Overview</h3>
                                        <div className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-500">
                                            {Math.round((selectedProject.stats.paid / (selectedProject.stats.total || 1)) * 100)}% PAID
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
                                        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-center">
                                            <p className="text-xs font-semibold text-slate-400 sm:mb-2 uppercase tracking-wide">Total Value</p>
                                            <p className="text-xl sm:text-3xl font-bold text-slate-900 tracking-tight">₹{(selectedProject.stats.total || 0).toLocaleString()}</p>
                                        </div>
                                        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-center relative overflow-hidden">
                                            <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-50 rounded-bl-full -mr-8 -mt-8 opacity-50 hidden sm:block" />
                                            <p className="text-xs font-semibold text-emerald-600/80 sm:mb-2 uppercase tracking-wide">Paid Amount</p>
                                            <p className="text-xl sm:text-3xl font-bold text-emerald-600 tracking-tight relative z-10">₹{(selectedProject.stats.paid || 0).toLocaleString()}</p>
                                        </div>
                                        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-center relative overflow-hidden">
                                            <div className="absolute top-0 right-0 w-16 h-16 bg-amber-50 rounded-bl-full -mr-8 -mt-8 opacity-50 hidden sm:block" />
                                            <p className="text-xs font-semibold text-amber-600/80 sm:mb-2 uppercase tracking-wide">Pending</p>
                                            <p className="text-xl sm:text-3xl font-bold text-amber-600 tracking-tight relative z-10">₹{(selectedProject.stats.pending || 0).toLocaleString()}</p>
                                        </div>
                                    </div>

                                    {/* Visual Progress Bar */}
                                    <div className="relative pt-1">
                                        <div className="flex mb-2 items-center justify-between text-xs font-medium text-slate-400">
                                            <span>Progress</span>
                                            <span>{Math.round((selectedProject.stats.paid / (selectedProject.stats.total || 1)) * 100)}% Funded</span>
                                        </div>
                                        <div className="overflow-hidden h-4 text-xs flex rounded-full bg-slate-200/60 ring-1 ring-slate-100">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${(selectedProject.stats.paid / (selectedProject.stats.total || 1)) * 100}%` }}
                                                transition={{ duration: 1, ease: "easeOut" }}
                                                className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-linear-to-r from-emerald-500 to-emerald-400 relative"
                                            >
                                                <div className="absolute inset-0 bg-white/10" />
                                            </motion.div>
                                        </div>
                                    </div>
                                </div>

                                {/* Quick Links Card */}
                                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-[0_2px_20px_rgb(0,0,0,0.02)] flex flex-col">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Quick Access</h3>
                                    <div className="flex-1 flex flex-col gap-3">
                                        {selectedProject.links && selectedProject.links.length > 0 ? (
                                            selectedProject.links.map((link, idx) => (
                                                <a
                                                    key={idx}
                                                    href={link.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center p-3.5 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 hover:shadow-md transition-all group duration-200"
                                                >
                                                    <div className="bg-blue-100 text-blue-600 p-2.5 rounded-lg mr-3 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                                                        <FolderOpen size={18} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="font-semibold text-slate-900 text-sm group-hover:text-blue-700 transition-colors">{link.title}</p>
                                                        <p className="text-xs text-slate-400 truncate w-full group-hover:text-blue-400/80 transition-colors">{link.url.split('//')[1] || link.url}</p>
                                                    </div>
                                                    <ArrowRight size={14} className="ml-auto text-slate-300 group-hover:text-blue-400 group-hover:translate-x-1 transition-all shrink-0" />
                                                </a>
                                            ))
                                        ) : (
                                            <div className="flex-1 flex flex-col items-center justify-center p-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center">
                                                <FolderOpen size={24} className="text-slate-300 mb-2" />
                                                <p className="text-slate-400 text-xs font-medium">No links available</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Features Section */}
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="px-4 sm:px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white sticky top-0 z-10 w-full">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900">Features & Requests</h3>
                                        <p className="text-sm text-slate-500">Track development progress and costs</p>
                                    </div>

                                    {/* Sorting Pills - Responsive Scrollable */}
                                    {features.length > 1 && (
                                        <div className="flex items-center gap-3 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest whitespace-nowrap">Sort By</span>
                                            <div className="flex bg-slate-100 p-1 rounded-lg">
                                                {(['amount', 'status', 'created_at'] as SortField[]).map((field) => (
                                                    <button
                                                        key={field}
                                                        onClick={() => {
                                                            if (sortField === field) {
                                                                setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                            } else {
                                                                setSortField(field);
                                                                setSortOrder('asc');
                                                            }
                                                        }}
                                                        className={`
                                                            px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 whitespace-nowrap
                                                            ${sortField === field
                                                                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5'
                                                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}
                                                        `}
                                                    >
                                                        {field === 'created_at' ? 'Date' : field.charAt(0).toUpperCase() + field.slice(1)}
                                                        {sortField === field && (
                                                            sortOrder === 'asc' ? <ArrowUp size={10} strokeWidth={3} /> : <ArrowDown size={10} strokeWidth={3} />
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {loadingFeatures ? (
                                    <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
                                ) : (
                                    <>
                                        {/* DESKTOP VIEW - Table */}
                                        <div className="hidden md:block overflow-x-auto">
                                            <table className="w-full text-left text-sm min-w-[800px]">
                                                <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200">
                                                    <tr>
                                                        <th className="px-6 py-4 w-16 text-center">#</th>
                                                        <th className="px-6 py-4 min-w-[200px]">Description</th>
                                                        <th className="px-6 py-4">Date</th>
                                                        <th className="px-6 py-4">Type</th>
                                                        <th className="px-6 py-4">Status</th>
                                                        <th className="px-6 py-4">Cost</th>
                                                        <th className="px-6 py-4 text-right">Payment</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {[...features].sort((a, b) => {
                                                        let comparison = 0;
                                                        if (sortField === 'amount') {
                                                            comparison = (a.amount || 0) - (b.amount || 0);
                                                        } else if (sortField === 'status') {
                                                            const statusOrder = ['Requested', 'Approved', 'Working', 'Updating', 'Completed'];
                                                            comparison = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
                                                        } else if (sortField === 'created_at') {
                                                            comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                                                        }
                                                        return sortOrder === 'asc' ? comparison : -comparison;
                                                    }).map((feature, i) => (
                                                        <tr key={feature.id} className="hover:bg-blue-50/20 transition-colors group">
                                                            <td className="px-6 py-4 text-slate-400 font-mono text-xs text-center border-r border-transparent group-hover:border-blue-100/50">{i + 1}</td>
                                                            <td className="px-6 py-4">
                                                                <p className="font-semibold text-slate-900">{feature.description}</p>
                                                                {feature.estimation && (
                                                                    <p className="text-xs text-slate-500 mt-0.5">EST: {feature.estimation}</p>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="flex flex-col">
                                                                    <span className="font-medium text-slate-700 text-xs">
                                                                        {feature.created_at ? new Date(feature.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}
                                                                    </span>
                                                                    <span className="text-[10px] text-slate-400">
                                                                        {feature.created_at ? new Date(feature.created_at).getFullYear() : ''}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                {feature.is_new_request ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold bg-purple-100 text-purple-700 uppercase tracking-wide border border-purple-200">
                                                                        Extra
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 uppercase tracking-wide border border-slate-200">
                                                                        Core
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${feature.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                                    feature.status === 'Working' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                                        'bg-amber-50 text-amber-700 border-amber-200'
                                                                    }`}>
                                                                    <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${feature.status === 'Completed' ? 'bg-emerald-500' : feature.status === 'Working' ? 'bg-blue-500' : 'bg-amber-500'}`}></span>
                                                                    {feature.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                {feature.payment_confirmed === false ? (
                                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-orange-50 text-orange-600 border border-orange-200">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                                                                        Rate Pending
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-slate-900 font-bold font-mono">₹{(feature.amount || 0).toLocaleString()}</span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                {feature.payment_confirmed === false ? (
                                                                    <span className="text-xs text-slate-400 italic">—</span>
                                                                ) : (
                                                                    <div className="flex flex-col items-end gap-1">
                                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${feature.payment_status === 'Paid' ? 'bg-emerald-100 text-emerald-700' :
                                                                            feature.payment_status === 'Partial' ? 'bg-blue-100 text-blue-700' :
                                                                                'bg-rose-100 text-rose-700'
                                                                            }`}>
                                                                            {feature.payment_status}
                                                                        </span>
                                                                        {(feature.paid_amount || 0) > 0 && feature.payment_status !== 'Paid' && (
                                                                            <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                                                                                <span>Paid:</span>
                                                                                <span className="text-slate-700">₹{feature.paid_amount.toLocaleString()}</span>
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* MOBILE VIEW - Cards */}
                                        <div className="md:hidden p-4 space-y-4">
                                            {[...features].sort((a, b) => {
                                                let comparison = 0;
                                                if (sortField === 'amount') {
                                                    comparison = (a.amount || 0) - (b.amount || 0);
                                                } else if (sortField === 'status') {
                                                    const statusOrder = ['Requested', 'Approved', 'Working', 'Updating', 'Completed'];
                                                    comparison = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
                                                } else if (sortField === 'created_at') {
                                                    comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                                                }
                                                return sortOrder === 'asc' ? comparison : -comparison;
                                            }).map((feature, i) => (
                                                <div key={feature.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-slate-400 font-mono text-xs">#{i + 1}</span>
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${feature.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                                feature.status === 'Working' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                                    'bg-amber-50 text-amber-700 border-amber-200'
                                                                }`}>
                                                                {feature.status}
                                                            </span>
                                                        </div>
                                                        {feature.payment_confirmed === false ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-600 border border-orange-200">
                                                                <span className="w-1 h-1 rounded-full bg-orange-400 animate-pulse" />
                                                                Rate Pending
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-900 font-bold font-mono">₹{(feature.amount || 0).toLocaleString()}</span>
                                                        )}
                                                    </div>

                                                    <h4 className="text-slate-900 font-semibold mb-2">{feature.description}</h4>

                                                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-50 text-xs">
                                                        <div className="space-y-1">
                                                            <p className="text-slate-500">
                                                                {feature.created_at ? new Date(feature.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-'}
                                                            </p>
                                                            {feature.estimation && (
                                                                <p className="text-slate-400">Est: {feature.estimation}</p>
                                                            )}
                                                        </div>
                                                        <div className="text-right">
                                                            {feature.payment_confirmed === false ? (
                                                                <span className="text-xs text-slate-400 italic">—</span>
                                                            ) : (
                                                                <>
                                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider mb-1 ${feature.payment_status === 'Paid' ? 'bg-emerald-100 text-emerald-700' :
                                                                        feature.payment_status === 'Partial' ? 'bg-blue-100 text-blue-700' :
                                                                            'bg-rose-100 text-rose-700'
                                                                        }`}>
                                                                        {feature.payment_status}
                                                                    </span>
                                                                    {(feature.paid_amount || 0) > 0 && feature.payment_status !== 'Paid' && (
                                                                        <p className="text-[10px] text-slate-400 font-mono">Pd: ₹{feature.paid_amount}</p>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {features.length === 0 && (
                                                <div className="text-center py-8 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                                    <p className="text-sm">No features to display (Mobile)</p>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
