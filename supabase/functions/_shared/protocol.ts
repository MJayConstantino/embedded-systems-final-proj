export const ACTUATORS = ["fan", "pump", "atomizer"] as const;
export type Actuator = (typeof ACTUATORS)[number];
export type Mode = "auto" | "manual";
export type Output = {
  mode: Mode;
  on: boolean;
  remaining_ms: number;
  blocked: string | null;
};
export type Sensors = {
  soil_raw: number;
  water_raw: number;
  soil_percent: number;
  water_percent: number;
  temperature_c: number | null;
  humidity_percent: number | null;
  dht_valid: boolean;
};
export type Telemetry = {
  device_id: string;
  session_id: string;
  sample_seq: number;
  uptime_ms: number;
  sensors: Sensors;
  actuators: Record<Actuator, Output>;
  acks: { id: string; status: "applied" | "rejected"; reason: string | null }[];
};
export type Snapshot = Omit<Telemetry, "acks"> & { received_at: string };
export type CommandInput = {
  device_id: string;
  actuator: Actuator;
  mode: Mode;
  on: boolean;
  duration_ms: number;
};
export type Command = CommandInput & {
  id: string;
  session_id: string;
  revision: number;
  expires_at: string;
  ttl_ms: number;
};
export type CommandRow = Command & {
  status: "pending" | "applied" | "rejected" | "expired";
  reason: string | null;
  created_at: string;
  delivered_at: string | null;
};
export type HistoryRow = { recorded_at: string; sensors: Sensors };
export type EventRow = {
  id: number;
  created_at: string;
  kind: string;
  message: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const integer = (x: unknown, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(x) && Number(x) >= 0 && Number(x) <= max;
const number = (x: unknown, min: number, max: number) =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
export function validateCommand(x: unknown): asserts x is CommandInput {
  if (
    !object(x) ||
    typeof x.device_id !== "string" ||
    !uuid.test(x.device_id) ||
    !ACTUATORS.includes(x.actuator as Actuator) ||
    !["auto", "manual"].includes(String(x.mode)) ||
    typeof x.on !== "boolean" ||
    !integer(x.duration_ms, 300000)
  )
    throw new Error("Invalid command");
  if (
    x.mode === "manual" &&
    x.on &&
    ![30000, 60000, 300000].includes(Number(x.duration_ms))
  )
    throw new Error("Choose a supported activation duration");
  if ((x.mode === "auto" || !x.on) && x.duration_ms !== 0)
    throw new Error("Duration must be zero for Auto or OFF");
  if (x.mode === "auto" && x.on)
    throw new Error("Auto does not specify an ON state");
}
export function validateTelemetry(x: unknown): asserts x is Telemetry {
  if (
    !object(x) ||
    typeof x.device_id !== "string" ||
    !uuid.test(x.device_id) ||
    typeof x.session_id !== "string" ||
    !/^[a-zA-Z0-9-]{8,64}$/.test(x.session_id) ||
    !integer(x.sample_seq, 4294967295) ||
    !integer(x.uptime_ms, 4294967295) ||
    !object(x.sensors) ||
    !object(x.actuators) ||
    !Array.isArray(x.acks) ||
    x.acks.length > 3
  )
    throw new Error("Invalid telemetry envelope");
  const s = x.sensors;
  if (
    !integer(s.soil_raw, 1023) ||
    !integer(s.water_raw, 1023) ||
    !number(s.soil_percent, 0, 100) ||
    !number(s.water_percent, 0, 100) ||
    typeof s.dht_valid !== "boolean"
  )
    throw new Error("Invalid analog readings");
  if (
    s.dht_valid
      ? !number(s.temperature_c, -40, 80) || !number(s.humidity_percent, 0, 100)
      : s.temperature_c !== null || s.humidity_percent !== null
  )
    throw new Error("Invalid DHT readings");
  for (const a of ACTUATORS) {
    const o = x.actuators[a];
    if (
      !object(o) ||
      !["auto", "manual"].includes(String(o.mode)) ||
      typeof o.on !== "boolean" ||
      !integer(o.remaining_ms, 300000) ||
      !(
        o.blocked === null ||
        (typeof o.blocked === "string" && o.blocked.length <= 120)
      )
    )
      throw new Error("Invalid output state");
  }
  for (const ack of x.acks)
    if (
      !object(ack) ||
      typeof ack.id !== "string" ||
      !uuid.test(ack.id) ||
      !["applied", "rejected"].includes(String(ack.status)) ||
      !(
        ack.reason === null ||
        (typeof ack.reason === "string" && ack.reason.length <= 120)
      )
    )
      throw new Error("Invalid acknowledgement");
}
export function isFresh(snapshot: Snapshot | null, now = Date.now()) {
  return (
    !!snapshot &&
    now - Date.parse(snapshot.received_at) < 30000 &&
    now >= Date.parse(snapshot.received_at) - 5000
  );
}
