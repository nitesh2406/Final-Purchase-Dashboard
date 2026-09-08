import React, { useEffect, useState, useId } from 'react';

interface MarginGaugeProps {
  label: string;
  value: number;  // actual %, e.g. 36.2
  floor: number;  // %
  target: number; // %
  rupee: number;  // ₹ amount shown in the caption
}

// Finalized in the mockup review — 20% lighter than the base palette below.
const LIGHTEN_PCT = 20;

const PALETTE = {
  amber:      { light: '#d97706', dark: '#fbbf24' },
  badDark:    { light: '#7f1d1d', dark: '#b91c1c' },
  goodBright: { light: '#16a34a', dark: '#4ade80' },
  goodDark:   { light: '#14532d', dark: '#15803d' },
  text:       { light: '#374151', dark: '#e5e7eb' },
} as const;

function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setIsDark(document.documentElement.classList.contains('dark'));
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return isDark;
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex(r: number, g: number, b: number) {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function lerpColor(a: string, b: string, t: number) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t);
}
function lighten(hex: string, pct: number) {
  return lerpColor(hex, '#ffffff', pct / 100);
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}
// value 0..max maps to angle 180..0 (left to right over the top of the arc)
function angleForValue(v: number, max: number) {
  const clamped = Math.max(0, Math.min(max, v));
  return 180 - (clamped / max) * 180;
}
function arcPath(cx: number, cy: number, r: number, vFrom: number, vTo: number, max: number) {
  const a0 = angleForValue(vFrom, max), a1 = angleForValue(vTo, max);
  const p0 = polarToCartesian(cx, cy, r, a0), p1 = polarToCartesian(cx, cy, r, a1);
  const largeArc = a0 - a1 > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

// Arc gauge for CM1/CM3 vs their floor/target brackets — zones: a severity
// gradient (amber → dark red) below floor, bright green floor→target, a
// calmer dark green above target. See mockup review for the palette pass.
export const MarginGauge: React.FC<MarginGaugeProps> = ({ label, value, floor, target, rupee }) => {
  const isDark = useIsDarkMode();
  const pick = (name: keyof typeof PALETTE) => PALETTE[name][isDark ? 'dark' : 'light'];
  const rawGradId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `mg-${rawGradId}`;

  const max = Math.max(target + 20, value + 5, floor + 20);
  const cx = 100, cy = 100, r = 80;

  const badDark    = lighten(pick('badDark'), LIGHTEN_PCT);
  const amber      = lighten(pick('amber'), LIGHTEN_PCT);
  const goodBright = lighten(pick('goodBright'), LIGHTEN_PCT);
  const goodDark   = lighten(pick('goodDark'), LIGHTEN_PCT);
  const textCol    = pick('text');

  const p0 = polarToCartesian(cx, cy, r, angleForValue(0, max));
  const p1 = polarToCartesian(cx, cy, r, angleForValue(floor, max));

  let readoutColor: string;
  if (value < floor) {
    const t = floor > 0 ? Math.max(0, Math.min(1, value / floor)) : 1;
    readoutColor = lerpColor(pick('badDark'), pick('amber'), t);
  } else if (value <= target) {
    readoutColor = pick('goodBright');
  } else {
    readoutColor = pick('goodDark');
  }

  const needleRotation = 90 - angleForValue(value, max);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 118" className="w-full max-w-[200px]">
        <defs>
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}>
            <stop offset="0%" stopColor={badDark} />
            <stop offset="100%" stopColor={amber} />
          </linearGradient>
        </defs>
        <path d={arcPath(cx, cy, r, 0, floor, max)} fill="none" stroke={`url(#${gradId})`} strokeWidth={14} strokeLinecap="round" />
        <path d={arcPath(cx, cy, r, floor, target, max)} fill="none" stroke={goodBright} strokeWidth={14} strokeLinecap="round" />
        <path d={arcPath(cx, cy, r, target, max, max)} fill="none" stroke={goodDark} strokeWidth={14} strokeLinecap="round" />
        <line
          x1={cx} y1={cy} x2={cx} y2={cy - r + 18}
          stroke={textCol} strokeWidth={3} strokeLinecap="round"
          transform={`rotate(${needleRotation} ${cx} ${cy})`}
        />
        <circle cx={cx} cy={cy} r={5} fill={textCol} />
      </svg>
      <p className="font-mono text-2xl font-bold -mt-2" style={{ color: readoutColor }}>
        {value.toFixed(1)}%
      </p>
      <p className="text-xs font-bold text-gray-900 dark:text-white mt-0.5">
        {label} - ₹{Math.round(rupee).toLocaleString('en-IN')}
      </p>
      <p className="text-[10px] font-mono text-gray-400 mt-1 text-center">
        Floor {floor.toFixed(0)}% ↔ {target.toFixed(0)}% Target
      </p>
    </div>
  );
};
