import {
  apiGetPlainCsv,
  parsePlainVaultCsv,
  makeKey,
  apiUpdateRecord,
  encryptPassword,
  encryptCard,
} from "./vault.js";

const $ = (sel) => document.querySelector(sel);

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function exportCsv(kind) {
  const url  = kind === "plain" ? "/api/vault/plain" : "/api/vault/encrypted";
  const name = kind === "plain" ? "vault_plain.csv"  : "vault_encrypted.csv";
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 100);
}

function cardTypeFromNumber(num) {
  const digits = (num || "").replace(/\s+/g, "");
  if (!digits) return { type: "unknown" };
  if (/^4/.test(digits)) return { type: "visa" };
  const first4 = Number(digits.slice(0, 4) || "0");
  const first2 = Number(digits.slice(0, 2) || "0");
  if ((first2 >= 51 && first2 <= 55) || (first4 >= 2221 && first4 <= 2720)) return { type: "mastercard" };
  if (/^(34|37)/.test(digits)) return { type: "amex" };
  if (/^(30[0-5]|36|38|39)/.test(digits)) return { type: "diners" };
  if (/^35/.test(digits)) return { type: "jcb" };
  if (/^(6011|65|64[4-9]|622)/.test(digits)) return { type: "discover" };
  if (/^62/.test(digits)) return { type: "unionpay" };
  if (/^220[0-4]/.test(digits)) return { type: "mir" };
  if (/^(50|5[6-9]|6\d)/.test(digits)) return { type: "maestro" };
  return { type: "unknown" };
}

function luhnValid(numberDigits) {
  const s = (numberDigits || "").replace(/\s+/g, "");
  if (!/^\d+$/.test(s)) return false;
  let sum = 0, alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = Number(s[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

function updateResultCardLogo(number) {
  const { type } = cardTypeFromNumber(number);
  $("#rCardLogo").src = `./assets/cards/${type || "unknown"}.svg`;
  $("#rCardType").textContent = type && type !== "unknown" ? `Card type: ${type}` : "";
}

function hideCardFields() {
  ["#rCardNumber", "#rCardName", "#rCardExp", "#rCardCvc", "#rCardZip"].forEach((sel) => {
    const el = $(sel);
    if (el) el.type = "password";
  });
  document.querySelectorAll(".revealBtn").forEach((btn) => btn.classList.remove("is-visible"));
}

// ----- Results list (multi-match) -----

let _currentResults = [];  // all matched records from last search

function showResultsList(records) {
  _currentResults = records;

  // Hide the single-entry editor
  hideResult();

  const list = $("#resultsList");
  const body = $("#resultsBody");
  const count = $("#resultsCount");

  count.textContent = `${records.length} entr${records.length === 1 ? "y" : "ies"} found`;
  body.innerHTML = "";

  records.forEach((rec, idx) => {
    const tr = document.createElement("tr");
    tr.className = "resultsRow";
    tr.dataset.idx = String(idx);

    const cardType = rec.cardType || (rec.cardNumber ? cardTypeFromNumber(rec.cardNumber).type : "");
    const dateStr = rec.createdAt ? new Date(rec.createdAt).toLocaleDateString() : "—";

    tr.innerHTML = `
      <td>${escHtml(rec.website || "")}</td>
      <td>${escHtml(rec.username || "")}</td>
      <td>${escHtml(cardType || "—")}</td>
      <td>${escHtml(dateStr)}</td>
    `;

    tr.addEventListener("click", () => {
      // highlight selected row
      document.querySelectorAll(".resultsRow").forEach((r) => r.classList.remove("is-selected"));
      tr.classList.add("is-selected");
      openEntry(records[idx]);
    });

    body.appendChild(tr);
  });

  list.classList.remove("hidden");

  // If there's only one match go straight to the editor
  if (records.length === 1) {
    openEntry(records[0]);
  }
}

function hideResultsList() {
  $("#resultsList").classList.add("hidden");
  _currentResults = [];
}

// ----- Single-entry editor -----

function openEntry(found) {
  $("#result").classList.remove("hidden");
  // Show "← All results" only when there are multiple
  $("#backToListBtn").style.display = _currentResults.length > 1 ? "" : "none";

  $("#resultHeading").textContent = `${found.website || ""}  —  ${found.username || ""}`;
  $("#rWebsite").value = found.website ?? "";
  $("#rUsername").value = found.username ?? "";
  $("#rPassword").value = found.password ?? "";
  $("#rCardNumber").value = found.cardNumber ?? "";
  $("#rCardName").value   = found.cardName   ?? "";
  $("#rCardExp").value    = found.cardExp    ?? "";
  $("#rCardCvc").value = found.cardCvc ?? "";
  $("#rCardZip").value = found.cardZip ?? "";
  $("#rCreated").textContent = found.createdAt ? `Saved: ${found.createdAt}` : "";
  $("#saveErrors").textContent = "";

  hideCardFields();
  updateResultCardLogo(found.cardNumber ?? "");

  $("#result").dataset.originalKey = makeKey(found.website, found.username);

  // Scroll editor into view smoothly
  $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideResult() {
  const res = $("#result");
  res.classList.add("hidden");
  delete res.dataset.originalKey;
  $("#saveErrors").textContent = "";
  hideCardFields();
}

function clearAll() {
  hideResult();
  hideResultsList();
}

// ----- Search -----

async function loadPlain() {
  const csvText = await apiGetPlainCsv();
  return parsePlainVaultCsv(csvText);
}

async function search() {
  clearAll();

  const qWebsite  = $("#qWebsite").value.trim().toLowerCase();
  const qUsername = $("#qUsername").value.trim().toLowerCase();
  const qPassword = $("#qPassword").value;
  const qCard     = $("#qCardNumber").value.trim().replace(/\s+/g, "");

  if (!qWebsite && !qUsername && !qPassword && !qCard) {
    toast("Enter at least one search field.");
    return;
  }

  let plain;
  try {
    plain = await loadPlain();
  } catch (e) {
    toast("Could not read vault files. Run python server.py");
    console.error(e);
    return;
  }

  let candidates = plain;

  // Website: partial, case-insensitive match so "google" matches "google.com"
  if (qWebsite) {
    candidates = candidates.filter((r) =>
      (r.website || "").toLowerCase().includes(qWebsite)
    );
  }
  // Username: exact match (case-insensitive) when provided
  if (qUsername) {
    candidates = candidates.filter((r) =>
      (r.username || "").toLowerCase() === qUsername
    );
  }
  if (qPassword) {
    candidates = candidates.filter((r) => (r.password ?? "") === qPassword);
  }
  if (qCard) {
    candidates = candidates.filter((r) => (r.cardNumber ?? "") === qCard);
  }

  if (!candidates.length) {
    toast("No match found");
    return;
  }

  showResultsList(candidates);
}

// ----- Save changes -----

async function saveChanges() {
  const originalKey = $("#result").dataset.originalKey;
  if (!originalKey) {
    $("#saveErrors").textContent = "Search first.";
    return;
  }

  const website    = $("#rWebsite").value.trim();
  const username   = $("#rUsername").value.trim();
  const password   = $("#rPassword").value;
  const cardNumber = $("#rCardNumber").value.trim().replace(/\s+/g, "");
  const cardName   = $("#rCardName").value.trim();
  const cardExp    = $("#rCardExp").value.trim();
  const cardCvc    = $("#rCardCvc").value.trim();
  const cardZip    = $("#rCardZip").value.trim();

  const errors = [];
  if (!password) errors.push("Password cannot be empty.");
  if (cardNumber) {
    if (!/^\d+$/.test(cardNumber)) errors.push("Card number digits only.");
    else if (!(cardNumber.length === 15 || cardNumber.length === 16)) errors.push("Card number should be 15 or 16 digits.");
    else if (!luhnValid(cardNumber)) errors.push("Card number failed validity check.");
  }
  if (cardZip && !/^\d{5}$/.test(cardZip)) errors.push("Zip code must be exactly 5 digits.");

  if (errors.length) {
    $("#saveErrors").textContent = errors.join("  ");
    return;
  }

  const { encPassword, ivPassword } = await encryptPassword(password);
  const { encCard, ivCard } = await encryptCard({ cardNumber, cardName, cardExp, cardCvc, cardZip });
  const cardType = cardTypeFromNumber(cardNumber).type;

  try {
    await apiUpdateRecord({
      originalKey,
      website,
      username,
      password,
      cardNumber,
      cardName,
      cardExp,
      cardCvc,
      cardZip,
      cardType,
      encPassword,
      ivPassword,
      encCard,
      ivCard,
    });

    toast("Changes saved");
    $("#saveErrors").textContent = "";

    const updatedKey = makeKey(website, username);
    $("#result").dataset.originalKey = updatedKey;
    updateResultCardLogo(cardNumber);

    // Refresh the in-memory list so the table reflects any username/website edits
    if (_currentResults.length > 1) {
      const idx = _currentResults.findIndex((r) => makeKey(r.website, r.username) === originalKey);
      if (idx >= 0) {
        _currentResults[idx] = { ..._currentResults[idx], website, username, password, cardNumber, cardName, cardExp, cardCvc, cardZip, cardType };
        showResultsList(_currentResults);
        openEntry(_currentResults[idx]);
        // re-highlight the row
        const rows = document.querySelectorAll(".resultsRow");
        if (rows[idx]) rows[idx].classList.add("is-selected");
      }
    }
  } catch (e) {
    $("#saveErrors").textContent = String(e?.message || e);
  }
}

// ----- Helpers -----

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ----- Init -----

function init() {
  $("#searchBtn").addEventListener("click", search);
  $("#saveBtn").addEventListener("click", saveChanges);

  // Back-to-list button
  $("#backToListBtn").addEventListener("click", () => {
    hideResult();
    document.querySelectorAll(".resultsRow").forEach((r) => r.classList.remove("is-selected"));
    $("#resultsList").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // Allow Enter key to trigger search from any input
  ["#qWebsite","#qUsername","#qPassword","#qCardNumber"].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
  });

  // Reveal/hide toggles
  document.querySelectorAll(".revealBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      btn.classList.toggle("is-visible", isHidden);
    });
  });

  $("#rCardNumber").addEventListener("input", (e) => updateResultCardLogo(e.target.value));

  const exportPlainBtn = $("#exportPlainBtn");
  const exportEncBtn = $("#exportEncBtn");
  if (exportPlainBtn) exportPlainBtn.addEventListener("click", () => {
    try { exportCsv("plain"); } catch(e) { toast("Export failed"); }
  });
  if (exportEncBtn) exportEncBtn.addEventListener("click", () => {
    try { exportCsv("encrypted"); } catch(e) { toast("Export failed"); }
  });

  $("#backLink").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "./index.html";
  });
}

init();
