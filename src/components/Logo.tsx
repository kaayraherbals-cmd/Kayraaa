import { logos, type LogoKind } from '../content/brand';
import { useT } from '../i18n/I18nProvider';

interface Props {
  kind?: LogoKind;
  /** Background the logo sits on: picks the matching artwork variation. */
  tone?: 'light' | 'dark' | 'mono';
  className?: string;
  /** Decorative use (the surrounding link or heading already names the brand): empty alt text. */
  decorative?: boolean;
  /** Load straight away (first screen). Everything else stays lazy. */
  priority?: boolean;
}

/** Renders the registered logo artwork (src/content/brand.ts); falls back to the typeset wordmark if a slot is empty. */
export default function Logo({ kind = 'horizontal', tone = 'light', className, decorative = false, priority = false }: Props) {
  const art = logos[kind];
  const t = useT();
  if (art)
    return (
      <img
        className={className ? `logo logo-${kind} ${className}` : `logo logo-${kind}`}
        src={art[tone]}
        width={art.width}
        height={art.height}
        alt={decorative ? '' : t('brandAlt')}
        translate="no"
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
      />
    );
  return (
    <span translate="no" data-no-translate>
      Kaayra<span> Herbals</span>
    </span>
  );
}
