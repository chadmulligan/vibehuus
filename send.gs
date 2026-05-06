// Vibehuus invitation sender — Google Apps Script.
//
// Setup:
//   1. Make a Google Sheet with one column, header "email", one guest per row.
//   2. From that sheet: Extensions → Apps Script. Paste this file in.
//   3. Make sure email.html is committed and live at TEMPLATE_URL below
//      (the script fetches the deployed template, so push first).
//   4. Run sendInvites(). Approve Gmail + Sheets + UrlFetch on first run.
//
// Each row gets one personalized email with a vibehuus.ics calendar
// attachment; the "I'll be there" button links to
// vibehuus.be/confirm.html?e=<their-email>, which logs to Formspree.

const TEMPLATE_URL = "https://vibehuus.be/email.html";
const SUBJECT = "Vibehuus — Friday 5th June 2026";
const FROM_NAME = "Jeremy Isnard";

// Event times in UTC. June 2026 is CEST (UTC+2), so 07:00Z = 09:00 local.
const EVENT_START_UTC = "20260605T070000Z";
const EVENT_END_UTC = "20260605T150000Z";
const EVENT_LOCATION = "Haus am Fluss, Altenbergstrasse 29, 3013 Bern";

function sendInvites() {
  const html = UrlFetchApp.fetch(TEMPLATE_URL).getContentText();
  const ics = buildIcs();
  const rows = SpreadsheetApp.getActiveSheet()
    .getDataRange()
    .getValues()
    .slice(1);

  rows.forEach(function (row) {
    const email = (row[0] || "").toString().trim();
    if (!email) return;
    const body = html.replace(/{{email}}/g, encodeURIComponent(email));
    GmailApp.sendEmail(email, SUBJECT, "", {
      htmlBody: body,
      name: FROM_NAME,
      attachments: [ics],
    });
  });
}

function buildIcs() {
  const dtstamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
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
  ];
  return Utilities.newBlob(lines.join("\r\n"), "text/calendar", "vibehuus.ics");
}
