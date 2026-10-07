export type IncomingSms = {
  from: string
  text: string
  receivedAt: Date
}

export type SmsLogStatus = "created" | "skipped" | "filtered" | "duplicate" | "error"

export type SmsLogEntry = {
  id: string
  fingerprint: string
  from: string
  text: string
  receivedAt: string // ISO
  processedAt: string // ISO
  status: SmsLogStatus
  transactionId?: string
  error?: string
}

export type SmsAppData = {
  isActive: boolean
  // sha256 of the webhook token; the plaintext is shown to the user only once, when generated
  tokenHash?: string
  tokenPreview?: string // last 4 chars, so the user can tell tokens apart
  tokenCreatedAt?: string
  // Case-insensitive sender names / phone numbers to accept. Empty = accept every sender.
  allowedSenders: string[]
  messages: SmsLogEntry[]
}

export const MAX_LOG_ENTRIES = 200
