'use server';

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const resend = new Resend(process.env.RESEND_API_KEY);

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

// Generate beautiful HTML email for a single activity
function generateSingleActivityEmailHTML(log: ActivityLog, clientName: string, projectName?: string): string {
    const actionColors: Record<string, { bg: string; text: string; accent: string }> = {
        feature_added: { bg: '#F3E8FF', text: '#7C3AED', accent: '#8B5CF6' },
        feature_updated: { bg: '#E0F2FE', text: '#0369A1', accent: '#0EA5E9' },
        feature_completed: { bg: '#ECFDF5', text: '#047857', accent: '#10B981' },
        feature_deleted: { bg: '#FEF2F2', text: '#B91C1C', accent: '#EF4444' },
        payment_received: { bg: '#FEF3C7', text: '#92400E', accent: '#F59E0B' },
        rate_confirmed: { bg: '#ECFDF5', text: '#047857', accent: '#10B981' },
        rate_pending: { bg: '#FFF7ED', text: '#C2410C', accent: '#F97316' },
        project_created: { bg: '#DBEAFE', text: '#1E40AF', accent: '#3B82F6' },
        project_updated: { bg: '#F1F5F9', text: '#475569', accent: '#64748B' },
        project_completed: { bg: '#ECFDF5', text: '#047857', accent: '#10B981' },
        link_added: { bg: '#EEF2FF', text: '#4338CA', accent: '#6366F1' },
        status_changed: { bg: '#F0FDFA', text: '#0F766E', accent: '#14B8A6' },
    };

    const colors = actionColors[log.action_type] || { bg: '#F1F5F9', text: '#475569', accent: '#64748B' };
    const label = log.action_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const date = new Date(log.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const time = new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    // Amount badge if present
    const amountBadge = log.metadata?.amount && log.metadata.amount > 0
        ? `<span style="display:inline-block;background:${colors.bg};color:${colors.text};padding:4px 12px;border-radius:20px;font-size:14px;font-weight:700;margin-top:8px;">₹${Number(log.metadata.amount).toLocaleString()}</span>`
        : '';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${log.title}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;">
        <tr>
            <td align="center" style="padding:40px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
                    
                    <!-- Header -->
                    <tr>
                        <td style="padding:0 0 32px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td>
                                        <div style="width:40px;height:40px;background:linear-gradient(135deg,#3B82F6,#8B5CF6);border-radius:12px;display:inline-block;vertical-align:middle;"></div>
                                        <span style="font-size:20px;font-weight:800;color:#0F172A;margin-left:12px;vertical-align:middle;letter-spacing:-0.5px;">Client Portal</span>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Main Card -->
                    <tr>
                        <td>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 4px 24px rgba(0,0,0,0.04);">
                                
                                <!-- Accent Bar -->
                                <tr>
                                    <td style="height:4px;background:linear-gradient(90deg,${colors.accent},${colors.text});"></td>
                                </tr>

                                <!-- Content -->
                                <tr>
                                    <td style="padding:32px 32px 24px;">
                                        <!-- Greeting -->
                                        <p style="margin:0 0 24px;font-size:16px;color:#64748B;line-height:1.5;">
                                            Hi <strong style="color:#0F172A;">${clientName}</strong>,
                                        </p>

                                        <!-- Activity Badge -->
                                        <div style="margin-bottom:20px;">
                                            <span style="display:inline-block;background:${colors.bg};color:${colors.text};padding:6px 14px;border-radius:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
                                                ${label}
                                            </span>
                                            ${projectName ? `<span style="display:inline-block;background:#F1F5F9;color:#64748B;padding:6px 14px;border-radius:8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;">${projectName}</span>` : ''}
                                        </div>

                                        <!-- Title -->
                                        <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0F172A;line-height:1.3;letter-spacing:-0.3px;">
                                            ${log.title}
                                        </h1>

                                        <!-- Description -->
                                        ${log.description ? `<p style="margin:0 0 16px;font-size:15px;color:#64748B;line-height:1.6;">${log.description}</p>` : ''}

                                        <!-- Amount badge -->
                                        ${amountBadge}
                                    </td>
                                </tr>

                                <!-- Divider -->
                                <tr>
                                    <td style="padding:0 32px;">
                                        <div style="height:1px;background:#F1F5F9;"></div>
                                    </td>
                                </tr>

                                <!-- Date/Time -->
                                <tr>
                                    <td style="padding:16px 32px 24px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td>
                                                    <span style="font-size:13px;color:#94A3B8;">${date} at ${time}</span>
                                                </td>
                                                <td align="right">
                                                    <a href="#" style="display:inline-block;background:linear-gradient(135deg,#3B82F6,#2563EB);color:#FFFFFF;padding:10px 24px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                                                        View Portal →
                                                    </a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding:32px 0 0;text-align:center;">
                            <p style="margin:0;font-size:12px;color:#94A3B8;line-height:1.6;">
                                This is an automated notification from your Client Portal.<br>
                                You're receiving this because you're a registered client.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

// Generate digest HTML for multiple activities
function generateDigestEmailHTML(logs: ActivityLog[], clientName: string, projectNames: Record<string, string>): string {
    const actionColors: Record<string, { bg: string; text: string; dot: string }> = {
        feature_added: { bg: '#F3E8FF', text: '#7C3AED', dot: '#8B5CF6' },
        feature_updated: { bg: '#E0F2FE', text: '#0369A1', dot: '#0EA5E9' },
        feature_completed: { bg: '#ECFDF5', text: '#047857', dot: '#10B981' },
        feature_deleted: { bg: '#FEF2F2', text: '#B91C1C', dot: '#EF4444' },
        payment_received: { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
        rate_confirmed: { bg: '#ECFDF5', text: '#047857', dot: '#10B981' },
        rate_pending: { bg: '#FFF7ED', text: '#C2410C', dot: '#F97316' },
        project_created: { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' },
        project_updated: { bg: '#F1F5F9', text: '#475569', dot: '#64748B' },
        project_completed: { bg: '#ECFDF5', text: '#047857', dot: '#10B981' },
        link_added: { bg: '#EEF2FF', text: '#4338CA', dot: '#6366F1' },
        status_changed: { bg: '#F0FDFA', text: '#0F766E', dot: '#14B8A6' },
    };

    const timelineItems = logs.map((log) => {
        const colors = actionColors[log.action_type] || { bg: '#F1F5F9', text: '#475569', dot: '#64748B' };
        const label = log.action_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const date = new Date(log.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const projectName = log.project_id ? projectNames[log.project_id] : '';
        const amountTag = log.metadata?.amount && log.metadata.amount > 0
            ? `<span style="background:${colors.bg};color:${colors.text};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;margin-left:6px;">₹${Number(log.metadata.amount).toLocaleString()}</span>`
            : '';

        return `
            <tr>
                <td style="padding:16px 24px;border-bottom:1px solid #F1F5F9;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td width="10" valign="top" style="padding-top:6px;">
                                <div style="width:10px;height:10px;border-radius:50%;background:${colors.dot};"></div>
                            </td>
                            <td style="padding-left:16px;">
                                <div style="margin-bottom:4px;">
                                    <span style="background:${colors.bg};color:${colors.text};padding:3px 10px;border-radius:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">${label}</span>
                                    ${projectName ? `<span style="font-size:10px;color:#94A3B8;margin-left:8px;">${projectName}</span>` : ''}
                                    <span style="font-size:10px;color:#CBD5E1;margin-left:8px;">${date}</span>
                                </div>
                                <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#0F172A;line-height:1.4;">
                                    ${log.title}${amountTag}
                                </p>
                                ${log.description ? `<p style="margin:4px 0 0;font-size:13px;color:#64748B;line-height:1.4;">${log.description}</p>` : ''}
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project Update Digest</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;">
        <tr>
            <td align="center" style="padding:40px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
                    <!-- Header -->
                    <tr>
                        <td style="padding:0 0 32px;">
                            <div style="width:40px;height:40px;background:linear-gradient(135deg,#3B82F6,#8B5CF6);border-radius:12px;display:inline-block;vertical-align:middle;"></div>
                            <span style="font-size:20px;font-weight:800;color:#0F172A;margin-left:12px;vertical-align:middle;letter-spacing:-0.5px;">Client Portal</span>
                        </td>
                    </tr>
                    <!-- Card -->
                    <tr>
                        <td>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 4px 24px rgba(0,0,0,0.04);">
                                <tr><td style="height:4px;background:linear-gradient(90deg,#3B82F6,#8B5CF6);"></td></tr>
                                <tr>
                                    <td style="padding:28px 24px 20px;">
                                        <p style="margin:0 0 4px;font-size:16px;color:#64748B;">Hi <strong style="color:#0F172A;">${clientName}</strong>,</p>
                                        <h1 style="margin:8px 0 4px;font-size:22px;font-weight:800;color:#0F172A;letter-spacing:-0.3px;">Project Update Digest</h1>
                                        <p style="margin:0;font-size:14px;color:#94A3B8;">${logs.length} update${logs.length > 1 ? 's' : ''} for you</p>
                                    </td>
                                </tr>
                                <tr><td style="padding:0 24px;"><div style="height:1px;background:#F1F5F9;"></div></td></tr>
                                ${timelineItems}
                                <tr>
                                    <td style="padding:24px;text-align:center;">
                                        <a href="#" style="display:inline-block;background:linear-gradient(135deg,#3B82F6,#2563EB);color:#FFFFFF;padding:12px 32px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                                            View Full Timeline →
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:32px 0 0;text-align:center;">
                            <p style="margin:0;font-size:12px;color:#94A3B8;line-height:1.6;">
                                This is an automated notification from your Client Portal.<br>
                                You're receiving this because you're a registered client.
                            </p>
                        </td>
                    </tr>
                </table>
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

        const { error: emailError } = await resend.emails.send({
            from: 'Client Portal <onboarding@resend.dev>',
            to: clientEmail,
            subject: log.title,
            html,
        });

        if (emailError) {
            console.error('Email send error:', emailError);
            return { success: false, message: 'Failed to send email: ' + emailError.message };
        }

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

        const { error: emailError } = await resend.emails.send({
            from: 'Client Portal <onboarding@resend.dev>',
            to: clientEmail,
            subject: `Project Update Digest — ${logs.length} update${logs.length > 1 ? 's' : ''}`,
            html,
        });

        if (emailError) {
            console.error('Email send error:', emailError);
            return { success: false, message: 'Failed to send email: ' + emailError.message };
        }

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
