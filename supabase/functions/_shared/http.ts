export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-device-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export function json(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Content-Length": String(new TextEncoder().encode(text).length),
    },
  });
}
export async function readBody(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 12000)
    throw new Error("Request too large");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Request body required");
  const decoder = new TextDecoder();
  let body = "",
    size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 12000) {
      await reader.cancel();
      throw new Error("Request too large");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return JSON.parse(body);
}
export const hashSecret = async (token: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
