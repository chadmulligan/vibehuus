// Vibehuus invitation sender — Node script.
//
// Setup:
//   1. Make a CSV named guests.csv with headers "email,status", one guest per row.
//      Leave status blank to queue a send. After a successful send the row's
//      status is set to "sent <ISO timestamp>" and skipped on subsequent runs.
//   2. Put RESEND_API_KEY=re_xxx in a .env file (get a key at resend.com/api-keys).
//   3. Set FROM_EMAIL below to an address on a domain you've verified in Resend.
//   4. Make sure email.html is committed and live at TEMPLATE_URL below
//      (the script fetches the deployed template, so push first).
//   5. Run: node send.js   (requires Node 20.12+ for built-in .env loading)
//
// Each row gets one personalized email with a vibehuus.ics calendar
// attachment; the "I'll be there" button links to
// vibehuus.be/confirm.html?e=<their-email>, which logs to Formspree.

import { readFileSync, writeFileSync } from "node:fs";

const TEMPLATE_URL = "https://vibehuus.be/email.html";
const SUBJECT = "Vibehuus — Friday 5th June 2026";
const FROM_NAME = "Pawel + Jeremy";
const FROM_EMAIL = "vibeday@vibehuus.be";
const GUESTS_CSV = "guests.csv";

// Event times in UTC. June 2026 is CEST (UTC+2), so 07:00Z = 09:00 local.
const EVENT_START_UTC = "20260605T070000Z";
const EVENT_END_UTC = "20260605T150000Z";
const EVENT_LOCATION = "Haus am Fluss, Altenbergstrasse 29, 3013 Bern";

async function sendInvites() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env is optional — env vars from the shell still work.
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey)
    throw new Error("Missing RESEND_API_KEY (set in .env or shell).");

  const rawHtml = await fetch(TEMPLATE_URL).then((r) => r.text());
  const html = absolutizeUrls(inlineStyles(rawHtml), TEMPLATE_URL);
  const icsBase64 = Buffer.from(buildIcs()).toString("base64");

  const [header, ...rows] = readFileSync(GUESTS_CSV, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(",").map((c) => c.trim()));

  const sent = [];
  for (const row of rows) {
    const [email, status] = [row[0] || "", row[1] || ""];
    if (!email || status) continue;

    const body = html.replace(/{{email}}/g, encodeURIComponent(email));
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to: [email],
        subject: SUBJECT,
        html: body,
        attachments: [
          {
            filename: "vibehuus.ics",
            content: icsBase64,
            content_type: "text/calendar",
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`Failed for ${email} (${res.status}): ${await res.text()}`);
      continue;
    }
    row[1] = `sent ${new Date().toISOString()}`;
    sent.push(email);
    writeFileSync(
      GUESTS_CSV,
      [header, ...rows].map((r) => r.join(",")).join("\n") + "\n",
    );
  }

  console.log(`\nSent ${sent.length} invite${sent.length === 1 ? "" : "s"}:`);
  sent.forEach((e) => console.log(`  ${e}`));
}

// Rewrite relative src/href values (e.g. "title.png") to absolute URLs against
// the template base, so email clients can resolve them. Local-relative paths
// would otherwise 404 in the recipient's inbox.
function absolutizeUrls(html, baseUrl) {
  return html.replace(
    /\s(src|href)="(?!https?:|mailto:|#|data:|\{\{)([^"]+)"/gi,
    (_m, attr, value) => ` ${attr}="${new URL(value, baseUrl).href}"`,
  );
}

// Inline class-based CSS rules from the <style> block onto each matching
// element. Many email clients (Gmail mobile, Outlook, Yahoo) ignore <style>
// blocks or strip class attributes — inlining is the only reliable way to
// preserve fonts, the CTA color, and the rest of the visual styling.
function inlineStyles(html) {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  if (!styleMatch) return html;
  let css = styleMatch[1];

  // Strip @media blocks (must stay conditional in <style>) and CSS comments.
  css = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, "");
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const rules = {};
  const ruleRe = /\.([\w-]+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    const cls = m[1];
    const decls = m[2]
      .replace(/\s+/g, " ")
      .trim()
      .replace(/;\s*$/, "")
      .replace(/"/g, "'");
    if (!decls) continue;
    rules[cls] = rules[cls] ? `${rules[cls]}; ${decls}` : decls;
  }

  return html.replace(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, (match, tag, attrs) => {
    const classMatch = attrs.match(/\sclass="([^"]+)"/);
    if (!classMatch) return match;
    const merged = classMatch[1]
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => rules[c])
      .filter(Boolean)
      .join("; ");
    if (!merged) return match;

    const styleAttr = attrs.match(/\sstyle="([^"]*)"/);
    const existing = styleAttr ? styleAttr[1].replace(/;\s*$/, "") : "";
    const combined = existing ? `${merged}; ${existing}` : merged;
    const newAttrs = styleAttr
      ? attrs.replace(/\sstyle="[^"]*"/, ` style="${combined}"`)
      : `${attrs} style="${combined}"`;
    return `<${tag}${newAttrs}>`;
  });
}

function buildIcs() {
  const dtstamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vibehuus//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:vibehuus-2026-06-05@vibehuus.be",
    "DTSTAMP:" + dtstamp,
    "DTSTART:" + EVENT_START_UTC,
    "DTEND:" + EVENT_END_UTC,
    "SUMMARY:Vibehuus",
    "LOCATION:" + EVENT_LOCATION,
    "DESCRIPTION:Beyond the prototype: vibecoding for production.",
    "URL:https://vibehuus.be",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

sendInvites();
