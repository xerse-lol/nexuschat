import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { avatarDataUri, isSafeImageUrl } from '@/lib/avatar';
import { defaultBannerId, defaultDecorationId } from '@/lib/profileStyles';
import { supabase } from '@/lib/supabaseClient';

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatar: string;
  avatarVariant?: string;
  avatarDecoration?: string;
  profileBanner?: string;
  bio: string;
  status: 'online' | 'away' | 'dnd' | 'offline';
  customStatus?: string;
  isGalaxy: boolean;
  createdAt: Date;
}

export type OAuthProvider = 'google' | 'discord';

export interface AuthResult {
  success: boolean;
  error?: string;
  needsEmailConfirmation?: boolean;
}

export interface UserStats {
  points: number;
  messagesCount: number;
  callConnections: number;
}

export type StyleItemType = 'banner' | 'decoration';

export interface UserUnlocks {
  banners: string[];
  decorations: string[];
}

export interface PointsResult {
  success: boolean;
  error?: string;
  stats?: UserStats;
}

interface AuthContextType {
  user: User | null;
  stats: UserStats | null;
  unlocks: UserUnlocks | null;
  unlockingEnabled: boolean;
  isLoading: boolean;
  onlineCount: number | null;
  totalUsers: number | null;
  login: (email: string, password: string) => Promise<AuthResult>;
  signup: (email: string, password: string, username: string) => Promise<AuthResult>;
  loginWithOAuth: (provider: OAuthProvider) => Promise<AuthResult>;
  refreshStats: (targetUserId?: string) => Promise<void>;
  refreshUnlocks: (targetUserId?: string) => Promise<void>;
  awardMessagePoint: () => Promise<PointsResult>;
  awardCallPoint: () => Promise<PointsResult>;
  purchaseStyle: (itemType: StyleItemType, itemId: string) => Promise<PointsResult>;
  logout: () => void;
  updateProfile: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getMetadataValue = (metadata: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
};

const getBooleanMetadataValue = (metadata: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
      }
    }
  }
  return false;
};

const normalizeStatus = (value: unknown): User['status'] => {
  if (value === 'online' || value === 'away' || value === 'dnd' || value === 'offline') {
    return value;
  }
  return 'online';
};

const mapSupabaseUser = (supabaseUser: SupabaseUser | null): User | null => {
  if (!supabaseUser) return null;

  const metadata = (supabaseUser.user_metadata || {}) as Record<string, unknown>;
  const username = getMetadataValue(metadata, ['username', 'preferred_username', 'user_name'])
    || (supabaseUser.email ? supabaseUser.email.split('@')[0] : supabaseUser.id);
  const displayName = getMetadataValue(metadata, ['displayName', 'display_name', 'full_name', 'name']) || username;
  const avatarCandidate = getMetadataValue(metadata, ['avatar_url', 'picture', 'avatar']);
  const avatarVariant = getMetadataValue(metadata, ['avatarVariant', 'avatar_variant']);
  const avatarDecoration = getMetadataValue(metadata, ['avatarDecoration', 'avatar_decoration']);
  const profileBanner = getMetadataValue(metadata, ['profileBanner', 'profile_banner']);
  const isGalaxy = getBooleanMetadataValue(metadata, ['galaxy', 'galaxy_member', 'isGalaxy', 'is_galaxy', 'galaxy_beta']);
  const avatar = isSafeImageUrl(avatarCandidate)
    ? avatarCandidate
    : avatarDataUri(username);
  const bio = getMetadataValue(metadata, ['bio']) || '';
  const customStatus = getMetadataValue(metadata, ['customStatus', 'custom_status']);
  const status = normalizeStatus(metadata.status);

  return {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    username,
    displayName,
    avatar,
    avatarVariant,
    avatarDecoration,
    profileBanner,
    bio,
    status,
    customStatus,
    isGalaxy,
    createdAt: new Date(supabaseUser.created_at),
  };
};

type UserStatsRow = {
  points: number;
  messages_count: number;
  call_connections: number;
};

type UserUnlockRow = {
  item_type: StyleItemType;
  item_id: string;
};

const defaultStats: UserStats = {
  points: 0,
  messagesCount: 0,
  callConnections: 0,
};

const mapStatsRow = (row?: UserStatsRow | null): UserStats => ({
  points: row?.points ?? 0,
  messagesCount: row?.messages_count ?? 0,
  callConnections: row?.call_connections ?? 0,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [unlocks, setUnlocks] = useState<UserUnlocks | null>(null);
  const [unlockingEnabled, setUnlockingEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);

  const syncProfile = useCallback(async (nextUser: User) => {
    const { error } = await supabase.from('profiles').upsert({
      id: nextUser.id,
      username: nextUser.username,
      display_name: nextUser.displayName,
      avatar: nextUser.avatar,
      avatar_variant: nextUser.avatarVariant ?? null,
      avatar_decoration: nextUser.avatarDecoration ?? null,
      profile_banner: nextUser.profileBanner ?? null,
      status: nextUser.status,
      custom_status: nextUser.customStatus ?? null,
      is_galaxy: nextUser.isGalaxy ?? false,
    });

    if (error) {
      console.warn('Failed to sync profile:', error.message);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (error) {
        console.error('Failed to load session:', error.message);
      }
      setUser(mapSupabaseUser(data.session?.user ?? null));
      setIsLoading(false);
    };

    loadSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setUser(mapSupabaseUser(session?.user ?? null));
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setOnlineCount(null);
      return;
    }

    let isMounted = true;
    const channel = supabase.channel('global-presence', {
      config: {
        presence: { key: user.id },
        broadcast: { ack: false },
      },
    });

    const updatePresence = () => {
      if (!isMounted) return;
      const state = channel.presenceState() as Record<string, unknown[]>;
      setOnlineCount(Object.keys(state).length);
    };

    channel.on('presence', { event: 'sync' }, updatePresence);
    channel.on('presence', { event: 'join' }, updatePresence);
    channel.on('presence', { event: 'leave' }, updatePresence);

    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      await channel.track({
        user_id: user.id,
        updated_at: new Date().toISOString(),
      });
    });

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      setTotalUsers(null);
      return;
    }

    let isMounted = true;
    const loadTotalUsers = async () => {
      const { count, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true });
      if (error) {
        console.warn('Failed to load total users:', error.message);
        return;
      }
      if (isMounted) {
        setTotalUsers(count ?? 0);
      }
    };

    void loadTotalUsers();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const refreshStats = useCallback(async (targetUserId?: string) => {
    const userId = targetUserId ?? user?.id;
    if (!userId) {
      setStats(null);
      return;
    }

    const { data, error } = await supabase
      .from('user_stats')
      .select('points, messages_count, call_connections')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.warn('Failed to load user stats:', error.message);
      setStats(defaultStats);
      return;
    }

    setStats(mapStatsRow(data));
  }, [user?.id]);

  const refreshUnlocks = useCallback(async (targetUserId?: string) => {
    const userId = targetUserId ?? user?.id;
    if (!userId) {
      setUnlocks(null);
      return;
    }

    const { data, error } = await supabase
      .from('user_unlocks')
      .select('item_type, item_id')
      .eq('user_id', userId);

    if (error) {
      console.warn('Failed to load user unlocks:', error.message);
      setUnlockingEnabled(false);
      setUnlocks(null);
      return;
    }

    const nextUnlocks: UserUnlocks = { banners: [], decorations: [] };
    const rows = (data ?? []) as UserUnlockRow[];
    rows.forEach((row) => {
      if (row.item_type === 'banner') {
        nextUnlocks.banners.push(row.item_id);
      } else if (row.item_type === 'decoration') {
        nextUnlocks.decorations.push(row.item_id);
      }
    });

    setUnlockingEnabled(true);
    setUnlocks(nextUnlocks);
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      setStats(null);
      return;
    }
    void refreshStats(user.id);
  }, [refreshStats, user?.id]);

  useEffect(() => {
    if (!user) {
      setUnlocks(null);
      setUnlockingEnabled(true);
      return;
    }
    void refreshUnlocks(user.id);
  }, [refreshUnlocks, user?.id]);

  useEffect(() => {
    if (!user) return;
    void syncProfile(user);
  }, [syncProfile, user]);

  const login = async (email: string, password: string): Promise<AuthResult> => {
    setIsLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setIsLoading(false);
      return { success: false, error: error.message };
    }

    setUser(mapSupabaseUser(data.user ?? null));
    setIsLoading(false);
    return { success: true };
  };

  const signup = async (email: string, password: string, username: string): Promise<AuthResult> => {
    setIsLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          displayName: username,
          avatar_url: avatarDataUri(username),
          avatarVariant: 'orbit',
          avatarDecoration: defaultDecorationId,
          profileBanner: defaultBannerId,
          galaxy: false,
        },
      },
    });

    if (error) {
      setIsLoading(false);
      return { success: false, error: error.message };
    }

    if (data.session?.user) {
      setUser(mapSupabaseUser(data.session.user));
    }
    setIsLoading(false);
    return {
      success: true,
      needsEmailConfirmation: !data.session,
    };
  };

  const loginWithOAuth = async (provider: OAuthProvider): Promise<AuthResult> => {
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setIsLoading(false);
      return { success: false, error: error.message };
    }

    setIsLoading(false);
    return { success: true };
  };

  const awardMessagePoint = async (): Promise<PointsResult> => {
    if (!user) {
      return { success: false, error: 'Not signed in' };
    }

    const { data, error } = await supabase.rpc('award_message_point');
    if (error) {
      console.warn('Failed to award message point:', error.message);
      return { success: false, error: error.message };
    }

    const nextStats = mapStatsRow(Array.isArray(data) ? data[0] : (data as UserStatsRow | null));
    setStats(nextStats);
    return { success: true, stats: nextStats };
  };

  const awardCallPoint = async (): Promise<PointsResult> => {
    if (!user) {
      return { success: false, error: 'Not signed in' };
    }

    const { data, error } = await supabase.rpc('award_call_point');
    if (error) {
      console.warn('Failed to award call point:', error.message);
      return { success: false, error: error.message };
    }

    const nextStats = mapStatsRow(Array.isArray(data) ? data[0] : (data as UserStatsRow | null));
    setStats(nextStats);
    return { success: true, stats: nextStats };
  };

  const purchaseStyle = async (itemType: StyleItemType, itemId: string): Promise<PointsResult> => {
    if (!user) {
      return { success: false, error: 'Not signed in' };
    }

    if (!unlockingEnabled) {
      return { success: false, error: 'Unlocks are not configured' };
    }

    const { data, error } = await supabase.rpc('purchase_style', {
      p_item_type: itemType,
      p_item_id: itemId,
    });

    if (error) {
      console.warn('Failed to purchase style:', error.message);
      return { success: false, error: error.message };
    }

    const nextStats = mapStatsRow(Array.isArray(data) ? data[0] : (data as UserStatsRow | null));
    setStats(nextStats);
    setUnlocks((prev) => {
      const next = prev ?? { banners: [], decorations: [] };
      if (itemType === 'banner') {
        if (next.banners.includes(itemId)) return next;
        return { ...next, banners: [...next.banners, itemId] };
      }
      if (next.decorations.includes(itemId)) return next;
      return { ...next, decorations: [...next.decorations, itemId] };
    });

    return { success: true, stats: nextStats };
  };

  const logout = () => {
    setUser(null);
    setStats(null);
    setUnlocks(null);
    setUnlockingEnabled(true);
    void supabase.auth.signOut();
  };

  const updateProfile = (updates: Partial<User>) => {
    if (user) {
      const updated = { ...user, ...updates };
      setUser(updated);

      const metadataUpdates: Record<string, string> = {};
      if (updates.displayName !== undefined) metadataUpdates.displayName = updates.displayName;
      if (updates.username !== undefined) metadataUpdates.username = updates.username;
      if (updates.avatar !== undefined && isSafeImageUrl(updates.avatar)) {
        metadataUpdates.avatar_url = updates.avatar;
      }
      if (updates.avatarVariant !== undefined) metadataUpdates.avatarVariant = updates.avatarVariant;
      if (updates.avatarDecoration !== undefined) metadataUpdates.avatarDecoration = updates.avatarDecoration;
      if (updates.profileBanner !== undefined) metadataUpdates.profileBanner = updates.profileBanner;
      if (updates.bio !== undefined) metadataUpdates.bio = updates.bio;
      if (updates.status !== undefined) metadataUpdates.status = updates.status;
      if (updates.customStatus !== undefined) metadataUpdates.customStatus = updates.customStatus;

      void supabase.auth.updateUser({ data: metadataUpdates });
      void syncProfile(updated);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        stats,
        unlocks,
        unlockingEnabled,
        isLoading,
        onlineCount,
        totalUsers,
        login,
        signup,
        loginWithOAuth,
        refreshStats,
        refreshUnlocks,
        awardMessagePoint,
        awardCallPoint,
        purchaseStyle,
        logout,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
