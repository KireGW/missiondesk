import Image from "next/image";

export function BrandLogo() {
  return <span className="inline-flex items-center gap-2 whitespace-nowrap align-middle">
    <Image src="/brand/missiondesk-mark-v2.png" alt="" width={36} height={36}
      loading="eager" className="missiondesk-brand-mark h-9 w-9 shrink-0" />
    <span>MissionDesk</span>
  </span>;
}
