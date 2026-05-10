export const ADMIN_HOST = 'admin.raisun.dev';
export const PUBLIC_HOST = 'track.raisun.dev';

export const ADMIN_ORIGIN = `https://${ADMIN_HOST}`;
export const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`;

export function isAdminHost(host: string | null | undefined): boolean {
    return host === ADMIN_HOST;
}

export function isPublicHost(host: string | null | undefined): boolean {
    return host === PUBLIC_HOST;
}
