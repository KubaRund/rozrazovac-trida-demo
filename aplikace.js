"use strict";

const byId = id => document.getElementById(id);
const form = byId("draw-form");
const roster = byId("roster");
const rule = byId("group-rule");
const value = byId("group-value");
const balance = byId("balance");
let result;

function mode() {
  return form.elements.mode.value;
}

function updateRosterHint() {
  const count = roster.value.split(/\r\n|\r|\n/).filter(line => line.trim()).length;
  byId("roster-count").textContent = count ? `Jmen: ${count}` : "";
}

function clearResult() {
  result = undefined;
  byId("form-error").hidden = true;
  byId("export-actions").hidden = true;
  byId("result-seed").hidden = true;
  byId("result-balance").hidden = true;
  byId("reserve").hidden = true;
  byId("empty").hidden = false;
  byId("cards").replaceChildren();
  byId("reserve-list").replaceChildren();
  byId("result-summary").textContent = "";
  byId("export-status").textContent = "";
}

function updateSettings() {
  const groups = mode() === "groups";
  byId("group-settings").hidden = !groups;
  byId("balance-setting").hidden = !groups;
  value.disabled = !groups;
  byId("group-value-label").textContent = rule.value === "max" ? "Nejvýše žáků ve skupině" : "Počet skupin";
  byId("roster-hint").textContent = groups && balance.checked
    ? "Jméno a body odděl středníkem, např. Jana; 7,50. Rozsah bodů je 0–100."
    : "Jedno jméno na řádek.";
  updateRosterHint();
  clearResult();
}

function showError(error) {
  byId("form-error").textContent = error.message;
  byId("form-error").hidden = false;
}

function makeElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function memberList(list, members, showPoints) {
  for (const { name, points } of members) {
    const item = makeElement("li", name);
    if (showPoints) item.append(makeElement("span", Losovani.formatPoints(points), "points"));
    list.append(item);
  }
}

function render() {
  const { groups, reserve, code, balance: showPoints, mode: drawMode, metrics } = result;
  const total = groups.reduce((count, group) => count + group.members.length, 0) + reserve.length;
  const active = total - reserve.length;
  const smallest = Math.floor(active / groups.length);
  const largest = Math.ceil(active / groups.length);
  const size = smallest === largest ? largest : `${smallest}–${largest}`;
  byId("result-summary").textContent = drawMode === "groups"
    ? `Žáků: ${total} · Skupin: ${groups.length} · Žáků na skupinu: ${size}`
    : `Žáků: ${total} · Obsazených míst: ${active} · Bez služby: ${reserve.length}`;
  if (metrics) {
    const mean = Losovani.formatPoints(Losovani.average(metrics.total, total));
    const deviation = !metrics.deviation && metrics.variance.numerator !== "0"
      ? "< 0,01" : Losovani.formatPoints(metrics.deviation);
    const status = metrics.optimal ? "Prokázané optimum" : code.startsWith("v1-")
      ? "Původní los podle kódu v1" : "Nejlepší nalezené rozdělení";
    byId("result-balance").textContent = `Průměr třídy: ${mean} b. · Odchylka průměrů: ${deviation} b. · ${status}`;
    byId("result-balance").hidden = false;
  }
  for (const { label, members, sum } of groups) {
    const card = makeElement("article", "", "card");
    card.append(makeElement("h3", label));
    if (showPoints) {
      const average = Losovani.average(sum, members.length);
      card.append(makeElement("p", `Průměr ${Losovani.formatPoints(average)} b.`, "hint average"));
    }
    const list = document.createElement("ul");
    memberList(list, members, showPoints);
    card.append(list);
    byId("cards").append(card);
  }
  if (reserve.length) {
    memberList(byId("reserve-list"), reserve, false);
    byId("reserve").hidden = false;
  }
  byId("result-seed").replaceChildren("Kód losu: ", makeElement("code", code));
  byId("result-seed").hidden = false;
  byId("export-actions").hidden = false;
  byId("empty").hidden = true;
}

form.addEventListener("submit", event => {
  event.preventDefault();
  clearResult();
  try {
    result = Losovani.draw(roster.value, {
      mode: mode(),
      rule: rule.value,
      value: value.valueAsNumber,
      balance: balance.checked,
      seed: byId("seed").value,
    });
  } catch (error) {
    showError(error);
    return;
  }
  render();
});

form.addEventListener("input", updateSettings);

byId("sample").addEventListener("click", () => {
  const points = [9.5, 8.7, 8.2, 7.5, 7.3, 6.4, 6, 5.5, 5, 4.2, 3.5, 2];
  roster.value = points.map((score, i) => {
    const name = `Žák ${String(i + 1).padStart(2, "0")}`;
    return mode() === "groups" && balance.checked ? `${name}; ${String(score).replace(".", ",")}` : name;
  }).join("\n");
  updateSettings();
});

byId("roster-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = "";
  try {
    roster.value = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    updateSettings();
  } catch {
    showError(new Error("Soubor se nepodařilo načíst. Ulož seznam jako TXT v kódování UTF‑8."));
  }
});

function resultText({ groups, reserve, code }) {
  const lines = groups.map(({ label, members }) => `${label}: ${members.map(person => person.name).join(", ")}`);
  if (reserve.length) lines.push(`Bez služby: ${reserve.map(person => person.name).join(", ")}`);
  return [...lines, "", `Kód losu: ${code}`].join("\n");
}

byId("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(resultText(result));
    byId("export-status").textContent = "Výsledek je ve schránce.";
  } catch {
    byId("export-status").textContent = "Prohlížeč nepovolil kopírování. Výsledek můžeš stáhnout jako CSV.";
  }
});

byId("download").addEventListener("click", () => {
  const blob = new Blob([Losovani.toCsv(result)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.mode === "groups" ? "skupiny.csv" : "sluzby.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

updateSettings();
