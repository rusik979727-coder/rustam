"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`flex items-center justify-between whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            <span>{i.label}</span>
            {!!i.badge && <span className={`badge ml-2 ${active ? "bg-white/20 text-white" : "bg-red-100 text-red-700"}`}>{i.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
