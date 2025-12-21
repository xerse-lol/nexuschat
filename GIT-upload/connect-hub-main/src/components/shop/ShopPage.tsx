import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ShoppingBag, Sparkles, Crown, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { avatarDecorations, bannerStyles } from '@/lib/profileStyles';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function ShopPage() {
  const { stats, unlocks, purchaseStyle, unlockingEnabled, user } = useAuth();
  const { toast } = useToast();
  const points = stats?.points ?? 0;
  const hasGalaxy = user?.isGalaxy ?? false;

  const unlockedBannerSet = useMemo(() => new Set(unlocks?.banners ?? []), [unlocks]);
  const unlockedDecorationSet = useMemo(() => new Set(unlocks?.decorations ?? []), [unlocks]);

  const premiumBanners = useMemo(
    () => bannerStyles.filter((banner) => banner.isPremium),
    []
  );
  const premiumDecorations = useMemo(
    () => avatarDecorations.filter((decoration) => decoration.isPremium),
    []
  );

  const formatPoints = (value: number) => value.toLocaleString('en-US');

  const handleUnlock = async (itemType: 'banner' | 'decoration', itemId: string, price: number) => {
    if (!unlockingEnabled) {
      toast({
        title: 'Shop unavailable',
        description: 'Unlocks are not configured yet.',
      });
      return;
    }

    if (hasGalaxy) {
      toast({
        title: 'Galaxy active',
        description: 'You already own all premium cosmetics.',
      });
      return;
    }

    if (points < price) {
      toast({
        title: 'Not enough points',
        description: `You need ${formatPoints(price)} points to unlock this.`,
      });
      return;
    }

    const result = await purchaseStyle(itemType, itemId);
    if (!result.success) {
      toast({
        title: 'Unlock failed',
        description: result.error || 'Unable to unlock this item.',
      });
      return;
    }

    toast({
      title: 'Unlocked',
      description: 'This cosmetic is now available in your profile.',
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShoppingBag className="w-4 h-4" />
                Galaxy Shop (Beta)
              </div>
              <h1 className="text-3xl font-display font-bold mt-2">Unlock Premium Styles</h1>
              <p className="text-muted-foreground mt-1">
                Spend Nexus Points to unlock rare banners and avatar decorations.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-secondary/40 px-6 py-4 text-center">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="w-4 h-4 text-primary" />
                Points Balance
              </div>
              <p className="text-3xl font-display font-bold text-primary mt-1">{formatPoints(points)}</p>
            </div>
          </div>
          {hasGalaxy && (
            <div className="mt-4 flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-500 px-4 py-2 text-sm text-slate-950 font-semibold w-fit">
              <Crown className="w-4 h-4" />
              Galaxy Beta active — all premium cosmetics unlocked
            </div>
          )}
        </motion.div>

        <Tabs defaultValue="banners">
          <TabsList className="mb-6">
            <TabsTrigger value="banners">Banners</TabsTrigger>
            <TabsTrigger value="decorations">Avatar Decorations</TabsTrigger>
          </TabsList>

          <TabsContent value="banners">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {premiumBanners.map((banner) => {
                const isOwned = hasGalaxy || unlockedBannerSet.has(banner.id);
                return (
                  <motion.div
                    key={banner.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-border bg-card p-4"
                  >
                    <div
                      className="h-24 w-full rounded-xl border border-border/60"
                      style={{ backgroundImage: banner.background }}
                    />
                    <div className="mt-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{banner.label}</p>
                        <p className="text-xs text-muted-foreground">{formatPoints(banner.price)} XP</p>
                      </div>
                      <Button
                        variant={isOwned ? 'secondary' : 'hero'}
                        size="sm"
                        disabled={isOwned || !unlockingEnabled}
                        onClick={() => handleUnlock('banner', banner.id, banner.price)}
                      >
                        {isOwned ? 'Owned' : 'Unlock'}
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="decorations">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {premiumDecorations.map((decoration) => {
                const isOwned = hasGalaxy || unlockedDecorationSet.has(decoration.id);
                return (
                  <motion.div
                    key={decoration.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-border bg-card p-4 text-center"
                  >
                    <div
                      className={cn(
                        "mx-auto h-16 w-16 rounded-full p-1",
                        !isOwned && !hasGalaxy && "opacity-80"
                      )}
                      style={{
                        backgroundImage: decoration.ring === 'none' ? undefined : decoration.ring,
                        boxShadow: decoration.glow || 'none',
                      }}
                    >
                      <div className="h-full w-full rounded-full bg-background/80 border border-border" />
                    </div>
                    <p className="mt-3 text-sm font-medium">{decoration.label}</p>
                    <p className="text-xs text-muted-foreground">{formatPoints(decoration.price)} XP</p>
                    <Button
                      variant={isOwned ? 'secondary' : 'hero'}
                      size="sm"
                      className="mt-3"
                      disabled={isOwned || !unlockingEnabled}
                      onClick={() => handleUnlock('decoration', decoration.id, decoration.price)}
                    >
                      {isOwned ? 'Owned' : 'Unlock'}
                    </Button>
                    {!isOwned && !hasGalaxy && (
                      <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                        <Lock className="w-3 h-3" />
                        Premium
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
