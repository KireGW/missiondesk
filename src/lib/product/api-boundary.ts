import { getAccessMode } from "@/lib/product/config";

export function legacyEngineBoundary() {
  if (getAccessMode() === "legacy") return null;
  return Response.json(
    { error: "Den gemensamma motorn kan inte styras via personliga konton.", code: "ENGINE_ISOLATED" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}
