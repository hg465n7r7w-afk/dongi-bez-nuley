/* ═══════════════════════════════════════════════════════════════════════
   sw.js — СЕРВИС-ВОРКЕР (работа без интернета)

   Сервис-воркер — маленькая программа, которая живёт в браузере отдельно от страницы
   и «стоит между» приложением и интернетом. Мы используем её для одного: запоминать
   файлы приложения, чтобы оно открывалось даже без сети (на пляже, в горах, без роуминга).

   Как это работает:
   1. При первом открытии (install) браузер сохраняет файлы из списка FILES в «кладовку» (cache).
   2. Потом на каждую загрузку файла (fetch) отвечаем СРАЗУ из кладовки, а в фоне
      проверяем, нет ли новой версии, и обновляем кладовку. Новая версия появится
      при следующем открытии приложения.
   3. Запросы за курсами валют сюда не попадают: их хранит сам app.js.

   ЕСЛИ ВЫ ИЗМЕНИЛИ ФАЙЛЫ ПРИЛОЖЕНИЯ: увеличьте номер в CACHE_NAME («dong-v1» → «dong-v2»),
   тогда старая кладовка будет удалена и телефоны получат свежие файлы.
   ═══════════════════════════════════════════════════════════════════════ */

const CACHE_NAME = "dong-v10";
const FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png"
];

// Установка: кладём файлы в кладовку
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })   // не ждём закрытия старых вкладок
  );
});

// Активация: удаляем старые кладовки
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Каждый запрос файла: отвечаем из кладовки и обновляем её в фоне
self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;                              // нас интересует только чтение
  if (new URL(request.url).hostname === "open.er-api.com") return;   // курсы валют сюда не кладём

  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(request).then(function (cached) {
        const network = fetch(request).then(function (response) {
          if (response && (response.ok || response.type === "opaque")) {
            cache.put(request, response.clone());
          }
          return response;
        }).catch(function () { return null; });                       // нет сети: не страшно

        // Есть в кладовке: отдаём сразу. Нет: ждём сеть. Нет и сети: показываем главную страницу.
        return cached || network.then(function (response) {
          return response || cache.match("index.html");
        });
      });
    })
  );
});
