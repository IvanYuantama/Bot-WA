import "dotenv/config";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";

const API_KEY = process.env.LIMITROUTER_API_KEY;
const BASE_URL = (
  process.env.LIMITROUTER_BASE_URL || "https://limitrouter.com/v1"
).replace(/\/$/, "");
const MODEL = process.env.LIMITROUTER_MODEL || "Qwen3.8-27B";
const ASSISTANT_NAME = process.env.ASSISTANT_NAME || "JobingHo";
const MAX_HISTORY = Number.parseInt(
  process.env.MAX_HISTORY_MESSAGES || "20",
  10,
);
const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const histories = new Map();
const pending = new Set();

if (!API_KEY) {
  logger.error(
    "LIMITROUTER_API_KEY belum diatur. Salin .env.example menjadi .env lalu isi API key.",
  );
  process.exit(1);
}

function textFromMessage(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ""
  );
}

function getHistory(jid) {
  if (!histories.has(jid)) histories.set(jid, []);
  return histories.get(jid);
}

async function askLimitRouter(jid, userText) {
  const history = getHistory(jid);
  history.push({ role: "user", content: userText });
  const messages = [
    {
      role: "system",
      content:
        `Kamu adalah ${ASSISTANT_NAME}, asisten WhatsApp yang ramah, ringkas, dan membantu.\n` +
        "Jawab dalam bahasa yang digunakan pengguna. Jangan mengaku sebagai manusia. Jika tidak tahu, katakan dengan jujur.",
    },
    ...history.slice(-MAX_HISTORY),
  ];

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, messages }),
    });

    const body = await response.text();
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(
        `Respons bukan JSON (${response.status}): ${body.slice(0, 200)}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        data?.error?.message || data?.message || `HTTP ${response.status}`,
      );
    }

    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error("Respons model tidak memiliki isi jawaban.");
    history.push({ role: "assistant", content: answer });
    if (history.length > MAX_HISTORY)
      history.splice(0, history.length - MAX_HISTORY);
    return answer;
  } catch (error) {
    history.pop();
    throw error;
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: Browsers.macOS("JobingHo"),
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.info("Scan QR berikut dari WhatsApp > Perangkat tertaut:");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open")
      logger.info(`${ASSISTANT_NAME} aktif dengan model ${MODEL}.`);
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        logger.warn("Koneksi terputus, mencoba menyambung kembali...");
        startBot().catch((error) => logger.error(error));
      } else {
        logger.error(
          "Sesi logout. Hapus folder auth_info_baileys lalu jalankan ulang untuk pairing ulang.",
        );
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const message of messages) {
      if (
        !message.message ||
        message.key.fromMe ||
        message.key.remoteJid === "status@broadcast"
      )
        continue;
      const jid = message.key.remoteJid;
      const incoming = textFromMessage(message.message).trim();
      if (!incoming || pending.has(jid)) continue;
      const chatMatch = incoming.match(/^\/c(?:\s+([\s\S]+))?$/i);

      if (incoming.toLowerCase() === "/reset") {
        histories.delete(jid);
        await sock.sendMessage(jid, {
          text: "Riwayat percakapan sudah dihapus.",
        });
        continue;
      }
      if (incoming.toLowerCase() === "/help") {
        await sock.sendMessage(jid, {
          text: `${ASSISTANT_NAME} siap membantu. Gunakan /c sebelum pesan.\n\nPerintah:\n/c pesan Anda — chat dengan ${ASSISTANT_NAME}\n/reset — hapus riwayat chat\n/help — tampilkan bantuan`,
        });
        continue;
      }
      // Pesan biasa diabaikan. Bot hanya menjawab jika diawali perintah /c.
      if (!chatMatch) continue;
      const userText = chatMatch[1]?.trim();
      if (!userText) {
        await sock.sendMessage(jid, {
          text: "Gunakan format: /c pesan Anda",
        });
        continue;
      }

      pending.add(jid);
      try {
        await sock.sendPresenceUpdate("composing", jid);
        const answer = await askLimitRouter(jid, userText);
        await sock.sendMessage(jid, { text: answer }, { quoted: message });
      } catch (error) {
        logger.error(
          { error: error.message, jid },
          "Gagal meminta jawaban ke Limit Router",
        );
        await sock.sendMessage(jid, {
          text: "Maaf, sedang ada gangguan saat memproses pesan. Silakan coba lagi beberapa saat.",
        });
      } finally {
        pending.delete(jid);
        await sock.sendPresenceUpdate("paused", jid).catch(() => {});
      }
    }
  });
}

startBot().catch((error) => {
  logger.error(error);
  process.exit(1);
});
