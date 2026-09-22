/*
 * 수영 노트 — 서비스 워커
 * 앱 셸을 캐시해 폰에서 설치(홈 화면 추가) 후 오프라인에서도 열리도록 함.
 * file:// 등 서비스 워커를 지원하지 않는 환경에서는 index.html의 등록 코드가
 * 조용히 무시하도록 되어 있으므로 이 파일 자체는 항상 존재해도 안전함.
 */
var CACHE_NAME = "swim-notes-shell-v1";
var APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .catch(function () { /* 일부 파일이 없어도 설치 자체는 계속 진행 */ })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var network = fetch(event.request).then(function (res) {
        try {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        } catch (e) { /* no-op */ }
        return res;
      }).catch(function () { return cached; });
      // 캐시가 있으면 즉시 보여주고(오프라인 대비), 없으면 네트워크 응답을 기다림
      return cached || network;
    })
  );
});
