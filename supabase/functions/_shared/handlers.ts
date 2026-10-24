import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { cors, json, readBody, hashSecret } from "./http.ts";
import { validateTelemetry, validateCommand } from "./protocol.ts";
type Database = Pick<SupabaseClient, "auth" | "from" | "rpc">;
export async function deviceExchange(req: Request, db: Database) {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const token = req.headers.get("x-device-token");
  if (!token || !/^[0-9a-f]{64}$/.test(token))
    return json({ error: "Device authentication required" }, 401);
  try {
    const payload = await readBody(req);
    validateTelemetry(payload);
    const { data: credential, error: credentialError } = await db
      .from("device_credentials")
      .select("device_id")
      .eq("device_id", payload.device_id)
      .eq("secret_hash", await hashSecret(token))
      .maybeSingle();
    if (credentialError)
      return json({ error: "Credential lookup unavailable" }, 503);
    if (!credential) return json({ error: "Invalid device credentials" }, 401);
    const { data, error } = await db.rpc("exchange_device", {
      p_device: payload.device_id,
      p_payload: payload,
    });
    if (error)
      return json(
        { error: "Exchange rejected: session or sample is no longer current" },
        409,
      );
    return json(data);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Invalid request" },
      400,
    );
  }
}
export async function userCommand(req: Request, db: Database) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "Sign in required" }, 401);
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser(authorization.slice(7));
  if (authError || !user) return json({ error: "Sign in required" }, 401);
  try {
    const input = await readBody(req);
    validateCommand(input);
    const { data, error } = await db.rpc("issue_command", {
      p_owner: user.id,
      p_device: input.device_id,
      p_actuator: input.actuator,
      p_mode: input.mode,
      p_on: input.on,
      p_duration: input.duration_ms,
    });
    if (error)
      return json(
        {
          error:
            "Device unavailable, stale, or not authorized. Refresh before trying again.",
        },
        409,
      );
    return json(data);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Invalid request" },
      400,
    );
  }
}
