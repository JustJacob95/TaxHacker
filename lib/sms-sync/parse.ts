import { TransactionData } from "@/models/transactions"
import { SettingsMap } from "@/models/settings"
import { Category, Project } from "@/prisma/client"
import { IncomingSms } from "./types"

export const SMS_TRANSACTION_SCHEMA = {
  type: "object",
  properties: {
    is_transaction: {
      type: "boolean",
      description:
        "true only if the SMS reports a completed money movement (purchase, payment, transfer, withdrawal, refund, incoming payment). false for OTP codes, promos, balance reminders, declined or pending authorizations",
    },
    type: {
      type: "string",
      enum: ["expense", "income"],
      description: "expense for money spent/sent, income for money received/refunded",
    },
    total: { type: "number", description: "transaction amount as a positive number, without the account balance" },
    currencyCode: { type: "string", description: "ISO 4217 currency code of the amount, e.g. USD, EUR" },
    merchant: { type: "string", description: "merchant, payee or payer name as written in the SMS, empty if unknown" },
    name: { type: "string", description: "short human readable name of what was paid for or received" },
    description: { type: "string", description: "one-line description, e.g. card payment, transfer, ATM withdrawal" },
    issuedAt: { type: "string", description: "transaction date in YYYY-MM-DD format, empty if not in the SMS" },
    categoryCode: { type: "string", description: "category code from the list, empty if none fits" },
    projectCode: { type: "string", description: "project code from the list, empty if none fits" },
  },
  required: [
    "is_transaction",
    "type",
    "total",
    "currencyCode",
    "merchant",
    "name",
    "description",
    "issuedAt",
    "categoryCode",
    "projectCode",
  ],
  additionalProperties: false,
}

export function buildSmsPrompt(sms: IncomingSms, categories: Category[], projects: Project[], defaultCurrency: string) {
  const categoryLines = categories.map((c) => `- ${c.code}${c.llm_prompt ? `: for ${c.llm_prompt}` : ""}`).join("\n")
  const projectLines = projects.map((p) => `- ${p.code}${p.llm_prompt ? `: for ${p.llm_prompt}` : ""}`).join("\n")

  return `You are an accountant assistant. Below is an SMS notification from a bank or payment service.
Decide whether it reports a completed transaction and, if so, extract its details.

Sender: ${sms.from}
Received at: ${sms.receivedAt.toISOString()}
SMS text:
"""
${sms.text}
"""

Categories:
${categoryLines}

Projects:
${projectLines}

IMPORTANT RULES:
- The amount is the transaction amount, never the remaining account balance
- If the currency is not stated, use ${defaultCurrency}
- If you can't find something leave it blank, NEVER make up information
- Respond only with a JSON object with keys: ${SMS_TRANSACTION_SCHEMA.required.join(", ")}`
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

export type SmsParseOutcome = { kind: "transaction"; data: TransactionData } | { kind: "skipped"; reason: string }

export function smsOutputToTransaction(
  output: Record<string, unknown>,
  sms: IncomingSms,
  context: { settings: SettingsMap; categories: Category[]; projects: Project[] }
): SmsParseOutcome {
  const isTransaction = output.is_transaction === true || output.is_transaction === "true"
  if (!isTransaction) return { kind: "skipped", reason: "Not a transaction" }

  const amount = typeof output.total === "number" ? output.total : parseFloat(str(output.total).replace(",", "."))
  if (!Number.isFinite(amount) || amount === 0) return { kind: "skipped", reason: "No amount found" }
  const total = Math.round(Math.abs(amount) * 100) // stored in cents

  const defaultCurrency = context.settings.default_currency || "EUR"
  const rawCurrency = str(output.currencyCode).toUpperCase()
  const currencyCode = /^[A-Z]{3,5}$/.test(rawCurrency) ? rawCurrency : defaultCurrency

  const rawType = str(output.type)
  const type = rawType === "income" || rawType === "expense" ? rawType : context.settings.default_type || "expense"

  const rawDate = str(output.issuedAt)
  const issuedAt =
    /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !isNaN(Date.parse(rawDate))
      ? toUtcDate(rawDate)
      : toUtcDate(sms.receivedAt.toISOString().slice(0, 10))

  const categoryCode = context.categories.some((c) => c.code === str(output.categoryCode))
    ? str(output.categoryCode)
    : context.settings.default_category || null
  const projectCode = context.projects.some((p) => p.code === str(output.projectCode))
    ? str(output.projectCode)
    : context.settings.default_project || null

  const merchant = str(output.merchant) || null

  return {
    kind: "transaction",
    data: {
      name: str(output.name) || merchant || `SMS from ${sms.from}`,
      description: str(output.description) || null,
      merchant,
      total,
      currencyCode,
      type,
      issuedAt,
      categoryCode,
      projectCode,
      text: sms.text,
      note: `Imported from SMS (${sms.from})`,
    },
  }
}
