import type { ThemeId } from '../themes';

/** Decorative SVG motifs — original geometric art, no copyrighted assets */
export default function ThemeMotifs({ themeId }: { themeId: ThemeId }) {
  if (themeId === 'guofeng') {
    return (
      <div className="theme-motif theme-motif-palace" aria-hidden>
        <div className="palace-motif-wash" />
        <div className="palace-motif-mist far" />
        <div className="palace-motif-mist mid" />
        <div className="palace-motif-mist near" />
        <div className="palace-motif-glow" />
      </div>
    );
  }

  if (themeId === 'angel') {
    return (
      <div className="theme-motif theme-motif-angel" aria-hidden>
        <svg className="motif-halo" viewBox="0 0 600 600">
          <defs>
            <radialGradient id="halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff8e0" stopOpacity="0.95" />
              <stop offset="40%" stopColor="#e8d48b" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#c9a227" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="wing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#e8d48b" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <circle cx="300" cy="300" r="220" fill="url(#halo)" />
          <circle
            cx="300"
            cy="300"
            r="140"
            fill="none"
            stroke="#d4af37"
            strokeOpacity="0.35"
            strokeWidth="2"
          />
          <circle
            cx="300"
            cy="300"
            r="100"
            fill="none"
            stroke="#fff"
            strokeOpacity="0.55"
            strokeWidth="1.5"
          />
          <path
            d="M260 300 C180 250, 90 220, 40 260 C90 280, 140 300, 180 340 C140 330, 90 340, 50 370 C120 360, 200 350, 260 320 Z"
            fill="url(#wing)"
          />
          <path
            d="M340 300 C420 250, 510 220, 560 260 C510 280, 460 300, 420 340 C460 330, 510 340, 550 370 C480 360, 400 350, 340 320 Z"
            fill="url(#wing)"
          />
        </svg>
        <div className="motif-rays" />
      </div>
    );
  }

  if (themeId === 'anime') {
    return (
      <div className="theme-motif theme-motif-anime" aria-hidden>
        <svg className="motif-speed" viewBox="0 0 800 400" fill="none">
          <defs>
            <linearGradient id="sp" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ff2d6f" stopOpacity="0" />
              <stop offset="50%" stopColor="#6c5ce7" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {Array.from({ length: 12 }).map((_, i) => (
            <line
              key={i}
              x1={40 + i * 18}
              y1={40 + i * 22}
              x2={320 + i * 30}
              y2={60 + i * 18}
              stroke="url(#sp)"
              strokeWidth={2 + (i % 3)}
              opacity={0.35 + (i % 5) * 0.08}
            />
          ))}
          <polygon
            points="620,40 760,80 700,140 780,180 640,220 720,280 580,300 650,360 520,340"
            fill="#ff2d6f"
            opacity="0.12"
          />
          <circle cx="160" cy="300" r="50" fill="#00e5ff" opacity="0.15" />
          <circle cx="220" cy="280" r="24" fill="#6c5ce7" opacity="0.2" />
        </svg>
        <div className="motif-burst">★</div>
        <div className="motif-burst motif-burst-2">✦</div>
      </div>
    );
  }

  return (
    <div className="theme-motif theme-motif-strawberry" aria-hidden>
      <div className="motif-blob b1" />
      <div className="motif-blob b2" />
      <div className="motif-blob b3" />
    </div>
  );
}
