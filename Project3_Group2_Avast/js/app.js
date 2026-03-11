import { psiInit, psiAnalyze } from "./psi_lib.js";
import { encryptSensitive, encryptPassword, encryptCard, apiSaveRecord } from "./vault.js";

const CSS = {
  main: "c-pwd-gen",
  passwordInput: "c-pwd-gen__password-generated",
  rangeSlider: "c-pwd-gen__slider",
  lengthValue: "c-pwd-gen__length-value",
  decrementBtn: "c-pwd-gen--decrement",
  incrementBtn: "c-pwd-gen--increment",
  complexityCheckbox: "c-pwd-gen__custom-control-input",
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function setSliderFill(sliderEl){
  if (!sliderEl) return;
  const min = Number(sliderEl.min || 0);
  const max = Number(sliderEl.max || 100);
  const val = Number(sliderEl.value || 0);
  const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
  // blue fill on the left, light track on the right (Avast-like)
  sliderEl.style.background = `linear-gradient(to right, var(--blue) 0%, var(--blue) ${pct}%, #e8edf5 ${pct}%, #e8edf5 100%)`;
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

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function prettyRequire(moduleId) {
  if (!window.PrettyBundle?.require) throw new Error("Pretty bundle not ready. Did pretty_runtime.js load?");
  return window.PrettyBundle.require(moduleId);
}

function generatePassword(pattern, length) {
  // randomatic(pattern, length) from the prettyrandompasswordgenerator bundle (module 8407)
  const randomatic = prettyRequire(8407);
  return randomatic(pattern, Number(length));
}

function getPrettyScore(password) {
  // zxcvbn(password) from the prettyrandompasswordgenerator bundle (module 7065)
  const zxcvbn = prettyRequire(7065);
  return zxcvbn(password);
}

function prettyLabel(score0to4) {
  const s = Number(score0to4 ?? 0);
  if (s <= 0) return "Very weak";
  if (s === 1) return "Weak";
  if (s === 2) return "Good";
  if (s === 3) return "Strong";
  return "Very strong";
}

function psiLabel(category) {
  // PSI categories come in Title Case already ("Very Strong")
  // Make it match Avast-ish formatting.
  return String(category || "").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

function strengthImgPath(idx0to4) {
  const n = Math.max(1, Math.min(5, idx0to4 + 1));
  return `./assets/Password-Generator-${n}.svg`;
}

function setPill(pillEl, idx0to4, text) {
  pillEl.textContent = text;
  pillEl.classList.remove("s0", "s1", "s2", "s3", "s4");
  pillEl.classList.add(`s${idx0to4}`);
}

const RANDOM_FILL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function getRandomChar() {
  return RANDOM_FILL[Math.floor(Math.random() * RANDOM_FILL.length)];
}

function animateToNewPassword(inputEl, newPass) {
  const old = inputEl.value || "";
  const len = Math.max(old.length, newPass.length);

  for (let i = 0; i < len; i++) {
    setTimeout(() => {
      const ch = newPass[i] || "";
      let s = inputEl.value.substring(0, i) + ch;
      for (let j = i + 1; j < newPass.length; j++) s += getRandomChar();
      inputEl.value = s;
    }, 40 * i);
  }

  setTimeout(() => {
    inputEl.value = newPass;
  }, 40 * len + 10);
}

function cardTypeFromNumber(num) {
  const digits = (num || "").replace(/\s+/g, "");
  if (!digits) return { type: "unknown" };

  // Visa
  if (/^4/.test(digits)) return { type: "visa" };

  // Mastercard: 51–55 or 2221–2720
  const first4 = Number(digits.slice(0, 4) || "0");
  const first2 = Number(digits.slice(0, 2) || "0");
  if ((first2 >= 51 && first2 <= 55) || (first4 >= 2221 && first4 <= 2720)) return { type: "mastercard" };

  // Amex
  if (/^(34|37)/.test(digits)) return { type: "amex" };

  // Diners Club
  if (/^(30[0-5]|36|38|39)/.test(digits)) return { type: "diners" };

  // JCB
  if (/^35/.test(digits)) return { type: "jcb" };

  // Discover
  if (/^(6011|65|64[4-9]|622)/.test(digits)) return { type: "discover" };

  // UnionPay
  if (/^62/.test(digits)) return { type: "unionpay" };

  // Mir (RU)
  if (/^220[0-4]/.test(digits)) return { type: "mir" };

  // Maestro (common prefixes)
  if (/^(50|5[6-9]|6\d)/.test(digits)) return { type: "maestro" };

  return { type: "unknown" };
}

function luhnValid(numberDigits) {
  const s = (numberDigits || "").replace(/\s+/g, "");
  if (!/^\d+$/.test(s)) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = Number(s[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function validateExp(exp) {
  const raw = (exp || "").trim();
  if (!raw) return { ok: true, msg: "" }; // optional overall; checked elsewhere
  const m = raw.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) return { ok: false, msg: "Use MM/YY or MM/YYYY." };

  let mm = Number(m[1]);
  let yy = Number(m[2]);
  if (mm < 1 || mm > 12) return { ok: false, msg: "Month must be 01–12." };
  if (String(m[2]).length === 2) yy += 2000;

  const now = new Date();
  const expMonthStartNext = new Date(yy, mm, 1);
  const thisMonthStartNext = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  if (expMonthStartNext < thisMonthStartNext) return { ok: false, msg: "Card is expired." };
  return { ok: true, msg: "" };
}

function validateCard({ number, cvc, exp, zip, name }) {
  const num = (number || "").replace(/\s+/g, "");
  const anyProvided = Boolean(num || (cvc || "").trim() || (exp || "").trim() || (zip || "").trim() || (name || "").trim());

  // Entire card section is optional
  if (!anyProvided) return { ok: true, errors: {}, type: { type: "unknown" } };

  const errors = {};
  const type = cardTypeFromNumber(num);

  // Only validate fields that were actually filled in
  if (num) {
    if (!/^\d+$/.test(num)) errors.number = "Digits only.";
    else if (!(num.length === 15 || num.length === 16)) errors.number = "Card number must be 15 or 16 digits.";
    else if (!luhnValid(num)) errors.number = "Invalid card number.";
  }

  if ((exp || "").trim()) {
    const expCheck = validateExp(exp);
    if (!expCheck.ok) errors.exp = expCheck.msg;
  }

  const cvcTrim = (cvc || "").trim();
  if (cvcTrim) {
    if (!/^\d+$/.test(cvcTrim)) errors.cvc = "Digits only.";
    else {
      const wanted = (type.type === "amex") ? [4] : [3, 4];
      if (!wanted.includes(cvcTrim.length)) errors.cvc = "CVC must be 3 or 4 digits.";
    }
  }

  const zipTrim = (zip || "").trim();
  if (zipTrim && !/^\d{5}$/.test(zipTrim)) errors.zip = "Zip code must be exactly 5 digits.";

  return { ok: Object.keys(errors).length === 0, errors, type };
}

function getUI() {
  const main = $(`.${CSS.main}`);
  return {
    main,
    pwd: $(`.${CSS.passwordInput}`, main),
    slider: $(`.${CSS.rangeSlider}`, main),
    lenVal: $(`.${CSS.lengthValue}`, main),
    decBtns: $$(`.${CSS.decrementBtn}`, main),
    incBtns: $$(`.${CSS.incrementBtn}`, main),
    checks: $$(`.${CSS.complexityCheckbox}`, main),

    regenBtn: $("#regenBtn"),
    copyBtn: $("#copyBtn"),
    saveBtn: $("#saveBtn"),

    img: $("#strengthImage"),
    avastInlinePill: $("#psiPill"),
    projectPill: $("#projectPill"),
    avastPill: $("#avastPill"),

    modal: $("#saveModal"),
  };
}

function updateButtons(ui) {
  const v = Number(ui.slider.value);
  ui.decBtns.forEach((b) => (b.disabled = v <= Number(ui.slider.min)));
  ui.incBtns.forEach((b) => (b.disabled = v >= Number(ui.slider.max)));
}

function checkedPattern(ui) {
  return ui.checks.filter((c) => c.checked).map((c) => c.value).join("");
}

function fixLastCheckboxBehavior(ui, changedCb) {
  const checked = ui.checks.filter((c) => c.checked);
  if (checked.length === 0) {
    changedCb.checked = true;
    toast("At least one character type must stay enabled.");
    return false;
  }
  return true;
}

async function ensurePsiReady() {
  try {
    await psiInit();
  } catch (e) {
    toast("PSI wordlists failed to load. Run with python server.py");
    console.error(e);
  }
}

async function updateStrengthUI(ui, password) {
  // Project 2 (PSI)
  const psi = psiAnalyze(password);
  const psiText = psiLabel(psi.category);
  setPill(ui.projectPill, psi.categoryIndex, psiText);

  // Avast-style (zxcvbn score 0–4)
  let pretty;
  try {
    pretty = getPrettyScore(password);
  } catch (e) {
    console.error(e);
    setPill(ui.avastPill, 0, "—");
    setPill(ui.avastInlinePill, 0, "—");
    return { psi, prettyScore: 0, prettyText: "—" };
  }

  const score = Number(pretty.score ?? 0);
  const pText = prettyLabel(score);
  setPill(ui.avastPill, score, pText);
  setPill(ui.avastInlinePill, score, pText);

  // Image is driven by Avast-style score (0–4) where 4 => castle
  ui.img.src = strengthImgPath(score);

  return { psi, prettyScore: score, prettyText: pText };
}

async function regenerate(ui, animate = true) {
  const pattern = checkedPattern(ui);
  const length = Number(ui.slider.value);
  const newPass = generatePassword(pattern, length);

  if (animate) animateToNewPassword(ui.pwd, newPass);
  else ui.pwd.value = newPass;

  await updateStrengthUI(ui, newPass);
}

async function doCopy(ui) {
  const text = ui.pwd.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ui.pwd.removeAttribute("readonly");
    ui.pwd.select();
    document.execCommand("copy");
    ui.pwd.setAttribute("readonly", "readonly");
  }
  toast("Password copied");
}

function openSaveModal(ui) {
  ui.modal.showModal();
  $("#siteInput").value = "";
  $("#userInput").value = "";
  $("#pwdInput").value = ui.pwd.value;

  $("#ccNumber").value = "";
  $("#ccName").value = "";
  $("#ccExp").value = "";
  $("#ccCvc").value = "";
  $("#ccZip").value = "";
  $("#ccLogo").src = "./assets/cards/unknown.svg";

  $("#saveErrors").textContent = "";
  $("#ccErrors").textContent = "";
}

function closeSaveModal(ui) {
  ui.modal.close();
}

function updateCardLogo(number) {
  const { type } = cardTypeFromNumber(number);
  $("#ccLogo").src = `./assets/cards/${type || "unknown"}.svg`;
}

async function saveEntry(ui) {
  const website = $("#siteInput").value.trim();
  const username = $("#userInput").value.trim();
  const password = $("#pwdInput").value;

  const card = {
    number: $("#ccNumber").value.trim(),
    name:   $("#ccName").value.trim(),
    exp:    $("#ccExp").value.trim(),
    cvc:    $("#ccCvc").value.trim(),
    zip:    $("#ccZip").value.trim(),
  };

  const v = validateCard(card);
  $("#ccErrors").textContent = Object.values(v.errors).filter(Boolean).join("  ");
  $("#saveErrors").textContent = "";

  if (!password) {
    $("#saveErrors").textContent = "No password to save.";
    return;
  }
  if (!v.ok) {
    $("#saveErrors").textContent = "Fix the credit card fields (or leave them blank).";
    return;
  }

  // compute strength strings for saving
  const psi = psiAnalyze(password);
  let avastScore = 0;
  try {
    avastScore = Number(getPrettyScore(password).score ?? 0);
  } catch {}

  const createdAt = new Date().toISOString();
  const cardType = v.type.type || "unknown";

  const sensitive = {
    password,
    cardNumber: card.number.replace(/\s+/g, ""),
    cardName:   card.name,
    cardExp:    card.exp,
    cardCvc:    card.cvc,
    cardZip:    card.zip,
  };

  // Encrypt password and card data separately
  const { encPassword, ivPassword } = await encryptPassword(sensitive.password);
  const { encCard, ivCard } = await encryptCard({
    cardNumber: sensitive.cardNumber,
    cardName:   sensitive.cardName,
    cardExp:    sensitive.cardExp,
    cardCvc:    sensitive.cardCvc,
    cardZip:    sensitive.cardZip,
  });

  try {
    await apiSaveRecord({
      website,
      username,
      password,
      cardNumber: sensitive.cardNumber,
      cardName:   sensitive.cardName,
      cardExp:    sensitive.cardExp,
      cardCvc:    sensitive.cardCvc,
      cardZip:    sensitive.cardZip,
      cardType,
      createdAt,
      projectStrength: psiLabel(psi.category),
      avastStrength: prettyLabel(avastScore),
      encPassword,
      ivPassword,
      encCard,
      ivCard,
    });
    toast("Saved to vault");
    closeSaveModal(ui);
  } catch (e) {
    $("#saveErrors").textContent = String(e?.message || e);
  }
}

async function init() {
  await ensurePsiReady();
  const ui = getUI();

  ui.slider.min = "1";
  ui.slider.max = "50";
  ui.slider.value = ui.slider.value || "16";
  ui.lenVal.textContent = ui.slider.value;
  updateButtons(ui);
  setSliderFill(ui.slider);

  // Initial gen
  await regenerate(ui, false);

  // Export buttons
  const exportPlainBtn = document.getElementById("exportPlainBtn");
  const exportEncBtn = document.getElementById("exportEncBtn");
  if (exportPlainBtn) exportPlainBtn.addEventListener("click", () => {
    try { exportCsv("plain"); } catch(e){ toast("Export failed"); }
  });
  if (exportEncBtn) exportEncBtn.addEventListener("click", () => {
    try { exportCsv("encrypted"); } catch(e){ toast("Export failed"); }
  });

  // Events
  ui.slider.addEventListener("input", async () => {
    ui.lenVal.textContent = ui.slider.value;
    updateButtons(ui);
    setSliderFill(ui.slider);
    await regenerate(ui, true);
  });

  ui.decBtns.forEach((btn) => btn.addEventListener("click", async () => {
    ui.slider.value = String(Math.max(Number(ui.slider.min), Number(ui.slider.value) - 1));
    ui.lenVal.textContent = ui.slider.value;
    updateButtons(ui);
    setSliderFill(ui.slider);
    await regenerate(ui, true);
  }));

  ui.incBtns.forEach((btn) => btn.addEventListener("click", async () => {
    ui.slider.value = String(Math.min(Number(ui.slider.max), Number(ui.slider.value) + 1));
    ui.lenVal.textContent = ui.slider.value;
    updateButtons(ui);
    setSliderFill(ui.slider);
    await regenerate(ui, true);
  }));

  ui.checks.forEach((cb) => cb.addEventListener("change", async () => {
    const ok = fixLastCheckboxBehavior(ui, cb);
    if (!ok) return;
    await regenerate(ui, true);
  }));

  ui.regenBtn.addEventListener("click", async () => regenerate(ui, true));
  ui.copyBtn.addEventListener("click", async () => doCopy(ui));
  ui.saveBtn.addEventListener("click", () => openSaveModal(ui));

  $("#modalClose").addEventListener("click", () => closeSaveModal(ui));
  $("#modalCancel").addEventListener("click", () => closeSaveModal(ui));
  $("#modalSave").addEventListener("click", async () => saveEntry(ui));

  $("#ccNumber").addEventListener("input", (e) => updateCardLogo(e.target.value));

  $("#vaultLink").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "./lookup.html";
  });
}

init();
