import { motion } from 'framer-motion';
import { 
  Video, 
  MessageSquare, 
  Users, 
  Plus, 
  User, 
  Settings, 
  LogOut,
  ShoppingBag,
  Home,
  Sparkles
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const navItems = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'video', icon: Video, label: 'Video Chat' },
  { id: 'messages', icon: MessageSquare, label: 'Messages' },
  { id: 'rooms', icon: Users, label: 'Rooms' },
  { id: 'shop', icon: ShoppingBag, label: 'Shop' },
  { id: 'create', icon: Plus, label: 'Create Room' },
];

const bottomNavItems = [
  { id: 'profile', icon: User, label: 'Profile' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { user, logout, getEffectiveStatus } = useAuth();
  const currentStatus = getEffectiveStatus(user?.id, user?.status);

  const statusColors = {
    online: 'bg-online',
    away: 'bg-away',
    dnd: 'bg-dnd',
    offline: 'bg-offline',
  };

  return (
    <motion.aside
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="fixed left-0 top-0 h-screen w-[72px] bg-sidebar flex flex-col items-center py-4 border-r border-sidebar-border z-50"
    >
      {/* Logo */}
      <motion.div
        whileHover={{ scale: 1.1, rotate: 5 }}
        className="w-12 h-12 rounded-2xl gradient-primary flex items-center justify-center mb-6 cursor-pointer glow-primary"
        onClick={() => onTabChange('home')}
      >
        <Sparkles className="w-6 h-6 text-primary-foreground" />
      </motion.div>

      {/* Divider */}
      <div className="w-8 h-0.5 bg-sidebar-border rounded-full mb-4" />

      {/* Main Navigation */}
      <nav className="flex-1 flex flex-col items-center gap-2">
        {navItems.map((item) => (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300",
                  activeTab === item.id
                    ? "gradient-primary text-primary-foreground glow-primary"
                    : "bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-primary"
                )}
              >
                <item.icon className="w-5 h-5" />
              </motion.button>
            </TooltipTrigger>
            <TooltipContent side="right" className="glass">
              {item.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>

      {/* Divider */}
      <div className="w-8 h-0.5 bg-sidebar-border rounded-full my-4" />

      {/* Bottom Navigation */}
      <div className="flex flex-col items-center gap-2">
        {bottomNavItems.map((item) => (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300",
                  activeTab === item.id
                    ? "gradient-primary text-primary-foreground"
                    : "bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-primary"
                )}
              >
                <item.icon className="w-5 h-5" />
              </motion.button>
            </TooltipTrigger>
            <TooltipContent side="right" className="glass">
              {item.label}
            </TooltipContent>
          </Tooltip>
        ))}

        {/* Logout */}
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={logout}
              className="w-12 h-12 rounded-2xl flex items-center justify-center bg-sidebar-accent text-sidebar-foreground hover:bg-destructive hover:text-destructive-foreground transition-all duration-300"
            >
              <LogOut className="w-5 h-5" />
            </motion.button>
          </TooltipTrigger>
          <TooltipContent side="right" className="glass">
            Logout
          </TooltipContent>
        </Tooltip>

        {/* User Avatar */}
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.div
              whileHover={{ scale: 1.1 }}
              className="relative cursor-pointer mt-2"
              onClick={() => onTabChange('profile')}
            >
              <Avatar className="w-12 h-12 border-2 border-sidebar-border">
                <AvatarImage src={user?.avatar} />
                <AvatarFallback className="bg-secondary">
                  {user?.displayName?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
              <span 
                className={cn(
                  "absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-sidebar",
                  statusColors[currentStatus]
                )}
              />
            </motion.div>
          </TooltipTrigger>
          <TooltipContent side="right" className="glass">
            {user?.displayName || 'Profile'}
          </TooltipContent>
        </Tooltip>
      </div>
    </motion.aside>
  );
}
