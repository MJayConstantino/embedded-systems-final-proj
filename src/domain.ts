export const ACTUATORS = ["pump", "fan"] as const;
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
export type DisplayStatus = {
  ready: boolean;
  enabled: boolean;
  address: number | null;
};
export type Telemetry = {
  display?: DisplayStatus;
  device_id: string;
  session_id: string;
  sample_seq: number;
  uptime_ms: number;
  sample_age_ms: number;
  sensors: Sensors;
  actuators: Record<Actuator, Output>;
  simulated?: boolean;
};
export type Snapshot = Telemetry & {
  received_at: string;
  contacted_at?: string;
  readings_valid?: boolean;
};
export type DeviceStatus = Omit<Telemetry, "sensors"> & { sensors?: unknown };
export type WiFiInput = { ssid: string; password: string };
export function validateWiFi(x: unknown): asserts x is WiFiInput {
  if (
    !object(x) ||
    typeof x.ssid !== "string" ||
    !x.ssid.trim() ||
    new TextEncoder().encode(x.ssid).length > 32 ||
    x.ssid.includes("\0") ||
    typeof x.password !== "string" ||
    x.password.includes("\0") ||
    (x.password.length !== 0 &&
      (new TextEncoder().encode(x.password).length < 8 ||
        new TextEncoder().encode(x.password).length > 63))
  )
    throw new Error(
      "Use an SSID of 1–32 bytes and an 8–63 byte password, or leave the password empty for an open network",
    );
}
export type CommandInput = {
  session_id: string;
  actuator: Actuator;
  mode: Mode;
  on: boolean;
  duration_ms: number;
};
export type Command = CommandInput & { id: string };
export type CommandRow = Command & {
  status: "applied" | "rejected";
  reason: string | null;
  created_at: string;
};
export type ControlResult = { command: CommandRow; snapshot: Snapshot };
export type HistoryRow = { recorded_at: string; sensors: Sensors };
export type EventRow = {
  id: number;
  created_at: string;
  kind: string;
  message: string;
};
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const integer = (x: unknown, max = 4294967295) =>
  Number.isSafeInteger(x) && Number(x) >= 0 && Number(x) <= max;
const number = (x: unknown, min: number, max: number) =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
export function validateCommand(x: unknown): asserts x is CommandInput {
  if (
    !object(x) ||
    typeof x.session_id !== "string" ||
    !/^[a-zA-Z0-9-]{8,64}$/.test(x.session_id) ||
    !ACTUATORS.includes(x.actuator as Actuator) ||
    !["auto", "manual"].includes(String(x.mode)) ||
    typeof x.on !== "boolean" ||
    !integer(x.duration_ms, 300000)
  )
    throw new Error("Invalid control request");
  if (
    x.mode === "manual" &&
    x.on &&
    ![30000, 60000, 300000].includes(Number(x.duration_ms))
  )
    throw new Error("Choose 30 seconds, 1 minute, or 5 minutes");
  if ((x.mode === "auto" || !x.on) && x.duration_ms !== 0)
    throw new Error("Auto and OFF require zero duration");
  if (x.mode === "auto" && x.on)
    throw new Error("Auto does not specify an ON state");
}
export function validateDeviceStatus(x: unknown): asserts x is DeviceStatus {
  if (
    !object(x) ||
    typeof x.device_id !== "string" ||
    typeof x.session_id !== "string" ||
    !/^[a-zA-Z0-9-]{8,64}$/.test(x.session_id) ||
    !integer(x.sample_seq) ||
    !integer(x.uptime_ms) ||
    !integer(x.sample_age_ms) ||
    !object(x.actuators)
  )
    throw new Error("Invalid device status");
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
      throw new Error("Invalid actuator state");
  }
  if (
    x.display !== undefined &&
    (!object(x.display) ||
      typeof x.display.ready !== "boolean" ||
      typeof x.display.enabled !== "boolean" ||
      ![null, 60, 61].includes(x.display.address as number | null))
  )
    throw new Error("Invalid OLED status");
  if (x.simulated !== undefined && typeof x.simulated !== "boolean")
    throw new Error("Invalid device type");
}
export function validateTelemetry(x: unknown): asserts x is Telemetry {
  validateDeviceStatus(x);
  const s = x.sensors;
  if (
    !object(s) ||
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
    throw new Error("Invalid DHT11 readings");
}
export function isOnline(snapshot: Snapshot | null, now = Date.now()) {
  const time = Date.parse(
    snapshot?.contacted_at ?? snapshot?.received_at ?? "",
  );
  return !!snapshot && now - time < 10000 && now >= time - 5000;
}
export function isFresh(snapshot: Snapshot | null, now = Date.now()) {
  return (
    !!snapshot &&
    snapshot.readings_valid !== false &&
    snapshot.sample_seq > 0 &&
    now - Date.parse(snapshot.received_at) < 10000 &&
    now >= Date.parse(snapshot.received_at) - 5000
  );
}
