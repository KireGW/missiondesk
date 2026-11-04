import { NextResponse, NextRequest } from "next/server.js";
import { getPersonalAuth } from "@/lib/product/auth";
import { getAccessMode, pilotInviteOnly } from "@/lib/product/config";
import { personalSecurityHeaders, securePersonalResponse } from "@/lib/product/security-headers";

export async function proxy(request: NextRequest) {
  const mode = getAccessMode();
  if (mode === "legacy") return NextResponse.next();
  const security = personalSecurityHeaders(request, process.env.AUTH0_DOMAIN);
  if (mode === "invalid") {
    return securePersonalResponse(new NextResponse("MissionDesk: ogiltig atkomstkonfiguration.", { status: 503 }), security);
  }
  const auth = getPersonalAuth();
  if (!auth) {
    return securePersonalResponse(new NextResponse("Personlig inloggning ar inte konfigurerad an.", { status: 503 }), security);
  }
  let authRequest = request;
  if (pilotInviteOnly() && request.method === "GET" && request.nextUrl.pathname === "/auth/logout") {
    // Keep logout on our fixed confirmation page, including when a caller supplies returnTo.
    const url = request.nextUrl.clone();
    url.searchParams.set("returnTo", new URL("/signed-out", process.env.APP_BASE_URL!).href);
    authRequest = new NextRequest(url, { method: request.method, headers: request.headers });
  }
  return securePersonalResponse(await auth.middleware(authRequest), security);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
