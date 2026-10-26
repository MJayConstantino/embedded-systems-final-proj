import type { CommandInput, ControlResult, Snapshot } from "./domain";
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Arduino connection failed");
  return data;
}
export const loadCurrent = () => request<Snapshot>("status");
export const sendCommand = (input: CommandInput) =>
  request<ControlResult>("control", input);
export const loadConnection = () =>
  request<{ address: string | null }>("connection");
export const connectDevice = (address: string) =>
  request<{ address: string; snapshot: Snapshot }>("connection", { address });

export const configureWiFi = (input: { ssid: string; password: string }) =>
  request<{ accepted: boolean; message: string }>("wifi", input);

export const setDisplay = (enabled: boolean) =>
  request<{ snapshot: Snapshot }>("display", { enabled });
