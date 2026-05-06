// Replace with the ID after /f/ in your Formspree endpoint URL.
const FORMSPREE_ID = "xaqvodbo";

const params = new URLSearchParams(location.search);
const email = params.get("e");
const statusEl = document.getElementById("status");
const stampEl = document.getElementById("stamp");

function show(msg, sub) {
  statusEl.textContent = msg;
  if (sub) stampEl.textContent = sub;
}

if (!email) {
  show("Missing email — please use the link from your invitation.");
} else if (FORMSPREE_ID === "REPLACE_ME") {
  show("Confirmation endpoint not configured yet.");
} else {
  const confirmedAt = new Date().toISOString();
  fetch("https://formspree.io/f/" + FORMSPREE_ID, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: email,
      status: "confirmed",
      confirmed_at: confirmedAt,
    }),
  })
    .then(function (r) {
      if (!r.ok) throw new Error("Formspree returned " + r.status);
      show(
        "You're in. See you on the 5th.",
        "Confirmed " + email + " · " + confirmedAt,
      );
    })
    .catch(function (err) {
      show("Something went wrong. Please reply to the email instead.");
      console.error(err);
    });
}
