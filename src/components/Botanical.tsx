/** Decorative botanical line illustration (not a photograph, not a product). */
const LEAVES: { y: number; side: 1 | -1; s: number }[] = [
  { y: 410, side: -1, s: 1.15 },
  { y: 370, side: 1, s: 1.2 },
  { y: 320, side: -1, s: 1.05 },
  { y: 280, side: 1, s: 1.1 },
  { y: 228, side: -1, s: 0.95 },
  { y: 190, side: 1, s: 0.95 },
  { y: 142, side: -1, s: 0.8 },
  { y: 112, side: 1, s: 0.78 },
];

export default function Botanical({ variant = 'a', draw = false }: { variant?: 'a' | 'b'; draw?: boolean }) {
  // With draw, every stroke is normalised to length 1 so CSS can animate it being drawn (see .bt-draw in styles/home.css).
  const d = (i: number) => (draw ? { pathLength: 1, className: `bt-stroke bt-d${i}` } : {});
  const stroke = variant === 'a' ? '#173A2D' : '#F7F5EF';
  const accent = '#A88452';
  const sage = variant === 'a' ? '#A9BBA6' : '#B9C2A8';
  return (
    <svg className={draw ? 'bt-draw' : undefined} viewBox="0 0 400 500" role="img" aria-label="Decorative botanical line illustration of a leafy stem" preserveAspectRatio="xMidYMid slice">
      <title>Decorative botanical line illustration</title>
      <circle cx="200" cy="250" r="168" fill="none" stroke={accent} strokeWidth="1" opacity="0.7" {...d(0)} />
      <path d="M200 470 C 196 380 204 250 200 78" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" {...d(1)} />
      {LEAVES.map((l, i) => (
        <g key={i} transform={`translate(200 ${l.y}) scale(${l.side * l.s} ${l.s})`}>
          <path d="M0 0 C 30 -8 78 -14 98 -46 C 58 -52 14 -34 0 0 Z" fill="none" stroke={i % 3 === 0 ? sage : stroke} strokeWidth="1.6" strokeLinejoin="round" {...d(i + 2)} />
          <path d="M2 -2 C 34 -18 66 -32 92 -44" fill="none" stroke={accent} strokeWidth="1" strokeLinecap="round" {...d(i + 3)} />
        </g>
      ))}
      <path d="M200 78 c-9 -16 -4 -34 0 -46 c4 12 9 30 0 46z" fill="none" stroke={accent} strokeWidth="1.6" strokeLinejoin="round" {...d(11)} />
      <line x1="120" y1="478" x2="280" y2="478" stroke={accent} strokeWidth="1" {...d(12)} />
    </svg>
  );
}
