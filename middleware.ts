import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_HOST, PUBLIC_HOST } from '@/lib/hosts';

export function middleware(req: NextRequest) {
    const host = (req.headers.get('host') ?? '').split(':')[0];
    const path = req.nextUrl.pathname;

    if (host === PUBLIC_HOST && path.startsWith('/admin')) {
        return new NextResponse('Not found', { status: 404 });
    }

    if (host === ADMIN_HOST) {
        if (path === '/') {
            return NextResponse.redirect(new URL('/admin', req.url));
        }
        if (!path.startsWith('/admin')) {
            return new NextResponse('Not found', { status: 404 });
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\..*).*)'],
};
