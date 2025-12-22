import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Send, Smile, Paperclip, MoreVertical, Phone, Video, MessageSquarePlus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { avatarDataUri, isSafeImageUrl } from '@/lib/avatar';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  content: string;
  sender: 'me' | 'them';
  senderId: string;
  timestamp: Date;
}

interface ThreadSummary {
  id: string;
  user: {
    id: string;
    name: string;
    username: string;
    avatar: string;
    status: 'online' | 'offline' | 'away' | 'dnd';
  };
  lastMessage: string;
  lastMessageAt: Date | null;
  unread: number;
}

type ThreadRow = {
  thread_id: string;
  other_user_id: string;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar: string | null;
  other_status: 'online' | 'offline' | 'away' | 'dnd' | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number | null;
};

type MessageRow = {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
};

export default function DirectMessages() {
  const { user, awardMessagePoint } = useAuth();
  const { toast } = useToast();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const statusColors = {
    online: 'bg-online',
    away: 'bg-away',
    dnd: 'bg-dnd',
    offline: 'bg-offline',
  };

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );

  const mapThreadRow = useCallback((row: ThreadRow): ThreadSummary => {
    const username = row.other_username || 'user';
    const displayName = row.other_display_name || username;
    const avatar = isSafeImageUrl(row.other_avatar)
      ? row.other_avatar || avatarDataUri(username)
      : avatarDataUri(username);

    return {
      id: row.thread_id,
      user: {
        id: row.other_user_id,
        name: displayName,
        username,
        avatar,
        status: row.other_status || 'offline',
      },
      lastMessage: row.last_message || 'No messages yet',
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
      unread: row.unread_count ?? 0,
    };
  }, []);

  const mapMessageRow = useCallback(
    (row: MessageRow): Message => ({
      id: row.id,
      content: row.content,
      sender: row.sender_id === user?.id ? 'me' : 'them',
      senderId: row.sender_id,
      timestamp: new Date(row.created_at),
    }),
    [user?.id]
  );

  const loadThreads = useCallback(async () => {
    if (!user) return;
    setIsLoadingThreads(true);
    const { data, error } = await supabase.rpc('get_direct_threads');

    if (error) {
      toast({
        title: 'Unable to load messages',
        description: error.message,
        variant: 'destructive',
      });
      setIsLoadingThreads(false);
      return;
    }

    const mapped = (data as ThreadRow[] | null)?.map(mapThreadRow) ?? [];
    setThreads(mapped);
    setIsLoadingThreads(false);

    if (pendingThreadId) {
      setSelectedThreadId(pendingThreadId);
      setPendingThreadId(null);
      return;
    }

    if (!selectedThreadId && mapped.length > 0) {
      setSelectedThreadId(mapped[0].id);
    }
  }, [pendingThreadId, selectedThreadId, toast, user, mapThreadRow]);

  const loadMessages = useCallback(
    async (threadId: string) => {
      if (!user) return;
      setIsLoadingMessages(true);
      const { data, error } = await supabase
        .from('direct_messages')
        .select('id, content, sender_id, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });

      if (error) {
        toast({
          title: 'Unable to load conversation',
          description: error.message,
          variant: 'destructive',
        });
        setIsLoadingMessages(false);
        return;
      }

      const mapped = (data as MessageRow[] | null)?.map(mapMessageRow) ?? [];
      setMessages(mapped);
      setIsLoadingMessages(false);
      void supabase.rpc('mark_thread_read', { p_thread_id: threadId });
    },
    [mapMessageRow, toast, user]
  );

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedThreadId);
  }, [loadMessages, selectedThreadId]);

  useEffect(() => {
    if (!user) return undefined;

    const channel = supabase
      .channel('direct_messages_stream')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        (payload) => {
          void loadThreads();
          if (payload.new && payload.new.thread_id === selectedThreadId) {
            const next = mapMessageRow(payload.new as MessageRow);
            setMessages((prev) => (prev.some((msg) => msg.id === next.id) ? prev : [...prev, next]));
            void supabase.rpc('mark_thread_read', { p_thread_id: payload.new.thread_id });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadThreads, mapMessageRow, selectedThreadId, user]);

  const handleSendMessage = async () => {
    const trimmed = messageInput.trim();
    if (!trimmed || !selectedThreadId || !user) return;

    const { data, error } = await supabase
      .from('direct_messages')
      .insert({
        thread_id: selectedThreadId,
        sender_id: user.id,
        content: trimmed,
      })
      .select('id, content, sender_id, created_at')
      .single();

    if (error) {
      toast({
        title: 'Message failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    const nextMessage = mapMessageRow(data as MessageRow);
    setMessages((prev) => [...prev, nextMessage]);
    setMessageInput('');
    void supabase.rpc('mark_thread_read', { p_thread_id: selectedThreadId });
    void awardMessagePoint();
    void loadThreads();
  };

  const handleCreateThread = async () => {
    const trimmed = newUsername.trim();
    if (!trimmed) return;

    const { data, error } = await supabase.rpc('create_direct_thread', {
      p_target_username: trimmed,
    });

    if (error) {
      toast({
        title: 'Unable to start conversation',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    const threadId = (data as string | null) ?? null;
    setDialogOpen(false);
    setNewUsername('');
    if (threadId) {
      setPendingThreadId(threadId);
    }
    void loadThreads();
  };

  const filteredThreads = threads.filter((thread) => {
    const q = searchQuery.toLowerCase();
    return (
      thread.user.name.toLowerCase().includes(q) ||
      thread.user.username.toLowerCase().includes(q)
    );
  });

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="h-full flex">
      {/* Conversations List */}
      <div className="w-80 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-bold">Messages</h2>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MessageSquarePlus className="w-5 h-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>New Message</DialogTitle>
                  <DialogDescription>Start a new conversation by username.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Username</label>
                    <Input
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="Enter a username"
                      className="mt-2 bg-secondary border-0"
                    />
                  </div>
                  <Button variant="hero" onClick={handleCreateThread}>
                    Start Conversation
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-secondary border-0"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {isLoadingThreads && (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                Loading conversations...
              </div>
            )}

            {!isLoadingThreads && filteredThreads.length === 0 && (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                No conversations yet. Start a new one.
              </div>
            )}

            {filteredThreads.map((thread) => (
              <ConversationItem
                key={thread.id}
                conversation={thread}
                isSelected={selectedThread?.id === thread.id}
                onClick={() => setSelectedThreadId(thread.id)}
                statusColors={statusColors}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedThread ? (
          <>
            {/* Chat Header */}
            <div className="h-16 px-6 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Avatar>
                    <AvatarImage src={selectedThread.user.avatar} />
                    <AvatarFallback>{selectedThread.user.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span
                    className={cn(
                      "absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background",
                      statusColors[selectedThread.user.status]
                    )}
                  />
                </div>
                <div>
                  <h3 className="font-semibold">{selectedThread.user.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedThread.user.status === 'online'
                      ? 'Online'
                      : selectedThread.user.status === 'away'
                      ? 'Away'
                      : selectedThread.user.status === 'dnd'
                      ? 'Do not disturb'
                      : 'Offline'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon">
                  <Phone className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="icon">
                  <Video className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-6">
              {isLoadingMessages && (
                <div className="text-sm text-muted-foreground">Loading messages...</div>
              )}
              <div className="space-y-4">
                <AnimatePresence>
                  {messages.map((msg, index) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={cn(
                        "flex",
                        msg.sender === 'me' ? 'justify-end' : 'justify-start'
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[70%] px-4 py-2 rounded-2xl",
                          msg.sender === 'me'
                            ? 'gradient-primary text-primary-foreground rounded-br-md'
                            : 'bg-secondary text-secondary-foreground rounded-bl-md'
                        )}
                      >
                        <p>{msg.content}</p>
                        <p
                          className={cn(
                            "text-xs mt-1",
                            msg.sender === 'me'
                              ? 'text-primary-foreground/70'
                              : 'text-muted-foreground'
                          )}
                        >
                          {formatTime(msg.timestamp)}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </ScrollArea>

            {/* Message Input */}
            <div className="p-4 border-t border-border">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon">
                  <Paperclip className="w-5 h-5" />
                </Button>
                <Input
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="flex-1 bg-secondary border-0"
                />
                <Button variant="ghost" size="icon">
                  <Smile className="w-5 h-5" />
                </Button>
                <Button variant="hero" size="icon" onClick={handleSendMessage}>
                  <Send className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p>Select a conversation to start chatting</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationItem({
  conversation,
  isSelected,
  onClick,
  statusColors,
}: {
  conversation: ThreadSummary;
  isSelected: boolean;
  onClick: () => void;
  statusColors: Record<string, string>;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "w-full p-3 rounded-xl flex items-center gap-3 transition-colors",
        isSelected ? 'bg-secondary' : 'hover:bg-secondary/50'
      )}
    >
      <div className="relative">
        <Avatar>
          <AvatarImage src={conversation.user.avatar} />
          <AvatarFallback>{conversation.user.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <span
          className={cn(
            "absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background",
            statusColors[conversation.user.status]
          )}
        />
      </div>
      <div className="flex-1 text-left">
        <div className="flex items-center justify-between">
          <span className="font-medium">{conversation.user.name}</span>
          {conversation.unread > 0 && (
            <span className="w-5 h-5 rounded-full gradient-primary text-xs flex items-center justify-center text-primary-foreground">
              {conversation.unread}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground truncate">{conversation.lastMessage}</p>
      </div>
    </motion.button>
  );
}
