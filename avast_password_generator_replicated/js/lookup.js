import {
  apiGetPlainCsv,
  parsePlainVaultCsv,
  makeKey,
  apiUpdateRecord,
  encryptSensitive,
} from "./vault.js";

const $ = (sel) => document.querySelector(sel);

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
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

function updateResultCardLogo(number) {
  const { type } = cardTypeFromNumber(number);
  $("#rCardLogo").src = `./assets/cards/${type || "unknown"}.svg`;
  $("#rCardType").textContent = type ? `Card type: ${type}` : "";
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

function applyResult(found) {
  $("#result").classList.remove("hidden");
  $("#rWebsite").value = found.website ?? "";
  $("#rUsername").value = found.username ?? "";
  $("#rPassword").value = found.password ?? "";
  $("#rCardNumber").value = found.cardNumber ?? "";
  $("#rCreated").textContent = found.createdAt ? `Saved: ${found.createdAt}` : "";
  $("#saveErrors").textContent = "";
  updateResultCardLogo(found.cardNumber ?? "");
}

function clearResult() {
  // Always clear the previously shown result before a new search attempt.
  const res = $("#result");
  res.classList.add("hidden");
  delete res.dataset.originalKey;

  $("#rWebsite").value = "";
  $("#rUsername").value = "";
  $("#rPassword").value = "";
  $("#rCardNumber").value = "";
  $("#rCreated").textContent = "";
  $("#saveErrors").textContent = "";
  $("#rCardLogo").src = "./assets/cards/unknown.svg";
  $("#rCardType").textContent = "";
}

async function loadPlain() {
  const csvText = await apiGetPlainCsv();
  return parsePlainVaultCsv(csvText);
}

async function search() {
  // If the user searches again (even with empty / invalid inputs),
  // the last displayed entry should not remain visible.
  clearResult();

  const qWebsite = $("#qWebsite").value.trim();
  const qUsername = $("#qUsername").value.trim();
  const qPassword = $("#qPassword").value;
  const qCard = $("#qCardNumber").value.trim().replace(/\s+/g, "");

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

  if (qWebsite && qUsername) {
    const key = makeKey(qWebsite, qUsername);
    candidates = candidates.filter((r) => makeKey(r.website, r.username) === key);
  }
  if (qPassword) {
    candidates = candidates.filter((r) => (r.password ?? "") === qPassword);
  }
  if (qCard) {
    candidates = candidates.filter((r) => (r.cardNumber ?? "") === qCard);
  }

  const found = candidates[0];
  if (!found) {
    toast("No match found");
    return;
  }

  const originalKey = makeKey(found.website, found.username);
  $("#result").dataset.originalKey = originalKey;

  applyResult(found);
}

async function saveChanges() {
  const originalKey = $("#result").dataset.originalKey;
  if (!originalKey) {
    $("#saveErrors").textContent = "Search first.";
    return;
  }

  const website = $("#rWebsite").value.trim();
  const username = $("#rUsername").value.trim();
  const password = $("#rPassword").value;
  const cardNumber = $("#rCardNumber").value.trim().replace(/\s+/g, "");

  const errors = [];
  if (!password) errors.push("Password cannot be empty.");
  if (cardNumber) {
    if (!/^\d+$/.test(cardNumber)) errors.push("Card number digits only.");
    else if (!(cardNumber.length === 15 || cardNumber.length === 16)) errors.push("Card number should be 15 or 16 digits.");
    else if (!luhnValid(cardNumber)) errors.push("Card number failed validity check.");
  }

  if (errors.length) {
    $("#saveErrors").textContent = errors.join("  ");
    return;
  }

  // encrypted payload includes password and cardNumber; exp/cvc are not editable on this page
  const sensitive = {
    password,
    cardNumber,
    cardExp: "",
    cardCvc: "",
  };
  const { encPayload, iv } = await encryptSensitive(sensitive);
  const cardType = cardTypeFromNumber(cardNumber).type;

  try {
    await apiUpdateRecord({
      originalKey,
      website,
      username,
      password,
      cardNumber,
      cardType,
      encPayload,
      iv,
    });

    toast("Changes saved");
    $("#saveErrors").textContent = "";

    const updatedOriginalKey = makeKey(website, username);
    $("#result").dataset.originalKey = updatedOriginalKey;

    updateResultCardLogo(cardNumber);
  } catch (e) {
    $("#saveErrors").textContent = String(e?.message || e);
  }
}

function init() {
  $("#searchBtn").addEventListener("click", search);
  $("#saveBtn").addEventListener("click", saveChanges);

  $("#rCardNumber").addEventListener("input", (e) => updateResultCardLogo(e.target.value));

  const exportPlainBtn = $("#exportPlainBtn");
  const exportEncBtn = $("#exportEncBtn");
  if (exportPlainBtn) exportPlainBtn.addEventListener("click", async () => {
    try { await exportCsv("plain"); } catch(e){ toast("Export failed"); }
  });
  if (exportEncBtn) exportEncBtn.addEventListener("click", async () => {
    try { await exportCsv("encrypted"); } catch(e){ toast("Export failed"); }
  });

  $("#backLink").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "./index.html";
  });
}

init();
