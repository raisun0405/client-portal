import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'My Project Portal',
        short_name: 'ClientPortal',
        description: 'Secure client dashboard for project tracking.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#3b82f6',
        icons: [
            { src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' },
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
    };
}
