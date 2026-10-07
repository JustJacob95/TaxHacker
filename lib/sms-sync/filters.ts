import { createHash } from "crypto"
import { IncomingSms } from "./types"

// Phone numbers arrive as "+1 (555) 123-45", "15551234" etc.; alphanumeric sender IDs as "MyBank".
// Lowercase and drop everything except letters and digits so both forms compare reliably.
export function normalizeSender(sender: string): string {
  return sender.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
}

export function senderMatches(from: string, allowedSenders: string[]): boolean {
  const allowed = allowedSenders.map(normalizeSender).filter(Boolean)
  if (allowed.length === 0) return true
  return allowed.includes(normalizeSender(from))
}

export function parseSenderList(raw: string): string[] {
  return raw
    .split(/[\n,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function pickString(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === "string" && value.trim()) return value
    if (typeof value === "number") return String(value)
  }
  return undefined
}

function parseTimestamp(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const n = Number(value)
    // Forwarder apps send unix time in milliseconds; accept seconds too.
    const date = new Date(n < 1e12 ? n * 1000 : n)
    return isNaN(date.getTime()) ? undefined : date
  }
  if (typeof value === "string") {
    const date = new Date(value)
    return isNaN(date.getTime()) ? undefined : date
  }
  return undefined
}

/**
 * Accepts the JSON payloads of common Android SMS forwarders, e.g. "Incoming SMS to URL forwarder"
 * ({ from, text, sentStamp, receivedStamp, sim }) as well as generic { sender, message, timestamp }.
 */
export function normalizeSmsPayload(body: unknown, now: Date = new Date()): IncomingSms | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const record = body as Record<string, unknown>

  const from = pickString(record, ["from", "sender", "phoneNumber", "phone", "address"])
  const text = pickString(record, ["text", "message", "body", "content", "msg"])
  if (!from || !text) return null

  const receivedAt =
    parseTimestamp(record.receivedStamp) ??
    parseTimestamp(record.receivedAt) ??
    parseTimestamp(record.timestamp) ??
    parseTimestamp(record.sentStamp) ??
    parseTimestamp(record.date) ??
    now

  return { from: from.trim(), text: text.trim(), receivedAt }
}

// Stable id for a message so retries from the forwarder app don't create duplicate transactions.
export function smsFingerprint(sms: IncomingSms): string {
  return createHash("sha256")
    .update(`${normalizeSender(sms.from)}\n${sms.text}\n${sms.receivedAt.toISOString()}`)
    .digest("hex")
}
