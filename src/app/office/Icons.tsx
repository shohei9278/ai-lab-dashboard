// オフィスの画面で使う小さな印（絵文字は端末で見た目が変わり、安っぽく見えるので、線の絵にそろえる）
// 線は文字の色（currentColor）で描く
const PATHS = {
  monitor: "M3 4h18v12H3z M8 20h8 M12 16v4",
  chat: "M4 5h16v11H9l-5 4z",
  megaphone: "M3 10v4h3l7 4V6l-7 4z M17 9a4 4 0 0 1 0 6",
  coffee: "M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z M16 10h2a2 2 0 0 1 0 4h-2 M8 3v2 M12 3v2",
  briefcase: "M3 7h18v12H3z M9 7V4h6v3 M3 12h18",
  shop: "M4 9h16l-1-5H5z M5 9v11h14V9 M10 20v-5h4v5",
  alert: "M12 3l10 18H2z M12 10v5 M12 18v.5",
  moon: "M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  check: "M4 12l5 5L20 6",
  tool: "M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9z",
  page: "M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5",
  sprout: "M12 21v-9 M12 12c0-4-3-6-7-6 0 4 3 6 7 6z M12 14c0-4 3-6 7-6 0 4-3 6-7 6z",
  pause: "M8 5v14 M16 5v14",
  play: "M7 5l12 7-12 7z",
  lock: "M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4",
  party: "M4 20l5-13 8 8z M14 4l1 2 M19 9l2-1 M17 4l-1 3",
  box: "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-[1em] w-[1em]", label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`inline-block shrink-0 align-[-0.125em] ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name]} />
    </svg>
  );
}
