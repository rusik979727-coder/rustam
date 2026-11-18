/**
 * Белес CRM — WhatsApp көпірі (Cloudflare Worker).
 *
 * Meta (WhatsApp Cloud API) → осы көпір → Белес CRM (Google Apps Script).
 *
 * Cloudflare-де қойылатын айнымалылар (Settings → Variables and Secrets, түрі: Secret):
 *   APP_SECRET   — Meta приложениесінің App Secret кілті (App settings → Basic)
 *   VERIFY_TOKEN — өзіңіз ойлап табатын кез келген ұзын сөз; Meta-да да дәл соны жазасыз
 *   CRM_HOOK     — CRM-нің «Сілтемелер» парағындағы «Автоматтандыру (webhook)» сілтемесі (толық, ?token=… қоса)
 *
 * Көпір тек кіріс хабарламаларды қабылдайды. Ешкімге хабарлама жібермейді.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) Meta-ның бір реттік тексеруі (Webhook-ты қосқанда)
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && env.VERIFY_TOKEN && token === env.VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      if (mode) return new Response('Verify token сәйкес емес', { status: 403 });
      return new Response('Белес WhatsApp көпірі жұмыс істеп тұр.', { status: 200 });
    }

    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    // 2) Хабарлама шынымен Meta-дан келгенін тексеру (X-Hub-Signature-256)
    const raw = await request.text();
    const ok = await verifySignature(raw, request.headers.get('x-hub-signature-256'), env.APP_SECRET);
    if (!ok) return new Response('Bad signature', { status: 401 });

    let body;
    try { body = JSON.parse(raw); } catch (e) { return new Response('Bad JSON', { status: 400 }); }

    // 3) Кіріс хабарламаларды CRM пішіміне аудару
    const leads = extractLeads(body);

    // 4) Meta-ға бірден 200 қайтарамыз, ал CRM-ге фонда жібереміз
    if (leads.length && env.CRM_HOOK) {
      ctx.waitUntil(Promise.all(leads.map(lead => sendToCrm(env.CRM_HOOK, lead))));
    }
    return new Response('OK', { status: 200 });
  }
};

/** Meta-ның HMAC-SHA256 қолтаңбасын тексеру. */
async function verifySignature(raw, header, secret) {
  if (!header || !secret || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, header.slice(7).toLowerCase());
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** WhatsApp Cloud API хабарламасынан: нөмір, аты, мәтін, жарнама. Жеткізу статустарын елемейді. */
function extractLeads(body) {
  const out = [];
  if (!body || body.object !== 'whatsapp_business_account') return out;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = {};
      for (const c of v.contacts || []) names[c.wa_id] = c.profile && c.profile.name;
      for (const m of v.messages || []) {
        const ref = m.referral || null;
        out.push({
          phone: m.from,
          name: names[m.from] || '',
          text: messageText(m),
          source: ref ? (ref.headline || ref.source_id || 'WhatsApp жарнама') : 'WhatsApp',
          ad: ref ? { headline: ref.headline || '', source_id: ref.source_id || '', source_type: ref.source_type || '', source_url: ref.source_url || '' } : null
        });
      }
    }
  }
  return out;
}

function messageText(m) {
  switch (m.type) {
    case 'text': return (m.text && m.text.body) || '';
    case 'button': return (m.button && m.button.text) || '';
    case 'interactive': {
      const i = m.interactive || {};
      return (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '[interactive]';
    }
    case 'image': return '[сурет]' + (m.image && m.image.caption ? ' ' + m.image.caption : '');
    case 'audio': return '[дауыстық хабарлама]';
    case 'video': return '[видео]';
    case 'document': return '[құжат]';
    case 'location': return '[геолокация]';
    case 'sticker': return '[стикер]';
    default: return '[' + (m.type || 'хабарлама') + ']';
  }
}

/** CRM-ге жіберу. Google бірінші жауабында бағыттау (302) қайтарады — бұл қалыпты, сұраныс сол кезде орындалып қойған. */
async function sendToCrm(hook, lead) {
  try {
    await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lead), redirect: 'follow' });
  } catch (e) {
    console.log('CRM-ге жіберу сәтсіз:', e && e.message);
  }
}
