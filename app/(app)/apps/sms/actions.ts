"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser, isAiBalanceExhausted, isSubscriptionExpired } from "@/lib/auth"
import { parseSenderList } from "@/lib/sms-sync/filters"
import { analyzeSms, mutateSmsAppData } from "@/lib/sms-sync/ingest"
import { generateWebhookToken, hashWebhookToken } from "@/lib/sms-sync/token"
import { revalidatePath } from "next/cache"

export async function generateSmsTokenAction(): Promise<ActionState<{ token: string }>> {
  try {
    const user = await getCurrentUser()
    const token = generateWebhookToken()
    await mutateSmsAppData(user.id, (data) => {
      data.tokenHash = hashWebhookToken(token)
      data.tokenPreview = token.slice(-4)
      data.tokenCreatedAt = new Date().toISOString()
    })
    revalidatePath("/apps/sms")
    // The plaintext token is returned only here; we store just its hash.
    return { success: true, data: { token } }
  } catch (error) {
    console.error("Error generating SMS webhook token:", error)
    return { success: false, error: "Failed to generate token" }
  }
}

export async function updateSmsSettingsAction(settings: {
  isActive?: boolean
  allowedSenders?: string
}): Promise<ActionState<null>> {
  try {
    const user = await getCurrentUser()
    await mutateSmsAppData(user.id, (data) => {
      if (typeof settings.isActive === "boolean") data.isActive = settings.isActive
      if (typeof settings.allowedSenders === "string") data.allowedSenders = parseSenderList(settings.allowedSenders)
    })
    revalidatePath("/apps/sms")
    return { success: true }
  } catch (error) {
    console.error("Error updating SMS settings:", error)
    return { success: false, error: "Failed to save settings" }
  }
}

export async function clearSmsLogAction(): Promise<ActionState<null>> {
  try {
    const user = await getCurrentUser()
    await mutateSmsAppData(user.id, (data) => {
      data.messages = []
    })
    revalidatePath("/apps/sms")
    return { success: true }
  } catch (error) {
    console.error("Error clearing SMS log:", error)
    return { success: false, error: "Failed to clear log" }
  }
}

export type SmsTestResult =
  | {
      kind: "transaction"
      name: string
      merchant: string | null
      total: number
      currencyCode: string
      type: string
      issuedAt: string
      categoryCode: string | null
      projectCode: string | null
    }
  | { kind: "skipped"; reason: string }

// Dry run: parse a pasted SMS with the configured LLM without creating a transaction.
export async function testSmsParseAction(input: { from: string; text: string }): Promise<ActionState<SmsTestResult>> {
  try {
    const user = await getCurrentUser()
    if (!input.text.trim()) return { success: false, error: "Paste an SMS text first" }
    if (isAiBalanceExhausted(user) || isSubscriptionExpired(user)) {
      return { success: false, error: "AI scans are not available for this account, please check your subscription" }
    }

    const outcome = await analyzeSms(user, {
      from: input.from.trim() || "Bank",
      text: input.text.trim(),
      receivedAt: new Date(),
    })
    if (outcome.kind === "error") return { success: false, error: outcome.error }
    if (outcome.kind === "skipped") return { success: true, data: outcome }

    const d = outcome.data
    return {
      success: true,
      data: {
        kind: "transaction",
        name: d.name ?? "",
        merchant: d.merchant ?? null,
        total: d.total ?? 0, // cents
        currencyCode: d.currencyCode ?? "",
        type: d.type ?? "",
        issuedAt: d.issuedAt instanceof Date ? d.issuedAt.toISOString().slice(0, 10) : String(d.issuedAt ?? ""),
        categoryCode: d.categoryCode ?? null,
        projectCode: d.projectCode ?? null,
      },
    }
  } catch (error) {
    console.error("Error testing SMS parse:", error)
    return { success: false, error: "Failed to analyze SMS" }
  }
}
