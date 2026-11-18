"use client";

import { Check, Copy, ExternalLink, Loader2, Send, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ChannelStatus = {
  telegram: { tokenSet: boolean; connected: boolean; username: string | null; link: string | null };
  whatsapp: {
    configured: boolean;
    connected: boolean;
    number: string | null;
    code: string | null;
    link: string | null;
    webhookUrl: string;
    verifyToken: string | null;
  };
  slack: { configured: boolean; connected: boolean; autoCapture: boolean; code: string | null; requestUrl: string };
  ai: boolean;
  transcription: boolean;
};

type Channel = "telegram" | "whatsapp" | "slack";

function Dot({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={cn("size-1.5 rounded-full", on ? "bg-done" : "bg-muted-foreground")} />
      {children}
    </p>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 text-[11px]">{value}</code>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error("Could not copy. Select the text instead.");
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

function useChannelAction(refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (channel: Channel, method: "POST" | "DELETE") => {
    setBusy(true);
    try {
      const response = await fetch(`/api/channels/${channel}`, { method });
      const body = (await response.json().catch(() => ({}))) as { error?: string; link?: string | null };
      if (!response.ok) throw new Error(body.error ?? "Something went wrong.");
      if (body.link) window.open(body.link, "_blank", "noopener");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function DisconnectButton({ name, busy, onConfirm }: { name: string; busy: boolean; onConfirm: () => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={() => {
        if (window.confirm(`Disconnect ${name}? Messages there will stop creating tasks.`)) onConfirm();
      }}
    >
      <Unplug /> Disconnect
    </Button>
  );
}

function Card({ title, tone, how, children }: { title: string; tone: string; how: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4">
      <p className={cn("text-sm font-semibold", tone)}>{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{how}</p>
      {children}
    </div>
  );
}

function TelegramCard({ status, refresh }: { status: ChannelStatus["telegram"]; refresh: () => void }) {
  const { busy, run } = useChannelAction(refresh);
  return (
    <Card
      title="Telegram"
      tone="text-telegram"
      how="Forward a message or voice note to your bot. In groups, reply to a message with /todo."
    >
      {!status.tokenSet && <Dot on={false}>Bot token not added yet</Dot>}
      {status.tokenSet && status.connected && (
        <>
          <Dot on>Connected{status.username ? ` · @${status.username}` : ""}</Dot>
          <div className="mt-3 flex flex-wrap gap-2">
            {status.username && (
              <Button asChild size="sm" variant="secondary">
                <a href={`https://t.me/${status.username}`} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open bot
                </a>
              </Button>
            )}
            <DisconnectButton name="Telegram" busy={busy} onConfirm={() => void run("telegram", "DELETE")} />
          </div>
        </>
      )}
      {status.tokenSet && !status.connected && (
        <>
          <Dot on={false}>{status.link ? "Waiting for you to press Start in Telegram" : "Ready to connect"}</Dot>
          <div className="mt-3 flex flex-wrap gap-2">
            {status.link ? (
              <Button asChild size="sm">
                <a href={status.link} target="_blank" rel="noreferrer">
                  <Send /> Open Telegram and press Start
                </a>
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => void run("telegram", "POST")}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Connect Telegram
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function WhatsAppCard({ status, refresh }: { status: ChannelStatus["whatsapp"]; refresh: () => void }) {
  const { busy, run } = useChannelAction(refresh);
  return (
    <Card title="WhatsApp" tone="text-whatsapp" how="Send or forward a message or voice note to your own bot number.">
      {!status.configured && <Dot on={false}>WhatsApp keys not added yet</Dot>}
      {status.configured && status.connected && (
        <>
          <Dot on>Connected{status.number ? ` · +${status.number}` : ""}</Dot>
          <div className="mt-3 flex flex-wrap gap-2">
            {status.number && (
              <Button asChild size="sm" variant="secondary">
                <a href={`https://wa.me/${status.number}`} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open chat
                </a>
              </Button>
            )}
            <DisconnectButton name="WhatsApp" busy={busy} onConfirm={() => void run("whatsapp", "DELETE")} />
          </div>
        </>
      )}
      {status.configured && !status.connected && (
        <>
          <Dot on={false}>{status.code ? "Waiting for your start message" : "Ready to connect"}</Dot>
          {status.code && !status.link && (
            <p className="mt-2 text-xs">
              Send <code className="rounded bg-muted px-1">start {status.code}</code> to your bot number.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {status.link ? (
              <Button asChild size="sm">
                <a href={status.link} target="_blank" rel="noreferrer">
                  <Send /> Open WhatsApp and send
                </a>
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => void run("whatsapp", "POST")}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Connect WhatsApp
              </Button>
            )}
          </div>
        </>
      )}
      {status.configured && status.verifyToken && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Meta webhook settings</summary>
          <CopyField label="Callback URL" value={status.webhookUrl} />
          <CopyField label="Verify token" value={status.verifyToken} />
        </details>
      )}
    </Card>
  );
}

function SlackCard({ status, refresh }: { status: ChannelStatus["slack"]; refresh: () => void }) {
  const { busy, run } = useChannelAction(refresh);
  return (
    <Card
      title="Slack"
      tone="text-slack"
      how="React to any message with 📌 or 📝 to capture it, or DM the Taskdeck app."
    >
      {!status.configured && <Dot on={false}>Slack keys not added yet</Dot>}
      {status.configured && status.connected && (
        <>
          <Dot on>Connected{status.autoCapture ? " · auto-capture on" : ""}</Dot>
          <div className="mt-3 flex flex-wrap gap-2">
            <DisconnectButton name="Slack" busy={busy} onConfirm={() => void run("slack", "DELETE")} />
          </div>
        </>
      )}
      {status.configured && !status.connected && (
        <>
          <Dot on={false}>{status.code ? "Waiting for your start message" : "Ready to connect"}</Dot>
          {status.code ? (
            <p className="mt-2 text-xs">
              In Slack, send the Taskdeck app a direct message:{" "}
              <code className="rounded bg-muted px-1">start {status.code}</code>
            </p>
          ) : (
            <div className="mt-3">
              <Button size="sm" disabled={busy} onClick={() => void run("slack", "POST")}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Connect Slack
              </Button>
            </div>
          )}
        </>
      )}
      {status.configured && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Slack app settings</summary>
          <CopyField label="Event Subscriptions → Request URL" value={status.requestUrl} />
        </details>
      )}
    </Card>
  );
}

export function ChannelsSection() {
  const [status, setStatus] = useState<ChannelStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/channels", { cache: "no-store" });
      if (response.ok) setStatus((await response.json()) as ChannelStatus);
    } catch {
      // Leave the last known status on screen.
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      void refresh();
    };
    tick();
    // Notice when the start message arrives.
    const timer = window.setInterval(tick, 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <section aria-labelledby="setup-channels">
      <h2 id="setup-channels" className="text-sm font-semibold">
        Channels
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Messages captured here land on the same boards. Anything unclear waits in the Review Inbox.
      </p>
      {status ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <TelegramCard status={status.telegram} refresh={() => void refresh()} />
            <WhatsAppCard status={status.whatsapp} refresh={() => void refresh()} />
            <SlackCard status={status.slack} refresh={() => void refresh()} />
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <li className="inline-flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", status.ai ? "bg-done" : "bg-muted-foreground")} />
              AI task reading {status.ai ? "on" : "off (simple rules until a Claude key is added)"}
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", status.transcription ? "bg-done" : "bg-muted-foreground")} />
              Voice notes to text {status.transcription ? "on" : "off (add a Sarvam key)"}
            </li>
          </ul>
        </>
      ) : (
        <p className="mt-3 rounded-xl border bg-card p-4 text-xs text-muted-foreground">Checking channels…</p>
      )}
    </section>
  );
}
