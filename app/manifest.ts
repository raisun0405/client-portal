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
            {
                src: '/favicon.ico',
                sizes: 'any',
                type: 'image/x-icon',
            },
            // You can add more icons here usually (192x192, 512x512 pngs)
        ],
    };
}
