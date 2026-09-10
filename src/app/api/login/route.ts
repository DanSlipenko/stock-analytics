import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionToken } from '@/lib/session';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export async function POST(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!appPassword || !secret) {
    return NextResponse.json({ error: 'Login is not configured on the server.' }, { status: 503 });
  }

  const { password } = await request.json().catch(() => ({ password: '' }));
  if (typeof password !== 'string' || !timingSafeEqual(sha256(password), sha256(appPassword))) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(secret), {
    httpOnly: true,
    // Plain http on the LAN (phone testing against the dev server) can't store Secure cookies.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
