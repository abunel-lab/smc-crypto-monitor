import { logger } from "./logger";
import { sendTelegramMessage, getMonitorStatus } from "./cryptoMonitor";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
}

interface InlineKeyboard {
  inline_keyboard: Array<Array<{
    text: string;
    url?: string;
    web_app?: { url: string };
  }>>;
}

let lastUpdateId = 0;
let pollingActive = false;

function getWebAppUrl(): string {
  const domain = process.env.REPLIT_DEV_DOMAIN ?? process.env.WEB_APP_URL;
  if (domain) {
    return domain.startsWith("http") ? domain : `https://${domain}`;
  }
  return "";
}

async function sendMessageWithButtons(
  botToken: string,
  chatId: string,
  text: string,
  keyboard: InlineKeyboard,
): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup: keyboard,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    logger.warn({ status: res.status, body }, "Telegram message with buttons failed");
  }
}

async function getUpdates(botToken: string): Promise<TelegramUpdate[]> {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
    if (!json.ok) return [];
    return json.result;
  } catch (err) {
    logger.warn({ err }, "getUpdates failed");
    return [];
  }
}

async function handleCommand(botToken: string, chatId: number, text: string): Promise<void> {
  const cmd = text.split(" ")[0].toLowerCase().replace("@", "").split("@")[0];
  const webAppUrl = getWebAppUrl();

  if (cmd === "/start") {
    const msg =
      `🚀 <b>Welcome to SMC Alert Bot</b>\n\n` +
      `Real-time Smart Money signals for BTC, ETH & SOL.\n\n` +
      `Tap the button below to open your live dashboard:`;

    if (webAppUrl) {
      await sendMessageWithButtons(botToken, String(chatId), msg, {
        inline_keyboard: [
          [{ text: "📊 Open SMC Dashboard", url: webAppUrl }],
        ],
      });
    } else {
      await sendTelegramMessage(botToken, String(chatId), msg);
    }
    return;
  }

  if (cmd === "/help") {
    const dashboardLine = webAppUrl ? `\n/dashboard — Open live dashboard\n` : "";
    const msg =
      `🤖 <b>Crypto Monitor Bot</b>\n\n` +
      `Available commands:\n\n` +
      `/status — Live market status for all coins\n` +
      `/btc — BTC/USDT status\n` +
      `/eth — ETH/USDT status\n` +
      `/sol — SOL/USDT status\n` +
      `/bnb — BNB/USDT status\n` +
      `/xrp — XRP/USDT status\n` +
      `/trades — Open trades and recent closed trades\n` +
      `/balance — Win rate, balance, equity stats\n` +
      `/performance — Win rate, balance, equity stats\n` +
      dashboardLine +
      `/help — Show this help message\n\n` +
      `Alerts are sent automatically every 2 minutes when signals are detected (5-min cooldown per symbol).`;
    await sendTelegramMessage(botToken, String(chatId), msg);
    return;
  }

  if (cmd === "/dashboard") {
    if (webAppUrl) {
      await sendMessageWithButtons(
        botToken,
        String(chatId),
        `📊 <b>Live Trading Dashboard</b>\n\nOpen your real-time SMC dashboard:`,
        {
          inline_keyboard: [
            [{ text: "📊 Open SMC Dashboard", url: webAppUrl }],
          ],
        },
      );
    } else {
      await sendTelegramMessage(botToken, String(chatId), "⚠️ Dashboard URL not configured.");
    }
    return;
  }

  if (cmd === "/status") {
    const status = getMonitorStatus();
    const lines: string[] = [`📊 <b>Market Status</b>\n`];

    for (const sym of status.symbols) {
      const s = status.symbolStatus[sym];
      if (!s) {
        lines.push(`<b>${sym}</b>: Warming up...\n`);
        continue;
      }
      lines.push(
        `<b>${sym}</b>\n` +
        `  Price: $${s.priceOkx.toFixed(2)}\n` +
        `  Signal: ${s.signal}\n` +
        `  Bias: ${s.bias}\n` +
        `  Confidence: ${s.confidence}\n` +
        `  4H: ${s.tf4h}  1H: ${s.tf1h}  15m: ${s.tf15m}  5m: ${s.tf5m}\n` +
        `  Funding: ${(s.funding * 100).toFixed(3)}%\n`
      );
    }

    await sendTelegramMessage(botToken, String(chatId), lines.join("\n"));
    return;
  }

  if (cmd === "/trades") {
    const status = getMonitorStatus();
    const lines: string[] = [`📋 <b>Trades</b>\n`];

    if (status.openTrades.length > 0) {
      lines.push(`<b>Open Trades (${status.openTrades.length}):</b>`);
      for (const t of status.openTrades) {
        lines.push(
          `• ${t.symbol} ${t.direction}\n` +
          `  Entry: $${t.entry.toFixed(2)}  SL: $${t.sl.toFixed(2)}  TP: $${t.tp.toFixed(2)}\n` +
          `  Opened: ${new Date(t.openedAt).toUTCString()}`
        );
      }
    } else {
      lines.push(`No open trades.`);
    }

    lines.push("");

    if (status.recentTrades.length > 0) {
      lines.push(`<b>Recent Closed (${Math.min(status.recentTrades.length, 5)}):</b>`);
      for (const t of status.recentTrades.slice(0, 5)) {
        const emoji = t.status === "WIN" ? "✅" : "❌";
        lines.push(
          `${emoji} ${t.symbol} ${t.direction} — ${t.status}\n` +
          `  PnL: ${t.pnlPct !== undefined ? `${(t.pnlPct * 100).toFixed(2)}%` : "N/A"}`
        );
      }
    } else {
      lines.push(`No closed trades yet.`);
    }

    await sendTelegramMessage(botToken, String(chatId), lines.join("\n"));
    return;
  }

  if (cmd === "/performance" || cmd === "/balance") {
    const status = getMonitorStatus();
    const p = status.performance;
    const pnl = p.balance - p.initialBalance;
    const pnlPct = (pnl / p.initialBalance) * 100;

    const msg =
      `📈 <b>Performance</b>\n\n` +
      `Wins: ${p.wins}\n` +
      `Losses: ${p.losses}\n` +
      `Total Trades: ${p.wins + p.losses}\n` +
      `Win Rate: ${p.winRate.toFixed(1)}%\n\n` +
      `Starting Balance: $${p.initialBalance.toFixed(2)}\n` +
      `Current Balance: $${p.balance.toFixed(2)}\n` +
      `P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnl >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`;

    await sendTelegramMessage(botToken, String(chatId), msg);
    return;
  }

  const symbolCmdMap: Record<string, string> = {
    "/btc": "BTCUSDT",
    "/eth": "ETHUSDT",
    "/sol": "SOLUSDT",
    "/bnb": "BNBUSDT",
    "/xrp": "XRPUSDT",
  };

  if (cmd in symbolCmdMap) {
    const sym = symbolCmdMap[cmd];
    const status = getMonitorStatus();
    const s = status.symbolStatus[sym];
    if (!s) {
      await sendTelegramMessage(botToken, String(chatId), `⏳ <b>${sym}</b>: Still warming up — check back in a moment.`);
      return;
    }
    const msg =
      `📊 <b>${sym.replace("USDT", "")}/USDT</b>\n\n` +
      `Price: $${s.priceOkx.toFixed(s.priceOkx < 10 ? 4 : 2)}\n` +
      `Signal: ${s.signal}\n` +
      `Bias: ${s.bias}\n` +
      `Confidence: ${s.confidence}\n\n` +
      `Timeframes:\n` +
      `  4H: ${s.tf4h}  1H: ${s.tf1h}  15m: ${s.tf15m}  5m: ${s.tf5m}\n\n` +
      `OI: ${s.oi.toLocaleString("en", { maximumFractionDigits: 0 })}\n` +
      `Funding: ${(s.funding * 100).toFixed(4)}%\n` +
      `BOS: ${s.bos ?? "—"}  CHoCH: ${s.choch ?? "—"}`;
    await sendTelegramMessage(botToken, String(chatId), msg);
    return;
  }

  await sendTelegramMessage(
    botToken,
    String(chatId),
    `Unknown command. Send /help to see available commands.`
  );
}

async function pollLoop(botToken: string): Promise<void> {
  while (pollingActive) {
    const updates = await getUpdates(botToken);

    for (const update of updates) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id);

      if (!update.message?.text) continue;

      const { chat, text } = update.message;
      logger.info({ chatId: chat.id, text }, "Telegram command received");

      if (text.startsWith("/")) {
        await handleCommand(botToken, chat.id, text).catch((err) =>
          logger.error({ err, chatId: chat.id }, "Error handling command")
        );
      }
    }

    if (updates.length === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export function startTelegramBot(): void {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot command polling disabled");
    return;
  }

  if (pollingActive) {
    logger.warn("Telegram bot polling already active");
    return;
  }

  pollingActive = true;
  logger.info("Starting Telegram bot command polling...");

  void pollLoop(botToken);
}
