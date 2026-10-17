// Pure HTML builders for client emails.
//
// These live outside lib/notifications.ts on purpose: that file is a
// 'use server' module, where every export has to be an async server action, so
// a plain template function cannot be exported from it. Keeping them here means
// the exact HTML that gets mailed can also be rendered by a script (preview,
// tests) with no transport and no database.
//
// House rules for anything in here:
//   - table-based layout, inline styles, no JavaScript
//   - Outfit with a system fallback stack (Gmail strips web fonts)
//   - no em dashes or en dashes in client-facing copy
import { PUBLIC_ORIGIN } from './hosts';
import type { ProjectStatusSummary } from './portalOps';

// Shared brand header (logo tile + wordmark) — matches the portal dashboard header.
export const BRAND_HEADER = `
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
export const SYSTEM_FOOTER = `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto;">
                    <tr>
                        <td align="center" style="padding-top:24px;">
                            <p style="margin:0; font-size:10px; color:#94A3B8; line-height:1.5;">
                                Automated notification from your project portal &middot; Project Update &copy; ${new Date().getFullYear()}
                            </p>
                        </td>
                    </tr>
                </table>`;

// ---------------------------------------------------------------------------
// Project status update
// ---------------------------------------------------------------------------

const esc = (s: string) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// One palette per project status. `headA`/`headB` are the two lines of the
// hero, so the headline itself says what happened before any copy is read.
type StatusTheme = {
    panel: string; hair: string; label: string; bar: string; track: string;
    eyebrow: string; headA: string; headB: string;
};

const STATUS_THEME: Record<string, StatusTheme> = {
    'Completed': {
        panel: '#ECFDF5', hair: '#A7F3D0', label: '#047857', bar: '#10B981', track: '#D1FAE5',
        eyebrow: 'Project complete', headA: 'Your project is', headB: 'complete.',
    },
    'In Progress': {
        panel: '#FFFBEB', hair: '#FDE68A', label: '#B45309', bar: '#F59E0B', track: '#FDE68A',
        eyebrow: 'Project status', headA: 'Here is where', headB: 'things stand.',
    },
    'Not Started': {
        panel: '#F8FAFC', hair: '#E2E8F0', label: '#475569', bar: '#94A3B8', track: '#E2E8F0',
        eyebrow: 'Project status', headA: 'Everything is set up', headB: 'and ready to go.',
    },
    'On Hold': {
        panel: '#FFF7ED', hair: '#FED7AA', label: '#C2410C', bar: '#F97316', track: '#FED7AA',
        eyebrow: 'Project on hold', headA: 'This project is', headB: 'on hold for now.',
    },
    'Cancelled': {
        panel: '#FFF1F2', hair: '#FECDD3', label: '#BE123C', bar: '#F43F5E', track: '#FECDD3',
        eyebrow: 'Project cancelled', headA: 'This project has', headB: 'been cancelled.',
    },
};

const themeFor = (status: string): StatusTheme => STATUS_THEME[status] || STATUS_THEME['In Progress'];

// Feature chips mirror the status pills in the client portal, so the email and
// the dashboard never disagree about what a colour means.
const FEATURE_CHIP: Record<string, { bg: string; text: string; dot: string }> = {
    Completed: { bg: '#ECFDF5', text: '#047857', dot: '#10B981' },
    Working: { bg: '#EFF6FF', text: '#2563EB', dot: '#3B82F6' },
    Updating: { bg: '#F0F9FF', text: '#0284C7', dot: '#0EA5E9' },
    Approved: { bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' },
    Requested: { bg: '#FFFBEB', text: '#B45309', dot: '#F59E0B' },
};
const chipFor = (status: string) => FEATURE_CHIP[status] || FEATURE_CHIP.Approved;

// How many features to list before falling back to "and N more".
const MAX_ROWS = 12;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The paragraph under the greeting. Written per status, never em dashed. */
export function projectStatusIntro(s: ProjectStatusSummary): string {
    const p = esc(s.project);
    const { totalFeatures: t, completedFeatures: c } = s;
    switch (s.status) {
        case 'Completed':
            return `Every feature on ${p} is finished and delivered. Here is the full list, for your records.`;
        case 'In Progress':
            return c === 0
                ? `Work has started on ${p}. Here is where every feature stands right now.`
                : `Here is the latest on ${p}. ${c} of ${plural(t, 'feature')} are done, and the rest are moving.`;
        case 'Not Started':
            return t === 0
                ? `${p} is set up on your portal. Features will show up here as we scope them out, and you can follow each one from your dashboard.`
                : `${p} is set up with ${plural(t, 'feature')} lined up. Work begins shortly, and you can follow each one as it moves.`;
        case 'On Hold':
            return `${p} is paused for now. Nothing is lost, everything logged so far stays on your dashboard, and we will pick it back up when the time is right.`;
        case 'Cancelled':
            return `${p} has been cancelled, so no further work is planned on it. Everything logged so far stays on your dashboard.`;
        default:
            return `Here is the latest on ${p}.`;
    }
}

function featureRow(f: { description: string; status: string }): string {
    const c = chipFor(f.status);
    return `<tr>
                        <td style="padding:13px 0; border-top:1px solid #F1F5F9;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                                <td style="vertical-align:middle; font-size:14px; font-weight:600; color:#0F172A; line-height:1.5; letter-spacing:-0.1px;">${esc(f.description)}</td>
                                <td align="right" style="vertical-align:middle; padding-left:14px; white-space:nowrap;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" align="right"><tr>
                                        <td style="background-color:${c.bg}; border-radius:999px; height:23px; padding:0 10px; white-space:nowrap;">
                                            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background-color:${c.dot}; vertical-align:middle; margin-right:6px;"></span><span style="font-size:10px; line-height:23px; font-weight:700; color:${c.text}; text-transform:uppercase; letter-spacing:0.08em; vertical-align:middle;">${esc(f.status)}</span>
                                        </td>
                                    </tr></table>
                                </td>
                            </tr></table>
                        </td>
                    </tr>`;
}

/**
 * The project status email. Deliberately carries no money: a package client's
 * features are covered by the retainer and a per-feature client has the payment
 * reminder for that, so this stays a pure progress report.
 */
export function generateProjectStatusHTML(firstName: string, s: ProjectStatusSummary, dateLabel: string): string {
    const t = themeFor(s.status);
    const rows = s.features.slice(0, MAX_ROWS);
    const hidden = s.features.length - rows.length;
    const hasFeatures = s.features.length > 0;

    const progressBlock = hasFeatures
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px; background-color:${t.track}; border-radius:999px;">
                                <tr>
                                    <td width="${s.progress}%" style="background-color:${t.bar}; border-radius:999px; height:7px; line-height:7px; font-size:1px;">&nbsp;</td>
                                    <td style="height:7px; line-height:7px; font-size:1px;">&nbsp;</td>
                                </tr>
                            </table>
                            <p style="margin:9px 0 0 0; font-size:12px; font-weight:600; color:${t.label};">${s.completedFeatures} of ${plural(s.totalFeatures, 'feature')} done</p>`
        : `<p style="margin:10px 0 0 0; font-size:12px; font-weight:600; color:${t.label};">No features added yet</p>`;

    const breakdown = hasFeatures
        ? `<p style="margin:0 0 2px 0; font-size:10.5px; font-weight:800; color:#94A3B8; text-transform:uppercase; letter-spacing:1.6px;">What is in this project</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:${hidden > 0 ? '10' : '26'}px;">
                        ${rows.map(featureRow).join('')}
                    </table>
                    ${hidden > 0 ? `<p style="margin:0 0 24px 0; font-size:12.5px; color:#94A3B8;">and ${plural(hidden, 'more feature')} on your dashboard</p>` : ''}`
        : '';

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(s.project)} status</title>
<style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap');
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    @media screen and (max-width:600px) {
        .wrap { padding:28px 14px !important; }
        .card-pad { padding:30px 24px !important; }
        .foot-pad { padding:16px 24px !important; }
        .h1 { font-size:28px !important; }
        .stat { font-size:24px !important; }
        .pct { font-size:24px !important; }
    }
</style></head>
<body style="margin:0; padding:0; background-color:#F8FAFC; font-family:'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing:antialiased;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#F8FAFC;">${esc(s.project)} is ${esc(s.status)}${hasFeatures ? `. ${s.completedFeatures} of ${plural(s.totalFeatures, 'feature')} done.` : '.'}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;">
        <tr><td align="center" class="wrap" style="padding:48px 20px;">
${BRAND_HEADER}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background-color:#FFFFFF; border:1px solid #E2E8F0; border-radius:16px; box-shadow:0 1px 2px rgba(15,23,42,0.04);">
                <tr><td class="card-pad" style="padding:40px 40px 36px 40px;">

                    <p style="margin:0 0 16px 0; font-size:11px; font-weight:800; color:${t.label}; text-transform:uppercase; letter-spacing:2.5px;">${t.eyebrow}</p>

                    <h1 class="h1" style="margin:0 0 20px 0; font-size:34px; font-weight:800; color:#0F172A; line-height:1.08; letter-spacing:-1px;">
                        ${t.headA}<br><span style="color:#CBD5E1;">${t.headB}</span>
                    </h1>

                    <p style="margin:0 0 6px 0; font-size:14px; color:#0F172A; font-weight:600;">Hi ${esc(firstName)},</p>
                    <p style="margin:0 0 24px 0; font-size:14px; color:#64748B; line-height:1.7;">${projectStatusIntro(s)}</p>

                    <!-- Status panel -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:26px;">
                        <tr><td style="background-color:${t.panel}; border:1px solid ${t.hair}; border-radius:14px; padding:18px 20px 19px 20px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="vertical-align:top;">
                                        <p style="margin:0; font-size:11px; font-weight:700; color:${t.label}; text-transform:uppercase; letter-spacing:1.4px;">${esc(s.project)}</p>
                                        <p class="stat" style="margin:6px 0 0 0; font-size:28px; font-weight:800; color:#0F172A; letter-spacing:-0.5px; line-height:1.1;">${esc(s.status)}</p>
                                    </td>
                                    ${hasFeatures ? `<td align="right" style="vertical-align:top; padding-left:12px; white-space:nowrap;">
                                        <p class="pct" style="margin:0; font-size:28px; font-weight:800; color:${t.label}; letter-spacing:-0.5px; line-height:1.1;">${s.progress}%</p>
                                    </td>` : ''}
                                </tr>
                            </table>
                            ${progressBlock}
                        </td></tr>
                    </table>

                    ${breakdown}

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                        <td style="border-radius:14px; background-color:#0F172A;">
                            <a href="${PUBLIC_ORIGIN}" style="display:block; padding:16px 22px; text-decoration:none; border-radius:14px;">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                                    <td style="font-size:14px; font-weight:700; color:#FFFFFF; letter-spacing:0.2px;">Open the project on your dashboard</td>
                                    <td align="right" style="font-size:16px; font-weight:700; color:#60A5FA;">&#8599;</td>
                                </tr></table>
                            </a>
                        </td>
                    </tr></table>

                    <p style="margin:18px 0 0 0; font-size:12.5px; color:#94A3B8; line-height:1.6;">Anything you want changed? Just reply to this email.</p>

                </td></tr>
                <tr><td class="foot-pad" style="padding:18px 40px; background-color:#F8FAFC; border-top:1px solid #F1F5F9; border-radius:0 0 16px 16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                        <td style="font-size:12px; color:#94A3B8; font-weight:500;">Status as of</td>
                        <td align="right" style="font-size:12px; color:#475569; font-weight:600;">${dateLabel}</td>
                    </tr></table>
                </td></tr>
            </table>
${SYSTEM_FOOTER}
        </td></tr>
    </table>
</body></html>`;
}

/** Subject line. Leads with the project, always carries the recipient's first name. */
export function projectStatusSubject(status: string, project: string, firstName: string): string {
    switch (status) {
        case 'Completed': return `${project} is complete, ${firstName}`;
        case 'Not Started': return `${project} is set up, ${firstName}`;
        case 'On Hold': return `${project} is on hold, ${firstName}`;
        case 'Cancelled': return `${project} has been cancelled, ${firstName}`;
        default: return `An update on ${project}, ${firstName}`;
    }
}
