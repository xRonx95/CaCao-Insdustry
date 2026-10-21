// Supabase Edge Function (Deno), not browser JavaScript or a Node.js script.
// Deploy with: supabase functions deploy invite-team --no-verify-jwt
// The handler verifies the bearer session and protected account role explicitly.
import { createClient } from "@supabase/supabase-js";

Deno.serve(async (request: Request): Promise<Response> => {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin || "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
  const reply = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers });

  if (!allowedOrigin) return reply(500, { error: "Invitation origin is not configured." });
  if (origin !== allowedOrigin) return reply(403, { error: "Origin is not authorized." });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply(405, { error: "POST required." });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ") || !authorization.slice(7).trim()) {
    return reply(401, { error: "Sign in first." });
  }
  const url = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publicKey || !serviceKey) {
    return reply(500, { error: "Invitation service is not configured." });
  }

  try {
    const client = createClient(url, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) return reply(401, { error: "Invalid session." });
    const { data: access, error: accessError } = await client.from("profiles")
      .select("role,account_status").eq("id", user.id).single();
    if (accessError || !access || access.role !== "super_admin" || access.account_status !== "active") {
      return reply(403, { error: "Super administrator required." });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reply(400, { error: "A valid JSON request is required." });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply(400, { error: "An invitation object is required." });
    }
    const { email, role, redirectTo } = body as Record<string, unknown>;
    if (typeof email !== "string" || email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      (role !== "admin" && role !== "field")) {
      return reply(400, { error: "A valid email and staff role are required." });
    }
    let redirect: URL;
    try {
      if (typeof redirectTo !== "string") throw new Error("Missing redirect");
      redirect = new URL(redirectTo);
    } catch {
      return reply(400, { error: "Invalid invitation redirect." });
    }
    if (redirect.origin !== allowedOrigin || redirect.pathname !== "/reset-password.html" ||
      redirect.username || redirect.password) {
      return reply(400, { error: "Invalid invitation redirect." });
    }

    const service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(
      email.trim(), { redirectTo: redirect.href },
    );
    if (inviteError) return reply(400, { error: inviteError.message });
    if (!invited?.user?.id) {
      return reply(502, { error: "The invitation service did not return an account." });
    }
    const { error: roleError } = await client.rpc("set_account_access", {
      target: invited.user.id, new_role: role, new_status: "active",
    });
    if (roleError) {
      return reply(500, { error: "Invitation sent, but role assignment failed. Review this account in Users." });
    }
    return reply(200, { success: true });
  } catch {
    return reply(500, { error: "The invitation service is unavailable. Try again later." });
  }
});
