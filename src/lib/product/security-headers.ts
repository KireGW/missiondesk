import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server.js";

export function personalSecurityHeaders(request: NextRequest, auth0Domain?: string) {
  const nonce = randomBytes(18).toString("base64");
  const development = process.env.NODE_ENV !== "production";
  const authOrigin = auth0Domain && /^[a-z0-9.-]+\.auth0\.com$/i.test(auth0Domain)
    ? ` https://${auth0Domain}` : "";
  const restrictions = `base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'${authOrigin}`;
  const reportOnly = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
    `connect-src 'self'${development ? " ws://localhost:* ws://127.0.0.1:*" : ""}`, restrictions,
    ...(!development && request.nextUrl.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  // Next prioritizes enforced CSP over report-only when extracting a nonce. Do not accept either from the client.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.delete("content-security-policy");
  forwarded.set("content-security-policy-report-only", reportOnly);
  const headers = new Headers({
    "Content-Security-Policy-Report-Only": reportOnly,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  });
  return { forwarded, headers };
}

export function securePersonalResponse(response: NextResponse, security: ReturnType<typeof personalSecurityHeaders>) {
  if (response.headers.get("x-middleware-next") === "1") {
    const forwarded = NextResponse.next({ request: { headers: security.forwarded } });
    // Preserve Auth0's cookies and response while forwarding the server-generated nonce to the renderer.
    for (const [name, value] of forwarded.headers) {
      if (name.startsWith("x-middleware-")) response.headers.set(name, value);
    }
  }
  security.headers.forEach((value, name) => response.headers.set(name, value));
  return response;
}
