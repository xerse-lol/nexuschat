import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Lock,
  Globe,
  Search,
  Gamepad2,
  Music,
  Code,
  Coffee,
  Film,
  BookOpen,
  Sparkles,
  Crown,
  Radio
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { avatarDataUri, isSafeImageUrl } from '@/lib/avatar';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Room {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  is_private: boolean;
  max_members: number;
  theme: string;
  tags: string[] | null;
  host_id: string;
  host_username: string | null;
  host_display_name: string | null;
  host_avatar: string | null;
  active_count: number | null;
  member_count: number | null;
  active_sample?: RoomSample[] | null;
}

type RoomSample = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
};

type PresenceMember = {
  user_id?: string;
  username?: string;
  display_name?: string;
  avatar?: string;
};

const categories = [
  { id: 'all', name: 'All', icon: Sparkles },
  { id: 'gaming', name: 'Gaming', icon: Gamepad2 },
  { id: 'music', name: 'Music', icon: Music },
  { id: 'tech', name: 'Tech', icon: Code },
  { id: 'social', name: 'Social', icon: Coffee },
  { id: 'entertainment', name: 'Entertainment', icon: Film },
  { id: 'education', name: 'Education', icon: BookOpen },
];

export default function RoomsList() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [joinedRoomIds, setJoinedRoomIds] = useState<string[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [presenceMembers, setPresenceMembers] = useState<PresenceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const joinedRoomSet = useMemo(() => new Set(joinedRoomIds), [joinedRoomIds]);
  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [activeRoomId, rooms]
  );

  const loadRooms = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.rpc('get_rooms');

    if (error) {
      toast({
        title: 'Unable to load rooms',
        description: error.message,
        variant: 'destructive',
      });
      setIsLoading(false);
      return;
    }

    setRooms((data as Room[] | null) ?? []);
    setIsLoading(false);
  }, [toast]);

  const loadJoinedRooms = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('room_participants')
      .select('room_id')
      .eq('user_id', user.id);

    if (error) {
      console.warn('Failed to load room membership:', error.message);
      return;
    }

    setJoinedRoomIds((data ?? []).map((row) => row.room_id));
  }, [user]);

  useEffect(() => {
    void loadRooms();
    void loadJoinedRooms();
  }, [loadJoinedRooms, loadRooms]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadRooms();
    }, 15000);

    return () => clearInterval(interval);
  }, [loadRooms]);

  useEffect(() => {
    if (!activeRoomId) return undefined;
    void supabase.rpc('touch_room_presence', { p_room_id: activeRoomId });
    const interval = setInterval(() => {
      void supabase.rpc('touch_room_presence', { p_room_id: activeRoomId });
    }, 30000);
    return () => clearInterval(interval);
  }, [activeRoomId]);

  useEffect(() => {
    if (!activeRoomId || !user) {
      setPresenceMembers([]);
      return undefined;
    }

    setPresenceMembers([]);

    const channel = supabase.channel(`room-presence:${activeRoomId}`, {
      config: {
        presence: { key: user.id },
      },
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, PresenceMember[]>;
      const deduped = new Map<string, PresenceMember>();
      Object.entries(state).forEach(([key, entries]) => {
        entries.forEach((entry) => {
          const memberId = entry.user_id ?? key;
          if (!memberId) return;
          deduped.set(memberId, { ...entry, user_id: memberId });
        });
      });
      setPresenceMembers(Array.from(deduped.values()));
    });

    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      await channel.track({
        user_id: user.id,
        username: user.username,
        display_name: user.displayName,
        avatar: user.avatar,
        updated_at: new Date().toISOString(),
      });
    });

    return () => {
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [activeRoomId, user?.avatar, user?.displayName, user?.id, user?.username]);

  const handleJoinRoom = async (room: Room) => {
    if (!user) return;
    if (room.is_private && room.host_id !== user.id) {
      toast({
        title: 'Private room',
        description: 'This room is invite-only for now.',
      });
      return;
    }

    const { error } = await supabase.rpc('join_room', { p_room_id: room.id });
    if (error) {
      toast({
        title: 'Unable to join room',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    setJoinedRoomIds((prev) => (prev.includes(room.id) ? prev : [...prev, room.id]));
    setActiveRoomId(room.id);
    void loadRooms();
  };

  const handleLeaveRoom = async (roomId: string) => {
    const { error } = await supabase.rpc('leave_room', { p_room_id: roomId });
    if (error) {
      toast({
        title: 'Unable to leave room',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    setJoinedRoomIds((prev) => prev.filter((id) => id !== roomId));
    setActiveRoomId((prev) => (prev === roomId ? null : prev));
    void loadRooms();
  };

  const filteredRooms = rooms.filter((room) => {
    const matchesSearch =
      room.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (room.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'all' ||
      (room.category || '').toLowerCase() === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const formatCount = (value: number | null) => value ?? 0;
  const resolveAvatar = (member: { username?: string | null; display_name?: string | null; avatar?: string | null }) => {
    const name = member.display_name || member.username || 'user';
    if (!member.avatar || !isSafeImageUrl(member.avatar)) {
      return avatarDataUri(name);
    }
    return member.avatar;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-foreground mb-2">Explore Rooms</h1>
        <p className="text-muted-foreground">Join conversations with real people</p>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="Search rooms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-11 bg-secondary border-0 h-12"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {categories.map((cat) => (
          <motion.button
            key={cat.id}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setSelectedCategory(cat.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap transition-all",
              selectedCategory === cat.id
                ? "gradient-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            )}
          >
            <cat.icon className="w-4 h-4" />
            {cat.name}
          </motion.button>
        ))}
      </div>

      {activeRoom && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-display font-semibold">Live visitors in {activeRoom.name}</h3>
              <p className="text-sm text-muted-foreground">Real-time presence for the room you joined</p>
            </div>
            <Badge variant="destructive" className="gap-1">
              <span className="w-2 h-2 rounded-full bg-destructive-foreground animate-pulse" />
              LIVE
            </Badge>
          </div>
          {presenceMembers.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-3">
              {presenceMembers.map((member) => {
                const label = member.display_name || member.username || 'user';
                return (
                  <div key={member.user_id ?? label} className="flex items-center gap-2 rounded-full bg-secondary px-3 py-2">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={resolveAvatar(member)} />
                      <AvatarFallback>{label.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{label}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No one is active in this room yet.</p>
          )}
        </div>
      )}

      {/* Rooms Grid */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="text-sm text-muted-foreground">Loading rooms...</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredRooms.map((room, index) => {
            const activeCount = formatCount(room.active_count);
            const memberCount = formatCount(room.member_count);
            const activeSample = Array.isArray(room.active_sample) ? room.active_sample : [];
            const isJoined = joinedRoomSet.has(room.id);
            const isActive = activeRoomId === room.id;
            const hostName = room.host_display_name || room.host_username || 'Host';
            const hostAvatar = isSafeImageUrl(room.host_avatar)
              ? room.host_avatar || avatarDataUri(hostName)
              : avatarDataUri(hostName);

            return (
              <motion.div
                key={room.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="group relative bg-card rounded-2xl border border-border p-5 hover:border-primary/50 transition-all duration-300 hover:shadow-[var(--glow-soft)]"
              >
                {/* Live Badge */}
                {activeCount > 0 && (
                  <div className="absolute top-4 right-4">
                    <Badge variant="destructive" className="gap-1">
                      <span className="w-2 h-2 rounded-full bg-destructive-foreground animate-pulse" />
                      LIVE
                    </Badge>
                  </div>
                )}

                {/* Room Icon & Info */}
                <div className="flex items-start gap-4 mb-4">
                  <div className={cn(
                    "w-14 h-14 rounded-xl flex items-center justify-center",
                    activeCount > 0 ? "gradient-primary" : "bg-secondary"
                  )}>
                    <Radio className={cn(
                      "w-7 h-7",
                      activeCount > 0 ? "text-primary-foreground" : "text-foreground"
                    )} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display font-semibold text-lg">{room.name}</h3>
                      {room.is_private && <Lock className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {room.description || 'No description yet.'}
                    </p>
                  </div>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {(room.tags ?? []).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>

                {/* Host & Members */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={hostAvatar} />
                      <AvatarFallback>{hostName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-muted-foreground">{hostName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span>{activeCount}/{room.max_members} active</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Crown className="w-3 h-3" />
                    {memberCount} total
                  </span>
                  <span className="flex items-center gap-1">
                    <Globe className="w-3 h-3" />
                    {room.category || 'General'}
                  </span>
                </div>

                {activeCount > 0 ? (
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center -space-x-2">
                      {activeSample.slice(0, 4).map((member) => {
                        const label = member.display_name || member.username || 'user';
                        return (
                          <Avatar key={member.id} className="h-7 w-7 border-2 border-card">
                            <AvatarImage src={resolveAvatar(member)} />
                            <AvatarFallback className="text-[10px]">{label.charAt(0)}</AvatarFallback>
                          </Avatar>
                        );
                      })}
                      {activeCount > activeSample.length && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          +{activeCount - activeSample.length}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">Active now</span>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-muted-foreground">No active visitors yet</div>
                )}

                {/* Join Button */}
                <Button
                  variant={isActive ? 'destructive' : 'hero'}
                  className="w-full mt-4 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    if (isActive) {
                      void handleLeaveRoom(room.id);
                    } else {
                      void handleJoinRoom(room);
                    }
                  }}
                >
                  {isActive
                    ? 'Leave Room'
                    : isJoined
                    ? 'Rejoin Room'
                    : room.is_private
                    ? 'Request Access'
                    : 'Join Room'}
                </Button>
              </motion.div>
            );
          })}
        </div>

        {!isLoading && filteredRooms.length === 0 && (
          <div className="text-center py-12">
            <Globe className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No rooms found</h3>
            <p className="text-muted-foreground">Try adjusting your search or filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
