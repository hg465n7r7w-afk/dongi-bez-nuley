/* ═══════════════════════════════════════════════════════════════════════
   app.js — ПОВЕДЕНИЕ «ДОНГИ БЕЗ НУЛЕЙ»

   Что делает этот файл:
   1. Один раз в сутки берёт из интернета курсы валют (донг, рубль, доллар, евро, тенге, сум).
      Если интернета нет, использует то, что запомнил с прошлого раза.
   2. Понимает «человеческий» ввод сумм: 150k, 1.5m, 1,5тр — и превращает их в число донгов.
   3. Четыре вкладки: конвертер, проверка сдачи, делёж счёта на компанию (поровну или
      по позициям), учёт ежедневных трат с сохранением и фильтром по периоду.
   4. Запоминает вашу валюту, свой курс обмена и все записи трат в памяти браузера
      (localStorage), чтобы при следующем открытии ничего не пришлось настраивать заново.

   Курсы валют берутся с открытого адреса open.er-api.com (бесплатно, без ключа,
   обновляется раз в сутки). Это учебный проект: для реальных сумм перепроверяйте
   курс у своего обменника или банка, а ещё лучше — впишите его в настройках вручную.
   ═══════════════════════════════════════════════════════════════════════ */


/* ───── 1. СПИСОК ВАЛЮТ И КУПЮР ─────
   code   — международный код валюты (по нему запрашивается курс)
   label  — название, которое видит человек
   symbol — значок или короткая подпись, которую показываем после суммы
   digits — сколько знаков после запятой показывать. У рубля, тенге и сума — 0
            (как и у донга, там суммы обычно крупные и без копеек), у доллара и евро — 2.
   Чтобы добавить ещё одну валюту, скопируйте строку и поменяйте код на нужный
   (стандартный трёхбуквенный код валюты, например «TRY» для лиры). Если сервис
   курсов её не знает, приложение просто покажет «—» вместо курса, ничего не сломается. */

const CURRENCIES = [
  { code: "RUB", label: "Рубль",  symbol: "₽",   digits: 0 },
  { code: "USD", label: "Доллар", symbol: "$",   digits: 2 },
  { code: "EUR", label: "Евро",   symbol: "€",   digits: 2 },
  { code: "KZT", label: "Тенге",  symbol: "₸",   digits: 0 },
  { code: "UZS", label: "Сум",    symbol: "сум", digits: 0 },
  { code: "BYN", label: "Белорусский рубль", symbol: "Br", digits: 2 }
];

/* Вьетнамские купюры для «Шпаргалки» и для разбивки сдачи. Порядок — от крупной к мелкой:
   так удобнее и показывать шпаргалку, и считать, какими купюрами дать сдачу. */
const BANKNOTES = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];

/* Цвета плиток в шпаргалке — как у настоящих купюр, чтобы легче было узнавать их в кошельке */
const NOTE_COLORS = {
  500000: "#c9e7d8", 200000: "#f7dfa8", 100000: "#f3cfa0", 50000: "#f0b8b0",
  20000: "#b9d3ea", 10000: "#f6e6a8", 5000: "#c9e0c4", 2000: "#e7c9a8", 1000: "#e4dccb"
};

const STORAGE_KEY = "dong-app-settings";   // имя «ячейки» в памяти браузера, где хранятся настройки


/* ───── 2. НАСТРОЙКИ: ЧТЕНИЕ И ЗАПИСЬ В ПАМЯТЬ БРАУЗЕРА ─────
   localStorage — «записная книжка» браузера: хранит данные на этом устройстве
   даже после закрытия вкладки. В ней можно хранить только текст, поэтому объект
   настроек превращается в текст (JSON.stringify) и обратно (JSON.parse). */

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      currency: CURRENCIES.some(function (c) { return c.code === saved.currency; }) ? saved.currency : "RUB",
      manualRate: typeof saved.manualRate === "number" && saved.manualRate > 0 ? saved.manualRate : null,
      inputMode: saved.inputMode === "k" ? "k" : "plain"
    };
  } catch (error) {
    return { currency: "RUB", manualRate: null, inputMode: "plain" };   // память недоступна: начинаем с настроек по умолчанию
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  } catch (error) {
    /* Не удалось сохранить — не страшно, приложение продолжит работать в этом сеансе */
  }
}


/* ───── 3. ОБЩЕЕ СОСТОЯНИЕ ПРИЛОЖЕНИЯ ───── */

const state = {
  settings: loadSettings(),
  rates: null,          // сколько донгов стоит одна единица каждой валюты, придёт из интернета
  ratesUpdated: null,   // когда курсы обновлялись (текст с сервера)
  activeTab: "convert",
  billMode: "equal",     // способ расчёта на вкладке «Счёт»: "equal" (поровну) или "items" (по позициям)
  billTip: 0,            // выбранный процент чаевых
  billPeople: 2,
  expenses: [],           // записи трат — заполнится ниже, после того как объявлена loadExpenses()
  expensePeriod: "all",   // какой период выбран на вкладке «Траты»
  budget: null             // бюджет поездки — заполнится ниже, после того как объявлена loadBudget()
};


/* ───── 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ───── */

function currentCurrency() {
  return CURRENCIES.find(function (c) { return c.code === state.settings.currency; });
}

/* Сколько донгов стоит 1 единица текущей валюты. Если в настройках вписан свой курс — используем его,
   иначе берём рыночный курс из интернета (когда он уже загружен). */
function dongPerUnit() {
  if (state.settings.manualRate) return state.settings.manualRate;
  if (!state.rates) return null;
  return state.rates[state.settings.currency];
}

/* Число донгов → красивая строка: «1 250 000 ₫» */
function formatVnd(amount) {
  return Math.round(amount).toLocaleString("ru-RU") + " ₫";
}

/* Число в выбранной валюте → красивая строка с нужным количеством знаков: «1 234,50 $» */
function formatCurrency(amount, currency) {
  const value = amount.toLocaleString("ru-RU", { minimumFractionDigits: currency.digits, maximumFractionDigits: currency.digits });
  return value + " " + currency.symbol;
}

/* ───── РАСПОЗНАВАНИЕ ЧЕЛОВЕЧЕСКОГО ВВОДА ─────
   Люди во Вьетнаме пишут суммы по-разному: "150k", "150000", "1.5m", "1,5tr", "2тр".
   Эта функция превращает любой такой текст в чистое число донгов (или null, если не разобрать).
   Что понимает:
     k, к, тыс           → умножить на 1 000        (150k → 150 000)
     m, tr, тр, млн, m$  → умножить на 1 000 000     (1.5m → 1 500 000)
   Если суффикса нет и включён режим «В тысячах» — тоже умножаем на 1 000,
   потому что во Вьетнаме мелкие числа почти всегда означают тысячи донгов. */
function parseAmount(text) {
  if (!text) return null;
  let cleaned = text.trim().toLowerCase().replace(/\s+/g, "");
  if (cleaned === "") return null;

  let multiplier = 1;
  if (/(тр|млн|mil|m)$/.test(cleaned)) {
    multiplier = 1000000;
    cleaned = cleaned.replace(/(тр|млн|mil|m)$/, "");
  } else if (/(тыс|к|k)$/.test(cleaned)) {
    multiplier = 1000;
    cleaned = cleaned.replace(/(тыс|к|k)$/, "");
  } else if (state.settings.inputMode === "k") {
    multiplier = 1000;   // короткое число в режиме «В тысячах»: 150 понимаем как 150 000
  }

  cleaned = cleaned.replace(",", ".");             // «1,5» → «1.5», чтобы JavaScript понял дробь
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;  // это вообще похоже на число?

  const value = parseFloat(cleaned) * multiplier;
  return value > 0 ? Math.round(value) : null;
}

/* Разбивка суммы на купюры: сколько каких купюр понадобится (жадный алгоритм —
   берём сначала самые крупные купюры, потом более мелкие). */
function breakIntoNotes(amount) {
  let rest = Math.round(amount);
  const result = [];
  BANKNOTES.forEach(function (note) {
    const count = Math.floor(rest / note);
    if (count > 0) {
      result.push({ note: note, count: count });
      rest -= note * count;
    }
  });
  return result;
}


/* ───── 5. ЗАГРУЗКА КУРСОВ ВАЛЮТ ─────
   open.er-api.com — открытый бесплатный адрес, ключ не нужен, но по условиям сервиса
   нужно давать ссылку на источник (это сделано в окне настроек). Курсы там обновляются
   раз в сутки, поэтому и мы обновляем не чаще раза в сутки — незачем запрашивать чаще. */

const RATES_CACHE_KEY = "dong-app-rates-cache";
const RATES_TTL = 24 * 60 * 60 * 1000;   // сутки в миллисекундах

async function loadRates(force) {
  // Сначала смотрим, нет ли уже свежих курсов, сохранённых с прошлого раза
  if (!force) {
    try {
      const raw = localStorage.getItem(RATES_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.savedAt < RATES_TTL) {
          state.rates = cached.rates;
          state.ratesUpdated = cached.updated;
          return true;
        }
      }
    } catch (error) { /* мусор в памяти — просто загрузим заново */ }
  }

  try {
    // Донг как базовая валюта: сколько донгов стоит 1 единица каждой валюты — так и получаем rates[код]
    const response = await fetch("https://open.er-api.com/v6/latest/VND");
    if (!response.ok) throw new Error("network");
    const data = await response.json();
    if (data.result !== "success") throw new Error("api");

    // В ответе — сколько ЕДИНИЦ ВАЛЮТЫ дают за 1 донг, поэтому переворачиваем деление (1 / курс)
    const rates = {};
    CURRENCIES.forEach(function (c) {
      const perDong = data.rates[c.code];
      if (perDong) rates[c.code] = 1 / perDong;
    });

    state.rates = rates;
    state.ratesUpdated = data.time_last_update_utc || new Date().toISOString();
    try {
      localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ rates: rates, updated: state.ratesUpdated, savedAt: Date.now() }));
    } catch (error) { /* не критично, если не сохранилось */ }
    return true;
  } catch (error) {
    // Нет интернета или сервис недоступен: пробуем взять хоть старые курсы из памяти
    try {
      const raw = localStorage.getItem(RATES_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        state.rates = cached.rates;
        state.ratesUpdated = cached.updated;
        return "stale";   // курсы есть, но старые
      }
    } catch (e2) { /* совсем ничего нет */ }
    return false;
  }
}


/* ───── 6. НАХОДИМ ЭЛЕМЕНТЫ СТРАНИЦЫ ───── */

const rateLine = document.getElementById("rate-line");
const modeLabel = document.getElementById("mode-label");
const modePlain = document.getElementById("mode-plain");
const modeK = document.getElementById("mode-k");

const tabs = document.querySelectorAll('[role="tab"]');
const panels = { convert: document.getElementById("panel-convert"), change: document.getElementById("panel-change"), bill: document.getElementById("panel-bill"), expenses: document.getElementById("panel-expenses") };

// Конвертер
const dirFrom = document.getElementById("dir-from");
const dirTo = document.getElementById("dir-to");
const convLabel = document.getElementById("conv-label");
const convInput = document.getElementById("conv-input");
const convParsed = document.getElementById("conv-parsed");
const convQuick = document.getElementById("conv-quick");
const resultLabel = document.getElementById("result-label");
const resultMain = document.getElementById("result-main");
const resultOthers = document.getElementById("result-others");
const resultRate = document.getElementById("result-rate");
const noteGrid = document.getElementById("note-grid");
let convDirection = "toMain";   // "toMain": донги → ваша валюта; "toVnd": ваша валюта → донги

// Сдача
const chPrice = document.getElementById("ch-price");
const chPriceNote = document.getElementById("ch-price-note");
const chGiven = document.getElementById("ch-given");
const chGivenNote = document.getElementById("ch-given-note");
const chQuick = document.getElementById("ch-quick");
const chMain = document.getElementById("ch-main");
const chSub = document.getElementById("ch-sub");
const chNotes = document.getElementById("ch-notes");

// Счёт: общее для обоих способов
const billModeEqual = document.getElementById("billmode-equal");
const billModeItems = document.getElementById("billmode-items");
const billEqualBlock = document.getElementById("bill-equal");
const billItemsBlock = document.getElementById("bill-items");
const tipChips = document.getElementById("tip-chips");
const billRound = document.getElementById("bill-round");
const billResultLabel = document.getElementById("bill-result-label");
const billMain = document.getElementById("bill-main");
const billLines = document.getElementById("bill-lines");

// Счёт: способ «Поровну»
const billTotal = document.getElementById("bill-total");
const billNote = document.getElementById("bill-note");
const peopleValue = document.getElementById("people-value");
const peopleMinus = document.getElementById("people-minus");
const peoplePlus = document.getElementById("people-plus");

// Счёт: способ «По позициям»
const personsList = document.getElementById("persons-list");
const addPersonButton = document.getElementById("add-person");

// Настройки
const settingsDialog = document.getElementById("settings");
const openSettings = document.getElementById("open-settings");
const settingsClose = document.getElementById("settings-close");
const currencySelect = document.getElementById("currency-select");
const manualLabel = document.getElementById("manual-label");
const manualRateInput = document.getElementById("manual-rate");
const manualReset = document.getElementById("manual-reset");
const ratesStatus = document.getElementById("rates-status");
const ratesRefresh = document.getElementById("rates-refresh");
const compareAmountLabel = document.getElementById("compare-amount-label");
const compareAmount = document.getElementById("compare-amount");
const compareMarket = document.getElementById("compare-market");
const compareExchange = document.getElementById("compare-exchange");
const compareDiff = document.getElementById("compare-diff");

// Траты
const expDate = document.getElementById("exp-date");
const expAmount = document.getElementById("exp-amount");
const expAmountNote = document.getElementById("exp-amount-note");
const expAdd = document.getElementById("exp-add");
const expPeriodChips = document.getElementById("exp-period-chips");
const expCustomRange = document.getElementById("exp-custom-range");
const expFrom = document.getElementById("exp-from");
const expTo = document.getElementById("exp-to");
const expSummaryLabel = document.getElementById("exp-summary-label");
const expSummaryMain = document.getElementById("exp-summary-main");
const expSummarySub = document.getElementById("exp-summary-sub");
const expList = document.getElementById("exp-list");
const expEmpty = document.getElementById("exp-empty");

// Бюджет поездки
const budgetDialog = document.getElementById("budget-dialog");
const openBudget = document.getElementById("open-budget");
const budgetClose = document.getElementById("budget-close");
const budgetSummaryLine = document.getElementById("budget-summary-line");
const budgetCurrencySelect = document.getElementById("budget-currency");
const budgetAmountInput = document.getElementById("budget-amount");
const budgetDaysInput = document.getElementById("budget-days");
const budgetMain = document.getElementById("budget-main");
const budgetSub = document.getElementById("budget-sub");


/* ───── 7. ВКЛАДКИ ─────
   Один обработчик на всю панель вкладок: смотрим, на какую кнопку нажали. */

document.querySelector(".tabbar").addEventListener("click", function (event) {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  state.activeTab = button.dataset.tab;

  tabs.forEach(function (tab) { tab.setAttribute("aria-selected", String(tab === button)); });
  Object.keys(panels).forEach(function (key) { panels[key].hidden = key !== state.activeTab; });
});


/* ───── 8. ШАПКА: РЕЖИМ ВВОДА И СТРОКА КУРСА ───── */

function renderModeButtons() {
  const isK = state.settings.inputMode === "k";
  modePlain.setAttribute("aria-pressed", String(!isK));
  modeK.setAttribute("aria-pressed", String(isK));
}
modePlain.addEventListener("click", function () { state.settings.inputMode = "plain"; renderModeButtons(); saveSettings(); renderAll(); });
modeK.addEventListener("click", function () { state.settings.inputMode = "k"; renderModeButtons(); saveSettings(); renderAll(); });

function renderRateLine() {
  const currency = currentCurrency();
  const rate = dongPerUnit();
  if (!rate) {
    rateLine.textContent = "Курс сейчас недоступен. Загляните в настройки.";
    return;
  }
  const source = state.settings.manualRate ? "ваш курс" : "рыночный курс";
  rateLine.textContent = "1 " + currency.label.toLowerCase() + " ≈ " + formatVnd(rate) + " (" + source + ")";
}


/* ───── 9. ВКЛАДКА «КОНВЕРТЕР» ───── */

function renderCurrencyLabels() {
  // Подставляем код валюты во все места-«метки» data-main-code (кнопки направления)
  document.querySelectorAll("[data-main-code]").forEach(function (el) { el.textContent = state.settings.currency; });
}

function updateDirectionButtons() {
  dirFrom.setAttribute("aria-pressed", String(convDirection === "toMain"));
  dirTo.setAttribute("aria-pressed", String(convDirection === "toVnd"));
  const currency = currentCurrency();
  if (convDirection === "toMain") {
    convLabel.textContent = "Сумма в донгах";
    convInput.placeholder = "150k, 1,5m или 150000";
  } else {
    convLabel.textContent = "Сумма в " + currency.label.toLowerCase() + "ах";
    convInput.placeholder = "Например: 2000";
  }
}
dirFrom.addEventListener("click", function () { convDirection = "toMain"; updateDirectionButtons(); renderConverter(); });
dirTo.addEventListener("click", function () { convDirection = "toVnd"; updateDirectionButtons(); renderConverter(); });

/* Кнопки быстрых сумм в донгах: меняются в зависимости от направления перевода */
function renderQuickAmounts() {
  const amounts = convDirection === "toMain" ? [50000, 100000, 200000, 500000, 1000000] : [10, 50, 100, 500, 1000];
  convQuick.replaceChildren();
  amounts.forEach(function (amount) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = convDirection === "toMain" ? formatVnd(amount) : amount.toLocaleString("ru-RU");
    button.addEventListener("click", function () { convInput.value = String(amount); renderConverter(); });
    convQuick.appendChild(button);
  });
}

function renderConverter() {
  const currency = currentCurrency();
  const rate = dongPerUnit();

  let vndAmount = null;
  if (convDirection === "toMain") {
    vndAmount = parseAmount(convInput.value);
    convParsed.textContent = convInput.value && vndAmount === null
      ? "Не могу распознать сумму. Пример: 150k или 150000"
      : (vndAmount !== null ? "Понял как " + formatVnd(vndAmount) : "");
    convParsed.classList.toggle("warn", Boolean(convInput.value) && vndAmount === null);
  } else {
    // Здесь режим «В тысячах» не нужен: суммы в рублях/долларах/евро люди пишут как есть
    const raw = convInput.value.trim().replace(",", ".");
    const num = raw === "" ? null : parseFloat(raw);
    vndAmount = (num && rate) ? num * rate : null;
    convParsed.textContent = "";
  }

  resultLabel.textContent = convDirection === "toMain" ? "Это примерно" : "Это примерно в донгах";

  if (vndAmount === null || !rate) {
    resultMain.textContent = "—";
    resultOthers.replaceChildren();
    resultRate.textContent = "";
    renderNoteGrid(rate);
    return;
  }

  if (convDirection === "toMain") {
    resultMain.textContent = formatCurrency(vndAmount / rate, currency);
    // Дополнительно показываем сумму в двух других валютах — вдруг пригодится
    resultOthers.replaceChildren();
    CURRENCIES.filter(function (c) { return c.code !== currency.code; }).forEach(function (c) {
      const r = state.rates ? state.rates[c.code] : null;
      if (r) {
        const li = document.createElement("li");
        li.textContent = "≈ " + formatCurrency(vndAmount / r, c);
        resultOthers.appendChild(li);
      }
    });
  } else {
    resultMain.textContent = formatVnd(vndAmount);
    resultOthers.replaceChildren();
  }

  resultRate.textContent = "По курсу 1 " + currency.label.toLowerCase() + " ≈ " + formatVnd(rate);
  renderNoteGrid(rate);
}

/* Шпаргалка по купюрам: для каждой купюры показываем, сколько она стоит в вашей валюте */
function renderNoteGrid(rate) {
  const currency = currentCurrency();
  noteGrid.replaceChildren();
  BANKNOTES.forEach(function (note) {
    const li = document.createElement("li");
    li.style.setProperty("--note-color", NOTE_COLORS[note] || "#eef2ee");
    const vnd = document.createElement("span");
    vnd.className = "vnd";
    vnd.textContent = formatVnd(note);
    const conv = document.createElement("span");
    conv.className = "conv";
    conv.textContent = rate ? "≈ " + formatCurrency(note / rate, currency) : "—";
    li.append(vnd, conv);
    noteGrid.appendChild(li);
  });
}

convInput.addEventListener("input", renderConverter);


/* ───── 10. ВКЛАДКА «СДАЧА» ───── */

function renderChangeQuick() {
  chQuick.replaceChildren();
  [50000, 100000, 200000, 500000].forEach(function (amount) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = formatVnd(amount);
    button.addEventListener("click", function () { chGiven.value = String(amount); renderChange(); });
    chQuick.appendChild(button);
  });
}

function renderChange() {
  const price = parseAmount(chPrice.value);
  const given = parseAmount(chGiven.value);

  chPriceNote.textContent = chPrice.value && price === null ? "Не могу распознать сумму" : (price !== null ? "Понял как " + formatVnd(price) : "");
  chPriceNote.classList.toggle("warn", Boolean(chPrice.value) && price === null);
  chGivenNote.textContent = chGiven.value && given === null ? "Не могу распознать сумму" : (given !== null ? "Понял как " + formatVnd(given) : "");
  chGivenNote.classList.toggle("warn", Boolean(chGiven.value) && given === null);

  chNotes.replaceChildren();

  if (price === null || given === null) {
    chMain.textContent = "—";
    chSub.textContent = "Впишите цену и сумму, которую вы дали.";
    return;
  }

  const diff = given - price;
  if (diff < 0) {
    chMain.textContent = "Не хватает " + formatVnd(-diff);
    chSub.textContent = "Дайте ещё немного, чтобы расплатиться.";
    return;
  }

  chMain.textContent = formatVnd(diff);
  chSub.textContent = diff === 0 ? "Сдачи нет, сумма точная." : "Сдача, которую должны вернуть.";

  if (diff > 0) {
    breakIntoNotes(diff).forEach(function (part) {
      const li = document.createElement("li");
      li.textContent = formatVnd(part.note) + " × " + part.count;
      chNotes.appendChild(li);
    });
  }
}

chPrice.addEventListener("input", renderChange);
chGiven.addEventListener("input", renderChange);


/* ───── 11. ВКЛАДКА «СЧЁТ» ─────
   Два способа посчитать, у каждого своя функция отрисовки:
     renderBillEqual() — старый способ: одна сумма делится поровну на N человек
     renderBillItems() — новый способ: у каждого человека свой список позиций
   Функция renderBill() — «диспетчер»: решает, какой из двух способов сейчас показан,
   и вызывает нужную функцию. Чаевые и округление общие для обоих способов. */

function renderTipChips() {
  tipChips.replaceChildren();
  [0, 5, 10, 15].forEach(function (percent) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = percent === 0 ? "Без чаевых" : percent + "%";
    button.setAttribute("aria-pressed", String(state.billTip === percent));
    button.addEventListener("click", function () { state.billTip = percent; renderTipChips(); renderBill(); });
    tipChips.appendChild(button);
  });
}

/* Переключение способа расчёта: показываем нужный блок и прячем второй */
function setBillMode(mode) {
  state.billMode = mode;
  billModeEqual.setAttribute("aria-pressed", String(mode === "equal"));
  billModeItems.setAttribute("aria-pressed", String(mode === "items"));
  renderBill();
}
billModeEqual.addEventListener("click", function () { setBillMode("equal"); });
billModeItems.addEventListener("click", function () { setBillMode("items"); });

function renderBill() {
  const isItems = state.billMode === "items";
  billEqualBlock.hidden = isItems;
  billItemsBlock.hidden = !isItems;
  billResultLabel.textContent = isItems ? "Итого собрать" : "С каждого";
  if (isItems) { renderBillItems(); } else { renderBillEqual(); }
}


/* ── Способ «Поровну» ── */

peopleMinus.addEventListener("click", function () { if (state.billPeople > 1) { state.billPeople -= 1; renderBill(); } });
peoplePlus.addEventListener("click", function () { if (state.billPeople < 30) { state.billPeople += 1; renderBill(); } });
billTotal.addEventListener("input", renderBill);
billRound.addEventListener("change", renderBill);

function renderBillEqual() {
  peopleValue.textContent = state.billPeople;
  peopleMinus.disabled = state.billPeople <= 1;
  peoplePlus.disabled = state.billPeople >= 30;

  const total = parseAmount(billTotal.value);
  billNote.textContent = billTotal.value && total === null ? "Не могу распознать сумму" : (total !== null ? "Понял как " + formatVnd(total) : "");
  billNote.classList.toggle("warn", Boolean(billTotal.value) && total === null);

  billLines.replaceChildren();

  if (total === null) {
    billMain.textContent = "—";
    return;
  }

  const withTip = total * (1 + state.billTip / 100);
  let perPerson = withTip / state.billPeople;
  if (billRound.checked) perPerson = Math.ceil(perPerson / 1000) * 1000;   // округляем вверх до 1000 ₫, чтобы сумма точно хватила
  const roundedTotal = perPerson * state.billPeople;

  billMain.textContent = formatVnd(perPerson);

  const tipLine = document.createElement("li");
  tipLine.textContent = state.billTip > 0
    ? "Счёт " + formatVnd(total) + " + чаевые " + state.billTip + "% = " + formatVnd(withTip)
    : "Счёт без чаевых: " + formatVnd(total);
  billLines.appendChild(tipLine);

  const totalLine = document.createElement("li");
  totalLine.textContent = "Соберётся всего: " + formatVnd(roundedTotal) + (billRound.checked ? " (с округлением)" : "");
  billLines.appendChild(totalLine);
}


/* ── Способ «По позициям» ─────
   Карточки людей — обычные элементы на странице, а не отдельный список в памяти:
   что человек напечатал в поле, то там и лежит, пока карточка существует.
   Поэтому при подсчёте мы каждый раз заново читаем значения прямо со страницы
   (querySelectorAll), а не храним их копию в JavaScript — это проще и не даёт
   данным на экране и в расчёте разойтись.

   Каждой карточке и каждой строке-позиции нужен уникальный номер (id), чтобы их
   можно было различать. Простой счётчик, который увеличивается на 1 при каждом
   добавлении, для этого вполне достаточен. */

let personCounter = 0;
let personItemCounter = 0;

/* Создаёт одну строку позиции: «название» + «цена» + кнопка «×» (убрать строку) */
function createItemRow() {
  personItemCounter += 1;
  const row = document.createElement("li");
  row.className = "item-line";
  row.dataset.itemId = "item-" + personItemCounter;

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "item-name";
  nameInput.placeholder = "Например, лапша";
  nameInput.autocomplete = "off";

  const priceInput = document.createElement("input");
  priceInput.type = "text";
  priceInput.className = "item-price";
  priceInput.inputMode = "text";
  priceInput.autocomplete = "off";
  priceInput.spellcheck = false;
  priceInput.placeholder = "50k";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "item-remove";
  removeButton.dataset.action = "remove-item";
  removeButton.setAttribute("aria-label", "Убрать позицию");
  removeButton.textContent = "×";

  row.append(nameInput, priceInput, removeButton);
  return row;
}

/* Создаёт карточку человека: поле имени, список позиций (начинается с одной строки),
   кнопку «+ Добавить позицию» и строку с итогом по этому человеку. */
function createPersonCard(placeholderNumber) {
  personCounter += 1;
  const card = document.createElement("div");
  card.className = "person-card";
  card.dataset.personId = "person-" + personCounter;

  const head = document.createElement("div");
  head.className = "person-head";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "person-name";
  nameInput.placeholder = "Человек " + placeholderNumber;
  nameInput.autocomplete = "off";
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove-person-btn";
  removeButton.dataset.action = "remove-person";
  removeButton.textContent = "Убрать";
  head.append(nameInput, removeButton);

  const rows = document.createElement("ul");
  rows.className = "item-rows";
  rows.appendChild(createItemRow());   // у новой карточки сразу одна пустая строка

  const addItemButton = document.createElement("button");
  addItemButton.type = "button";
  addItemButton.className = "btn-link";
  addItemButton.dataset.action = "add-item";
  addItemButton.textContent = "+ Добавить позицию";

  const subtotal = document.createElement("p");
  subtotal.className = "person-subtotal";
  const subtotalLabel = document.createElement("span");
  subtotalLabel.textContent = "Итого: ";
  const subtotalValue = document.createElement("strong");
  subtotalValue.className = "person-subtotal-value";
  subtotalValue.textContent = "0 ₫";
  subtotal.append(subtotalLabel, subtotalValue);

  card.append(head, rows, addItemButton, subtotal);
  return card;
}

/* Кнопку «Убрать» у карточки человека прячем, если человек остался только один:
   хотя бы одна карточка должна остаться всегда. Заодно подписи-заглушки
   «Человек 1», «Человек 2» пересчитываем по новому порядку после удаления. */
function refreshPersonCards() {
  const cards = personsList.querySelectorAll(".person-card");
  cards.forEach(function (card, index) {
    card.querySelector(".remove-person-btn").hidden = cards.length <= 1;
    const nameInput = card.querySelector(".person-name");
    nameInput.placeholder = "Человек " + (index + 1);
  });
}

function addPerson() {
  const count = personsList.querySelectorAll(".person-card").length;
  if (count >= 20) return;   // разумный предел, чтобы список не стал бесконечным
  personsList.appendChild(createPersonCard(count + 1));
  refreshPersonCards();
  renderBill();
}
addPersonButton.addEventListener("click", addPerson);

/* ОДИН обработчик нажатий на весь список карточек (делегирование событий):
   смотрим, по какой именно кнопке кликнули — «+ Добавить позицию», «×» у строки
   или «Убрать» у карточки — и делаем соответствующее действие. */
personsList.addEventListener("click", function (event) {
  const addItem = event.target.closest('[data-action="add-item"]');
  if (addItem) {
    const rows = addItem.closest(".person-card").querySelector(".item-rows");
    if (rows.children.length < 20) rows.appendChild(createItemRow());
    renderBill();
    return;
  }

  const removeItem = event.target.closest('[data-action="remove-item"]');
  if (removeItem) {
    const rows = removeItem.closest(".item-rows");
    if (rows.children.length > 1) removeItem.closest(".item-line").remove();   // последнюю строку не убираем
    renderBill();
    return;
  }

  const removePerson = event.target.closest('[data-action="remove-person"]');
  if (removePerson) {
    const cards = personsList.querySelectorAll(".person-card");
    if (cards.length > 1) removePerson.closest(".person-card").remove();
    refreshPersonCards();
    renderBill();
  }
});

/* Любой ввод в имени или цене сразу пересчитывает итоги (событие "input" срабатывает
   при каждом нажатии клавиши). Делегируем на весь список — не нужно вешать обработчик
   на каждое поле по отдельности. */
personsList.addEventListener("input", function (event) {
  if (event.target.matches(".person-name, .item-price, .item-name")) renderBillItems();
});

function renderBillItems() {
  const cards = Array.from(personsList.querySelectorAll(".person-card"));
  const tipMultiplier = 1 + state.billTip / 100;
  let grandSubtotal = 0;    // сумма всех позиций без чаевых
  let grandCollected = 0;   // сколько нужно собрать всего (с чаевыми и округлением)
  const perPersonLines = [];

  cards.forEach(function (card) {
    // Считаем сумму позиций этого человека. Пустая или нераспознанная строка идёт как 0,
    // а поле с явно неверным текстом подсвечиваем рамкой, но расчёт не останавливаем.
    let subtotal = 0;
    card.querySelectorAll(".item-price").forEach(function (priceInput) {
      const amount = parseAmount(priceInput.value);
      priceInput.classList.toggle("invalid", Boolean(priceInput.value) && amount === null);
      if (amount !== null) subtotal += amount;
    });

    card.querySelector(".person-subtotal-value").textContent = formatVnd(subtotal);
    grandSubtotal += subtotal;

    let payable = subtotal * tipMultiplier;
    if (billRound.checked) payable = Math.ceil(payable / 1000) * 1000;
    grandCollected += payable;

    const nameInput = card.querySelector(".person-name");
    const name = nameInput.value.trim() || nameInput.placeholder;
    perPersonLines.push(name + ": " + formatVnd(payable));
  });

  billMain.textContent = formatVnd(grandCollected);

  billLines.replaceChildren();
  perPersonLines.forEach(function (text) {
    const li = document.createElement("li");
    li.textContent = text;
    billLines.appendChild(li);
  });

  if (state.billTip > 0) {
    const tipLine = document.createElement("li");
    tipLine.textContent = "Все позиции " + formatVnd(grandSubtotal) + " + чаевые " + state.billTip + "% = " + formatVnd(grandSubtotal * tipMultiplier);
    billLines.appendChild(tipLine);
  }
}


/* ───── 12. ВКЛАДКА «ТРАТЫ» ─────
   Каждая запись хранит: дату, сумму в донгах, вашу валюту и курс НА МОМЕНТ ЗАПИСИ.
   Так позже видно, сколько это было «тогда» — даже если курс с тех пор изменился,
   а не пересчитывается задним числом по сегодняшнему курсу.
   Итог за выбранный период считается в донгах (это точная сумма без всяких курсов),
   а строка под ним — ориентировочный перевод в вашу валюту по СЕГОДНЯШНЕМУ курсу. */

const EXPENSES_KEY = "dong-app-expenses";
const BUDGET_KEY = "dong-app-budget";

/* Бюджет поездки: сумма с собой, её валюта (может отличаться от основной валюты
   приложения — человек мог взять доллары, а по умолчанию считать в рублях) и на
   сколько дней её растянуть. Храним отдельно от общих настроек, чтобы не путать
   «валюту для конвертера» и «валюту наличных на бюджет». */
function loadBudget() {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      currency: CURRENCIES.some(function (c) { return c.code === saved.currency; }) ? saved.currency : state.settings.currency,
      amount: typeof saved.amount === "number" && saved.amount > 0 ? saved.amount : null,
      days: typeof saved.days === "number" && saved.days > 0 ? saved.days : null
    };
  } catch (error) {
    return { currency: state.settings.currency, amount: null, days: null };
  }
}

function saveBudget() {
  try {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(state.budget));
  } catch (error) {
    /* Не удалось сохранить — не страшно, значения останутся видны в этом сеансе */
  }
}

function renderBudgetCurrencySelect() {
  budgetCurrencySelect.replaceChildren();
  CURRENCIES.forEach(function (c) {
    const option = document.createElement("option");
    option.value = c.code;
    option.textContent = c.label + " (" + c.symbol + ")";
    budgetCurrencySelect.appendChild(option);
  });
  budgetCurrencySelect.value = state.budget.currency;
}

/* Донгов за 1 единицу ЛЮБОЙ валюты (не только текущей выбранной) — нужно для бюджета,
   у которого своя валюта может отличаться от основной. Свой курс обмена (manualRate)
   тут не применяем: он задан для другой валюты и был бы неверным ориентиром. */
function dongPerUnitFor(code) {
  if (!state.rates) return null;
  return state.rates[code];
}

function renderBudget() {
  const currency = CURRENCIES.find(function (c) { return c.code === budgetCurrencySelect.value; }) || currentCurrency();
  const amount = parseFloat(budgetAmountInput.value.replace(",", "."));
  const days = parseInt(budgetDaysInput.value, 10);

  if (!amount || amount <= 0 || !days || days <= 0) {
    budgetMain.textContent = "—";
    budgetSub.textContent = "Впишите сумму и количество дней.";
    budgetSummaryLine.textContent = "Не настроен";
    return;
  }

  const perDay = amount / days;
  const perDayText = formatCurrency(perDay, currency);
  budgetMain.textContent = perDayText;

  const rate = dongPerUnitFor(currency.code);
  const vndText = rate ? "≈ " + formatVnd(perDay * rate) + " в день" : null;
  budgetSub.textContent = rate
    ? vndText + " · всего на " + days + " " + dayWord(days)
    : "Курс для этой валюты пока недоступен.";

  // Короткая сводка на самой вкладке «Траты», чтобы видеть лимит, не открывая окно
  budgetSummaryLine.textContent = perDayText + " в день" + (vndText ? " (" + vndText.replace("≈ ", "≈") + ")" : "");
}

/* «день / дня / дней» — русское склонение числительных, чтобы подпись читалась естественно */
function dayWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня";
  return "дней";
}

budgetCurrencySelect.addEventListener("change", function () {
  state.budget.currency = budgetCurrencySelect.value;
  saveBudget();
  renderBudget();
});
budgetAmountInput.addEventListener("input", function () {
  const value = parseFloat(budgetAmountInput.value.replace(",", "."));
  state.budget.amount = value > 0 ? value : null;
  saveBudget();
  renderBudget();
});
budgetDaysInput.addEventListener("input", function () {
  const value = parseInt(budgetDaysInput.value, 10);
  state.budget.days = value > 0 ? value : null;
  saveBudget();
  renderBudget();
});



/* Готовые варианты периода. id "custom" включает два поля «с даты» / «по дату». */
const EXPENSE_PERIODS = [
  { id: "today", label: "Сегодня" },
  { id: "7", label: "7 дней" },
  { id: "30", label: "30 дней" },
  { id: "all", label: "Весь период" },
  { id: "custom", label: "Свой период" }
];

function loadExpenses() {
  try {
    const raw = localStorage.getItem(EXPENSES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    // Оставляем только записи правильной формы — вдруг в памяти лежит что-то испорченное
    return list.filter(function (entry) {
      return entry && typeof entry.id === "string" && typeof entry.date === "string"
        && Number.isFinite(entry.vnd) && entry.vnd > 0;
    });
  } catch (error) {
    return [];   // память недоступна или испорчена: начинаем с пустого списка
  }
}

function saveExpenses() {
  try {
    localStorage.setItem(EXPENSES_KEY, JSON.stringify(state.expenses));
  } catch (error) {
    /* Не удалось сохранить — не страшно, записи останутся видны в этом сеансе */
  }
}

/* Сегодняшняя дата в формате ГГГГ-ММ-ДД: в этом формате работают поля выбора даты
   и в этом же формате удобно сравнивать даты как обычный текст (он совпадает с порядком
   по времени). padStart добавляет ноль спереди: 9 → "09". */
function todayString() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

/* Дата N дней назад в том же формате ГГГГ-ММ-ДД — нужна для фильтров «7 дней», «30 дней» */
function daysAgoString(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

/* «2026-09-25» → «25.09.2026», так привычнее читать в списке */
function formatDateHuman(isoDate) {
  const parts = isoDate.split("-");
  return parts[2] + "." + parts[1] + "." + parts[0];
}

/* Переключение «таблеток» периода: показываем/прячем поля своего периода и перерисовываем список */
function renderExpensePeriodChips() {
  expPeriodChips.replaceChildren();
  EXPENSE_PERIODS.forEach(function (period) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = period.label;
    button.setAttribute("aria-pressed", String(state.expensePeriod === period.id));
    button.addEventListener("click", function () {
      state.expensePeriod = period.id;
      renderExpensePeriodChips();
      expCustomRange.hidden = period.id !== "custom";
      renderExpenses();
    });
    expPeriodChips.appendChild(button);
  });
}

/* Записи, которые попадают в выбранный период. Даты в формате ГГГГ-ММ-ДД можно сравнивать
   как обычный текст: у них порядок символов совпадает с порядком по времени. */
function expensesInPeriod() {
  const period = state.expensePeriod;
  const today = todayString();
  let from = null;
  let to = null;

  if (period === "today") { from = today; to = today; }
  else if (period === "7") { from = daysAgoString(6); to = today; }     // 6 дней назад + сегодня = 7 дней
  else if (period === "30") { from = daysAgoString(29); to = today; }
  else if (period === "custom") { from = expFrom.value || null; to = expTo.value || null; }
  // period === "all": from и to остаются null — фильтр не применяется, берём все записи

  return state.expenses.filter(function (entry) {
    if (from && entry.date < from) return false;
    if (to && entry.date > to) return false;
    return true;
  });
}

/* ГЛАВНАЯ ФУНКЦИЯ ОТРИСОВКИ ВКЛАДКИ. Пересчитывает итог за период и список записей.
   Вызывается при запуске, после добавления/удаления записи, смены периода и смены валюты. */
function renderExpenses() {
  const list = expensesInPeriod();
  // Показываем от новых к старым: сначала по дате, а если даты совпадают — недавно добавленные выше
  const sorted = list.slice().sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  const totalVnd = list.reduce(function (sum, entry) { return sum + entry.vnd; }, 0);
  const currency = currentCurrency();
  const rate = dongPerUnit();

  const periodInfo = EXPENSE_PERIODS.find(function (p) { return p.id === state.expensePeriod; });
  const wordForm = list.length % 10 === 1 && list.length % 100 !== 11 ? "запись"
    : [2, 3, 4].includes(list.length % 10) && ![12, 13, 14].includes(list.length % 100) ? "записи" : "записей";
  expSummaryLabel.textContent = "Итого за период «" + (periodInfo ? periodInfo.label.toLowerCase() : "") + "» — " + list.length + " " + wordForm;
  expSummaryMain.textContent = formatVnd(totalVnd);
  expSummarySub.textContent = rate ? "≈ " + formatCurrency(totalVnd / rate, currency) + " по сегодняшнему курсу" : "";

  expList.replaceChildren();
  expEmpty.hidden = sorted.length > 0;

  sorted.forEach(function (entry) {
    const li = document.createElement("li");
    li.className = "expense-row";

    const info = document.createElement("div");
    info.className = "expense-info";
    const dateEl = document.createElement("span");
    dateEl.className = "expense-date";
    dateEl.textContent = formatDateHuman(entry.date);
    const amountEl = document.createElement("span");
    amountEl.className = "expense-amount";
    amountEl.textContent = formatVnd(entry.vnd);
    info.append(dateEl, amountEl);

    // Перевод в валюту, которая была выбрана В ТОТ ДЕНЬ, по курсу ТОГО дня — это и есть
    // «столько-то по курсу на такое-то число» из примера
    const convertedEl = document.createElement("span");
    convertedEl.className = "expense-converted";
    const entryCurrency = CURRENCIES.find(function (c) { return c.code === entry.currency; });
    convertedEl.textContent = (entry.rate && entryCurrency)
      ? "≈ " + formatCurrency(entry.vnd / entry.rate, entryCurrency) + " (курс на тот день)"
      : "курс на тот день неизвестен";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "expense-remove";
    removeButton.setAttribute("aria-label", "Удалить запись за " + formatDateHuman(entry.date));
    removeButton.textContent = "×";
    removeButton.addEventListener("click", function () {
      state.expenses = state.expenses.filter(function (e) { return e.id !== entry.id; });
      saveExpenses();
      renderExpenses();
    });

    li.append(info, convertedEl, removeButton);
    expList.appendChild(li);
  });
}

let expenseCounter = 0;

/* Кнопка «Добавить запись»: проверяем сумму, запоминаем дату, сумму, вашу текущую валюту
   и курс на этот момент, сохраняем в память браузера и перерисовываем список. */
expAdd.addEventListener("click", function () {
  const amount = parseAmount(expAmount.value);
  expAmountNote.textContent = expAmount.value && amount === null ? "Не могу распознать сумму. Пример: 500k" : "";
  expAmountNote.classList.toggle("warn", Boolean(expAmount.value) && amount === null);
  if (amount === null) { expAmount.focus(); return; }

  expenseCounter += 1;
  state.expenses.push({
    id: Date.now() + "-" + expenseCounter,   // достаточно уникально для одного устройства
    date: expDate.value || todayString(),
    vnd: amount,
    currency: state.settings.currency,
    rate: dongPerUnit()   // может быть null, если курс ещё не загрузился — тогда покажем «неизвестен»
  });
  saveExpenses();

  expAmount.value = "";
  expAmountNote.textContent = "";
  renderExpenses();
});

expFrom.addEventListener("change", renderExpenses);
expTo.addEventListener("change", renderExpenses);


/* ───── 13. ОКНО НАСТРОЕК ───── */

/* Строим список <option> в выпадающем списке по данным из CURRENCIES и выставляем
   текущий выбор. Пересоздаём список целиком — валют мало (пять), это не накладно. */
function renderCurrencySelect() {
  currencySelect.replaceChildren();
  CURRENCIES.forEach(function (c) {
    const option = document.createElement("option");
    option.value = c.code;
    option.textContent = c.label + " (" + c.symbol + ")";
    currencySelect.appendChild(option);
  });
  currencySelect.value = state.settings.currency;
}
currencySelect.addEventListener("change", function () {
  state.settings.currency = currencySelect.value;
  state.settings.manualRate = null;   // свой курс был для другой валюты, поэтому сбрасываем
  manualRateInput.value = "";
  saveSettings();
  renderAll();
});

function renderManualRateField() {
  const currency = currentCurrency();
  manualLabel.textContent = "Донгов за 1 " + currency.symbol;
  manualRateInput.value = state.settings.manualRate ? String(state.settings.manualRate) : "";
}

manualRateInput.addEventListener("change", function () {
  const value = parseFloat(manualRateInput.value.replace(",", "."));
  state.settings.manualRate = value > 0 ? value : null;
  saveSettings();
  renderAll();
});
manualReset.addEventListener("click", function () {
  state.settings.manualRate = null;
  manualRateInput.value = "";
  saveSettings();
  renderAll();
});

/* ───── СРАВНЕНИЕ С РЫНОЧНЫМ КУРСОМ ─────
   Идея: пользователь уже вписал курс обменника в поле выше («Ваш курс обмена»).
   Здесь он дополнительно вписывает сумму, которую собирается поменять, и видит,
   сколько донгов выйдет по рыночному курсу и сколько — по курсу обменника, плюс разницу.
   Специально НЕ пишем «выгодно» или «невыгодно» — только цифры, вывод за пользователем. */

function renderCompareAmountLabel() {
  const currency = currentCurrency();
  compareAmountLabel.textContent = "Сумма обмена, " + currency.symbol;
}

function renderCompare() {
  const currency = currentCurrency();
  const amount = parseFloat(compareAmount.value.replace(",", "."));
  const marketRate = state.rates ? state.rates[currency.code] : null;
  const exchangeValue = parseFloat(manualRateInput.value.replace(",", "."));
  const exchangeRate = exchangeValue > 0 ? exchangeValue : null;

  if (!amount || amount <= 0) {
    compareMarket.textContent = "Впишите сумму обмена, чтобы сравнить курсы.";
    compareExchange.textContent = "";
    compareDiff.textContent = "";
    return;
  }
  if (!marketRate) {
    compareMarket.textContent = "Рыночный курс пока не загружен.";
    compareExchange.textContent = "";
    compareDiff.textContent = "";
    return;
  }

  const marketResult = amount * marketRate;
  compareMarket.textContent = "По рыночному курсу: " + formatVnd(marketResult);

  if (!exchangeRate) {
    compareExchange.textContent = "Впишите курс обменника выше, чтобы сравнить.";
    compareDiff.textContent = "";
    return;
  }

  const exchangeResult = amount * exchangeRate;
  compareExchange.textContent = "По курсу обменника: " + formatVnd(exchangeResult);

  const diffVnd = exchangeResult - marketResult;
  const diffCurrency = diffVnd / marketRate;
  const sign = diffVnd >= 0 ? "+" : "";
  compareDiff.textContent = "Разница: " + sign + formatVnd(diffVnd) + " (" + sign + formatCurrency(diffCurrency, currency) + ")";
}

compareAmount.addEventListener("input", renderCompare);
// Курс обменника из поля выше меняется — сразу обновляем сравнение, не дожидаясь blur
manualRateInput.addEventListener("input", renderCompare);

function renderRatesStatus() {
  if (!state.rates) { ratesStatus.textContent = "Курсы пока не загружены."; return; }
  const date = state.ratesUpdated ? new Date(state.ratesUpdated) : null;
  const when = date && !isNaN(date) ? date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "недавно";
  ratesStatus.textContent = "Обновлено: " + when + ". Курсы обновляются не чаще раза в сутки.";
}

openSettings.addEventListener("click", function () { settingsDialog.showModal(); });
settingsClose.addEventListener("click", function () { settingsDialog.close(); });
settingsDialog.addEventListener("click", function (event) {
  if (event.target === settingsDialog) settingsDialog.close();   // клик по затемнённому фону вокруг окна
});

openBudget.addEventListener("click", function () { budgetDialog.showModal(); });
budgetClose.addEventListener("click", function () { budgetDialog.close(); });
budgetDialog.addEventListener("click", function (event) {
  if (event.target === budgetDialog) budgetDialog.close();   // клик по затемнённому фону вокруг окна
});

ratesRefresh.addEventListener("click", async function () {
  ratesRefresh.disabled = true;
  ratesStatus.textContent = "Обновляю…";
  await loadRates(true);
  ratesRefresh.disabled = false;
  renderAll();
});


/* ───── 14. ОБЩАЯ ОТРИСОВКА ─────
   Вызывается при запуске и при каждом изменении настроек. Обновляет сразу все вкладки:
   так, например, смена валюты в настройках сразу отражается везде, где она показана. */

function renderAll() {
  renderCurrencyLabels();
  updateDirectionButtons();
  renderRateLine();
  renderCurrencySelect();
  renderManualRateField();
  renderRatesStatus();
  renderCompareAmountLabel();
  renderCompare();
  renderConverter();
  renderChange();
  renderBill();
  renderExpenses();
  renderBudget();
}


/* ───── 15. ПЕРВЫЙ ЗАПУСК ───── */

renderModeButtons();
renderQuickAmounts();
renderChangeQuick();
renderTipChips();
addPerson();   // на вкладке «Счёт» по умолчанию заводим двух человек, как в примере «2 человека»
addPerson();

// Вкладка «Траты»: подгружаем сохранённые записи и ставим сегодняшнюю дату в поля по умолчанию
state.expenses = loadExpenses();
expDate.value = todayString();
expFrom.value = todayString();
expTo.value = todayString();
renderExpensePeriodChips();

// Бюджет поездки: подгружаем сохранённые значения и выставляем их в поля
state.budget = loadBudget();
renderBudgetCurrencySelect();
if (state.budget.amount) budgetAmountInput.value = String(state.budget.amount);
if (state.budget.days) budgetDaysInput.value = String(state.budget.days);
renderBudget();

renderAll();

loadRates(false).then(function (status) {
  if (status === "stale") ratesStatus.textContent = "Не удалось обновить курс, использую сохранённые данные.";
  renderAll();
});

// Регистрируем сервис-воркер, чтобы приложение открывалось и без интернета.
// Делаем это в самом конце и без остановки работы остального кода (async-стиль через .then).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () { /* не критично, если не получилось */ });
  });
}
