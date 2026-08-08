'use server';

import nodemailer from 'nodemailer';
import { PUBLIC_ORIGIN, ADMIN_ORIGIN } from '@/lib/hosts';
import { monthYearLabel, humanDateRange, planLabel, type Cadence } from '@/lib/packageDates';
import { supabaseService } from '@/lib/supabaseServer';

// Privileged server-side client (secret key). Notifications read logs/projects
// and stamp notified_at; the anon browser is denied by RLS, so this must not
// use the anon key.
const supabaseAdmin = supabaseService();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_EMAIL,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
});

// Where new client-request alerts go (admin inbox).
const ADMIN_NOTIFY_EMAIL = 'rohanvishwakarma471@gmail.com';

// Alert the admin when a client submits a request. Best-effort — callers wrap
// this in try/catch so a mail failure never blocks the request write itself.
export async function notifyAdminOfRequest(input: { clientName: string; title: string; description?: string }): Promise<void> {
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${input.title}</title></head>
<body style="margin:0; padding:0; background-color:#F8FAFC; font-family:'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;"><tr><td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px; margin:0 auto; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px;">
            <tr><td style="padding:32px 36px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:18px;"><tr>
                    <td style="background-color:#EFF6FF; border-radius:7px; height:24px; padding:0 12px;">
                        <span style="font-size:10.5px; line-height:24px; font-weight:700; color:#2563EB; text-transform:uppercase; letter-spacing:0.09em;">New client request</span>
                    </td>
                </tr></table>
                <h1 style="margin:0 0 14px 0; font-size:22px; font-weight:700; color:#0F172A; line-height:1.3; letter-spacing:-0.3px;">${input.title}</h1>
                ${input.description ? `<p style="margin:0 0 24px 0; font-size:14px; color:#475569; line-height:1.7;">${input.description}</p>` : ''}
                <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                    <td style="border-radius:10px; background-color:#3B82F6;">
                        <a href="${ADMIN_ORIGIN}/admin/dashboard" style="display:inline-block; padding:12px 22px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Review in admin&nbsp;&#8599;</a>
                    </td>
                </tr></table>
            </td></tr>
            <tr><td style="padding:16px 36px; background:#F8FAFC; border-top:1px solid #F1F5F9; border-radius:0 0 16px 16px;">
                <p style="margin:0; font-size:11px; color:#94A3B8;">From ${input.clientName} &middot; via the client portal</p>
            </td></tr>
        </table>
    </td></tr></table>
</body></html>`;
    await transporter.sendMail({
        from: `"Client Portal" <${process.env.GMAIL_EMAIL}>`,
        to: ADMIN_NOTIFY_EMAIL,
        subject: `New request — ${input.title}`,
        html,
    });
}

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
    invoice_generated: { label: 'Invoice', bg: '#F5F3FF', text: '#7C3AED', dot: '#8B5CF6' },
    project_requested: { label: 'Requested', bg: '#EFF6FF', text: '#2563EB', dot: '#3B82F6' },
    feature_requested: { label: 'Requested', bg: '#EFF6FF', text: '#2563EB', dot: '#3B82F6' },
    change_requested: { label: 'Change Requested', bg: '#FFF7ED', text: '#EA580C', dot: '#F97316' },
};
const DEFAULT_META: ActionMeta = { label: 'Activity', bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' };
const metaFor = (actionType: string): ActionMeta => ACTION_META[actionType] || DEFAULT_META;

// Shared brand header (logo tile + wordmark) — matches the portal dashboard header.
const BRAND_HEADER = `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto;">
                    <tr>
                        <td align="left" style="padding-bottom:20px;">
                            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                                <td style="width:34px; height:34px; background-color:#C0C0C0; border-radius:17px; text-align:center; vertical-align:middle;">
                                    <img src="${PUBLIC_ORIGIN}/brand-logo.jpg" width="26" height="26" alt="Project Update" style="display:inline-block; width:26px; height:26px; border-radius:13px; object-fit:cover; vertical-align:middle;">
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
                            <p style="margin:0; font-size:10px; color:#94A3B8; line-height:1.5;">
                                Automated notification from your project portal &middot; Project Update &copy; ${new Date().getFullYear()}
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
                                        <a href="${PUBLIC_ORIGIN}" style="display:inline-block; padding:13px 26px; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:10px; letter-spacing:0.2px;">
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

// Dedicated invoice email — a focused billing card (amount + status is the hero),
// used only for `invoice_generated` logs. Pulls everything from the log metadata
// written by generateDuePackagePeriods (amount, period, cadence, payment_status).
function generateInvoiceEmailHTML(log: ActivityLog, clientName: string): string {
    const m = log.metadata || {};
    const amount = `₹${Number(m.amount || 0).toLocaleString('en-IN')}`;
    const month = m.period_start ? monthYearLabel(m.period_start) : '';
    const period = (m.period_start && m.period_end) ? humanDateRange(m.period_start, m.period_end) : '';
    const plan = planLabel((m.cadence || 'monthly') as Cadence);
    const paid = String(m.payment_status || 'Pending').toLowerCase() === 'paid';

    // Status theme: amber for pending (due), green for paid (settled).
    const s = paid
        ? { panel: '#ECFDF5', hair: '#A7F3D0', label: '#047857', pillBg: '#A7F3D0', pillText: '#065F46', dot: '#059669',
            dueLabel: 'Amount paid', pill: 'Paid', caption: `Payment received &middot; ${month}` }
        : { panel: '#FFFBEB', hair: '#FDE68A', label: '#B45309', pillBg: '#FDE68A', pillText: '#92400E', dot: '#D97706',
            dueLabel: 'Amount due', pill: 'Pending', caption: `Payment pending &middot; due for ${month}` };

    const intro = paid
        ? 'Your monthly package invoice has been settled. Here are the details:'
        : 'Your monthly package invoice is ready and currently pending payment. Here are the details:';

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
        }
    </style>
</head>
<body style="margin:0; padding:0; background-color:#F8FAFC; font-family:'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing:antialiased;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#F8FAFC;">${log.title} — ${amount} ${s.pill}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;">
        <tr>
            <td align="center" class="wrap" style="padding: 48px 20px;">
${BRAND_HEADER}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background-color:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; box-shadow:0 1px 2px rgba(15,23,42,0.04);">
                    <tr>
                        <td class="card-pad" style="padding:36px 40px; border-radius:16px 16px 0 0;">

                            <!-- Type tag -->
                            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:20px;"><tr>
                                <td style="background-color:#F5F3FF; border-radius:7px; height:24px; padding:0 12px;">
                                    <span style="font-size:10.5px; line-height:24px; font-weight:700; color:#7C3AED; text-transform:uppercase; letter-spacing:0.09em;">Invoice</span>
                                </td>
                            </tr></table>

                            <!-- Title + greeting -->
                            <h1 class="title-lg" style="margin:0 0 18px 0; font-size:25px; font-weight:700; color:#0F172A; line-height:1.3; letter-spacing:-0.4px;">${log.title}</h1>
                            <p style="margin:0 0 6px 0; font-size:14px; color:#0F172A; font-weight:600;">Hi ${clientName},</p>
                            <p style="margin:0 0 24px 0; font-size:14px; color:#64748B; line-height:1.7;">${intro}</p>

                            <!-- Invoice card -->
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0; border-radius:16px; overflow:hidden;">
                                <!-- Amount header (status = focal point) -->
                                <tr>
                                    <td style="background-color:${s.panel}; padding:14px 20px 15px 20px; border-bottom:1px solid ${s.hair};">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td style="vertical-align:middle; font-size:11px; font-weight:700; letter-spacing:0.09em; text-transform:uppercase; color:${s.label};">${s.dueLabel}</td>
                                                <td align="right" style="vertical-align:middle;">
                                                    <table role="presentation" cellpadding="0" cellspacing="0" align="right"><tr>
                                                        <td style="background-color:${s.pillBg}; border-radius:999px; height:24px; padding:0 12px;">
                                                            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background-color:${s.dot}; vertical-align:middle; margin-right:6px;"></span><span style="font-size:10px; line-height:24px; font-weight:700; color:${s.pillText}; text-transform:uppercase; letter-spacing:0.08em; vertical-align:middle;">${s.pill}</span>
                                                        </td>
                                                    </tr></table>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td colspan="2" style="padding-top:5px; font-size:30px; font-weight:700; color:#0F172A; letter-spacing:-0.02em; line-height:1.15;">${amount}</td>
                                            </tr>
                                            <tr>
                                                <td colspan="2" style="padding-top:3px; font-size:11.5px; font-weight:600; color:${s.label};">${s.caption}</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <!-- Detail rows -->
                                <tr>
                                    <td style="padding:14px 20px 4px 20px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td style="padding-bottom:8px; font-size:12.5px; color:#94A3B8; font-weight:500;">Service period</td>
                                                <td align="right" style="padding-bottom:8px; font-size:13px; color:#0F172A; font-weight:700;">${period}</td>
                                            </tr>
                                            <tr>
                                                <td style="font-size:12.5px; color:#94A3B8; font-weight:500;">Plan</td>
                                                <td align="right" style="font-size:13px; color:#0F172A; font-weight:700;">${plan}</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <!-- CTA -->
                                <tr>
                                    <td style="padding:14px 20px 20px 20px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                                            <td align="center" style="border-radius:12px; background-color:#3B82F6;">
                                                <a href="${PUBLIC_ORIGIN}" style="display:block; padding:14px 20px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:12px; text-align:center; letter-spacing:0.2px;">View on Dashboard&nbsp;&#8599;</a>
                                            </td>
                                        </tr></table>
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
                                <td align="right" style="font-size:12px; color:#475569; font-weight:600;">${new Date(log.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} &middot; ${new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
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
                                        <a href="${PUBLIC_ORIGIN}" style="display:inline-block; padding:13px 26px; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:10px; letter-spacing:0.2px;">
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

// A single resolved recipient: the address plus the greeting name to use.
// `name` is already resolved upstream (recipient's first name, or the
// client's name as a fallback for legacy / un-named addresses).
export type EmailRecipient = { email: string; name: string };

// Server action: Send single notification to one or more recipients.
// Each recipient receives their own email personalised to their name.
export async function sendNotification(logId: string, recipients: EmailRecipient[]) {
    try {
        const cleaned = recipients.filter(r => r.email && r.email.trim());
        if (cleaned.length === 0) {
            return { success: false, message: 'No recipients selected.' };
        }

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

        // Send one personalised email per recipient.
        const results = await Promise.allSettled(cleaned.map(r => {
            const html = log.action_type === 'invoice_generated'
                ? generateInvoiceEmailHTML(log, r.name)
                : generateSingleActivityEmailHTML(log, r.name, projectName);
            return transporter.sendMail({
                from: `"Project Update" <${process.env.GMAIL_EMAIL}>`,
                to: r.email,
                subject: log.title,
                html,
            });
        }));

        const sent = results.filter(r => r.status === 'fulfilled').length;
        const failed = cleaned.length - sent;

        if (sent === 0) {
            return { success: false, message: 'Failed to send to any recipient.' };
        }

        // Mark as notified once at least one email went out.
        await supabaseAdmin
            .from('activity_logs')
            .update({ notified_at: new Date().toISOString() })
            .eq('id', logId);

        const message = failed > 0
            ? `Sent to ${sent} of ${cleaned.length} recipients (${failed} failed).`
            : `Notification sent to ${sent} recipient${sent > 1 ? 's' : ''}!`;
        return { success: true, message };
    } catch (err: any) {
        console.error('sendNotification error:', err);
        return { success: false, message: err.message || 'Unexpected error.' };
    }
}

// Server action: Send digest (batch) notification to one or more recipients.
// Each recipient receives their own digest personalised to their name.
export async function sendDigestNotification(logIds: string[], recipients: EmailRecipient[]) {
    try {
        const cleaned = recipients.filter(r => r.email && r.email.trim());
        if (cleaned.length === 0) {
            return { success: false, message: 'No recipients selected.' };
        }

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

        const subject = `Project Update Digest — ${logs.length} update${logs.length > 1 ? 's' : ''}`;

        // Send one personalised digest per recipient.
        const results = await Promise.allSettled(cleaned.map(r => {
            const html = generateDigestEmailHTML(logs, r.name, projectNames);
            return transporter.sendMail({
                from: `"Project Update" <${process.env.GMAIL_EMAIL}>`,
                to: r.email,
                subject,
                html,
            });
        }));

        const sent = results.filter(r => r.status === 'fulfilled').length;
        const failed = cleaned.length - sent;

        if (sent === 0) {
            return { success: false, message: 'Failed to send to any recipient.' };
        }

        // Mark all as notified once at least one email went out.
        const now = new Date().toISOString();
        await supabaseAdmin
            .from('activity_logs')
            .update({ notified_at: now })
            .in('id', logIds);

        const message = failed > 0
            ? `Digest sent to ${sent} of ${cleaned.length} recipients (${failed} failed).`
            : `Digest with ${logs.length} updates sent to ${sent} recipient${sent > 1 ? 's' : ''}!`;
        return { success: true, message };
    } catch (err: any) {
        console.error('sendDigestNotification error:', err);
        return { success: false, message: err.message || 'Unexpected error.' };
    }
}
