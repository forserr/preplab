// PrepLab — мини-приложение. Без сборки, чистый JS.
// Адрес сервера с API (send-list, generate). Пусто = работаем без сервера.
const API = window.PREPLAB_API || "";
const tg = window.Telegram?.WebApp;
const inTg = !!(tg && tg.initData);
if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor("#0b0d10"); tg.setBackgroundColor("#0b0d10"); } catch (e) {} }
const haptic = (t = "light") => { try { tg.HapticFeedback.impactOccurred(t); } catch (e) {} };

/* ---------- хранилище: Telegram CloudStorage, в браузере — localStorage ---------- */
const CHUNK = 3800;
const cs = inTg && tg.CloudStorage;
const csGet = (keys) => new Promise((res) => cs.getItems(keys, (e, v) => res(e ? {} : v)));
const csSet = (k, v) => new Promise((res) => cs.setItem(k, v, () => res()));
async function load(key, def) {
  try {
    if (!cs) { const v = localStorage.getItem("pl_" + key); return v ? JSON.parse(v) : def; }
    const head = (await csGet([key + "_n"]))[key + "_n"];
    if (!head) return def;
    const n = +head, keys = [...Array(n)].map((_, i) => key + "_" + i);
    const parts = await csGet(keys);
    return JSON.parse(keys.map((k) => parts[k] || "").join(""));
  } catch (e) { return def; }
}
const saveTimers = {};
function save(key, val) {
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(async () => {
    const s = JSON.stringify(val);
    try {
      if (!cs) return localStorage.setItem("pl_" + key, s);
      const n = Math.max(1, Math.ceil(s.length / CHUNK));
      for (let i = 0; i < n; i++) await csSet(key + "_" + i, s.slice(i * CHUNK, (i + 1) * CHUNK));
      await csSet(key + "_n", String(n));
    } catch (e) {}
  }, 400);
}

/* ---------- состояние ---------- */
const S = { tab: "dishes", filter: "all", profile: null, week: [], over: {}, checks: {}, custom: [], want: [] };
const persist = (...keys) => keys.forEach((k) => save(k, S[k]));

const ACT = { low: ["Сидячий, 0–1 трен.", 1.2], light: ["2–3 трен. в неделю", 1.375], mid: ["4–5 трен. в неделю", 1.55], high: ["Тяжёлые трен. + работа", 1.725] };
const GOAL = { cut: ["Сушка", -0.18], keep: ["Поддержание", 0], bulk: ["Набор", 0.12] };
const EXCL = { lactose: "Без лактозы", gluten: "Без глютена", fish: "Без рыбы", nuts: "Без орехов", spicy: "Не острое" };
const WANT = { chicken: ["Курица", ["chicken_breast", "chicken_thigh"]], beef: ["Говядина", ["beef", "beef_mince"]], turkey: ["Индейка", ["turkey_mince"]], fish: ["Рыба", ["salmon", "white_fish", "tuna_can"]], pasta: ["Паста", ["pasta"]], wrap: ["Лаваш/буррито", ["lavash", "tortilla"]], grain: ["Крупы", ["rice", "buckwheat", "bulgur"]] };
const TYPE = { breakfast: "Завтрак", main: "Основное", snack: "Перекус" };

function targets(p) {
  if (!p) return null;
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "m" ? 5 : -161);
  const tdee = bmr * ACT[p.activity][1];
  const kcal = Math.max(tdee * (1 + GOAL[p.goal][1]), p.sex === "m" ? 1500 : 1200);
  const prot = { cut: 2.2, keep: 1.8, bulk: 2.0 }[p.goal] * p.weight;
  const fat = Math.max(0.8 * p.weight, (kcal * 0.25) / 9);
  const carb = Math.max((kcal - prot * 4 - fat * 9) / 4, 0);
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal: Math.round(kcal), p: Math.round(prot), f: Math.round(fat), c: Math.round(carb) };
}

const allRecipes = () => RECIPES.concat(S.custom);
const R = (id) => allRecipes().find((r) => r.id === id);
const grams = (r) => r.i.map(([f, g]) => [f, S.over[r.id]?.[f] ?? g]);
function macros(r, k = 1) {
  const m = { k: 0, p: 0, f: 0, u: 0 };
  for (const [f, g] of grams(r)) { const x = FOODS[f]; if (!x) continue; for (const q in m) m[q] += (x[q] * g * k) / 100; }
  return m;
}
const excluded = (r) => (S.profile?.excl || []).some((t) => r.tags.includes(t));
const wItem = (id) => S.week.find((w) => w.id === id);
const r0 = (x) => Math.round(x);

/* ---------- UI helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let toastT;
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add("hidden"), 2200); }
function openSheet(html, full = false) {
  $("#sheetBody").innerHTML = html; $("#sheet").className = "sheet" + (full ? " full" : "");
  $("#sheetBody").scrollTop = 0;
  if (tg?.BackButton) { tg.BackButton.show(); }
}
function closeSheet() { $("#sheet").className = "sheet hidden"; stopTimer(); if (tg?.BackButton) tg.BackButton.hide(); }
tg?.BackButton?.onClick(closeSheet);
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

function render() {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
  const t = targets(S.profile);
  $("#topTarget").textContent = t ? `${t.kcal} ккал · Б${t.p}` : "Заполни профиль";
  $("#view").innerHTML = ({ dishes: vDishes, week: vWeek, shop: vShop, profile: vProfile })[S.tab]();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; haptic(); render(); }));

/* ---------- Блюда ---------- */
const FILTERS = { all: "Все", breakfast: "Завтраки", main: "Основное", snack: "Перекусы", fast: "До 20 мин", protein: "Много белка", my: "✨ Мои" };
function vDishes() {
  let list = allRecipes();
  const f = S.filter;
  if (TYPE[f]) list = list.filter((r) => r.type === f);
  if (f === "fast") list = list.filter((r) => r.time <= 20);
  if (f === "protein") list = list.filter((r) => { const m = macros(r); return (m.p * 4) / m.k >= 0.3; });
  if (f === "my") list = S.custom;
  const hidden = list.filter(excluded).length;
  list = list.filter((r) => !excluded(r));
  return `
  <h1>Что едим<br>на неделе?</h1>
  <div class="sub">Жми «+», чтобы добавить порцию в неделю. Карточка — состав и рецепт.</div>
  <div class="chips">${Object.entries(FILTERS).map(([k, v]) => `<button class="chip ${f === k ? "on" : ""}" onclick="S.filter='${k}';render()">${v}</button>`).join("")}</div>
  <div class="grid">${list.map(card).join("")}</div>
  ${!list.length ? `<div class="empty"><div>🍽️</div>${f === "my" ? "Тут будут блюда, которые придумает ИИ" : "Ничего не нашлось"}</div>` : ""}
  ${hidden ? `<div class="note">Скрыто по твоим ограничениям: ${hidden}</div>` : ""}
  ${API ? `<div style="height:14px"></div><button class="btn" onclick="aiSheet()">✨ Придумать блюдо под меня</button>` : ""}`;
}
function card(r) {
  const m = macros(r), w = wItem(r.id);
  return `<div class="card" onclick="dish('${r.id}')">
    <div class="thumb t-${r.type}">${r.ico}<span class="badge">${TYPE[r.type]} · ${r.time}′</span>
      <button class="add ${w ? "in" : ""}" onclick="event.stopPropagation();addServ('${r.id}',1)">${w ? w.n : "+"}</button></div>
    <div class="meta"><div class="nm">${esc(r.name)}</div><div class="kb"><b>${r0(m.k)}</b> ккал · <b>${r0(m.p)}</b> Б</div></div></div>`;
}
function addServ(id, d) {
  let w = wItem(id);
  if (!w) { if (d < 0) return; w = { id, n: 0, k: 1 }; S.week.push(w); }
  w.n += d; if (w.n <= 0) S.week = S.week.filter((x) => x !== w);
  haptic(); persist("week"); render();
  if (!$("#sheet").classList.contains("hidden") && $("#dishSheet")) dish(id, true);
}

/* ---------- Карточка блюда ---------- */
let dishMode = "one";
function dish(id, keep) {
  const r = R(id); if (!r) return;
  if (!keep) dishMode = "one";
  const w = wItem(id), n = w?.n || 0, k = w?.k || 1;
  const mult = dishMode === "all" && n ? n * k : 1;
  const m = macros(r, k);
  openSheet(`<div id="dishSheet">
    <div class="hero t-${r.type}">${r.ico}</div>
    <h1 style="font-size:20px">${esc(r.name)}</h1>
    <div class="sub">${TYPE[r.type]} · ${r.time} мин · ${esc(r.store)}</div>
    <div class="stats">${[["k", "ккал"], ["p", "белки"], ["f", "жиры"], ["u", "углев."]].map(([q, l]) => `<div class="stat"><b>${r0(m[q])}</b><span>${l}</span></div>`).join("")}</div>
    ${k !== 1 ? `<div class="note">КБЖУ с учётом размера порции ×${k.toFixed(2)} из автоподбора</div>` : ""}
    <div style="height:14px"></div>
    <div class="row"><div class="grow" style="flex:1;font-weight:600">В неделе: ${n} порц.${k !== 1 ? ` <span class="note">(порция ×${k.toFixed(2)})</span>` : ""}</div>
      <div class="step"><button onclick="addServ('${id}',-1)">−</button><span>${n}</span><button onclick="addServ('${id}',1)">+</button></div></div>
    <div style="height:10px"></div>
    <button class="btn hot" onclick="cook('${id}')">🔥 Готовить по шагам</button>
    <h2>Продукты · меняй под себя</h2>
    <div class="seg"><button class="${dishMode === "one" ? "on" : ""}" onclick="dishMode='one';dish('${id}',1)">На порцию</button><button class="${dishMode === "all" ? "on" : ""}" onclick="dishMode='all';dish('${id}',1)">На заготовку${n ? " · " + n : ""}</button></div>
    <div class="note">${dishMode === "one" ? "−/+ меняют граммы в одной порции. КБЖУ и список покупок пересчитаются." : n ? "Сколько всего нужно на все порции недели." : "Добавь блюдо в неделю, чтобы увидеть объём заготовки."}</div>
    <div class="box" style="margin-top:10px;padding:2px 14px">
      ${grams(r).map(([f, g]) => { const x = FOODS[f]; if (!x) return ""; return `<div class="li"><div class="grow">${x.n}<small>${r0((x.p * g) / 100)} Б · ${r0((x.k * g) / 100)} ккал${k !== 1 ? " (базовая порция)" : ""}</small></div>
        ${dishMode === "one" ? `<div class="step"><button onclick="tweak('${id}','${f}',-10)">−</button><span>${r0(g)} г</span><button onclick="tweak('${id}','${f}',10)">+</button></div>` : `<span class="qty">${fmtQty(f, g * mult)}</span>`}</div>`; }).join("")}
      ${r.spice ? `<div class="li"><div class="grow">Специи<small>${esc(r.spice)}</small></div><span class="note">по вкусу</span></div>` : ""}
    </div>
    ${S.over[id] ? `<button class="btn" style="margin-top:10px" onclick="delete S.over['${id}'];persist('over');dish('${id}',1);render()">Вернуть граммы как в рецепте</button>` : ""}
    <h2>Как готовить</h2>
    <div class="box">${r.steps.map((s, i) => `<div class="li"><b style="color:var(--acc)">${i + 1}</b><div class="grow">${esc(s[0])}${s[1] ? `<small>⏱ ${fmtT(s[1])}</small>` : ""}</div></div>`).join("")}</div>
    ${r.custom ? `<button class="btn" style="margin-top:10px" onclick="delCustom('${id}')">Удалить блюдо</button>` : ""}
  </div>`);
}
function tweak(id, f, d) {
  const r = R(id), base = r.i.find((x) => x[0] === f)[1];
  S.over[id] = S.over[id] || {};
  const cur = S.over[id][f] ?? base;
  S.over[id][f] = Math.max(0, cur + d);
  if (S.over[id][f] === base) delete S.over[id][f];
  if (!Object.keys(S.over[id]).length) delete S.over[id];
  haptic(); persist("over"); dish(id, true);
}
function delCustom(id) { S.custom = S.custom.filter((r) => r.id !== id); S.week = S.week.filter((w) => w.id !== id); persist("custom", "week"); closeSheet(); render(); }
const fmtT = (s) => (s >= 60 ? `${Math.round(s / 60)} мин` : `${s} сек`);
function fmtQty(f, g) {
  if (f === "eggs") return `${Math.ceil(g / 55)} шт`;
  return g >= 1000 ? `${(g / 1000).toFixed(g >= 10000 ? 0 : 1).replace(".", ",")} кг` : `${Math.ceil(g / 10) * 10} г`;
}

/* ---------- Режим готовки ---------- */
let cookIdx = 0, cookId = null, tLeft = 0, tInt = null;
function cook(id) { cookId = id; cookIdx = 0; stopTimer(); drawCook(); }
function drawCook() {
  const r = R(cookId), s = r.steps[cookIdx], last = cookIdx === r.steps.length - 1;
  if (!tInt) tLeft = s[1] || 0;
  openSheet(`<div class="row"><button class="x" onclick="dish('${cookId}')">←</button><div style="flex:1;font-weight:600">${esc(r.name)}</div><span class="note">${cookIdx + 1}/${r.steps.length}</span></div>
    <div class="dots">${r.steps.map((_, i) => `<i class="${i <= cookIdx ? "on" : ""}"></i>`).join("")}</div>
    <div class="cook-step">${esc(s[0])}</div>
    ${s[1] ? `<div class="timer" id="tmr">${clock(tLeft)}</div>
      <div class="two"><button class="btn pri" onclick="toggleTimer()">${tInt ? "Пауза" : "Старт таймера"}</button><button class="btn" onclick="stopTimer();tLeft=${s[1]};drawCook()">Сброс</button></div>` : ""}
    <div style="position:absolute;left:16px;right:16px;bottom:30px" class="two">
      <button class="btn" ${cookIdx ? "" : "disabled style='opacity:.4'"} onclick="stopTimer();cookIdx--;drawCook()">Назад</button>
      <button class="btn ${last ? "hot" : "pri"}" onclick="stopTimer();${last ? "closeSheet();toast('Готово! Раскладывай по контейнерам 💪')" : "cookIdx++;drawCook()"}">${last ? "Готово" : "Дальше"}</button></div>`, true);
}
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
function toggleTimer() {
  if (tInt) { clearInterval(tInt); tInt = null; return drawCook(); }
  tInt = setInterval(() => {
    tLeft--; const el = $("#tmr"); if (el) el.textContent = clock(Math.max(tLeft, 0));
    if (tLeft <= 0) { clearInterval(tInt); tInt = null; el?.classList.add("ring"); beep(); try { tg.HapticFeedback.notificationOccurred("success"); } catch (e) {} }
  }, 1000);
  drawCook();
}
function stopTimer() { clearInterval(tInt); tInt = null; }
function beep() { try { const a = new AudioContext(); [0, 0.35, 0.7].forEach((t) => { const o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.2); }); } catch (e) {} }

/* ---------- Неделя ---------- */
function weekStats() {
  const s = { k: 0, p: 0, f: 0, u: 0, n: 0 };
  for (const w of S.week) { const r = R(w.id); if (!r) continue; const m = macros(r, w.k); for (const q of "kpfu") s[q] += m[q] * w.n; s.n += w.n; }
  return s;
}
function vWeek() {
  const t = targets(S.profile), s = weekStats(), meals = S.profile?.meals || 3;
  const day = { k: s.k / 7, p: s.p / 7, f: s.f / 7, u: s.u / 7 };
  const items = S.week.map((w) => ({ w, r: R(w.id) })).filter((x) => x.r);
  const bar = (v, goal, lbl) => { const pct = goal ? (v / goal) * 100 : 0; return `<div style="margin-bottom:10px"><div class="row" style="justify-content:space-between;font-size:13px"><span>${lbl}</span><span><b>${r0(v)}</b> / ${goal || "—"}</span></div><div class="bar ${pct > 108 ? "over" : ""}"><i style="width:${Math.min(pct, 100)}%"></i></div></div>`; };
  return `
  <h1>${items.length} блюд · ${s.n} порций</h1>
  <div class="sub">Покрыто ${s.n} из ${meals * 7} приёмов пищи за неделю</div>
  <div class="box"><div style="font-size:12px;color:var(--mut);font-weight:600;margin-bottom:8px">В СРЕДНЕМ ЗА ДЕНЬ</div>
    ${bar(day.k, t?.kcal, "Калории")}${bar(day.p, t?.p, "Белки, г")}${bar(day.f, t?.f, "Жиры, г")}${bar(day.u, t?.c, "Углеводы, г")}
    ${!t ? `<div class="note">Заполни профиль, чтобы видеть цели</div>` : ""}</div>
  <div style="height:12px"></div>
  <button class="btn pri" onclick="pickSheet()">⚡ Собрать неделю под мои цели</button>
  <h2>Твоя неделя</h2>
  ${items.length ? `<div class="box" style="padding:2px 14px">${items.map(({ w, r }) => { const m = macros(r, w.k); return `<div class="li"><div style="font-size:26px">${r.ico}</div><div class="grow" onclick="dish('${r.id}')">${esc(r.name)}<small>${r0(m.k)} ккал · ${r0(m.p)} Б${w.k !== 1 ? ` · порция ×${w.k.toFixed(2)}` : ""}</small></div>
    <div class="step"><button onclick="addServ('${r.id}',-1)">−</button><span>${w.n}</span><button onclick="addServ('${r.id}',1)">+</button></div></div>`; }).join("")}</div>
    <button class="btn" style="margin-top:10px" onclick="S.tab='shop';render()">🛒 К списку покупок</button>
    <button class="btn" onclick="if(confirmClear())render()">Очистить неделю</button>` : `<div class="empty"><div>📦</div>Пока пусто. Собери неделю кнопкой выше или добавь блюда во вкладке «Блюда».</div>`}`;
}
function confirmClear() { S.week = []; S.checks = {}; persist("week", "checks"); toast("Неделя очищена"); return true; }

/* автоподбор */
function pickSheet() {
  if (!S.profile) { S.tab = "profile"; render(); return toast("Сначала заполни профиль"); }
  openSheet(`<h1 style="font-size:20px">Собрать неделю</h1>
  <div class="sub">Отметь, чего хочется на этой неделе. Подберу 1 завтрак, 3 основных блюда${S.profile.meals > 3 ? " и перекусы" : ""} и подгоню размер порций под ${targets(S.profile).kcal} ккал.</div>
  <div class="chips" style="flex-wrap:wrap">${Object.entries(WANT).map(([k, [l]]) => `<button class="chip ${S.want.includes(k) ? "on" : ""}" onclick="toggleWant('${k}')">${l}</button>`).join("")}</div>
  <div style="height:10px"></div><button class="btn pri" onclick="autoPick()">Собрать</button>`);
}
function toggleWant(k) { S.want = S.want.includes(k) ? S.want.filter((x) => x !== k) : [...S.want, k]; persist("want"); pickSheet(); }
function autoPick() {
  const t = targets(S.profile), meals = S.profile.meals;
  const pool = allRecipes().filter((r) => !excluded(r));
  const wantFoods = S.want.flatMap((k) => WANT[k][1]);
  const score = (r) => { const m = macros(r); return (m.p * 4) / m.k + (r.i.some(([f]) => wantFoods.includes(f)) ? 0.5 : 0) + Math.random() * 0.35; };
  const top = (type, n) => pool.filter((r) => r.type === type).sort((a, b) => score(b) - score(a)).slice(0, n);
  const week = [];
  top("breakfast", 1).forEach((r) => week.push({ id: r.id, n: 7, k: 1 }));
  const mains = top("main", 3); const split = [5, 5, 4];
  mains.forEach((r, i) => week.push({ id: r.id, n: split[i], k: 1 }));
  const snackN = (meals - 3) * 7;
  if (snackN) { const sn = top("snack", 2); sn.forEach((r, i) => week.push({ id: r.id, n: sn.length === 1 ? snackN : i ? Math.floor(snackN / 2) : Math.ceil(snackN / 2), k: 1 })); }
  S.week = week;
  // подгоняем размер порций под калории
  const total = weekStats().k;
  const ratio = Math.min(1.6, Math.max(0.7, (t.kcal * 7) / total));
  S.week.forEach((w) => (w.k = Math.round(ratio * 100) / 100));
  S.checks = {}; persist("week", "checks"); closeSheet(); S.tab = "week"; render();
  haptic("medium"); toast(ratio !== 1 ? `Готово. Порции ×${ratio.toFixed(2)} под твою норму` : "Неделя собрана");
}

/* ---------- Покупки ---------- */
function shopList() {
  const agg = {};
  for (const w of S.week) { const r = R(w.id); if (!r) continue; for (const [f, g] of grams(r)) agg[f] = (agg[f] || 0) + g * w.n * w.k; }
  const by = {};
  for (const f in agg) { const x = FOODS[f]; if (!x || agg[f] <= 0) continue; (by[x.c] = by[x.c] || []).push([f, agg[f]]); }
  return DEPTS.filter((d) => by[d]).map((d) => [d, by[d].sort((a, b) => FOODS[a[0]].n.localeCompare(FOODS[b[0]].n))]);
}
function vShop() {
  const list = shopList(), total = list.reduce((a, [, x]) => a + x.length, 0), done = list.reduce((a, [, x]) => a + x.filter(([f]) => S.checks[f]).length, 0);
  if (!total) return `<h1>Список покупок</h1><div class="empty"><div>🛒</div>Собери неделю — список появится сам.</div>`;
  const spices = [...new Set(S.week.map((w) => R(w.id)?.spice).filter(Boolean).join(", ").split(", "))].filter(Boolean);
  return `<h1>Список покупок</h1><div class="sub">${done} из ${total} куплено · по отделам магазина</div>
  ${list.map(([d, items]) => `<h2>${d}</h2><div class="box" style="padding:2px 14px">${items.map(([f, g]) => `<div class="li ${S.checks[f] ? "done" : ""}" onclick="S.checks['${f}']=!S.checks['${f}'];persist('checks');haptic();render()"><div class="chk">${S.checks[f] ? "✓" : ""}</div><div class="grow">${FOODS[f].n}</div><span class="qty">${fmtQty(f, g)}</span></div>`).join("")}</div>`).join("")}
  ${spices.length ? `<h2>Специи (проверь дома)</h2><div class="box" style="font-size:13px;color:var(--mut)">${esc(spices.join(", "))}</div>` : ""}
  <div style="height:14px"></div>
  <button class="btn pri" onclick="sendList()">📨 Отправить список в Telegram</button>
  <button class="btn" onclick="S.checks={};persist('checks');render()">Снять все галочки</button>`;
}
function listText() {
  const out = ["🛒 Список покупок PrepLab"];
  for (const [d, items] of shopList()) { out.push("", d.toUpperCase()); items.forEach(([f, g]) => out.push(`${S.checks[f] ? "✅" : "▫️"} ${FOODS[f].n} — ${fmtQty(f, g)}`)); }
  return out.join("\n");
}
async function sendList() {
  const text = listText();
  if (API) {
    try {
      const r = await fetch(API + "api/send-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: tg.initData, text }) });
      if (r.ok) { haptic("medium"); return toast("Отправил в чат с ботом ✅"); }
    } catch (e) {}
  }
  if (inTg) { tg.openTelegramLink("https://t.me/share/url?url=" + encodeURIComponent(" ") + "&text=" + encodeURIComponent(text.slice(0, 3500))); return; }
  try { await navigator.clipboard.writeText(text); toast("Список скопирован"); } catch (e) { toast("Не получилось скопировать"); }
}

/* ---------- Профиль ---------- */
function vProfile() {
  const p = S.profile || { sex: "m", age: "", height: "", weight: "", activity: "mid", goal: "cut", meals: 3, excl: [] };
  const t = targets(S.profile);
  return `<h1>${S.profile ? "Профиль" : "Привет! 👋"}</h1>
  <div class="sub">${S.profile ? "Цели пересчитываются сразу после сохранения." : "Заполни параметры — посчитаю калории и БЖУ под твою цель."}</div>
  ${t ? `<div class="box"><div style="font-size:12px;color:var(--mut);font-weight:600">ЦЕЛЬ НА ДЕНЬ · ${GOAL[p.goal][0].toUpperCase()}</div>
    <div style="font:800 34px Unbounded;color:var(--acc);margin:4px 0">${t.kcal} <span style="font-size:14px">ккал</span></div>
    <div class="three" style="margin-top:8px">${[["Белки", t.p], ["Жиры", t.f], ["Углеводы", t.c]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}, г</span></div>`).join("")}</div>
    <div class="note">Обмен покоя ${t.bmr} ккал · расход с активностью ${t.tdee} ккал. Это ориентир: если 2 недели нет прогресса, поправь на 100–150 ккал.</div></div><h2>Параметры</h2>` : ""}
  <form class="form" id="pf" onsubmit="event.preventDefault();saveProfile()">
    <div class="seg">${[["m", "Мужчина"], ["f", "Женщина"]].map(([k, l]) => `<button type="button" class="${p.sex === k ? "on" : ""}" onclick="setSeg(this,'sex','${k}')">${l}</button>`).join("")}</div>
    <input type="hidden" name="sex" value="${p.sex}">
    <div class="three"><label>Возраст<input name="age" type="number" inputmode="numeric" min="14" max="90" required value="${p.age}"></label>
      <label>Рост, см<input name="height" type="number" inputmode="numeric" min="120" max="230" required value="${p.height}"></label>
      <label>Вес, кг<input name="weight" type="number" inputmode="decimal" step="0.1" min="30" max="250" required value="${p.weight}"></label></div>
    <label>Цель<div class="seg">${Object.entries(GOAL).map(([k, [l]]) => `<button type="button" class="${p.goal === k ? "on" : ""}" onclick="setSeg(this,'goal','${k}')">${l}</button>`).join("")}</div></label>
    <input type="hidden" name="goal" value="${p.goal}">
    <label>Активность<select name="activity">${Object.entries(ACT).map(([k, [l]]) => `<option value="${k}" ${p.activity === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label>Приёмов пищи в день<div class="seg">${[3, 4, 5].map((n) => `<button type="button" class="${p.meals == n ? "on" : ""}" onclick="setSeg(this,'meals',${n})">${n}</button>`).join("")}</div></label>
    <input type="hidden" name="meals" value="${p.meals}">
    <label>Исключить из меню<div class="chips" style="flex-wrap:wrap">${Object.entries(EXCL).map(([k, l]) => `<button type="button" class="chip ${p.excl.includes(k) ? "on" : ""}" data-ex="${k}" onclick="this.classList.toggle('on')">${l}</button>`).join("")}</div></label>
    <button class="btn pri" type="submit">${S.profile ? "Сохранить" : "Рассчитать"}</button>
  </form>`;
}
function setSeg(btn, name, val) { btn.parentNode.querySelectorAll("button").forEach((b) => b.classList.remove("on")); btn.classList.add("on"); $(`#pf [name=${name}]`).value = val; }
function saveProfile() {
  const fd = new FormData($("#pf"));
  const first = !S.profile;
  S.profile = { sex: fd.get("sex"), age: +fd.get("age"), height: +fd.get("height"), weight: +fd.get("weight"), activity: fd.get("activity"), goal: fd.get("goal"), meals: +fd.get("meals"), excl: [...document.querySelectorAll("#pf [data-ex].on")].map((b) => b.dataset.ex) };
  persist("profile"); haptic("medium"); toast("Сохранено"); render();
  if (first) setTimeout(pickSheet, 500);
}

/* ---------- ИИ-блюдо ---------- */
function aiSheet() {
  if (!S.profile) { S.tab = "profile"; render(); return toast("Сначала заполни профиль"); }
  openSheet(`<h1 style="font-size:20px">✨ Придумать блюдо</h1>
  <div class="sub">ИИ соберёт рецепт из продуктов базы, КБЖУ посчитается точно по граммам.</div>
  <div class="form"><label>Тип<select id="aiType"><option value="main">Основное</option><option value="breakfast">Завтрак</option><option value="snack">Перекус</option></select></label>
  <label>Чего хочется<textarea id="aiWish" rows="3" placeholder="например: что-то азиатское с говядиной, не дольше 30 минут"></textarea></label>
  <button class="btn pri" id="aiBtn" onclick="aiGen()">Придумать</button></div>`);
}
async function aiGen() {
  const btn = $("#aiBtn"); btn.disabled = true; btn.textContent = "Думаю… (до 30 сек)";
  const t = targets(S.profile), type = $("#aiType").value, per = { breakfast: 0.25, main: 0.32, snack: 0.13 }[type];
  try {
    const r = await fetch(API + "api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      initData: tg?.initData || "", type, wish: $("#aiWish").value.slice(0, 300),
      kcal: Math.round(t.kcal * per), protein: Math.round(t.p * per),
      excl: (S.profile.excl || []).map((k) => EXCL[k]), foods: Object.fromEntries(Object.entries(FOODS).map(([k, v]) => [k, v.n])) }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "ошибка");
    const rec = j.recipe;
    rec.i = rec.i.filter(([f, g]) => FOODS[f] && g > 0);
    if (!rec.i.length) throw new Error("пустой рецепт");
    Object.assign(rec, { id: "c" + Date.now().toString(36), type, custom: true, tags: rec.tags || [] });
    S.custom.push(rec); persist("custom"); render(); dish(rec.id);
  } catch (e) { btn.disabled = false; btn.textContent = "Попробовать ещё раз"; toast("Не вышло: " + e.message); }
}

/* ---------- старт ---------- */
(async () => {
  [S.profile, S.week, S.over, S.checks, S.custom, S.want] = await Promise.all([load("profile", null), load("week", []), load("over", {}), load("checks", {}), load("custom", []), load("want", [])]);
  if (!S.profile) S.tab = "profile";
  render();
})();
