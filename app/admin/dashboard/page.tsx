'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { logActivity, type ActivityLog } from '@/lib/activityLogger';
import { sendNotification, sendDigestNotification } from '@/lib/notifications';
import { Users, Plus, FolderPlus, Trash2, ArrowLeft, X, Loader2, Pencil, LogOut, ArrowUp, ArrowDown, Calendar, Mail, MailCheck, Send, CheckCircle2, Clock, Zap, CreditCard, FileText, Link2, Activity, RefreshCw, PackagePlus, ArrowRight, EyeOff, Eye, Search, Copy, Check, Briefcase, TrendingUp, Hash, UserPlus } from 'lucide-react';
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
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 font-sans">
            <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/70 px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-20">
                <div className="flex items-center justify-between gap-2 max-w-7xl mx-auto">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        {view !== 'clients' && (
                            <button onClick={handleBack} className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition-colors shrink-0">
                                <ArrowLeft size={18} className="sm:w-5 sm:h-5" />
                            </button>
                        )}
                        {view === 'clients' && (
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center text-white shadow-md shadow-violet-200/60 shrink-0">
                                <Users size={18} />
                            </div>
                        )}
                        <div className="min-w-0">
                            <h1 className="font-black text-base sm:text-lg tracking-tight">Admin Dashboard</h1>
                            <p className="text-[11px] sm:text-xs text-slate-500 truncate max-w-[200px] sm:max-w-none">
                                {view === 'clients' ? 'Manage all clients and portfolio' :
                                    view === 'projects' ? `Projects for ${selectedClient?.name}` :
                                        view === 'links' ? `Links for ${selectedProject?.description}` :
                                            view === 'activity' ? `Activity Log for ${selectedClient?.name}` :
                                                `Features for ${selectedProject?.description?.substring(0, 20)}...`}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                        {view !== 'activity' && (
                            <button
                                onClick={() => { setFormData({}); setEditingId(null); setEditingLinkIndex(null); setShowModal(true); }}
                                className="bg-slate-900 hover:bg-slate-800 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 sm:gap-2 transition-all active:scale-[0.97] shadow-sm"
                            >
                                <Plus size={14} className="sm:w-4 sm:h-4" strokeWidth={2.5} />
                                <span className="hidden sm:inline">{view === 'clients' ? 'Add Client' : view === 'projects' ? 'Add Project' : view === 'links' ? 'Add Link' : 'Add Feature'}</span>
                                <span className="sm:hidden">Add</span>
                            </button>
                        )}
                        <button
                            onClick={async () => { await supabaseAdmin.auth.signOut(); router.push('/admin'); }}
                            className="p-2 sm:p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                            title="Logout"
                        >
                            <LogOut size={18} className="sm:w-5 sm:h-5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className={`${view === 'clients' ? 'max-w-7xl' : 'max-w-5xl'} mx-auto p-4 sm:p-6`}>
                {loading && (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 loader-dot"></span>
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 loader-dot"></span>
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 loader-dot"></span>
                        </div>
                        <p className="text-slate-400 text-sm font-medium">Loading...</p>
                    </div>
                )}

                {/* ========== CLIENTS VIEW ========== */}
                {view === 'clients' && !loading && (() => {
                    // Overall portfolio stats
                    const totalClients = clients.length;
                    const totalProjects = clients.reduce((a, c) => a + c.stats.projectCount, 0);
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

                    // Per-client gradient palette (consistent by name hash)
                    const gradients = [
                        'from-violet-500 via-purple-500 to-fuchsia-500',
                        'from-blue-500 via-cyan-500 to-teal-500',
                        'from-rose-500 via-pink-500 to-purple-500',
                        'from-amber-500 via-orange-500 to-red-500',
                        'from-emerald-500 via-teal-500 to-cyan-500',
                        'from-indigo-500 via-blue-500 to-sky-500',
                        'from-fuchsia-500 via-pink-500 to-rose-500',
                        'from-lime-500 via-green-500 to-emerald-500',
                    ];
                    const gradientFor = (name: string) => {
                        let hash = 0;
                        for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
                        return gradients[hash % gradients.length];
                    };

                    return (
                        <div className="space-y-6">
                            {/* ===== PORTFOLIO STATS ===== */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                                {/* Clients */}
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}
                                    className="relative overflow-hidden bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 p-5 group"
                                >
                                    <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-violet-100 to-purple-50 opacity-60 group-hover:scale-125 transition-transform duration-500" />
                                    <div className="relative">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-xl shadow-md shadow-violet-200">
                                                <Users size={16} />
                                            </div>
                                            <span className="text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Active</span>
                                        </div>
                                        <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-widest">Clients</p>
                                        <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 tabular-nums">{totalClients}</p>
                                        <p className="text-[11px] text-slate-500 mt-1">
                                            <span className="font-semibold text-slate-700">{clientsWithEmail}</span> with email on file
                                        </p>
                                    </div>
                                </motion.div>

                                {/* Projects */}
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
                                    className="relative overflow-hidden bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 p-5 group"
                                >
                                    <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-blue-100 to-cyan-50 opacity-60 group-hover:scale-125 transition-transform duration-500" />
                                    <div className="relative">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="p-2 bg-gradient-to-br from-blue-500 to-cyan-600 text-white rounded-xl shadow-md shadow-blue-200">
                                                <Briefcase size={16} />
                                            </div>
                                            <span className="text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Total</span>
                                        </div>
                                        <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-widest">Projects</p>
                                        <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 tabular-nums">{totalProjects}</p>
                                        <p className="text-[11px] text-slate-500 mt-1">
                                            across <span className="font-semibold text-slate-700">{totalClients}</span> {totalClients === 1 ? 'client' : 'clients'}
                                        </p>
                                    </div>
                                </motion.div>

                                {/* Collected */}
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                                    className="relative overflow-hidden bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 p-5 group"
                                >
                                    <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-emerald-100 to-teal-50 opacity-60 group-hover:scale-125 transition-transform duration-500" />
                                    <div className="relative">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-xl shadow-md shadow-emerald-200">
                                                <TrendingUp size={16} />
                                            </div>
                                            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider tabular-nums">{paidPct}%</span>
                                        </div>
                                        <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-widest">Collected</p>
                                        <p className="text-2xl sm:text-3xl font-black text-emerald-600 mt-1 tabular-nums">₹{totalPaid.toLocaleString('en-IN')}</p>
                                        <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                                            of ₹{totalValue.toLocaleString('en-IN')}
                                        </p>
                                    </div>
                                </motion.div>

                                {/* Pending */}
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
                                    className="relative overflow-hidden bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 p-5 group"
                                >
                                    <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-amber-100 to-orange-50 opacity-60 group-hover:scale-125 transition-transform duration-500" />
                                    <div className="relative">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-xl shadow-md shadow-amber-200">
                                                <Clock size={16} />
                                            </div>
                                            <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Due</span>
                                        </div>
                                        <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-widest">Pending</p>
                                        <p className="text-2xl sm:text-3xl font-black text-amber-600 mt-1 tabular-nums">₹{totalPending.toLocaleString('en-IN')}</p>
                                        <p className="text-[11px] text-slate-500 mt-1">awaiting payment</p>
                                    </div>
                                </motion.div>
                            </div>

                            {/* ===== SEARCH + SORT BAR ===== */}
                            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-2 flex flex-col sm:flex-row gap-2 sm:gap-2 sm:items-center">
                                <div className="relative flex-1">
                                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    <input
                                        value={clientSearch}
                                        onChange={e => setClientSearch(e.target.value)}
                                        placeholder="Search by name, email, or access key…"
                                        className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50 border border-transparent rounded-xl placeholder:text-slate-400 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-300 focus:bg-white outline-none transition-all"
                                    />
                                    {clientSearch && (
                                        <button
                                            type="button"
                                            onClick={() => setClientSearch('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-slate-200 text-slate-500 hover:bg-slate-300 hover:text-slate-700 transition-colors"
                                            aria-label="Clear search"
                                        >
                                            <X size={12} strokeWidth={3} />
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:block pl-1">Sort</span>
                                    <select
                                        value={clientSort}
                                        onChange={e => setClientSort(e.target.value as ClientSortField)}
                                        className="text-sm font-medium bg-slate-50 border border-transparent rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-300 focus:bg-white outline-none cursor-pointer flex-1 sm:flex-none"
                                    >
                                        <option value="recent">Recently Added</option>
                                        <option value="name">Name (A–Z)</option>
                                        <option value="projects">Most Projects</option>
                                        <option value="value">Highest Value</option>
                                    </select>
                                </div>
                                {q && (
                                    <span className="text-[11px] text-slate-400 font-medium px-2 shrink-0">
                                        {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
                                    </span>
                                )}
                            </div>

                            {/* ===== CLIENT GRID ===== */}
                            {filtered.length === 0 ? (
                                <div className="bg-white rounded-2xl border border-dashed border-slate-300 py-20 text-center">
                                    <div className="inline-flex p-5 bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl mb-4">
                                        {clients.length === 0 ? <UserPlus size={32} className="text-slate-400" /> : <Search size={32} className="text-slate-400" />}
                                    </div>
                                    <p className="text-base font-bold text-slate-700">
                                        {clients.length === 0 ? 'No clients yet' : 'No matches found'}
                                    </p>
                                    <p className="text-sm text-slate-400 mt-1 px-4 max-w-sm mx-auto">
                                        {clients.length === 0
                                            ? 'Click "Add Client" in the top right to create your first client.'
                                            : `Nothing matches "${clientSearch}". Try a different search term.`}
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                                    {filtered.map((client, idx) => {
                                        const isCopied = copiedKey === client.access_key;
                                        const hasProjects = client.stats.projectCount > 0;
                                        const gradient = gradientFor(client.name);
                                        const paidPctClient = client.stats.totalValue > 0
                                            ? Math.round((client.stats.paidValue / client.stats.totalValue) * 100)
                                            : 0;
                                        const isFullyPaid = client.stats.totalValue > 0 && client.stats.paidValue >= client.stats.totalValue;
                                        return (
                                            <motion.div
                                                layout
                                                key={client.id}
                                                initial={{ opacity: 0, y: 12 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: idx * 0.04, duration: 0.3, ease: 'easeOut' }}
                                                className="relative bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:shadow-xl hover:-translate-y-1 hover:border-slate-300 transition-all duration-300 flex flex-col group overflow-hidden"
                                            >
                                                {/* Gradient accent stripe */}
                                                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient}`} />

                                                {/* HERO */}
                                                <div className="relative p-5 pb-4">
                                                    {/* Soft gradient glow bg */}
                                                    <div className={`absolute -right-8 -top-8 w-32 h-32 rounded-full bg-gradient-to-br ${gradient} opacity-[0.08] blur-2xl group-hover:opacity-[0.14] transition-opacity duration-500`} />

                                                    <div className="relative flex items-start justify-between gap-3">
                                                        <div className="flex items-center gap-3.5 min-w-0 flex-1">
                                                            <div className={`relative w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} text-white flex items-center justify-center font-black text-lg shadow-lg shadow-slate-200/60 shrink-0 ring-1 ring-white/30`}>
                                                                <span className="drop-shadow-sm">{client.name.charAt(0).toUpperCase()}</span>
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <h3 className="font-bold text-slate-900 text-base leading-tight truncate">{client.name}</h3>
                                                                <div className="flex items-center gap-1.5 mt-1">
                                                                    <Calendar size={10} className="text-slate-400 shrink-0" />
                                                                    <span className="text-[11px] text-slate-500 font-medium truncate">
                                                                        {new Date(client.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                                    </span>
                                                                    {isFullyPaid && (
                                                                        <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                                                                            <CheckCircle2 size={8} />PAID
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-0.5 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                            <button onClick={() => handleEditClient(client)} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors" title="Edit client">
                                                                <Pencil size={13} />
                                                            </button>
                                                            <button onClick={() => handleDelete(client.id, 'clients')} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors" title="Delete client">
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Contact block */}
                                                    <div className="relative mt-4 space-y-2">
                                                        {client.email ? (
                                                            <div className="flex items-center gap-2 text-[11.5px] text-slate-600 bg-slate-50/70 border border-slate-100 rounded-lg px-2.5 py-1.5">
                                                                <Mail size={11} className="shrink-0 text-slate-400" />
                                                                <span className="truncate font-medium">{client.email}</span>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2 text-[11.5px] text-amber-700 bg-amber-50/70 border border-amber-100 rounded-lg px-2.5 py-1.5">
                                                                <Mail size={11} className="shrink-0" />
                                                                <span className="italic font-medium">No email on file</span>
                                                            </div>
                                                        )}
                                                        <div className="flex items-center gap-2 text-[11px] bg-slate-50/70 border border-slate-100 rounded-lg px-2.5 py-1.5">
                                                            <Hash size={11} className="shrink-0 text-slate-400" />
                                                            <code className="font-mono text-slate-600 truncate flex-1 text-[10.5px]">{client.access_key}</code>
                                                            <button
                                                                onClick={() => copyAccessKey(client.access_key)}
                                                                className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-all ${
                                                                    isCopied
                                                                        ? 'bg-emerald-100 text-emerald-600'
                                                                        : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300'
                                                                }`}
                                                                title={isCopied ? 'Copied!' : 'Copy access key'}
                                                            >
                                                                {isCopied ? <Check size={11} strokeWidth={3} /> : <Copy size={11} />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* STATS CHIPS */}
                                                <div className="px-5 pb-4 flex items-center gap-2 flex-wrap">
                                                    <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1 rounded-lg">
                                                        <Briefcase size={11} />
                                                        <span className="text-[11px] font-bold tabular-nums">{client.stats.projectCount}</span>
                                                        <span className="text-[10px] text-blue-500/70 font-medium">
                                                            {hasProjects ? `· ${client.stats.completedProjects} done` : 'projects'}
                                                        </span>
                                                    </div>
                                                    {client.stats.totalValue > 0 && (
                                                        <div className="flex items-center gap-1.5 bg-slate-50 text-slate-700 border border-slate-200 px-2 py-1 rounded-lg">
                                                            <CreditCard size={11} className="text-slate-500" />
                                                            <span className="text-[11px] font-bold tabular-nums">
                                                                ₹{(client.stats.totalValue / 1000).toFixed(client.stats.totalValue >= 100000 ? 0 : 1)}k
                                                            </span>
                                                        </div>
                                                    )}
                                                    {client.stats.totalValue > 0 && (
                                                        <div className={`flex items-center gap-1.5 border px-2 py-1 rounded-lg ${
                                                            isFullyPaid
                                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                                                : paidPctClient >= 50
                                                                    ? 'bg-sky-50 text-sky-700 border-sky-100'
                                                                    : 'bg-amber-50 text-amber-700 border-amber-100'
                                                        }`}>
                                                            <TrendingUp size={11} />
                                                            <span className="text-[11px] font-bold tabular-nums">{paidPctClient}%</span>
                                                            <span className="text-[10px] opacity-70 font-medium">paid</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* PROGRESS */}
                                                {hasProjects && (
                                                    <div className="px-5 pb-4">
                                                        <div className="flex items-center justify-between text-[10px] mb-1.5">
                                                            <span className="font-bold text-slate-400 uppercase tracking-widest">Progress</span>
                                                            <span className="font-black text-slate-700 tabular-nums text-xs">{client.stats.progress}%</span>
                                                        </div>
                                                        <div className="relative h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                                            <motion.div
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${client.stats.progress}%` }}
                                                                transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 + idx * 0.03 }}
                                                                className={`absolute inset-y-0 left-0 rounded-full ${
                                                                    client.stats.progress === 100
                                                                        ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                                                                        : `bg-gradient-to-r ${gradient}`
                                                                }`}
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* ACTIONS */}
                                                <div className="mt-auto flex gap-2 px-4 pb-4">
                                                    <button
                                                        onClick={() => handleClientSelect(client)}
                                                        className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-[13px] transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm"
                                                    >
                                                        <FolderPlus size={14} />
                                                        View Projects
                                                        <ArrowRight size={13} className="opacity-60 group-hover:translate-x-0.5 transition-transform" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleViewActivity(client)}
                                                        className="py-2.5 px-3 bg-white hover:bg-violet-50 text-violet-600 font-semibold rounded-xl text-[13px] transition-colors flex items-center gap-1.5 border border-slate-200 hover:border-violet-200"
                                                        title="Activity log & notifications"
                                                    >
                                                        <Activity size={14} />
                                                    </button>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* ========== PROJECTS VIEW ========== */}
                {view === 'projects' && !loading && (
                    <div className="space-y-4">
                        {projects.map(project => (
                            <motion.div layout key={project.id} className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-3 sm:gap-4 group">
                                {/* Project Info Row */}
                                <div className="flex items-start gap-3 sm:gap-4">
                                    <div className="p-2.5 sm:p-3 bg-blue-50 text-blue-600 rounded-xl shrink-0">
                                        <FolderPlus size={20} className="sm:w-6 sm:h-6" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <h3 className="font-bold text-slate-900 text-sm sm:text-base leading-snug">{project.description}</h3>
                                            <div className="hidden sm:flex items-center gap-2 shrink-0">
                                                <button onClick={() => handleEditProject(project)} className="text-slate-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity p-2">
                                                    <Pencil size={16} />
                                                </button>
                                                <button onClick={() => handleDelete(project.id, 'projects')} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-1.5">
                                            <span className="text-[11px] sm:text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600">{project.category}</span>
                                            <span className={`text-[11px] sm:text-xs font-medium px-2 py-0.5 rounded ${project.status === 'Completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{project.status}</span>
                                            <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-slate-400 px-1.5 py-0.5 whitespace-nowrap">
                                                <Calendar size={10} className="sm:w-[11px] sm:h-[11px]" />
                                                {new Date(project.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="w-full">
                                    <div className="flex justify-between items-end text-xs mb-1.5">
                                        <span className="text-slate-500 font-medium">Progress</span>
                                        <div className="text-right">
                                            <span className="font-bold text-slate-700">{project.stats.progress}%</span>
                                            <span className="text-[10px] text-slate-400 font-normal ml-1">
                                                ({project.stats.completedFeatures}/{project.stats.totalFeatures})
                                            </span>
                                        </div>
                                    </div>
                                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                                        <div
                                            className={`h-full rounded-full transition-all duration-700 ease-out ${project.stats.progress === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                                            style={{ width: `${project.stats.progress}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Financial Summary - Mobile Only */}
                                <div className="grid grid-cols-3 gap-1 bg-slate-50 rounded-lg p-2.5 sm:hidden">
                                    {/* Desktop: table layout */}
                                    <div className="hidden sm:contents">
                                    </div>
                                    {/* Shared: stat blocks that work on both */}
                                    <div className="text-center">
                                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium sm:hidden">Total</p>
                                        <p className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5">₹{project.stats.total}</p>
                                    </div>
                                    <div className="text-center border-x border-slate-200/60">
                                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium sm:hidden">Paid</p>
                                        <p className="text-xs sm:text-sm font-bold text-green-600 mt-0.5">₹{project.stats.paid}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium sm:hidden">Pending</p>
                                        <p className="text-xs sm:text-sm font-bold text-amber-600 mt-0.5">₹{project.stats.pending}</p>
                                    </div>
                                </div>

                                {/* Desktop: table header row (hidden on mobile since labels are inline) */}
                                <div className="hidden sm:block border border-slate-100 rounded-lg overflow-hidden -mt-2">
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

                                {/* Action Buttons */}
                                <div className="flex items-center gap-2 pt-2 border-t border-slate-100 sm:border-0 sm:pt-0 sm:justify-end">
                                    <button onClick={() => handleEditProject(project)} className="sm:hidden p-2 text-slate-400 hover:text-blue-600 rounded-lg border border-slate-200 active:bg-blue-50">
                                        <Pencil size={15} />
                                    </button>
                                    <button onClick={() => handleDelete(project.id, 'projects')} className="sm:hidden p-2 text-slate-300 hover:text-red-500 rounded-lg border border-slate-200 active:bg-red-50">
                                        <Trash2 size={15} />
                                    </button>
                                    <div className="flex-1 sm:flex-none" />
                                    <button
                                        onClick={() => handleProjectLinksSelect(project)}
                                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs sm:text-sm font-medium transition-colors active:bg-slate-300"
                                    >
                                        Links
                                    </button>
                                    <button
                                        onClick={() => handleProjectSelect(project)}
                                        className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors active:bg-blue-800"
                                    >
                                        Manage Features
                                    </button>
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
                            <div key={index} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between gap-3">
                                <div className="overflow-hidden min-w-0 flex-1">
                                    <h4 className="font-semibold text-sm sm:text-base text-slate-900">{link.title}</h4>
                                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-[11px] sm:text-xs text-blue-500 hover:underline truncate block">
                                        {link.url}
                                    </a>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button onClick={() => { setEditingLinkIndex(index); setFormData({ link_title: link.title, link_url: link.url }); setShowModal(true); }} className="p-2 text-slate-300 hover:text-blue-500 transition-colors rounded-md hover:bg-blue-50">
                                        <Pencil size={16} />
                                    </button>
                                    <button onClick={() => handleDeleteLink(index)} className="p-2 text-slate-300 hover:text-red-500 transition-colors rounded-md hover:bg-red-50">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {links.length === 0 && <div className="col-span-full text-center py-10 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">No links added. Click "Add Link" to add one.</div>}
                    </div>
                )}

                {/* ========== FEATURES VIEW ========== */}
                {view === 'features' && !loading && (
                    <div>
                        {/* Sorting Controls */}
                        {features.length > 1 && (
                            <div className="flex items-center justify-between sm:justify-end gap-2 mb-4">
                                <span className="text-xs text-slate-500">Sort by:</span>
                                <div className="flex bg-white border border-slate-200 rounded-lg p-0.5">
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
                                            className={`px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${sortField === field ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
                                        >
                                            {field === 'created_at' ? 'Date' : field.charAt(0).toUpperCase() + field.slice(1)}
                                            {sortField === field && (
                                                sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Desktop Table - hidden on mobile */}
                        <div className="hidden sm:block bg-white rounded-xl border border-slate-200 overflow-x-auto">
                            <table className="w-full text-left text-sm min-w-[700px]">
                                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                                    <tr>
                                        <th className="px-6 py-4">Description</th>
                                        <th className="px-6 py-4">Date</th>
                                        <th className="px-6 py-4">Estimation</th>
                                        <th className="px-6 py-4">Amount (₹)</th>
                                        <th className="px-6 py-4">Type</th>
                                        <th className="px-6 py-4">Status</th>
                                        <th className="px-6 py-4">Payment</th>
                                        <th className="px-6 py-4">Action</th>
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
                                    }).map((feature) => (
                                        <tr key={feature.id} className="hover:bg-slate-50/50">
                                            <td className="px-6 py-4 font-medium text-slate-900">{feature.description}</td>
                                            <td className="px-6 py-4 text-slate-500 text-xs">
                                                {feature.created_at ? new Date(feature.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-'}
                                            </td>
                                            <td className="px-6 py-4 text-slate-600">{feature.estimation || '-'}</td>
                                            <td className="px-6 py-4">
                                                {feature.payment_confirmed === false ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-orange-50 text-orange-600 border border-orange-200">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                                                        Rate Pending
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-900 font-semibold">₹{feature.amount || 0}</span>
                                                )}
                                            </td>
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
                                                {feature.payment_confirmed === false ? (
                                                    <span className="text-xs text-slate-400 italic">—</span>
                                                ) : (
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
                                                )}
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

                        {/* Mobile Cards - shown only on mobile */}
                        <div className="sm:hidden space-y-3">
                            {[...features].sort((a, b) => {
                                let comparison = 0;
                                if (sortField === 'amount') comparison = (a.amount || 0) - (b.amount || 0);
                                else if (sortField === 'status') {
                                    const statusOrder = ['Requested', 'Approved', 'Working', 'Updating', 'Completed'];
                                    comparison = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
                                } else if (sortField === 'created_at') comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                                return sortOrder === 'asc' ? comparison : -comparison;
                            }).map((feature) => (
                                <div key={feature.id} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <h4 className="font-semibold text-slate-900 text-sm leading-snug flex-1">{feature.description}</h4>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button onClick={() => handleEditFeature(feature)} className="p-1.5 text-slate-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors">
                                                <Pencil size={14} />
                                            </button>
                                            <button onClick={() => handleDelete(feature.id, 'features')} className="p-1.5 text-slate-400 hover:text-red-500 rounded-md hover:bg-red-50 transition-colors">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${feature.status === 'Completed' ? 'bg-green-50 text-green-700' : feature.status === 'Working' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{feature.status}</span>
                                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${feature.payment_status === 'Paid' ? 'bg-green-50 text-green-700' : feature.payment_status === 'Partial' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>{feature.payment_status}</span>
                                        {feature.is_new_request ? (
                                            <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-purple-50 text-purple-700">Extra</span>
                                        ) : (
                                            <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700">Core</span>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100">
                                        <div>
                                            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Amount</p>
                                            {feature.payment_confirmed === false ? (
                                                <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-600 border border-orange-200">
                                                    <span className="w-1 h-1 rounded-full bg-orange-400 animate-pulse" />
                                                    Pending
                                                </span>
                                            ) : (
                                                <p className="text-sm font-bold text-slate-900 mt-0.5">₹{feature.amount || 0}</p>
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Paid</p>
                                            {feature.payment_confirmed === false ? (
                                                <span className="text-xs text-slate-300 mt-0.5">—</span>
                                            ) : (
                                                <p className="text-sm font-bold text-green-600 mt-0.5">₹{feature.paid_amount || 0}</p>
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Date</p>
                                            <p className="text-xs text-slate-600 mt-0.5">{feature.created_at ? new Date(feature.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-'}</p>
                                        </div>
                                    </div>
                                    {feature.estimation && (
                                        <p className="text-xs text-slate-500"><span className="font-medium text-slate-400">Est:</span> {feature.estimation}</p>
                                    )}
                                </div>
                            ))}
                            {features.length === 0 && <div className="p-8 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">No features added yet.</div>}
                        </div>
                    </div>
                )}

                {/* ========== ACTIVITY VIEW ========== */}
                {view === 'activity' && !loading && selectedClient && (
                    <div className="space-y-4">
                        {/* Email status banner */}
                        {!selectedClient.email ? (
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                                <Mail size={20} className="text-amber-500 shrink-0" />
                                <div>
                                    <p className="text-sm font-semibold text-amber-800">No email address</p>
                                    <p className="text-xs text-amber-600">Edit this client to add an email before sending notifications.</p>
                                </div>
                                <button
                                    onClick={() => handleEditClient(selectedClient)}
                                    className="ml-auto px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-semibold transition-colors"
                                >
                                    Add Email
                                </button>
                            </div>
                        ) : (
                            <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-3">
                                <MailCheck size={18} className="text-green-600 shrink-0" />
                                <p className="text-sm text-green-700">Notifications will be sent to <strong>{selectedClient.email}</strong></p>
                            </div>
                        )}

                        {/* Batch actions bar */}
                        {selectedLogIds.size > 0 && selectedClient.email && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="bg-blue-600 text-white rounded-xl p-3 flex items-center justify-between sticky top-16 z-10 shadow-lg"
                            >
                                <span className="text-sm font-medium">{selectedLogIds.size} update{selectedLogIds.size > 1 ? 's' : ''} selected</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setSelectedLogIds(new Set())}
                                        className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 rounded-lg text-xs font-semibold transition-colors"
                                    >
                                        Clear
                                    </button>
                                    <button
                                        onClick={handleSendDigest}
                                        disabled={sendingDigest}
                                        className="px-4 py-1.5 bg-white text-blue-700 hover:bg-blue-50 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        {sendingDigest ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                        Send Digest
                                    </button>
                                </div>
                            </motion.div>
                        )}

                        {/* Timeline */}
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                                <div>
                                    <h3 className="font-bold text-slate-900">Activity Timeline</h3>
                                    <p className="text-xs text-slate-400">Click checkboxes to batch-select, or send individually</p>
                                </div>
                                <span className="text-xs text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded">{activityLogs.length} logs</span>
                            </div>

                            {loadingLogs ? (
                                <div className="flex justify-center py-16"><Loader2 className="animate-spin text-blue-500" size={28} /></div>
                            ) : activityLogs.length === 0 ? (
                                <div className="text-center py-16 text-slate-400">
                                    <Activity size={32} className="mx-auto mb-2 text-slate-300" />
                                    <p className="text-sm font-medium">No activity logs yet</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-50">
                                    {activityLogs.map((log) => {
                                        const meta = getActivityMeta(log.action_type);
                                        const isSent = !!log.notified_at;
                                        const isSending = sendingIds.has(log.id);
                                        const isSelected = selectedLogIds.has(log.id);
                                        const isHidden = !!log.is_hidden;

                                        return (
                                            <div key={log.id} className={`flex items-start gap-3 px-5 py-4 hover:bg-slate-50/50 transition-colors ${isSelected ? 'bg-blue-50/30' : ''} ${isHidden ? 'opacity-50' : ''}`}>
                                                {/* Checkbox */}
                                                <div className="pt-1 shrink-0">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleLogSelection(log.id)}
                                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                    />
                                                </div>

                                                {/* Icon */}
                                                <div className={`p-2 rounded-lg ${meta.color} text-white shrink-0 mt-0.5`}>
                                                    {meta.icon}
                                                </div>

                                                {/* Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.textColor} ${meta.bgLight} px-1.5 py-0.5 rounded`}>
                                                            {meta.label}
                                                        </span>
                                                        {isHidden && (
                                                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                                                <EyeOff size={9} />
                                                                Hidden
                                                            </span>
                                                        )}

                                                        {/* Amount badges per action type */}
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

                                                        <span className="text-[10px] text-slate-400 font-medium">{getRelativeTime(log.created_at)}</span>
                                                    </div>
                                                    <p className="text-sm font-semibold text-slate-900 leading-snug">{log.title}</p>
                                                    {log.description && (
                                                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{log.description}</p>
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

                                                {/* Actions */}
                                                <div className="shrink-0 flex flex-col items-end gap-2">
                                                    {isSent && (
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[9px] text-slate-400">{getRelativeTime(log.notified_at!)}</span>
                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-50 text-green-600 text-[10px] font-bold border border-green-200">
                                                                <MailCheck size={9} />
                                                                Sent
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => handleSendSingle(log.id)}
                                                            disabled={isSending || !selectedClient?.email}
                                                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all border ${
                                                                !selectedClient?.email
                                                                    ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                                                                    : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                                                            } disabled:opacity-50`}
                                                            title={!selectedClient?.email ? 'Add client email first' : isSent ? 'Resend this update via email' : 'Send this update via email'}
                                                        >
                                                            {isSending ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                                                            {isSent ? 'Resend' : 'Send'}
                                                        </button>
                                                        <button
                                                            onClick={() => handleToggleHideLog(log.id, !isHidden)}
                                                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all border ${
                                                                isHidden
                                                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'
                                                                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                                                            }`}
                                                            title={isHidden ? 'Unhide — make visible to client' : 'Hide from client view'}
                                                        >
                                                            {isHidden ? <Eye size={10} /> : <EyeOff size={10} />}
                                                            {isHidden ? 'Unhide' : 'Hide'}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteLog(log.id)}
                                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all border bg-red-50 text-red-500 border-red-200 hover:bg-red-100"
                                                            title="Permanently delete this log"
                                                        >
                                                            <Trash2 size={10} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </main>

            {/* ========== CREATE MODAL ========== */}
            <AnimatePresence>
                {showModal && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/30 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, y: 50, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 50, scale: 0.98 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden max-h-[90vh] sm:max-h-[85vh] flex flex-col"
                        >
                            <div className="px-5 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                                <h3 className="font-semibold text-sm sm:text-base">{(editingId || editingLinkIndex !== null) ? 'Edit' : 'Add New'} {view === 'clients' ? 'Client' : view === 'projects' ? 'Project' : view === 'links' ? 'Link' : 'Feature'}</h3>
                                <button onClick={() => { setShowModal(false); setEditingId(null); setEditingLinkIndex(null); }} className="p-1 rounded-md hover:bg-slate-200 transition-colors"><X size={20} className="text-slate-400" /></button>
                            </div>

                            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
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
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Client Email (Optional)</label>
                                            <input value={formData.email || ''} type="email" placeholder="e.g. client@example.com" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                            <p className="text-[11px] text-slate-400 mt-1">Required for sending email notifications</p>
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
                                            <input value={formData.link_title || ''} placeholder="e.g. Figma Design" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, link_title: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">URL</label>
                                            <input value={formData.link_url || ''} placeholder="https://..." className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, link_url: e.target.value })} />
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

                                        {/* Payment Confirmed Toggle */}
                                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700">Payment Confirmed</label>
                                                    <p className="text-xs text-slate-400 mt-0.5">
                                                        {formData.payment_confirmed !== false
                                                            ? 'Rate is confirmed — amount fields visible'
                                                            : 'Rate is pending — "Rate Pending" shown to client'}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, payment_confirmed: !formData.payment_confirmed })}
                                                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                                        formData.payment_confirmed !== false ? 'bg-blue-600' : 'bg-slate-300'
                                                    }`}
                                                >
                                                    <span
                                                        className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform duration-300 ${
                                                            formData.payment_confirmed !== false ? 'translate-x-6' : 'translate-x-1'
                                                        }`}
                                                    />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Amount fields - only show when payment is confirmed */}
                                        {formData.payment_confirmed !== false && (
                                            <>
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹)</label>
                                                    <input value={formData.amount ?? ''} type="number" placeholder="e.g. 5000" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, amount: e.target.value })} />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-slate-700 mb-1">Paid Amount (₹)</label>
                                                    <input value={formData.paid_amount ?? ''} type="number" placeholder="e.g. 2500" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({ ...formData, paid_amount: e.target.value })} />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                <button
                                    onClick={view === 'clients' ? handleSaveClient : view === 'projects' ? handleSaveProject : view === 'links' ? handleAddLink : handleSaveFeature}
                                    disabled={saving}
                                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white py-2 rounded-lg font-medium mt-4"
                                >
                                    {saving ? 'Saving...' : (editingId || editingLinkIndex !== null) ? 'Update Record' : 'Save Record'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
