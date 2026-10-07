# SMS Monitoring

This app turns bank SMS notifications into transactions. Your phone forwards incoming SMS to a TaxHacker webhook, the configured LLM extracts the amount, currency, merchant, date, category and project, and a transaction is created right away.

There is no public API for reading SMS from Google Messages for web, so the phone pushes messages to TaxHacker instead.

## 🔧 **Setup**

### 1. Create a webhook token

1. Go to **Apps → SMS Monitoring**
2. Click **"Generate token"** and copy it — it is shown only once (only its SHA-256 hash is stored)
3. Optionally list your banks' sender names / numbers under **Bank senders**

### 2. Forward SMS from your Android phone

Install the open-source [Incoming SMS to URL forwarder](https://github.com/bogkonstantin/android_income_sms_gateway_webhook) from [F-Droid](https://f-droid.org/packages/tech.bogomolov.incomingsmsgateway/) or GitHub releases (it is not allowed on Google Play because of the SMS permission), then add a forwarding config:

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Sender      | Your bank's sender name or number, or `*` for every SMS |
| Webhook URL | `https://<your TaxHacker>/api/sms/webhook`              |
| Headers     | `{"Authorization": "Bearer thsms_..."}`                 |
| Payload     | Keep the default template                               |

If TaxHacker runs on your home network, enable **Local network mode** in the rule's advanced parameters, otherwise the app waits for a validated internet connection. Press **Test** to send a test request.

Any other forwarder (Tasker, MacroDroid, a custom script) works too — see the request format below.

### 3. Try it without a phone

Paste a bank SMS into **Test an SMS** on the app page to see how it will be parsed. Nothing is saved.

## 📡 **Webhook API**

```
POST /api/sms/webhook
Authorization: Bearer <token>        (or X-Webhook-Token: <token>)
Content-Type: application/json

{ "from": "MyBank", "text": "Card *1234: purchase 12.50 EUR, COFFEE SHOP", "receivedStamp": 1791331001000 }
```

- Sender: `from` (also `sender`, `phoneNumber`, `phone`, `address`)
- Text: `text` (also `message`, `body`, `content`, `msg`)
- Time: `receivedStamp`, `receivedAt`, `timestamp`, `sentStamp` or `date` — unix milliseconds, unix seconds or an ISO date. Defaults to now.

| Response                                            | Meaning                                                        |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `200 {"status": "created", "transactionId": "..."}` | Transaction created                                            |
| `200 {"status": "skipped"}`                         | Not a transaction (OTP, promo, declined payment…)              |
| `200 {"status": "filtered"}`                        | Sender is not in **Bank senders**                              |
| `200 {"status": "duplicate"}`                       | This SMS was already processed                                 |
| `400` / `401` / `402` / `403`                       | Bad payload / bad token / no AI scans left / monitoring paused |
| `502 {"status": "error"}`                           | LLM or database error — the forwarder retries later            |

## ⚙️ **How It Works**

- **Sender filter**: SMS from senders that aren't listed are dropped before reaching the LLM, and their text isn't stored. Matching is case-insensitive and ignores spaces, `+`, `-` and brackets in phone numbers.
- **Parsing**: the LLM providers from **Settings → LLM** are used, in the same order as for documents. The amount is never taken from the account balance. Unknown categories/projects/currencies fall back to your defaults; a missing date falls back to the day the SMS was received.
- **Deduplication**: each SMS gets a fingerprint (sender + text + timestamp), so forwarder retries don't create duplicate transactions. An SMS that previously failed with an error is processed again.
- **Currency**: amounts are stored in the SMS currency. Foreign-currency transactions are not converted automatically — set the converted amount on the transaction page if you need it.
- **Traceability**: the original SMS text is saved in the transaction's text field, and the note says which sender it came from.

## 📊 **Data Storage**

- Stored in `appData` table with `app = 'sms'`
- `tokenHash`, `tokenPreview` (last 4 characters), `isActive`, `allowedSenders`
- `messages`: the latest 200 received SMS with their status, for the log on the app page

## 🔒 **Security**

- The webhook token is a random 256-bit value; only its SHA-256 hash is stored. Regenerating it immediately invalidates the old one.
- The webhook is the only unauthenticated entry point and only accepts requests with a valid token.
- Use HTTPS if the webhook is reachable from the internet — the token and SMS text travel in the request.
- SMS text is sent to your configured LLM provider, just like uploaded documents.

## 🚨 **Troubleshooting**

- **Nothing arrives**: check the forwarder's _Syslog_, that the phone can open the webhook URL, and that **Local network mode** is on for LAN addresses.
- **Some bank messages never arrive**: they may come over RCS instead of SMS. Turn off RCS chats in Google Messages.
- **`Error: All LLM providers failed or are not configured`**: configure a provider in **Settings → LLM**.
- **Everything is `filtered`**: compare the sender shown in the log with the **Bank senders** list.
