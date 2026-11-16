/** Athena's mark (decorative; the link or heading around it carries the name). Ink, never the accent. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
      <rect width="24" height="24" rx="6" fill="var(--fg-0)" />
      <path d="M12 5.5 7 18.5h2.4l1.1-3h3l1.1 3H17L12 5.5Zm-.9 8 .9-2.8.9 2.8h-1.8Z" fill="var(--bg-1)" />
    </svg>
  );
}
