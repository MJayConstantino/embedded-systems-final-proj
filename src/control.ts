// Executable device model used ONLY by the separate simulator and tests.
import {
  ACTUATORS,
  type Actuator,
  type Command,
  type Output,
  type Sensors,
} from "./domain";
export class DeviceModel {
  outputs = Object.fromEntries(
    ACTUATORS.map((a) => [
      a,
      { mode: "auto", on: false, remaining_ms: 0, blocked: null },
    ]),
  ) as Record<Actuator, Output>;
  private deadlines: Partial<Record<Actuator, number>> = {};
  private receipts = new Map<
    string,
    { id: string; status: "applied" | "rejected"; reason: string | null }
  >();
  constructor(public sessionId: string) {}
  safety(a: Actuator, s: Sensors, starting = false): string | null {
    if (a === "fan" && !s.dht_valid) return "DHT11 reading failed";
    if (a === "pump" && s.water_percent < (starting ? 25 : 16))
      return "Reservoir too low";
    return null;
  }
  apply(c: Command, s: Sensors, now: number) {
    const duplicate = this.receipts.get(c.id);
    if (duplicate) return duplicate;
    let reason =
      c.session_id !== this.sessionId ? "Board session changed" : null;
    if (!reason) {
      this.outputs[c.actuator] = {
        mode: c.mode,
        on: c.mode === "manual" && c.on,
        remaining_ms: c.duration_ms,
        blocked: null,
      };
      delete this.deadlines[c.actuator];
      if (c.mode === "manual" && c.on)
        this.deadlines[c.actuator] = now + c.duration_ms;
      this.tick(s, now);
    }
    const receipt = {
      id: c.id,
      status: reason ? ("rejected" as const) : ("applied" as const),
      reason,
    };
    this.receipts.set(c.id, receipt);
    return receipt;
  }
  tick(s: Sensors, now: number) {
    for (const a of ACTUATORS) {
      const o = this.outputs[a];
      const deadline = this.deadlines[a];
      if (deadline !== undefined && now >= deadline) {
        o.mode = "auto";
        o.on = false;
        delete this.deadlines[a];
      }
      o.remaining_ms =
        this.deadlines[a] === undefined
          ? 0
          : Math.max(0, this.deadlines[a]! - now);
      if (o.mode === "manual") {
        o.blocked = null;
        continue;
      }
      const blocked = this.safety(a, s, !o.on);
      o.blocked = blocked;
      if (blocked) {
        o.on = false;
        continue;
      }
      if (a === "fan") {
        if (s.temperature_c! >= 30) o.on = true;
        else if (s.temperature_c! <= 28) o.on = false;
      }
      if (a === "pump") {
        if (!o.on && s.soil_percent <= 30 && s.water_percent >= 25) o.on = true;
        else if (o.on && (s.soil_percent >= 45 || s.water_percent <= 15))
          o.on = false;
      }
    }
  }
}
