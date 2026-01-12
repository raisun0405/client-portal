'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Users, Plus, FolderPlus, Trash2, ArrowLeft, X, Loader2, Pencil, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Types ---
// --- Types ---
type Client = {
    id: string;
    name: string;
    access_key: string;
    created_at: string;
};

type Project = {
    id: string;
    client_id: string;
    category: string;
    description: string;
    status: string;
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

export default function AdminDashboard() {
    const router = useRouter();
    const [view, setView] = useState<'clients' | 'projects' | 'features' | 'links'>('clients');

    // Data State
    const [clients, setClients] = useState<Client[]>([]);
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
    const [editingId, setEditingId] = useState<string | null>(null);

    useEffect(() => {
        // Check Supabase Auth Session
        const checkAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                router.push('/admin');
            } else {
                fetchClients();
            }
        };
        checkAuth();
    }, [router]);

    // --- Remote Fetchers ---
    const fetchClients = async () => {
        setLoading(true);
        const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
        if (data) setClients(data);
        setLoading(false);
    };

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
        setLoading(false);
    };

    const fetchFeatures = async (projectId: string) => {
        setLoading(true);
        const { data } = await supabase.from('features').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
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

    const handleBack = () => {
        if (view === 'features' || view === 'links') {
            setView('projects');
            setSelectedProject(null);
            setFeatures([]);
            setLinks([]);
        } else if (view === 'projects') {
            setView('clients');
            setSelectedClient(null);
            setProjects([]);
        }
    };

    // --- Edit Handlers (opens modal with existing data) ---
    const handleEditClient = (client: Client) => {
        setFormData({ name: client.name, access_key: client.access_key });
        setEditingId(client.id);
        setShowModal(true);
    };

    const handleEditProject = (project: ProjectWithStats) => {
        setFormData({ description: project.description, category: project.category, status: project.status });
        setEditingId(project.id);
        setShowModal(true);
    };

    const handleEditFeature = (feature: Feature) => {
        description: feature.description,
            estimation: feature.estimation,
                amount: feature.amount,
                    paid_amount: feature.paid_amount,
                        status: feature.status,
                            payment_status: feature.payment_status,
                                is_new_request: feature.is_new_request ? 'true' : 'false'
    });
    setEditingId(feature.id);
    setShowModal(true);
};

// --- Create/Update Handlers ---
const handleSaveClient = async () => {
    if (editingId) {
        // UPDATE
        const { error } = await supabase.from('clients').update({
            name: formData.name,
            access_key: formData.access_key
        }).eq('id', editingId);
        if (!error) {
            fetchClients();
        } else {
            alert('Error: ' + error.message);
        }
    } else {
        // CREATE
        const { data, error } = await supabase.from('clients').insert([{
            name: formData.name,
            access_key: formData.access_key
        }]).select();
        if (!error && data) {
            setClients([data[0], ...clients]);
        } else {
            alert('Error: ' + error?.message);
        }
    }
    setShowModal(false);
    setFormData({});
    setEditingId(null);
};

const handleSaveProject = async () => {
    if (editingId) {
        // UPDATE
        const { error } = await supabase.from('projects').update({
            category: formData.category,
            description: formData.description,
            status: formData.status
        }).eq('id', editingId);
        if (!error && selectedClient) {
            fetchProjects(selectedClient.id);
        } else {
            alert('Error: ' + error?.message);
        }
    } else {
        // CREATE
        const payload = {
            client_id: selectedClient?.id,
            category: formData.category || 'General',
            description: formData.description || 'New Project',
            status: formData.status || 'In Progress',
            links: []
        };
        const { data, error } = await supabase.from('projects').insert([payload]).select();
        if (!error && data) {
            const newProject: ProjectWithStats = {
                ...data[0],
                stats: { total: 0, paid: 0, pending: 0, progress: 0 }
            };
            setProjects([newProject, ...projects]);
        } else {
            alert('Error: ' + error?.message);
        }
    }
    setShowModal(false);
    setFormData({});
    setEditingId(null);
};

const handleAddLink = async () => {
    if (!selectedProject) return;
    const newLink = { title: formData.link_title, url: formData.link_url };
    const updatedLinks = [...(selectedProject.links || []), newLink];

    const { error } = await supabase
        .from('projects')
        .update({ links: updatedLinks })
        .eq('id', selectedProject.id);

    if (!error) {
        // Update local state
        const updatedProject = { ...selectedProject, links: updatedLinks };
        setSelectedProject(updatedProject);
        setLinks(updatedLinks);

        // Update in projects list
        setProjects(projects.map(p => p.id === selectedProject.id ? updatedProject : p));

        setShowModal(false);
        setFormData({});
    } else {
        alert('Error adding link: ' + error.message);
    }
};

const handleDeleteLink = async (index: number) => {
    if (!selectedProject || !confirm("Delete this link?")) return;
    const updatedLinks = [...(selectedProject.links || [])];
    updatedLinks.splice(index, 1);

    const { error } = await supabase
        .from('projects')
        .update({ links: updatedLinks })
        .eq('id', selectedProject.id);

    if (!error) {
        const updatedProject = { ...selectedProject, links: updatedLinks };
        setSelectedProject(updatedProject);
        setLinks(updatedLinks);
        setProjects(projects.map(p => p.id === selectedProject.id ? updatedProject : p));
    }
};

const handleSaveFeature = async () => {
    const amount = Number(formData.amount) || 0;
    const paidAmount = Number(formData.paid_amount) || 0;

    let paymentStatus = 'Pending';
    if (paidAmount >= amount && amount > 0) paymentStatus = 'Paid';
    else if (paidAmount > 0) paymentStatus = 'Partial';

    const payload = {
        description: formData.description,
        estimation: formData.estimation || '',
        amount: amount,
        paid_amount: paidAmount,
        status: formData.status || 'Requested',
        payment_status: paymentStatus,
        is_new_request: formData.is_new_request === 'true'
    };

    if (editingId) {
        // UPDATE
        const { error } = await supabase.from('features').update(payload).eq('id', editingId);
        if (!error && selectedProject) {
            fetchFeatures(selectedProject.id);
            if (selectedClient) fetchProjects(selectedClient.id); // Refresh stats
        } else {
            alert('Error: ' + error?.message);
        }
    } else {
        // CREATE
        const insertPayload = { ...payload, project_id: selectedProject?.id };
        const { data, error } = await supabase.from('features').insert([insertPayload]).select();
        if (!error && data) {
            setFeatures([...features, data[0]]);
            if (selectedClient) fetchProjects(selectedClient.id);
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
    await supabase.from(table).delete().eq('id', id);

    if (table === 'clients') fetchClients();
    if (table === 'projects' && selectedClient) fetchProjects(selectedClient.id);
    if (table === 'features' && selectedProject) {
        fetchFeatures(selectedProject.id);
        // Also refresh project stats
        if (selectedClient) fetchProjects(selectedClient.id);
    }
};

// Check if payment status field should show
const showPaymentStatus = ['Approved', 'Working', 'Updating', 'Completed'].includes(formData.status);

return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-4">
                {view !== 'clients' && (
                    <button onClick={handleBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                        <ArrowLeft size={20} />
                    </button>
                )}
                <div>
                    <h1 className="font-bold text-lg">Admin Dashboard</h1>
                    <p className="text-xs text-slate-500">
                        {view === 'clients' ? 'Manage Clients' :
                            view === 'projects' ? `Projects for ${selectedClient?.name}` :
                                view === 'links' ? `Links for ${selectedProject?.description}` :
                                    `Features for ${selectedProject?.description?.substring(0, 20)}...`}
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-3">
                <button
                    onClick={() => { setFormData({}); setEditingId(null); setShowModal(true); }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                >
                    <Plus size={16} />
                    {view === 'clients' ? 'Add Client' : view === 'projects' ? 'Add Project' : view === 'links' ? 'Add Link' : 'Add Feature'}
                </button>
                <button
                    onClick={async () => { await supabase.auth.signOut(); router.push('/admin'); }}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Logout"
                >
                    <LogOut size={20} />
                </button>
            </div>
        </header>

        <main className="max-w-5xl mx-auto p-6">
            {loading && <div className="flex justify-center py-10"><Loader2 className="animate-spin text-slate-400" /></div>}

            {/* ========== CLIENTS VIEW ========== */}
            {view === 'clients' && !loading && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {clients.map(client => (
                        <motion.div layout key={client.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
                            <div>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                                        <Users size={20} />
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleEditClient(client)} className="text-slate-400 hover:text-blue-600 p-1">
                                            <Pencil size={14} />
                                        </button>
                                        <button onClick={() => handleDelete(client.id, 'clients')} className="text-slate-300 hover:text-red-500 p-1">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                                <h3 className="font-semibold text-lg">{client.name}</h3>
                                <code className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded mt-2 block w-fit">{client.access_key}</code>
                            </div>
                            <button
                                onClick={() => handleClientSelect(client)}
                                className="mt-6 w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 font-medium rounded-lg text-sm transition-colors"
                            >
                                View Projects
                            </button>
                        </motion.div>
                    ))}
                    {clients.length === 0 && <div className="col-span-full text-center py-10 text-slate-400">No clients yet. Click "Add Client" to create one.</div>}
                </div>
            )}

            {/* ========== PROJECTS VIEW ========== */}
            {view === 'projects' && !loading && (
                <div className="space-y-4">
                    {projects.map(project => (
                        <motion.div layout key={project.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4 group">
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-4">
                                    <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                                        <FolderPlus size={24} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-900">{project.description}</h3>
                                        <div className="flex gap-2 mt-1">
                                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600">{project.category}</span>
                                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${project.status === 'Completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{project.status}</span>
                                        </div>
                                        {/* Progress Bar */}
                                        <div className="mt-3 w-48">
                                            <div className="flex justify-between text-xs text-slate-500 mb-1">
                                                <span>Progress</span>
                                                <span>{project.stats.progress}%</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                                                    style={{ width: `${project.stats.progress}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => handleEditProject(project)} className="text-slate-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity p-2">
                                        <Pencil size={16} />
                                    </button>
                                    <button onClick={() => handleDelete(project.id, 'projects')} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2">
                                        <Trash2 size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleProjectLinksSelect(project)}
                                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                                    >
                                        Links
                                    </button>
                                    <button
                                        onClick={() => handleProjectSelect(project)}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                                    >
                                        Manage Features
                                    </button>
                                </div>
                            </div>

                            {/* Financial Table */}
                            <div className="border border-slate-100 rounded-lg overflow-hidden">
                                <table className="w-full text-center text-xs">
                                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                                        <tr>
                                            <th className="py-2 border-r border-slate-100">Total Payment</th>
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
                    {projects.length === 0 && <div className="text-center py-10 text-slate-400">No projects yet. Click "Add Project" to create one.</div>}
                </div>
            )}

            {/* ========== LINKS VIEW ========== */}
            {view === 'links' && !loading && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {links.map((link, index) => (
                        <div key={index} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                            <div className="overflow-hidden">
                                <h4 className="font-semibold text-slate-900">{link.title}</h4>
                                <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline truncate block">
                                    {link.url}
                                </a>
                            </div>
                            <button onClick={() => handleDeleteLink(index)} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                    {links.length === 0 && <div className="col-span-full text-center py-10 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">No links added. Click "Add Link" to add one.</div>}
                </div>
            )}

            {/* ========== FEATURES VIEW ========== */}
            {view === 'features' && !loading && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                    <table className="w-full text-left text-sm min-w-[700px]">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4">Description</th>
                                <th className="px-6 py-4">Estimation</th>
                                <th className="px-6 py-4">Amount (₹)</th>
                                <th className="px-6 py-4">Type</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Payment</th>
                                <th className="px-6 py-4">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {features.map((feature) => (
                                <tr key={feature.id} className="hover:bg-slate-50/50">
                                    <td className="px-6 py-4 font-medium text-slate-900">{feature.description}</td>
                                    <td className="px-6 py-4 text-slate-600">{feature.estimation || '-'}</td>
                                    <td className="px-6 py-4 text-slate-900 font-semibold">₹{feature.amount || 0}</td>
                                    <td className="px-6 py-4">
                                        {feature.is_new_request ? (
                                            <span className="inline-flex px-2 py-1 rounded text-xs font-medium bg-purple-50 text-purple-700">Extra</span>
                                        ) : (
                                            <span className="inline-flex px-2 py-1 rounded text-xs font-medium bg-indigo-50 text-indigo-700">Core</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${feature.status === 'Completed' ? 'bg-green-50 text-green-700' :
                                            feature.status === 'Working' ? 'bg-blue-50 text-blue-700' :
                                                'bg-amber-50 text-amber-700'
                                            }`}>{feature.status}</span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1 items-start">
                                            <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${feature.payment_status === 'Paid' ? 'bg-green-50 text-green-700' :
                                                feature.payment_status === 'Partial' ? 'bg-blue-50 text-blue-700' :
                                                    'bg-red-50 text-red-700'
                                                }`}>{feature.payment_status}</span>
                                            {(feature.paid_amount || 0) > 0 && (
                                                <span className="text-xs text-slate-500 font-mono">
                                                    ₹{feature.paid_amount} / ₹{feature.amount}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleEditFeature(feature)} className="text-slate-400 hover:text-blue-600 transition-colors">
                                                <Pencil size={16} />
                                            </button>
                                            <button onClick={() => handleDelete(feature.id, 'features')} className="text-slate-400 hover:text-red-500 transition-colors">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {features.length === 0 && <div className="p-8 text-center text-slate-400">No features added yet.</div>}
                </div>
            )}
        </main>

        {/* ========== CREATE MODAL ========== */}
        <AnimatePresence>
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden"
                    >
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-semibold">{editingId ? 'Edit' : 'Add New'} {view === 'clients' ? 'Client' : view === 'projects' ? 'Project' : view === 'links' ? 'Link' : 'Feature'}</h3>
                            <button onClick={() => { setShowModal(false); setEditingId(null); }}><X size={20} className="text-slate-400" /></button>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* ===== CLIENT FORM ===== */}
                            {view === 'clients' && (
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Client Name</label>
                                        <input value={formData.name || ''} placeholder="Enter client name" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, name: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Access Key (Unique ID)</label>
                                        <input value={formData.access_key || ''} placeholder="Enter unique access key" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, access_key: e.target.value })} />
                                    </div>
                                </div>
                            )}

                            {/* ===== PROJECT FORM ===== */}
                            {view === 'projects' && (
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Project Description</label>
                                        <input value={formData.description || ''} placeholder="e.g. Website Redesign" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, description: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                                        <input value={formData.category || ''} placeholder="e.g. Web Development" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, category: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                                        <input value={formData.status || ''} placeholder="e.g. In Progress" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, status: e.target.value })} />
                                    </div>
                                </div>
                            )}

                            {/* ===== LINK FORM ===== */}
                            {view === 'links' && (
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                                        <input placeholder="e.g. Figma Design" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, link_title: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">URL</label>
                                        <input placeholder="https://..." className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, link_url: e.target.value })} />
                                    </div>
                                </div>
                            )}

                            {/* ===== FEATURE FORM ===== */}
                            {view === 'features' && (
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Feature Description</label>
                                        <input value={formData.description || ''} placeholder="e.g. Dark Mode Toggle" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, description: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Estimation (Text)</label>
                                        <input value={formData.estimation || ''} placeholder="e.g. 2 days" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, estimation: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹)</label>
                                        <input value={formData.amount ?? ''} type="number" placeholder="e.g. 5000" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, amount: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Is this an Extra Request?</label>
                                        <select value={formData.is_new_request || 'false'} className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, is_new_request: e.target.value })}>
                                            <option value="false">No (Core Feature)</option>
                                            <option value="true">Yes (Extra Request)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                                        <select
                                            className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                            onChange={e => setFormData({ ...formData, status: e.target.value })}
                                            value={formData.status || 'Requested'}
                                        >
                                            <option value="Requested">Requested</option>
                                            <option value="Approved">Approved</option>
                                            <option value="Working">Working</option>
                                            <option value="Updating">Updating</option>
                                            <option value="Completed">Completed</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Paid Amount (₹)</label>
                                        <input value={formData.paid_amount ?? ''} type="number" placeholder="e.g. 2500" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, paid_amount: e.target.value })} />
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={view === 'clients' ? handleSaveClient : view === 'projects' ? handleSaveProject : view === 'links' ? handleAddLink : handleSaveFeature}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-medium mt-4"
                            >
                                {editingId ? 'Update Record' : 'Save Record'}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    </div>
);
}
