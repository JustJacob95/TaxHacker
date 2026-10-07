import { describe, expect, it, vi } from "vitest"

// --- import-time mocks so importing ./ingest doesn't run config Zod validation or create a Prisma client ---
vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/ai/providers/llmProvider", () => ({ requestLLM: vi.fn() }))
vi.mock("@/models/transactions", () => ({ createTransaction: vi.fn() }))
vi.mock("@/models/categories", () => ({ getCategories: vi.fn(async () => [{ code: "food" }, { code: "other" }]) }))
vi.mock("@/models/projects", () => ({ getProjects: vi.fn(async () => [{ code: "personal" }]) }))
vi.mock("@/models/settings", () => ({
  getSettings: vi.fn(async () => ({ default_currency: "EUR", default_category: "other", default_project: "personal" })),
  getLLMSettings: vi.fn(() => ({ providers: [] })),
}))

const { processSms, getDefaultSmsAppData } = await import("./ingest")
const { smsFingerprint } = await import("./filters")
import { Transaction, User } from "@/prisma/client"
import { SmsAppData } from "./types"

const user = { id: "user-1" } as User
const sms = {
  from: "MyBank",
  text: "Purchase 12.50 EUR at COFFEE SHOP",
  receivedAt: new Date("2026-10-07T10:00:00.000Z"),
}
const llmOutput = {
  is_transaction: true,
  type: "expense",
  total: 12.5,
  currencyCode: "EUR",
  merchant: "COFFEE SHOP",
  name: "Coffee",
  description: "",
  issuedAt: "2026-10-07",
  categoryCode: "food",
  projectCode: "personal",
}

function appData(overrides: Partial<SmsAppData> = {}): SmsAppData {
  return { ...getDefaultSmsAppData(), ...overrides }
}

function deps(output: Record<string, unknown> = llmOutput, error?: string) {
  const llm = vi.fn(async () => ({ output: output as Record<string, string>, provider: "openai" as const, error }))
  const create = vi.fn(async () => ({ id: "tx-1" }) as Transaction)
  return { llm, create }
}

describe("processSms", () => {
  it("creates a transaction from a bank SMS", async () => {
    const d = deps()
    const entry = await processSms(user, appData(), sms, d)
    expect(entry.status).toBe("created")
    expect(entry.transactionId).toBe("tx-1")
    expect(entry.fingerprint).toBe(smsFingerprint(sms))
    expect(d.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ total: 1250, merchant: "COFFEE SHOP", categoryCode: "food" })
    )
    expect(d.llm.mock.calls[0][1].prompt).toContain(sms.text)
  })

  it("filters senders that are not allowed, without calling the LLM or keeping the text", async () => {
    const d = deps()
    const entry = await processSms(user, appData({ allowedSenders: ["OtherBank"] }), sms, d)
    expect(entry.status).toBe("filtered")
    expect(entry.text).toBe("")
    expect(d.llm).not.toHaveBeenCalled()
  })

  it("ignores an SMS that was already processed", async () => {
    const d = deps()
    const fingerprint = smsFingerprint(sms)
    const previous = {
      id: "1",
      fingerprint,
      from: "MyBank",
      text: "",
      receivedAt: "",
      processedAt: "",
      status: "created" as const,
    }
    const entry = await processSms(user, appData({ messages: [previous] }), sms, d)
    expect(entry.status).toBe("duplicate")
    expect(d.llm).not.toHaveBeenCalled()
  })

  it("retries an SMS whose previous attempt failed", async () => {
    const d = deps()
    const previous = {
      id: "1",
      fingerprint: smsFingerprint(sms),
      from: "MyBank",
      text: "",
      receivedAt: "",
      processedAt: "",
      status: "error" as const,
    }
    const entry = await processSms(user, appData({ messages: [previous] }), sms, d)
    expect(entry.status).toBe("created")
  })

  it("skips messages the LLM says are not transactions", async () => {
    const d = deps({ ...llmOutput, is_transaction: false })
    const entry = await processSms(user, appData(), { ...sms, text: "Your code is 1234" }, d)
    expect(entry.status).toBe("skipped")
    expect(d.create).not.toHaveBeenCalled()
  })

  it("reports LLM and database errors", async () => {
    const llmFailed = await processSms(user, appData(), sms, deps({}, "rate limited"))
    expect(llmFailed).toMatchObject({ status: "error", error: "rate limited" })

    const d = deps()
    d.create.mockRejectedValueOnce(new Error("db down"))
    const dbFailed = await processSms(user, appData(), sms, d)
    expect(dbFailed).toMatchObject({ status: "error", error: "db down" })
  })
})
