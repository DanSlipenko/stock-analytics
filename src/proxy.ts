import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

// /api/mcp authenticates with its own bearer token, so Claude can reach it without a browser session.
const PUBLIC_PATHS = ['/login', '/api/login', '/api/mcp'];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret || !process.env.APP_PASSWORD) {
    // Fail closed: a deploy missing these env vars must not serve the portfolio openly.
    return new NextResponse('Login is not configured: set APP_PASSWORD and SESSION_SECRET.', { status: 503 });
  }

  if (await verifySessionToken(secret, request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Static files the PWA needs before sign-in (offline page, icons, manifest, service worker) stay public.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|offline.html|manifest.webmanifest).*)'],
};
