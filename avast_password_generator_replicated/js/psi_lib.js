// PSI-style entropy & feedback scorer (adapted from psi.js).
// Loads common-word files from ./files.json and ./words/*.txt.
//
// Exposes:
//   await psiInit()
//   psiAnalyze(password) -> { entropyBits, score100, category, categoryIndex, feedback }

let _psiExcludedWords = [];
let _psiExcludedWordsSet = null;

// Reverse "l33t" substitutions to detect common words (matches psi.js approach)
const _reverseSubstitutions = {
  "@": "a",
  "4": "a",
  "8": "b",
  "3": "e",
  "6": "g",
  "9": "g",
  "1": "i",
  "l": "i",
  "0": "o",
  "5": "s",
  "$": "s",
  "7": "t",
  "2": "z",
};

export async function psiInit() {
  if (_psiExcludedWords.length) return;

  const fileList = await fetch("./files.json").then((r) => r.json());
  const words = [];

  for (const filename of fileList) {
    const data = await fetch(`./words/${filename}`).then((r) => r.text());
    for (const line of data.split("\n")) {
      const w = line.trim();
      if (w.length > 2) words.push(w);
    }
  }

  _psiExcludedWords = words;
  _psiExcludedWordsSet = new Set(words.map((w) => w.toLowerCase()));
}

function mungePassword(password) {
  const passwords = [password];
  let munged = "";
  for (let i = 0; i < password.length; i++) {
    const ch = password[i];
    munged += _reverseSubstitutions[ch] ? _reverseSubstitutions[ch] : ch;
  }
  passwords.push(munged);
  return passwords;
}

function cleanPassword(passwords) {
  const length = passwords[0].length;
  const flags = new Array(length).fill(1);
  const matchedWords = [];
  let completeMatch = false;

  for (let p = 0; p < passwords.length; p++) {
    const cleaned = passwords[p].toLowerCase();

    // NOTE: This is O(N_words) like the source; OK for demo-sized lists.
    for (const word of _psiExcludedWords) {
      const w = word.toLowerCase();
      const idx = cleaned.indexOf(w);
      if (idx !== -1) {
        if (!matchedWords.includes(word)) matchedWords.push(word);
        for (let j = 0; j < w.length; j++) flags[idx + j] = 0;
      }
    }

    if (_psiExcludedWordsSet && _psiExcludedWordsSet.has(cleaned)) completeMatch = true;
  }

  return { flags, matchedWords, completeMatch };
}

function entropyTarget(secondsToCrack, attemptsPerSecond) {
  // +1 because the average case is half the combinations (entropy - 1)
  return Math.ceil(Math.log2(secondsToCrack * attemptsPerSecond)) + 1;
}

function scorePassword(entropyBits) {
  const secondsInYear = 60 * 60 * 24 * 365;
  const attemptsPerSecond = 1e10;
  const hundredYears = 100 * secondsInYear;

  const score = 100 * (entropyBits / entropyTarget(hundredYears, attemptsPerSecond));
  return Math.min(score, 100);
}

function categoryFromScore(score100) {
  // psi.js categorizes using "entropy" variable but it passes score.
  // We'll keep the same thresholds as psi.js for comparability.
  if (score100 >= 100) return "Very Strong";
  if (score100 >= 80) return "Strong";
  if (score100 >= 60) return "Fair";
  if (score100 >= 30) return "Weak";
  return "Very Weak";
}

function categoryIndex(cat) {
  switch (cat) {
    case "Very Weak": return 0;
    case "Weak": return 1;
    case "Fair": return 2;
    case "Strong": return 3;
    case "Very Strong": return 4;
    default: return 0;
  }
}

export function psiAnalyze(password) {
  if (!password) {
    return { entropyBits: 0, score100: 0, category: "Very Weak", categoryIndex: 0, feedback: [] };
  }

  let charset = 0;
  const feedback = [];

  if (/[a-z]/.test(password)) charset += 26;
  else feedback.push("Add lowercase letters");

  if (/[A-Z]/.test(password)) charset += 26;
  else feedback.push("Add uppercase letters");

  if (/[0-9]/.test(password)) charset += 10;
  else feedback.push("Add numbers");

  if (/[^a-zA-Z0-9]/.test(password)) charset += 32;
  else feedback.push("Add special characters");

  if (charset === 0) {
    return { entropyBits: 0, score100: 0, category: "Very Weak", categoryIndex: 0, feedback };
  }

  const mungedPasswords = mungePassword(password);
  const { flags, matchedWords, completeMatch } = cleanPassword(mungedPasswords);

  let goodChars = 0;
  for (const f of flags) {
    goodChars += (f === 1) ? 1 : 0.25; // 75% penalty for chars that are part of common words
  }
  if (completeMatch) goodChars = 0;

  const entropyBits = Math.floor(goodChars * Math.log2(charset));
  const score100 = scorePassword(entropyBits);

  if (matchedWords.length > 0) {
    feedback.push(`Consider removing common words: ${matchedWords.join(", ")}`);
  }

  const cat = categoryFromScore(score100);
  return { entropyBits, score100, category: cat, categoryIndex: categoryIndex(cat), feedback };
}