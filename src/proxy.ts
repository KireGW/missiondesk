import { NextResponse, type NextRequest } from "next/server.js";
import { getPersonalAuth } from "@/lib/product/auth";
import { getAccessMode } from "@/lib/product/config";
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
  return securePersonalResponse(await auth.middleware(request), security);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
