"use client";
import { useRef, type ReactNode } from "react";
import { Dialog, DropdownMenu } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { cx } from "./ui";

// Radix overlays live apart from ./ui so the views that never open one do not load them.

/**
 * Focus return for a Radix Dialog opened from code (no Dialog.Trigger): Radix would focus its missing
 * trigger and drop focus to the page body, so remember what had focus when it opened and go back there.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => { opener.current = document.activeElement as HTMLElement | null; },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      if (opener.current?.isConnected) opener.current.focus();
    },
  };
}

/** A question that needs an answer before anything else (Radix Dialog: focus trap, Escape, focus return).
 *  The footer holds the choices: the one that goes ahead is the primary button, last. */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content {...returnFocus} className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line-strong bg-bg-1 p-0 shadow-pop">
          <div className="p-6">
            <Dialog.Title className="text-body font-semibold text-fg-0">{title}</Dialog.Title>
            <Dialog.Description asChild>
              <div className="mt-2 text-fg-1">{children}</div>
            </Dialog.Description>
          </div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-bg-2 px-6 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }

export const menuContentClass = "z-50 min-w-56 rounded-md border border-line-strong bg-bg-1 p-1 shadow-pop";
export const menuItemClass = "flex min-h-11 cursor-default items-center justify-between gap-4 rounded-sm px-3 py-2 text-small outline-none data-[disabled]:opacity-55 data-[highlighted]:bg-bg-3";

/**
 * The "More" menu: where rare and destructive actions live, as text items. The button always says "More";
 * `label` is its full name for screen readers ("More actions for <this review>").
 */
export function MoreMenu({ items, label = "More actions", size = "md" }: { items: MenuItem[]; label?: string; size?: "sm" | "md" }) {
  if (!items.length) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={cx("btn-secondary", size === "sm" && "btn-sm")} aria-label={label}>
        More <ChevronDown className="h-4 w-4" strokeWidth={2} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={menuContentClass}>
          {items.map((it) => (
            <DropdownMenu.Item key={it.label} disabled={it.disabled} onSelect={it.onSelect} className={cx(menuItemClass, it.danger ? "text-err" : "text-fg-0")}>
              {it.label}
              {it.hint && <span className="text-fg-2">{it.hint}</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
