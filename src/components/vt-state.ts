// The view transition waiting for the next route to render (shared by vt.tsx and route-transitions.tsx).
export const pending: { finish: (() => void) | null } = { finish: null };
