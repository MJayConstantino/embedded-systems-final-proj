import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  isOnline,
  validateDeviceStatus,
  validateWiFi,
  type Sensors,
  validateCommand,
  validateTelemetry,
  type Snapshot,
  type CommandRow,
} from "../src/domain.ts";
type Next = () => void;
export function normalizeAddress(value: unknown) {
  if (typeof value !== "string")
    throw new Error("Enter the Arduino IP address");
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `http://${value}`);
  } catch {
    throw new Error("Enter an address such as 192.168.4.1");
  }
  const parts = url.hostname.split(".").map(Number);
  const local =
    parts.length === 4 &&
    parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 169 && parts[1] === 254));
  if (
    url.protocol !== "http:" ||
    !local ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use the local IPv4 address printed in Arduino Serial Monitor",
    );
  return url.origin;
}
async function readJson(response: Response) {
  const text = await response.text();
  if (text.length > 8000) throw new Error("Device response is too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The device did not return valid readings");
  }
}
function snapshot(packet: unknown): Snapshot {
  validateDeviceStatus(packet);
  let readings_valid = packet.sample_seq > 0;
  let sensors: Sensors;
  try {
    validateTelemetry(packet);
    sensors = packet.sensors;
  } catch {
    readings_valid = false;
    // Internal placeholders are never displayed or added to history as readings.
    sensors = {
      soil_raw: 0,
      water_raw: 0,
      soil_percent: 0,
      water_percent: 0,
      temperature_c: null,
      humidity_percent: null,
      dht_valid: false,
    };
  }
  return {
    ...packet,
    sensors,
    readings_valid,
    contacted_at: new Date().toISOString(),
    received_at: new Date(Date.now() - packet.sample_age_ms).toISOString(),
  };
}
export function createBridge(initialAddress?: string) {
  let address = initialAddress ? normalizeAddress(initialAddress) : null;
  let last: Snapshot | null = null,
    controlBusy = false,
    connecting = false;
  const deviceFetch = async (target: string, path: string, body?: unknown) => {
    const response = await fetch(target + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(2200),
    });
    const data = await readJson(response);
    if (!response.ok)
      throw new Error(data.error ?? "Arduino rejected the request");
    return data;
  };
  return async function middleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next,
  ) {
    if (!req.url?.startsWith("/api/")) return next();
    const reply = (data: unknown, status = 200) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const path = req.url.split("?")[0];
      if (req.method === "GET" && path === "/api/connection")
        return reply({ address });
      if (req.method === "GET" && path === "/api/status") {
        if (!address)
          return reply(
            { error: "Connect your Arduino in Settings to start the demo." },
            503,
          );
        const target = address;
        const reading = snapshot(await deviceFetch(target, "/api/status"));
        if (target !== address)
          return reply(
            { error: "Device connection changed; refresh readings" },
            409,
          );
        last = reading;
        return reply(last);
      }
      if (
        req.method !== "POST" ||
        ![
          "/api/connection",
          "/api/control",
          "/api/wifi",
          "/api/display",
        ].includes(path)
      )
        return reply({ error: "Unknown local API route" }, 404);
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return reply({ error: "JSON required" }, 415);
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        return reply(
          { error: "Use the local dashboard to send controls" },
          403,
        );
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2048)
          return reply({ error: "Request too large" }, 413);
      }
      let input: unknown;
      try {
        input = JSON.parse(body);
      } catch {
        return reply({ error: "Invalid JSON" }, 400);
      }
      if (path === "/api/connection") {
        if (connecting || controlBusy)
          return reply(
            { error: "Another request is in progress. Try again." },
            409,
          );
        connecting = true;
        try {
          const target = normalizeAddress(
            (input as { address?: unknown })?.address,
          );
          const reading = snapshot(await deviceFetch(target, "/api/status"));
          address = target;
          last = reading;
          return reply({ address, snapshot: last });
        } finally {
          connecting = false;
        }
      }
      if (!address || !isOnline(last))
        return reply(
          {
            error:
              "Arduino connection is unavailable or stale. Reconnect before sending a control.",
          },
          409,
        );
      if (connecting || controlBusy)
        return reply(
          { error: "Another control is in progress. Try again." },
          409,
        );
      if (path === "/api/display") {
        if (
          !input ||
          typeof input !== "object" ||
          typeof (input as { enabled?: unknown }).enabled !== "boolean"
        )
          return reply({ error: "OLED enabled must be true or false" }, 400);
        const enabled = (input as { enabled: boolean }).enabled;
        controlBusy = true;
        try {
          const result = await deviceFetch(address, "/api/display", {
            enabled,
            session_id: last!.session_id,
          });
          const updated = snapshot(result.telemetry);
          if (!updated.display?.ready || updated.display.enabled !== enabled)
            throw new Error("Arduino did not confirm the OLED state");
          last = updated;
          return reply({ snapshot: last });
        } finally {
          controlBusy = false;
        }
      }
      if (path === "/api/wifi") {
        try {
          validateWiFi(input);
        } catch (error) {
          return reply(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Invalid Wi-Fi settings",
            },
            400,
          );
        }
        controlBusy = true;
        try {
          const result = await deviceFetch(address, "/api/wifi", {
            ...input,
            session_id: last!.session_id,
          });
          if (result.accepted !== true)
            throw new Error("Arduino did not accept the Wi-Fi settings");
          address = null;
          last = null;
          return reply({
            accepted: true,
            message:
              "Wi-Fi saved on the Arduino. Rejoin that network and enter its new IP from Serial Monitor.",
          });
        } finally {
          controlBusy = false;
        }
      }
      validateCommand(input);
      if (input.session_id !== last!.session_id)
        return reply(
          { error: "Arduino restarted. Refresh before sending a control." },
          409,
        );
      controlBusy = true;
      try {
        const id = randomUUID();
        const result = await deviceFetch(address, "/api/control", {
          ...input,
          id,
        });
        if (
          result.id !== id ||
          !["applied", "rejected"].includes(result.status) ||
          !(result.reason === null || typeof result.reason === "string")
        )
          throw new Error("Invalid Arduino control acknowledgement");
        last = snapshot(result.telemetry);
        const command: CommandRow = {
          ...input,
          id,
          status: result.status,
          reason: result.reason,
          created_at: new Date().toISOString(),
        };
        return reply({ command, snapshot: last });
      } finally {
        controlBusy = false;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Arduino connection failed";
      reply(
        {
          error: /timeout|fetch failed|aborted/i.test(message)
            ? "Cannot reach the Arduino. Check its IP and the local Wi-Fi connection. No command was queued."
            : message,
        },
        502,
      );
    }
  };
}
