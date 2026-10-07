import { isAiBalanceExhausted, isSubscriptionExpired } from "@/lib/auth"
import { normalizeSmsPayload } from "@/lib/sms-sync/filters"
import { appendSmsLog, findSmsAppByTokenHash, getDefaultSmsAppData, processSms } from "@/lib/sms-sync/ingest"
import { extractWebhookToken, hashWebhookToken } from "@/lib/sms-sync/token"
import { SmsAppData } from "@/lib/sms-sync/types"
import { updateUser } from "@/models/users"
import { revalidatePath } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

/**
 * Receives SMS forwarded from the user's phone (e.g. by the "Incoming SMS to URL forwarder" Android app)
 * and turns bank notifications into transactions.
 *
 * Auth: `Authorization: Bearer <token>` or `X-Webhook-Token: <token>`, token generated in Apps → SMS Monitoring.
 * Body: JSON `{ "from": "...", "text": "...", "receivedStamp": 1700000000000 }` (see normalizeSmsPayload).
 *
 * Non-2xx responses make forwarder apps retry, so only transient failures (LLM errors) return 5xx.
 */
export async function POST(request: NextRequest) {
  const token = extractWebhookToken(request.headers)
  if (!token) {
    return NextResponse.json({ success: false, error: "Missing webhook token" }, { status: 401 })
  }

  const row = await findSmsAppByTokenHash(hashWebhookToken(token))
  if (!row) {
    return NextResponse.json({ success: false, error: "Invalid webhook token" }, { status: 401 })
  }

  const appData = { ...getDefaultSmsAppData(), ...(row.data as Partial<SmsAppData>) }
  if (!appData.isActive) {
    return NextResponse.json({ success: false, error: "SMS monitoring is paused" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Body must be JSON" }, { status: 400 })
  }

  const sms = normalizeSmsPayload(body)
  if (!sms) {
    return NextResponse.json(
      { success: false, error: "Expected JSON with sender (`from`) and message (`text`) fields" },
      { status: 400 }
    )
  }

  if (isAiBalanceExhausted(row.user) || isSubscriptionExpired(row.user)) {
    return NextResponse.json(
      { success: false, error: "AI scans are not available for this account, please check your subscription" },
      { status: 402 }
    )
  }

  const entry = await processSms(row.user, appData, sms)

  if (entry.status !== "duplicate") {
    await appendSmsLog(row.userId, entry)
    revalidatePath("/apps/sms")
  }
  if (entry.status === "created" || entry.status === "skipped") {
    // Both mean the LLM was called, same as one scan of an uploaded document.
    await updateUser(row.userId, { aiBalance: { decrement: 1 } })
  }
  if (entry.status === "created") {
    revalidatePath("/transactions")
  }

  return NextResponse.json(
    {
      success: entry.status !== "error",
      status: entry.status,
      transactionId: entry.transactionId,
      ...(entry.error ? { error: entry.error } : {}),
    },
    { status: entry.status === "error" ? 502 : 200 }
  )
}
