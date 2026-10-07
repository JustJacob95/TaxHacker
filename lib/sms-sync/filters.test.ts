import { describe, expect, it } from "vitest"
import { normalizeSmsPayload, parseSenderList, senderMatches, smsFingerprint } from "./filters"

describe("senderMatches", () => {
  it("accepts everything when no senders are configured", () => {
    expect(senderMatches("Anyone", [])).toBe(true)
    expect(senderMatches("Anyone", ["  ", ""])).toBe(true)
  })

  it("compares names case-insensitively and phone numbers ignoring formatting", () => {
    expect(senderMatches("MYBANK", ["MyBank"])).toBe(true)
    expect(senderMatches("+1 (555) 123-4567", ["15551234567"])).toBe(true)
    expect(senderMatches("Тинькофф", ["тинькофф"])).toBe(true)
    expect(senderMatches("OtherBank", ["MyBank"])).toBe(false)
  })

  it("parses a sender list from lines, commas and semicolons", () => {
    expect(parseSenderList("MyBank\n +1 555, Other ;\n\n")).toEqual(["MyBank", "+1 555", "Other"])
  })
})

describe("normalizeSmsPayload", () => {
  const now = new Date("2026-10-07T10:00:00.000Z")

  it("reads the SMS to URL Forwarder payload", () => {
    const sms = normalizeSmsPayload(
      { from: "MyBank", text: "Purchase 10 EUR", sentStamp: 1791280000000, receivedStamp: 1791280001000, sim: "sim1" },
      now
    )
    expect(sms).toEqual({ from: "MyBank", text: "Purchase 10 EUR", receivedAt: new Date(1791280001000) })
  })

  it("reads generic field names, ISO dates and unix seconds", () => {
    expect(
      normalizeSmsPayload({ sender: "Bank", message: "hi", timestamp: "2026-10-01T12:00:00Z" }, now)?.receivedAt
    ).toEqual(new Date("2026-10-01T12:00:00Z"))
    expect(normalizeSmsPayload({ sender: "Bank", message: "hi", timestamp: 1791280000 }, now)?.receivedAt).toEqual(
      new Date(1791280000 * 1000)
    )
  })

  it("falls back to now for missing or invalid timestamps", () => {
    expect(normalizeSmsPayload({ from: "Bank", text: "hi" }, now)?.receivedAt).toEqual(now)
    expect(normalizeSmsPayload({ from: "Bank", text: "hi", receivedStamp: "garbage" }, now)?.receivedAt).toEqual(now)
  })

  it("rejects payloads without sender or text", () => {
    expect(normalizeSmsPayload(null)).toBeNull()
    expect(normalizeSmsPayload([])).toBeNull()
    expect(normalizeSmsPayload({ from: "Bank" })).toBeNull()
    expect(normalizeSmsPayload({ text: "hi" })).toBeNull()
    expect(normalizeSmsPayload({ from: "Bank", text: "   " })).toBeNull()
  })
})

describe("smsFingerprint", () => {
  it("is stable for the same message and differs otherwise", () => {
    const receivedAt = new Date("2026-10-07T10:00:00.000Z")
    const a = smsFingerprint({ from: "MyBank", text: "Purchase", receivedAt })
    expect(smsFingerprint({ from: "MYBANK", text: "Purchase", receivedAt })).toBe(a)
    expect(smsFingerprint({ from: "MyBank", text: "Purchase", receivedAt: new Date(0) })).not.toBe(a)
    expect(smsFingerprint({ from: "MyBank", text: "Refund", receivedAt })).not.toBe(a)
  })
})
