import { LLMResponse, LLMSettings, requestLLM } from "@/ai/providers/llmProvider"
import { prisma } from "@/lib/db"
import { getCategories } from "@/models/categories"
import { getProjects } from "@/models/projects"
import { getLLMSettings, getSettings } from "@/models/settings"
import { createTransaction, TransactionData } from "@/models/transactions"
import { Prisma, Transaction, User } from "@/prisma/client"
import { randomUUID } from "crypto"
import { senderMatches, smsFingerprint } from "./filters"
import { buildSmsPrompt, SMS_TRANSACTION_SCHEMA, SmsParseOutcome, smsOutputToTransaction } from "./parse"
import { IncomingSms, MAX_LOG_ENTRIES, SmsAppData, SmsLogEntry } from "./types"

export const SMS_APP = "sms"

export const getDefaultSmsAppData = (): SmsAppData => ({
  isActive: true,
  allowedSenders: [],
  messages: [],
})

type ProcessDeps = {
  llm?: (settings: LLMSettings, req: { prompt: string; schema: Record<string, unknown> }) => Promise<LLMResponse>
  create?: (userId: string, data: TransactionData) => Promise<Transaction>
}

// Statuses that mean "this exact SMS was already handled" — an errored one may be retried.
const FINAL_STATUSES = new Set<SmsLogEntry["status"]>(["created", "skipped", "filtered"])

export function isDuplicateSms(appData: SmsAppData, fingerprint: string): boolean {
  return appData.messages.some((m) => m.fingerprint === fingerprint && FINAL_STATUSES.has(m.status))
}

export async function processSms(
  user: User,
  appData: SmsAppData,
  sms: IncomingSms,
  deps: ProcessDeps = {}
): Promise<SmsLogEntry> {
  const llm = deps.llm ?? requestLLM
  const create = deps.create ?? createTransaction

  const fingerprint = smsFingerprint(sms)
  const entry: SmsLogEntry = {
    id: randomUUID(),
    fingerprint,
    from: sms.from,
    text: sms.text,
    receivedAt: sms.receivedAt.toISOString(),
    processedAt: new Date().toISOString(),
    status: "error",
  }

  if (isDuplicateSms(appData, fingerprint)) {
    return { ...entry, status: "duplicate" }
  }

  if (!senderMatches(sms.from, appData.allowedSenders)) {
    // Don't keep the text of messages the user didn't ask us to monitor.
    return { ...entry, text: "", status: "filtered" }
  }

  try {
    const outcome = await analyzeSms(user, sms, llm)
    if (outcome.kind === "error") {
      return { ...entry, error: outcome.error }
    }
    if (outcome.kind === "skipped") {
      return { ...entry, status: "skipped", error: outcome.reason }
    }

    const transaction = await create(user.id, outcome.data)
    return { ...entry, status: "created", transactionId: transaction.id }
  } catch (error) {
    return { ...entry, error: error instanceof Error ? error.message : String(error) }
  }
}

// Ask the LLM to parse one SMS. Used by the webhook and by the "Test" form in the app UI (dry run).
export async function analyzeSms(
  user: User,
  sms: IncomingSms,
  llm: NonNullable<ProcessDeps["llm"]> = requestLLM
): Promise<SmsParseOutcome | { kind: "error"; error: string }> {
  const [settings, categories, projects] = await Promise.all([
    getSettings(user.id),
    getCategories(user.id),
    getProjects(user.id),
  ])
  const prompt = buildSmsPrompt(sms, categories, projects, settings.default_currency || "EUR")

  const response = await llm(getLLMSettings(settings), { prompt, schema: SMS_TRANSACTION_SCHEMA })
  if (response.error) {
    return { kind: "error", error: response.error }
  }
  return smsOutputToTransaction(response.output, sms, { settings, categories, projects })
}

export async function findSmsAppByTokenHash(tokenHash: string) {
  return prisma.appData.findFirst({
    where: { app: SMS_APP, data: { path: ["tokenHash"], equals: tokenHash } },
    include: { user: true },
  })
}

// Read-modify-write the app data under a row lock: several SMS can arrive at once, and the
// settings page may be saving at the same time — an unlocked update would drop log entries.
export async function mutateSmsAppData(userId: string, mutate: (data: SmsAppData) => void) {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ data: Partial<SmsAppData> }[]>`
      SELECT data FROM app_data WHERE user_id = ${userId}::uuid AND app = ${SMS_APP} FOR UPDATE
    `
    const data: SmsAppData = { ...getDefaultSmsAppData(), ...(locked[0]?.data ?? {}) }
    mutate(data)
    const json = data as unknown as Prisma.InputJsonValue
    if (locked.length) {
      await tx.appData.update({ where: { userId_app: { userId, app: SMS_APP } }, data: { data: json } })
    } else {
      await tx.appData.create({ data: { userId, app: SMS_APP, data: json } })
    }
  })
}

export async function appendSmsLog(userId: string, entry: SmsLogEntry) {
  await mutateSmsAppData(userId, (data) => {
    data.messages = [entry, ...data.messages].slice(0, MAX_LOG_ENTRIES)
  })
}
