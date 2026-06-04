// Vibehuus agenda sender — Node script.
//
// Mirrors send.js: same Resend delivery and the same CSV status-tracking
// pattern, with a different template + subject and its OWN recipient list so
// it never collides with the invite send.
//
// Setup:
//   1. Recipients live in agenda-recipients.csv (headers "email,status"),
//      one per row. Leave status blank to queue a send; after a successful
//      send the row is stamped "sent <ISO timestamp>" and skipped next run.
//      If that file is missing, it's seeded from the unique emails in
//      guests.csv (so the two sends share one source of truth without
//      sharing a status column).
//   2. Put RESEND_API_KEY=re_xxx in a .env file (same key as the invites).
//   3. FROM_EMAIL must be on a domain verified in Resend.
//   4. The agenda page itself is the template — it's built email-safe
//      (table layout, inline styles) for exactly this. Make sure it's
//      committed and live at TEMPLATE_URL below (the script fetches the
//      deployed page, so push first). Note the trailing slash so the page's
//      relative URLs resolve correctly.
//   5. Run: node send-agenda.js   (requires Node 20.12+ for built-in .env)
//
// Flags:
//   --dry-run                list who would receive, send nothing
//   --render-only[=file]     fetch + transform the template and WRITE the
//                            exact email HTML to a file (no API key, no send);
//                            defaults to agenda-email.preview.html
//   --template=<url>         override the source URL — handy to render against
//                            a local preview server before the page is live,
//                            e.g. --template=http://localhost:8137/20260605/agenda/
//
// Typical flow: preview locally, deploy, then send:
//   node send-agenda.js --render-only --template=http://localhost:8137/20260605/agenda/
//   (push so the page is live) ; node send-agenda.js

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const TEMPLATE_URL = flagValue("template") || "https://vibehuus.be/20260605/agenda/";
const SUBJECT = "Vibehuus — the agenda for Friday 5th June";
const FROM_NAME = "Pawel + Jeremy";
const FROM_EMAIL = "vibeday@vibehuus.be";
const RECIPIENTS_CSV = "agenda-recipients.csv";
const GUESTS_CSV = "guests.csv";

const DRY_RUN = argv.includes("--dry-run");
const RENDER_ONLY =
  flagValue("render-only") ??
  (argv.includes("--render-only") ? "agenda-email.preview.html" : undefined);

async function sendAgenda() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env is optional — env vars from the shell still work.
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey && !DRY_RUN && !RENDER_ONLY)
    throw new Error("Missing RESEND_API_KEY (set in .env or shell).");

  const rawHtml = await fetch(TEMPLATE_URL).then((r) => r.text());
  const html = absolutizeUrls(inlineStyles(rawHtml), TEMPLATE_URL);

  // --render-only: dump the exact email HTML and stop. Lets you eyeball the
  // real output (or open it in a browser) before deploying or sending.
  if (RENDER_ONLY) {
    writeFileSync(RENDER_ONLY, html);
    console.log(`Wrote rendered email HTML to ${RENDER_ONLY} (no send).`);
    return;
  }

  ensureRecipients();

  const [header, ...rows] = readFileSync(RECIPIENTS_CSV, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(",").map((c) => c.trim()));

  const sent = [];
  for (const row of rows) {
    const [email, status] = [row[0] || "", row[1] || ""];
    if (!email || status) continue;

    const body = html.replace(/{{email}}/g, encodeURIComponent(email));

    if (DRY_RUN) {
      console.log(`  [dry-run] would send to ${email}`);
      continue;
    }

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
      }),
    });
    if (!res.ok) {
      console.error(`Failed for ${email} (${res.status}): ${await res.text()}`);
      continue;
    }
    row[1] = `sent ${new Date().toISOString()}`;
    sent.push(email);
    writeFileSync(
      RECIPIENTS_CSV,
      [header, ...rows].map((r) => r.join(",")).join("\n") + "\n",
    );
  }

  if (DRY_RUN) {
    console.log("\nDry run — nothing was sent.");
    return;
  }
  console.log(`\nSent ${sent.length} agenda email${sent.length === 1 ? "" : "s"}:`);
  sent.forEach((e) => console.log(`  ${e}`));
}

// Seed agenda-recipients.csv from the unique emails in guests.csv the first
// time we run, so the agenda send reaches the same people as the invites
// without sharing (and clobbering) the invite status column.
function ensureRecipients() {
  if (existsSync(RECIPIENTS_CSV)) return;
  if (!existsSync(GUESTS_CSV)) {
    writeFileSync(RECIPIENTS_CSV, "email,status\n");
    console.log(`Created empty ${RECIPIENTS_CSV} — add recipients and re-run.`);
    return;
  }
  const [, ...rows] = readFileSync(GUESTS_CSV, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(",").map((c) => c.trim()));

  const seen = new Set();
  const emails = [];
  for (const row of rows) {
    const email = row[0] || "";
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  writeFileSync(
    RECIPIENTS_CSV,
    ["email,status", ...emails.map((e) => `${e},`)].join("\n") + "\n",
  );
  console.log(
    `Seeded ${RECIPIENTS_CSV} with ${emails.length} recipient(s) from ${GUESTS_CSV}.`,
  );
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

sendAgenda();
