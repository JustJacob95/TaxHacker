import { createHash, randomBytes } from "crypto"

const TOKEN_PREFIX = "thsms_"

export function generateWebhookToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url")
}

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex")
}

// Pull the token from `Authorization: Bearer <token>` or `X-Webhook-Token: <token>`.
export function extractWebhookToken(headers: Headers): string | null {
  const auth = headers.get("authorization")
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i)
    if (match) return match[1].trim()
  }
  const header = headers.get("x-webhook-token")
  return header ? header.trim() : null
}
