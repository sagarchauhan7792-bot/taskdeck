# Taskdeck

One place for every task you hand out. Assign work in WhatsApp, Telegram or Slack — by text or voice note — and it lands on your Taskdeck board, with who, what and by when already filled in.

Built with Next.js (vinext) on Cloudflare Workers, D1 and R2. Installs on phones as an app.

> **No sign-in.** Anyone who can open the app's address can see, change and delete tasks, and connect or disconnect channels. Keep the address private, or put the app behind an access control such as Cloudflare Access.

## What it does

- **Dashboard:** People board (one column per person), Agenda (overdue, today, next 7 days), Status board (Open → In progress → Waiting → Done), Review Inbox, Setup, task details with voice note playback, search (Ctrl K), light and dark themes, phone layout.
- **Quick add:** `@Rahul GST report #Finance !high friday` fills in the person, project, priority and due date. `aaj`, `kal` and `parso` work too.
- **Telegram:** forward a message or voice note to your bot; in groups, reply to a message with `/todo`. Commands: `/today`, `/pending [name]`, `/inbox`, `/done <id>`, `/undo <id>`, `/todo <text>`, plus Done/Undo/Approve/Discard buttons.
- **WhatsApp (official Cloud API):** send or forward a message or voice note to your own bot number. Plain words work as commands (`today`, `pending rahul`, `done 12`).
- **Slack:** react to any message with 📌 or 📝, or DM the app. With a user token, your own messages that @mention someone are picked up automatically into the Review Inbox.
- **AI reading:** Claude reads the task, assignee, due date and priority from Hindi, English or Hinglish. Voice notes are transcribed with Sarvam AI. Without keys, simple rules are used. Anything unclear waits in the Review Inbox.
- Every bot answers only its linked owner, and every webhook checks its channel's secret.

## Run locally

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. The SQL in `drizzle/` is applied to the local database automatically.

## Deploy to Cloudflare

Needs a free Cloudflare account. R2 (voice note storage) asks for a payment method even on the free tier.

```bash
npx wrangler login
npx wrangler d1 create taskdeck-db          # put the printed database_id in .openai/hosting.json → cloudflare.d1_id
npx wrangler r2 bucket create taskdeck-files
npm run build
npx wrangler d1 execute taskdeck-db --remote --config dist/server/wrangler.json --file drizzle/0000_ambiguous_wong.sql
npx wrangler deploy --config dist/server/wrangler.json
```

Add secrets with `npx wrangler secret put <NAME> --config dist/server/wrangler.json`.

## Secrets

Each feature switches itself off when its secret is missing. Put them in `.dev.vars` locally (never commit it) and in your host's secret settings in production.

| Name | Used for |
|---|---|
| `TELEGRAM_BOT_TOKEN` | The Telegram bot, from @BotFather |
| `ANTHROPIC_API_KEY` | Reading tasks out of messages with Claude |
| `SARVAM_API_KEY` | Voice note to text |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` | WhatsApp Cloud API |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | The Slack app |
| `SLACK_USER_TOKEN` | Optional. Reads wherever you can and turns on automatic capture |

## Connecting channels

Channels only deliver to a public https address, so connect them from the deployed app's **Setup** screen:

- **Telegram:** press **Connect Telegram**, then **Start** in the chat that opens.
- **WhatsApp:** paste the Callback URL and Verify token shown in Setup into Meta's App Dashboard → WhatsApp → Configuration and subscribe to `messages`. Then press **Connect WhatsApp** and send the `start …` message it prepares.
- **Slack:** set Event Subscriptions → Request URL to the URL shown in Setup. Subscribe to `message.im` and `reaction_added` (bot events) and, for automatic capture, `message.channels`, `message.groups`, `message.im`, `message.mpim` (user events). Then press **Connect Slack** and DM the app the `start …` code.

## Project layout

- `app/` – pages, JSON API (`app/api`) and channel webhooks (`app/hooks`)
- `components/todo/` – the dashboard
- `lib/channels/` – capture pipeline, AI reading, transcription, Telegram, WhatsApp and Slack
- `db/schema.ts`, `drizzle/` – database tables and migrations
- `worker/index.ts` – Cloudflare Worker entry
