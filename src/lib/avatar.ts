const avatarPalettes = [
  ['#0f172a', '#38bdf8', '#22c55e', '#f97316', '#e2e8f0'],
  ['#111827', '#6366f1', '#ec4899', '#f59e0b', '#e5e7eb'],
  ['#0b1220', '#14b8a6', '#22d3ee', '#a3e635', '#fbbf24'],
  ['#1f2937', '#fb7185', '#f472b6', '#60a5fa', '#f3f4f6'],
  ['#0a0f1a', '#a855f7', '#6366f1', '#22d3ee', '#f8fafc'],
];

const avatarVariants = ['orbit', 'grid', 'rings', 'stripes', 'split', 'dots'] as const;

export type AvatarVariant = (typeof avatarVariants)[number];

const hashSeed = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const pick = (palette: string[], index: number) => palette[index % palette.length];

const buildAvatarSvg = (seed: string, variant: AvatarVariant) => {
  const hash = hashSeed(`${seed}-${variant}`);
  const palette = avatarPalettes[hash % avatarPalettes.length];
  const bg = pick(palette, 0);
  const primary = pick(palette, 1);
  const secondary = pick(palette, 2);
  const accent = pick(palette, 3);

  const offset = (hash % 20) - 10;
  const offsetAlt = ((hash >> 3) % 24) - 12;

  let shapes = '';
  switch (variant) {
    case 'grid':
      shapes = `
        <rect x="18" y="18" width="36" height="36" rx="10" fill="${primary}" />
        <rect x="74" y="18" width="36" height="36" rx="10" fill="${secondary}" />
        <rect x="18" y="74" width="36" height="36" rx="10" fill="${secondary}" />
        <rect x="74" y="74" width="36" height="36" rx="10" fill="${accent}" />
      `;
      break;
    case 'rings':
      shapes = `
        <circle cx="64" cy="64" r="42" fill="none" stroke="${primary}" stroke-width="10" />
        <circle cx="${64 + offsetAlt}" cy="${64 - offset}" r="20" fill="none" stroke="${accent}" stroke-width="8" />
        <circle cx="64" cy="64" r="10" fill="${secondary}" />
      `;
      break;
    case 'stripes':
      shapes = `
        <rect x="-20" y="20" width="180" height="28" fill="${primary}" transform="rotate(-12 64 64)" />
        <rect x="-20" y="58" width="180" height="28" fill="${secondary}" transform="rotate(-12 64 64)" />
        <rect x="-20" y="96" width="180" height="28" fill="${accent}" transform="rotate(-12 64 64)" />
      `;
      break;
    case 'split':
      shapes = `
        <rect x="0" y="0" width="64" height="128" fill="${primary}" />
        <rect x="64" y="0" width="64" height="128" fill="${secondary}" />
        <circle cx="${64 + offsetAlt}" cy="${64 + offset}" r="26" fill="${accent}" />
      `;
      break;
    case 'dots':
      shapes = `
        <circle cx="40" cy="40" r="14" fill="${primary}" />
        <circle cx="88" cy="36" r="10" fill="${secondary}" />
        <circle cx="36" cy="88" r="18" fill="${accent}" />
        <circle cx="88" cy="90" r="12" fill="${primary}" />
      `;
      break;
    case 'orbit':
    default:
      shapes = `
        <circle cx="64" cy="64" r="38" fill="${primary}" />
        <circle cx="${64 + offsetAlt}" cy="${64 - offset}" r="16" fill="${accent}" />
        <circle cx="${64 - offset}" cy="${64 + offsetAlt}" r="12" fill="${secondary}" />
      `;
      break;
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="Avatar">
      <rect width="128" height="128" fill="${bg}" />
      ${shapes}
    </svg>
  `;
};

export const avatarDataUri = (seed: string, variant: AvatarVariant = 'orbit') => {
  const svg = buildAvatarSvg(seed, variant);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const isSafeImageUrl = (url?: string | null) => {
  if (!url) return false;
  return url.startsWith('data:image/') || url.startsWith('blob:') || url.startsWith('/');
};

export const isAvatarVariant = (value?: string | null): value is AvatarVariant => {
  if (!value) return false;
  return avatarVariants.includes(value as AvatarVariant);
};

export const normalizeAvatarVariant = (value?: string | null): AvatarVariant => {
  return isAvatarVariant(value) ? value : avatarVariants[0];
};

export { avatarVariants };
