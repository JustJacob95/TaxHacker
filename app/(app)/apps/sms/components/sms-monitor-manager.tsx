"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MAX_LOG_ENTRIES, SmsAppData, SmsLogEntry } from "@/lib/sms-sync/types"
import { formatCurrency } from "@/lib/utils"
import { format } from "date-fns"
import { AlertCircle, CheckCircle, Copy, Filter, KeyRound, Pause, Play, SkipForward, Trash2 } from "lucide-react"
import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import {
  clearSmsLogAction,
  generateSmsTokenAction,
  SmsTestResult,
  testSmsParseAction,
  updateSmsSettingsAction,
} from "../actions"

type SmsMonitorManagerProps = {
  appData: Omit<SmsAppData, "tokenHash">
  hasToken: boolean
  webhookUrl: string
}

// Server and browser may run in different time zones, hence suppressHydrationWarning where this is rendered.
const formatDateTime = (iso: string) => format(new Date(iso), "MMM d, yyyy HH:mm")

const copyToClipboard = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value)
    toast.success("Copied to clipboard")
  } catch {
    toast.error("Could not copy, please select and copy manually")
  }
}

const getStatusBadge = (status: SmsLogEntry["status"]) => {
  switch (status) {
    case "created":
      return (
        <Badge className="bg-green-100 text-green-800">
          <CheckCircle className="w-3 h-3 mr-1" />
          Transaction
        </Badge>
      )
    case "skipped":
      return (
        <Badge variant="secondary">
          <SkipForward className="w-3 h-3 mr-1" />
          Skipped
        </Badge>
      )
    case "filtered":
      return (
        <Badge variant="outline">
          <Filter className="w-3 h-3 mr-1" />
          Filtered
        </Badge>
      )
    case "error":
      return (
        <Badge variant="destructive">
          <AlertCircle className="w-3 h-3 mr-1" />
          Error
        </Badge>
      )
    default:
      return <Badge variant="secondary">{status}</Badge>
  }
}

export function SmsMonitorManager({ appData, hasToken, webhookUrl }: SmsMonitorManagerProps) {
  const [isPending, startTransition] = useTransition()
  const [newToken, setNewToken] = useState<string | null>(null)
  const [senders, setSenders] = useState(appData.allowedSenders.join("\n"))
  const [testFrom, setTestFrom] = useState("")
  const [testText, setTestText] = useState("")
  const [testResult, setTestResult] = useState<SmsTestResult | null>(null)

  const handleGenerateToken = () => {
    if (hasToken && !confirm("Generate a new token? The old one stops working and you'll need to update your phone.")) {
      return
    }
    startTransition(async () => {
      const result = await generateSmsTokenAction()
      if (result.success && result.data) {
        setNewToken(result.data.token)
        toast.success("New token generated")
      } else {
        toast.error(result.error || "Failed to generate token")
      }
    })
  }

  const handleToggleActive = () => {
    startTransition(async () => {
      const result = await updateSmsSettingsAction({ isActive: !appData.isActive })
      if (result.success) {
        toast.success(appData.isActive ? "SMS monitoring paused" : "SMS monitoring resumed")
      } else {
        toast.error(result.error || "Failed to save settings")
      }
    })
  }

  const handleSaveSenders = () => {
    startTransition(async () => {
      const result = await updateSmsSettingsAction({ allowedSenders: senders })
      if (result.success) {
        toast.success("Senders saved")
      } else {
        toast.error(result.error || "Failed to save senders")
      }
    })
  }

  const handleTest = () => {
    setTestResult(null)
    startTransition(async () => {
      const result = await testSmsParseAction({ from: testFrom, text: testText })
      if (result.success && result.data) {
        setTestResult(result.data)
      } else {
        toast.error(result.error || "Failed to analyze SMS")
      }
    })
  }

  const handleClearLog = () => {
    if (!confirm("Clear the list of received messages? Created transactions are kept.")) return
    startTransition(async () => {
      const result = await clearSmsLogAction()
      if (!result.success) toast.error(result.error || "Failed to clear log")
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              Webhook
              {appData.isActive ? (
                <Badge className="bg-green-100 text-green-800">Active</Badge>
              ) : (
                <Badge variant="outline">Paused</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Your phone forwards bank SMS to this URL, and each one becomes a transaction.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleToggleActive} disabled={isPending}>
            {appData.isActive ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}
            {appData.isActive ? "Pause" : "Resume"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Webhook URL (method POST)</Label>
            <div className="flex gap-2">
              <Input readOnly value={webhookUrl} className="font-mono text-sm" />
              <Button variant="outline" size="icon" onClick={() => copyToClipboard(webhookUrl)} title="Copy URL">
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Token</Label>
            {newToken ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input readOnly value={newToken} className="font-mono text-sm" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(newToken)} title="Copy token">
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-sm text-amber-700">
                  Copy it now — it won&apos;t be shown again. Send it in the{" "}
                  <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> header.
                </p>
              </div>
            ) : hasToken ? (
              <p className="text-sm text-muted-foreground">
                Token ending in <code className="font-mono">…{appData.tokenPreview}</code>
                {appData.tokenCreatedAt && (
                  <span suppressHydrationWarning>, created {formatDateTime(appData.tokenCreatedAt)}</span>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No token yet. Generate one to start receiving SMS.</p>
            )}
            <Button variant={hasToken ? "outline" : "default"} onClick={handleGenerateToken} disabled={isPending}>
              <KeyRound className="w-4 h-4 mr-1" />
              {hasToken ? "Regenerate token" : "Generate token"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phone setup (Android)</CardTitle>
          <CardDescription>
            Uses the free open-source{" "}
            <a
              href="https://github.com/bogkonstantin/android_income_sms_gateway_webhook"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Incoming SMS to URL forwarder
            </a>{" "}
            app, available from F-Droid or GitHub releases (not on Google Play).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>Install the app, grant the SMS permission and add a forwarding config.</li>
            <li>
              Sender: your bank&apos;s sender name or number as shown in your messenger (or <code>*</code> for all SMS).
            </li>
            <li>
              Webhook URL: the URL above. It must be reachable from your phone — if TaxHacker runs on your home network,
              enable <em>Local network mode</em> in the rule&apos;s advanced parameters.
            </li>
            <li>
              Headers: <code className="font-mono">{`{"Authorization": "Bearer <your token>"}`}</code>
            </li>
            <li>
              Keep the default JSON payload template, save, and press <em>Test</em>.
            </li>
          </ol>
          <p className="text-sm text-muted-foreground mt-3">
            Bank messages delivered over RCS instead of SMS can&apos;t be forwarded — turn off RCS chats in Google
            Messages if some messages never arrive.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bank senders</CardTitle>
          <CardDescription>
            Only SMS from these senders are analyzed, one per line (e.g. <code>MyBank</code> or{" "}
            <code>+1 555 123 4567</code>). Leave empty to analyze every forwarded SMS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={senders}
            onChange={(e) => setSenders(e.target.value)}
            rows={4}
            placeholder={"MyBank\n+15551234567"}
            className="font-mono"
          />
          <Button onClick={handleSaveSenders} disabled={isPending}>
            Save senders
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test an SMS</CardTitle>
          <CardDescription>Paste a bank SMS to see how it will be parsed. Nothing is saved.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={testFrom} onChange={(e) => setTestFrom(e.target.value)} placeholder="Sender (optional)" />
          <Textarea
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            rows={3}
            placeholder="Card *1234: purchase 12.50 EUR, COFFEE SHOP. Balance 1,034.20 EUR"
          />
          <Button onClick={handleTest} disabled={isPending || !testText.trim()}>
            {isPending ? "Analyzing…" : "Analyze"}
          </Button>
          {testResult?.kind === "skipped" && (
            <p className="text-sm text-muted-foreground">Not imported: {testResult.reason}</p>
          )}
          {testResult?.kind === "transaction" && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm rounded-md border p-3">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{testResult.name}</dd>
              <dt className="text-muted-foreground">Merchant</dt>
              <dd>{testResult.merchant || "—"}</dd>
              <dt className="text-muted-foreground">Amount</dt>
              <dd>
                {testResult.type === "income" ? "+" : "−"}
                {formatCurrency(testResult.total, testResult.currencyCode)}
              </dd>
              <dt className="text-muted-foreground">Date</dt>
              <dd>{testResult.issuedAt}</dd>
              <dt className="text-muted-foreground">Category</dt>
              <dd>{testResult.categoryCode || "—"}</dd>
              <dt className="text-muted-foreground">Project</dt>
              <dd>{testResult.projectCode || "—"}</dd>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Received messages</CardTitle>
            <CardDescription>Latest SMS received by the webhook (up to {MAX_LOG_ENTRIES}).</CardDescription>
          </div>
          {appData.messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleClearLog} disabled={isPending}>
              <Trash2 className="w-4 h-4 mr-1" />
              Clear
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {appData.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No SMS received yet.</p>
          ) : (
            <ul className="divide-y">
              {appData.messages.map((message) => (
                <li key={message.id} className="py-3 flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {getStatusBadge(message.status)}
                    <span className="font-medium">{message.from}</span>
                    <span className="text-muted-foreground" suppressHydrationWarning>
                      {formatDateTime(message.receivedAt)}
                    </span>
                    {message.transactionId && (
                      <Link href={`/transactions/${message.transactionId}`} className="underline">
                        Open transaction
                      </Link>
                    )}
                  </div>
                  {message.text && <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>}
                  {message.error && <p className="text-sm text-muted-foreground">{message.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
