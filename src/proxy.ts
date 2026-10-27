import { NextResponse, type NextRequest } from "next/server";
import { getPersonalAuth } from "@/lib/product/auth";
import { getAccessMode } from "@/lib/product/config";

export async function proxy(request: NextRequest) {
  const mode = getAccessMode();
  if (mode === "legacy") return NextResponse.next();
  if (mode === "invalid") {
    return new NextResponse("MissionDesk: ogiltig atkomstkonfiguration.", { status: 503 });
  }
  const auth = getPersonalAuth();
  if (!auth) {
    return new NextResponse("Personlig inloggning ar inte konfigurerad an.", { status: 503 });
  }
  return auth.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
