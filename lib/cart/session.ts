import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "poc_session_id";

export async function getSessionCookieId() {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function getOrCreateSessionId() {
  const existing = await getSessionCookieId();
  if (existing) {
    return { sessionId: existing, shouldSetCookie: false };
  }
  return {
    sessionId: `sess_${randomUUID().replace(/-/g, "")}`,
    shouldSetCookie: true,
  };
}

export function setSessionCookie(response: NextResponse, sessionId: string) {
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}
