import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Video,
  Users,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Clock,
  Star,
  ShoppingBag
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { avatarDataUri, isSafeImageUrl } from '@/lib/avatar';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface HomePageProps {
  onNavigate: (tab: string) => void;
}

type RoomSummary = {
  id: string;
  name: string;
  category: string | null;
  active_count: number | null;
};

type ThreadSummary = {
  id: string;
  user: {
    name: string;
    username: string;
    avatar: string;
    status: 'online' | 'offline' | 'away' | 'dnd';
  };
};

const quickActions = [
  { id: 'video', icon: Video, label: 'Start Video Chat', desc: 'Connect with real people', color: 'from-cyan-500 to-blue-500' },
  { id: 'rooms', icon: Users, label: 'Browse Rooms', desc: 'Join live spaces', color: 'from-purple-500 to-pink-500' },
  { id: 'messages', icon: MessageSquare, label: 'Messages', desc: 'Check your DMs', color: 'from-orange-500 to-rose-500' },
  { id: 'shop', icon: ShoppingBag, label: 'Shop', desc: 'Unlock cosmetics', color: 'from-emerald-500 to-lime-500' },
];

type RoomsRow = {
  id: string;
  name: string;
  category: string | null;
  active_count: number | null;
};

type ThreadRow = {
  thread_id: string;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar: string | null;
  other_status: 'online' | 'offline' | 'away' | 'dnd' | null;
};

export default function HomePage({ onNavigate }: HomePageProps) {
  const { user, stats } = useAuth();
  const { toast } = useToast();
  const [trendingRooms, setTrendingRooms] = useState<RoomSummary[]>([]);
  const [recentConnections, setRecentConnections] = useState<ThreadSummary[]>([]);
  const [roomsJoined, setRoomsJoined] = useState(0);

  const loadTrendingRooms = async () => {
    const { data, error } = await supabase.rpc('get_rooms');
    if (error) {
      toast({
        title: 'Unable to load rooms',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    const rooms = (data as RoomsRow[] | null) ?? [];
    const sorted = rooms
      .slice()
      .sort((a, b) => (b.active_count ?? 0) - (a.active_count ?? 0))
      .slice(0, 3)
      .map((room) => ({
        id: room.id,
        name: room.name,
        category: room.category,
        active_count: room.active_count,
      }));
    setTrendingRooms(sorted);
  };

  const loadRecentConnections = async () => {
    const { data, error } = await supabase.rpc('get_direct_threads');
    if (error) {
      console.warn('Failed to load recent conversations:', error.message);
      return;
    }

    const threads = (data as ThreadRow[] | null) ?? [];
    const mapped = threads.slice(0, 4).map((thread) => {
      const username = thread.other_username || 'user';
      const name = thread.other_display_name || username;
      const avatar = isSafeImageUrl(thread.other_avatar)
        ? thread.other_avatar || avatarDataUri(username)
        : avatarDataUri(username);
      return {
        id: thread.thread_id,
        user: {
          name,
          username,
          avatar,
          status: thread.other_status || 'offline',
        },
      };
    });
    setRecentConnections(mapped);
  };

  const loadRoomsJoined = async () => {
    if (!user) return;
    const { count, error } = await supabase
      .from('room_participants')
      .select('room_id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (error) {
      console.warn('Failed to load rooms joined:', error.message);
      return;
    }

    setRoomsJoined(count ?? 0);
  };

  useEffect(() => {
    void loadTrendingRooms();
    void loadRecentConnections();
    void loadRoomsJoined();
  }, [user?.id]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const statusColors = {
    online: 'bg-online',
    away: 'bg-away',
    offline: 'bg-offline',
    dnd: 'bg-dnd',
  };

  const statsSnapshot = useMemo(() => ({
    connections: stats?.callConnections ?? 0,
    roomsJoined,
    messages: stats?.messagesCount ?? 0,
  }), [roomsJoined, stats?.callConnections, stats?.messagesCount]);

  return (
    <div className="h-full overflow-y-auto">
      {/* Welcome Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-display font-bold mb-2">
          {getGreeting()}, <span className="text-gradient">{user?.displayName || 'Friend'}</span>!
        </h1>
        <p className="text-muted-foreground text-lg">Ready to connect with real people?</p>
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
      >
        {quickActions.map((action, index) => (
          <motion.button
            key={action.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 + index * 0.05 }}
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate(action.id)}
            className="relative group bg-card rounded-2xl border border-border p-6 text-left overflow-hidden transition-all hover:border-primary/50 hover:shadow-[var(--glow-soft)]"
          >
            <div className={cn(
              "absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity bg-gradient-to-br",
              action.color
            )} />
            <div className={cn(
              "w-14 h-14 rounded-xl bg-gradient-to-br flex items-center justify-center mb-4",
              action.color
            )}>
              <action.icon className="w-7 h-7 text-white" />
            </div>
            <h3 className="font-display font-semibold text-lg mb-1">{action.label}</h3>
            <p className="text-sm text-muted-foreground">{action.desc}</p>
          </motion.button>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trending Rooms */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-2 bg-card rounded-2xl border border-border p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold text-lg">Trending Rooms</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('rooms')}>
              View All
            </Button>
          </div>

          {trendingRooms.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No active rooms yet. Create one and start the vibe.
            </div>
          ) : (
            <div className="space-y-4">
              {trendingRooms.map((room, index) => (
                <motion.div
                  key={room.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer"
                  onClick={() => onNavigate('rooms')}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
                      <span className="text-primary-foreground font-bold">#{index + 1}</span>
                    </div>
                    <div>
                      <h3 className="font-medium">{room.name}</h3>
                      <p className="text-sm text-muted-foreground">{room.category || 'General'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span className="text-sm">{room.active_count ?? 0} active</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Recent Connections */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-card rounded-2xl border border-border p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold text-lg">Recent</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('messages')}>
              View All
            </Button>
          </div>

          {recentConnections.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No recent conversations yet.
            </div>
          ) : (
            <div className="space-y-3">
              {recentConnections.map((person, index) => (
                <motion.div
                  key={person.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-secondary transition-colors cursor-pointer"
                  onClick={() => onNavigate('messages')}
                >
                  <div className="relative">
                    <Avatar>
                      <AvatarImage src={person.user.avatar} />
                      <AvatarFallback>{person.user.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        "absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card",
                        statusColors[person.user.status]
                      )}
                    />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{person.user.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{person.user.status}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MessageSquare className="w-4 h-4" />
                  </Button>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Stats Banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-8 rounded-2xl gradient-primary p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Star className="w-8 h-8 text-primary-foreground" />
            <div>
              <h3 className="font-display font-bold text-xl text-primary-foreground">
                Keep the streak going
              </h3>
              <p className="text-primary-foreground/80">
                Every real conversation earns points
              </p>
            </div>
          </div>
          <div className="flex gap-8">
            <div className="text-center">
              <p className="text-3xl font-display font-bold text-primary-foreground">{statsSnapshot.connections}</p>
              <p className="text-sm text-primary-foreground/80">Connections</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-display font-bold text-primary-foreground">{statsSnapshot.roomsJoined}</p>
              <p className="text-sm text-primary-foreground/80">Rooms Joined</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-display font-bold text-primary-foreground">{statsSnapshot.messages}</p>
              <p className="text-sm text-primary-foreground/80">Messages</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
