"use client";
import type { ReactNode } from "react";
import { Dialog, DropdownMenu } from "radix-ui";
import { MoreHorizontal } from "lucide-react";
import { cx } from "./ui";

// Radix overlays live apart from ./ui so the views that never open one do not load them.

/** Accessible modal (Radix Dialog: focus trap, Escape, focus return). */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-line-strong bg-bg-1 p-0">
          <div className="p-6">
            <Dialog.Title className="text-16 font-semibold text-fg-0">{title}</Dialog.Title>
            <Dialog.Description asChild>
              <div className="mt-2 text-fg-1">{children}</div>
            </Dialog.Description>
          </div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-bg-2 px-6 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }
/** The `⋯` menu for secondary actions. */
export function MoreMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  if (!items.length) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="btn-ghost h-11 w-11 px-0" aria-label={label}>
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-56 rounded-md border border-line-strong bg-bg-2 p-1">
          {items.map((it) => (
            <DropdownMenu.Item
              key={it.label}
              disabled={it.disabled}
              onSelect={it.onSelect}
              className={cx("flex min-h-11 cursor-default items-center justify-between gap-4 rounded-sm px-3 py-2 outline-none data-[disabled]:opacity-55 data-[highlighted]:bg-bg-3", it.danger ? "text-err" : "text-fg-0")}
            >
              {it.label}
              {it.hint && <span className="text-12 text-fg-2">{it.hint}</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
