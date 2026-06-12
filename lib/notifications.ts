'use server';

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_EMAIL,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
});

type ActivityLog = {
    id: string;
    client_id: string;
    project_id: string | null;
    action_type: string;
    title: string;
    description: string | null;
    metadata: Record<string, any>;
    created_at: string;
    notified_at: string | null;
};

// Per-action color + label system — mirrors the client dashboard timeline
// (lib used by app/dashboard/page.tsx getActivityMeta) so emails feel native.
type ActionMeta = { label: string; bg: string; text: string; dot: string };
const ACTION_META: Record<string, ActionMeta> = {
    project_created: { label: 'New Project', bg: '#EFF6FF', text: '#2563EB', dot: '#3B82F6' },
    project_updated: { label: 'Updated', bg: '#F1F5F9', text: '#475569', dot: '#64748B' },
    project_completed: { label: 'Completed', bg: '#ECFDF5', text: '#059669', dot: '#10B981' },
    feature_added: { label: 'Feature Added', bg: '#F5F3FF', text: '#7C3AED', dot: '#8B5CF6' },
    feature_updated: { label: 'Feature Updated', bg: '#F0F9FF', text: '#0284C7', dot: '#0EA5E9' },
    feature_completed: { label: 'Feature Done', bg: '#ECFDF5', text: '#059669', dot: '#10B981' },
    feature_deleted: { label: 'Removed', bg: '#FEF2F2', text: '#DC2626', dot: '#EF4444' },
    payment_received: { label: 'Payment', bg: '#FFFBEB', text: '#D97706', dot: '#F59E0B' },
    link_added: { label: 'Link Added', bg: '#EEF2FF', text: '#4F46E5', dot: '#6366F1' },
    link_updated: { label: 'Link Updated', bg: '#EEF2FF', text: '#4F46E5', dot: '#6366F1' },
    link_removed: { label: 'Link Removed', bg: '#FFF1F2', text: '#E11D48', dot: '#F43F5E' },
    status_changed: { label: 'Status Changed', bg: '#F0FDFA', text: '#0D9488', dot: '#14B8A6' },
    rate_confirmed: { label: 'Rate Confirmed', bg: '#F0FDF4', text: '#16A34A', dot: '#22C55E' },
    rate_pending: { label: 'Rate Pending', bg: '#FFF7ED', text: '#EA580C', dot: '#F97316' },
    package_started: { label: 'Monthly Package', bg: '#F5F3FF', text: '#7C3AED', dot: '#8B5CF6' },
    package_reverted: { label: 'Package Ended', bg: '#F1F5F9', text: '#475569', dot: '#64748B' },
};
const DEFAULT_META: ActionMeta = { label: 'Activity', bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' };
const metaFor = (actionType: string): ActionMeta => ACTION_META[actionType] || DEFAULT_META;

// Shared brand header (logo tile + wordmark) — matches the portal dashboard header.
const BRAND_HEADER = `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto;">
                    <tr>
                        <td align="left" style="padding-bottom:20px;">
                            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                                <td style="width:34px; height:34px; background-color:#EFF6FF; border-radius:10px; text-align:center; vertical-align:middle;">
                                    <img src="https://raw.githubusercontent.com/raisun0405/Mescellanious/main/Spiderman%20listening%20to%20music.jpeg" width="26" height="26" alt="Project Update" style="display:inline-block; width:26px; height:26px; border-radius:7px; object-fit:cover; vertical-align:middle;">
                                </td>
                                <td style="vertical-align:middle; padding-left:10px;">
                                    <span style="font-size:15px; font-weight:600; color:#0F172A; letter-spacing:-0.2px;">Project Update</span>
                                </td>
                            </tr></table>
                        </td>
                    </tr>
                </table>`;

// Shared system footer.
const SYSTEM_FOOTER = `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto;">
                    <tr>
                        <td align="center" style="padding-top:24px;">
                            <p style="margin:0; font-size:11px; color:#94A3B8; line-height:1.6;">
                                This is an automated notification from your project portal.<br>
                                Project Update &copy; ${new Date().getFullYear()}
                            </p>
                        </td>
                    </tr>
                </table>`;

// Generate the activity email — soft slate-blue card matching the client portal.
function generateSingleActivityEmailHTML(log: ActivityLog, clientName: string, projectName?: string): string {
    const meta = metaFor(log.action_type);
    const date = new Date(log.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const time = new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const hasAmount = log.metadata?.amount && log.metadata.amount > 0;

    // Detail card rows (Project + Amount) — only render rows that have data.
    const detailRows: string[] = [];
    if (projectName) {
        detailRows.push(`<tr>
                                    <td style="padding:14px 18px;${hasAmount ? ' border-bottom:1px solid #EEF2F6;' : ''}">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                                            <td style="font-size:12px; color:#94A3B8; font-weight:500;">Project</td>
                                            <td align="right" style="font-size:13px; color:#334155; font-weight:600;">${projectName}</td>
                                        </tr></table>
                                    </td>
                                </tr>`);
    }
    if (hasAmount) {
        detailRows.push(`<tr>
                                    <td style="padding:14px 18px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                                            <td style="font-size:12px; color:#94A3B8; font-weight:500;">Amount</td>
                                            <td align="right" style="font-size:15px; color:#0F172A; font-weight:700;">₹${Number(log.metadata.amount).toLocaleString('en-IN')}</td>
                                        </tr></table>
                                    </td>
                                </tr>`);
    }
    const detailCard = detailRows.length > 0
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC; border:1px solid #F1F5F9; border-radius:12px; margin-bottom:28px;">${detailRows.join('')}</table>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="x-apple-disable-message-reformatting">
    <title>${log.title}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
        @media screen and (max-width: 600px) {
            .wrap { padding: 28px 14px !important; }
            .card-pad { padding: 28px 22px !important; }
            .foot-pad { padding: 18px 22px !important; }
            .title-lg { font-size: 22px !important; }
            .btn-full a { display: block !important; text-align: center !important; }
        }
    </style>
</head>
<body style="margin:0; padding:0; background-color:#F8FAFC; font-family:'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing:antialiased;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#F8FAFC;">${log.title}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;">
        <tr>
            <td align="center" class="wrap" style="padding: 48px 20px;">
${BRAND_HEADER}
                <!-- Main card -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background-color:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; box-shadow:0 1px 2px rgba(15,23,42,0.04);">
                    <tr>
                        <td class="card-pad" style="padding:36px 40px; border-radius:16px 16px 0 0;">

                            <!-- Action label pill -->
                            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                                <tr>
                                    <td style="background-color:${meta.bg}; border-radius:999px; padding:6px 13px;">
                                        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                                            <td style="vertical-align:middle;"><span style="display:inline-block; width:7px; height:7px; border-radius:50%; background-color:${meta.dot};"></span></td>
                                            <td style="vertical-align:middle; padding-left:7px;"><span style="font-size:11px; font-weight:600; color:${meta.text}; text-transform:uppercase; letter-spacing:0.6px;">${meta.label}</span></td>
                                        </tr></table>
                                    </td>
                                </tr>
                            </table>

                            <!-- Title -->
                            <h1 class="title-lg" style="margin:0 0 18px 0; font-size:25px; font-weight:700; color:#0F172A; line-height:1.3; letter-spacing:-0.4px;">
                                ${log.title}
                            </h1>

                            <!-- Greeting + description -->
                            <p style="margin:0 0 ${log.description ? '8px' : '24px'} 0; font-size:14px; color:#0F172A; font-weight:600;">Hi ${clientName},</p>
                            ${log.description ? `<p style="margin:0 0 24px 0; font-size:14px; color:#64748B; line-height:1.7;">${log.description}</p>` : ''}

                            ${detailCard}

                            <!-- CTA -->
                            <table role="presentation" cellpadding="0" cellspacing="0" class="btn-full">
                                <tr>
                                    <td style="border-radius:10px; background-color:#3B82F6;">
                                        <a href="https://user-update.netlify.app/" style="display:inline-block; padding:13px 26px; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:10px; letter-spacing:0.2px;">
                                            View on Dashboard&nbsp;&rarr;
                                        </a>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <!-- Footer strip -->
                    <tr>
                        <td class="foot-pad" style="padding:18px 40px; background-color:#F8FAFC; border-top:1px solid #F1F5F9; border-radius:0 0 16px 16px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                                <td style="font-size:12px; color:#94A3B8; font-weight:500;">Logged on</td>
                                <td align="right" style="font-size:12px; color:#475569; font-weight:600;">${date} &middot; ${time}</td>
                            </tr></table>
                        </td>
                    </tr>
                </table>
${SYSTEM_FOOTER}
            </td>
        </tr>
    </table>
</body>
</html>`;
}

// Generate digest HTML for multiple activities — dot-timeline matching the portal.
function generateDigestEmailHTML(logs: ActivityLog[], clientName: string, projectNames: Record<string, string>): string {
    const timelineItems = logs.map((log) => {
        const meta = metaFor(log.action_type);
        const date = new Date(log.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        const projectName = log.project_id ? projectNames[log.project_id] : '';
        const amountTag = log.metadata?.amount && log.metadata.amount > 0
            ? `<span style="font-weight:500; color:#94A3B8;"> &middot; ₹${Number(log.metadata.amount).toLocaleString('en-IN')}</span>`
            : '';

        return `
                                <tr>
                                    <td style="padding:20px 0; border-top:1px solid #F1F5F9;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                                            <td width="14" style="vertical-align:top; padding-top:5px;"><span style="display:inline-block; width:9px; height:9px; border-radius:50%; background-color:${meta.dot};"></span></td>
                                            <td style="padding-left:12px;">
                                                <div style="margin-bottom:6px;">
                                                    <span style="display:inline-block; font-size:10px; font-weight:600; color:${meta.text}; text-transform:uppercase; letter-spacing:0.5px; background-color:${meta.bg}; border-radius:6px; padding:3px 7px;">${meta.label}</span>
                                                    <span style="font-size:11px; color:#94A3B8; padding-left:8px;">${date}${projectName ? ` &middot; ${projectName}` : ''}</span>
                                                </div>
                                                <p style="margin:0 0 3px 0; font-size:14px; font-weight:600; color:#0F172A;">${log.title}${amountTag}</p>
                                                ${log.description ? `<p style="margin:0; font-size:13px; color:#64748B; line-height:1.6;">${log.description}</p>` : ''}
                                            </td>
                                        </tr></table>
                                    </td>
                                </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="x-apple-disable-message-reformatting">
    <title>Project Update Digest</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
        @media screen and (max-width: 600px) {
            .wrap { padding: 28px 14px !important; }
            .card-pad { padding: 28px 22px !important; }
            .row-pad { padding: 0 22px !important; }
            .foot-pad { padding: 24px 22px !important; }
            .title-lg { font-size: 22px !important; }
            .btn-full a { display: block !important; text-align: center !important; }
        }
    </style>
</head>
<body style="margin:0; padding:0; background-color:#F8FAFC; font-family:'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing:antialiased;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#F8FAFC;">${logs.length} update${logs.length > 1 ? 's' : ''} across your projects.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;">
        <tr>
            <td align="center" class="wrap" style="padding: 48px 20px;">
${BRAND_HEADER}
                <!-- Main card -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background-color:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; box-shadow:0 1px 2px rgba(15,23,42,0.04);">

                    <!-- Header area -->
                    <tr>
                        <td class="card-pad" style="padding:36px 40px 24px 40px; border-radius:16px 16px 0 0;">
                            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                                <tr>
                                    <td style="background-color:#EFF6FF; border-radius:999px; padding:6px 13px;">
                                        <span style="font-size:11px; font-weight:600; color:#2563EB; text-transform:uppercase; letter-spacing:0.6px;">Digest &middot; ${logs.length} update${logs.length > 1 ? 's' : ''}</span>
                                    </td>
                                </tr>
                            </table>
                            <h1 class="title-lg" style="margin:0 0 8px 0; font-size:25px; font-weight:700; color:#0F172A; line-height:1.3; letter-spacing:-0.4px;">
                                Project Update Digest
                            </h1>
                            <p style="margin:0; font-size:14px; color:#64748B; line-height:1.7;">
                                Hi ${clientName}, here's a summary of the latest activity on your projects.
                            </p>
                        </td>
                    </tr>

                    <!-- Timeline -->
                    <tr>
                        <td class="row-pad" style="padding:0 40px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${timelineItems}
                            </table>
                        </td>
                    </tr>

                    <!-- CTA -->
                    <tr>
                        <td class="foot-pad" align="center" style="padding:28px 40px 36px 40px;">
                            <table role="presentation" cellpadding="0" cellspacing="0" class="btn-full" style="width:100%;">
                                <tr>
                                    <td align="center" style="border-radius:10px; background-color:#3B82F6;">
                                        <a href="https://user-update.netlify.app/" style="display:inline-block; padding:13px 26px; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:10px; letter-spacing:0.2px;">
                                            View Full Timeline&nbsp;&rarr;
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
${SYSTEM_FOOTER}
            </td>
        </tr>
    </table>
</body>
</html>`;
}

// Server action: Send single notification
export async function sendNotification(logId: string, clientEmail: string, clientName: string) {
    try {
        // Fetch the log
        const { data: log, error: logError } = await supabaseAdmin
            .from('activity_logs')
            .select('*')
            .eq('id', logId)
            .single();

        if (logError || !log) {
            return { success: false, message: 'Activity log not found.' };
        }

        // Fetch project name if project_id exists
        let projectName = '';
        if (log.project_id) {
            const { data: project } = await supabaseAdmin
                .from('projects')
                .select('description')
                .eq('id', log.project_id)
                .single();
            projectName = project?.description || '';
        }

        const html = generateSingleActivityEmailHTML(log, clientName, projectName);

        await transporter.sendMail({
            from: `"Project Update" <${process.env.GMAIL_EMAIL}>`,
            to: clientEmail,
            subject: log.title,
            html,
        });

        // Mark as notified
        await supabaseAdmin
            .from('activity_logs')
            .update({ notified_at: new Date().toISOString() })
            .eq('id', logId);

        return { success: true, message: 'Notification sent successfully!' };
    } catch (err: any) {
        console.error('sendNotification error:', err);
        return { success: false, message: err.message || 'Unexpected error.' };
    }
}

// Server action: Send digest (batch) notification
export async function sendDigestNotification(logIds: string[], clientEmail: string, clientName: string) {
    try {
        // Fetch all logs
        const { data: logs, error: logsError } = await supabaseAdmin
            .from('activity_logs')
            .select('*')
            .in('id', logIds)
            .order('created_at', { ascending: false });

        if (logsError || !logs || logs.length === 0) {
            return { success: false, message: 'No activity logs found.' };
        }

        // Fetch all relevant project names
        const projectIds = [...new Set(logs.filter(l => l.project_id).map(l => l.project_id))];
        const projectNames: Record<string, string> = {};
        if (projectIds.length > 0) {
            const { data: projects } = await supabaseAdmin
                .from('projects')
                .select('id, description')
                .in('id', projectIds);
            projects?.forEach(p => { projectNames[p.id] = p.description; });
        }

        const html = generateDigestEmailHTML(logs, clientName, projectNames);

        await transporter.sendMail({
            from: `"Project Update" <${process.env.GMAIL_EMAIL}>`,
            to: clientEmail,
            subject: `Project Update Digest — ${logs.length} update${logs.length > 1 ? 's' : ''}`,
            html,
        });

        // Mark all as notified
        const now = new Date().toISOString();
        await supabaseAdmin
            .from('activity_logs')
            .update({ notified_at: now })
            .in('id', logIds);

        return { success: true, message: `Digest with ${logs.length} updates sent successfully!` };
    } catch (err: any) {
        console.error('sendDigestNotification error:', err);
        return { success: false, message: err.message || 'Unexpected error.' };
    }
}
