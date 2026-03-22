'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { logActivity, type ActivityLog } from '@/lib/activityLogger';
import { sendNotification, sendDigestNotification } from '@/lib/notifications';
import { Users, Plus, FolderPlus, Trash2, ArrowLeft, X, Loader2, Pencil, LogOut, ArrowUp, ArrowDown, Calendar, Mail, MailCheck, Send, CheckCircle2, Clock, Zap, CreditCard, FileText, Link2, Activity, RefreshCw, PackagePlus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';


// --- Types ---
type Client = {
    id: string;
    name: string;
    email: string | null;
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
        const { data } = await supabaseAdmin.from('clients').select('*').order('created_at', { ascending: false });
        if (data) setClients(data);
        setLoading(false);
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
        if (!selectedProject) return;
        const newLink = { title: formData.link_title, url: formData.link_url };
        const updatedLinks = [...(selectedProject.links || []), newLink];

        const { error } = await supabaseAdmin
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

            // Log activity
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
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
            <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-10">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                        {view !== 'clients' && (
                            <button onClick={handleBack} className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition-colors shrink-0">
                                <ArrowLeft size={18} className="sm:w-5 sm:h-5" />
                            </button>
                        )}
                        <div className="min-w-0">
                            <h1 className="font-bold text-base sm:text-lg">Admin Dashboard</h1>
                            <p className="text-[11px] sm:text-xs text-slate-500 truncate max-w-[200px] sm:max-w-none">
                                {view === 'clients' ? 'Manage Clients' :
                                    view === 'projects' ? `Projects for ${selectedClient?.name}` :
                                        view === 'links' ? `Links for ${selectedProject?.description}` :
                                            view === 'activity' ? `Activity Log for ${selectedClient?.name}` :
                                                `Features for ${selectedProject?.description?.substring(0, 20)}...`}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
                        {view !== 'activity' && (
                            <button
                                onClick={() => { setFormData({}); setEditingId(null); setShowModal(true); }}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium flex items-center gap-1.5 sm:gap-2 transition-colors"
                            >
                                <Plus size={14} className="sm:w-4 sm:h-4" />
                                <span className="hidden sm:inline">{view === 'clients' ? 'Add Client' : view === 'projects' ? 'Add Project' : view === 'links' ? 'Add Link' : 'Add Feature'}</span>
                                <span className="sm:hidden">Add</span>
                            </button>
                        )}
                        <button
                            onClick={async () => { await supabaseAdmin.auth.signOut(); router.push('/admin'); }}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Logout"
                        >
                            <LogOut size={18} className="sm:w-5 sm:h-5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-4 sm:p-6">
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
                {view === 'clients' && !loading && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {clients.map(client => (
                            <motion.div layout key={client.id} className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
                                <div>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                                            <Users size={20} />
                                        </div>
                                        <div className="flex gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleEditClient(client)} className="text-slate-400 hover:text-blue-600 p-1.5 rounded-md hover:bg-blue-50">
                                                <Pencil size={14} />
                                            </button>
                                            <button onClick={() => handleDelete(client.id, 'clients')} className="text-slate-300 hover:text-red-500 p-1.5 rounded-md hover:bg-red-50">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <h3 className="font-semibold text-base sm:text-lg">{client.name}</h3>
                                    {client.email && (
                                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                                            <Mail size={11} />
                                            {client.email}
                                        </p>
                                    )}
                                    <code className="text-[11px] sm:text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded mt-2 block w-fit break-all">{client.access_key}</code>
                                </div>
                                <div className="flex gap-2 mt-4 sm:mt-6">
                                    <button
                                        onClick={() => handleClientSelect(client)}
                                        className="flex-1 py-2.5 sm:py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 font-medium rounded-lg text-sm transition-colors active:bg-slate-200"
                                    >
                                        View Projects
                                    </button>
                                    <button
                                        onClick={() => handleViewActivity(client)}
                                        className="py-2.5 sm:py-2 px-3 bg-violet-50 hover:bg-violet-100 text-violet-600 font-medium rounded-lg text-sm transition-colors active:bg-violet-200 flex items-center gap-1.5"
                                        title="Activity & Notifications"
                                    >
                                        <Mail size={14} />
                                        <span className="hidden sm:inline">Notify</span>
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                        {clients.length === 0 && <div className="col-span-full text-center py-10 text-slate-400">No clients yet. Click "Add Client" to create one.</div>}
                    </div>
                )}

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
                                <button onClick={() => handleDeleteLink(index)} className="p-2 text-slate-300 hover:text-red-500 transition-colors shrink-0 rounded-md hover:bg-red-50">
                                    <Trash2 size={16} />
                                </button>
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

                                        return (
                                            <div key={log.id} className={`flex items-start gap-3 px-5 py-4 hover:bg-slate-50/50 transition-colors ${isSelected ? 'bg-blue-50/30' : ''}`}>
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
                                                        {log.metadata?.amount && log.metadata.amount > 0 && (
                                                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                                                ₹{Number(log.metadata.amount).toLocaleString()}
                                                            </span>
                                                        )}
                                                        <span className="text-[10px] text-slate-400 font-medium">{getRelativeTime(log.created_at)}</span>
                                                    </div>
                                                    <p className="text-sm font-semibold text-slate-900 leading-snug">{log.title}</p>
                                                    {log.description && (
                                                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{log.description}</p>
                                                    )}
                                                </div>

                                                {/* Send / Sent button */}
                                                <div className="shrink-0 pt-0.5 flex flex-col items-end gap-1.5">
                                                    {isSent && (
                                                        <div className="flex flex-col items-end gap-0.5 mb-1">
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-50 text-green-600 text-[10px] font-bold border border-green-200">
                                                                <MailCheck size={10} />
                                                                Sent
                                                            </span>
                                                            <span className="text-[9px] text-slate-400">
                                                                {getRelativeTime(log.notified_at!)}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={() => handleSendSingle(log.id)}
                                                        disabled={isSending || !selectedClient?.email}
                                                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                                            !selectedClient?.email
                                                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                                                : isSent
                                                                    ? 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 hover:shadow-sm'
                                                                    : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 hover:shadow-sm'
                                                        } disabled:opacity-50`}
                                                        title={!selectedClient?.email ? 'Add client email first' : isSent ? 'Resend this update via email' : 'Send this update via email'}
                                                    >
                                                        {isSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                                        {isSent ? 'Resend' : 'Send'}
                                                    </button>
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
                                <h3 className="font-semibold text-sm sm:text-base">{editingId ? 'Edit' : 'Add New'} {view === 'clients' ? 'Client' : view === 'projects' ? 'Project' : view === 'links' ? 'Link' : 'Feature'}</h3>
                                <button onClick={() => { setShowModal(false); setEditingId(null); }} className="p-1 rounded-md hover:bg-slate-200 transition-colors"><X size={20} className="text-slate-400" /></button>
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
