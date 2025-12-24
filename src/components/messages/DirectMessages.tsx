import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Send,
  Smile,
  Paperclip,
  MoreVertical,
  Phone,
  Video,
  X,
  FileText,
  MessageSquarePlus,
  UserPlus,
  UserMinus,
  Shield,
  EyeOff,
  Eye,
  PhoneOff,
  Mic,
  MicOff,
  VideoOff,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  attachments: Attachment[];
}

type Attachment = {
  url: string;
  type: string;
  name: string;
  size: number;
  path?: string;
};

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl?: string;
  kind: 'image' | 'video' | 'file';
};

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
  isHidden: boolean;
  isFriend: boolean;
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
  is_hidden: boolean | null;
  is_friend: boolean | null;
};

type MessageRow = {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  attachments: unknown;
};

type FriendRequestRow = {
  request_id: string;
  requester_id: string;
  requester_username: string | null;
  requester_display_name: string | null;
  requester_avatar: string | null;
  created_at: string;
};

type FriendRequest = {
  id: string;
  requesterId: string;
  name: string;
  username: string;
  avatar: string;
  createdAt: Date;
};

type CallMode = 'audio' | 'video';

type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'in_call';

type CallSignal =
  | { type: 'ring'; from: string; mode: CallMode }
  | { type: 'accept'; from: string; mode: CallMode }
  | { type: 'reject'; from: string }
  | { type: 'offer'; from: string; mode: CallMode; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; from: string; candidate: RTCIceCandidateInit }
  | { type: 'hangup'; from: string };

const defaultIceServers: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

const getIceConfig = (): RTCConfiguration => {
  const turnUrlsRaw = (import.meta.env.VITE_TURN_URLS || import.meta.env.VITE_TURN_URL || '').trim();
  const turnUsername = (import.meta.env.VITE_TURN_USERNAME || '').trim();
  const turnCredential = (import.meta.env.VITE_TURN_CREDENTIAL || '').trim();
  const forceRelay = (import.meta.env.VITE_FORCE_RELAY || '').toLowerCase() === 'true';
  const iceServers: RTCIceServer[] = [...defaultIceServers];

  if (turnUrlsRaw) {
    const urls = turnUrlsRaw
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
    const turnServer: RTCIceServer = { urls };
    if (turnUsername && turnCredential) {
      turnServer.username = turnUsername;
      turnServer.credential = turnCredential;
    }
    iceServers.push(turnServer);
  }

  return {
    iceServers,
    iceTransportPolicy: forceRelay ? 'relay' : 'all',
  };
};

const ATTACHMENT_BUCKET = 'dm-attachments';
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const EMOJI_CODES = [
  0x1f600, 0x1f603, 0x1f604, 0x1f60a, 0x1f60d, 0x1f618, 0x1f61c, 0x1f61d, 0x1f44d, 0x1f44f,
  0x1f389, 0x1f525, 0x1f4aa, 0x1f44c, 0x1f64c, 0x1f62d, 0x1f62e, 0x1f622, 0x1f623, 0x1f625,
  0x1f614, 0x1f62a, 0x1f611, 0x1f636, 0x1f970, 0x1f973, 0x1f9e1, 0x2764, 0x1f680,
];
const EMOJIS = EMOJI_CODES.map((code) => String.fromCodePoint(code));

const createAttachmentId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const toAttachmentKind = (file: File): PendingAttachment['kind'] => {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'file';
};

const normalizeAttachments = (value: unknown): Attachment[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const url = typeof record.url === 'string' ? record.url : '';
      if (!url) return null;
      const type = typeof record.type === 'string' ? record.type : 'application/octet-stream';
      const name = typeof record.name === 'string' ? record.name : 'Attachment';
      const size = typeof record.size === 'number' ? record.size : 0;
      const path = typeof record.path === 'string' ? record.path : undefined;
      return { url, type, name, size, path };
    })
    .filter(Boolean) as Attachment[];
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export default function DirectMessages() {
  const { user, awardMessagePoint, getEffectiveStatus } = useAuth();
  const { toast } = useToast();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [friendDialogOpen, setFriendDialogOpen] = useState(false);
  const [friendRequestUsername, setFriendRequestUsername] = useState('');
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const threadsRef = useRef<ThreadSummary[]>([]);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const readMarkerRef = useRef<HTMLDivElement | null>(null);
  const selectedThreadRef = useRef<ThreadSummary | null>(null);
  const callPhaseRef = useRef<CallPhase>('idle');
  const [callPhase, setCallPhase] = useState<CallPhase>('idle');
  const [callMode, setCallMode] = useState<CallMode>('video');
  const [incomingCall, setIncomingCall] = useState<{ fromId: string; mode: CallMode } | null>(null);
  const [callAudioEnabled, setCallAudioEnabled] = useState(true);
  const [callVideoEnabled, setCallVideoEnabled] = useState(true);
  const [needsRemoteTap, setNeedsRemoteTap] = useState(false);
  const callChannelRef = useRef<RealtimeChannel | null>(null);
  const callPeerRef = useRef<RTCPeerConnection | null>(null);
  const callLocalStreamRef = useRef<MediaStream | null>(null);
  const callRemoteStreamRef = useRef<MediaStream | null>(null);
  const callOffererRef = useRef(false);
  const callPeerIdRef = useRef<string | null>(null);
  const pendingCallIceRef = useRef<RTCIceCandidateInit[]>([]);
  const callLocalVideoRef = useRef<HTMLVideoElement | null>(null);
  const callRemoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  const selectedEffectiveStatus = selectedThread
    ? getEffectiveStatus(selectedThread.user.id, selectedThread.user.status)
    : 'offline';

  useEffect(() => {
    selectedThreadRef.current = selectedThread;
  }, [selectedThread]);

  useEffect(() => {
    callPhaseRef.current = callPhase;
  }, [callPhase]);

  const mapThreadRow = useCallback((row: ThreadRow): ThreadSummary => {
    const username = row.other_username || 'user';
    const displayName = row.other_display_name || username;
    const avatar = isSafeImageUrl(row.other_avatar)
      ? row.other_avatar || avatarDataUri(username)
      : avatarDataUri(username);
    const lastMessageValue = row.last_message?.trim();
    const lastMessage = lastMessageValue
      ? lastMessageValue
      : row.last_message_at
      ? 'Attachment'
      : 'No messages yet';

    return {
      id: row.thread_id,
      user: {
        id: row.other_user_id,
        name: displayName,
        username,
        avatar,
        status: row.other_status || 'offline',
      },
      lastMessage,
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
      unread: row.unread_count ?? 0,
      isHidden: Boolean(row.is_hidden),
      isFriend: Boolean(row.is_friend),
    };
  }, []);

  const mapMessageRow = useCallback(
    (row: MessageRow): Message => ({
      id: row.id,
      content: row.content,
      sender: row.sender_id === user?.id ? 'me' : 'them',
      senderId: row.sender_id,
      timestamp: new Date(row.created_at),
      attachments: normalizeAttachments(row.attachments),
    }),
    [user?.id]
  );

  const mapFriendRequestRow = useCallback((row: FriendRequestRow): FriendRequest => {
    const username = row.requester_username || 'user';
    const name = row.requester_display_name || username;
    const avatar = isSafeImageUrl(row.requester_avatar)
      ? row.requester_avatar || avatarDataUri(username)
      : avatarDataUri(username);

    return {
      id: row.request_id,
      requesterId: row.requester_id,
      name,
      username,
      avatar,
      createdAt: new Date(row.created_at),
    };
  }, []);

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

  const loadFriendRequests = useCallback(async () => {
    if (!user) return;
    setIsLoadingRequests(true);
    const { data, error } = await supabase.rpc('get_friend_requests');

    if (error) {
      console.warn('Failed to load friend requests:', error.message);
      setIsLoadingRequests(false);
      return;
    }

    const mapped = (data as FriendRequestRow[] | null)?.map(mapFriendRequestRow) ?? [];
    setFriendRequests(mapped);
    setIsLoadingRequests(false);
  }, [mapFriendRequestRow, user]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  const loadMessages = useCallback(
    async (threadId: string) => {
      if (!user) return;
      setIsLoadingMessages(true);
      const { data, error } = await supabase
      .from('direct_messages')
      .select('id, content, sender_id, created_at, attachments')
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
    },
    [mapMessageRow, toast, user]
  );

  useEffect(() => {
    void loadThreads();
    void loadFriendRequests();
  }, [loadFriendRequests, loadThreads]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedThreadId);
  }, [loadMessages, selectedThreadId]);

  const markThreadRead = useCallback(
    async (threadId: string) => {
      if (!user) return;
      const thread = threadsRef.current.find((item) => item.id === threadId);
      if (!thread || thread.unread === 0) return;
      const { error } = await supabase.rpc('mark_thread_read', { p_thread_id: threadId });
      if (error) {
        console.warn('Failed to mark thread read:', error.message);
        return;
      }
      setThreads((prev) =>
        prev.map((item) => (item.id === threadId ? { ...item, unread: 0 } : item))
      );
    },
    [user]
  );

  useEffect(() => {
    if (!selectedThreadId || !readMarkerRef.current) return;
    const root = messagesScrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLElement | null;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void markThreadRead(selectedThreadId);
        }
      },
      { root, threshold: 0.9 }
    );
    observer.observe(readMarkerRef.current);
    return () => observer.disconnect();
  }, [markThreadRead, messages, selectedThreadId]);

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
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadThreads, mapMessageRow, selectedThreadId, user]);

  useEffect(() => {
    if (!user) return undefined;

    const channel = supabase
      .channel('friend_requests_stream')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests' },
        (payload) => {
          const next = payload.new as { recipient_id?: string } | null;
          if (!next || next.recipient_id !== user.id) return;
          void loadFriendRequests();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadFriendRequests, user?.id]);

  const clearPendingAttachments = useCallback(() => {
    setPendingAttachments((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
  }, []);

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setPendingAttachments((prev) => {
      const remainingSlots = Math.max(0, MAX_ATTACHMENTS - prev.length);
      if (remainingSlots === 0) {
        toast({
          title: 'Attachment limit reached',
          description: `You can only send up to ${MAX_ATTACHMENTS} files at once.`,
          variant: 'destructive',
        });
        return prev;
      }

      const next: PendingAttachment[] = [];
      for (const file of files) {
        if (next.length >= remainingSlots) break;
        if (file.size > MAX_ATTACHMENT_BYTES) {
          toast({
            title: 'File too large',
            description: `${file.name} exceeds ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`,
            variant: 'destructive',
          });
          continue;
        }
        const kind = toAttachmentKind(file);
        const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined;
        next.push({
          id: createAttachmentId(),
          file,
          previewUrl,
          kind,
        });
      }

      event.target.value = '';
      return [...prev, ...next];
    });
  };

  const uploadAttachment = async (item: PendingAttachment): Promise<Attachment | null> => {
    if (!user || !selectedThreadId) return null;
    const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const filePath = `${user.id}/${selectedThreadId}/${Date.now()}-${createAttachmentId()}-${safeName}`;
    const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(filePath, item.file, {
      contentType: item.file.type || 'application/octet-stream',
      upsert: false,
    });

    if (error) {
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive',
      });
      return null;
    }

    const { data } = supabase.storage.from(ATTACHMENT_BUCKET).getPublicUrl(filePath);
    return {
      url: data.publicUrl,
      path: filePath,
      name: item.file.name,
      type: item.file.type || 'application/octet-stream',
      size: item.file.size,
    };
  };

  useEffect(() => {
    if (!selectedThreadId) {
      clearPendingAttachments();
      setEmojiOpen(false);
      return;
    }
    clearPendingAttachments();
    setEmojiOpen(false);
  }, [clearPendingAttachments, selectedThreadId]);

  const handleSendMessage = async () => {
    const trimmed = messageInput.trim();
    if ((!trimmed && pendingAttachments.length === 0) || !selectedThreadId || !user || isUploading) return;

    setIsUploading(true);
    const attachments: Attachment[] = [];
    for (const item of pendingAttachments) {
      const uploaded = await uploadAttachment(item);
      if (!uploaded) {
        setIsUploading(false);
        return;
      }
      attachments.push(uploaded);
    }

    const { data, error } = await supabase
      .from('direct_messages')
      .insert({
        thread_id: selectedThreadId,
        sender_id: user.id,
        content: trimmed,
        attachments,
      })
      .select('id, content, sender_id, created_at, attachments')
      .single();

    if (error) {
      setIsUploading(false);
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
    clearPendingAttachments();
    setEmojiOpen(false);
    void awardMessagePoint();
    void loadThreads();
    setIsUploading(false);
  };

  const handleSendFriendRequest = async () => {
    const trimmed = friendRequestUsername.trim();
    if (!trimmed) return;

    const { error } = await supabase.rpc('send_friend_request', {
      p_target_username: trimmed,
    });

    if (error) {
      toast({
        title: 'Friend request failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    setFriendDialogOpen(false);
    setFriendRequestUsername('');
    toast({
      title: 'Request sent',
      description: `Friend request sent to @${trimmed}`,
    });
  };

  const handleAcceptFriendRequest = async (requestId: string) => {
    const { error } = await supabase.rpc('accept_friend_request', { p_request_id: requestId });
    if (error) {
      toast({
        title: 'Unable to accept request',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }
    setFriendRequests((prev) => prev.filter((req) => req.id !== requestId));
    void loadThreads();
  };

  const handleDeclineFriendRequest = async (requestId: string) => {
    const { error } = await supabase.rpc('decline_friend_request', { p_request_id: requestId });
    if (error) {
      toast({
        title: 'Unable to decline request',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }
    setFriendRequests((prev) => prev.filter((req) => req.id !== requestId));
  };

  const handleRemoveFriend = async () => {
    if (!selectedThread) return;
    const { error } = await supabase.rpc('remove_friend', { p_friend_id: selectedThread.user.id });
    if (error) {
      toast({
        title: 'Unable to remove friend',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === selectedThread.id ? { ...thread, isFriend: false } : thread
      )
    );
  };

  const handleBlockUser = async () => {
    if (!selectedThread) return;
    const { error } = await supabase.rpc('block_user', { p_target_id: selectedThread.user.id });
    if (error) {
      toast({
        title: 'Unable to block user',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }
    setThreads((prev) => prev.filter((thread) => thread.id !== selectedThread.id));
    setSelectedThreadId(null);
    setMessages([]);
    toast({
      title: 'User blocked',
      description: 'You will no longer receive messages from this user.',
    });
  };

  const handleToggleIgnore = async () => {
    if (!selectedThread) return;
    const nextHidden = !selectedThread.isHidden;
    const { error } = await supabase.rpc('set_thread_hidden', {
      p_thread_id: selectedThread.id,
      p_hidden: nextHidden,
    });
    if (error) {
      toast({
        title: 'Unable to update',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === selectedThread.id ? { ...thread, isHidden: nextHidden } : thread
      )
    );
  };

  const sendCallSignal = useCallback(
    async (payload: CallSignal) => {
      const channel = callChannelRef.current;
      if (!channel || !user) return;
      await channel.send({ type: 'broadcast', event: 'call', payload });
    },
    [user]
  );

  const tryPlayRemoteCall = useCallback(async () => {
    const element = callRemoteVideoRef.current;
    if (!element) return;
    try {
      await element.play();
      element.muted = false;
      setNeedsRemoteTap(false);
    } catch {
      element.muted = true;
      try {
        await element.play();
      } catch {
        // autoplay blocked
      }
      setNeedsRemoteTap(true);
    }
  }, []);

  const flushPendingCallIce = useCallback(async () => {
    const pc = callPeerRef.current;
    if (!pc || !pc.remoteDescription) return;
    const pending = pendingCallIceRef.current;
    pendingCallIceRef.current = [];
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('Failed to add call ICE candidate:', err);
      }
    }
  }, []);

  const cleanupCall = useCallback(async () => {
    pendingCallIceRef.current = [];
    callOffererRef.current = false;
    callPeerIdRef.current = null;
    setIncomingCall(null);
    setCallPhase('idle');
    setNeedsRemoteTap(false);
    setCallAudioEnabled(true);
    setCallVideoEnabled(true);

    if (callPeerRef.current) {
      callPeerRef.current.onicecandidate = null;
      callPeerRef.current.ontrack = null;
      callPeerRef.current.onconnectionstatechange = null;
      callPeerRef.current.close();
    }
    callPeerRef.current = null;

    if (callLocalStreamRef.current) {
      callLocalStreamRef.current.getTracks().forEach((track) => track.stop());
      callLocalStreamRef.current = null;
    }

    if (callRemoteStreamRef.current) {
      callRemoteStreamRef.current.getTracks().forEach((track) => track.stop());
      callRemoteStreamRef.current = null;
    }

    if (callLocalVideoRef.current) {
      callLocalVideoRef.current.srcObject = null;
    }
    if (callRemoteVideoRef.current) {
      callRemoteVideoRef.current.srcObject = null;
    }
  }, []);

  const prepareCallConnection = useCallback(
    async (mode: CallMode, isOfferer: boolean) => {
      if (!user) return;
      const pc = new RTCPeerConnection(getIceConfig());
      callPeerRef.current = pc;
      callOffererRef.current = isOfferer;
      pendingCallIceRef.current = [];

      pc.onicecandidate = (event) => {
        if (!event.candidate || !user) return;
        const payload = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
        void sendCallSignal({ type: 'ice', from: user.id, candidate: payload });
      };

      pc.ontrack = (event) => {
        if (!callRemoteStreamRef.current) {
          callRemoteStreamRef.current = new MediaStream();
          if (callRemoteVideoRef.current) {
            callRemoteVideoRef.current.srcObject = callRemoteStreamRef.current;
          }
        }
        callRemoteStreamRef.current.addTrack(event.track);
        void tryPlayRemoteCall();
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setCallPhase('in_call');
        }
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          void cleanupCall();
        }
      };

      const constraints: MediaStreamConstraints = {
        audio: true,
        video: mode === 'video',
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        toast({
          title: 'Call failed',
          description: 'Allow access to your camera and microphone to start a call.',
          variant: 'destructive',
        });
        await sendCallSignal({ type: 'hangup', from: user.id });
        await cleanupCall();
        throw error;
      }
      callLocalStreamRef.current = stream;
      if (callLocalVideoRef.current) {
        callLocalVideoRef.current.srcObject = stream;
      }
      setCallAudioEnabled(stream.getAudioTracks().every((track) => track.enabled));
      setCallVideoEnabled(mode === 'video' && stream.getVideoTracks().every((track) => track.enabled));

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    },
    [cleanupCall, sendCallSignal, toast, tryPlayRemoteCall, user]
  );

  const handleCallSignal = useCallback(
    async (payload: CallSignal) => {
      if (!payload || !user) return;
      const activeThread = selectedThreadRef.current;
      if (!activeThread) return;
      if (payload.from === user.id) return;
      if (payload.from !== activeThread.user.id) return;
      const phase = callPhaseRef.current;

      if (payload.type === 'ring') {
        if (phase !== 'idle') return;
        setCallMode(payload.mode);
        setIncomingCall({ fromId: payload.from, mode: payload.mode });
        setCallPhase('incoming');
        callPeerIdRef.current = payload.from;
        return;
      }

      if (payload.type === 'accept') {
        if (phase !== 'outgoing') return;
        setCallMode(payload.mode);
        callPeerIdRef.current = payload.from;
        setCallPhase('connecting');
        await prepareCallConnection(payload.mode, true);
        const pc = callPeerRef.current;
        if (!pc) return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendCallSignal({ type: 'offer', from: user.id, mode: payload.mode, sdp: offer });
        return;
      }

      if (payload.type === 'reject') {
        if (phase === 'outgoing' || phase === 'incoming' || phase === 'connecting') {
          await cleanupCall();
          toast({ title: 'Call declined', description: 'The other user declined the call.' });
        }
        return;
      }

      if (payload.type === 'offer') {
        if (phase === 'incoming') {
          setCallPhase('connecting');
        }
        if (!callPeerRef.current) {
          await prepareCallConnection(payload.mode, false);
        }
        const pc = callPeerRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendCallSignal({ type: 'answer', from: user.id, sdp: answer });
        await flushPendingCallIce();
        return;
      }

      if (payload.type === 'answer') {
        const pc = callPeerRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(payload.sdp);
        await flushPendingCallIce();
        return;
      }

      if (payload.type === 'ice') {
        const pc = callPeerRef.current;
        if (!pc) return;
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(payload.candidate);
          } catch (err) {
            console.warn('Failed to add call ICE candidate:', err);
          }
        } else {
          pendingCallIceRef.current.push(payload.candidate);
        }
        return;
      }

      if (payload.type === 'hangup') {
        await cleanupCall();
        return;
      }
    },
    [
      cleanupCall,
      flushPendingCallIce,
      prepareCallConnection,
      sendCallSignal,
      toast,
      user,
    ]
  );

  const startCall = useCallback(
    async (mode: CallMode) => {
      if (!selectedThread || !user) return;
      if (callPhase !== 'idle') return;
      setCallMode(mode);
      setCallPhase('outgoing');
      callPeerIdRef.current = selectedThread.user.id;
      await sendCallSignal({ type: 'ring', from: user.id, mode });
    },
    [callPhase, selectedThread, sendCallSignal, user]
  );

  const acceptCall = useCallback(async () => {
    if (!incomingCall || !user) return;
    setCallPhase('connecting');
    setCallMode(incomingCall.mode);
    callPeerIdRef.current = incomingCall.fromId;
    await sendCallSignal({ type: 'accept', from: user.id, mode: incomingCall.mode });
    await prepareCallConnection(incomingCall.mode, false);
    setIncomingCall(null);
  }, [incomingCall, prepareCallConnection, sendCallSignal, user]);

  const declineCall = useCallback(async () => {
    if (!incomingCall || !user) return;
    await sendCallSignal({ type: 'reject', from: user.id });
    await cleanupCall();
  }, [cleanupCall, incomingCall, sendCallSignal, user]);

  const hangupCall = useCallback(async () => {
    if (!user) return;
    await sendCallSignal({ type: 'hangup', from: user.id });
    await cleanupCall();
  }, [cleanupCall, sendCallSignal, user]);

  const toggleCallAudio = () => {
    if (!callLocalStreamRef.current) return;
    const tracks = callLocalStreamRef.current.getAudioTracks();
    if (tracks.length === 0) return;
    tracks.forEach((track) => {
      track.enabled = !track.enabled;
    });
    setCallAudioEnabled(tracks.every((track) => track.enabled));
  };

  const toggleCallVideo = () => {
    if (!callLocalStreamRef.current) return;
    const tracks = callLocalStreamRef.current.getVideoTracks();
    if (tracks.length === 0) return;
    tracks.forEach((track) => {
      track.enabled = !track.enabled;
    });
    setCallVideoEnabled(tracks.every((track) => track.enabled));
  };

  useEffect(() => {
    if (!user || !selectedThreadId) return undefined;

    const channel = supabase.channel(`direct-call-${selectedThreadId}`, {
      config: {
        broadcast: { ack: false },
      },
    });
    callChannelRef.current = channel;

    channel.on('broadcast', { event: 'call' }, (payload) => {
      void handleCallSignal(payload.payload as CallSignal);
    });

    channel.subscribe();

    return () => {
      if (callPhaseRef.current !== 'idle') {
        void channel.send({
          type: 'broadcast',
          event: 'call',
          payload: { type: 'hangup', from: user.id } as CallSignal,
        });
        void cleanupCall();
      }
      callChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [cleanupCall, handleCallSignal, selectedThreadId, user]);

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
  const visibleThreads = showIgnored ? filteredThreads : filteredThreads.filter((thread) => !thread.isHidden);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const renderAttachment = (attachment: Attachment, isMine: boolean) => {
    const isImage = attachment.type.startsWith('image/');
    const isVideo = attachment.type.startsWith('video/');
    const sizeLabel = formatBytes(attachment.size);
    const fileLabel = attachment.name || 'Attachment';

    if (isImage) {
      return (
        <img
          src={attachment.url}
          alt={fileLabel}
          loading="lazy"
          className={cn(
            'max-h-56 w-full rounded-xl border object-cover',
            isMine ? 'border-white/20' : 'border-border'
          )}
        />
      );
    }

    if (isVideo) {
      return (
        <video
          src={attachment.url}
          controls
          preload="metadata"
          className={cn(
            'max-h-64 w-full rounded-xl border bg-black/80',
            isMine ? 'border-white/20' : 'border-border'
          )}
        />
      );
    }

    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition hover:bg-secondary/40',
          isMine ? 'border-white/20 text-primary-foreground/90' : 'border-border text-foreground'
        )}
      >
        <FileText className="h-4 w-4" />
        <span className="max-w-[10rem] truncate">{fileLabel}</span>
        {sizeLabel ? <span className="ml-auto text-[10px] text-muted-foreground">{sizeLabel}</span> : null}
      </a>
    );
  };

  const isCallActive = callPhase === 'connecting' || callPhase === 'in_call';
  const isVideoCall = callMode === 'video';
  const callTitle = selectedThread?.user.name ?? 'User';
  const callSubtitle =
    callPhase === 'incoming'
      ? `${callTitle} is calling...`
      : callPhase === 'outgoing'
      ? `Calling ${callTitle}...`
      : callPhase === 'connecting'
      ? 'Connecting...'
      : callPhase === 'in_call'
      ? 'Connected'
      : '';
  const callModeLabel = isVideoCall ? 'Video call' : 'Voice call';
  const pendingRequestCount = friendRequests.length;
  const pendingRequestBadge = pendingRequestCount > 9 ? '9+' : `${pendingRequestCount}`;

  return (
    <div className="h-full flex">
      {/* Conversations List */}
      <div className="w-80 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-bold">Messages</h2>
            <div className="flex items-center gap-2">
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

              <Dialog open={friendDialogOpen} onOpenChange={setFriendDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
                    <UserPlus className="w-5 h-5" />
                    {pendingRequestCount > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                        {pendingRequestBadge}
                      </span>
                    )}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Add Friend</DialogTitle>
                    <DialogDescription>Send a friend request by username.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Username</label>
                      <Input
                        value={friendRequestUsername}
                        onChange={(e) => setFriendRequestUsername(e.target.value)}
                        placeholder="Enter a username"
                        className="mt-2 bg-secondary border-0"
                      />
                    </div>
                    <Button variant="hero" onClick={handleSendFriendRequest}>
                      Send Request
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
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
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{threads.length} conversations</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => setShowIgnored((prev) => !prev)}
            >
              {showIgnored ? (
                <>
                  <EyeOff className="mr-1 h-3.5 w-3.5" /> Hide ignored
                </>
              ) : (
                <>
                  <Eye className="mr-1 h-3.5 w-3.5" /> Show ignored
                </>
              )}
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {(isLoadingRequests || friendRequests.length > 0) && (
              <div className="px-3 pt-2 pb-3">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  <span>Friend Requests</span>
                  {pendingRequestCount > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {pendingRequestBadge}
                    </Badge>
                  )}
                </div>
                {isLoadingRequests && (
                  <div className="text-xs text-muted-foreground">Loading requests...</div>
                )}
                {!isLoadingRequests && friendRequests.length === 0 && (
                  <div className="text-xs text-muted-foreground">No new requests.</div>
                )}
                <div className="space-y-2">
                  {friendRequests.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={req.avatar} />
                          <AvatarFallback>{req.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{req.name}</p>
                          <p className="text-xs text-muted-foreground">@{req.username}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="hero" onClick={() => handleAcceptFriendRequest(req.id)}>
                          Accept
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDeclineFriendRequest(req.id)}>
                          Decline
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isLoadingThreads && (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                Loading conversations...
              </div>
            )}

            {!isLoadingThreads && visibleThreads.length === 0 && (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                No conversations yet. Start a new one.
              </div>
            )}

            {visibleThreads.map((thread) => (
              <ConversationItem
                key={thread.id}
                conversation={thread}
                isSelected={selectedThread?.id === thread.id}
                onClick={() => setSelectedThreadId(thread.id)}
                statusColors={statusColors}
                status={getEffectiveStatus(thread.user.id, thread.user.status)}
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
                      statusColors[selectedEffectiveStatus]
                    )}
                  />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{selectedThread.user.name}</h3>
                    {selectedThread.isFriend && (
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                        Friend
                      </Badge>
                    )}
                    {selectedThread.isHidden && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        Ignored
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedEffectiveStatus === 'online'
                      ? 'Online'
                      : selectedEffectiveStatus === 'away'
                      ? 'Away'
                      : selectedEffectiveStatus === 'dnd'
                      ? 'Do not disturb'
                      : 'Offline'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => startCall('audio')}>
                  <Phone className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => startCall('video')}>
                  <Video className="w-5 h-5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={handleToggleIgnore}>
                      {selectedThread.isHidden ? (
                        <>
                          <Eye className="mr-2 h-4 w-4" /> Unignore
                        </>
                      ) : (
                        <>
                          <EyeOff className="mr-2 h-4 w-4" /> Ignore
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleRemoveFriend}
                      disabled={!selectedThread.isFriend}
                    >
                      <UserMinus className="mr-2 h-4 w-4" /> Unfriend
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={handleBlockUser}>
                      <Shield className="mr-2 h-4 w-4" /> Block
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea ref={messagesScrollRef} className="flex-1 p-6">
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
                        {msg.content ? <p>{msg.content}</p> : null}
                        {msg.attachments.length > 0 && (
                          <div className={cn('space-y-2', msg.content ? 'mt-2' : 'mt-1')}>
                            {msg.attachments.map((attachment, attachmentIndex) => (
                              <div key={`${msg.id}-attachment-${attachmentIndex}`}>
                                {renderAttachment(attachment, msg.sender === 'me')}
                              </div>
                            ))}
                          </div>
                        )}
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
                <div ref={readMarkerRef} className="h-px w-full" />
              </div>
            </ScrollArea>

            {/* Message Input */}
            <div className="p-4 border-t border-border">
              {pendingAttachments.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {pendingAttachments.map((item) => (
                    <div
                      key={item.id}
                      className="relative h-20 w-20 overflow-hidden rounded-xl border border-border bg-secondary"
                    >
                      {item.kind === 'image' && item.previewUrl ? (
                        <img
                          src={item.previewUrl}
                          alt={item.file.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-[10px] text-muted-foreground">
                          {item.kind === 'video' ? (
                            <Video className="h-5 w-5" />
                          ) : (
                            <FileText className="h-5 w-5" />
                          )}
                          <span className="px-1 truncate max-w-[4.5rem]">{item.file.name}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removePendingAttachment(item.id)}
                        className="absolute right-1 top-1 rounded-full bg-background/80 p-1 text-muted-foreground hover:text-foreground"
                        aria-label="Remove attachment"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  <Paperclip className="w-5 h-5" />
                </Button>
                <Input
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="flex-1 bg-secondary border-0"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEmojiOpen((prev) => !prev)}
                  disabled={isUploading}
                >
                  <Smile className="w-5 h-5" />
                </Button>
                <Button variant="hero" size="icon" onClick={handleSendMessage} disabled={isUploading}>
                  <Send className="w-5 h-5" />
                </Button>
              </div>
              {emojiOpen && (
                <div className="mt-3 grid grid-cols-10 gap-1 rounded-xl border border-border bg-secondary p-3">
                  {EMOJIS.map((emoji, index) => (
                    <button
                      key={`${emoji}-${index}`}
                      type="button"
                      className="rounded-md p-1 text-lg hover:bg-secondary/70"
                      onClick={() => setMessageInput((prev) => `${prev}${emoji}`)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
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

      <AnimatePresence>
        {selectedThread && callPhase !== 'idle' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 24, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 24, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 220, damping: 20 }}
              className="w-full max-w-4xl mx-4 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {callModeLabel}
                  </p>
                  <p className="text-lg font-semibold">{callTitle}</p>
                  <p className="text-sm text-muted-foreground">{callSubtitle}</p>
                </div>
                {callPhase !== 'incoming' && (
                  <Button variant="ghost" size="icon" onClick={hangupCall}>
                    <PhoneOff className="h-5 w-5" />
                  </Button>
                )}
              </div>
              <div className="relative aspect-video bg-black/90">
                <video
                  ref={callRemoteVideoRef}
                  autoPlay
                  playsInline
                  className={cn(
                    'absolute inset-0 h-full w-full object-cover transition-opacity',
                    isVideoCall && isCallActive ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {!isVideoCall || !isCallActive ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center text-muted-foreground">
                    <Avatar className="h-24 w-24">
                      <AvatarImage src={selectedThread.user.avatar} />
                      <AvatarFallback>{selectedThread.user.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-lg font-semibold text-foreground">{callTitle}</p>
                      <p className="text-sm text-muted-foreground">
                        {callPhase === 'outgoing' ? 'Ringing...' : callSubtitle}
                      </p>
                    </div>
                  </div>
                ) : null}
                {isVideoCall && isCallActive && (
                  <video
                    ref={callLocalVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="absolute bottom-4 right-4 h-32 w-24 rounded-xl border border-white/20 object-cover shadow-lg"
                  />
                )}
                {needsRemoteTap && (
                  <Button
                    variant="secondary"
                    className="absolute bottom-4 left-4"
                    onClick={tryPlayRemoteCall}
                  >
                    Tap to enable audio
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-4 border-t border-border">
                {callPhase === 'incoming' && (
                  <>
                    <Button variant="hero" onClick={acceptCall}>
                      <Phone className="mr-2 h-4 w-4" /> Accept
                    </Button>
                    <Button variant="destructive" onClick={declineCall}>
                      <PhoneOff className="mr-2 h-4 w-4" /> Decline
                    </Button>
                  </>
                )}
                {callPhase === 'outgoing' && (
                  <Button variant="destructive" onClick={hangupCall}>
                    <PhoneOff className="mr-2 h-4 w-4" /> Cancel call
                  </Button>
                )}
                {isCallActive && (
                  <>
                    <Button
                      variant={callAudioEnabled ? 'secondary' : 'destructive'}
                      onClick={toggleCallAudio}
                    >
                      {callAudioEnabled ? (
                        <Mic className="mr-2 h-4 w-4" />
                      ) : (
                        <MicOff className="mr-2 h-4 w-4" />
                      )}
                      {callAudioEnabled ? 'Mute' : 'Unmute'}
                    </Button>
                    <Button
                      variant={callVideoEnabled ? 'secondary' : 'destructive'}
                      onClick={toggleCallVideo}
                      disabled={!isVideoCall}
                    >
                      {callVideoEnabled ? (
                        <Video className="mr-2 h-4 w-4" />
                      ) : (
                        <VideoOff className="mr-2 h-4 w-4" />
                      )}
                      {callVideoEnabled ? 'Stop video' : 'Start video'}
                    </Button>
                    <Button variant="destructive" onClick={hangupCall}>
                      <PhoneOff className="mr-2 h-4 w-4" /> Hang up
                    </Button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ConversationItem({
  conversation,
  isSelected,
  onClick,
  statusColors,
  status,
}: {
  conversation: ThreadSummary;
  isSelected: boolean;
  onClick: () => void;
  statusColors: Record<string, string>;
  status: ThreadSummary['user']['status'];
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "w-full p-3 rounded-xl flex items-center gap-3 transition-colors",
        isSelected ? 'bg-secondary' : 'hover:bg-secondary/50',
        conversation.isHidden && !isSelected && "opacity-60"
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
            statusColors[status]
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
        <p className="text-sm text-muted-foreground truncate">
          {conversation.isHidden ? 'Ignored' : conversation.lastMessage}
        </p>
      </div>
    </motion.button>
  );
}
