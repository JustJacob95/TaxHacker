import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { getDefaultSmsAppData, SMS_APP } from "@/lib/sms-sync/ingest"
import { SmsAppData } from "@/lib/sms-sync/types"
import { getAppData } from "@/models/apps"
import { SmsMonitorManager } from "./components/sms-monitor-manager"
import { manifest } from "./manifest"

export default async function SmsApp() {
  const user = await getCurrentUser()
  const appData = (await getAppData(user, SMS_APP)) as Partial<SmsAppData> | null
  const data: SmsAppData = { ...getDefaultSmsAppData(), ...(appData ?? {}) }

  // Never send the token hash to the browser.
  const { tokenHash, ...publicData } = data

  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-2 mb-8">
        <h2 className="flex flex-row gap-3 md:gap-5">
          <span className="text-3xl font-bold tracking-tight">
            {manifest.icon} {manifest.name}
          </span>
        </h2>
      </header>
      <SmsMonitorManager
        appData={publicData}
        hasToken={!!tokenHash}
        webhookUrl={`${config.app.baseURL}/api/sms/webhook`}
      />
    </div>
  )
}
