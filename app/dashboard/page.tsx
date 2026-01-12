'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { LayoutGrid, LogOut, FolderOpen, Loader2, X } from 'lucide-react';
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
    status: string;
    payment_status: string;
    is_new_request: boolean;
};

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
    const [selectedProject, setSelectedProject] = useState<ProjectWithStats | null>(null);
    const [features, setFeatures] = useState<Feature[]>([]);
    const [loadingFeatures, setLoadingFeatures] = useState(false);

    useEffect(() => {
        // Check for authenticated client
        const storedClient = localStorage.getItem('portal_client');
        if (!storedClient) {
            router.push('/');
            return;
        }
        const parsedClient = JSON.parse(storedClient);
        setClient(parsedClient);
        fetchProjects(parsedClient.id);
    }, [router]);

    const fetchProjects = async (clientId: string) => {
        setLoading(true);

        // 1. Fetch all projects for this client
        const { data: projectsData } = await supabase
            .from('projects')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        if (projectsData && projectsData.length > 0) {
            // 2. Fetch ALL features for these projects to calculate stats
            const projectIds = projectsData.map(p => p.id);
            const { data: featuresData } = await supabase
                .from('features')
                .select('*')
                .in('project_id', projectIds);

            // 3. Calculate stats for each project
            const enhancedProjects: ProjectWithStats[] = projectsData.map(project => {
                const projectFeatures = featuresData?.filter(f => f.project_id === project.id) || [];
                const total = projectFeatures.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
                const paid = projectFeatures
                    .filter(f => f.payment_status === 'Paid')
                    .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

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
        setLoading(false);
    };

    const fetchFeatures = async (projectId: string) => {
        setLoadingFeatures(true);
        const { data } = await supabase
            .from('features')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: true });

        if (data) setFeatures(data);
        setLoadingFeatures(false);
    };

    const handleProjectClick = async (project: ProjectWithStats) => {
        setSelectedProject(project);
        await fetchFeatures(project.id);
    };

    const closeModal = () => {
        setSelectedProject(null);
        setFeatures([]);
    };

    const handleLogout = () => {
        localStorage.removeItem('portal_client');
        router.push('/');
    };

    if (loading && !client) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={32} /></div>;

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-10 px-6 py-4 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="bg-blue-100/50 p-2 rounded-xl text-blue-600">
                        <LayoutGrid size={20} />
                    </div>
                    <h1 className="font-semibold text-slate-800">Projects Overview</h1>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-sm text-slate-500 hidden sm:block">Welcome, <span className="font-medium text-slate-900">{client?.name}</span></span>
                    <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors">
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

                                <div className="mb-4">
                                    <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${project.status === 'Completed' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                                        }`}>
                                        {project.status}
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
                    <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={closeModal} />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col relative z-50"
                    >
                        {/* Modal Header */}
                        <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
                            <div className="flex-1 min-w-0 pr-2">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                    <span className="px-2.5 py-0.5 rounded-md bg-blue-100 text-blue-700 text-xs font-bold tracking-wide uppercase">
                                        {selectedProject.category}
                                    </span>
                                    <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold tracking-wide uppercase ${selectedProject.status === 'Completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                                        }`}>
                                        {selectedProject.status}
                                    </span>
                                </div>
                                <h2 className="text-lg sm:text-2xl font-bold text-slate-900 break-words">{selectedProject.description}</h2>
                            </div>
                            <button onClick={closeModal} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500 flex-shrink-0">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-4 sm:p-8 overflow-y-auto">
                            {/* Project Financial Summary */}
                            <div className="mb-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Links Section */}
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest mb-4">Quick Links</h3>
                                    {selectedProject.links && selectedProject.links.length > 0 ? (
                                        <div className="grid grid-cols-1 gap-3">
                                            {selectedProject.links.map((link, idx) => (
                                                <a
                                                    key={idx}
                                                    href={link.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 transition-all group"
                                                >
                                                    <div className="bg-blue-100 text-blue-600 p-2 rounded-lg mr-3 group-hover:bg-blue-200 transition-colors">
                                                        <FolderOpen size={18} />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-slate-900 text-sm">{link.title}</p>
                                                        <p className="text-xs text-slate-400 truncate max-w-[200px]">{link.url}</p>
                                                    </div>
                                                </a>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="p-4 rounded-lg bg-slate-50 border border-slate-100 text-center text-slate-400 text-sm">
                                            No specific links added.
                                        </div>
                                    )}
                                </div>

                                {/* Financials Section */}
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest mb-4">Financial Summary</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 col-span-2">
                                            <p className="text-xs text-slate-500 mb-1">Total Amount</p>
                                            <p className="font-bold text-2xl text-slate-900">₹{selectedProject.stats.total}</p>
                                        </div>
                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                            <p className="text-xs text-slate-500 mb-1">Paid</p>
                                            <p className="font-bold text-xl text-green-600">₹{selectedProject.stats.paid}</p>
                                        </div>
                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                            <p className="text-xs text-slate-500 mb-1">Pending</p>
                                            <p className="font-bold text-xl text-amber-600">₹{selectedProject.stats.pending}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Features Table */}
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest mb-4">Features & Requests</h3>
                                {loadingFeatures ? (
                                    <div className="flex justify-center py-10"><Loader2 className="animate-spin text-blue-500" /></div>
                                ) : (
                                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                                        <table className="w-full text-left text-sm min-w-[700px]">
                                            <thead className="bg-slate-50 text-slate-500 font-medium">
                                                <tr>
                                                    <th className="px-6 py-4">#</th>
                                                    <th className="px-6 py-4">Description</th>
                                                    <th className="px-6 py-4">Estimation</th>
                                                    <th className="px-6 py-4">Amount</th>
                                                    <th className="px-6 py-4">Type</th>
                                                    <th className="px-6 py-4">Status</th>
                                                    <th className="px-6 py-4">Payment</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {features.map((feature, i) => (
                                                    <tr key={feature.id} className="hover:bg-slate-50/50 transition-colors">
                                                        <td className="px-6 py-4 text-slate-400 font-mono text-xs">{i + 1}</td>
                                                        <td className="px-6 py-4 text-slate-900 font-medium">{feature.description}</td>
                                                        <td className="px-6 py-4 text-slate-600">{feature.estimation || '-'}</td>
                                                        <td className="px-6 py-4 text-slate-900 font-semibold">₹{feature.amount || 0}</td>
                                                        <td className="px-6 py-4">
                                                            {feature.is_new_request ? (
                                                                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-purple-50 text-purple-700">Extra</span>
                                                            ) : (
                                                                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-indigo-50 text-indigo-700">Core</span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${feature.status === 'Completed' ? 'bg-green-50 text-green-700' :
                                                                feature.status === 'Working' ? 'bg-blue-50 text-blue-700' :
                                                                    'bg-amber-50 text-amber-700'
                                                                }`}>
                                                                {feature.status}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${feature.payment_status === 'Paid' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                                                                }`}>
                                                                {feature.payment_status}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {features.length === 0 && (
                                                    <tr>
                                                        <td colSpan={7} className="px-6 py-8 text-center text-slate-400">No features logged yet.</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
