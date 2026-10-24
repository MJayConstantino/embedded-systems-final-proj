import {
  ACTUATORS,
  type Snapshot,
  type HistoryRow,
  type EventRow,
} from "./domain";
export function demoData() {
  const now = Date.now();
  const snapshot: Snapshot = {
    device_id: "00000000-0000-4000-8000-000000000001",
    session_id: "demo-session",
    sample_seq: 600,
    uptime_ms: 86400000,
    sample_age_ms: 0,
    simulated: true,
    sensors: {
      soil_raw: 500,
      water_raw: 518,
      soil_percent: 60,
      water_percent: 74,
      temperature_c: 28.4,
      humidity_percent: 58,
      dht_valid: true,
    },
    actuators: Object.fromEntries(
      ACTUATORS.map((a) => [
        a,
        { mode: "auto", on: a === "fan", remaining_ms: 0, blocked: null },
      ]),
    ) as Snapshot["actuators"],
    received_at: new Date(now).toISOString(),
  };
  const history: HistoryRow[] = Array.from({ length: 1440 }, (_, i) => ({
    recorded_at: new Date(now - (1439 - i) * 60000).toISOString(),
    sensors: {
      ...snapshot.sensors,
      soil_percent: Math.round(55 + 7 * Math.sin(i / 145)),
      water_percent: Math.round(82 - i / 175),
      temperature_c: +(27 + 2.5 * Math.sin(i / 210)).toFixed(1),
      humidity_percent: Math.round(58 + 8 * Math.cos(i / 175)),
    },
  }));
  const events: EventRow[] = [
    {
      id: 1,
      created_at: new Date(now - 240000).toISOString(),
      kind: "automatic",
      message: "Fan turned on · automatic temperature control",
    },
    {
      id: 2,
      created_at: new Date(now - 1800000).toISOString(),
      kind: "applied",
      message: "Pump · timed manual activation completed",
    },
    {
      id: 3,
      created_at: new Date(now - 3600000).toISOString(),
      kind: "connected",
      message: "Device connected · all readings available",
    },
  ];
  return { snapshot, history, events };
}
