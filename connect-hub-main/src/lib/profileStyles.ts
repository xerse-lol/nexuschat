type Palette = {
  id: string;
  name: string;
  base: string;
  mid: string;
  deep: string;
  accent: string;
  glow: string;
};

export type BannerStyle = {
  id: string;
  label: string;
  background: string;
  isPremium: boolean;
  price: number;
};

export type AvatarDecoration = {
  id: string;
  label: string;
  ring: string;
  glow: string;
  isPremium: boolean;
  price: number;
};

const withAlpha = (hex: string, alpha: number) => {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const hashSeed = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const priceFloor = 10000;
const priceCeil = 100000;
const priceStep = 500;
const priceSteps = Math.floor((priceCeil - priceFloor) / priceStep) + 1;

const priceForItem = (seed: string) => {
  const hash = hashSeed(seed);
  return priceFloor + (hash % priceSteps) * priceStep;
};

const pickPremiumIds = <T extends { id: string }>(
  items: T[],
  count: number,
  excludeIds: Set<string> = new Set()
) => {
  const candidates = items
    .filter((item) => !excludeIds.has(item.id))
    .map((item) => ({
      id: item.id,
      score: hashSeed(`premium:${item.id}`),
    }))
    .sort((a, b) => a.score - b.score);

  return new Set(candidates.slice(0, Math.min(count, candidates.length)).map((item) => item.id));
};

const palettes: Palette[] = [
  { id: 'aurora', name: 'Aurora', base: '#0b1120', mid: '#1e3a8a', deep: '#0f172a', accent: '#38bdf8', glow: '#22d3ee' },
  { id: 'ember', name: 'Ember', base: '#1f2937', mid: '#b45309', deep: '#7f1d1d', accent: '#f97316', glow: '#fb7185' },
  { id: 'nebula', name: 'Nebula', base: '#0f172a', mid: '#312e81', deep: '#1f2937', accent: '#a78bfa', glow: '#22d3ee' },
  { id: 'glacier', name: 'Glacier', base: '#0f172a', mid: '#1d4ed8', deep: '#0b1120', accent: '#38bdf8', glow: '#94a3b8' },
  { id: 'sunset', name: 'Sunset', base: '#1f2937', mid: '#f97316', deep: '#7f1d1d', accent: '#fb7185', glow: '#facc15' },
  { id: 'forest', name: 'Forest', base: '#0f172a', mid: '#166534', deep: '#064e3b', accent: '#22c55e', glow: '#14b8a6' },
  { id: 'violet', name: 'Violet', base: '#111827', mid: '#6d28d9', deep: '#3b0764', accent: '#f0abfc', glow: '#a855f7' },
  { id: 'ocean', name: 'Ocean', base: '#0f172a', mid: '#0369a1', deep: '#0c4a6e', accent: '#22d3ee', glow: '#38bdf8' },
  { id: 'rose', name: 'Rose', base: '#111827', mid: '#be123c', deep: '#4c0519', accent: '#fb7185', glow: '#f472b6' },
  { id: 'slate', name: 'Slate', base: '#0f172a', mid: '#334155', deep: '#020617', accent: '#e2e8f0', glow: '#94a3b8' },
  { id: 'cyber', name: 'Cyber', base: '#0b1020', mid: '#0f766e', deep: '#164e63', accent: '#22d3ee', glow: '#a3e635' },
  { id: 'dusk', name: 'Dusk', base: '#0f172a', mid: '#4c1d95', deep: '#1f2937', accent: '#c084fc', glow: '#f472b6' },
];

const bannerVariants = [
  { id: '1', angle: 12, x: 20, y: 20 },
  { id: '2', angle: 24, x: 72, y: 18 },
  { id: '3', angle: 36, x: 28, y: 72 },
];

const bannerPatterns = [
  {
    id: 'drift',
    label: 'Drift',
    build: (palette: Palette, variant: typeof bannerVariants[number]) =>
      `radial-gradient(circle at ${variant.x}% ${variant.y}%, ${withAlpha(palette.glow, 0.65)} 0%, transparent 55%), ` +
      `linear-gradient(${variant.angle}deg, ${palette.base} 0%, ${palette.mid} 55%, ${palette.deep} 100%)`,
  },
  {
    id: 'halo',
    label: 'Halo',
    build: (palette: Palette, variant: typeof bannerVariants[number]) =>
      `radial-gradient(circle at ${variant.x}% ${variant.y}%, ${withAlpha(palette.accent, 0.8)} 0%, transparent 48%), ` +
      `radial-gradient(circle at ${100 - variant.x}% ${variant.y + 10}%, ${withAlpha(palette.glow, 0.55)} 0%, transparent 55%), ` +
      `linear-gradient(${variant.angle}deg, ${palette.deep} 0%, ${palette.base} 45%, ${palette.mid} 100%)`,
  },
  {
    id: 'tide',
    label: 'Tide',
    build: (palette: Palette, variant: typeof bannerVariants[number]) =>
      `linear-gradient(${variant.angle}deg, ${palette.base} 0%, ${palette.mid} 45%, ${palette.deep} 100%), ` +
      `radial-gradient(circle at ${variant.x}% ${variant.y + 25}%, ${withAlpha(palette.accent, 0.5)} 0%, transparent 55%)`,
  },
  {
    id: 'prism',
    label: 'Prism',
    build: (palette: Palette, variant: typeof bannerVariants[number]) =>
      `conic-gradient(from ${variant.angle}deg at ${variant.x}% ${variant.y}%, ${palette.accent}, ${palette.glow}, ${palette.mid}, ${palette.accent}), ` +
      `linear-gradient(135deg, ${palette.deep} 0%, ${palette.base} 40%, ${palette.mid} 100%)`,
  },
  {
    id: 'pulse',
    label: 'Pulse',
    build: (palette: Palette, variant: typeof bannerVariants[number]) =>
      `radial-gradient(circle at ${variant.x}% ${variant.y}%, ${withAlpha(palette.glow, 0.7)} 0%, ${withAlpha(palette.accent, 0.2)} 45%, transparent 65%), ` +
      `linear-gradient(${variant.angle}deg, ${palette.base} 0%, ${palette.mid} 50%, ${palette.deep} 100%)`,
  },
  {
    id: 'horizon',
    label: 'Horizon',
    build: (palette: Palette, variant: typeof bannerVariants[number]) =>
      `linear-gradient(${variant.angle}deg, ${palette.deep} 0%, ${palette.base} 45%, ${palette.mid} 100%), ` +
      `radial-gradient(circle at 50% 90%, ${withAlpha(palette.accent, 0.6)} 0%, transparent 60%)`,
  },
];

export const bannerStyles: BannerStyle[] = [];

for (const palette of palettes) {
  for (const pattern of bannerPatterns) {
    for (const variant of bannerVariants) {
      bannerStyles.push({
        id: `${palette.id}-${pattern.id}-${variant.id}`,
        label: `${palette.name} ${pattern.label} ${variant.id}`,
        background: pattern.build(palette, variant),
        isPremium: false,
        price: 0,
      });
    }
  }
}

const decorationPatterns = [
  {
    id: 'halo',
    label: 'Halo',
    ring: (palette: Palette) => `linear-gradient(135deg, ${palette.accent}, ${palette.glow})`,
    glow: (palette: Palette) => `0 0 24px ${withAlpha(palette.glow, 0.45)}`,
  },
  {
    id: 'prism',
    label: 'Prism',
    ring: (palette: Palette) =>
      `conic-gradient(from 180deg, ${palette.glow}, ${palette.accent}, ${palette.mid}, ${palette.glow})`,
    glow: (palette: Palette) => `0 0 26px ${withAlpha(palette.accent, 0.45)}`,
  },
  {
    id: 'signal',
    label: 'Signal',
    ring: (palette: Palette) =>
      `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accent} 45%, ${palette.glow} 55%, ${palette.glow} 100%)`,
    glow: (palette: Palette) => `0 0 22px ${withAlpha(palette.accent, 0.4)}`,
  },
  {
    id: 'orbit',
    label: 'Orbit',
    ring: (palette: Palette) =>
      `conic-gradient(from 90deg, ${palette.accent} 0%, ${palette.glow} 35%, ${palette.mid} 60%, ${palette.accent} 100%)`,
    glow: (palette: Palette) => `0 0 24px ${withAlpha(palette.glow, 0.35)}`,
  },
  {
    id: 'flare',
    label: 'Flare',
    ring: (palette: Palette) =>
      `radial-gradient(circle at 30% 30%, ${withAlpha(palette.glow, 0.9)} 0%, transparent 55%), ` +
      `linear-gradient(135deg, ${palette.mid}, ${palette.deep})`,
    glow: (palette: Palette) => `0 0 20px ${withAlpha(palette.glow, 0.35)}`,
  },
];

export const avatarDecorations: AvatarDecoration[] = [
  { id: 'none', label: 'None', ring: 'none', glow: '', isPremium: false, price: 0 },
];

for (const palette of palettes) {
  for (const pattern of decorationPatterns) {
    avatarDecorations.push({
      id: `${palette.id}-${pattern.id}`,
      label: `${palette.name} ${pattern.label}`,
      ring: pattern.ring(palette),
      glow: pattern.glow(palette),
      isPremium: false,
      price: 0,
    });
  }
}

export const defaultBannerId = `${palettes[0].id}-${bannerPatterns[0].id}-${bannerVariants[0].id}`;
export const defaultDecorationId = avatarDecorations[0].id;

const premiumBannerIds = pickPremiumIds(bannerStyles, 50, new Set([defaultBannerId]));
const premiumDecorationIds = pickPremiumIds(avatarDecorations, 50, new Set([defaultDecorationId]));

for (const banner of bannerStyles) {
  const isPremium = premiumBannerIds.has(banner.id);
  banner.isPremium = isPremium;
  banner.price = isPremium ? priceForItem(`banner:${banner.id}`) : 0;
}

for (const decoration of avatarDecorations) {
  const isPremium = premiumDecorationIds.has(decoration.id);
  decoration.isPremium = isPremium;
  decoration.price = isPremium ? priceForItem(`decoration:${decoration.id}`) : 0;
}

export { priceForItem };
