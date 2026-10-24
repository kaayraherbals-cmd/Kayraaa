import { logos, type LogoKind } from '../content/brand';

interface Props {
  kind?: LogoKind;
  /** Background the logo sits on: picks the matching artwork variation. */
  tone?: 'light' | 'dark' | 'mono';
}

/** Renders approved artwork when supplied (src/content/brand.ts), otherwise the typeset wordmark. */
export default function Logo({ kind = 'horizontal', tone = 'light' }: Props) {
  const art = logos[kind];
  if (art) return <img src={art[tone]} width={art.width} height={art.height} alt="Kaayra Herbals" decoding="async" />;
  return (
    <>
      Kaayra<span> Herbals</span>
    </>
  );
}
