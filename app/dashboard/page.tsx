'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getClientSession, logoutClient } from '../actions'; // Import server actions
import { LayoutGrid, LogOut, FolderOpen, Loader2, X, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, Calendar, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

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
                    const total = projectFeatures.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
                    const paid = projectFeatures.reduce((sum, f) => sum + (Number(f.paid_amount) || 0), 0);

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
        await logoutClient();
        router.push('/');
    };

    if (loading && !client) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={32} /></div>;

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
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Your Portfolio</h2>
                    <p className="text-slate-500 mt-1">Select a project to view detailed status and requests.</p>
                </div>

                {projects.length === 0 && !loading ? (
                    <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-300">
                        <p className="text-slate-400">No projects found for this account.</p>
                    </div>
                ) : (
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
                                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight leading-tight break-words">{selectedProject.description}</h2>
                                <p className="text-slate-400 text-xs sm:text-sm mt-1.5 font-medium flex items-center gap-1.5">
                                    <Calendar size={14} className="flex-shrink-0" />
                                    Started on {new Date(selectedProject.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                                </p>
                            </div>
                            <button
                                onClick={closeModal}
                                className="flex-shrink-0 p-2 sm:p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-all duration-200"
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
                                            {selectedProject.stats.progress}% PAID
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
                                                className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-emerald-500 to-emerald-400 relative"
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
                                                    <ArrowRight size={14} className="ml-auto text-slate-300 group-hover:text-blue-400 group-hover:translate-x-1 transition-all flex-shrink-0" />
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
                                                            <td className="px-6 py-4 text-slate-900 font-bold font-mono">₹{(feature.amount || 0).toLocaleString()}</td>
                                                            <td className="px-6 py-4 text-right">
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
                                                        <span className="text-slate-900 font-bold font-mono">₹{(feature.amount || 0).toLocaleString()}</span>
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
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider mb-1 ${feature.payment_status === 'Paid' ? 'bg-emerald-100 text-emerald-700' :
                                                                feature.payment_status === 'Partial' ? 'bg-blue-100 text-blue-700' :
                                                                    'bg-rose-100 text-rose-700'
                                                                }`}>
                                                                {feature.payment_status}
                                                            </span>
                                                            {(feature.paid_amount || 0) > 0 && feature.payment_status !== 'Paid' && (
                                                                <p className="text-[10px] text-slate-400 font-mono">Pd: ₹{feature.paid_amount}</p>
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
