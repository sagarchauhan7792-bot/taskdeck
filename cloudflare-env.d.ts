declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    // Secrets. Each feature turns itself off when its secret is missing.
    TELEGRAM_BOT_TOKEN?: string;
    ANTHROPIC_API_KEY?: string;
    SARVAM_API_KEY?: string;
    WHATSAPP_TOKEN?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
    WHATSAPP_APP_SECRET?: string;
    SLACK_BOT_TOKEN?: string;
    SLACK_SIGNING_SECRET?: string;
    /** Optional: lets Taskdeck read wherever the owner can and pick up tasks they hand out. */
    SLACK_USER_TOKEN?: string;
    /** Local testing only: point the channels at fake servers. */
    TELEGRAM_API_BASE?: string;
    WHATSAPP_API_BASE?: string;
    SLACK_API_BASE?: string;
  }
}
