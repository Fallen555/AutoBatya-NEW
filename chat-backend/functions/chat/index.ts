// АвтоБатя. Серверная часть чата на Supabase Edge Functions.
// Единственная точка входа для сайта и для пульта мастерской.
// Ключи и пароль живут в переменных окружения проекта, в браузер не попадают.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Значения из настроек чистим от пробелов и переводов строки: поле для секрета
// в Supabase многострочное, и лишний невидимый символ легко уезжает вместе
// с паролем или ключом.
const env = (name: string) => (Deno.env.get(name) ?? "").trim();

const SHOP_PASSWORD = env("SHOP_PASSWORD");
const NOTIFY_KEY = env("NOTIFY_KEY");                      // ключ Web3Forms, необязательно
const SITE_URL = env("SITE_URL");                          // адрес сайта, для ссылки в письме
// Адреса сайтов, которым разрешено обращаться к чату. Можно перечислить
// несколько через запятую: пригодится, когда сайт переедет на свой домен,
// тогда старый и новый адрес работают одновременно.
// Пример: https://fallen555.github.io, https://avtobatya.ru
const ALLOWED_ORIGINS = (env("ALLOWED_ORIGIN") || "*")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const BUCKET = "chat-files";
const MAX_TEXT = 2000;
const MAX_FILES = 6;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic",
  "application/pdf", "video/mp4", "video/quicktime",
];

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0] ?? "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

// Какой адрес разрешить именно этому запросу. Если список из одного адреса,
// ведёт себя как раньше; если из нескольких, отвечаем тем, с которого пришли.
function originFor(req: Request) {
  if (ALLOWED_ORIGINS.includes("*")) return "*";
  const from = (req.headers.get("origin") ?? "").replace(/\/+$/, "");
  if (from && ALLOWED_ORIGINS.includes(from)) return from;
  return ALLOWED_ORIGINS[0] ?? "*";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });
}
const fail = (error: string, status = 400) => json({ ok: false, error }, status);

// сравнение без утечки времени
function sameSecret(a: string, b: string) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomSecret() {
  const raw = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanText(v: unknown) {
  // убираем управляющие символы, перевод строки и табуляцию оставляем
  return String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, MAX_TEXT);
}

function cleanFiles(v: unknown) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_FILES).map((f: Record<string, unknown>) => ({
    path: String(f?.path ?? "").slice(0, 300),
    name: String(f?.name ?? "файл").slice(0, 120),
    size: Math.max(0, Math.min(MAX_FILE_BYTES, Number(f?.size) || 0)),
    type: String(f?.type ?? "").slice(0, 80),
  })).filter((f) => f.path.length > 0);
}

async function signFiles(files: Array<Record<string, unknown>>) {
  const out = [];
  for (const f of files ?? []) {
    const path = String(f.path ?? "");
    let url = "";
    if (path) {
      const { data } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
      url = data?.signedUrl ?? "";
    }
    out.push({ name: f.name, size: f.size, type: f.type, url });
  }
  return out;
}

async function loadChat(id: unknown, secret: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db.from("chats").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  if (!sameSecret(data.secret, String(secret ?? ""))) return null;
  return data;
}

async function tooFast(chatId: string) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from("messages")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", chatId).gte("created_at", since);
  return (count ?? 0) > 20;
}

// Отправка письма через Web3Forms. Возвращает, что именно ответил сервис,
// чтобы поломку было видно, а не приходилось гадать.
async function sendMail(subject: string, text: string) {
  if (!NOTIFY_KEY) return { ok: false, status: 0, answer: "Ключ NOTIFY_KEY не задан" };
  try {
    const r = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        access_key: NOTIFY_KEY,
        subject,
        from_name: "Чат на сайте",
        message: text,
      }),
    });
    const answer = (await r.text()).slice(0, 400);
    if (!r.ok) console.error("Web3Forms отказал:", r.status, answer);
    return { ok: r.ok, status: r.status, answer };
  } catch (e) {
    const answer = e instanceof Error ? e.message : String(e);
    console.error("Web3Forms недоступен:", answer);
    return { ok: false, status: 0, answer };
  }
}

async function notifyShop(chat: Record<string, unknown>, body: string, fileCount: number) {
  if (!NOTIFY_KEY) return;
  const last = chat.last_notify_at ? Date.parse(String(chat.last_notify_at)) : 0;
  if (Date.now() - last < 90_000) return;     // не чаще раза в полторы минуты на один диалог

  const lines = [
    "Новое сообщение в чате на сайте.",
    "",
    body || "(без текста)",
    fileCount ? `\nВложений: ${fileCount}` : "",
    chat.name ? `\nИмя: ${chat.name}` : "",
    chat.contact ? `\nКонтакт: ${chat.contact}` : "",
    SITE_URL ? `\nОтветить: ${SITE_URL.replace(/\/$/, "")}/pult.html` : "",
  ];
  const sent = await sendMail("АвтоБатя: сообщение в чате на сайте", lines.filter(Boolean).join("\n"));
  // Отметку о письме ставим только когда оно правда ушло: иначе неудачная
  // попытка заглушила бы уведомления на полторы минуты.
  if (sent.ok) {
    await db.from("chats").update({ last_notify_at: new Date().toISOString() }).eq("id", chat.id);
  }
}

async function uploadTicket(chatId: string, name: unknown, type: unknown, size: unknown) {
  const fileName = String(name ?? "file").replace(/[^\w.\-а-яёА-ЯЁ ]+/gi, "_").slice(0, 120);
  const fileType = String(type ?? "");
  const fileSize = Number(size) || 0;
  if (fileSize > MAX_FILE_BYTES) return { error: "Файл больше 25 МБ" };
  if (fileType && !ALLOWED_TYPES.includes(fileType)) return { error: "Такой тип файла не принимаем" };
  const path = `${chatId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${fileName}`;
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: "Хранилище недоступно" };
  const signedUrl = data.signedUrl.startsWith("http")
    ? data.signedUrl
    : `${SUPABASE_URL}/storage/v1${data.signedUrl}`;
  return { path, uploadUrl: signedUrl, token: data.token };
}

// Каждому ответу проставляем тот адрес, с которого пришёл запрос.
Deno.serve(async (req) => {
  const res = await handle(req);
  res.headers.set("Access-Control-Allow-Origin", originFor(req));
  return res;
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Только POST", 405);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return fail("Плохой запрос"); }
  const action = String(payload.action ?? "");
  // Пароль из пульта тоже чистим по краям: браузеры любят подставлять пробел.
  const isShop = SHOP_PASSWORD.length > 0 &&
    sameSecret(String(payload.password ?? "").trim(), SHOP_PASSWORD);

  try {
    // ---------- проверка связи ----------
    if (action === "ping") {
      return json({
        ok: true,
        ready: true,
        notify: NOTIFY_KEY.length > 0,
        password: SHOP_PASSWORD.length > 0,   // задан ли пароль пульта на сервере
        shop: isShop,
      });
    }

    // ---------- посетитель ----------
    if (action === "start") {
      const secret = randomSecret();
      const { data, error } = await db.from("chats").insert({
        secret,
        name: cleanText(payload.name).slice(0, 80) || null,
        contact: cleanText(payload.contact).slice(0, 120) || null,
      }).select("id").single();
      if (error || !data) return fail("Не получилось открыть диалог", 500);
      return json({ ok: true, chatId: data.id, secret });
    }

    if (action === "send") {
      const chat = await loadChat(payload.chatId, payload.secret);
      if (!chat) return fail("Диалог не найден", 200);
      const body = cleanText(payload.body);
      const files = cleanFiles(payload.files);
      if (!body && files.length === 0) return fail("Пустое сообщение");
      if (await tooFast(chat.id)) return fail("Слишком часто, подождите минуту", 429);

      const { error } = await db.from("messages").insert({
        chat_id: chat.id, author: "user", body, files,
      });
      if (error) return fail("Не отправилось", 500);
      await db.from("chats").update({
        last_message_at: new Date().toISOString(),
        unread_for_shop: (chat.unread_for_shop ?? 0) + 1,
        name: cleanText(payload.name).slice(0, 80) || chat.name,
        contact: cleanText(payload.contact).slice(0, 120) || chat.contact,
      }).eq("id", chat.id);
      await notifyShop(chat, body, files.length);
      return json({ ok: true });
    }

    if (action === "poll") {
      const chat = await loadChat(payload.chatId, payload.secret);
      if (!chat) return fail("Диалог не найден", 200);
      const since = Number(payload.since) || 0;
      const { data } = await db.from("messages")
        .select("id, author, body, files, created_at")
        .eq("chat_id", chat.id).gt("id", since).order("id").limit(200);
      const items = [];
      for (const m of data ?? []) {
        items.push({ ...m, files: await signFiles(m.files as Array<Record<string, unknown>>) });
      }
      if (payload.read === true && (chat.unread_for_user ?? 0) > 0) {
        await db.from("chats").update({ unread_for_user: 0 }).eq("id", chat.id);
      }
      return json({ ok: true, messages: items, unread: payload.read === true ? 0 : chat.unread_for_user ?? 0 });
    }

    if (action === "upload-url") {
      const chat = await loadChat(payload.chatId, payload.secret);
      if (!chat) return fail("Диалог не найден", 200);
      const ticket = await uploadTicket(chat.id, payload.name, payload.type, payload.size);
      if ("error" in ticket) return fail(ticket.error as string);
      return json({ ok: true, ...ticket });
    }

    // ---------- пульт мастерской ----------
    if (action.startsWith("shop-")) {
      // Разделяем два разных случая, иначе непонятно, что чинить.
      if (!SHOP_PASSWORD) {
        return fail("На сервере не задан пароль. Добавьте SHOP_PASSWORD в Secrets и опубликуйте функцию заново", 403);
      }
      if (!isShop) return fail("Неверный пароль", 403);

      // Проверка почты: шлём письмо прямо сейчас и показываем ответ сервиса.
      if (action === "shop-mail-test") {
        if (!NOTIFY_KEY) {
          return json({ ok: false, error: "Ключ NOTIFY_KEY не задан в настройках функции" });
        }
        const sent = await sendMail(
          "АвтоБатя: проверка почты",
          "Это проверочное письмо из пульта. Если оно дошло, уведомления о сообщениях с сайта тоже будут доходить.",
        );
        return json({ ok: sent.ok, status: sent.status, answer: sent.answer });
      }

      if (action === "shop-list") {
        const { data } = await db.from("chats")
          .select("id, name, contact, created_at, last_message_at, unread_for_shop")
          .order("last_message_at", { ascending: false }).limit(60);
        const list = [];
        for (const c of data ?? []) {
          const { data: last } = await db.from("messages")
            .select("author, body, files, created_at")
            .eq("chat_id", c.id).order("id", { ascending: false }).limit(1).maybeSingle();
          list.push({
            ...c,
            preview: last ? (last.body || (Array.isArray(last.files) && last.files.length ? "Файл" : "")) : "",
            previewAuthor: last?.author ?? null,
          });
        }
        return json({ ok: true, chats: list });
      }

      if (action === "shop-poll") {
        const id = String(payload.chatId ?? "");
        const since = Number(payload.since) || 0;
        const { data } = await db.from("messages")
          .select("id, author, body, files, created_at")
          .eq("chat_id", id).gt("id", since).order("id").limit(300);
        const items = [];
        for (const m of data ?? []) {
          items.push({ ...m, files: await signFiles(m.files as Array<Record<string, unknown>>) });
        }
        if (payload.read === true) await db.from("chats").update({ unread_for_shop: 0 }).eq("id", id);
        return json({ ok: true, messages: items });
      }

      if (action === "shop-send") {
        const id = String(payload.chatId ?? "");
        const body = cleanText(payload.body);
        const files = cleanFiles(payload.files);
        if (!body && files.length === 0) return fail("Пустое сообщение");
        const { data: chat } = await db.from("chats").select("unread_for_user").eq("id", id).maybeSingle();
        if (!chat) return fail("Диалог не найден", 404);
        const { error } = await db.from("messages").insert({
          chat_id: id, author: "shop", body, files,
        });
        if (error) return fail("Не отправилось", 500);
        await db.from("chats").update({
          last_message_at: new Date().toISOString(),
          unread_for_shop: 0,
          unread_for_user: (chat.unread_for_user ?? 0) + 1,
        }).eq("id", id);
        return json({ ok: true });
      }

      if (action === "shop-upload-url") {
        const id = String(payload.chatId ?? "");
        const ticket = await uploadTicket(id, payload.name, payload.type, payload.size);
        if ("error" in ticket) return fail(ticket.error as string);
        return json({ ok: true, ...ticket });
      }
    }

    return fail("Неизвестное действие", 404);
  } catch (_e) {
    return fail("Внутренняя ошибка", 500);
  }
}
