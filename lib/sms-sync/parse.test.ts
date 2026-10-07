import { Category, Project } from "@/prisma/client"
import { describe, expect, it } from "vitest"
import { buildSmsPrompt, smsOutputToTransaction } from "./parse"

const sms = {
  from: "MyBank",
  text: "Card *1234: purchase 12.50 EUR, COFFEE SHOP. Balance 1034.20 EUR",
  receivedAt: new Date("2026-10-07T21:30:00.000Z"),
}
const categories = [
  { code: "food", llm_prompt: "food, drinks" },
  { code: "other", llm_prompt: "other" },
] as Category[]
const projects = [{ code: "personal", llm_prompt: "personal" }] as Project[]
const settings = {
  default_currency: "EUR",
  default_category: "other",
  default_project: "personal",
  default_type: "expense",
}
const context = { settings, categories, projects }

const output = {
  is_transaction: true,
  type: "expense",
  total: 12.5,
  currencyCode: "eur",
  merchant: "COFFEE SHOP",
  name: "Coffee",
  description: "Card payment",
  issuedAt: "2026-10-06",
  categoryCode: "food",
  projectCode: "personal",
}

describe("buildSmsPrompt", () => {
  it("includes the SMS, categories, projects and the default currency", () => {
    const prompt = buildSmsPrompt(sms, categories, projects, "EUR")
    expect(prompt).toContain(sms.text)
    expect(prompt).toContain("Sender: MyBank")
    expect(prompt).toContain("- food: for food, drinks")
    expect(prompt).toContain("- personal: for personal")
    expect(prompt).toContain("use EUR")
  })
})

describe("smsOutputToTransaction", () => {
  it("maps LLM output to transaction data in cents", () => {
    const result = smsOutputToTransaction(output, sms, context)
    expect(result).toEqual({
      kind: "transaction",
      data: {
        name: "Coffee",
        description: "Card payment",
        merchant: "COFFEE SHOP",
        total: 1250,
        currencyCode: "EUR",
        type: "expense",
        issuedAt: new Date("2026-10-06T00:00:00.000Z"),
        categoryCode: "food",
        projectCode: "personal",
        text: sms.text,
        note: "Imported from SMS (MyBank)",
      },
    })
  })

  it("skips non-transactions and messages without an amount", () => {
    expect(smsOutputToTransaction({ ...output, is_transaction: false }, sms, context)).toEqual({
      kind: "skipped",
      reason: "Not a transaction",
    })
    expect(smsOutputToTransaction({ ...output, total: 0 }, sms, context).kind).toBe("skipped")
    expect(smsOutputToTransaction({ ...output, total: "n/a" }, sms, context).kind).toBe("skipped")
  })

  it("normalizes amounts given as strings or negatives", () => {
    const fromString = smsOutputToTransaction({ ...output, total: "1034,5" }, sms, context)
    expect(fromString.kind === "transaction" && fromString.data.total).toBe(103450)
    const negative = smsOutputToTransaction({ ...output, total: -12.5 }, sms, context)
    expect(negative.kind === "transaction" && negative.data.total).toBe(1250)
  })

  it("falls back to defaults for unknown codes, currency, type and date", () => {
    const result = smsOutputToTransaction(
      {
        ...output,
        categoryCode: "made-up",
        projectCode: "",
        currencyCode: "€",
        type: "transfer",
        issuedAt: "",
        merchant: "",
        name: "",
      },
      sms,
      context
    )
    expect(result.kind).toBe("transaction")
    if (result.kind !== "transaction") return
    expect(result.data.categoryCode).toBe("other")
    expect(result.data.projectCode).toBe("personal")
    expect(result.data.currencyCode).toBe("EUR")
    expect(result.data.type).toBe("expense")
    expect(result.data.issuedAt).toEqual(new Date("2026-10-07T00:00:00.000Z"))
    expect(result.data.name).toBe("SMS from MyBank")
    expect(result.data.merchant).toBeNull()
  })
})
