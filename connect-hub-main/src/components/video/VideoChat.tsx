import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Room, RoomEvent, Track, type LocalTrack, type RemoteTrack, type RemoteParticipant } from 'livekit-client';
import { 
  Video, 
  VideoOff, 
  Mic, 
  MicOff, 
  PhoneOff, 
  SkipForward,
  Settings,
  Maximize2,
  Eye,
  Monitor,
  Camera,
  Volume2,
  Users,
  Shield,
  Ban
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import AdminPanel from '@/components/admin/AdminPanel';
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

const useAnimatedCount = (value: number | null) => {
  const [animated, setAnimated] = useState<number | null>(value);
  const previousRef = useRef<number | null>(value);

  useEffect(() => {
    if (value === null) {
      previousRef.current = null;
      setAnimated(null);
      return;
    }

    const startValue = previousRef.current ?? value;
    if (startValue === value) {
      previousRef.current = value;
      setAnimated(value);
      return;
    }

    const durationMs = 320;
    const startTime = performance.now();
    let frameId = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / durationMs, 1);
      const nextValue = Math.round(startValue + (value - startValue) * progress);
      setAnimated(nextValue);
      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        previousRef.current = value;
      }
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [value]);

  return animated;
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
  const [remoteReady, setRemoteReady] = useState(false);
  const [needsRemoteTap, setNeedsRemoteTap] = useState(false);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const signalingChannelRef = useRef<RealtimeChannel | null>(null);
  const livekitRoomRef = useRef<Room | null>(null);
  const livekitAudioElementsRef = useRef<HTMLMediaElement[]>([]);
  const spectateSlotsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isOffererRef = useRef(false);
  const sentOfferRef = useRef(false);
  const hasAwardedRef = useRef(false);
  const searchTimerRef = useRef<number | null>(null);
  const callTimeoutRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const isConnectedRef = useRef(false);
  const iceRestartAttemptRef = useRef(false);
  const searchAttemptsRef = useRef(0);
  const matchIdRef = useRef<string | null>(null);
  const isSpectatingRef = useRef(false);
  const shadowPreviousRef = useRef<{ video: boolean; audio: boolean } | null>(null);
  
  const { user, awardCallPoint, onlineCount, totalUsers, isAdmin, banStatus } = useAuth();
  const { toast } = useToast();
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [shadowMode, setShadowMode] = useState(false);
  const [isSpectating, setIsSpectating] = useState(false);
  const livekitUrl = (import.meta.env.VITE_LIVEKIT_URL || '').trim();
  const useLivekit = Boolean(livekitUrl);
  const isConnecting = Boolean(matchId) && !isSearching && !isConnected;
  const offlineCount = totalUsers !== null && onlineCount !== null
    ? Math.max(totalUsers - onlineCount, 0)
    : null;
  const animatedOnlineCount = useAnimatedCount(onlineCount);
  const animatedOfflineCount = useAnimatedCount(offlineCount);
  const animatedTotalUsers = useAnimatedCount(totalUsers);
  const formatCount = (value: number | null) => (value === null ? '—' : value.toString());
  const isBanned = Boolean(banStatus?.isBanned);
  const banExpiresLabel = banStatus?.expiresAt
    ? new Date(banStatus.expiresAt).toLocaleString()
    : 'Permanent';

  useEffect(() => {
    if (!isAdmin && shadowMode) {
      setShadowMode(false);
      shadowPreviousRef.current = null;
    }
    if (!isAdmin && isSpectating) {
      setIsSpectating(false);
    }
  }, [isAdmin, isSpectating, shadowMode]);

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

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    isSpectatingRef.current = isSpectating;
  }, [isSpectating]);

  const getMediaDevices = async () => {
    let permissionStream: MediaStream | null = null;
    let keepPreviewStream = false;
    try {
      // Request permissions first (if allowed)
      permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      console.warn('Media permission not yet granted.', err);
    }

    try {
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
        title: "Error",
        description: "Could not list camera/microphone devices",
        variant: "destructive"
      });
    } finally {
      if (permissionStream) {
        if (!streamRef.current) {
          streamRef.current = permissionStream;
          keepPreviewStream = true;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = permissionStream;
          }
          setVideoEnabled(permissionStream.getVideoTracks().every((track) => track.enabled));
          setAudioEnabled(permissionStream.getAudioTracks().every((track) => track.enabled));
        }
        if (!keepPreviewStream) {
          permissionStream.getTracks().forEach((track) => track.stop());
        }
      }
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

      const buildConstraints = (videoId: string, audioId: string): MediaStreamConstraints => ({
        video: videoId ? { deviceId: { ideal: videoId } } : true,
        audio: audioId ? { deviceId: { ideal: audioId } } : true,
      });

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          buildConstraints(selectedVideoDevice, selectedAudioDevice)
        );
      } catch (err) {
        if (selectedVideoDevice || selectedAudioDevice) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } else {
          throw err;
        }
      }

      streamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      const shouldShadow = shadowMode && isAdmin;
      if (shouldShadow) {
        stream.getTracks().forEach((track) => {
          track.enabled = false;
        });
      }
      setVideoEnabled(shouldShadow ? false : stream.getVideoTracks().every((track) => track.enabled));
      setAudioEnabled(shouldShadow ? false : stream.getAudioTracks().every((track) => track.enabled));

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
      const reason = err instanceof DOMException ? err.name : 'UnknownError';
      toast({
        title: "Error",
        description: `Could not access camera/microphone (${reason})`,
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

  const setMediaEnabled = useCallback((nextVideo: boolean, nextAudio: boolean) => {
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = nextVideo;
      });
      streamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = nextAudio;
      });
    }
    setVideoEnabled(nextVideo);
    setAudioEnabled(nextAudio);
  }, []);

  const handleShadowToggle = useCallback((checked: boolean) => {
    setShadowMode(checked);
    if (checked) {
      if (!shadowPreviousRef.current) {
        shadowPreviousRef.current = { video: videoEnabled, audio: audioEnabled };
      }
      setMediaEnabled(false, false);
      return;
    }

    const previous = shadowPreviousRef.current;
    shadowPreviousRef.current = null;
    if (previous) {
      setMediaEnabled(previous.video, previous.audio);
    }
  }, [audioEnabled, setMediaEnabled, videoEnabled]);

  const clearSearchTimer = () => {
    if (searchTimerRef.current) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  };

  const clearCallTimeout = useCallback(() => {
    if (callTimeoutRef.current) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }, []);

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const tryPlayRemote = useCallback(async () => {
    const element = remoteVideoRef.current;
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
        // Still blocked; user gesture required.
      }
      setNeedsRemoteTap(true);
    }
  }, []);

  const clearSpectateSlots = useCallback(() => {
    spectateSlotsRef.current.clear();
  }, []);

  const cleanupLivekit = useCallback(async () => {
    const room = livekitRoomRef.current;
    if (!room) return;

    livekitRoomRef.current = null;
    clearSpectateSlots();

    room.remoteParticipants.forEach((participant) => {
      participant.tracks.forEach((pub) => {
        if (pub.track) {
          pub.track.detach();
        }
      });
    });

    room.localParticipant.trackPublications.forEach((pub) => {
      if (pub.track) {
        pub.track.detach();
      }
    });

    livekitAudioElementsRef.current.forEach((element) => {
      element.remove();
    });
    livekitAudioElementsRef.current = [];

    try {
      await room.disconnect(true);
    } catch (err) {
      console.warn('Failed to disconnect LiveKit room', err);
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (isSpectating && localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setRemoteReady(false);
    setNeedsRemoteTap(false);
  }, [clearSpectateSlots, isSpectating]);

  const selectSpectateSlot = useCallback((participant: RemoteParticipant) => {
    const current = spectateSlotsRef.current.get(participant.identity);
    if (current) return current;
    const slots = [remoteVideoRef.current, localVideoRef.current].filter(Boolean) as HTMLVideoElement[];
    const used = new Set(spectateSlotsRef.current.values());
    const available = slots.find((slot) => !used.has(slot));
    const chosen = available ?? slots[0];
    if (chosen) {
      spectateSlotsRef.current.set(participant.identity, chosen);
    }
    return chosen ?? null;
  }, []);

  const publishLivekitTracks = useCallback(async (room: Room) => {
    const stream = streamRef.current;
    if (!stream) return;
    const tracks = stream.getTracks();
    if (tracks.length === 0) return;

    const existingTracks = Array.from(room.localParticipant.trackPublications.values())
      .map((pub) => pub.track)
      .filter(Boolean) as LocalTrack[];

    if (existingTracks.length) {
      await room.localParticipant.unpublishTracks(existingTracks);
    }

    for (const track of tracks) {
      await room.localParticipant.publishTrack(track);
    }
  }, []);

  const attachLivekitTrack = useCallback(
    (track: RemoteTrack, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video) {
        const target = isSpectating ? selectSpectateSlot(participant) : remoteVideoRef.current;
        if (!target) return;
        track.attach(target);
        setRemoteReady(true);
        void tryPlayRemote();
        return;
      }

      const element = track.attach() as HTMLMediaElement;
      element.style.display = 'none';
      document.body.appendChild(element);
      livekitAudioElementsRef.current.push(element);
    },
    [isSpectating, selectSpectateSlot, tryPlayRemote]
  );

  const detachLivekitTrack = useCallback((track: RemoteTrack, participant: RemoteParticipant) => {
    const elements = track.detach();
    elements.forEach((element) => {
      if (element.tagName.toLowerCase() === 'audio') {
        element.remove();
      }
    });

    livekitAudioElementsRef.current = livekitAudioElementsRef.current.filter(
      (element) => !elements.includes(element)
    );

    if (track.kind === Track.Kind.Video) {
      spectateSlotsRef.current.delete(participant.identity);
    }
  }, []);

  const sendSignal = useCallback(async (payload: SignalPayload) => {
    const channel = signalingChannelRef.current;
    if (!channel) return;
    await channel.send({ type: 'broadcast', event: 'signal', payload });
  }, []);

  const cleanupPeerConnection = useCallback(async () => {
    await cleanupLivekit();
    pendingIceCandidatesRef.current = [];
    sentOfferRef.current = false;
    isOffererRef.current = false;
    hasAwardedRef.current = false;
    iceRestartAttemptRef.current = false;
    setRemoteReady(false);
    setNeedsRemoteTap(false);
    clearCallTimeout();
    clearConnectTimeout();

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
  }, [cleanupLivekit, clearCallTimeout, clearConnectTimeout]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        window.clearTimeout(searchTimerRef.current);
      }
      void supabase.rpc('stop_search');
      if (matchIdRef.current && !isSpectatingRef.current) {
        void supabase.rpc('end_match', { p_match_id: matchIdRef.current });
      }
      void cleanupPeerConnection();
      stopLocalStream();
    };
  }, [cleanupPeerConnection, stopLocalStream]);

  const handleRemoteEnded = useCallback(
    async (message: string, options?: { endMatch?: boolean }) => {
      const shouldEndMatch = options?.endMatch ?? true;
      if (shouldEndMatch && matchIdRef.current) {
        await supabase.rpc('end_match', { p_match_id: matchIdRef.current });
      }
      await cleanupPeerConnection();
      setIsConnected(false);
      setIsSearching(false);
      setMatchId(null);
      setPartnerProfile(null);
      setNoMatchMessage(false);
      setIsSpectating(false);
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

  const createAndSendOffer = useCallback(async (options?: RTCOfferOptions, force = false) => {
    const pc = peerConnectionRef.current;
    if (!pc || !user || (sentOfferRef.current && !force)) return;
    const offer = await pc.createOffer(options);
    await pc.setLocalDescription(offer);
    sentOfferRef.current = true;
    await sendSignal({ type: 'offer', from: user.id, sdp: offer });
  }, [sendSignal, user]);

  const startConnectTimeout = useCallback(() => {
    clearConnectTimeout();
    connectTimeoutRef.current = window.setTimeout(() => {
      if (isConnectedRef.current) return;
      void handleRemoteEnded('Connection timed out');
    }, 20000);
  }, [clearConnectTimeout, handleRemoteEnded]);

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
      setRemoteReady(true);
      void tryPlayRemote();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        clearConnectTimeout();
        iceRestartAttemptRef.current = false;
        setIsConnected(true);
        if (!hasAwardedRef.current) {
          hasAwardedRef.current = true;
          void awardCallPoint();
        }
      }
      if (pc.connectionState === 'failed') {
        if (isOffererRef.current && !iceRestartAttemptRef.current) {
          iceRestartAttemptRef.current = true;
          void createAndSendOffer({ iceRestart: true }, true);
          startConnectTimeout();
          return;
        }
        void handleRemoteEnded('Connection lost');
      }
      if (pc.connectionState === 'closed') {
        void handleRemoteEnded('Connection lost');
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        if (isOffererRef.current && !iceRestartAttemptRef.current) {
          iceRestartAttemptRef.current = true;
          void createAndSendOffer({ iceRestart: true }, true);
          startConnectTimeout();
          return;
        }
        void handleRemoteEnded('Connection failed');
      }
    };

    return pc;
  }, [
    awardCallPoint,
    clearConnectTimeout,
    createAndSendOffer,
    handleRemoteEnded,
    sendSignal,
    startConnectTimeout,
    tryPlayRemote,
    user,
  ]);

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

      channel.on('broadcast', { event: 'ready' }, ({ payload }) => {
        const sender = (payload as { from?: string } | null)?.from;
        if (sender === nextPartnerId && isOffererRef.current && !sentOfferRef.current) {
          void createAndSendOffer();
        }
      });

      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, PresencePayload[]>;
        const partnerPresent = Object.prototype.hasOwnProperty.call(state, nextPartnerId);
        if (partnerPresent && isOffererRef.current && !sentOfferRef.current) {
          void createAndSendOffer();
        }
      });

      channel.on('presence', { event: 'join' }, ({ key }) => {
        if (key === nextPartnerId && isOffererRef.current && !sentOfferRef.current) {
          void createAndSendOffer();
        }
      });

      channel.on('presence', { event: 'leave' }, ({ key }) => {
        if (key === nextPartnerId) {
          void handleRemoteEnded('Partner disconnected');
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
        await channel.send({ type: 'broadcast', event: 'ready', payload: { from: user.id } });
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

  const setupLivekitSession = useCallback(
    async (nextMatchId: string, shadow: boolean) => {
      if (!useLivekit || !livekitUrl || !user) return;

      const { data, error } = await supabase.functions.invoke('livekit-token', {
        body: { match_id: nextMatchId, shadow },
      });

      if (error || !data?.token) {
        toast({
          title: 'LiveKit token failed',
          description: error?.message || 'Unable to get LiveKit token.',
          variant: 'destructive',
        });
        return;
      }

      await cleanupLivekit();

      if (shadow) {
        stopLocalStream();
      } else if (!streamRef.current) {
        await startLocalStream();
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      livekitRoomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        attachLivekitTrack(track as RemoteTrack, participant);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        detachLivekitTrack(track as RemoteTrack, participant);
      });
      room.on(RoomEvent.ParticipantConnected, () => {
        clearConnectTimeout();
        setIsConnected(true);
        if (!shadow && !hasAwardedRef.current) {
          hasAwardedRef.current = true;
          void awardCallPoint();
        }
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (room.remoteParticipants.size === 0) {
          void handleRemoteEnded('Partner disconnected', { endMatch: !shadow });
        }
      });

      await room.connect(livekitUrl, data.token as string);

      if (!shadow) {
        await publishLivekitTracks(room);
      }
    },
    [
      attachLivekitTrack,
      awardCallPoint,
      cleanupLivekit,
      clearConnectTimeout,
      detachLivekitTrack,
      handleRemoteEnded,
      livekitUrl,
      publishLivekitTracks,
      startLocalStream,
      stopLocalStream,
      toast,
      useLivekit,
      user,
    ]
  );

  const setupMatchConnection = useCallback(
    async (nextMatchId: string, nextPartnerId: string) => {
      if (useLivekit) {
        await setupLivekitSession(nextMatchId, shadowMode && isAdmin);
        return;
      }
      await setupPeerConnection(nextMatchId, nextPartnerId);
    },
    [isAdmin, setupLivekitSession, setupPeerConnection, shadowMode, useLivekit]
  );

  const spectateUser = useCallback(
    async (targetId: string) => {
      if (!useLivekit) {
        toast({
          title: 'LiveKit not configured',
          description: 'Set VITE_LIVEKIT_URL to enable shadow spectate.',
          variant: 'destructive',
        });
        return;
      }

      clearSearchTimer();
      clearConnectTimeout();
      setIsSearching(false);
      setIsConnected(false);
      setNoMatchMessage(false);
      setPartnerProfile(null);
      hasAwardedRef.current = false;

      await cleanupPeerConnection();
      stopLocalStream();

      const { data, error } = await supabase.rpc('admin_get_active_match', {
        p_target_id: targetId,
      });

      if (error) {
        toast({
          title: 'Spectate failed',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }

      const match = Array.isArray(data) ? data[0] : data;
      if (!match) {
        toast({
          title: 'No active call',
          description: 'This user is not in a live call.',
        });
        return;
      }

      setShadowMode(true);
      setIsSpectating(true);
      setMatchId(match);
      await loadPartnerProfile(targetId);
      await setupLivekitSession(match, true);
      startConnectTimeout();
      setIsAdminPanelOpen(false);
      toast({
        title: 'Spectating',
        description: 'Connecting to live call...',
      });
    },
    [
      cleanupPeerConnection,
      clearConnectTimeout,
      loadPartnerProfile,
      setupLivekitSession,
      startConnectTimeout,
      stopLocalStream,
      toast,
      useLivekit,
    ]
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
      await setupMatchConnection(result.match_id, result.partner_id);
      startConnectTimeout();
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
  }, [loadPartnerProfile, setupMatchConnection, toast]);

  const startSearching = async () => {
    if (isBanned) {
      toast({
        title: 'Access restricted',
        description: banStatus?.reason
          ? `Banned: ${banStatus.reason}`
          : 'Your account is currently restricted.',
        variant: 'destructive',
      });
      return;
    }
    await cleanupPeerConnection();
    setIsConnected(false);
    setMatchId(null);
    setPartnerProfile(null);
    setNoMatchMessage(false);
    searchAttemptsRef.current = 0;
    hasAwardedRef.current = false;
    setIsSpectating(false);
    clearSearchTimer();
    clearConnectTimeout();
    setIsSearching(true);
    if (useLivekit && shadowMode && isAdmin) {
      stopLocalStream();
    } else {
      await startLocalStream();
    }
    await attemptMatch();
  };

  const submitReport = async () => {
    if (!partnerProfile || !user) return;
    const reason = reportReason.trim();
    if (!reason) {
      toast({
        title: 'Report reason required',
        description: 'Tell us why you are reporting this user.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmittingReport(true);
    const { error } = await supabase.rpc('submit_report', {
      p_target_id: partnerProfile.id,
      p_reason: reason,
      p_details: reportDetails.trim() || null,
      p_context: 'video_call',
    });
    setIsSubmittingReport(false);

    if (error) {
      toast({
        title: 'Report failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    setReportReason('');
    setReportDetails('');
    setIsReportOpen(false);
    toast({
      title: 'Report submitted',
      description: 'Thanks for keeping the community safe.',
    });
  };

  const stopSearching = useCallback(async () => {
    clearSearchTimer();
    setIsSearching(false);
    setIsConnected(false);
    setMatchId(null);
    setPartnerProfile(null);
    setNoMatchMessage(false);
    searchAttemptsRef.current = 0;
    setIsSpectating(false);
    clearConnectTimeout();
    await supabase.rpc('stop_search');
    await cleanupPeerConnection();
    stopLocalStream();
  }, [cleanupPeerConnection, clearConnectTimeout, stopLocalStream]);

  const skipPartner = async () => {
    if (isSpectating) {
      await disconnect();
      return;
    }
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

  useEffect(() => {
    if (!isConnected) {
      clearCallTimeout();
      return;
    }

    clearCallTimeout();
    callTimeoutRef.current = window.setTimeout(() => {
      void skipPartner();
    }, 90 * 60 * 1000);

    return () => {
      clearCallTimeout();
    };
  }, [clearCallTimeout, isConnected, skipPartner]);

  useEffect(() => {
    if (!matchId) return;
    const channel = supabase.channel(`video-match-status:${matchId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'video_matches',
        filter: `id=eq.${matchId}`,
      }, (payload) => {
        const updated = payload.new as { ended_at?: string | null };
        if (updated?.ended_at) {
          void handleRemoteEnded('Chat ended by a moderator');
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [handleRemoteEnded, matchId]);

  const disconnect = async () => {
    clearSearchTimer();
    if (!useLivekit && user) {
      await sendSignal({ type: 'bye', from: user.id });
    }
    if (matchId && !isSpectating) {
      await supabase.rpc('end_match', { p_match_id: matchId });
    } else if (!isSpectating) {
      await supabase.rpc('stop_search');
    }
    await cleanupPeerConnection();
    setIsConnected(false);
    setIsSearching(false);
    setMatchId(null);
    setPartnerProfile(null);
    setNoMatchMessage(false);
    setIsSpectating(false);
    stopLocalStream();
    toast({
      title: "Disconnected",
      description: "Chat ended",
    });
  };

  const toggleVideo = () => {
    setMediaEnabled(!videoEnabled, audioEnabled);
  };

  const toggleAudio = () => {
    setMediaEnabled(videoEnabled, !audioEnabled);
  };

  const switchDevice = async (type: 'video' | 'audio', deviceId: string) => {
    if (type === 'video') {
      setSelectedVideoDevice(deviceId);
    } else {
      setSelectedAudioDevice(deviceId);
    }
    
    if (streamRef.current || useLivekit) {
      await startLocalStream();
    }
    if (useLivekit && livekitRoomRef.current && !shadowMode) {
      await publishLivekitTracks(livekitRoomRef.current);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Video Chat</h1>
          <p className="text-muted-foreground">Connect with random people around the world</p>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-online animate-pulse" />
              {formatCount(animatedOnlineCount)} Online
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-offline" />
              {formatCount(animatedOfflineCount)} Offline
            </span>
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              {formatCount(animatedTotalUsers)} Total
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Dialog open={isAdminPanelOpen} onOpenChange={setIsAdminPanelOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon">
                  <Shield className="w-5 h-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="glass border-border max-w-4xl">
                <DialogHeader>
                  <DialogTitle className="font-display">Admin Panel</DialogTitle>
                  <DialogDescription>
                    Moderate calls, review reports, and manage bans.
                  </DialogDescription>
                </DialogHeader>
                <AdminPanel onSpectate={spectateUser} />
              </DialogContent>
            </Dialog>
          )}

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon">
                <Settings className="w-5 h-5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="glass border-border">
              <DialogHeader>
                <DialogTitle className="font-display">Device Settings</DialogTitle>
                <DialogDescription>
                  Choose the camera, microphone, and speakers for your call.
                </DialogDescription>
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
            {isSpectating ? 'Spectating' : 'You'}
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
            {!isBanned && !isConnected && !isSearching && !isConnecting && (
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

            {!isBanned && isSearching && (
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

            {!isBanned && isConnecting && (
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

            {!isBanned && isConnected && !remoteReady && !needsRemoteTap && (
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
                  <p className="text-muted-foreground text-sm">Waiting for video…</p>
                </div>
              </motion.div>
            )}

            {!isBanned && needsRemoteTap && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-card/80"
              >
                <div className="text-center">
                  <p className="text-foreground font-medium mb-3">Tap to start audio/video</p>
                  <Button variant="hero" size="lg" onClick={tryPlayRemote}>
                    Tap to Start
                  </Button>
                </div>
              </motion.div>
            )}
            {isBanned && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-card/90"
              >
                <div className="text-center max-w-xs">
                  <Ban className="w-12 h-12 text-destructive mx-auto mb-4" />
                  <p className="text-foreground font-semibold">Access restricted</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {banStatus?.reason || 'Your account is currently restricted.'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Expires: {banExpiresLabel}
                  </p>
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

          {isConnected && partnerProfile && (
            <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute bottom-4 right-4 border border-destructive/70 shadow-sm"
                >
                  Report
                </Button>
              </DialogTrigger>
              <DialogContent className="glass border-border max-w-lg">
                <DialogHeader>
                  <DialogTitle className="font-display">Report user</DialogTitle>
                  <DialogDescription>
                    Report {partnerProfile.displayName} for violating community rules.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  <div className="space-y-2">
                    <Label>Reason</Label>
                    <Input
                      value={reportReason}
                      onChange={(event) => setReportReason(event.target.value)}
                      placeholder="Harassment, spam, unsafe content..."
                      className="bg-secondary border-0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Details (optional)</Label>
                    <Textarea
                      value={reportDetails}
                      onChange={(event) => setReportDetails(event.target.value)}
                      placeholder="Add context to help moderators."
                      className="bg-secondary border-0 min-h-[100px]"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setIsReportOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="hero" onClick={submitReport} disabled={isSubmittingReport}>
                      {isSubmittingReport ? 'Submitting...' : 'Submit report'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </motion.div>
      </div>

      {/* Controls */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-4 py-4"
      >
        {isAdmin && (
          <div className="flex items-center gap-2 rounded-full glass border border-primary/40 px-3 py-2 text-xs">
            <Eye className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Shadow</span>
            <Switch checked={shadowMode} onCheckedChange={handleShadowToggle} />
          </div>
        )}

        <div className="flex-1 flex items-center justify-center gap-4">
          <Button
            variant={videoEnabled ? "secondary" : "destructive"}
            size="icon"
            className="w-14 h-14 rounded-full"
            onClick={toggleVideo}
            disabled={shadowMode}
          >
            {videoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          </Button>

          <Button
            variant={audioEnabled ? "secondary" : "destructive"}
            size="icon"
            className="w-14 h-14 rounded-full"
            onClick={toggleAudio}
            disabled={shadowMode}
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
        </div>
      </motion.div>
    </div>
  );
}
