import { MetadataRoute } from 'next';
import { PUBLIC_ORIGIN } from '@/lib/hosts';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/dashboard/', '/admin/', '/api/'],
        },
        sitemap: `${PUBLIC_ORIGIN}/sitemap.xml`,
    };
}
