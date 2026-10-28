"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { UserRound } from "lucide-react";

const AppMenuContent = dynamic(() => import("./AppMenuContent").then((m) => m.AppMenuContent), { ssr: false, loading: () => <AvatarButton /> });

export function AvatarButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-1 hover:bg-bg-3 hover:text-fg-0" aria-label="Account and settings" aria-haspopup="menu">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-bg-2">
        <UserRound className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </span>
    </button>
  );
}

/** The avatar menu. Its menu code loads on first use, so it costs nothing on first paint. */
export function AppMenu({ onShortcuts }: { onShortcuts?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  if (loaded) return <AppMenuContent onShortcuts={onShortcuts} />;
  return <AvatarButton onClick={() => setLoaded(true)} onKeyDown={(e) => (e.key === "ArrowDown" ? setLoaded(true) : undefined)} />;
}
