"use client";
// View Transitions for route changes (a short crossfade), with a plain navigation as the fallback:
// browsers without document.startViewTransition, and anyone who prefers reduced motion, just navigate.
import { useEffect, type ComponentProps, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

let finish: (() => void) | null = null;

/** Mounted once in the root layout: ends a pending transition when the new route has rendered. */
export function RouteTransitions() {
  const pathname = usePathname();
  useEffect(() => {
    finish?.();
    finish = null;
  }, [pathname]);
  return null;
}

type Doc = Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };

export function useTransitionRouter() {
  const router = useRouter();
  return (href: string, opts: { replace?: boolean } = {}) => {
    const go = () => (opts.replace ? router.replace(href) : router.push(href));
    const doc = document as Doc;
    if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URL(href, location.href).pathname === location.pathname) return go();
    doc.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          go();
          setTimeout(resolve, 1200); // never hold the page frozen if the route is slow
        }),
    );
  };
}

/** next/link with a view transition on plain left clicks. */
export function TransitionLink({ href, onClick, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const navigate = useTransitionRouter();
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
        e.preventDefault();
        navigate(href);
      }}
    />
  );
}
