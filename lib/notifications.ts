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
        ? `<span style="display: inline-block; border: 1px solid #E5E5E5; color: #000000; padding: 6px 12px; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Amount: ₹${Number(log.metadata.amount).toLocaleString()}</span>`
        : '';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${log.title}</title>
    <style>
        /* Fallback web fonts for clients that support them */
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital@0;1&family=Inter:wght@300;400;500&display=swap');
    </style>
</head>
<body style="margin:0;padding:0;background-color:#F7F7F7;font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F7F7;">
        <tr>
            <td align="center" style="padding: 60px 20px;">
                
                <!-- Minimal Header -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto;">
                    <tr>
                        <td align="center" style="padding-bottom: 30px;">
                            <span style="font-size: 10px; font-weight: 500; color: #000000; letter-spacing: 4px; text-transform: uppercase;">Client Portal</span>
                        </td>
                    </tr>
                </table>

                <!-- Main Content Card -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border: 1px solid #E5E5E5;">
                    
                    <!-- Content Area -->
                    <tr>
                        <td style="padding: 48px;">
                            
                            <!-- Tags / Metadata -->
                            <div style="margin-bottom: 24px;">
                                <span style="display: inline-block; border: 1px solid #E5E5E5; color: #000000; padding: 6px 12px; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">
                                    ${label}
                                </span>
                                ${projectName ? `<span style="display: inline-block; color: #666666; padding: 6px 0 6px 12px; font-size: 10px; font-weight: 400; text-transform: uppercase; letter-spacing: 1px;">// &nbsp;&nbsp;${projectName}</span>` : ''}
                            </div>

                            <!-- Editorial Title -->
                            <h1 style="margin: 0 0 24px 0; font-family: 'Playfair Display', Georgia, serif; font-size: 28px; font-weight: normal; color: #000000; line-height: 1.3;">
                                ${log.title}
                            </h1>

                            <!-- Greeting & Description -->
                            <div style="margin-bottom: 32px; border-left: 2px solid #000000; padding-left: 20px;">
                                <p style="margin: 0 0 12px 0; font-size: 14px; color: #000000; font-weight: 500;">
                                    Dear ${clientName},
                                </p>
                                ${log.description ? `<p style="margin: 0; font-size: 14px; color: #555555; line-height: 1.8; font-weight: 300;">${log.description}</p>` : ''}
                            </div>

                            <!-- Dynamic Badge/Amount Wrapper -->
                            ${amountBadge ? `<div style="margin-bottom: 32px;">${amountBadge}</div>` : ''}

                            <!-- Action Button -->
                            <table role="presentation" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td>
                                        <a href="https://user-update.netlify.app/" style="display: inline-block; background-color: #000000; color: #FFFFFF; padding: 14px 28px; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 2px; text-decoration: none; border: 1px solid #000000;">
                                            View Details
                                        </a>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <!-- Footer Data -->
                    <tr>
                        <td style="padding: 24px 48px; background-color: #FAFAFA; border-top: 1px solid #E5E5E5;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="font-size: 12px; color: #888888; font-weight: 300;">
                                        Timestamp
                                    </td>
                                    <td align="right" style="font-size: 12px; color: #000000; font-weight: 400;">
                                        ${date} &mdash; ${time}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>

                <!-- System Footer -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto;">
                    <tr>
                        <td align="center" style="padding-top: 32px;">
                            <p style="margin: 0; font-size: 11px; color: #999999; line-height: 1.6; font-weight: 300;">
                                This is an automated secure notification.<br>
                                Client Portal &copy; ${new Date().getFullYear()}
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
        const label = log.action_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const date = new Date(log.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const projectName = log.project_id ? projectNames[log.project_id] : '';
        const amountTag = log.metadata?.amount && log.metadata.amount > 0
            ? `<span style="border: 1px solid #E5E5E5; color: #000000; padding: 2px 6px; font-size: 9px; text-transform: uppercase; font-weight: 500; margin-left: 8px;">₹${Number(log.metadata.amount).toLocaleString()}</span>`
            : '';

        return `
            <tr>
                <td style="padding: 24px 0; border-bottom: 1px solid #E5E5E5;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td>
                                <div style="margin-bottom: 8px;">
                                    <span style="font-size: 10px; font-weight: 500; color: #666666; text-transform: uppercase; letter-spacing: 1px;">${date}</span>
                                    <span style="font-size: 10px; font-weight: 500; color: #000000; text-transform: uppercase; letter-spacing: 1px; margin-left: 12px; border: 1px solid #E5E5E5; padding: 2px 6px;">${label}</span>
                                    ${projectName ? `<span style="font-size: 10px; color: #999999; margin-left: 8px;">// ${projectName}</span>` : ''}
                                </div>
                                <h3 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 500; color: #000000; line-height: 1.4;">
                                    ${log.title}${amountTag}
                                </h3>
                                ${log.description ? `<p style="margin: 0; font-size: 13px; color: #555555; line-height: 1.6;">${log.description}</p>` : ''}
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
    <style>
        /* Fallback web fonts for clients that support them */
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital@0;1&family=Inter:wght@300;400;500&display=swap');
    </style>
</head>
<body style="margin:0;padding:0;background-color:#F7F7F7;font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F7F7;">
        <tr>
            <td align="center" style="padding: 60px 20px;">
                
                <!-- Minimal Header -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto;">
                    <tr>
                        <td align="center" style="padding-bottom: 30px;">
                            <span style="font-size: 10px; font-weight: 500; color: #000000; letter-spacing: 4px; text-transform: uppercase;">Client Portal</span>
                        </td>
                    </tr>
                </table>

                <!-- Main Content Card -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border: 1px solid #E5E5E5;">
                    
                    <!-- Content Area -->
                    <tr>
                        <td style="padding: 48px 48px 24px 48px;">
                            
                            <!-- Tags / Metadata -->
                            <div style="margin-bottom: 24px;">
                                <span style="display: inline-block; border: 1px solid #E5E5E5; color: #000000; padding: 6px 12px; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">
                                    Digest
                                </span>
                                <span style="display: inline-block; color: #666666; padding: 6px 0 6px 12px; font-size: 10px; font-weight: 400; text-transform: uppercase; letter-spacing: 1px;">// &nbsp;&nbsp;${logs.length} update${logs.length > 1 ? 's' : ''}</span>
                            </div>

                            <!-- Editorial Title -->
                            <h1 style="margin: 0 0 24px 0; font-family: 'Playfair Display', Georgia, serif; font-size: 28px; font-weight: normal; color: #000000; line-height: 1.3;">
                                Project Update Digest
                            </h1>

                            <!-- Greeting -->
                            <div style="margin-bottom: 8px; border-left: 2px solid #000000; padding-left: 20px;">
                                <p style="margin: 0; font-size: 14px; color: #000000; font-weight: 500;">
                                    Dear ${clientName},
                                </p>
                            </div>

                        </td>
                    </tr>

                    <!-- Timeline Injection Area -->
                    <tr>
                        <td style="padding: 0 48px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="border-top: 1px solid #E5E5E5; padding-top: 32px; padding-bottom: 32px;">
                                        <!-- Injected Timeline Items go here -->
                                        ${timelineItems}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Action Button -->
                    <tr>
                        <td style="padding: 0 48px 48px 48px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center">
                                        <a href="https://user-update.netlify.app/" style="display: inline-block; background-color: #000000; color: #FFFFFF; padding: 14px 28px; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 2px; text-decoration: none; border: 1px solid #000000;">
                                            View Full Timeline
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>

                <!-- System Footer -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto;">
                    <tr>
                        <td align="center" style="padding-top: 32px;">
                            <p style="margin: 0; font-size: 11px; color: #999999; line-height: 1.6; font-weight: 300;">
                                This is an automated secure notification.<br>
                                Client Portal &copy; ${new Date().getFullYear()}
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

        await transporter.sendMail({
            from: `"Client Portal" <${process.env.GMAIL_EMAIL}>`,
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
            from: `"Client Portal" <${process.env.GMAIL_EMAIL}>`,
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
