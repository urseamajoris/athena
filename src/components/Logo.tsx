/** Athena's mark (decorative; the link around it carries the name). */
export function LogoMark() {
  return (
    <svg aria-hidden width="24" height="24" viewBox="0 0 24 24" className="shrink-0">
      <rect x="0.5" y="0.5" width="23" height="23" rx="5.5" fill="var(--bg-2)" stroke="var(--line-strong)" />
      <path d="M12 5.5 7 18.5h2.4l1.1-3h3l1.1 3H17L12 5.5Zm-.9 8 .9-2.8.9 2.8h-1.8Z" fill="var(--fg-0)" />
    </svg>
  );
}
