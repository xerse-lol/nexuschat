import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { create, getNumericDate } from 'https://deno.land/x/djwt@v2.9/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY') ?? '';
  const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET') ?? '';

  if (!supabaseUrl || !supabaseAnonKey || !livekitApiKey || !livekitApiSecret) {
    return new Response(JSON.stringify({ error: 'Missing server configuration' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => null);
  const matchId = body?.match_id;
  const shadow = Boolean(body?.shadow);

  if (typeof matchId !== 'string' || !isUuid(matchId)) {
    return new Response(JSON.stringify({ error: 'Invalid match_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (shadow) {
    const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin');
    if (adminError || !isAdmin) {
      return new Response(JSON.stringify({ error: 'Not authorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } else {
    const { data: match, error: matchError } = await supabase
      .from('video_matches')
      .select('id')
      .eq('id', matchId)
      .is('ended_at', null)
      .maybeSingle();

    if (matchError || !match) {
      return new Response(JSON.stringify({ error: 'Match not found' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  const identity = shadow ? `shadow:${user.id}:${matchId}` : user.id;
  const now = getNumericDate(0);
  const token = await create(
    { alg: 'HS256', typ: 'JWT' },
    {
      iss: livekitApiKey,
      sub: identity,
      nbf: now - 10,
      exp: getNumericDate(60 * 60),
      name: user.user_metadata?.full_name ?? user.email ?? user.id,
      video: {
        room: matchId,
        roomJoin: true,
        canPublish: !shadow,
        canPublishData: !shadow,
        canSubscribe: true,
        hidden: shadow,
      },
    },
    livekitApiSecret
  );

  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
