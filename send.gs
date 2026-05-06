// Vibehuus invitation sender — Google Apps Script.
//
// Setup:
//   1. Make a Google Sheet with one column, header "email", one guest per row.
//   2. From that sheet: Extensions → Apps Script. Paste this file in.
//   3. Make sure email.html is committed and live at TEMPLATE_URL below
//      (the script fetches the deployed template, so push first).
//   4. Run sendInvites(). Approve Gmail + Sheets + UrlFetch on first run.
//
// Each row gets one personalized email; the "I'll be there" button links to
// vibehuus.be/confirm.html?e=<their-email>, which logs to Formspree.

const TEMPLATE_URL = "https://vibehuus.be/email.html";
const SUBJECT = "Vibehuus — Friday 5th June 2026";
const FROM_NAME = "Jeremy Isnard";

function sendInvites() {
  const html = UrlFetchApp.fetch(TEMPLATE_URL).getContentText();
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
    });
  });
}
