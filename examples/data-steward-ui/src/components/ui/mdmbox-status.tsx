import { useEffect, useState } from "react";

type Health = "checking" | "online" | "offline";

const POLL_INTERVAL_MS = 15_000;

// Compact MDMbox connectivity indicator for the navbar. Pulls the configured
// upstream URL from /app-info (exposed by both server/index.ts and the vite
// dev plugin) and polls /api/models to check liveness.
export function MdmboxStatus() {
  const [mdmboxUrl, setMdmboxUrl] = useState<string>("");
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/app-info")
      .then((r) => r.json())
      .then((info: { mdmboxUrl?: string }) => {
        if (!cancelled && info?.mdmboxUrl) setMdmboxUrl(info.mdmboxUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const r = await fetch("/api/models", { cache: "no-store" });
        if (!cancelled) setHealth(r.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setHealth("offline");
      }
    };
    ping();
    const interval = setInterval(ping, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const dot =
    health === "online"
      ? "bg-green-500"
      : health === "offline"
      ? "bg-gray-400"
      : "bg-gray-300 animate-pulse";

  const content = (
    <span className="flex items-center gap-2 text-sm text-muted-foreground leading-tight rounded-md border bg-white px-3 py-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
      <span className="flex flex-col">
        <span className="font-bold text-foreground">MDMbox</span>
        {mdmboxUrl && <span className="text-xs">{mdmboxUrl}</span>}
      </span>
    </span>
  );

  if (!mdmboxUrl) return content;
  const titleStatus = health === "online" ? "online" : health === "offline" ? "offline" : "checking";
  return (
    <a
      href={mdmboxUrl}
      target="_blank"
      rel="noreferrer"
      className="hover:text-foreground"
      title={`MDMbox is ${titleStatus}`}
    >
      {content}
    </a>
  );
}
