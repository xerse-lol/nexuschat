import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Clock, RefreshCw, Search, UserX, ShieldCheck } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { cn } from '@/lib/utils';

type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  status: 'online' | 'away' | 'dnd' | 'offline' | null;
};

type BanRow = {
  id: string;
  scope: 'user' | 'ip' | 'hwid';
  target_user_id: string | null;
  target_value: string | null;
  reason: string | null;
  created_at: string;
  expires_at: string | null;
};

type ReportRow = {
  id: string;
  reporter_id: string;
  target_id: string;
  context: string;
  reason: string;
  details: string | null;
  created_at: string;
};

type ActionRow = {
  id: string;
  actor_id: string;
  target_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

type ProfileMap = Record<string, ProfileRow>;

const statusColors = {
  online: 'bg-online',
  away: 'bg-away',
  dnd: 'bg-dnd',
  offline: 'bg-offline',
};

const PAGE_SIZE = 25;

const formatDate = (value: string | null) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
};

const normalizeProfileMap = (rows: ProfileRow[] | null | undefined) => {
  const next: ProfileMap = {};
  (rows ?? []).forEach((row) => {
    if (row?.id) {
      next[row.id] = row;
    }
  });
  return next;
};

const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

const getReportPriority = (reason: string, details?: string | null) => {
  const text = `${reason} ${details ?? ''}`.toLowerCase();
  if (/(child|minor|underage|pedo|csam|assault|rape|dox|threat|self-harm)/.test(text)) {
    return 'high';
  }
  if (/(harass|spam|hate|slur|violence|scam)/.test(text)) {
    return 'medium';
  }
  return 'low';
};

const priorityWeight: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const actionLabels: Record<string, string> = {
  admin_ban: 'Ban',
  admin_unban: 'Unban',
  admin_end_match: 'End call',
  report_submitted: 'Report',
  friend_request: 'Friend request',
};

export default function AdminPanel() {
  const { isOwner } = useAuth();
  const { toast } = useToast();
  const [lookupValue, setLookupValue] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [targetUser, setTargetUser] = useState<ProfileRow | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banDurationSeconds, setBanDurationSeconds] = useState('3600');
  const [activeBans, setActiveBans] = useState<BanRow[]>([]);
  const [banProfiles, setBanProfiles] = useState<ProfileMap>({});
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [reportProfiles, setReportProfiles] = useState<ProfileMap>({});
  const [isLoadingBans, setIsLoadingBans] = useState(false);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [reportSearch, setReportSearch] = useState('');
  const [reportContext, setReportContext] = useState('all');
  const [reportPage, setReportPage] = useState(0);
  const [reportHasMore, setReportHasMore] = useState(true);
  const [banSearch, setBanSearch] = useState('');
  const [banScope, setBanScope] = useState('all');
  const [banPage, setBanPage] = useState(0);
  const [banHasMore, setBanHasMore] = useState(true);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [actionProfiles, setActionProfiles] = useState<ProfileMap>({});
  const [actionSearch, setActionSearch] = useState('');
  const [actionPage, setActionPage] = useState(0);
  const [actionHasMore, setActionHasMore] = useState(true);
  const [isLoadingActions, setIsLoadingActions] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);

  const lookupTargetUser = useCallback(async () => {
    const trimmed = lookupValue.trim();
    if (!trimmed) {
      toast({
        title: 'Enter a username or ID',
        description: 'Provide a username or user ID to search.',
        variant: 'destructive',
      });
      return;
    }

    setLookupLoading(true);
    const isUuid = /^[0-9a-f-]{36}$/i.test(trimmed);
    const query = supabase
      .from('profiles')
      .select('id, username, display_name, avatar, status')
      .limit(1);

    const { data, error } = isUuid
      ? await query.eq('id', trimmed).maybeSingle()
      : await query.ilike('username', trimmed).maybeSingle();

    setLookupLoading(false);

    if (error || !data) {
      toast({
        title: 'User not found',
        description: error?.message || 'No matching user.',
        variant: 'destructive',
      });
      setTargetUser(null);
      return;
    }

    setTargetUser(data as ProfileRow);
  }, [lookupValue, toast]);

  const loadActiveBans = useCallback(async (page = 0, append = false) => {
    setIsLoadingBans(true);
    const offset = page * PAGE_SIZE;
    let query = supabase
      .from('admin_bans')
      .select('id, scope, target_user_id, target_value, reason, created_at, expires_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (banScope !== 'all') {
      query = query.eq('scope', banScope);
    }

    const term = banSearch.trim();
    if (term) {
      query = isUuid(term)
        ? query.eq('target_user_id', term)
        : query.or(`reason.ilike.%${term}%,target_value.ilike.%${term}%`);
    }

    const { data, error } = await query;
    setIsLoadingBans(false);

    if (error) {
      toast({
        title: 'Failed to load bans',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    const rows = (data ?? []) as BanRow[];
    setActiveBans((prev) => (append ? [...prev, ...rows] : rows));
    setBanHasMore(rows.length === PAGE_SIZE);
    setBanPage(page);

    const userIds = rows
      .filter((row) => row.scope === 'user' && row.target_user_id)
      .map((row) => row.target_user_id as string);

    if (userIds.length === 0) {
      if (!append) {
        setBanProfiles({});
      }
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar, status')
      .in('id', userIds);

    setBanProfiles((prev) => ({
      ...prev,
      ...normalizeProfileMap(profiles as ProfileRow[]),
    }));
  }, [banScope, banSearch, toast]);

  const loadReports = useCallback(async (page = 0, append = false) => {
    setIsLoadingReports(true);
    const offset = page * PAGE_SIZE;
    let query = supabase
      .from('user_reports')
      .select('id, reporter_id, target_id, context, reason, details, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (reportContext !== 'all') {
      query = query.eq('context', reportContext);
    }

    const term = reportSearch.trim();
    if (term) {
      query = query.or(`reason.ilike.%${term}%,details.ilike.%${term}%`);
    }

    const { data, error } = await query;
    setIsLoadingReports(false);

    if (error) {
      toast({
        title: 'Failed to load reports',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    const rows = (data ?? []) as ReportRow[];
    setReports((prev) => (append ? [...prev, ...rows] : rows));
    setReportHasMore(rows.length === PAGE_SIZE);
    setReportPage(page);

    const profileIds = Array.from(new Set(rows.flatMap((row) => [row.reporter_id, row.target_id])));
    if (profileIds.length === 0) {
      if (!append) {
        setReportProfiles({});
      }
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar, status')
      .in('id', profileIds);

    setReportProfiles((prev) => ({
      ...prev,
      ...normalizeProfileMap(profiles as ProfileRow[]),
    }));
  }, [reportContext, reportSearch, toast]);

  const loadActions = useCallback(async (page = 0, append = false) => {
    setIsLoadingActions(true);
    const offset = page * PAGE_SIZE;
    let query = supabase
      .from('user_actions')
      .select('id, actor_id, target_id, action, details, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    const term = actionSearch.trim();
    if (term) {
      query = isUuid(term)
        ? query.or(`actor_id.eq.${term},target_id.eq.${term}`)
        : query.or(`action.ilike.%${term}%`);
    }

    const { data, error } = await query;
    setIsLoadingActions(false);

    if (error) {
      toast({
        title: 'Failed to load audit log',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    const rows = (data ?? []) as ActionRow[];
    setActions((prev) => (append ? [...prev, ...rows] : rows));
    setActionHasMore(rows.length === PAGE_SIZE);
    setActionPage(page);

    const profileIds = Array.from(
      new Set(rows.flatMap((row) => [row.actor_id, row.target_id].filter(Boolean) as string[]))
    );
    if (profileIds.length === 0) {
      if (!append) {
        setActionProfiles({});
      }
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar, status')
      .in('id', profileIds);

    setActionProfiles((prev) => ({
      ...prev,
      ...normalizeProfileMap(profiles as ProfileRow[]),
    }));
  }, [actionSearch, toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadActiveBans(0, false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadActiveBans]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReports(0, false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadReports]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadActions(0, false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadActions]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-reports-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_reports' },
        () => {
          toast({
            title: 'New report received',
            description: 'A new report was added to the queue.',
          });
          void loadReports(0, false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadReports, toast]);

  const handleBan = async () => {
    if (!targetUser) return;
    const parsedDuration = Number.parseInt(banDurationSeconds, 10);
    const duration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null;

    const { error } = await supabase.rpc('admin_ban_user', {
      p_target_id: targetUser.id,
      p_reason: banReason,
      p_duration_seconds: duration,
    });

    if (error) {
      toast({
        title: 'Ban failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'User banned',
      description: duration ? `Ban ends in ${duration} seconds.` : 'Ban is permanent.',
    });
    setBanReason('');
    void loadActiveBans(0, false);
  };

  const handleUnban = async () => {
    if (!targetUser) return;
    const { error } = await supabase.rpc('admin_unban_user', {
      p_target_id: targetUser.id,
    });

    if (error) {
      toast({
        title: 'Unban failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({ title: 'User unbanned' });
    void loadActiveBans(0, false);
  };

  const handleEndMatch = async (targetId: string) => {
    const { data, error } = await supabase.rpc('admin_end_match_for_user', {
      p_target_id: targetId,
    });

    if (error) {
      toast({
        title: 'Kick failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    if (!data) {
      toast({
        title: 'No active match',
        description: 'This user is not in a live call.',
      });
      return;
    }

    toast({
      title: 'Match ended',
      description: 'The active call was closed.',
    });
  };

  const handleQuickBan = async (targetId: string, reason?: string) => {
    const { error } = await supabase.rpc('admin_ban_user', {
      p_target_id: targetId,
      p_reason: reason || 'Reported by users',
      p_duration_seconds: 86400,
    });

    if (error) {
      toast({
        title: 'Ban failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'User banned',
      description: '24h ban applied.',
    });
    void loadActiveBans(0, false);
  };

  const handleGenerateCodes = async (role: 'admin' | 'owner') => {
    const count = role === 'owner' ? 1 : 10;
    const { data, error } = await supabase.rpc('generate_admin_codes', {
      p_count: count,
      p_role: role,
      p_max_uses: 1,
      p_note: role === 'owner' ? 'Owner bootstrap' : 'Admin invite',
    });

    if (error) {
      toast({
        title: 'Code generation failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    const codes = Array.isArray(data)
      ? data.map((row) => (row as { code?: string }).code).filter(Boolean) as string[]
      : [];

    setGeneratedCodes(codes);
    toast({
      title: 'Codes generated',
      description: `${codes.length} ${role} code${codes.length === 1 ? '' : 's'} ready.`,
    });
  };

  const renderProfileName = (profile?: ProfileRow | null) => {
    if (!profile) return 'Unknown';
    return profile.display_name || profile.username || profile.id.slice(0, 8);
  };

  const renderStatusBadge = (status: ProfileRow['status']) => {
    if (!status) return null;
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
          statusColors[status] || 'bg-muted text-muted-foreground'
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
        {status}
      </span>
    );
  };

  const formatActionDetails = (details: Record<string, unknown> | null) => {
    if (!details) return null;
    const reason = typeof details.reason === 'string' ? details.reason : null;
    const expiresAt = typeof details.expires_at === 'string' ? details.expires_at : null;
    const matchId = typeof details.match_id === 'string' ? details.match_id : null;
    const parts = [];
    if (reason) parts.push(`Reason: ${reason}`);
    if (expiresAt) parts.push(`Expires: ${formatDate(expiresAt)}`);
    if (matchId) parts.push(`Match: ${matchId.slice(0, 8)}`);
    if (parts.length) return parts.join(' • ');
    try {
      return JSON.stringify(details);
    } catch {
      return null;
    }
  };

  const bansWithProfiles = useMemo(() => activeBans.map((ban) => ({
    ban,
    profile: ban.target_user_id ? banProfiles[ban.target_user_id] : null,
  })), [activeBans, banProfiles]);

  const reportsWithProfiles = useMemo(() => {
    const enriched = reports.map((report) => ({
      report,
      reporter: reportProfiles[report.reporter_id],
      target: reportProfiles[report.target_id],
      priority: getReportPriority(report.reason, report.details),
    }));

    return enriched.sort((a, b) => {
      const priorityDelta = (priorityWeight[b.priority] ?? 0) - (priorityWeight[a.priority] ?? 0);
      if (priorityDelta !== 0) return priorityDelta;
      return new Date(b.report.created_at).getTime() - new Date(a.report.created_at).getTime();
    });
  }, [reports, reportProfiles]);

  const actionsWithProfiles = useMemo(() => actions.map((row) => ({
    action: row,
    actor: actionProfiles[row.actor_id],
    target: row.target_id ? actionProfiles[row.target_id] : null,
  })), [actions, actionProfiles]);

  return (
    <Tabs defaultValue="moderate" className="space-y-4">
      <TabsList className="bg-secondary p-1 rounded-xl gap-1">
        <TabsTrigger value="moderate">Moderate</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
        <TabsTrigger value="bans">Bans</TabsTrigger>
        <TabsTrigger value="audit">Audit Log</TabsTrigger>
        {isOwner && <TabsTrigger value="codes">Codes</TabsTrigger>}
      </TabsList>

      <TabsContent value="moderate" className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Find user</Label>
              <div className="flex gap-2">
                <Input
                  value={lookupValue}
                  onChange={(event) => setLookupValue(event.target.value)}
                  placeholder="Username or user ID"
                  className="bg-secondary border-0"
                />
                <Button variant="outline" onClick={lookupTargetUser} disabled={lookupLoading}>
                  <Search className="w-4 h-4 mr-2" />
                  {lookupLoading ? 'Searching' : 'Lookup'}
                </Button>
              </div>
            </div>

            {targetUser && (
              <div className="rounded-2xl border border-border bg-card/80 p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={targetUser.avatar || ''} />
                    <AvatarFallback>{renderProfileName(targetUser).charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-semibold">{renderProfileName(targetUser)}</p>
                    <p className="text-xs text-muted-foreground">@{targetUser.username}</p>
                  </div>
                  {renderStatusBadge(targetUser.status)}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Button variant="outline" onClick={() => handleEndMatch(targetUser.id)}>
                    <UserX className="w-4 h-4 mr-2" />
                    Kick Call
                  </Button>
                  <Button variant="outline" onClick={handleUnban}>
                    <ShieldCheck className="w-4 h-4 mr-2" />
                    Unban
                  </Button>
                  <Button variant="destructive" onClick={handleBan}>
                    <Ban className="w-4 h-4 mr-2" />
                    Ban
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-border bg-card/80 p-4">
            <div className="space-y-2">
              <Label>Ban reason</Label>
              <Textarea
                value={banReason}
                onChange={(event) => setBanReason(event.target.value)}
                placeholder="Reason for the ban"
                className="bg-secondary border-0 min-h-[92px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Duration (seconds)</Label>
              <Input
                value={banDurationSeconds}
                onChange={(event) => setBanDurationSeconds(event.target.value)}
                placeholder="0 for infinite"
                className="bg-secondary border-0"
              />
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />
                Set to 0 for permanent bans.
              </p>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="reports" className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Latest user reports</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadReports(0, false)}
              disabled={isLoadingReports}
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', isLoadingReports && 'animate-spin')} />
              Refresh
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_200px]">
            <Input
              value={reportSearch}
              onChange={(event) => setReportSearch(event.target.value)}
              placeholder="Search reason or details"
              className="bg-secondary border-0"
            />
            <Select value={reportContext} onValueChange={setReportContext}>
              <SelectTrigger className="bg-secondary border-0">
                <SelectValue placeholder="Context" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All contexts</SelectItem>
                <SelectItem value="video_call">Video call</SelectItem>
                <SelectItem value="direct_messages">Direct messages</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <ScrollArea className="h-[320px] pr-4">
          <div className="space-y-3">
            {reportsWithProfiles.length === 0 && (
              <div className="text-sm text-muted-foreground">No reports yet.</div>
            )}
            {reportsWithProfiles.map(({ report, reporter, target, priority }) => (
              <div key={report.id} className="rounded-xl border border-border bg-card/80 p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{report.context}</Badge>
                  <Badge
                    className={cn(
                      'uppercase text-[10px]',
                      priority === 'high' && 'bg-destructive/20 text-destructive',
                      priority === 'medium' && 'bg-amber-500/20 text-amber-500',
                      priority === 'low' && 'bg-muted text-muted-foreground'
                    )}
                  >
                    {priority}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(report.created_at)}</span>
                </div>
                <p className="text-sm">
                  <span className="font-semibold">{renderProfileName(reporter)}</span>
                  {' → '}
                  <span className="font-semibold">{renderProfileName(target)}</span>
                </p>
                <p className="text-sm text-muted-foreground">{report.reason}</p>
                {report.details && (
                  <p className="text-xs text-muted-foreground">{report.details}</p>
                )}
                {target?.id && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEndMatch(target.id)}
                    >
                      <UserX className="w-4 h-4 mr-2" />
                      End call
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleQuickBan(target.id, report.reason)}
                    >
                      <Ban className="w-4 h-4 mr-2" />
                      Ban 24h
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {reports.length} report{reports.length === 1 ? '' : 's'}</span>
          {reportHasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadReports(reportPage + 1, true)}
              disabled={isLoadingReports}
            >
              Load more
            </Button>
          )}
        </div>
      </TabsContent>

      <TabsContent value="bans" className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Active bans</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadActiveBans(0, false)}
              disabled={isLoadingBans}
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', isLoadingBans && 'animate-spin')} />
              Refresh
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_160px]">
            <Input
              value={banSearch}
              onChange={(event) => setBanSearch(event.target.value)}
              placeholder="Search reason or target"
              className="bg-secondary border-0"
            />
            <Select value={banScope} onValueChange={setBanScope}>
              <SelectTrigger className="bg-secondary border-0">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scopes</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="ip">IP</SelectItem>
                <SelectItem value="hwid">HWID</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <ScrollArea className="h-[320px] pr-4">
          <div className="space-y-3">
            {bansWithProfiles.length === 0 && (
              <div className="text-sm text-muted-foreground">No active bans.</div>
            )}
            {bansWithProfiles.map(({ ban, profile }) => (
              <div key={ban.id} className="rounded-xl border border-border bg-card/80 p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{ban.scope}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(ban.created_at)}</span>
                </div>
                <p className="text-sm font-semibold">
                  {ban.scope === 'user'
                    ? renderProfileName(profile)
                    : ban.target_value || 'Unknown target'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Expires: {formatDate(ban.expires_at)}
                </p>
                {ban.reason && (
                  <p className="text-xs text-muted-foreground">{ban.reason}</p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {activeBans.length} ban{activeBans.length === 1 ? '' : 's'}</span>
          {banHasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadActiveBans(banPage + 1, true)}
              disabled={isLoadingBans}
            >
              Load more
            </Button>
          )}
        </div>
      </TabsContent>

      <TabsContent value="audit" className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Moderator actions</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadActions(0, false)}
              disabled={isLoadingActions}
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', isLoadingActions && 'animate-spin')} />
              Refresh
            </Button>
          </div>
          <Input
            value={actionSearch}
            onChange={(event) => setActionSearch(event.target.value)}
            placeholder="Search by action or user ID"
            className="bg-secondary border-0"
          />
        </div>
        <ScrollArea className="h-[320px] pr-4">
          <div className="space-y-3">
            {actionsWithProfiles.length === 0 && (
              <div className="text-sm text-muted-foreground">No actions logged yet.</div>
            )}
            {actionsWithProfiles.map(({ action, actor, target }) => {
              const label = actionLabels[action.action] || action.action;
              const detailText = formatActionDetails(action.details);
              return (
                <div key={action.id} className="rounded-xl border border-border bg-card/80 p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary">{label}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(action.created_at)}</span>
                  </div>
                  <p className="text-sm">
                    <span className="font-semibold">{renderProfileName(actor)}</span>
                    {action.target_id && (
                      <>
                        {' → '}
                        <span className="font-semibold">{renderProfileName(target)}</span>
                      </>
                    )}
                  </p>
                  {detailText && (
                    <p className="text-xs text-muted-foreground">{detailText}</p>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {actions.length} action{actions.length === 1 ? '' : 's'}</span>
          {actionHasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadActions(actionPage + 1, true)}
              disabled={isLoadingActions}
            >
              Load more
            </Button>
          )}
        </div>
      </TabsContent>

      {isOwner && (
        <TabsContent value="codes" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => handleGenerateCodes('admin')}>
              Generate 10 admin codes
            </Button>
            <Button variant="outline" onClick={() => handleGenerateCodes('owner')}>
              Generate owner code
            </Button>
          </div>
          <div className="space-y-2">
            <Label>Generated codes</Label>
            <Textarea
              value={generatedCodes.join('\n')}
              readOnly
              className="bg-secondary border-0 min-h-[140px]"
              placeholder="Generate codes to display them here."
            />
            <p className="text-xs text-muted-foreground">
              Share codes only with trusted moderators. Codes are stored in Supabase.
            </p>
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
}
