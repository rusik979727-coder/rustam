"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Чатты жаңарту (жаңа хабарламалар үшін). Пайдаланушы жазып отырғанда жаңартпайды. */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && (el as HTMLInputElement).value) return;
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

export function ScrollToBottom({ id }: { id: string }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (el) el.scrollTop = el.scrollHeight;
  });
  return null;
}
