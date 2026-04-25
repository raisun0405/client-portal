'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { logActivity, type ActivityLog } from '@/lib/activityLogger';
import { sendNotification, sendDigestNotification } from '@/lib/notifications';
import { Users, Plus, FolderPlus, Trash2, ArrowLeft, X, Loader2, Pencil, LogOut, ArrowUp, ArrowDown, Calendar, Mail, MailCheck, Send, CheckCircle2, Clock, Zap, CreditCard, FileText, Link2, Activity, RefreshCw, PackagePlus, ArrowRight, EyeOff, Eye, Search, Copy, Check, Briefcase, TrendingUp, Hash, UserPlus, SlidersHorizontal, MoreHorizontal, ArrowUpRight, CircleDashed, Wallet, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';


// --- Types ---
type Client = {
    id: string;
    name: string;
    email: string | null;
    access_key: string;
    created_at: string;
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
        totalFeatures: number;
        completedFeatures: number;
    };
};

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
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingLinkIndex, setEditingLinkIndex] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);

    // Sorting state for features
    const [sortField, setSortField] = useState<SortField>('created_at');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

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
        const [{ data: projectsData }, { data: featuresData }] = await Promise.all([
            supabaseAdmin.from('projects').select('id, client_id, status'),
            supabaseAdmin.from('features').select('project_id, amount, paid_amount, status, payment_confirmed'),
        ]);

        const projectsByClient = new Map<string, { id: string; status: string }[]>();
        (projectsData || []).forEach((p: any) => {
            if (!projectsByClient.has(p.client_id)) projectsByClient.set(p.client_id, []);
            projectsByClient.get(p.client_id)!.push({ id: p.id, status: p.status });
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
                feats.forEach((f: any) => {
                    const isConfirmed = f.payment_confirmed !== false;
                    if (isConfirmed) {
                        totalValue += Number(f.amount) || 0;
                        paidValue += Number(f.paid_amount) || 0;
                    }
                    totalFeatures += 1;
                    if (f.status === 'Completed') completedFeatures += 1;
                });
            });
            const completedProjects = clientProjects.filter(p => p.status === 'Completed').length;
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

    const handleEditProject = (project: ProjectWithStats) => {
        setFormData({ description: project.description, category: project.category, status: project.status });
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
        if (editingId) {
            // UPDATE
            const oldProject = projects.find(p => p.id === editingId);
            const { error } = await supabaseAdmin.from('projects').update({
                category: formData.category,
                description: formData.description,
                status: formData.status
            }).eq('id', editingId);
            if (!error && selectedClient) {
                fetchProjects(selectedClient.id);
                // Log activity
                if (oldProject) {
                    const statusChanged = oldProject.status !== formData.status;
                    const nameChanged = oldProject.description !== formData.description;
                    const categoryChanged = oldProject.category !== formData.category;
                    const isCompleted = formData.status === 'Completed' && oldProject.status !== 'Completed';
                    
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
                    if (statusChanged) {
                        changes.push(`Status: ${oldProject.status} → ${formData.status}`);
                        structuredChanges['Status'] = { old: oldProject.status, new: formData.status };
                    }
                    
                    let actionType: any = 'project_updated';
                    let title = 'Project Updated';
                    let desc = `"${formData.description}" was updated`;
                    
                    if (isCompleted) {
                        actionType = 'project_completed';
                        title = 'Project Completed';
                        desc = `"${formData.description}" was marked as completed`;
                    } else if (nameChanged && !statusChanged && !categoryChanged) {
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
                            status: formData.status,
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
                status: formData.status || 'In Progress',
                links: []
            };
            const { data, error } = await supabaseAdmin.from('projects').insert([payload]).select();
            if (!error && data && selectedClient) {
                const newProject: ProjectWithStats = {
                    ...data[0],
                    stats: { total: 0, paid: 0, pending: 0, progress: 0 }
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

    return (
        <div className="min-h-screen antialiased geist-canvas font-geist bg-[#0a0a0a] text-[#ededed] selection:bg-[#0a72ef]/30">
            {/* Geist + Geist Mono (Vercel design system) for clients view; legacy fonts retained for other views */}
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Inter:wght@400;500;600&family=Outfit:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
                .font-geist { font-family: 'Geist', Arial, system-ui, sans-serif; font-feature-settings: "liga"; }
                .font-geistmono { font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-feature-settings: "liga","tnum"; }
                .font-outfit { font-family: 'Outfit', system-ui, sans-serif; }
                .font-inter { font-family: 'Inter', system-ui, sans-serif; }
                .font-display { font-family: 'Instrument Serif', 'Times New Roman', serif; }
                .font-grotesk { font-family: 'Space Grotesk', system-ui, sans-serif; }
                .font-jbmono { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
                /* Subtle atmospheric gradient at top — barely visible, per DESIGN.md hero gradient principle */
                .geist-canvas {
                    background-image: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(10,114,239,0.07), transparent 60%);
                    background-attachment: fixed;
                }
            `}</style>
            <main className="max-w-7xl p-4 md:p-8 mx-auto">
                {loading && (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="w-2 h-2 rounded-full bg-[#0a72ef] loader-dot"></span>
                            <span className="w-2 h-2 rounded-full bg-[#de1d8d] loader-dot"></span>
                            <span className="w-2 h-2 rounded-full bg-[#ff5b4f] loader-dot"></span>
                        </div>
                        <p className="text-[#737373] text-sm font-medium font-geistmono uppercase tracking-[0.02em]">Loading</p>
                    </div>
                )}

                {/* ========== CLIENTS VIEW ========== */}
                {view === 'clients' && !loading && (() => {
                    // Overall portfolio stats
                    const totalClients = clients.length;
                    const totalProjects = clients.reduce((a, c) => a + c.stats.projectCount, 0);
                    const activeProjects = clients.reduce((a, c) => a + (c.stats.projectCount - c.stats.completedProjects), 0);
                    const totalValue = clients.reduce((a, c) => a + c.stats.totalValue, 0);
                    const totalPaid = clients.reduce((a, c) => a + c.stats.paidValue, 0);
                    const totalPending = Math.max(totalValue - totalPaid, 0);
                    const clientsWithEmail = clients.filter(c => !!c.email).length;
                    const paidPct = totalValue > 0 ? Math.round((totalPaid / totalValue) * 100) : 0;

                    // Filter + sort
                    const q = clientSearch.trim().toLowerCase();
                    let filtered = q
                        ? clients.filter(c =>
                            c.name.toLowerCase().includes(q) ||
                            (c.email || '').toLowerCase().includes(q) ||
                            c.access_key.toLowerCase().includes(q)
                        )
                        : [...clients];
                    filtered.sort((a, b) => {
                        if (clientSort === 'name') return a.name.localeCompare(b.name);
                        if (clientSort === 'projects') return b.stats.projectCount - a.stats.projectCount;
                        if (clientSort === 'value') return b.stats.totalValue - a.stats.totalValue;
                        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                    });

                    const sortLabels: Record<ClientSortField, string> = {
                        recent: 'Recently Added',
                        name: 'Name (A–Z)',
                        projects: 'Most Projects',
                        value: 'Highest Value',
                    };
                    const formatK = (n: number) => n >= 100000 ? `₹${(n / 1000).toFixed(0)}k` : n >= 1000 ? `₹${(n / 1000).toFixed(1)}k` : `₹${n}`;

                    return (
                        <div className="space-y-14 relative">
                            {/* ===== COMMAND BAR ===== */}
                            <header className="flex items-center justify-between gap-3 -mt-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-geistmono text-[12px] font-medium uppercase text-[#a1a1a1] truncate tracking-[0.02em]">
                                        admin <span className="text-[#404040] mx-1">/</span> <span className="text-white">overview</span>
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={async () => { await supabaseAdmin.auth.signOut(); router.push('/admin'); }}
                                        className="h-9 px-3 rounded-md bg-transparent hover:bg-[#181818] text-[#a1a1a1] hover:text-white flex items-center justify-center gap-2 transition-colors text-[13px] font-medium font-geist"
                                        style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        title="Sign out"
                                        aria-label="Sign out"
                                    >
                                        <LogOut size={13} strokeWidth={2} />
                                        <span className="hidden sm:inline">Sign out</span>
                                    </button>
                                    <button
                                        onClick={() => { setFormData({}); setEditingId(null); setEditingLinkIndex(null); setShowModal(true); }}
                                        className="h-9 px-3.5 rounded-md bg-white hover:bg-[#ededed] text-[#0a0a0a] flex items-center justify-center gap-1.5 transition-colors text-[13px] font-medium font-geist"
                                    >
                                        <Plus size={13} strokeWidth={2.5} />
                                        New client
                                    </button>
                                </div>
                            </header>

                            {/* ===== HERO ===== */}
                            <section className="pt-6 pb-2 max-w-3xl">
                                {totalClients === 0 ? (
                                    <>
                                        <h1
                                            className="text-white font-semibold font-geist leading-[0.95]"
                                            style={{ fontSize: 'clamp(44px, 6.6vw, 76px)', letterSpacing: '-0.055em', fontFeatureSettings: '"liga"' }}
                                        >
                                            Empty<br /><span className="text-[#525252]">portfolio.</span>
                                        </h1>
                                        <p className="text-[#a1a1a1] text-[18px] leading-[1.56] mt-6 max-w-xl font-geist">
                                            Add your first client to begin tracking projects, contracts, and collections.
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <h1
                                            className="text-white font-semibold font-geist leading-[0.95]"
                                            style={{ fontSize: 'clamp(44px, 6.6vw, 76px)', letterSpacing: '-0.055em', fontFeatureSettings: '"liga"' }}
                                        >
                                            {totalClients} {totalClients === 1 ? 'client' : 'clients'}.<br />
                                            <span className="text-[#525252]">{totalProjects} {totalProjects === 1 ? 'project' : 'projects'}.</span>
                                        </h1>
                                        <p className="text-[#a1a1a1] text-[18px] leading-[1.56] mt-6 max-w-xl font-geist">
                                            {totalValue > 0 ? (
                                                <>
                                                    Tracking <span className="text-white tabular-nums">₹{totalValue.toLocaleString('en-IN')}</span> in contracted work
                                                    {paidPct === 100
                                                        ? <>. Fully collected.</>
                                                        : paidPct === 0
                                                            ? <>. Awaiting first collection.</>
                                                            : <>. <span className="text-white tabular-nums">{paidPct}%</span> collected, <span className="tabular-nums">{100 - paidPct}%</span> outstanding.</>}
                                                </>
                                            ) : (
                                                <>No contracted work yet — add a project to begin.</>
                                            )}
                                        </p>
                                    </>
                                )}
                            </section>

                            {/* ===== WORKFLOW PIPELINE ===== */}
                            <section>
                                <div className="flex items-center justify-between mb-3">
                                    <span className="font-geistmono text-[11px] font-medium uppercase text-[#737373]">Pipeline</span>
                                    <div className="flex items-center gap-1">
                                        <span className="w-1 h-1 rounded-full bg-[#0a72ef]" />
                                        <span className="w-1 h-1 rounded-full bg-[#de1d8d]" />
                                        <span className="w-1 h-1 rounded-full bg-[#ff5b4f]" />
                                    </div>
                                </div>
                                <div
                                    className="grid grid-cols-1 md:grid-cols-3 rounded-lg overflow-hidden"
                                    style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.4) 0px 1px 2px' }}
                                >
                                    {[
                                        { idx: '01', label: 'Develop', sub: 'Total contracted', value: totalValue, color: '#0a72ef', meta: `${totalProjects} ${totalProjects === 1 ? 'project' : 'projects'}` },
                                        { idx: '02', label: 'Preview', sub: 'Awaiting collection', value: totalPending, color: '#de1d8d', meta: totalValue > 0 ? `${Math.max(100 - paidPct, 0)}% outstanding` : '—' },
                                        { idx: '03', label: 'Ship', sub: 'Realized revenue', value: totalPaid, color: '#ff5b4f', meta: totalValue > 0 ? `${paidPct}% collected` : '—' },
                                    ].map((step, i) => (
                                        <div
                                            key={step.idx}
                                            className={`relative p-7 flex flex-col gap-5 ${i < 2 ? 'shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.08)] md:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.08)]' : ''}`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-geistmono text-[11px] font-medium uppercase" style={{ color: step.color }}>
                                                    {step.idx} · {step.label}
                                                </span>
                                                <span className="font-geistmono text-[10px] uppercase text-[#737373] tabular-nums">{step.meta}</span>
                                            </div>
                                            <div className="text-[#a1a1a1] text-[14px] leading-[1.4] font-geist">
                                                {step.sub}
                                            </div>
                                            <div
                                                className="text-white font-semibold tabular-nums font-geist"
                                                style={{ fontSize: '40px', letterSpacing: '-1.6px', lineHeight: 1.0, fontFeatureSettings: '"tnum","liga"' }}
                                            >
                                                ₹{step.value.toLocaleString('en-IN')}
                                            </div>
                                            {/* connector arrow — only on desktop horizontal layout */}
                                            {i < 2 && (
                                                <div
                                                    className="hidden md:flex absolute top-1/2 -right-3 -translate-y-1/2 w-6 h-6 items-center justify-center rounded-full bg-[#0a0a0a] z-10"
                                                    style={{ boxShadow: 'rgba(255,255,255,0.12) 0px 0px 0px 1px' }}
                                                    aria-hidden="true"
                                                >
                                                    <ArrowRight size={11} className="text-[#737373]" strokeWidth={2} />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {/* ===== COUNT METRICS ===== */}
                            <section
                                className="grid grid-cols-2 rounded-lg overflow-hidden"
                                style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                            >
                                <div
                                    className="p-7 flex flex-col gap-4"
                                    style={{ boxShadow: 'rgba(255,255,255,0.08) -1px 0px 0px inset' }}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-geistmono text-[11px] font-medium uppercase text-[#737373]">Clients</span>
                                        <UserPlus size={13} className="text-[#525252]" strokeWidth={2} />
                                    </div>
                                    <div
                                        className="text-white font-semibold tabular-nums font-geist"
                                        style={{ fontSize: '52px', letterSpacing: '-2.08px', lineHeight: 1.0 }}
                                    >
                                        {totalClients}
                                    </div>
                                    <div className="flex items-center gap-2 text-[13px] font-geist">
                                        <span
                                            className="inline-flex items-center px-2 h-5 rounded-full font-medium tabular-nums"
                                            style={{ background: 'rgba(10,114,245,0.12)', color: '#3a8dff', fontSize: '11px' }}
                                        >
                                            {clientsWithEmail} email-enabled
                                        </span>
                                        {totalClients - clientsWithEmail > 0 && (
                                            <span className="text-[#737373] tabular-nums">{totalClients - clientsWithEmail} pending</span>
                                        )}
                                    </div>
                                </div>
                                <div className="p-7 flex flex-col gap-4">
                                    <div className="flex items-center justify-between">
                                        <span className="font-geistmono text-[11px] font-medium uppercase text-[#737373]">Projects</span>
                                        <Briefcase size={13} className="text-[#525252]" strokeWidth={2} />
                                    </div>
                                    <div
                                        className="text-white font-semibold tabular-nums font-geist"
                                        style={{ fontSize: '52px', letterSpacing: '-2.08px', lineHeight: 1.0 }}
                                    >
                                        {totalProjects}
                                    </div>
                                    <div className="flex items-center gap-2 text-[13px] font-geist">
                                        <span
                                            className="inline-flex items-center px-2 h-5 rounded-full font-medium tabular-nums"
                                            style={{ background: 'rgba(255,91,79,0.12)', color: '#ff7a72', fontSize: '11px' }}
                                        >
                                            {activeProjects} active
                                        </span>
                                        <span className="text-[#525252]">·</span>
                                        <span className="text-[#a1a1a1] tabular-nums">{totalProjects - activeProjects} shipped</span>
                                    </div>
                                </div>
                            </section>

                            {/* ===== DIRECTORY ===== */}
                            <section className="space-y-6">
                                <div
                                    className="flex items-end justify-between gap-4 pb-5"
                                    style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 1px 0px' }}
                                >
                                    <div>
                                        <span className="font-geistmono text-[11px] font-medium uppercase text-[#737373] mb-2 block">Directory</span>
                                        <h2
                                            className="text-white font-semibold font-geist leading-[1.0]"
                                            style={{ fontSize: '32px', letterSpacing: '-1.28px' }}
                                        >
                                            All clients
                                        </h2>
                                    </div>
                                    <span className="font-geistmono text-[11px] uppercase text-[#737373] tabular-nums pb-1">
                                        {filtered.length} <span className="text-[#525252]">of</span> {clients.length}
                                    </span>
                                </div>

                                {/* Toolbar */}
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#737373]" size={14} strokeWidth={2} />
                                        <input
                                            type="text"
                                            name="client_search"
                                            autoComplete="off"
                                            spellCheck={false}
                                            data-form-type="other"
                                            placeholder="Search by name, email, or access key..."
                                            className="w-full bg-transparent rounded-md pl-9 pr-9 h-10 text-[14px] text-white placeholder:text-[#737373] outline-none transition-shadow font-geist"
                                            style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                            onFocus={(e) => { e.currentTarget.style.boxShadow = 'rgba(10,114,239,0.6) 0px 0px 0px 1px, rgba(10,114,239,0.20) 0px 0px 0px 3px'; }}
                                            onBlur={(e) => { e.currentTarget.style.boxShadow = 'rgba(255,255,255,0.10) 0px 0px 0px 1px'; }}
                                            value={clientSearch}
                                            onChange={(e) => setClientSearch(e.target.value)}
                                        />
                                        {clientSearch && (
                                            <button
                                                type="button"
                                                onClick={() => setClientSearch('')}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded text-[#737373] hover:text-white hover:bg-[#181818] transition-colors"
                                                aria-label="Clear search"
                                            >
                                                <X size={12} strokeWidth={2.5} />
                                            </button>
                                        )}
                                    </div>
                                    <div className="relative" data-menu-root>
                                        <button
                                            onClick={() => setSortOpen(o => !o)}
                                            aria-expanded={sortOpen}
                                            aria-haspopup="listbox"
                                            className="w-full sm:w-auto h-10 px-3 rounded-md text-[#a1a1a1] hover:text-white flex items-center justify-center gap-2 transition-colors text-[13px] font-medium font-geist"
                                            style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        >
                                            <SlidersHorizontal size={13} strokeWidth={2} />
                                            <span>{sortLabels[clientSort]}</span>
                                            <ChevronDown size={13} strokeWidth={2} className={`transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
                                        </button>
                                        {sortOpen && (
                                            <motion.div
                                                initial={{ opacity: 0, y: -4 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="absolute right-0 top-full mt-1.5 w-56 rounded-md z-50 overflow-hidden p-1 bg-[#161616]"
                                                style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px, rgba(0,0,0,0.7) 0px 12px 32px -4px, rgba(0,0,0,0.5) 0px 4px 8px -2px' }}
                                            >
                                                {(['recent', 'name', 'projects', 'value'] as ClientSortField[]).map(key => (
                                                    <button
                                                        key={key}
                                                        onClick={() => { setClientSort(key); setSortOpen(false); }}
                                                        className={`w-full text-left px-2.5 py-2 text-[13px] rounded transition-colors font-geist ${
                                                            clientSort === key
                                                                ? 'bg-[#222] text-white font-medium'
                                                                : 'text-[#a1a1a1] hover:bg-[#222] hover:text-white'
                                                        }`}
                                                    >
                                                        {sortLabels[key]}
                                                    </button>
                                                ))}
                                            </motion.div>
                                        )}
                                    </div>
                                </div>

                                {/* List */}
                                {filtered.length === 0 ? (
                                    <div
                                        className="rounded-lg py-20 px-6 text-center"
                                        style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                    >
                                        <div
                                            className="inline-flex w-12 h-12 items-center justify-center rounded-md mb-5"
                                            style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        >
                                            {clients.length === 0
                                                ? <UserPlus size={18} className="text-[#a1a1a1]" strokeWidth={2} />
                                                : <Search size={18} className="text-[#a1a1a1]" strokeWidth={2} />}
                                        </div>
                                        <p className="text-white text-[20px] font-semibold font-geist" style={{ letterSpacing: '-0.4px' }}>
                                            {clients.length === 0 ? 'No clients yet' : 'No matches'}
                                        </p>
                                        <p className="text-[#a1a1a1] text-[14px] mt-2 max-w-sm mx-auto font-geist">
                                            {clients.length === 0
                                                ? 'Click "New client" to onboard your first client.'
                                                : `Nothing matches "${clientSearch}".`}
                                        </p>
                                    </div>
                                ) : (
                                    <div
                                        className="rounded-lg"
                                        style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                    >
                                        {/* Header */}
                                        <div
                                            className="hidden lg:grid grid-cols-12 gap-4 px-6 h-10 items-center font-geistmono text-[10px] font-medium uppercase text-[#737373] rounded-t-lg"
                                            style={{ boxShadow: 'rgba(255,255,255,0.08) 0px -1px 0px inset', background: 'rgba(255,255,255,0.015)' }}
                                        >
                                            <div className="col-span-4">Client</div>
                                            <div className="col-span-2">Access Key</div>
                                            <div className="col-span-1 text-right">Projects</div>
                                            <div className="col-span-2 text-right">Contract</div>
                                            <div className="col-span-2">Status</div>
                                            <div className="col-span-1 text-right">Actions</div>
                                        </div>

                                        {filtered.map((client, idx) => {
                                            const isCopied = copiedKey === client.access_key;
                                            const paidPctClient = client.stats.totalValue > 0
                                                ? Math.round((client.stats.paidValue / client.stats.totalValue) * 100)
                                                : 0;
                                            const hasProjects = client.stats.projectCount > 0;
                                            const progress = client.stats.progress;
                                            // Map status to workflow stages — Develop (early) Blue → Preview (mid) Pink → Ship (done) Red
                                            const statusColor = progress === 100 ? '#ff5b4f' : progress >= 50 ? '#de1d8d' : '#0a72ef';
                                            const statusLabel = progress === 100 ? 'Shipped' : progress >= 50 ? 'Preview' : 'Develop';

                                            const isFirst = idx === 0;
                                            const isLast = idx === filtered.length - 1;
                                            return (
                                                <motion.div
                                                    key={client.id}
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    transition={{ delay: idx * 0.03, duration: 0.2 }}
                                                    className={`group grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4 items-center px-5 lg:px-6 py-4 hover:bg-[#0d0d0d] transition-colors ${isFirst ? 'rounded-t-lg lg:rounded-t-none' : ''} ${isLast ? 'rounded-b-lg' : ''}`}
                                                    style={{ boxShadow: idx > 0 ? 'rgba(255,255,255,0.08) 0px 1px 0px inset' : undefined }}
                                                >
                                                    {/* Profile */}
                                                    <div className="col-span-1 lg:col-span-4 flex items-center gap-3 min-w-0">
                                                        <div
                                                            className="shrink-0 w-9 h-9 rounded-md flex items-center justify-center bg-[#111] text-[#ededed] text-[14px] font-semibold font-geist"
                                                            style={{ letterSpacing: '-0.4px', boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                                        >
                                                            {client.name.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <h3 className="text-white font-semibold truncate text-[15px] font-geist" style={{ letterSpacing: '-0.3px' }}>
                                                                    {client.name}
                                                                </h3>
                                                            </div>
                                                            <p className="text-[#737373] text-[12px] truncate font-geist mt-0.5 flex items-center gap-2">
                                                                <span className="truncate">
                                                                    {client.email || <span className="text-[#ff5b4f]">No email on file</span>}
                                                                </span>
                                                                <span className="font-geistmono text-[10px] uppercase text-[#525252] shrink-0">
                                                                    {new Date(client.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                                </span>
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Access Key */}
                                                    <div className="col-span-1 lg:col-span-2 flex items-center justify-between lg:justify-start gap-2">
                                                        <span className="lg:hidden font-geistmono text-[10px] uppercase text-[#737373]">Key</span>
                                                        <button
                                                            onClick={() => copyAccessKey(client.access_key)}
                                                            className="flex items-center gap-1.5 hover:bg-[#181818] px-2 h-7 rounded transition-colors max-w-full"
                                                            style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                                            title={isCopied ? 'Copied' : 'Click to copy'}
                                                        >
                                                            <span className="text-[#a1a1a1] font-geistmono text-[11px] truncate max-w-[110px]">{client.access_key}</span>
                                                            {isCopied
                                                                ? <Check size={11} className="text-[#0a72ef] shrink-0" strokeWidth={3} />
                                                                : <Copy size={11} className="text-[#525252] group-hover:text-[#a1a1a1] shrink-0 transition-colors" />}
                                                        </button>
                                                    </div>

                                                    {/* Projects */}
                                                    <div className="col-span-1 lg:col-span-1 flex items-center justify-between lg:justify-end">
                                                        <span className="lg:hidden font-geistmono text-[10px] uppercase text-[#737373]">Projects</span>
                                                        {hasProjects ? (
                                                            <span className="font-geist text-white tabular-nums text-[15px] font-semibold" style={{ letterSpacing: '-0.3px' }}>
                                                                {client.stats.completedProjects}<span className="text-[#525252] font-normal">/</span>{client.stats.projectCount}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[#525252] text-[14px] font-geist">—</span>
                                                        )}
                                                    </div>

                                                    {/* Contract */}
                                                    <div className="col-span-1 lg:col-span-2 flex items-center justify-between lg:justify-end">
                                                        <span className="lg:hidden font-geistmono text-[10px] uppercase text-[#737373]">Contract</span>
                                                        {client.stats.totalValue > 0 ? (
                                                            <div className="text-right font-geist">
                                                                <div className="text-white text-[14px] font-semibold tabular-nums" style={{ letterSpacing: '-0.28px' }}>
                                                                    {formatK(client.stats.totalValue)}
                                                                </div>
                                                                <div className="text-[#737373] text-[11px] tabular-nums font-geistmono">{paidPctClient}% paid</div>
                                                            </div>
                                                        ) : (
                                                            <span className="text-[#525252] text-[14px] font-geist">—</span>
                                                        )}
                                                    </div>

                                                    {/* Status */}
                                                    <div className="col-span-1 lg:col-span-2 flex items-center justify-between lg:justify-start gap-3">
                                                        <span className="lg:hidden font-geistmono text-[10px] uppercase text-[#737373]">Status</span>
                                                        <div className="flex items-center gap-2 flex-1 max-w-[180px]">
                                                            <span
                                                                className="inline-flex items-center gap-1.5 px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium shrink-0"
                                                                style={{ background: `${statusColor}1f`, color: statusColor }}
                                                            >
                                                                <span className="w-1 h-1 rounded-full" style={{ background: statusColor }} />
                                                                {statusLabel}
                                                            </span>
                                                            <div className="flex-1 h-[2px] bg-[#1a1a1a] rounded-full overflow-hidden">
                                                                <motion.div
                                                                    initial={{ width: 0 }}
                                                                    animate={{ width: `${progress}%` }}
                                                                    transition={{ duration: 0.7, ease: 'easeOut', delay: 0.1 + idx * 0.03 }}
                                                                    className="h-full rounded-full"
                                                                    style={{ background: statusColor }}
                                                                />
                                                            </div>
                                                            <span className="font-geistmono text-[10px] tabular-nums text-[#737373] w-9 text-right shrink-0">{progress}%</span>
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="col-span-1 lg:col-span-1 flex items-center justify-end relative" data-menu-root>
                                                        <button
                                                            onClick={(e) => {
                                                                if (openMenuId === client.id) {
                                                                    setOpenMenuId(null);
                                                                    return;
                                                                }
                                                                // Viewport-aware flip: if not enough room below, open upward
                                                                const rect = e.currentTarget.getBoundingClientRect();
                                                                const menuApproxHeight = 220;
                                                                const spaceBelow = window.innerHeight - rect.bottom;
                                                                setMenuFlipUp(spaceBelow < menuApproxHeight + 16);
                                                                setOpenMenuId(client.id);
                                                            }}
                                                            aria-label="Open actions menu"
                                                            aria-expanded={openMenuId === client.id}
                                                            aria-haspopup="menu"
                                                            className="w-8 h-8 rounded-md text-[#737373] hover:text-white hover:bg-[#181818] flex items-center justify-center transition-colors"
                                                        >
                                                            <MoreHorizontal size={15} />
                                                        </button>
                                                        {openMenuId === client.id && (
                                                            <motion.div
                                                                role="menu"
                                                                initial={{ opacity: 0, y: menuFlipUp ? 4 : -4 }}
                                                                animate={{ opacity: 1, y: 0 }}
                                                                className={`absolute right-0 w-52 rounded-md z-50 overflow-hidden p-1 bg-[#161616] ${
                                                                    menuFlipUp ? 'bottom-full mb-2' : 'top-full mt-1.5'
                                                                }`}
                                                                style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px, rgba(0,0,0,0.7) 0px 12px 32px -4px, rgba(0,0,0,0.5) 0px 4px 8px -2px' }}
                                                            >
                                                                <button
                                                                    role="menuitem"
                                                                    onClick={() => { setOpenMenuId(null); handleClientSelect(client); }}
                                                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] text-[#a1a1a1] hover:text-white rounded hover:bg-[#222] transition-colors font-geist"
                                                                >
                                                                    <FolderPlus size={13} />
                                                                    Projects
                                                                </button>
                                                                <button
                                                                    role="menuitem"
                                                                    onClick={() => { setOpenMenuId(null); handleViewActivity(client); }}
                                                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] text-[#a1a1a1] hover:text-white rounded hover:bg-[#222] transition-colors font-geist"
                                                                >
                                                                    <Activity size={13} />
                                                                    Activity log
                                                                </button>
                                                                <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                                                                <button
                                                                    role="menuitem"
                                                                    onClick={() => { setOpenMenuId(null); handleEditClient(client); }}
                                                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] text-[#a1a1a1] hover:text-white rounded hover:bg-[#222] transition-colors font-geist"
                                                                >
                                                                    <Pencil size={13} />
                                                                    Edit
                                                                </button>
                                                                <button
                                                                    role="menuitem"
                                                                    onClick={() => { setOpenMenuId(null); handleDelete(client.id, 'clients'); }}
                                                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] text-[#ff5b4f] rounded hover:bg-[#222] transition-colors font-geist"
                                                                >
                                                                    <Trash2 size={13} />
                                                                    Delete
                                                                </button>
                                                            </motion.div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        </div>
                    );
                })()}

                {/* ========== PROJECTS VIEW ========== */}
                {view === 'projects' && !loading && (() => {
                    const projectsCount = projects.length;
                    const completedCount = projects.filter(p => p.status === 'Completed').length;
                    const activeCount = projectsCount - completedCount;
                    const totalValue = projects.reduce((a, p) => a + (p.stats?.total ?? 0), 0);
                    const totalPaid = projects.reduce((a, p) => a + (p.stats?.paid ?? 0), 0);
                    const totalPending = Math.max(totalValue - totalPaid, 0);
                    const paidPct = totalValue > 0 ? Math.round((totalPaid / totalValue) * 100) : 0;
                    const formatINR = (n: number) => `₹${(n ?? 0).toLocaleString('en-IN')}`;

                    return (
                        <div className="space-y-12">
                            {/* ===== COMMAND BAR ===== */}
                            <header className="flex items-center justify-between gap-3 -mt-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <button
                                        onClick={handleBack}
                                        aria-label="Back to clients"
                                        className="h-8 w-8 rounded-md flex items-center justify-center text-[#a1a1a1] hover:text-white hover:bg-[#181818] transition-colors shrink-0"
                                        style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                    >
                                        <ArrowLeft size={13} strokeWidth={2} />
                                    </button>
                                    <span className="font-geistmono text-[12px] font-medium uppercase text-[#a1a1a1] truncate tracking-[0.02em] ml-1">
                                        admin
                                        <span className="text-[#404040] mx-1.5">/</span>
                                        <button
                                            type="button"
                                            onClick={handleBack}
                                            className="hover:text-white transition-colors uppercase"
                                        >
                                            clients
                                        </button>
                                        <span className="text-[#404040] mx-1.5">/</span>
                                        <span className="text-white">{selectedClient?.name || '—'}</span>
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={async () => { await supabaseAdmin.auth.signOut(); router.push('/admin'); }}
                                        className="h-9 px-3 rounded-md bg-transparent hover:bg-[#181818] text-[#a1a1a1] hover:text-white flex items-center justify-center gap-2 transition-colors text-[13px] font-medium font-geist"
                                        style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        aria-label="Sign out"
                                    >
                                        <LogOut size={13} strokeWidth={2} />
                                        <span className="hidden sm:inline">Sign out</span>
                                    </button>
                                    <button
                                        onClick={() => { setFormData({}); setEditingId(null); setEditingLinkIndex(null); setShowModal(true); }}
                                        className="h-9 px-3.5 rounded-md bg-white hover:bg-[#ededed] text-[#0a0a0a] flex items-center justify-center gap-1.5 transition-colors text-[13px] font-medium font-geist"
                                    >
                                        <Plus size={13} strokeWidth={2.5} />
                                        New project
                                    </button>
                                </div>
                            </header>

                            {/* ===== HERO ===== */}
                            <section className="pt-6 pb-2 max-w-3xl">
                                {projectsCount === 0 ? (
                                    <>
                                        <h1
                                            className="text-white font-semibold font-geist leading-[0.95]"
                                            style={{ fontSize: 'clamp(44px, 6.6vw, 76px)', letterSpacing: '-0.055em', fontFeatureSettings: '"liga"' }}
                                        >
                                            {selectedClient?.name || 'Client'}.<br />
                                            <span className="text-[#525252]">No projects yet.</span>
                                        </h1>
                                        <p className="text-[#a1a1a1] text-[18px] leading-[1.56] mt-6 max-w-xl font-geist">
                                            Create the first project for this client to begin tracking features and collections.
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <h1
                                            className="text-white font-semibold font-geist leading-[0.95]"
                                            style={{ fontSize: 'clamp(44px, 6.6vw, 76px)', letterSpacing: '-0.055em', fontFeatureSettings: '"liga"' }}
                                        >
                                            {selectedClient?.name}.<br />
                                            <span className="text-[#525252]">{projectsCount} {projectsCount === 1 ? 'project' : 'projects'}.</span>
                                        </h1>
                                        <p className="text-[#a1a1a1] text-[18px] leading-[1.56] mt-6 max-w-xl font-geist">
                                            {totalValue > 0 ? (
                                                <>
                                                    Tracking <span className="text-white tabular-nums">{formatINR(totalValue)}</span> in contracted work
                                                    {paidPct === 100
                                                        ? <>. Fully collected.</>
                                                        : paidPct === 0
                                                            ? <>. Awaiting first collection.</>
                                                            : <>. <span className="text-white tabular-nums">{paidPct}%</span> collected, <span className="tabular-nums">{100 - paidPct}%</span> outstanding.</>}
                                                </>
                                            ) : (
                                                <>{activeCount} active · {completedCount} shipped. No financials recorded yet.</>
                                            )}
                                        </p>
                                    </>
                                )}
                            </section>

                            {/* ===== AGGREGATE PIPELINE ===== */}
                            {projectsCount > 0 && (
                                <section>
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="font-geistmono text-[11px] font-medium uppercase text-[#737373]">Financials</span>
                                        <div className="flex items-center gap-1">
                                            <span className="w-1 h-1 rounded-full bg-[#0a72ef]" />
                                            <span className="w-1 h-1 rounded-full bg-[#de1d8d]" />
                                            <span className="w-1 h-1 rounded-full bg-[#ff5b4f]" />
                                        </div>
                                    </div>
                                    <div
                                        className="grid grid-cols-1 md:grid-cols-3 rounded-lg"
                                        style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.4) 0px 1px 2px' }}
                                    >
                                        {[
                                            { idx: '01', label: 'Develop', sub: 'Total contracted', value: totalValue, color: '#0a72ef', meta: `${activeCount} active` },
                                            { idx: '02', label: 'Preview', sub: 'Awaiting collection', value: totalPending, color: '#de1d8d', meta: totalValue > 0 ? `${100 - paidPct}% outstanding` : '—' },
                                            { idx: '03', label: 'Ship', sub: 'Realized revenue', value: totalPaid, color: '#ff5b4f', meta: totalValue > 0 ? `${paidPct}% collected` : '—' },
                                        ].map((step, i) => (
                                            <div
                                                key={step.idx}
                                                className={`relative p-7 flex flex-col gap-5 ${i === 0 ? 'rounded-t-lg md:rounded-tr-none md:rounded-l-lg' : ''} ${i === 2 ? 'rounded-b-lg md:rounded-bl-none md:rounded-r-lg' : ''} ${i < 2 ? 'shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.08)] md:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.08)]' : ''}`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-geistmono text-[11px] font-medium uppercase" style={{ color: step.color }}>
                                                        {step.idx} · {step.label}
                                                    </span>
                                                    <span className="font-geistmono text-[10px] uppercase text-[#737373] tabular-nums">{step.meta}</span>
                                                </div>
                                                <div className="text-[#a1a1a1] text-[14px] leading-[1.4] font-geist">
                                                    {step.sub}
                                                </div>
                                                <div
                                                    className="text-white font-semibold tabular-nums font-geist"
                                                    style={{ fontSize: '40px', letterSpacing: '-1.6px', lineHeight: 1.0, fontFeatureSettings: '"tnum","liga"' }}
                                                >
                                                    {formatINR(step.value)}
                                                </div>
                                                {i < 2 && (
                                                    <div
                                                        className="hidden md:flex absolute top-1/2 -right-3 -translate-y-1/2 w-6 h-6 items-center justify-center rounded-full bg-[#0a0a0a] z-10"
                                                        style={{ boxShadow: 'rgba(255,255,255,0.12) 0px 0px 0px 1px' }}
                                                        aria-hidden="true"
                                                    >
                                                        <ArrowRight size={11} className="text-[#737373]" strokeWidth={2} />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* ===== PROJECTS LIST ===== */}
                            <section className="space-y-6">
                                <div
                                    className="flex items-end justify-between gap-4 pb-5"
                                    style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 1px 0px' }}
                                >
                                    <div>
                                        <span className="font-geistmono text-[11px] font-medium uppercase text-[#737373] mb-2 block">Catalog</span>
                                        <h2
                                            className="text-white font-semibold font-geist leading-[1.0]"
                                            style={{ fontSize: '32px', letterSpacing: '-1.28px' }}
                                        >
                                            All projects
                                        </h2>
                                    </div>
                                    {projectsCount > 0 && (
                                        <span className="font-geistmono text-[11px] uppercase text-[#737373] tabular-nums pb-1">
                                            {completedCount} <span className="text-[#525252]">shipped of</span> {projectsCount}
                                        </span>
                                    )}
                                </div>

                                {projectsCount === 0 ? (
                                    <div
                                        className="rounded-lg py-20 px-6 text-center"
                                        style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                    >
                                        <div
                                            className="inline-flex w-12 h-12 items-center justify-center rounded-md mb-5"
                                            style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        >
                                            <PackagePlus size={18} className="text-[#a1a1a1]" strokeWidth={2} />
                                        </div>
                                        <p className="text-white text-[20px] font-semibold font-geist" style={{ letterSpacing: '-0.4px' }}>
                                            No projects yet
                                        </p>
                                        <p className="text-[#a1a1a1] text-[14px] mt-2 max-w-sm mx-auto font-geist">
                                            Click &quot;New project&quot; to create the first deliverable for this client.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {projects.map((project, idx) => {
                                            const isCompleted = project.status === 'Completed';
                                            const progress = project.stats?.progress ?? 0;
                                            const stageColor = isCompleted ? '#ff5b4f' : progress >= 50 ? '#de1d8d' : '#0a72ef';
                                            const stageLabel = isCompleted ? 'Shipped' : progress >= 50 ? 'Preview' : 'Develop';
                                            const projectIdx = String(idx + 1).padStart(2, '0');
                                            const total = project.stats?.total ?? 0;
                                            const paid = project.stats?.paid ?? 0;
                                            const pending = project.stats?.pending ?? Math.max(total - paid, 0);

                                            return (
                                                <motion.article
                                                    layout
                                                    key={project.id}
                                                    initial={{ opacity: 0, y: 4 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: idx * 0.04, duration: 0.25 }}
                                                    className="rounded-lg p-6 sm:p-7 group hover:bg-[#0c0c0c] transition-colors"
                                                    style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                                >
                                                    {/* Header row: index + category + date */}
                                                    <div className="flex items-center justify-between gap-2 mb-5 flex-wrap">
                                                        <div className="flex items-center gap-3 flex-wrap">
                                                            <span
                                                                className="inline-flex items-center gap-1.5 px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium shrink-0"
                                                                style={{ background: `${stageColor}1f`, color: stageColor }}
                                                            >
                                                                <span className="w-1 h-1 rounded-full" style={{ background: stageColor }} />
                                                                {projectIdx} · {stageLabel}
                                                            </span>
                                                            <span className="font-geistmono text-[11px] uppercase text-[#737373]">
                                                                {project.category}
                                                            </span>
                                                        </div>
                                                        <span className="font-geistmono text-[10px] uppercase text-[#525252] tabular-nums">
                                                            {new Date(project.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                        </span>
                                                    </div>

                                                    {/* Project title */}
                                                    <h3
                                                        className="text-white font-semibold font-geist mb-6"
                                                        style={{ fontSize: 'clamp(20px, 2.4vw, 24px)', letterSpacing: '-0.96px', lineHeight: 1.2 }}
                                                    >
                                                        {project.description}
                                                    </h3>

                                                    {/* Progress */}
                                                    <div className="mb-6">
                                                        <div className="flex items-end justify-between mb-2.5">
                                                            <span className="font-geistmono text-[11px] font-medium uppercase text-[#737373]">Progress</span>
                                                            <div className="flex items-baseline gap-2 font-geist">
                                                                <span
                                                                    className="text-white font-semibold tabular-nums"
                                                                    style={{ fontSize: '18px', letterSpacing: '-0.36px' }}
                                                                >
                                                                    {progress}%
                                                                </span>
                                                                <span className="text-[#737373] text-[11px] font-geistmono tabular-nums">
                                                                    {project.stats?.completedFeatures ?? 0}<span className="text-[#404040]">/</span>{project.stats?.totalFeatures ?? 0}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="h-1 w-full bg-[#181818] rounded-full overflow-hidden">
                                                            <motion.div
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${progress}%` }}
                                                                transition={{ duration: 0.7, ease: 'easeOut', delay: 0.1 + idx * 0.04 }}
                                                                className="h-full rounded-full"
                                                                style={{ background: stageColor }}
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Payment breakdown */}
                                                    <div
                                                        className="grid grid-cols-3 rounded-md mb-6"
                                                        style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                                    >
                                                        <div
                                                            className="p-4 flex flex-col gap-2 rounded-l-md"
                                                            style={{ boxShadow: 'rgba(255,255,255,0.08) -1px 0px 0px inset' }}
                                                        >
                                                            <span className="font-geistmono text-[10px] font-medium uppercase text-[#737373]">Total</span>
                                                            <span
                                                                className="text-white font-semibold tabular-nums font-geist"
                                                                style={{ fontSize: 'clamp(15px, 2vw, 18px)', letterSpacing: '-0.36px' }}
                                                            >
                                                                {formatINR(total)}
                                                            </span>
                                                        </div>
                                                        <div
                                                            className="p-4 flex flex-col gap-2"
                                                            style={{ boxShadow: 'rgba(255,255,255,0.08) -1px 0px 0px inset' }}
                                                        >
                                                            <span className="font-geistmono text-[10px] font-medium uppercase text-[#737373]">Paid</span>
                                                            <span
                                                                className="font-semibold tabular-nums font-geist"
                                                                style={{ fontSize: 'clamp(15px, 2vw, 18px)', letterSpacing: '-0.36px', color: paid > 0 ? '#ff5b4f' : '#525252' }}
                                                            >
                                                                {formatINR(paid)}
                                                            </span>
                                                        </div>
                                                        <div className="p-4 flex flex-col gap-2 rounded-r-md">
                                                            <span className="font-geistmono text-[10px] font-medium uppercase text-[#737373]">Pending</span>
                                                            <span
                                                                className="font-semibold tabular-nums font-geist"
                                                                style={{ fontSize: 'clamp(15px, 2vw, 18px)', letterSpacing: '-0.36px', color: pending > 0 ? '#de1d8d' : '#525252' }}
                                                            >
                                                                {formatINR(pending)}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Footer actions */}
                                                    <div
                                                        className="flex items-center justify-between gap-2 pt-5"
                                                        style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 1px 0px inset' }}
                                                    >
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => handleEditProject(project)}
                                                                aria-label="Edit project"
                                                                className="h-8 w-8 rounded-md flex items-center justify-center text-[#737373] hover:text-white hover:bg-[#181818] transition-colors"
                                                            >
                                                                <Pencil size={13} strokeWidth={2} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(project.id, 'projects')}
                                                                aria-label="Delete project"
                                                                className="h-8 w-8 rounded-md flex items-center justify-center text-[#737373] hover:text-[#ff5b4f] hover:bg-[#181818] transition-colors"
                                                            >
                                                                <Trash2 size={13} strokeWidth={2} />
                                                            </button>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => handleProjectLinksSelect(project)}
                                                                className="h-9 px-3.5 rounded-md text-[#a1a1a1] hover:text-white hover:bg-[#181818] flex items-center justify-center gap-1.5 transition-colors text-[13px] font-medium font-geist"
                                                                style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                                            >
                                                                <Link2 size={13} strokeWidth={2} />
                                                                Links
                                                            </button>
                                                            <button
                                                                onClick={() => handleProjectSelect(project)}
                                                                className="h-9 px-3.5 rounded-md bg-white hover:bg-[#ededed] text-[#0a0a0a] flex items-center justify-center gap-1.5 transition-colors text-[13px] font-medium font-geist"
                                                            >
                                                                Manage features
                                                                <ArrowRight size={13} strokeWidth={2.5} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </motion.article>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        </div>
                    );
                })()}

                {/* ========== LINKS VIEW ========== */}
                {view === 'links' && !loading && (
                    <div className="space-y-12">
                        {/* ===== COMMAND BAR ===== */}
                        <header className="flex items-center justify-between gap-3 -mt-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <button
                                    onClick={handleBack}
                                    aria-label="Back to projects"
                                    className="h-8 w-8 rounded-md flex items-center justify-center text-[#a1a1a1] hover:text-white hover:bg-[#181818] transition-colors shrink-0"
                                    style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                >
                                    <ArrowLeft size={13} strokeWidth={2} />
                                </button>
                                <span className="font-geistmono text-[12px] font-medium uppercase text-[#a1a1a1] truncate tracking-[0.02em] ml-1">
                                    admin
                                    <span className="text-[#404040] mx-1.5">/</span>
                                    <span className="text-[#737373]">{selectedClient?.name || '—'}</span>
                                    <span className="text-[#404040] mx-1.5">/</span>
                                    <button type="button" onClick={handleBack} className="hover:text-white transition-colors uppercase">projects</button>
                                    <span className="text-[#404040] mx-1.5">/</span>
                                    <span className="text-white">links</span>
                                </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={async () => { await supabaseAdmin.auth.signOut(); router.push('/admin'); }}
                                    className="h-9 px-3 rounded-md bg-transparent hover:bg-[#181818] text-[#a1a1a1] hover:text-white flex items-center justify-center gap-2 transition-colors text-[13px] font-medium font-geist"
                                    style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                    aria-label="Sign out"
                                >
                                    <LogOut size={13} strokeWidth={2} />
                                    <span className="hidden sm:inline">Sign out</span>
                                </button>
                                <button
                                    onClick={() => { setFormData({}); setEditingId(null); setEditingLinkIndex(null); setShowModal(true); }}
                                    className="h-9 px-3.5 rounded-md bg-white hover:bg-[#ededed] text-[#0a0a0a] flex items-center justify-center gap-1.5 transition-colors text-[13px] font-medium font-geist"
                                >
                                    <Plus size={13} strokeWidth={2.5} />
                                    New link
                                </button>
                            </div>
                        </header>

                        {/* ===== HERO ===== */}
                        <section className="pt-6 pb-2 max-w-3xl">
                            <h1
                                className="text-white font-semibold font-geist leading-[0.95]"
                                style={{ fontSize: 'clamp(40px, 5.6vw, 64px)', letterSpacing: '-0.05em', fontFeatureSettings: '"liga"' }}
                            >
                                {selectedProject?.description || 'Project'}.<br />
                                <span className="text-[#525252]">{links.length} {links.length === 1 ? 'link' : 'links'}.</span>
                            </h1>
                            <p className="text-[#a1a1a1] text-[18px] leading-[1.56] mt-6 max-w-xl font-geist">
                                {links.length === 0
                                    ? <>Pin design files, deployments, repos, or any reference URL the client should see.</>
                                    : <>Resources visible to the client on their portal.</>}
                            </p>
                        </section>

                        {/* ===== LIST ===== */}
                        <section className="space-y-6">
                            <div
                                className="flex items-end justify-between gap-4 pb-5"
                                style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 1px 0px' }}
                            >
                                <div>
                                    <span className="font-geistmono text-[11px] font-medium uppercase text-[#737373] mb-2 block">Resources</span>
                                    <h2
                                        className="text-white font-semibold font-geist leading-[1.0]"
                                        style={{ fontSize: '32px', letterSpacing: '-1.28px' }}
                                    >
                                        All links
                                    </h2>
                                </div>
                                {links.length > 0 && (
                                    <span className="font-geistmono text-[11px] uppercase text-[#737373] tabular-nums pb-1">
                                        {links.length} <span className="text-[#525252]">total</span>
                                    </span>
                                )}
                            </div>

                            {links.length === 0 ? (
                                <div
                                    className="rounded-lg py-20 px-6 text-center"
                                    style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                >
                                    <div
                                        className="inline-flex w-12 h-12 items-center justify-center rounded-md mb-5"
                                        style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                    >
                                        <Link2 size={18} className="text-[#a1a1a1]" strokeWidth={2} />
                                    </div>
                                    <p className="text-white text-[20px] font-semibold font-geist" style={{ letterSpacing: '-0.4px' }}>
                                        No links yet
                                    </p>
                                    <p className="text-[#a1a1a1] text-[14px] mt-2 max-w-sm mx-auto font-geist">
                                        Click &quot;New link&quot; to attach a URL to this project.
                                    </p>
                                </div>
                            ) : (
                                <div
                                    className="rounded-lg"
                                    style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                >
                                    {links.map((link, index) => {
                                        const isFirst = index === 0;
                                        const isLast = index === links.length - 1;
                                        return (
                                            <motion.div
                                                key={index}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ delay: index * 0.04, duration: 0.25 }}
                                                className={`group flex items-center justify-between gap-3 px-5 sm:px-6 py-4 hover:bg-[#0c0c0c] transition-colors ${isFirst ? 'rounded-t-lg' : ''} ${isLast ? 'rounded-b-lg' : ''}`}
                                                style={{ boxShadow: index > 0 ? 'rgba(255,255,255,0.08) 0px 1px 0px inset' : undefined }}
                                            >
                                                <div className="flex items-center gap-4 min-w-0 flex-1">
                                                    <div
                                                        className="shrink-0 w-9 h-9 rounded-md flex items-center justify-center bg-[#111]"
                                                        style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                                    >
                                                        <Link2 size={14} className="text-[#a1a1a1]" strokeWidth={2} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <h4 className="text-white text-[15px] font-semibold font-geist truncate" style={{ letterSpacing: '-0.3px' }}>
                                                            {link.title}
                                                        </h4>
                                                        <a
                                                            href={link.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-[#737373] hover:text-[#0a72ef] text-[12px] font-geistmono truncate block transition-colors mt-0.5"
                                                        >
                                                            {link.url}
                                                        </a>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <a
                                                        href={link.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        aria-label="Open link"
                                                        className="h-8 w-8 rounded-md flex items-center justify-center text-[#737373] hover:text-white hover:bg-[#181818] transition-colors"
                                                    >
                                                        <ArrowUpRight size={13} strokeWidth={2} />
                                                    </a>
                                                    <button
                                                        onClick={() => { setEditingLinkIndex(index); setFormData({ link_title: link.title, link_url: link.url }); setShowModal(true); }}
                                                        aria-label="Edit link"
                                                        className="h-8 w-8 rounded-md flex items-center justify-center text-[#737373] hover:text-white hover:bg-[#181818] transition-colors"
                                                    >
                                                        <Pencil size={13} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteLink(index)}
                                                        aria-label="Delete link"
                                                        className="h-8 w-8 rounded-md flex items-center justify-center text-[#737373] hover:text-[#ff5b4f] hover:bg-[#181818] transition-colors"
                                                    >
                                                        <Trash2 size={13} strokeWidth={2} />
                                                    </button>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            )}
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
                    const ratePending = features.filter(f => f.payment_confirmed === false).length;
                    const formatINR = (n: number) => `₹${(n ?? 0).toLocaleString('en-IN')}`;

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

                    const stageFor = (status: string) => {
                        if (status === 'Completed') return { color: '#ff5b4f', label: 'Shipped' };
                        if (status === 'Working' || status === 'Updating') return { color: '#de1d8d', label: status === 'Updating' ? 'Updating' : 'Preview' };
                        if (status === 'Approved') return { color: '#0a72ef', label: 'Approved' };
                        return { color: '#737373', label: 'Requested' };
                    };

                    return (
                        <div className="space-y-12">
                            {/* ===== COMMAND BAR ===== */}
                            <header className="flex items-center justify-between gap-3 -mt-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <button
                                        onClick={handleBack}
                                        aria-label="Back to projects"
                                        className="h-8 w-8 rounded-md flex items-center justify-center text-[#a1a1a1] hover:text-white hover:bg-[#181818] transition-colors shrink-0"
                                        style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                    >
                                        <ArrowLeft size={13} strokeWidth={2} />
                                    </button>
                                    <span className="font-geistmono text-[12px] font-medium uppercase text-[#a1a1a1] truncate tracking-[0.02em] ml-1">
                                        admin
                                        <span className="text-[#404040] mx-1.5">/</span>
                                        <span className="text-[#737373]">{selectedClient?.name || '—'}</span>
                                        <span className="text-[#404040] mx-1.5">/</span>
                                        <button type="button" onClick={handleBack} className="hover:text-white transition-colors uppercase">projects</button>
                                        <span className="text-[#404040] mx-1.5">/</span>
                                        <span className="text-white">features</span>
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={async () => { await supabaseAdmin.auth.signOut(); router.push('/admin'); }}
                                        className="h-9 px-3 rounded-md bg-transparent hover:bg-[#181818] text-[#a1a1a1] hover:text-white flex items-center justify-center gap-2 transition-colors text-[13px] font-medium font-geist"
                                        style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        aria-label="Sign out"
                                    >
                                        <LogOut size={13} strokeWidth={2} />
                                        <span className="hidden sm:inline">Sign out</span>
                                    </button>
                                    <button
                                        onClick={() => { setFormData({}); setEditingId(null); setEditingLinkIndex(null); setShowModal(true); }}
                                        className="h-9 px-3.5 rounded-md bg-white hover:bg-[#ededed] text-[#0a0a0a] flex items-center justify-center gap-1.5 transition-colors text-[13px] font-medium font-geist"
                                    >
                                        <Plus size={13} strokeWidth={2.5} />
                                        New feature
                                    </button>
                                </div>
                            </header>

                            {/* ===== HERO ===== */}
                            <section className="pt-6 pb-2 max-w-3xl">
                                <h1
                                    className="text-white font-semibold font-geist leading-[0.95]"
                                    style={{ fontSize: 'clamp(40px, 5.6vw, 64px)', letterSpacing: '-0.05em', fontFeatureSettings: '"liga"' }}
                                >
                                    {selectedProject?.description || 'Project'}.<br />
                                    <span className="text-[#525252]">{featuresCount} {featuresCount === 1 ? 'feature' : 'features'}.</span>
                                </h1>
                                <p className="text-[#a1a1a1] text-[18px] leading-[1.56] mt-6 max-w-xl font-geist">
                                    {featuresCount === 0
                                        ? <>Add the first feature to break this project into deliverables.</>
                                        : totalAmount > 0
                                            ? <>Tracking <span className="text-white tabular-nums">{formatINR(totalAmount)}</span> across this project. <span className="text-white tabular-nums">{paidPct}%</span> collected.</>
                                            : <>{completedCount} shipped · {featuresCount - completedCount} in flight. Rates pending on {ratePending}.</>}
                                </p>
                            </section>

                            {/* ===== AGGREGATE METRICS ===== */}
                            {featuresCount > 0 && (
                                <section
                                    className="grid grid-cols-2 md:grid-cols-4 rounded-lg"
                                    style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                >
                                    {[
                                        { label: 'Features', value: featuresCount.toString(), meta: `${completedCount} shipped`, color: '#a1a1a1' },
                                        { label: 'Total', value: formatINR(totalAmount), meta: '—', color: '#0a72ef' },
                                        { label: 'Paid', value: formatINR(paidAmount), meta: totalAmount > 0 ? `${paidPct}%` : '—', color: '#ff5b4f' },
                                        { label: 'Pending', value: formatINR(pendingAmount), meta: ratePending > 0 ? `${ratePending} rate-pending` : (totalAmount > 0 ? `${100 - paidPct}%` : '—'), color: '#de1d8d' },
                                    ].map((cell, i, arr) => (
                                        <div
                                            key={cell.label}
                                            className={`p-6 flex flex-col gap-2.5 ${i === 0 ? 'rounded-tl-lg' : ''} ${i === arr.length - 1 ? 'md:rounded-r-lg' : ''} ${i === 1 ? 'md:rounded-tr-lg rounded-tr-lg md:rounded-none' : ''} ${i < arr.length - 1 ? (i === 1 ? 'shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.08)] md:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.08)]' : 'shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.08),inset_0_-1px_0_0_rgba(255,255,255,0.08)] md:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.08)]') : ''} ${i >= 2 ? 'rounded-bl-lg md:rounded-bl-none' : ''}`}
                                        >
                                            <span className="font-geistmono text-[10px] font-medium uppercase text-[#737373]">{cell.label}</span>
                                            <span
                                                className="text-white font-semibold tabular-nums font-geist"
                                                style={{ fontSize: 'clamp(20px, 2.4vw, 26px)', letterSpacing: '-0.6px', lineHeight: 1.1 }}
                                            >
                                                {cell.value}
                                            </span>
                                            <span className="font-geistmono text-[10px] uppercase text-[#525252] tabular-nums">{cell.meta}</span>
                                        </div>
                                    ))}
                                </section>
                            )}

                            {/* ===== TABLE ===== */}
                            <section className="space-y-6">
                                <div
                                    className="flex items-end justify-between gap-4 pb-5 flex-wrap"
                                    style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 1px 0px' }}
                                >
                                    <div>
                                        <span className="font-geistmono text-[11px] font-medium uppercase text-[#737373] mb-2 block">Backlog</span>
                                        <h2
                                            className="text-white font-semibold font-geist leading-[1.0]"
                                            style={{ fontSize: '32px', letterSpacing: '-1.28px' }}
                                        >
                                            All features
                                        </h2>
                                    </div>
                                    {featuresCount > 1 && (
                                        <div className="flex items-center gap-2">
                                            <span className="font-geistmono text-[10px] uppercase text-[#737373] tracking-[0.02em]">Sort</span>
                                            <div className="flex items-center gap-1 rounded-md p-0.5" style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}>
                                                {(['amount', 'status', 'created_at'] as SortField[]).map(field => (
                                                    <button
                                                        key={field}
                                                        onClick={() => {
                                                            if (sortField === field) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                            else { setSortField(field); setSortOrder('asc'); }
                                                        }}
                                                        className={`px-2.5 h-7 rounded text-[11px] font-medium font-geistmono uppercase tracking-[0.02em] flex items-center gap-1 transition-colors ${
                                                            sortField === field
                                                                ? 'bg-white text-[#0a0a0a]'
                                                                : 'text-[#a1a1a1] hover:text-white hover:bg-[#181818]'
                                                        }`}
                                                    >
                                                        {field === 'created_at' ? 'Date' : field}
                                                        {sortField === field && (sortOrder === 'asc' ? <ArrowUp size={10} strokeWidth={2.5} /> : <ArrowDown size={10} strokeWidth={2.5} />)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {featuresCount === 0 ? (
                                    <div
                                        className="rounded-lg py-20 px-6 text-center"
                                        style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                    >
                                        <div
                                            className="inline-flex w-12 h-12 items-center justify-center rounded-md mb-5"
                                            style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        >
                                            <Zap size={18} className="text-[#a1a1a1]" strokeWidth={2} />
                                        </div>
                                        <p className="text-white text-[20px] font-semibold font-geist" style={{ letterSpacing: '-0.4px' }}>
                                            No features yet
                                        </p>
                                        <p className="text-[#a1a1a1] text-[14px] mt-2 max-w-sm mx-auto font-geist">
                                            Click &quot;New feature&quot; to break this project into deliverables.
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        {/* Desktop table */}
                                        <div
                                            className="hidden lg:block rounded-lg"
                                            style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                        >
                                            <div
                                                className="grid grid-cols-12 gap-4 px-6 h-10 items-center font-geistmono text-[10px] font-medium uppercase text-[#737373] rounded-t-lg"
                                                style={{ boxShadow: 'rgba(255,255,255,0.08) 0px -1px 0px inset', background: 'rgba(255,255,255,0.015)' }}
                                            >
                                                <div className="col-span-4">Description</div>
                                                <div className="col-span-1">Date</div>
                                                <div className="col-span-1">Estimate</div>
                                                <div className="col-span-2 text-right">Amount</div>
                                                <div className="col-span-1">Type</div>
                                                <div className="col-span-2">Status</div>
                                                <div className="col-span-1 text-right">Actions</div>
                                            </div>
                                            {sorted.map((feature, idx) => {
                                                const isLast = idx === sorted.length - 1;
                                                const stage = stageFor(feature.status);
                                                const ratePending = feature.payment_confirmed === false;
                                                return (
                                                    <motion.div
                                                        key={feature.id}
                                                        initial={{ opacity: 0 }}
                                                        animate={{ opacity: 1 }}
                                                        transition={{ delay: idx * 0.025, duration: 0.2 }}
                                                        className={`group grid grid-cols-12 gap-4 items-center px-6 py-4 hover:bg-[#0c0c0c] transition-colors ${isLast ? 'rounded-b-lg' : ''}`}
                                                        style={{ boxShadow: idx > 0 ? 'rgba(255,255,255,0.08) 0px 1px 0px inset' : undefined }}
                                                    >
                                                        <div className="col-span-4 min-w-0">
                                                            <p className="text-white text-[14px] font-medium font-geist truncate" style={{ letterSpacing: '-0.28px' }}>
                                                                {feature.description}
                                                            </p>
                                                            {feature.estimation && (
                                                                <p className="text-[#525252] text-[11px] font-geistmono uppercase mt-0.5 lg:hidden">
                                                                    {feature.estimation}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="col-span-1">
                                                            <span className="font-geistmono text-[11px] uppercase text-[#a1a1a1] tabular-nums">
                                                                {feature.created_at ? new Date(feature.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                                                            </span>
                                                        </div>
                                                        <div className="col-span-1">
                                                            <span className="font-geistmono text-[11px] uppercase text-[#737373]">
                                                                {feature.estimation || '—'}
                                                            </span>
                                                        </div>
                                                        <div className="col-span-2 text-right">
                                                            {ratePending ? (
                                                                <span className="inline-flex items-center gap-1.5 px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium" style={{ background: 'rgba(255,164,43,0.12)', color: '#ffa42b' }}>
                                                                    <span className="w-1 h-1 rounded-full bg-[#ffa42b] animate-pulse" />
                                                                    Rate pending
                                                                </span>
                                                            ) : (
                                                                <div className="font-geist">
                                                                    <span className="text-white text-[14px] font-semibold tabular-nums" style={{ letterSpacing: '-0.28px' }}>
                                                                        {formatINR(feature.amount || 0)}
                                                                    </span>
                                                                    {(feature.paid_amount || 0) > 0 && (feature.paid_amount || 0) < (feature.amount || 0) && (
                                                                        <div className="text-[#737373] text-[10px] font-geistmono tabular-nums">
                                                                            {formatINR(feature.paid_amount || 0)} paid
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="col-span-1">
                                                            <span
                                                                className="inline-flex px-2 h-5 items-center rounded-full font-geistmono text-[10px] uppercase font-medium"
                                                                style={feature.is_new_request
                                                                    ? { background: 'rgba(222,29,141,0.12)', color: '#de1d8d' }
                                                                    : { background: 'rgba(10,114,239,0.12)', color: '#3a8dff' }}
                                                            >
                                                                {feature.is_new_request ? 'Extra' : 'Core'}
                                                            </span>
                                                        </div>
                                                        <div className="col-span-2 flex items-center gap-2">
                                                            <span
                                                                className="inline-flex items-center gap-1.5 px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium"
                                                                style={{ background: `${stage.color}1f`, color: stage.color }}
                                                            >
                                                                <span className="w-1 h-1 rounded-full" style={{ background: stage.color }} />
                                                                {stage.label}
                                                            </span>
                                                            {!ratePending && (
                                                                <span
                                                                    className="font-geistmono text-[10px] uppercase tabular-nums"
                                                                    style={{ color: feature.payment_status === 'Paid' ? '#ff5b4f' : feature.payment_status === 'Partial' ? '#de1d8d' : '#737373' }}
                                                                >
                                                                    · {feature.payment_status}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="col-span-1 flex items-center justify-end gap-1">
                                                            <button
                                                                onClick={() => handleEditFeature(feature)}
                                                                aria-label="Edit feature"
                                                                className="h-7 w-7 rounded-md flex items-center justify-center text-[#737373] hover:text-white hover:bg-[#181818] transition-colors"
                                                            >
                                                                <Pencil size={12} strokeWidth={2} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(feature.id, 'features')}
                                                                aria-label="Delete feature"
                                                                className="h-7 w-7 rounded-md flex items-center justify-center text-[#737373] hover:text-[#ff5b4f] hover:bg-[#181818] transition-colors"
                                                            >
                                                                <Trash2 size={12} strokeWidth={2} />
                                                            </button>
                                                        </div>
                                                    </motion.div>
                                                );
                                            })}
                                        </div>

                                        {/* Mobile cards */}
                                        <div className="lg:hidden space-y-3">
                                            {sorted.map((feature, idx) => {
                                                const stage = stageFor(feature.status);
                                                const ratePending = feature.payment_confirmed === false;
                                                return (
                                                    <motion.div
                                                        key={feature.id}
                                                        initial={{ opacity: 0, y: 4 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: idx * 0.03, duration: 0.2 }}
                                                        className="rounded-lg p-5 space-y-4"
                                                        style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <h4 className="text-white text-[15px] font-semibold font-geist flex-1 leading-snug" style={{ letterSpacing: '-0.3px' }}>
                                                                {feature.description}
                                                            </h4>
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <button onClick={() => handleEditFeature(feature)} className="h-7 w-7 rounded-md flex items-center justify-center text-[#737373] hover:text-white hover:bg-[#181818] transition-colors" aria-label="Edit">
                                                                    <Pencil size={12} strokeWidth={2} />
                                                                </button>
                                                                <button onClick={() => handleDelete(feature.id, 'features')} className="h-7 w-7 rounded-md flex items-center justify-center text-[#737373] hover:text-[#ff5b4f] hover:bg-[#181818] transition-colors" aria-label="Delete">
                                                                    <Trash2 size={12} strokeWidth={2} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span
                                                                className="inline-flex items-center gap-1.5 px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium"
                                                                style={{ background: `${stage.color}1f`, color: stage.color }}
                                                            >
                                                                <span className="w-1 h-1 rounded-full" style={{ background: stage.color }} />
                                                                {stage.label}
                                                            </span>
                                                            <span
                                                                className="inline-flex px-2 h-5 items-center rounded-full font-geistmono text-[10px] uppercase font-medium"
                                                                style={feature.is_new_request
                                                                    ? { background: 'rgba(222,29,141,0.12)', color: '#de1d8d' }
                                                                    : { background: 'rgba(10,114,239,0.12)', color: '#3a8dff' }}
                                                            >
                                                                {feature.is_new_request ? 'Extra' : 'Core'}
                                                            </span>
                                                            {feature.estimation && (
                                                                <span className="font-geistmono text-[10px] uppercase text-[#737373]">
                                                                    Est · {feature.estimation}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div
                                                            className="grid grid-cols-3 rounded-md"
                                                            style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                                        >
                                                            <div className="p-3 flex flex-col gap-1" style={{ boxShadow: 'rgba(255,255,255,0.08) -1px 0px 0px inset' }}>
                                                                <span className="font-geistmono text-[9px] font-medium uppercase text-[#737373]">Amount</span>
                                                                {ratePending ? (
                                                                    <span className="font-geistmono text-[10px] uppercase font-medium" style={{ color: '#ffa42b' }}>Pending</span>
                                                                ) : (
                                                                    <span className="text-white text-[14px] font-semibold tabular-nums font-geist" style={{ letterSpacing: '-0.28px' }}>{formatINR(feature.amount || 0)}</span>
                                                                )}
                                                            </div>
                                                            <div className="p-3 flex flex-col gap-1" style={{ boxShadow: 'rgba(255,255,255,0.08) -1px 0px 0px inset' }}>
                                                                <span className="font-geistmono text-[9px] font-medium uppercase text-[#737373]">Paid</span>
                                                                {ratePending ? (
                                                                    <span className="text-[#525252] text-[14px] font-geist">—</span>
                                                                ) : (
                                                                    <span className="text-[14px] font-semibold tabular-nums font-geist" style={{ letterSpacing: '-0.28px', color: (feature.paid_amount || 0) > 0 ? '#ff5b4f' : '#525252' }}>{formatINR(feature.paid_amount || 0)}</span>
                                                                )}
                                                            </div>
                                                            <div className="p-3 flex flex-col gap-1">
                                                                <span className="font-geistmono text-[9px] font-medium uppercase text-[#737373]">Date</span>
                                                                <span className="text-[#a1a1a1] text-[12px] font-geistmono uppercase tabular-nums">{feature.created_at ? new Date(feature.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</span>
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

                    const actionColor: Record<string, string> = {
                        payment_received: '#ff5b4f',
                        rate_confirmed: '#ff5b4f',
                        feature_added: '#0a72ef',
                        feature_updated: '#de1d8d',
                        rate_pending: '#ffa42b',
                        link_added: '#0a72ef',
                        link_updated: '#de1d8d',
                        link_removed: '#ff5b4f',
                        status_changed: '#de1d8d',
                    };

                    return (
                        <div className="space-y-12">
                            {/* ===== COMMAND BAR ===== */}
                            <header className="flex items-center justify-between gap-3 -mt-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <button
                                        onClick={handleBack}
                                        aria-label="Back to clients"
                                        className="h-8 w-8 rounded-md flex items-center justify-center text-[#a1a1a1] hover:text-white hover:bg-[#181818] transition-colors shrink-0"
                                        style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                    >
                                        <ArrowLeft size={13} strokeWidth={2} />
                                    </button>
                                    <span className="font-geistmono text-[12px] font-medium uppercase text-[#a1a1a1] truncate tracking-[0.02em] ml-1">
                                        admin
                                        <span className="text-[#404040] mx-1.5">/</span>
                                        <span className="text-[#737373]">{selectedClient?.name || '—'}</span>
                                        <span className="text-[#404040] mx-1.5">/</span>
                                        <span className="text-white">activity</span>
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={async () => { await supabaseAdmin.auth.signOut(); router.push('/admin'); }}
                                        className="h-9 px-3 rounded-md bg-transparent hover:bg-[#181818] text-[#a1a1a1] hover:text-white flex items-center justify-center gap-2 transition-colors text-[13px] font-medium font-geist"
                                        style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        aria-label="Sign out"
                                    >
                                        <LogOut size={13} strokeWidth={2} />
                                        <span className="hidden sm:inline">Sign out</span>
                                    </button>
                                </div>
                            </header>

                            {/* ===== HERO ===== */}
                            <section className="pt-6 pb-2 max-w-3xl">
                                <h1
                                    className="text-white font-semibold font-geist leading-[0.95]"
                                    style={{ fontSize: 'clamp(40px, 5.6vw, 64px)', letterSpacing: '-0.05em', fontFeatureSettings: '"liga"' }}
                                >
                                    {selectedClient?.name}.<br />
                                    <span className="text-[#525252]">Activity log.</span>
                                </h1>
                                <p className="text-[#a1a1a1] text-[18px] leading-[1.56] mt-6 max-w-xl font-geist">
                                    {totalLogs === 0
                                        ? <>No activity recorded yet for this client.</>
                                        : <><span className="text-white tabular-nums">{totalLogs}</span> {totalLogs === 1 ? 'event' : 'events'} captured · <span className="text-white tabular-nums">{sentCount}</span> notified · <span className="tabular-nums">{pendingCount}</span> awaiting send.</>}
                                </p>
                            </section>

                            {/* ===== EMAIL STATUS ===== */}
                            {!selectedClient.email ? (
                                <div
                                    className="rounded-lg p-5 flex items-center gap-4"
                                    style={{ boxShadow: 'rgba(255,164,43,0.32) 0px 0px 0px 1px, rgba(255,164,43,0.04) 0px 0px 0px 9999px inset' }}
                                >
                                    <div
                                        className="shrink-0 w-9 h-9 rounded-md flex items-center justify-center"
                                        style={{ background: 'rgba(255,164,43,0.12)' }}
                                    >
                                        <Mail size={15} className="text-[#ffa42b]" strokeWidth={2} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-geistmono text-[10px] uppercase font-medium text-[#ffa42b] tracking-[0.04em] mb-1">No email on file</p>
                                        <p className="text-[#a1a1a1] text-[13px] font-geist leading-[1.4]">Add an email to enable notifications and digests.</p>
                                    </div>
                                    <button
                                        onClick={() => handleEditClient(selectedClient)}
                                        className="h-8 px-3 rounded-md text-[13px] font-medium font-geist text-[#ffa42b] hover:bg-[#181818] transition-colors flex items-center gap-1.5"
                                        style={{ boxShadow: 'rgba(255,164,43,0.32) 0px 0px 0px 1px' }}
                                    >
                                        <Plus size={12} strokeWidth={2.5} />
                                        Add email
                                    </button>
                                </div>
                            ) : (
                                <div
                                    className="rounded-lg px-5 py-4 flex items-center gap-3"
                                    style={{ boxShadow: 'rgba(10,114,239,0.28) 0px 0px 0px 1px' }}
                                >
                                    <MailCheck size={14} className="text-[#3a8dff] shrink-0" strokeWidth={2} />
                                    <p className="text-[#a1a1a1] text-[13px] font-geist">
                                        Notifications go to <span className="text-white font-geistmono">{selectedClient.email}</span>
                                    </p>
                                </div>
                            )}

                            {/* ===== BATCH ACTIONS ===== */}
                            {selectedLogIds.size > 0 && selectedClient.email && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="sticky top-3 z-20 rounded-lg px-4 py-3 flex items-center justify-between bg-[#161616]"
                                    style={{ boxShadow: 'rgba(10,114,239,0.5) 0px 0px 0px 1px, rgba(0,0,0,0.7) 0px 12px 32px -4px' }}
                                >
                                    <span className="font-geistmono text-[12px] uppercase font-medium text-white tracking-[0.02em]">
                                        {selectedLogIds.size} <span className="text-[#a1a1a1]">selected</span>
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setSelectedLogIds(new Set())}
                                            className="h-8 px-3 rounded-md text-[12px] font-medium font-geist text-[#a1a1a1] hover:text-white hover:bg-[#181818] transition-colors"
                                            style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        >
                                            Clear
                                        </button>
                                        <button
                                            onClick={handleSendDigest}
                                            disabled={sendingDigest}
                                            className="h-8 px-3.5 rounded-md bg-white hover:bg-[#ededed] text-[#0a0a0a] flex items-center gap-1.5 transition-colors text-[12px] font-medium font-geist disabled:opacity-50"
                                        >
                                            {sendingDigest ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} strokeWidth={2.5} />}
                                            Send digest
                                        </button>
                                    </div>
                                </motion.div>
                            )}

                            {/* ===== TIMELINE ===== */}
                            <section className="space-y-6">
                                <div
                                    className="flex items-end justify-between gap-4 pb-5 flex-wrap"
                                    style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 1px 0px' }}
                                >
                                    <div>
                                        <span className="font-geistmono text-[11px] font-medium uppercase text-[#737373] mb-2 block">Timeline</span>
                                        <h2
                                            className="text-white font-semibold font-geist leading-[1.0]"
                                            style={{ fontSize: '32px', letterSpacing: '-1.28px' }}
                                        >
                                            All events
                                        </h2>
                                    </div>
                                    {totalLogs > 0 && (
                                        <div className="flex items-center gap-3 pb-1 font-geistmono text-[11px] uppercase text-[#737373] tabular-nums">
                                            <span><span className="text-white">{sentCount}</span> sent</span>
                                            <span className="text-[#404040]">·</span>
                                            <span><span className="text-white">{pendingCount}</span> pending</span>
                                            {hiddenCount > 0 && (
                                                <>
                                                    <span className="text-[#404040]">·</span>
                                                    <span><span className="text-white">{hiddenCount}</span> hidden</span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {loadingLogs ? (
                                    <div className="flex justify-center py-16">
                                        <Loader2 className="animate-spin text-[#0a72ef]" size={22} />
                                    </div>
                                ) : totalLogs === 0 ? (
                                    <div
                                        className="rounded-lg py-20 px-6 text-center"
                                        style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                    >
                                        <div
                                            className="inline-flex w-12 h-12 items-center justify-center rounded-md mb-5"
                                            style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        >
                                            <Activity size={18} className="text-[#a1a1a1]" strokeWidth={2} />
                                        </div>
                                        <p className="text-white text-[20px] font-semibold font-geist" style={{ letterSpacing: '-0.4px' }}>
                                            No activity yet
                                        </p>
                                        <p className="text-[#a1a1a1] text-[14px] mt-2 max-w-sm mx-auto font-geist">
                                            Events will appear here as you make changes to projects, features, and payments.
                                        </p>
                                    </div>
                                ) : (
                                    <div
                                        className="rounded-lg"
                                        style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                    >
                                        {activityLogs.map((log, idx) => {
                                            const meta = getActivityMeta(log.action_type);
                                            const stageColor = actionColor[log.action_type] || '#737373';
                                            const isSent = !!log.notified_at;
                                            const isSending = sendingIds.has(log.id);
                                            const isSelected = selectedLogIds.has(log.id);
                                            const isHidden = !!log.is_hidden;
                                            const isFirst = idx === 0;
                                            const isLast = idx === activityLogs.length - 1;

                                            return (
                                                <div
                                                    key={log.id}
                                                    className={`group flex items-start gap-3 px-5 sm:px-6 py-5 transition-colors ${isSelected ? 'bg-[rgba(10,114,239,0.06)]' : 'hover:bg-[#0c0c0c]'} ${isHidden ? 'opacity-60' : ''} ${isFirst ? 'rounded-t-lg' : ''} ${isLast ? 'rounded-b-lg' : ''}`}
                                                    style={{ boxShadow: idx > 0 ? 'rgba(255,255,255,0.08) 0px 1px 0px inset' : undefined }}
                                                >
                                                    <label className="pt-1 shrink-0 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleLogSelection(log.id)}
                                                            className="w-4 h-4 rounded accent-[#0a72ef] cursor-pointer"
                                                        />
                                                    </label>

                                                    <div
                                                        className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center mt-0.5"
                                                        style={{ background: `${stageColor}1f`, color: stageColor, boxShadow: `${stageColor}33 0px 0px 0px 1px` }}
                                                    >
                                                        {meta.icon}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                            <span
                                                                className="inline-flex items-center px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium tracking-[0.02em]"
                                                                style={{ background: `${stageColor}1f`, color: stageColor }}
                                                            >
                                                                {meta.label}
                                                            </span>
                                                            {isHidden && (
                                                                <span className="inline-flex items-center gap-1 px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium text-[#737373]" style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}>
                                                                    <EyeOff size={9} />
                                                                    Hidden
                                                                </span>
                                                            )}
                                                            {log.action_type === 'payment_received' && log.metadata?.paidAmount != null && (
                                                                <span className="inline-flex items-center px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium tabular-nums" style={{ background: 'rgba(255,91,79,0.12)', color: '#ff5b4f' }}>
                                                                    +₹{Number(log.metadata.paidAmount - (log.metadata.oldPaidAmount || 0)).toLocaleString('en-IN')}
                                                                </span>
                                                            )}
                                                            {log.action_type === 'feature_added' && log.metadata?.amount > 0 && (
                                                                <span className="inline-flex items-center px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium tabular-nums" style={{ background: 'rgba(10,114,239,0.12)', color: '#3a8dff' }}>
                                                                    ₹{Number(log.metadata.amount).toLocaleString('en-IN')}
                                                                </span>
                                                            )}
                                                            {log.action_type === 'feature_updated' && log.metadata?.oldAmount !== undefined && log.metadata?.amount !== log.metadata?.oldAmount && (
                                                                <span className="inline-flex items-center gap-1 px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium tabular-nums" style={{ background: 'rgba(255,164,43,0.12)', color: '#ffa42b' }}>
                                                                    ₹{Number(log.metadata.oldAmount).toLocaleString('en-IN')}<ArrowRight size={9} />₹{Number(log.metadata.amount).toLocaleString('en-IN')}
                                                                </span>
                                                            )}
                                                            {log.action_type === 'rate_confirmed' && log.metadata?.amount > 0 && (
                                                                <span className="inline-flex items-center px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium tabular-nums" style={{ background: 'rgba(255,91,79,0.12)', color: '#ff5b4f' }}>
                                                                    ₹{Number(log.metadata.amount).toLocaleString('en-IN')}
                                                                </span>
                                                            )}
                                                            <span className="font-geistmono text-[10px] uppercase text-[#525252] tabular-nums">{getRelativeTime(log.created_at)}</span>
                                                        </div>
                                                        <p className="text-white text-[14px] font-semibold font-geist leading-snug" style={{ letterSpacing: '-0.28px' }}>
                                                            {log.title}
                                                        </p>
                                                        {log.description && (
                                                            <p className="text-[#a1a1a1] text-[12px] mt-1 line-clamp-2 font-geist leading-[1.5]">
                                                                {log.description}
                                                            </p>
                                                        )}

                                                        {log.metadata?.changes && Object.keys(log.metadata.changes).length > 0 && (
                                                            <div
                                                                className="mt-2 space-y-1 rounded-md p-2.5"
                                                                style={{ boxShadow: 'rgba(255,255,255,0.06) 0px 0px 0px 1px' }}
                                                            >
                                                                {Object.entries(log.metadata.changes).map(([key, diff]: [string, any], i) => (
                                                                    <div key={i} className="flex items-center gap-1.5 text-[10px] font-geistmono">
                                                                        <span className="text-[#737373] uppercase">{key}</span>
                                                                        <span className="text-[#525252] line-through">{diff.old || 'none'}</span>
                                                                        <ArrowRight size={9} className="text-[#404040]" />
                                                                        <span className="font-medium tabular-nums" style={{ color: '#3a8dff' }}>{diff.new}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {log.action_type === 'payment_received' && log.metadata?.amount > 0 && (
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <div className="flex-1 h-[2px] rounded-full overflow-hidden max-w-[140px]" style={{ background: '#181818' }}>
                                                                    <div
                                                                        className="h-full rounded-full transition-all"
                                                                        style={{ width: `${Math.min((Number(log.metadata.paidAmount) / Number(log.metadata.amount)) * 100, 100)}%`, background: '#ff5b4f' }}
                                                                    />
                                                                </div>
                                                                <span className="text-[10px] text-[#737373] font-geistmono tabular-nums">
                                                                    ₹{Number(log.metadata.paidAmount).toLocaleString('en-IN')}<span className="text-[#404040]">/</span>₹{Number(log.metadata.amount).toLocaleString('en-IN')}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="shrink-0 flex flex-col items-end gap-2">
                                                        {isSent && (
                                                            <span className="inline-flex items-center gap-1 px-2 h-5 rounded-full font-geistmono text-[10px] uppercase font-medium" style={{ background: 'rgba(10,114,239,0.12)', color: '#3a8dff' }}>
                                                                <MailCheck size={9} />
                                                                Sent · {getRelativeTime(log.notified_at!)}
                                                            </span>
                                                        )}
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => handleSendSingle(log.id)}
                                                                disabled={isSending || !selectedClient?.email}
                                                                className="h-7 px-2 rounded-md text-[11px] font-medium font-geist flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-[#a1a1a1] hover:text-white hover:bg-[#181818]"
                                                                style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                                                title={!selectedClient?.email ? 'Add client email first' : isSent ? 'Resend' : 'Send'}
                                                            >
                                                                {isSending ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} strokeWidth={2} />}
                                                                {isSent ? 'Resend' : 'Send'}
                                                            </button>
                                                            <button
                                                                onClick={() => handleToggleHideLog(log.id, !isHidden)}
                                                                className="h-7 w-7 rounded-md flex items-center justify-center text-[#737373] hover:text-white hover:bg-[#181818] transition-colors"
                                                                title={isHidden ? 'Unhide' : 'Hide from client'}
                                                                aria-label={isHidden ? 'Unhide log' : 'Hide log'}
                                                            >
                                                                {isHidden ? <Eye size={11} strokeWidth={2} /> : <EyeOff size={11} strokeWidth={2} />}
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteLog(log.id)}
                                                                className="h-7 w-7 rounded-md flex items-center justify-center text-[#737373] hover:text-[#ff5b4f] hover:bg-[#181818] transition-colors"
                                                                title="Delete"
                                                                aria-label="Delete log"
                                                            >
                                                                <Trash2 size={11} strokeWidth={2} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        </div>
                    );
                })()}
            </main>

            {/* ========== CREATE MODAL ========== */}
            <AnimatePresence>
                {showModal && (() => {
                    const entityLabel = view === 'clients' ? 'client' : view === 'projects' ? 'project' : view === 'links' ? 'link' : 'feature';
                    const isEditing = !!(editingId || editingLinkIndex !== null);
                    const inputCls = "w-full h-10 px-3 rounded-md bg-transparent text-[14px] text-white placeholder:text-[#525252] outline-none transition-shadow font-geist";
                    const inputStyle: React.CSSProperties = { boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' };
                    const inputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => { e.currentTarget.style.boxShadow = 'rgba(10,114,239,0.6) 0px 0px 0px 1px, rgba(10,114,239,0.20) 0px 0px 0px 3px'; };
                    const inputBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => { e.currentTarget.style.boxShadow = 'rgba(255,255,255,0.10) 0px 0px 0px 1px'; };
                    const labelCls = "block font-geistmono text-[10px] font-medium uppercase text-[#737373] tracking-[0.04em] mb-2";
                    const helpCls = "text-[11px] text-[#525252] mt-1.5 font-geist";
                    return (
                        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm">
                            <motion.div
                                initial={{ opacity: 0, y: 30, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 30, scale: 0.98 }}
                                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                                className="font-geist bg-[#0a0a0a] text-[#ededed] w-full sm:max-w-md rounded-t-lg sm:rounded-lg overflow-hidden max-h-[92vh] sm:max-h-[88vh] flex flex-col"
                                style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px, rgba(0,0,0,0.7) 0px 24px 64px -8px, rgba(0,0,0,0.5) 0px 8px 16px -4px' }}
                            >
                                <div
                                    className="px-5 sm:px-6 py-4 flex justify-between items-center shrink-0"
                                    style={{ boxShadow: 'rgba(255,255,255,0.08) 0px -1px 0px inset' }}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-geistmono text-[10px] font-medium uppercase text-[#0a72ef] tracking-[0.04em]">
                                            {isEditing ? 'Edit' : 'New'}
                                        </span>
                                        <span className="text-[#404040]">/</span>
                                        <h3 className="font-geist text-[15px] text-white font-semibold capitalize truncate" style={{ letterSpacing: '-0.3px' }}>
                                            {entityLabel}
                                        </h3>
                                    </div>
                                    <button
                                        onClick={() => { setShowModal(false); setEditingId(null); setEditingLinkIndex(null); }}
                                        aria-label="Close"
                                        className="h-8 w-8 rounded-md flex items-center justify-center text-[#737373] hover:text-white hover:bg-[#181818] transition-colors"
                                    >
                                        <X size={14} strokeWidth={2} />
                                    </button>
                                </div>

                                <div className="p-5 sm:p-6 space-y-5 overflow-y-auto custom-scrollbar">
                                    {/* ===== CLIENT FORM ===== */}
                                    {view === 'clients' && (
                                        <>
                                            <div>
                                                <label className={labelCls}>Client name</label>
                                                <input value={formData.name || ''} autoComplete="off" data-form-type="other" placeholder="Acme Studio" className={inputCls} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Access key</label>
                                                <input value={formData.access_key || ''} autoComplete="off" data-form-type="other" placeholder="acme-9281" className={`${inputCls} font-geistmono`} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, access_key: e.target.value })} />
                                                <p className={helpCls}>Unique identifier the client will use to log in.</p>
                                            </div>
                                            <div>
                                                <label className={labelCls}>Email <span className="text-[#525252] normal-case">(optional)</span></label>
                                                <input value={formData.email || ''} type="email" autoComplete="off" data-form-type="other" placeholder="hello@acme.com" className={inputCls} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                                <p className={helpCls}>Required for sending notifications.</p>
                                            </div>
                                        </>
                                    )}

                                    {/* ===== PROJECT FORM ===== */}
                                    {view === 'projects' && (
                                        <>
                                            <div>
                                                <label className={labelCls}>Description</label>
                                                <input value={formData.description || ''} placeholder="Marketing site redesign" className={inputCls} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Category</label>
                                                <input value={formData.category || ''} placeholder="Web Development" className={inputCls} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, category: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Status</label>
                                                <input value={formData.status || ''} placeholder="In Progress" className={inputCls} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, status: e.target.value })} />
                                            </div>
                                        </>
                                    )}

                                    {/* ===== LINK FORM ===== */}
                                    {view === 'links' && (
                                        <>
                                            <div>
                                                <label className={labelCls}>Title</label>
                                                <input value={formData.link_title || ''} placeholder="Figma design" className={inputCls} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, link_title: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>URL</label>
                                                <input value={formData.link_url || ''} placeholder="https://..." className={`${inputCls} font-geistmono`} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, link_url: e.target.value })} />
                                            </div>
                                        </>
                                    )}

                                    {/* ===== FEATURE FORM ===== */}
                                    {view === 'features' && (
                                        <>
                                            <div>
                                                <label className={labelCls}>Feature description</label>
                                                <input value={formData.description || ''} placeholder="Dark mode toggle" className={inputCls} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Estimation</label>
                                                <input value={formData.estimation || ''} placeholder="2 days" className={inputCls} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, estimation: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Type</label>
                                                <select
                                                    value={formData.is_new_request || 'false'}
                                                    className={`${inputCls} appearance-none bg-[#0a0a0a]`}
                                                    style={inputStyle}
                                                    onFocus={inputFocus}
                                                    onBlur={inputBlur}
                                                    onChange={e => setFormData({ ...formData, is_new_request: e.target.value })}
                                                >
                                                    <option value="false" className="bg-[#161616]">No · Core feature</option>
                                                    <option value="true" className="bg-[#161616]">Yes · Extra request</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className={labelCls}>Status</label>
                                                <select
                                                    className={`${inputCls} appearance-none bg-[#0a0a0a]`}
                                                    style={inputStyle}
                                                    onFocus={inputFocus}
                                                    onBlur={inputBlur}
                                                    onChange={e => setFormData({ ...formData, status: e.target.value })}
                                                    value={formData.status || 'Requested'}
                                                >
                                                    {['Requested', 'Approved', 'Working', 'Updating', 'Completed'].map(s => (
                                                        <option key={s} value={s} className="bg-[#161616]">{s}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            {/* Payment Confirmed Toggle */}
                                            <div
                                                className="rounded-md p-4"
                                                style={{ boxShadow: 'rgba(255,255,255,0.08) 0px 0px 0px 1px' }}
                                            >
                                                <div className="flex items-center justify-between gap-4">
                                                    <div className="min-w-0">
                                                        <label className="block font-geistmono text-[10px] font-medium uppercase text-[#737373] tracking-[0.04em] mb-1">Payment confirmed</label>
                                                        <p className="text-[12px] text-[#a1a1a1] font-geist leading-[1.4]">
                                                            {formData.payment_confirmed !== false
                                                                ? 'Rate locked — amount fields visible to client.'
                                                                : 'Rate pending — client sees “Rate pending”.'}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        role="switch"
                                                        aria-checked={formData.payment_confirmed !== false}
                                                        onClick={() => setFormData({ ...formData, payment_confirmed: !formData.payment_confirmed })}
                                                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                                                            formData.payment_confirmed !== false ? 'bg-[#0a72ef]' : 'bg-[#262626]'
                                                        }`}
                                                    >
                                                        <span
                                                            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200 ${
                                                                formData.payment_confirmed !== false ? 'translate-x-6' : 'translate-x-1'
                                                            }`}
                                                        />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Amount fields */}
                                            {formData.payment_confirmed !== false && (
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className={labelCls}>Amount <span className="text-[#525252] normal-case">(₹)</span></label>
                                                        <input value={formData.amount ?? ''} type="number" placeholder="5000" className={`${inputCls} tabular-nums font-geistmono`} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, amount: e.target.value })} />
                                                    </div>
                                                    <div>
                                                        <label className={labelCls}>Paid <span className="text-[#525252] normal-case">(₹)</span></label>
                                                        <input value={formData.paid_amount ?? ''} type="number" placeholder="2500" className={`${inputCls} tabular-nums font-geistmono`} style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} onChange={e => setFormData({ ...formData, paid_amount: e.target.value })} />
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* Footer actions */}
                                    <div className="flex items-center gap-2 pt-2">
                                        <button
                                            onClick={() => { setShowModal(false); setEditingId(null); setEditingLinkIndex(null); }}
                                            className="h-10 px-4 rounded-md bg-transparent hover:bg-[#181818] text-[#a1a1a1] hover:text-white flex items-center justify-center transition-colors text-[13px] font-medium font-geist"
                                            style={{ boxShadow: 'rgba(255,255,255,0.10) 0px 0px 0px 1px' }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={view === 'clients' ? handleSaveClient : view === 'projects' ? handleSaveProject : view === 'links' ? handleAddLink : handleSaveFeature}
                                            disabled={saving}
                                            className="flex-1 h-10 px-4 rounded-md bg-white hover:bg-[#ededed] text-[#0a0a0a] flex items-center justify-center gap-1.5 transition-colors text-[13px] font-medium font-geist disabled:opacity-50 disabled:cursor-not-allowed"
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
        </div>
    );
}
