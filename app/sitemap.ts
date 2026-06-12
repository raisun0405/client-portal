import { MetadataRoute } from 'next';
import { PUBLIC_ORIGIN } from '@/lib/hosts';

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = PUBLIC_ORIGIN;

    return [
        {
            url: baseUrl,
            lastModified: new Date(),
            changeFrequency: 'weekly',
            priority: 1,
        },
        // Add other public pages here if any
    ];
}
