/*
 * 수영 노트 — 서비스 워커
 * 앱 셸을 캐시해 폰에서 설치(홈 화면 추가) 후 오프라인에서도 열리도록 함.
 * file:// 등 서비스 워커를 지원하지 않는 환경에서는 index.html의 등록 코드가
 * 조용히 무시하도록 되어 있으므로 이 파일 자체는 항상 존재해도 안전함.
 */
var CACHE_NAME = "swim-notes-shell-v8";
var APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./sync.js",
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

// 예전엔 "캐시 우선"이라, 파일을 새로 배포해도 브라우저가 옛날 버전을 계속 보여주고
// 몰래 뒤에서만 최신 버전을 받아두는 식이었음 — 그래서 업데이트할 때마다 "사이트 데이터
// 지우기"를 안 하면 반영이 안 되는 문제가 계속 반복됐음.
// → "네트워크 우선"으로 바꿔서, 인터넷이 있으면 항상 최신 파일을 먼저 받아오고(=재실행/
//   새로고침 한 번이면 바로 최신 버전 반영), 인터넷이 없을 때만 캐시로 대체함(=노트북에서
//   오프라인일 때도 기존 기록 조회 가능하다는 조건은 그대로 유지됨).
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request).then(function (res) {
      try {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
      } catch (e) { /* no-op */ }
      return res;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        return cached || Response.error();
      });
    })
  );
});
