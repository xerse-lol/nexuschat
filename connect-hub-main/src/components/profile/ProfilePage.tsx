import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Edit3, 
  Save, 
  X, 
  Sparkles,
  Lock,
  Crown,
  Shield,
  ShieldCheck,
  Trophy,
  MessageSquare,
  Video,
  Calendar,
  Palette,
  Globe
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { avatarDataUri, avatarVariants, normalizeAvatarVariant, type AvatarVariant } from '@/lib/avatar';
import { avatarDecorations, bannerStyles, defaultBannerId, defaultDecorationId } from '@/lib/profileStyles';
import { supabase } from '@/lib/supabaseClient';
import { cn } from '@/lib/utils';

const statusOptions = [
  { value: 'online', label: 'Online', color: 'bg-online' },
  { value: 'away', label: 'Away', color: 'bg-away' },
  { value: 'dnd', label: 'Do Not Disturb', color: 'bg-dnd' },
  { value: 'offline', label: 'Invisible', color: 'bg-offline' },
];

export default function ProfilePage() {
  const { user, updateProfile, stats, unlocks, purchaseStyle, unlockingEnabled, adminRole } = useAuth();
  const { toast } = useToast();
  
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [customStatus, setCustomStatus] = useState(user?.customStatus || '');
  const [status, setStatus] = useState<'online' | 'away' | 'dnd' | 'offline'>(user?.status || 'online');
  const [selectedBanner, setSelectedBanner] = useState(defaultBannerId);
  const [selectedAvatarStyle, setSelectedAvatarStyle] = useState<AvatarVariant>(avatarVariants[0]);
  const [selectedDecoration, setSelectedDecoration] = useState(defaultDecorationId);
  const [showAllBanners, setShowAllBanners] = useState(false);
  const [showAllDecorations, setShowAllDecorations] = useState(false);
  const [roomsJoined, setRoomsJoined] = useState(0);
  const [roomsHosted, setRoomsHosted] = useState(0);
  const points = stats?.points ?? 0;
  const messagesCount = stats?.messagesCount ?? 0;
  const callConnections = stats?.callConnections ?? 0;
  const level = Math.max(1, Math.floor(points / 100) + 1);
  const levelStart = (level - 1) * 100;
  const levelProgress = points - levelStart;
  const levelPercent = Math.min(100, Math.round((levelProgress / 100) * 100));
  const nextLevelAt = level * 100;
  const hasGalaxy = user?.isGalaxy ?? false;
  const profileAvatarSrc = avatarDataUri(user?.username || 'user', selectedAvatarStyle);
  const fallbackBanner = bannerStyles.find(banner => banner.id === defaultBannerId) ?? bannerStyles[0];
  const fallbackDecoration = avatarDecorations.find(decoration => decoration.id === defaultDecorationId)
    ?? avatarDecorations[0];
  const unlockedBannerSet = useMemo(() => new Set(unlocks?.banners ?? []), [unlocks]);
  const unlockedDecorationSet = useMemo(() => new Set(unlocks?.decorations ?? []), [unlocks]);
  const isBannerUnlocked = (bannerId: string) => {
    const banner = bannerStyles.find((item) => item.id === bannerId);
    if (!banner) return false;
    return hasGalaxy || !unlockingEnabled || !banner.isPremium || unlockedBannerSet.has(bannerId);
  };
  const isDecorationUnlocked = (decorationId: string) => {
    const decoration = avatarDecorations.find((item) => item.id === decorationId);
    if (!decoration) return false;
    return hasGalaxy || !unlockingEnabled || !decoration.isPremium || unlockedDecorationSet.has(decorationId);
  };
  const activeBanner = bannerStyles.find(banner => banner.id === selectedBanner && isBannerUnlocked(selectedBanner))
    ?? fallbackBanner;
  const activeDecoration = avatarDecorations.find(decoration => decoration.id === selectedDecoration && isDecorationUnlocked(selectedDecoration))
    ?? fallbackDecoration;
  const activeDecorationStyle = {
    backgroundImage: activeDecoration.ring === 'none' ? undefined : activeDecoration.ring,
    boxShadow: activeDecoration.glow || 'none',
  };
  const visibleBanners = showAllBanners ? bannerStyles : bannerStyles.slice(0, 12);
  const visibleDecorations = showAllDecorations ? avatarDecorations : avatarDecorations.slice(0, 12);
  const profileBadges = [
    ...(adminRole === 'owner'
      ? [{
        id: 'owner',
        label: 'Owner',
        icon: ShieldCheck,
        className: 'bg-gradient-to-r from-amber-300 via-yellow-400 to-orange-500 text-slate-950 shadow-[0_0_18px_rgba(250,204,21,0.35)]',
        iconClassName: 'text-slate-950',
      }]
      : adminRole === 'admin'
      ? [{
        id: 'admin',
        label: 'Admin',
        icon: Shield,
        className: 'bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-500 text-slate-950 shadow-[0_0_18px_rgba(56,189,248,0.35)]',
        iconClassName: 'text-slate-950',
      }]
      : []),
    ...(hasGalaxy ? [{
      id: 'galaxy',
      label: 'Galaxy Beta',
      icon: Crown,
      className: 'bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-500 text-slate-950 shadow-[0_0_18px_rgba(56,189,248,0.45)]',
      iconClassName: 'text-slate-950',
    }] : []),
    { id: 'level', label: `Level ${level}`, icon: Trophy },
    { id: 'points', label: `${points} XP`, icon: Sparkles },
  ];

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName || '');
    setBio(user.bio || '');
    setCustomStatus(user.customStatus || '');
    setStatus(user.status || 'online');
    const nextBanner = bannerStyles.find(banner => banner.id === user.profileBanner)?.id ?? defaultBannerId;
    const nextDecoration = avatarDecorations.find(decoration => decoration.id === user.avatarDecoration)?.id
      ?? defaultDecorationId;
    setSelectedBanner(isBannerUnlocked(nextBanner) ? nextBanner : defaultBannerId);
    setSelectedDecoration(isDecorationUnlocked(nextDecoration) ? nextDecoration : defaultDecorationId);
    setSelectedAvatarStyle(normalizeAvatarVariant(user.avatarVariant));
  }, [user, unlockingEnabled, unlockedBannerSet, unlockedDecorationSet]);

  useEffect(() => {
    if (!user) return;
    const loadRoomStats = async () => {
      const { count: joinedCount, error: joinedError } = await supabase
        .from('room_participants')
        .select('room_id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      if (joinedError) {
        console.warn('Failed to load rooms joined:', joinedError.message);
      } else {
        setRoomsJoined(joinedCount ?? 0);
      }

      const { count: hostedCount, error: hostedError } = await supabase
        .from('rooms')
        .select('id', { count: 'exact', head: true })
        .eq('host_id', user.id);

      if (hostedError) {
        console.warn('Failed to load rooms hosted:', hostedError.message);
      } else {
        setRoomsHosted(hostedCount ?? 0);
      }
    };

    void loadRoomStats();
  }, [user?.id]);

  const handleSave = () => {
    updateProfile({
      displayName,
      bio,
      customStatus,
      status,
      avatar: profileAvatarSrc,
      avatarVariant: selectedAvatarStyle,
      avatarDecoration: selectedDecoration,
      profileBanner: selectedBanner,
    });
    setIsEditing(false);
    toast({
      title: "Profile Updated",
      description: "Your changes have been saved",
    });
  };

  const generateNewAvatar = () => {
    const randomStyle = avatarVariants[Math.floor(Math.random() * avatarVariants.length)];
    setSelectedAvatarStyle(randomStyle);
  };

  const formatPoints = (value: number) => value.toLocaleString('en-US');

  const handleUnlock = async (itemType: 'banner' | 'decoration', itemId: string, price: number) => {
    if (!unlockingEnabled) return;
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

    if (itemType === 'banner') {
      setSelectedBanner(itemId);
    } else {
      setSelectedDecoration(itemId);
    }

    toast({
      title: 'Unlocked',
      description: 'This style is now available in your profile.',
    });
  };

  if (!user) return null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        {/* Banner */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative h-56 rounded-3xl overflow-hidden border border-border/60 mb-20"
        >
          <div
            className="absolute inset-0"
            style={{ backgroundImage: activeBanner.background }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/25 to-transparent" />

          {/* Avatar */}
          <div className="absolute -bottom-16 left-8">
            <div className="relative rounded-full p-1" style={activeDecorationStyle}>
              <Avatar className="w-32 h-32 border-4 border-background bg-background">
                <AvatarImage src={profileAvatarSrc} />
                <AvatarFallback className="text-4xl">{displayName.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className={cn(
                "absolute bottom-2 right-2 w-6 h-6 rounded-full border-4 border-background shadow-[0_0_10px_rgba(15,23,42,0.6)]",
                statusOptions.find(s => s.value === status)?.color
              )} />
              {isEditing && (
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={generateNewAvatar}
                  className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full gradient-primary flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.4)]"
                >
                  <Sparkles className="w-5 h-5 text-primary-foreground" />
                </motion.button>
              )}
            </div>
          </div>

          {/* Edit Button */}
          <div className="absolute top-4 right-4">
            {isEditing ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setIsEditing(false)}>
                  <X className="w-4 h-4 mr-1" />
                  Cancel
                </Button>
                <Button variant="hero" size="sm" onClick={handleSave}>
                  <Save className="w-4 h-4 mr-1" />
                  Save
                </Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                <Edit3 className="w-4 h-4 mr-1" />
                Edit Profile
              </Button>
            )}
          </div>
        </motion.div>

        {/* Profile Info */}
        <div className="px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-8 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur"
          >
            {isEditing ? (
              <div className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="bg-secondary border-0 h-12"
                    maxLength={32}
                  />
                  <p className="text-xs text-muted-foreground">@{user.username}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h1 className="text-3xl font-display font-bold mb-1">{displayName}</h1>
                  <p className="text-muted-foreground">@{user.username}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary">
                    <span className={cn(
                      "w-2.5 h-2.5 rounded-full",
                      statusOptions.find(s => s.value === status)?.color
                    )} />
                    <span className="text-sm capitalize">{status}</span>
                    {customStatus && (
                      <span className="text-sm text-muted-foreground">• {customStatus}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {profileBadges.map(badge => (
                      <span
                        key={badge.id}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs",
                          badge.className ?? "bg-secondary text-secondary-foreground"
                        )}
                      >
                        <badge.icon className={cn("h-3.5 w-3.5", badge.iconClassName ?? "text-primary")} />
                        {badge.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Status */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-8"
          >
            {isEditing && (
              <div className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                    <SelectTrigger className="bg-secondary border-0 h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <span className={cn("w-3 h-3 rounded-full", opt.color)} />
                            {opt.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Custom Status</Label>
                  <Input
                    value={customStatus}
                    onChange={(e) => setCustomStatus(e.target.value)}
                    placeholder="What are you up to?"
                    className="bg-secondary border-0 h-12"
                    maxLength={50}
                  />
                </div>
              </div>
            )}
          </motion.div>

          {isEditing && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mb-8"
            >
              <div className="flex items-center gap-2 mb-4">
                <Palette className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-display font-semibold">Profile Style</h2>
              </div>
              <div className="grid gap-6 lg:grid-cols-3">
                <div>
                  <div className="flex items-center justify-between">
                    <Label>Banner</Label>
                    {bannerStyles.length > 12 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllBanners((prev) => !prev)}
                      >
                        {showAllBanners ? 'Show fewer' : `Show all (${bannerStyles.length})`}
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {visibleBanners.map((banner) => {
                      const isLocked = !hasGalaxy && unlockingEnabled && banner.isPremium && !unlockedBannerSet.has(banner.id);
                      return (
                        <button
                          key={banner.id}
                          type="button"
                          onClick={() => {
                            if (isLocked) {
                              void handleUnlock('banner', banner.id, banner.price);
                            } else {
                              setSelectedBanner(banner.id);
                            }
                          }}
                          className={cn(
                            "group relative overflow-hidden rounded-xl border transition-all",
                            selectedBanner === banner.id
                              ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.35)]"
                              : "border-border hover:border-primary/60",
                            isLocked && "cursor-pointer"
                          )}
                        >
                          <div
                            className="h-14 w-full"
                            style={{ backgroundImage: banner.background }}
                          />
                          <span className="absolute bottom-1 left-2 text-[10px] font-medium text-white/80">
                            {banner.label}
                          </span>
                          {isLocked && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-white">
                              <Lock className="h-4 w-4" />
                              <span className="text-[10px] font-semibold">{formatPoints(banner.price)} XP</span>
                              <span className="text-[9px] uppercase tracking-[0.2em] text-white/70">Galaxy Beta</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <Label>Avatar Style</Label>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {avatarVariants.map((variant) => (
                      <button
                        key={variant}
                        type="button"
                        onClick={() => setSelectedAvatarStyle(variant)}
                        className={cn(
                          "rounded-full border p-1 transition-all",
                          selectedAvatarStyle === variant
                            ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.35)]"
                            : "border-border hover:border-primary/60"
                        )}
                      >
                        <img
                          src={avatarDataUri(user.username, variant)}
                          alt={`${variant} avatar`}
                          className="h-12 w-12 rounded-full"
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label>Avatar Decoration</Label>
                    {avatarDecorations.length > 12 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllDecorations((prev) => !prev)}
                      >
                        {showAllDecorations ? 'Show fewer' : `Show all (${avatarDecorations.length})`}
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {visibleDecorations.map((decoration) => {
                      const isLocked = !hasGalaxy && unlockingEnabled && decoration.isPremium && !unlockedDecorationSet.has(decoration.id);
                      return (
                        <button
                          key={decoration.id}
                          type="button"
                          onClick={() => {
                            if (isLocked) {
                              void handleUnlock('decoration', decoration.id, decoration.price);
                            } else {
                              setSelectedDecoration(decoration.id);
                            }
                          }}
                          className={cn(
                            "relative rounded-xl border p-2 transition-all",
                            selectedDecoration === decoration.id
                              ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.35)]"
                              : "border-border hover:border-primary/60"
                          )}
                        >
                          <div
                            className="mx-auto h-12 w-12 rounded-full p-1"
                            style={{
                              backgroundImage: decoration.ring === 'none' ? undefined : decoration.ring,
                              boxShadow: decoration.glow || 'none',
                            }}
                          >
                            <div className="h-full w-full rounded-full bg-background/80 border border-border" />
                          </div>
                          <span className="mt-2 block text-[10px] text-muted-foreground">
                            {decoration.label}
                          </span>
                          {isLocked && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-black/60 text-white">
                              <Lock className="h-4 w-4" />
                              <span className="text-[10px] font-semibold">{formatPoints(decoration.price)} XP</span>
                              <span className="text-[9px] uppercase tracking-[0.2em] text-white/70">Galaxy Beta</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Bio */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-8"
          >
            <h2 className="text-lg font-display font-semibold mb-3">About Me</h2>
            {isEditing ? (
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about yourself..."
                className="bg-secondary border-0 min-h-[120px] resize-none max-w-lg"
                maxLength={300}
              />
            ) : (
              <p className="text-muted-foreground max-w-lg">
                {bio || 'No bio yet. Click edit to add one!'}
              </p>
            )}
          </motion.div>

          {/* Points */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mb-8 bg-card rounded-2xl border border-border p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-display font-semibold">Nexus Points</h2>
              </div>
              <span className="text-sm text-muted-foreground">Level {level}</span>
            </div>

            <div className="flex items-baseline gap-3 mb-4">
              <p className="text-4xl font-display font-bold text-primary">{points}</p>
              <span className="text-sm text-muted-foreground">points</span>
            </div>

            <Progress value={levelPercent} className="h-3" />
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
              <span>{levelProgress} / 100 XP</span>
              <span>{nextLevelAt} next level</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Messages</span>
                </div>
                <p className="text-2xl font-display font-bold">{messagesCount}</p>
                <p className="text-xs text-muted-foreground">{messagesCount} pts earned</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Video className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Random Calls</span>
                </div>
                <p className="text-2xl font-display font-bold">{callConnections}</p>
                <p className="text-xs text-muted-foreground">{callConnections * 5} pts earned</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              Points are earned automatically and cannot be edited.
            </p>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8"
          >
            {[
              { label: 'Connections', value: String(callConnections) },
              { label: 'Rooms Joined', value: String(roomsJoined) },
              { label: 'Rooms Hosted', value: String(roomsHosted) },
              { label: 'Messages', value: String(messagesCount) },
            ].map((stat) => (
              <div key={stat.label} className="bg-card rounded-xl p-4 border border-border text-center">
                <p className="text-2xl font-display font-bold text-primary">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </motion.div>

          {/* Account Info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-lg font-display font-semibold mb-4">Account Information</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Calendar className="w-5 h-5" />
                <span>Joined {user.createdAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
              </div>
              <div className="flex items-center gap-3 text-muted-foreground">
                <Globe className="w-5 h-5" />
                <span>{user.email}</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
