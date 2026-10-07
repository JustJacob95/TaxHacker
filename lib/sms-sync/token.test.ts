import { describe, expect, it } from "vitest"
import { extractWebhookToken, generateWebhookToken, hashWebhookToken } from "./token"

describe("webhook token", () => {
  it("generates distinct prefixed tokens and hashes them deterministically", () => {
    const a = generateWebhookToken()
    const b = generateWebhookToken()
    expect(a).toMatch(/^thsms_[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
    expect(hashWebhookToken(a)).toBe(hashWebhookToken(` ${a} `))
    expect(hashWebhookToken(a)).not.toBe(hashWebhookToken(b))
  })

  it("reads the token from Authorization or X-Webhook-Token", () => {
    expect(extractWebhookToken(new Headers({ Authorization: "Bearer abc" }))).toBe("abc")
    expect(extractWebhookToken(new Headers({ authorization: "bearer  abc " }))).toBe("abc")
    expect(extractWebhookToken(new Headers({ "X-Webhook-Token": "xyz" }))).toBe("xyz")
    expect(extractWebhookToken(new Headers({ Authorization: "Basic abc" }))).toBeNull()
    expect(extractWebhookToken(new Headers())).toBeNull()
  })
})
