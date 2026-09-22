/*
 * 수영 노트 — Google Drive 동기화
 * 개인 Google Drive의 "swim" 폴더 안 데이터 파일(JSON)을 읽고 써서
 * 이 기기의 기록과 다른 기기(노트북/폰)의 기록을 맞춘다.
 *
 * - 인터넷이 없거나 Google 로그인 스크립트를 못 불러와도 이 파일 전체가
 *   조용히 "동기화 불가" 상태가 될 뿐, app.js의 로컬 기록 기능에는 영향 없음.
 * - 클라이언트 ID·로그인 상태·마지막 동기화 시각은 이 브라우저(기기)에만 저장됨.
 */
(function () {
  "use strict";

  var CLIENT_ID_KEY = "swimNotes.drive.clientId.v1";
  var LAST_SYNC_KEY = "swimNotes.drive.lastSyncAt.v1";
  var WAS_SIGNED_IN_KEY = "swimNotes.drive.wasSignedIn.v1";
  var FOLDER_ID_KEY = "swimNotes.drive.folderId.v1";
  var FILE_ID_KEY = "swimNotes.drive.fileId.v1";
  var FOLDER_NAME = "swim";
  var FILE_NAME = "swim-notes-data.json";
  var SCOPE = "https://www.googleapis.com/auth/drive.file";

  var state = {
    accessToken: null,
    tokenClient: null,
    signedIn: false,
    syncing: false,
    error: null,
    gisReady: false
  };
  var listeners = [];

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* no-op */ }
  }
  function safeRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* no-op */ }
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(getStatus()); } catch (e) { /* listener errors shouldn't break sync */ }
    });
  }
  function onStatusChange(fn) { listeners.push(fn); }

  function getClientId() { return safeGet(CLIENT_ID_KEY) || ""; }
  function setClientId(id) {
    safeSet(CLIENT_ID_KEY, (id || "").trim());
    clearFileCache();
    state.tokenClient = null;
    state.accessToken = null;
    state.signedIn = false;
    state.error = null;
    initTokenClient();
    notify();
  }
  function clearClientId() {
    safeRemove(CLIENT_ID_KEY);
    state.tokenClient = null;
    state.accessToken = null;
    state.signedIn = false;
    notify();
  }

  function clearFileCache() {
    safeRemove(FOLDER_ID_KEY);
    safeRemove(FILE_ID_KEY);
  }

  function getLastSyncAt() { return safeGet(LAST_SYNC_KEY); }
  function setLastSyncAt(iso) { safeSet(LAST_SYNC_KEY, iso); }

  function getStatus() {
    return {
      gisReady: state.gisReady,
      configured: !!getClientId(),
      signedIn: state.signedIn,
      syncing: state.syncing,
      error: state.error,
      lastSyncAt: getLastSyncAt()
    };
  }

  function isOnline() {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  }

  // -----------------------------------------------------------------
  // Google Identity Services 준비
  // -----------------------------------------------------------------
  function waitForGis(cb, triesLeft) {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      state.gisReady = true;
      cb();
      return;
    }
    if (triesLeft <= 0) return;
    setTimeout(function () { waitForGis(cb, triesLeft - 1); }, 400);
  }

  function initTokenClient() {
    var clientId = getClientId();
    if (!clientId || !window.google || !window.google.accounts || !window.google.accounts.oauth2) return;
    try {
      state.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: function (resp) {
          state.silentAttemptInProgress = false;
          if (resp && resp.access_token) {
            state.accessToken = resp.access_token;
            state.signedIn = true;
            state.error = null;
            safeSet(WAS_SIGNED_IN_KEY, "1");
            notify();
            syncNow();
          } else {
            state.error = "로그인에 실패했습니다.";
            notify();
          }
        },
        error_callback: function () {
          state.syncing = false;
          // 자동(조용한) 재로그인 시도가 실패한 것뿐이면 에러 문구를 띄우지 않음 —
          // 이 경우 사용자는 그냥 평소처럼 "Google 계정으로 로그인" 버튼을 눌러야 함
          if (!state.silentAttemptInProgress) {
            state.error = "로그인이 취소되었거나 실패했습니다.";
          }
          state.silentAttemptInProgress = false;
          notify();
        }
      });
    } catch (e) {
      state.error = "Google 로그인 초기화에 실패했습니다. 클라이언트 ID를 확인해주세요.";
      notify();
    }
  }

  function signIn() {
    state.error = null;
    if (!state.tokenClient) initTokenClient();
    if (!state.tokenClient) {
      state.error = "먼저 클라이언트 ID를 설정해주세요.";
      notify();
      return;
    }
    try {
      state.tokenClient.requestAccessToken({ prompt: state.accessToken ? "" : "consent" });
    } catch (e) {
      state.error = "로그인을 시작할 수 없습니다.";
      notify();
    }
  }

  function signOut() {
    if (state.accessToken && window.google && window.google.accounts && window.google.accounts.oauth2) {
      try { window.google.accounts.oauth2.revoke(state.accessToken, function () {}); } catch (e) { /* no-op */ }
    }
    state.accessToken = null;
    state.signedIn = false;
    safeRemove(WAS_SIGNED_IN_KEY);
    notify();
  }

  // 이전에 로그인한 적이 있으면, 앱을 다시 열었을 때 팝업 없이 조용히 재로그인을 시도한다.
  // (브라우저에 Google 로그인 세션이 남아있으면 성공 — 성공 시 자동으로 syncNow()까지 실행됨.
  //  실패해도 에러 문구 없이 조용히 "로그인 필요" 상태로 남을 뿐, 평소처럼 버튼을 누르면 됨)
  function trySilentSignIn() {
    if (!getClientId() || safeGet(WAS_SIGNED_IN_KEY) !== "1") return;
    if (!state.tokenClient) initTokenClient();
    if (!state.tokenClient) return;
    try {
      state.silentAttemptInProgress = true;
      state.tokenClient.requestAccessToken({ prompt: "none" });
    } catch (e) {
      state.silentAttemptInProgress = false;
    }
  }

  // -----------------------------------------------------------------
  // Drive REST 호출
  // -----------------------------------------------------------------
  function driveFetch(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    options.headers["Authorization"] = "Bearer " + state.accessToken;
    return fetch(url, options).then(function (res) {
      if (res.status === 401) {
        state.accessToken = null;
        state.signedIn = false;
        throw new Error("인증이 만료되었습니다. 다시 로그인해주세요.");
      }
      if (!res.ok) {
        throw new Error("Drive 요청이 실패했습니다 (" + res.status + ")");
      }
      return res;
    });
  }

  function findOrCreateFolder() {
    var cached = safeGet(FOLDER_ID_KEY);
    if (cached) return Promise.resolve(cached);

    var q = encodeURIComponent(
      "name = '" + FOLDER_NAME + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents"
    );
    return driveFetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id,name)")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.files && data.files.length > 0) {
          safeSet(FOLDER_ID_KEY, data.files[0].id);
          return data.files[0].id;
        }
        return driveFetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
        }).then(function (res) { return res.json(); }).then(function (folder) {
          safeSet(FOLDER_ID_KEY, folder.id);
          return folder.id;
        });
      });
  }

  function findOrCreateFile(folderId) {
    var cached = safeGet(FILE_ID_KEY);
    if (cached) return Promise.resolve(cached);

    var q = encodeURIComponent("name = '" + FILE_NAME + "' and '" + folderId + "' in parents and trashed = false");
    return driveFetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id,name)")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.files && data.files.length > 0) {
          safeSet(FILE_ID_KEY, data.files[0].id);
          return data.files[0].id;
        }
        var metadata = { name: FILE_NAME, parents: [folderId] };
        var boundary = "swimnotes_boundary";
        var body = "--" + boundary + "\r\n" +
          "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
          JSON.stringify(metadata) + "\r\n" +
          "--" + boundary + "\r\n" +
          "Content-Type: application/json\r\n\r\n" +
          JSON.stringify({ entries: [], tombstones: [] }) + "\r\n" +
          "--" + boundary + "--";
        return driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
          method: "POST",
          headers: { "Content-Type": "multipart/related; boundary=" + boundary },
          body: body
        }).then(function (res) { return res.json(); }).then(function (file) {
          safeSet(FILE_ID_KEY, file.id);
          return file.id;
        });
      });
  }

  function readRemoteData(fileId) {
    return driveFetch("https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media")
      .then(function (res) {
        return res.json().catch(function () { return { entries: [], tombstones: [] }; });
      });
  }

  function writeRemoteData(fileId, data) {
    return driveFetch("https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=media", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  }

  // -----------------------------------------------------------------
  // 병합 — 최근 수정 시각이 이기고, 삭제 흔적(tombstone)이 있으면 삭제가 이김
  // -----------------------------------------------------------------
  function ts(entry) { return entry.updatedAt || entry.createdAt || ""; }

  function mergeData(local, remote) {
    local = local || {};
    remote = remote || {};
    var byId = {};
    (local.entries || []).forEach(function (e) { byId[e.id] = e; });
    (remote.entries || []).forEach(function (e) {
      var cur = byId[e.id];
      if (!cur || ts(e) > ts(cur)) byId[e.id] = e;
    });

    var tombById = {};
    (local.tombstones || []).concat(remote.tombstones || []).forEach(function (t) {
      var cur = tombById[t.id];
      if (!cur || t.deletedAt > cur.deletedAt) tombById[t.id] = t;
    });

    var mergedEntries = Object.keys(byId).map(function (id) { return byId[id]; }).filter(function (e) {
      var tomb = tombById[e.id];
      return !(tomb && tomb.deletedAt >= ts(e));
    });

    // 같은 내용(날짜·카테고리·본문)의 기록이 서로 다른 id로 중복되는 경우를 하나로 합침.
    // (예: 노트북·폰에서 각자 처음 실행될 때 만들어진 예시 기록은 내용은 같아도 id가 달라서
    //  병합 시 두 개로 보일 수 있음 — 그 경우를 여기서 정리함)
    mergedEntries = dedupeByContent(mergedEntries);

    var mergedTombstones = Object.keys(tombById).map(function (id) { return tombById[id]; });

    return { entries: mergedEntries, tombstones: mergedTombstones };
  }

  function contentKey(e) {
    return (e.date || "") + "|" + (e.category || "") + "|" + (e.text || "").trim();
  }

  function dedupeByContent(entries) {
    var seen = {};
    var result = [];
    // 가장 먼저 만들어진(createdAt이 이른) 것을 대표로 남김 — 결과는 순서 무관하게 비교됨
    var sorted = entries.slice().sort(function (a, b) {
      return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
    });
    sorted.forEach(function (e) {
      var key = contentKey(e);
      if (!seen[key]) {
        seen[key] = true;
        result.push(e);
      }
    });
    return result;
  }

  // Google 로그인 접근 토큰은 보통 1시간 정도만 유효함. 만료되면 signedIn이 false로
  // 바뀌는데, 예전엔 여기서 그냥 "로그인해주세요" 에러만 남기고 끝났음 — 그러면 앱을
  // 계속 켜둔 채로 쓰다가 토큰이 만료된 뒤로는 자동 동기화가 계속 조용히 실패만 하고,
  // 사용자가 직접 동기화 화면에 들어가서 재로그인하기 전까진 기기 간 반영이 전혀 안 됨.
  // → 브라우저에 Google 로그인 세션 자체는 보통 훨씬 오래 남아있으므로, 토큰이 없거나
  //   만료된 경우 팝업 없이 조용히 재로그인(prompt:"none")부터 한 번 시도하고,
  //   성공하면 그 콜백이 자동으로 다시 syncNow()를 불러서 이어서 동기화한다.
  function syncNow(_isRetryAfterReauth) {
    if (!window.SwimNotesApp) return Promise.resolve();
    if (!isOnline()) {
      state.error = "오프라인 상태입니다. 인터넷 연결 후 다시 시도해주세요.";
      notify();
      return Promise.resolve();
    }
    if (state.syncing) return Promise.resolve();

    if (!state.signedIn || !state.accessToken) {
      if (!_isRetryAfterReauth && getClientId() && safeGet(WAS_SIGNED_IN_KEY) === "1") {
        // 조용히 한 번 재로그인 시도 — 성공하면 tokenClient 콜백이 syncNow()를 다시 호출함
        trySilentSignIn();
        return Promise.resolve();
      }
      state.error = "먼저 로그인해주세요.";
      notify();
      return Promise.resolve();
    }

    state.syncing = true;
    state.error = null;
    notify();

    var App = window.SwimNotesApp;
    var localData = { entries: App.loadEntries(), tombstones: App.loadTombstones() };

    return findOrCreateFolder()
      .then(function (folderId) { return findOrCreateFile(folderId); })
      .then(function (fileId) {
        return readRemoteData(fileId).then(function (remoteData) {
          var merged = mergeData(localData, remoteData || { entries: [], tombstones: [] });
          App.replaceAllData(merged.entries, merged.tombstones);
          return writeRemoteData(fileId, merged);
        });
      })
      .then(function () {
        state.syncing = false;
        setLastSyncAt(new Date().toISOString());
        notify();
        if (App.render) App.render();
      })
      .catch(function (err) {
        state.syncing = false;
        var msg = (err && err.message) || "동기화 중 오류가 발생했습니다.";
        var expired = msg.indexOf("인증이 만료") !== -1;
        if (expired && !_isRetryAfterReauth && getClientId() && safeGet(WAS_SIGNED_IN_KEY) === "1") {
          // 동기화 도중 토큰이 만료된 경우도 마찬가지로 조용히 재로그인 후 자동 재시도
          notify();
          trySilentSignIn();
          return;
        }
        state.error = msg;
        notify();
      });
  }

  // -----------------------------------------------------------------
  // UI
  // -----------------------------------------------------------------
  function fmtWhen(iso) {
    if (!iso) return "아직 동기화한 적 없음";
    try {
      var d = new Date(iso);
      return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) + " 기준";
    } catch (e) {
      return iso;
    }
  }

  function renderStatusBadge(container) {
    if (!container) return;
    container.innerHTML = "";
    var s = getStatus();
    var label = !s.configured ? "동기화 설정" : (s.syncing ? "동기화 중…" : (s.error ? "동기화 오류" : (s.signedIn ? "동기화됨" : "로그인 필요")));
    var dotClass = "sync-dot";
    if (s.error) dotClass += " sync-dot-error";
    else if (s.signedIn) dotClass += " sync-dot-ok";

    var a = document.createElement("a");
    a.href = "#/sync";
    a.className = "sync-status-link";
    var dot = document.createElement("span");
    dot.className = dotClass;
    var text = document.createElement("span");
    text.textContent = label;
    a.appendChild(dot);
    a.appendChild(text);
    container.appendChild(a);
  }

  function sectionTitle(text) {
    var d = document.createElement("div");
    d.className = "section-title";
    d.textContent = text;
    return d;
  }

  function renderView(main) {
    var s = getStatus();
    var wrap = document.createElement("div");
    wrap.className = "sync-view";

    var header = document.createElement("div");
    header.className = "view-header";
    var h1 = document.createElement("h1");
    h1.textContent = "동기화 (Google Drive)";
    var back = document.createElement("a");
    back.href = "#/home";
    back.className = "btn btn-text";
    back.textContent = "닫기";
    header.appendChild(h1);
    header.appendChild(back);
    wrap.appendChild(header);

    var desc = document.createElement("div");
    desc.className = "view-subtitle";
    desc.style.marginBottom = "22px";
    desc.textContent = "이 기기와 다른 기기(노트북 · 폰)의 기록을 개인 Google Drive의 “swim” 폴더를 통해 맞춥니다.";
    wrap.appendChild(desc);

    if (s.error) {
      var err = document.createElement("div");
      err.className = "sync-error";
      err.textContent = s.error;
      wrap.appendChild(err);
    }

    if (!s.configured) {
      wrap.appendChild(sectionTitle("1. Google 클라이언트 ID 입력"));
      var p1 = document.createElement("div");
      p1.className = "empty";
      p1.style.padding = "0 0 12px";
      p1.textContent = "Google Cloud Console에서 무료로 발급받은 OAuth 클라이언트 ID를 붙여넣으세요. 발급 방법은 함께 드린 안내 파일을 참고해주세요. (기기마다 한 번씩 설정)";
      wrap.appendChild(p1);

      var inputRow = document.createElement("div");
      inputRow.className = "entry-form";
      inputRow.style.marginTop = "0";
      var input = document.createElement("input");
      input.type = "text";
      input.className = "date-input";
      input.style.width = "100%";
      input.placeholder = "xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com";
      inputRow.appendChild(input);

      var saveBtn = document.createElement("button");
      saveBtn.className = "btn btn-primary";
      saveBtn.style.marginTop = "12px";
      saveBtn.textContent = "저장";
      saveBtn.addEventListener("click", function () {
        if (!input.value.trim()) return;
        setClientId(input.value);
        if (window.SwimNotesApp) window.SwimNotesApp.render();
      });
      inputRow.appendChild(saveBtn);
      wrap.appendChild(inputRow);
    } else {
      wrap.appendChild(sectionTitle("계정"));
      var statusLine = document.createElement("div");
      statusLine.className = "status-line";
      statusLine.style.fontSize = "14px";
      statusLine.style.marginBottom = "14px";
      statusLine.textContent = s.signedIn ? "Google 계정에 로그인됨" : "아직 로그인하지 않음";
      wrap.appendChild(statusLine);

      var btnRow = document.createElement("div");
      btnRow.style.display = "flex";
      btnRow.style.gap = "10px";
      btnRow.style.flexWrap = "wrap";

      if (!s.signedIn) {
        var loginBtn = document.createElement("button");
        loginBtn.className = "btn btn-primary";
        loginBtn.textContent = "Google 계정으로 로그인";
        loginBtn.addEventListener("click", function () { signIn(); });
        btnRow.appendChild(loginBtn);
      } else {
        var syncBtn = document.createElement("button");
        syncBtn.className = "btn btn-primary";
        syncBtn.textContent = s.syncing ? "동기화 중…" : "지금 동기화";
        syncBtn.disabled = !!s.syncing;
        syncBtn.addEventListener("click", function () { syncNow(); });
        btnRow.appendChild(syncBtn);

        var logoutBtn = document.createElement("button");
        logoutBtn.className = "btn btn-outline";
        logoutBtn.textContent = "로그아웃";
        logoutBtn.addEventListener("click", function () {
          signOut();
          if (window.SwimNotesApp) window.SwimNotesApp.render();
        });
        btnRow.appendChild(logoutBtn);
      }
      wrap.appendChild(btnRow);

      var lastSync = document.createElement("div");
      lastSync.className = "status-line";
      lastSync.style.marginTop = "14px";
      lastSync.textContent = "마지막 동기화: " + fmtWhen(s.lastSyncAt);
      wrap.appendChild(lastSync);

      wrap.appendChild(sectionTitle("클라이언트 ID"));
      var resetBtn = document.createElement("button");
      resetBtn.className = "btn btn-text";
      resetBtn.style.padding = "0";
      resetBtn.textContent = "클라이언트 ID 다시 설정";
      resetBtn.addEventListener("click", function () {
        if (window.confirm("클라이언트 ID를 다시 설정하시겠어요? 로그아웃됩니다.")) {
          signOut();
          clearClientId();
          if (window.SwimNotesApp) window.SwimNotesApp.render();
        }
      });
      wrap.appendChild(resetBtn);
    }

    main.appendChild(wrap);
  }

  // -----------------------------------------------------------------
  // 시작
  // -----------------------------------------------------------------
  function init() {
    waitForGis(function () {
      initTokenClient();
      notify();
      trySilentSignIn();
    }, 15);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }

  window.SwimSync = {
    getStatus: getStatus,
    onStatusChange: onStatusChange,
    setClientId: setClientId,
    clearClientId: clearClientId,
    signIn: signIn,
    signOut: signOut,
    syncNow: syncNow,
    renderView: renderView,
    renderStatusBadge: renderStatusBadge,
    mergeData: mergeData,
    dedupeByContent: dedupeByContent
  };
})();
