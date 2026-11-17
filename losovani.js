"use strict";

const Losovani = (() => {
  const optimizer = typeof module === "undefined" ? Vyvazeni : require("./vyvazeni");
  const services = ["Tabule", "Pomůcky", "Květiny", "Energie", "Úklid"];
  const wordRange = 2 ** 32;
  const seedPattern = /^v[12]-(?:[0-9a-f]{8}-){3}[0-9a-f]{8}$/i;

  function parseRoster(text, balance) {
    const names = new Set();
    const people = [];
    for (const [index, raw] of text.split(/\r\n|\r|\n/).entries()) {
      const line = raw.trim();
      if (!line) continue;
      const [first, score, extra] = balance ? line.split(";") : [line];
      const name = first.trim().normalize("NFC").replace(/\s+/g, " ");
      if (!name) throw new Error(`Řádek ${index + 1}: chybí jméno.`);
      const key = name.toLocaleLowerCase("cs");
      if (names.has(key)) throw new Error(`Řádek ${index + 1}: jméno „${name}“ už v seznamu je. Rozliš žáky třeba iniciálou.`);
      names.add(key);
      let points;
      if (balance) {
        const match = /^(\d{1,3})(?:[,.](\d{1,2}))?$/.exec(score?.trim() ?? "");
        if (!match || extra !== undefined) {
          throw new Error(`Řádek ${index + 1}: zadej jméno a body ve formátu „${name}; 7,5“.`);
        }
        const [, whole, fraction = ""] = match;
        points = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
        if (points > 10000) throw new Error(`Řádek ${index + 1}: body musí být od 0 do 100.`);
      }
      people.push({ name, points });
    }
    if (!people.length) throw new Error("Vlož alespoň jedno jméno.");
    return people;
  }

  function rotateLeft(word, bits) {
    return (word << bits) | (word >>> (32 - bits));
  }

  function makeRandom(code) {
    code = code.trim().toLowerCase();
    if (!code) {
      let words;
      do {
        words = globalThis.crypto.getRandomValues(new Uint32Array(4));
      } while (words.every(word => word === 0));
      code = "v2-" + Array.from(words, word => word.toString(16).padStart(8, "0")).join("-");
    }
    if (!seedPattern.test(code)) throw new Error("Kód losu má neplatný formát. Vlož celý kód z výsledku.");
    const state = code.slice(3).split("-").map(word => Number.parseInt(word, 16));
    if (state.every(word => word === 0)) throw new Error("Kód losu nesmí obsahovat jen nuly.");

    // xoshiro128** with four unsigned 32-bit state words.
    function nextWord() {
      const result = Math.imul(rotateLeft(Math.imul(state[1], 5), 7), 9) >>> 0;
      const shifted = state[1] << 9;
      state[2] ^= state[0];
      state[3] ^= state[1];
      state[1] ^= state[2];
      state[0] ^= state[3];
      state[2] ^= shifted;
      state[3] = rotateLeft(state[3], 11);
      return result;
    }

    return {
      code,
      below(bound) {
        const limit = wordRange - wordRange % bound;
        let word;
        do word = nextWord(); while (word >= limit);
        return word % bound;
      },
    };
  }

  function shuffle(items, random) {
    const shuffled = items.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = random.below(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function draw(text, { mode, rule, value, balance, seed = "" }) {
    balance = mode === "groups" && balance;
    const people = parseRoster(text, balance);
    let count;
    if (mode === "groups") {
      if (!Number.isSafeInteger(value) || value < 1 || (rule === "count" && value > people.length)) {
        throw new Error(rule === "count"
          ? `Počet skupin musí být celé číslo od 1 do ${people.length}.`
          : "Největší velikost skupiny musí být kladné celé číslo.");
      }
      count = rule === "max" ? Math.ceil(people.length / value) : value;
    } else if (people.length < services.length * 2) {
      throw new Error(`Na pět dvojic je potřeba alespoň 10 žáků. V seznamu je ${people.length}.`);
    }
    const random = makeRandom(seed);
    const order = shuffle(people, random);
    if (mode === "services") {
      const groups = services.map((label, index) => ({ label, members: order.slice(2 * index, 2 * index + 2) }));
      return { groups, reserve: order.slice(2 * services.length), code: random.code, balance, mode };
    }

    const groups = Array.from({ length: count }, (_, i) => ({ label: `Skupina ${i + 1}`, members: [], sum: 0 }));
    const groupOrder = shuffle(groups, random);
    if (balance) order.sort((a, b) => b.points - a.points);
    for (let start = 0; start < order.length; start += count) {
      const block = order.slice(start, start + count);
      const recipients = groupOrder.slice(0, block.length);
      if (balance) recipients.sort((a, b) => a.sum - b.sum);
      for (const [index, person] of block.entries()) {
        const group = recipients[index];
        group.members.push(person);
        if (balance) group.sum += person.points;
      }
    }
    const metrics = balance ? optimizer.optimize(groups, order, random.code.startsWith("v2-")) : null;
    return { groups, reserve: [], code: random.code, balance, mode, metrics };
  }

  function formatPoints(hundredths) {
    return (hundredths / 100).toFixed(2).replace(".", ",");
  }

  function average(sum, count) {
    // Round half up to whole hundredths without comparing decimal fractions.
    const whole = Math.floor(sum / count);
    return whole + Number(2 * (sum % count) >= count);
  }

  function toCsv(result) {
    const quote = value => {
      const safe = /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const rows = [["Skupina nebo služba", "Jméno", ...(result.balance ? ["Body"] : [])]];
    for (const { label, members } of [...result.groups, { label: "Bez služby", members: result.reserve }]) {
      for (const person of members) {
        rows.push([label, person.name, ...(result.balance ? [formatPoints(person.points)] : [])]);
      }
    }
    return "\ufeff" + rows.map(row => row.map(quote).join(";")).join("\r\n") + "\r\n";
  }

  return { draw, average, formatPoints, toCsv };
})();

if (typeof module !== "undefined") module.exports = Losovani;
