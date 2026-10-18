/**
 * Guards the public demo proxy.
 *
 * Set DEMO_DISABLED=1 to return 503 for every API call.
 * Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to share a
 * sliding window of 5 requests per minute and 30 per day per IP.
 * Without those variables, the same limits are kept in memory on this instance.
 * Do not log API keys, Redis tokens, or provider errors.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

/** Hard ceiling for Anthropic `max_tokens` on this demo. */
export const MAX_OUTPUT_TOKENS = 2048;

const MAX_PER_MINUTE = 5;
const MAX_PER_DAY = 30;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type HitList = number[];

const minuteHits = new Map<string, HitList>();
const dayHits = new Map<string, HitList>();

let upstashLimiters: { minute: Ratelimit; day: Ratelimit } | null | undefined;

function slidingWindowAllow(
  store: Map<string, HitList>,
  key: string,
  windowMs: number,
  limit: number,
  now: number,
): boolean {
  const recent = (store.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    store.set(key, recent);
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  return true;
}

function prune(store: Map<string, HitList>, windowMs: number, now: number) {
  if (store.size < 5_000) return;
  for (const [key, hits] of store) {
    const recent = hits.filter((timestamp) => now - timestamp < windowMs);
    if (recent.length === 0) store.delete(key);
    else store.set(key, recent);
  }
}

function getUpstashLimiters(): { minute: Ratelimit; day: Ratelimit } | null {
  if (upstashLimiters !== undefined) return upstashLimiters;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    upstashLimiters = null;
    return null;
  }
  const redis = new Redis({ url, token, enableTelemetry: false });
  upstashLimiters = {
    minute: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(MAX_PER_MINUTE, "60 s"),
      prefix: "medical-billing-agent:minute",
      analytics: false,
    }),
    day: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(MAX_PER_DAY, "1 d"),
      prefix: "medical-billing-agent:day",
      analytics: false,
    }),
  };
  return upstashLimiters;
}

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim();
    if (ip) return ip.slice(0, 128);
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 128);
  return "unknown";
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function deployedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    for (const part of value.split(",")) {
      const host = part.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (host) hosts.add(host);
    }
  };
  add(req.headers.get("x-forwarded-host"));
  add(req.headers.get("host"));
  add(req.nextUrl?.host);
  add(process.env.VERCEL_URL);
  add(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  add(process.env.VERCEL_BRANCH_URL);
  return hosts;
}

export function sameOriginError(req: NextRequest): NextResponse | null {
  const source = req.headers.get("origin") || req.headers.get("referer");
  if (!source) {
    return NextResponse.json({ error: "Requests must come from this site" }, { status: 403 });
  }
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return NextResponse.json({ error: "Requests must come from this site" }, { status: 403 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Requests must come from this site" }, { status: 403 });
  }
  if (isLocalHostname(parsed.hostname)) return null;
  const allowed = deployedHosts(req);
  const host = parsed.host.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  if (allowed.has(host) || allowed.has(hostname)) return null;
  return NextResponse.json({ error: "Requests must come from this site" }, { status: 403 });
}

export function demoDisabledError(): NextResponse | null {
  if (process.env.DEMO_DISABLED === "1") {
    return NextResponse.json({ error: "This demo is temporarily disabled" }, { status: 503 });
  }
  return null;
}

function tooManyRequests(): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}

async function rateLimitError(req: NextRequest): Promise<NextResponse | null> {
  const ip = clientIp(req);
  const limiters = getUpstashLimiters();
  if (limiters) {
    try {
      const minute = await limiters.minute.limit(ip);
      if (!minute.success) return tooManyRequests();
      const day = await limiters.day.limit(ip);
      if (!day.success) return tooManyRequests();
      return null;
    } catch {
      // Upstash client errors can include the request URL. Do not log them.
      return NextResponse.json({ error: "Rate limiter unavailable" }, { status: 503 });
    }
  }

  const now = Date.now();
  prune(minuteHits, MINUTE_MS, now);
  prune(dayHits, DAY_MS, now);
  if (!slidingWindowAllow(minuteHits, ip, MINUTE_MS, MAX_PER_MINUTE, now)) return tooManyRequests();
  if (!slidingWindowAllow(dayHits, ip, DAY_MS, MAX_PER_DAY, now)) return tooManyRequests();
  return null;
}

/** Kill switch, same-origin check, then per-IP rate limit. Returns a response when the request must stop. */
export async function guardDemoRequest(req: NextRequest): Promise<NextResponse | null> {
  const disabled = demoDisabledError();
  if (disabled) return disabled;
  const origin = sameOriginError(req);
  if (origin) return origin;
  return rateLimitError(req);
}

export function capMaxTokens(requested: number): number {
  if (!Number.isFinite(requested)) return MAX_OUTPUT_TOKENS;
  return Math.max(1, Math.min(Math.floor(requested), MAX_OUTPUT_TOKENS));
}

export function formatZodError(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
