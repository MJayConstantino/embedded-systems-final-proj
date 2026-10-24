import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  isFresh,
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
  validateTelemetry(packet);
  return {
    ...packet,
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
        !["/api/connection", "/api/control"].includes(path)
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
      if (!address || !isFresh(last))
        return reply(
          {
            error:
              "Arduino readings are unavailable or stale. Reconnect before sending a control.",
          },
          409,
        );
      if (connecting || controlBusy)
        return reply(
          { error: "Another control is in progress. Try again." },
          409,
        );
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
