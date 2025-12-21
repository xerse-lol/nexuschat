import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { 
  Video, 
  VideoOff, 
  Mic, 
  MicOff, 
  PhoneOff, 
  SkipForward,
  Settings,
  Maximize2,
  Monitor,
  Camera,
  Volume2
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { avatarDataUri, isSafeImageUrl } from '@/lib/avatar';
import { supabase } from '@/lib/supabaseClient';

interface MediaDevice {
  deviceId: string;
  label: string;
}

interface PartnerProfile {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

type SignalPayload = {
  type: 'offer' | 'answer' | 'ice' | 'bye';
  from: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type PresencePayload = {
  user_id?: string;
  username?: string;
  display_name?: string;
  avatar?: string;
};

const defaultIceServers: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
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

export default function VideoChat() {
  const [isConnected, setIsConnected] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [noMatchMessage, setNoMatchMessage] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoDevices, setVideoDevices] = useState<MediaDevice[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDevice[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDevice[]>([]);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>('');
  const [matchId, setMatchId] = useState<string | null>(null);
  const [partnerProfile, setPartnerProfile] = useState<PartnerProfile | null>(null);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const signalingChannelRef = useRef<RealtimeChannel | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isOffererRef = useRef(false);
  const sentOfferRef = useRef(false);
  const hasAwardedRef = useRef(false);
  const searchTimerRef = useRef<number | null>(null);
  const searchAttemptsRef = useRef(0);
  const matchIdRef = useRef<string | null>(null);
  
  const { user, awardCallPoint } = useAuth();
  const { toast } = useToast();
  const isConnecting = Boolean(matchId) && !isSearching && !isConnected;

  useEffect(() => {
    getMediaDevices();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    matchIdRef.current = matchId;
  }, [matchId]);

  const getMediaDevices = async () => {
    try {
      // Request permissions first
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const videoInputs = devices
        .filter(d => d.kind === 'videoinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 5)}` }));
      
      const audioInputs = devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 5)}` }));
      
      const audioOutputs = devices
        .filter(d => d.kind === 'audiooutput')
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Speaker ${d.deviceId.slice(0, 5)}` }));

      setVideoDevices(videoInputs);
      setAudioDevices(audioInputs);
      setAudioOutputDevices(audioOutputs);

      if (videoInputs.length > 0) setSelectedVideoDevice(videoInputs[0].deviceId);
      if (audioInputs.length > 0) setSelectedAudioDevice(audioInputs[0].deviceId);
      if (audioOutputs.length > 0) setSelectedAudioOutput(audioOutputs[0].deviceId);
    } catch (err) {
      toast({
        title: "Permission Denied",
        description: "Please allow camera and microphone access",
        variant: "destructive"
      });
    }
  };

  useEffect(() => {
    const element = remoteVideoRef.current as HTMLMediaElement | null;
    if (!element || !selectedAudioOutput) return;
    const setSinkId = (element as HTMLMediaElement & {
      setSinkId?: (id: string) => Promise<void>;
    }).setSinkId;
    if (typeof setSinkId !== 'function') return;
    setSinkId.call(element, selectedAudioOutput).catch(() => {
      console.warn('Unable to switch audio output device.');
    });
  }, [selectedAudioOutput]);

  const startLocalStream = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedVideoDevice ? { deviceId: { exact: selectedVideoDevice } } : true,
        audio: selectedAudioDevice ? { deviceId: { exact: selectedAudioDevice } } : true,
      });

      streamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setVideoEnabled(stream.getVideoTracks().every((track) => track.enabled));
      setAudioEnabled(stream.getAudioTracks().every((track) => track.enabled));

      const pc = peerConnectionRef.current;
      if (pc) {
        const senders = pc.getSenders();
        const nextVideoTrack = stream.getVideoTracks()[0];
        const nextAudioTrack = stream.getAudioTracks()[0];
        if (nextVideoTrack) {
          const videoSender = senders.find((sender) => sender.track?.kind === 'video');
          if (videoSender) {
            void videoSender.replaceTrack(nextVideoTrack);
          }
        }
        if (nextAudioTrack) {
          const audioSender = senders.find((sender) => sender.track?.kind === 'audio');
          if (audioSender) {
            void audioSender.replaceTrack(nextAudioTrack);
          }
        }
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Could not access camera/microphone",
        variant: "destructive"
      });
    }
  };

  const stopLocalStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }, []);

  const clearSearchTimer = () => {
    if (searchTimerRef.current) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  };

  const sendSignal = useCallback(async (payload: SignalPayload) => {
    const channel = signalingChannelRef.current;
    if (!channel) return;
    await channel.send({ type: 'broadcast', event: 'signal', payload });
  }, []);

  const cleanupPeerConnection = useCallback(async () => {
    pendingIceCandidatesRef.current = [];
    sentOfferRef.current = false;
    isOffererRef.current = false;
    hasAwardedRef.current = false;

    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;
      peerConnectionRef.current.close();
    }
    peerConnectionRef.current = null;

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    const channel = signalingChannelRef.current;
    if (channel) {
      signalingChannelRef.current = null;
      await channel.untrack();
      await supabase.removeChannel(channel);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        window.clearTimeout(searchTimerRef.current);
      }
      void supabase.rpc('stop_search');
      if (matchIdRef.current) {
        void supabase.rpc('end_match', { p_match_id: matchIdRef.current });
      }
      void cleanupPeerConnection();
      stopLocalStream();
    };
  }, [cleanupPeerConnection, stopLocalStream]);

  const handleRemoteEnded = useCallback(
    async (message: string) => {
      if (matchIdRef.current) {
        await supabase.rpc('end_match', { p_match_id: matchIdRef.current });
      }
      await cleanupPeerConnection();
      setIsConnected(false);
      setIsSearching(false);
      setMatchId(null);
      setPartnerProfile(null);
      setNoMatchMessage(false);
      toast({
        title: message,
        description: 'The connection ended.',
      });
    },
    [cleanupPeerConnection, toast]
  );

  const flushPendingIceCandidates = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc || !pc.remoteDescription) return;
    const pending = pendingIceCandidatesRef.current;
    pendingIceCandidatesRef.current = [];
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('Failed to add ICE candidate:', err);
      }
    }
  }, []);

  const handleSignal = useCallback(
    async (payload: SignalPayload) => {
      if (!payload || !user || payload.from === user.id) return;
      const pc = peerConnectionRef.current;
      if (!pc) return;

      if (payload.type === 'offer') {
        if (isOffererRef.current || !payload.sdp) return;
        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal({ type: 'answer', from: user.id, sdp: answer });
        await flushPendingIceCandidates();
        return;
      }

      if (payload.type === 'answer') {
        if (!isOffererRef.current || !payload.sdp) return;
        await pc.setRemoteDescription(payload.sdp);
        await flushPendingIceCandidates();
        return;
      }

      if (payload.type === 'ice') {
        if (!payload.candidate) return;
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(payload.candidate);
          } catch (err) {
            console.warn('Failed to add ICE candidate:', err);
          }
        } else {
          pendingIceCandidatesRef.current.push(payload.candidate);
        }
        return;
      }

      if (payload.type === 'bye') {
        await handleRemoteEnded('Partner disconnected');
      }
    },
    [flushPendingIceCandidates, handleRemoteEnded, sendSignal, user]
  );

  const createAndSendOffer = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc || !user || sentOfferRef.current) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sentOfferRef.current = true;
    await sendSignal({ type: 'offer', from: user.id, sdp: offer });
  }, [sendSignal, user]);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(getIceConfig());

    pc.onicecandidate = (event) => {
      if (!event.candidate || !user) return;
      const payload = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
      void sendSignal({ type: 'ice', from: user.id, candidate: payload });
    };

    pc.ontrack = (event) => {
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
        }
      }
      remoteStreamRef.current.addTrack(event.track);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setIsConnected(true);
        if (!hasAwardedRef.current) {
          hasAwardedRef.current = true;
          void awardCallPoint();
        }
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        void handleRemoteEnded('Connection lost');
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        void handleRemoteEnded('Connection failed');
      }
    };

    return pc;
  }, [awardCallPoint, handleRemoteEnded, sendSignal, user]);

  const setupSignalingChannel = useCallback(
    async (nextMatchId: string, nextPartnerId: string) => {
      if (!user) return;
      const channel = supabase.channel(`video-match:${nextMatchId}`, {
        config: {
          presence: { key: user.id },
          broadcast: { ack: false },
        },
      });

      signalingChannelRef.current = channel;
      isOffererRef.current = user.id < nextPartnerId;
      sentOfferRef.current = false;
      pendingIceCandidatesRef.current = [];

      channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
        void handleSignal(payload as SignalPayload);
      });

      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, PresencePayload[]>;
        const partnerPresent = Object.prototype.hasOwnProperty.call(state, nextPartnerId);
        if (partnerPresent && isOffererRef.current && !sentOfferRef.current) {
          void createAndSendOffer();
        }
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
    },
    [createAndSendOffer, handleSignal, user]
  );

  const setupPeerConnection = useCallback(
    async (nextMatchId: string, nextPartnerId: string) => {
      if (!user) return;
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      }
      await setupSignalingChannel(nextMatchId, nextPartnerId);
    },
    [createPeerConnection, setupSignalingChannel, user]
  );

  const loadPartnerProfile = useCallback(async (partnerId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar')
      .eq('id', partnerId)
      .maybeSingle();

    if (error || !data) {
      const fallbackName = `user_${partnerId.slice(0, 5)}`;
      setPartnerProfile({
        id: partnerId,
        username: fallbackName,
        displayName: fallbackName,
        avatar: avatarDataUri(fallbackName),
      });
      return;
    }

    const username = data.username || `user_${partnerId.slice(0, 5)}`;
    const displayName = data.display_name || username;
    const avatar = isSafeImageUrl(data.avatar)
      ? data.avatar || avatarDataUri(username)
      : avatarDataUri(username);

    setPartnerProfile({
      id: partnerId,
      username,
      displayName,
      avatar,
    });
  }, []);

  const attemptMatch = useCallback(async () => {
    const { data, error } = await supabase.rpc('find_match');

    if (error) {
      clearSearchTimer();
      setIsSearching(false);
      toast({
        title: "Matchmaking failed",
        description: error.message,
        variant: "destructive"
      });
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (result?.match_id && result?.partner_id) {
      clearSearchTimer();
      setIsSearching(false);
      setIsConnected(false);
      setMatchId(result.match_id);
      setNoMatchMessage(false);
      searchAttemptsRef.current = 0;
      hasAwardedRef.current = false;
      await loadPartnerProfile(result.partner_id);
      await setupPeerConnection(result.match_id, result.partner_id);
      toast({
        title: "Connected!",
        description: "You're now chatting with a real person",
      });
      return;
    }

    searchAttemptsRef.current += 1;
    if (searchAttemptsRef.current >= 3) {
      setNoMatchMessage(true);
    }
    searchTimerRef.current = window.setTimeout(() => {
      void attemptMatch();
    }, 4000);
  }, [loadPartnerProfile, setupPeerConnection, toast]);

  const startSearching = async () => {
    await cleanupPeerConnection();
    setIsConnected(false);
    setMatchId(null);
    setPartnerProfile(null);
    setNoMatchMessage(false);
    searchAttemptsRef.current = 0;
    hasAwardedRef.current = false;
    clearSearchTimer();
    setIsSearching(true);
    await startLocalStream();
    await attemptMatch();
  };

  const stopSearching = useCallback(async () => {
    clearSearchTimer();
    setIsSearching(false);
    setIsConnected(false);
    setMatchId(null);
    setPartnerProfile(null);
    setNoMatchMessage(false);
    searchAttemptsRef.current = 0;
    await supabase.rpc('stop_search');
    await cleanupPeerConnection();
    stopLocalStream();
  }, [cleanupPeerConnection, stopLocalStream]);

  const skipPartner = async () => {
    if (matchId) {
      if (user) {
        await sendSignal({ type: 'bye', from: user.id });
      }
      await supabase.rpc('end_match', { p_match_id: matchId });
    }
    await cleanupPeerConnection();
    setIsConnected(false);
    setMatchId(null);
    setPartnerProfile(null);
    setIsSearching(true);
    setNoMatchMessage(false);
    searchAttemptsRef.current = 0;
    hasAwardedRef.current = false;
    toast({
      title: "Skipping...",
      description: "Finding a new partner",
    });
    await attemptMatch();
  };

  const disconnect = async () => {
    clearSearchTimer();
    if (user) {
      await sendSignal({ type: 'bye', from: user.id });
    }
    if (matchId) {
      await supabase.rpc('end_match', { p_match_id: matchId });
    } else {
      await supabase.rpc('stop_search');
    }
    await cleanupPeerConnection();
    setIsConnected(false);
    setIsSearching(false);
    setMatchId(null);
    setPartnerProfile(null);
    setNoMatchMessage(false);
    stopLocalStream();
    toast({
      title: "Disconnected",
      description: "Chat ended",
    });
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setVideoEnabled(!videoEnabled);
    }
  };

  const toggleAudio = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setAudioEnabled(!audioEnabled);
    }
  };

  const switchDevice = async (type: 'video' | 'audio', deviceId: string) => {
    if (type === 'video') {
      setSelectedVideoDevice(deviceId);
    } else {
      setSelectedAudioDevice(deviceId);
    }
    
    if (streamRef.current) {
      await startLocalStream();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Video Chat</h1>
          <p className="text-muted-foreground">Connect with random people around the world</p>
        </div>
        
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon">
              <Settings className="w-5 h-5" />
            </Button>
          </DialogTrigger>
          <DialogContent className="glass border-border">
            <DialogHeader>
              <DialogTitle className="font-display">Device Settings</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Camera className="w-4 h-4 text-primary" />
                  Camera
                </label>
                <Select value={selectedVideoDevice} onValueChange={(v) => switchDevice('video', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select camera" />
                  </SelectTrigger>
                  <SelectContent>
                    {videoDevices.map(device => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Mic className="w-4 h-4 text-primary" />
                  Microphone
                </label>
                <Select value={selectedAudioDevice} onValueChange={(v) => switchDevice('audio', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select microphone" />
                  </SelectTrigger>
                  <SelectContent>
                    {audioDevices.map(device => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-primary" />
                  Speakers
                </label>
                <Select value={selectedAudioOutput} onValueChange={setSelectedAudioOutput}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select speakers" />
                  </SelectTrigger>
                  <SelectContent>
                    {audioOutputDevices.map(device => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Video Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Local Video */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative rounded-2xl overflow-hidden bg-card border border-border aspect-video"
        >
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          {!streamRef.current && (
            <div className="absolute inset-0 flex items-center justify-center bg-card">
              <div className="text-center">
                <Monitor className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Your camera preview</p>
              </div>
            </div>
          )}
          <div className="absolute bottom-4 left-4 px-3 py-1.5 rounded-full glass text-sm">
            You
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 bg-background/50 hover:bg-background/70"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </motion.div>

        {/* Remote Video */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="relative rounded-2xl overflow-hidden bg-card border border-border aspect-video"
        >
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
          
          <AnimatePresence mode="wait">
            {!isConnected && !isSearching && !isConnecting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-card"
              >
                <div className="text-center">
                  <Video className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground mb-4">Ready to meet someone new?</p>
                  <Button variant="hero" size="lg" onClick={startSearching}>
                    Start Chatting
                  </Button>
                </div>
              </motion.div>
            )}

            {isSearching && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-card"
              >
                <div className="text-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="w-16 h-16 rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"
                  />
                  <p className="text-foreground font-medium">Finding someone...</p>
                  <p className="text-muted-foreground text-sm mt-1">This won't take long</p>
                  {noMatchMessage && (
                    <p className="text-sm text-muted-foreground mt-3">
                      sorry there is sadly nobody that wants to meet you or others :(
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {isConnecting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-card"
              >
                <div className="text-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="w-14 h-14 rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"
                  />
                  <p className="text-foreground font-medium">
                    Connecting{partnerProfile ? ` to ${partnerProfile.displayName}` : '...'}
                  </p>
                  <p className="text-muted-foreground text-sm mt-1">Setting up secure video</p>
                </div>
              </motion.div>
            )}

            {isConnected && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-secondary to-muted"
              >
                <div className="text-center">
                  <div className="w-24 h-24 rounded-full gradient-primary flex items-center justify-center mx-auto mb-4 animate-pulse-glow">
                    {partnerProfile ? (
                      <Avatar className="h-20 w-20 border-2 border-background">
                        <AvatarImage src={partnerProfile.avatar} />
                        <AvatarFallback>{partnerProfile.displayName.charAt(0)}</AvatarFallback>
                      </Avatar>
                    ) : (
                      <Video className="w-10 h-10 text-primary-foreground" />
                    )}
                  </div>
                  <p className="text-foreground font-medium">
                    Connected{partnerProfile ? ` to ${partnerProfile.displayName}` : '!'}
                  </p>
                  <p className="text-muted-foreground text-sm">Say hi and start the conversation</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="absolute bottom-4 left-4 px-3 py-1.5 rounded-full glass text-sm">
            {isConnected
              ? partnerProfile?.displayName || 'Stranger'
              : isSearching
              ? 'Searching...'
              : isConnecting
              ? 'Connecting...'
              : 'No one yet'}
          </div>
        </motion.div>
      </div>

      {/* Controls */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center gap-4 py-4"
      >
        <Button
          variant={videoEnabled ? "secondary" : "destructive"}
          size="icon"
          className="w-14 h-14 rounded-full"
          onClick={toggleVideo}
        >
          {videoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
        </Button>

        <Button
          variant={audioEnabled ? "secondary" : "destructive"}
          size="icon"
          className="w-14 h-14 rounded-full"
          onClick={toggleAudio}
        >
          {audioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
        </Button>

        {(isConnected || isConnecting) && (
          <>
            {isConnected && (
              <Button
                variant="hero"
                size="icon"
                className="w-14 h-14 rounded-full"
                onClick={skipPartner}
              >
                <SkipForward className="w-6 h-6" />
              </Button>
            )}

            <Button
              variant="destructive"
              size="icon"
              className="w-14 h-14 rounded-full"
              onClick={disconnect}
            >
              <PhoneOff className="w-6 h-6" />
            </Button>
          </>
        )}

        {!isConnected && !isSearching && !isConnecting && (
          <Button variant="hero" size="lg" onClick={startSearching}>
            Start Chatting
          </Button>
        )}

        {isSearching && (
          <Button variant="outline" size="lg" onClick={stopSearching}>
            Cancel
          </Button>
        )}
      </motion.div>
    </div>
  );
}
