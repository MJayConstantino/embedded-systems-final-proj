import { createClient } from "@supabase/supabase-js";
import type {
  Snapshot,
  HistoryRow,
  EventRow,
  CommandInput,
  CommandRow,
} from "./domain";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = !!url && !!key && !!import.meta.env.VITE_DEVICE_ID;
export const deviceId = import.meta.env.VITE_DEVICE_ID ?? "";
export const supabase = configured ? createClient(url, key) : null;
export async function loadCurrent() {
  if (!supabase) throw new Error("Cloud connection is not configured");
  const [latest, commands] = await Promise.all([
    supabase
      .from("latest_telemetry")
      .select("payload,received_at")
      .eq("device_id", deviceId)
      .maybeSingle(),
    supabase
      .from("commands")
      .select("*")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);
  if (latest.error) throw latest.error;
  if (commands.error) throw commands.error;
  return {
    snapshot: latest.data
      ? ({
          ...latest.data.payload,
          received_at: latest.data.received_at,
        } as Snapshot)
      : null,
    commands: commands.data as CommandRow[],
  };
}
export async function loadHistory() {
  if (!supabase) throw new Error("Cloud connection is not configured");
  const since = new Date(Date.now() - 86400000).toISOString();
  // Explicit pagination avoids the default 1,000-row REST limit truncating a 24-hour chart.
  const [first, second, events] = await Promise.all([
    supabase
      .from("history")
      .select("recorded_at,sensors")
      .eq("device_id", deviceId)
      .gte("recorded_at", since)
      .order("recorded_at")
      .range(0, 999),
    supabase
      .from("history")
      .select("recorded_at,sensors")
      .eq("device_id", deviceId)
      .gte("recorded_at", since)
      .order("recorded_at")
      .range(1000, 1499),
    supabase
      .from("control_events")
      .select("id,created_at,kind,message")
      .eq("device_id", deviceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (first.error || second.error || events.error)
    throw first.error ?? second.error ?? events.error;
  return {
    history: [...first.data, ...second.data] as HistoryRow[],
    events: events.data as EventRow[],
  };
}
export async function sendCommand(input: CommandInput) {
  const { data, error } = await supabase!.functions.invoke("user-command", {
    body: input,
  });
  if (error || data?.error)
    throw new Error(
      data?.error ?? "Command could not be sent. Refresh and try again.",
    );
  return data as CommandRow;
}
