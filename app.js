/*
 * 수영 노트 — 로컬 프로토타입
 * 데이터는 이 브라우저의 localStorage에만 저장됩니다(서버·인터넷 불필요).
 * 나중에 Google Drive 동기화로 교체할 때는 storage.* 함수들만 바꾸면 되도록
 * 화면 렌더링 로직과 저장 로직을 분리해 두었습니다.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "swimNotes.entries.v1";
  var SEEDED_KEY = "swimNotes.seeded.v1";
  var TOMBSTONES_KEY = "swimNotes.tombstones.v1";

  // ---------------------------------------------------------------------
  // 카테고리 정의 (색상 · 핵심 포인트 · 자동 추천용 키워드)
  // ---------------------------------------------------------------------
  var CATEGORIES = [
    {
      id: "common", name: "공통", color: "#2E5266", tint: "#EEF2F5", border: "#D9E1E6",
      points: ["유선형 자세", "호흡 리듬", "힘 빼기"],
      keywords: ["유선형", "호흡", "힘 빼", "글라이드", "기본 자세"]
    },
    {
      id: "free", name: "자유형", color: "#1D74B8", tint: "#E8F1FA", border: "#CFE3F5",
      points: ["팔 돌리기", "사이드킥", "호흡", "발차기"],
      keywords: ["자유형", "롤링", "사이드킥", "팔 돌리기", "고개"]
    },
    {
      id: "back", name: "배영", color: "#12968A", tint: "#E6F5F3", border: "#CBEAE5",
      points: ["팔꺾기", "오리발킥", "힘 빼기"],
      keywords: ["배영", "오리발", "등으로", "위로 뜨"]
    },
    {
      id: "breast", name: "평영", color: "#3E8F5B", tint: "#EAF5EE", border: "#D3EADB",
      points: ["팔 모으기", "발차기", "유선형"],
      keywords: ["평영", "개구리", "다리 접", "프로그킥"]
    },
    {
      id: "fly", name: "접영", color: "#7C5CBF", tint: "#F1EDFA", border: "#E1D6F2",
      points: ["웨이브", "팔 돌리기", "입수·출수킥", "호흡"],
      keywords: ["접영", "웨이브", "입수", "출수", "스노클", "돌핀"]
    },
    {
      id: "cond", name: "스트레칭·근력운동", color: "#B8722E", tint: "#FBF0E6", border: "#F0DCC2",
      points: ["어깨 스트레칭", "코어 강화", "유연성"],
      keywords: ["스트레칭", "근력", "플랭크", "코어", "유연성", "운동"]
    }
  ];

  var DEFAULT_CATEGORY_ID = CATEGORIES[0].id;

  // ---------------------------------------------------------------------
  // 기록 유형 — 통계 화면에서 "고칠점 / 개선된 점"을 따로 모아 보기 위한 태그.
  // 따로 선택하게 하지 않고, 기록 본문에 자연스럽게 쓴 표현을 보고 자동으로 감지한다
  // (예: "...가 아직 안 됨" → 고칠점, "...이 편해졌다" → 개선된 점). 한 기록 안에 잘된
  // 점·안된 점을 같이 적으면 둘 다에 반영될 수 있다. 키워드 기반의 단순한 방식이라
  // 완벽하지는 않지만, 카테고리 자동 추천(suggestCategory)과 같은 방식으로 앞으로
  // 키워드를 더 다듬어갈 수 있다.
  // ---------------------------------------------------------------------
  var NOTE_TYPES = [
    { id: "log", name: "일반 기록", color: "#8C877D", tint: "#F3F0EA", border: "#E4DFD5" },
    { id: "fix", name: "고칠점", color: "#B3432E", tint: "#FBEFEC", border: "#E7C9C0" },
    { id: "improved", name: "개선된 점", color: "#4C9A6A", tint: "#EAF6EE", border: "#CFE8D6" }
  ];
  var DEFAULT_NOTE_TYPE = NOTE_TYPES[0].id;

  var FIX_KEYWORDS = [
    "안 됨", "안됨", "안 되고", "안 되는", "안 되어", "안되고", "안되는", "안 됨", "못 함", "못함", "못했",
    "안 나감", "안나감", "안 맞", "안맞", "잘 안 됨", "잘안됨", "무너짐", "가라앉", "뒤로 넘어감",
    "늦게 나감", "헷갈렸", "헷갈림", "어려웠", "어렵", "힘들었", "힘듦", "힘들다", "실수", "틀렸",
    "안 잡힘", "안잡힘", "부담스럽", "불편했", "막힘", "안 뜸", "숨참", "버벅", "꼬였", "꼬임",
    "자꾸 안", "여전히 안", "아직 안", "아직도 안"
  ];
  var IMPROVED_KEYWORDS = [
    "편해졌", "편해짐", "좋아졌", "좋아짐", "나아졌", "나아짐", "잡혔다", "잡힘", "익숙해졌", "익숙해짐",
    "수월해졌", "수월해짐", "자연스러워졌", "자연스러워짐", "빨라졌", "빨라짐", "늘었다", "성공",
    "가능해졌", "가능해짐", "잘 됐", "잘됐", "해냈", "해냄", "자신감", "편안해졌", "안정됐", "안정적"
  ];

  // 본문 텍스트에서 "고칠점"/"개선된 점" 신호를 감지 — 저장된 값이 아니라 매번 텍스트를
  // 보고 계산하므로, 예전에 이미 적어둔 기록에도 그대로(소급) 적용된다.
  function detectSignals(text) {
    var t = text || "";
    return {
      fix: FIX_KEYWORDS.some(function (k) { return t.indexOf(k) >= 0; }),
      improved: IMPROVED_KEYWORDS.some(function (k) { return t.indexOf(k) >= 0; })
    };
  }

  // ---------------------------------------------------------------------
  // 전문가 팁 — 유튜브·기사 등에서 참고한 코칭 내용 (내가 쓴 연습 기록과 구분해서 표시)
  // ---------------------------------------------------------------------
  var EXPERT_TIPS = {
    free: [
      {
        title: "자유형 호흡 — 호흡 3단계",
        source: "워터클랜즈 (YouTube)",
        summary: "핵심은 들이마시기 전에 먼저 뱉어내기. 숨이 차는 진짜 이유는 산소 부족이 아니라 몸속에 쌓인 이산화탄소라서, 억지로 참지 말고 물속에서 미리 코로 뱉어야 함.",
        steps: [
          { label: "내쉬기", text: "얼굴이 물속에 들어가자마자 코로 부드럽게 숨 뿜기" },
          { label: "털어내기", text: "고개가 나올 때 남아있는 숨을 팟! 하고 털어내기" },
          { label: "마시기", text: "입이 수면 위로 나오는 순간 자연스럽게 숨 마시기" }
        ]
      },
      {
        title: "자유형 롤링 — 지상 어깨 돌리기 드릴",
        source: "워터클랜즈 (YouTube)",
        summary: "무작정 물에 들어가지 말고, 물 밖 지상 훈련으로 롤링 원리를 몸에 먼저 각인시키기. 양손이 한 번씩 움직이는 걸 1회로 20회 x 3세트.",
        steps: [
          { label: "준비", text: "엎드린 상태에서 양손을 앞으로 쭉 뻗기" },
          { label: "롤링", text: "한 손씩 번갈아 가며 어깨를 양쪽으로 90도 가까이 돌려 스트로크하기" },
          { label: "핵심 제어", text: "몸통은 90도 이상 넘어가지 않고, 팔은 몸의 중심선을 넘지 않기" }
        ]
      },
      {
        title: "자유형 팔꺾기(리커버리) — 어깨 안 아픈 팔 꺾기",
        source: "YouTube",
        summary: "손이나 손목 힘으로 억지로 들어올리면 무게 중심이 멀어져 어깨에 무리가 감. 팔을 들어올리는 주체를 손이 아닌 '팔꿈치'로 바꾸면 힘을 하나도 안 들여도 자연스럽게 넘어감.",
        steps: [
          { label: "힘 빼기", text: "팔꿈치부터 손끝까지 들어간 힘을 완전히 스으 빼기" },
          { label: "천장 리드", text: "손이 아닌 팔꿈치를 천장 방향으로 스으 끌어올리기" },
          { label: "몸통 밀착", text: "무게 중심을 몸통에 붙여 어깨 부담 없이 가볍게 넘기기" }
        ]
      }
    ],
    fly: [
      {
        title: "접영 발차기 — 킥판 허벅지 끼우기",
        source: "게시물 (Threads)",
        summary: "초보자는 발차기할 때 자신도 모르게 양다리가 벌어지는데, 이러면 물만 튀기고 저항 때문에 앞으로 안 나감. 다리를 절대 벌리지 않고 입수·출수 정점에 맞춰 두 번의 타이밍만 정확히 차기.",
        steps: [
          { label: "허벅지 고정", text: "킥판을 허벅지 사이에 끼우고 다리가 떨어지지 않게 꽉 조이기" },
          { label: "입수 킥", text: "손이 물속으로 들어가는 순간에 맞춰 입수 킥 차기" },
          { label: "출수 킥", text: "물 잡기가 끝나고 유선형 자세로 대각선 나올 때 출수 킥 차기" }
        ]
      },
      {
        title: "접영 킥 (다른 감각) — 턱 당기기 3단계",
        source: "워터클랜즈 (YouTube)",
        summary: "발을 세게 차려고만 하면 몸이 접히지 않고 타이밍이 꼬임. 고수는 발이 아니라 턱을 활용 — 입수할 때 턱을 쇄골 쪽으로 당기면 몸이 순간 ㅅ자가 되면서 엉덩이가 뜨고, 그 반작용으로 다리가 자연스럽게 물을 누름.",
        steps: [
          { label: "턱 당기기", text: "입수할 때 턱을 쇄골 쪽으로 강하게 당겨 복근 수축하기" },
          { label: "엉덩이 상승", text: "몸이 ㅅ자로 꺾이면서 엉덩이를 위로 솟구치게 만들기" },
          { label: "연쇄 반응 킥", text: "엉덩이가 올라간 반작용으로 다리가 묵직하게 물을 누르기" }
        ]
      },
      {
        title: "접영 입수킥 — 황금 타이밍",
        source: "YouTube",
        summary: "미리 차면 반발력이 생기기도 전에 타이밍이 꼬임. 팔이 앞으로 뻗고 손과 머리가 물속에 깊게 들어가 몸이 완전히 잠기는 그 눌림의 정점을 기다렸다가 깊게 눌러 차야 함.",
        steps: [
          { label: "진입하기", text: "팔을 앞으로 쭉 뻗고 손과 머리가 물속으로 깊게 들어가기를 기다리기" },
          { label: "누르기", text: "완전히 잠기는 정점 순간에 맞춰 킥을 깊게 눌러 차기" },
          { label: "미끄러지기", text: "엉덩이가 위로 밀려 올라오면서 유선형 자세로 스으윽 미끄러지기" }
        ]
      },
      {
        title: "접영 웨이브",
        source: "YouTube",
        summary: "가슴을 억지로 누르는 게 아니라, 상체를 수면 아래로 부드럽게 내려보내면 그 반동으로 엉덩이가 저절로 떠오르는 흐름이 생김.",
        steps: [
          { label: "내려보내기", text: "팔과 머리가 진입할 때 상체를 수면 아래로 부드럽게 내려보내기" },
          { label: "반동 활용", text: "상체가 가라앉는 반동으로 엉덩이가 저절로 떠오르게 맡기기" },
          { label: "유선형 유지", text: "물 저항을 최소화하며 멈춤 없이 스으윽 앞으로 미끄러지기" }
        ]
      },
      {
        title: "접영 리커버리(팔 넘기기) — 견갑골 리커버리 드릴",
        source: "YouTube",
        summary: "팔을 끌어당긴 직후 마음이 급해 어깨·팔 힘으로 억지로 돌리면 어깨 관절에 무리가 가고 타이밍이 꼬임. 힘으로 넘기지 않고, 힘을 풀고 견갑골을 중심으로 던지듯 부드럽게 넘겨야 어깨 통증 없이 리커버리가 이어짐.",
        steps: [
          { label: "긴장 풀기", text: "팔을 끌어당긴 직후 어깨와 팔의 힘 스으 빼기" },
          { label: "귀 뒤로 던지기", text: "팔꿈치가 너무 높지 않게, 팔을 귀 뒤로 던지듯 앞으로 보내기" },
          { label: "부드러운 전환", text: "팔과 어깨에 힘을 뺀 채 앞으로 던지는 느낌으로 부드럽게 넘기기" }
        ]
      },
      {
        title: "접영 출수킥 — 출수킥 필살기",
        source: "워터클랜즈 (YouTube)",
        summary: "캐치를 시작할 때 마음이 급해 킥부터 같이 차거나 너무 일찍 차면 타이밍이 꼬임. 캐치가 완전히 끝나고 팔로 물을 강하게 밀어내는 정점을 기다렸다가 출수킥을 차야 상체가 저절로 떠오르며 추진력이 붙음.",
        steps: [
          { label: "가슴 펼치기", text: "가슴을 밀듯이 펴면서 손을 바깥쪽으로 벌려주기" },
          { label: "캐치 전환", text: "팔꿈치를 세우며 캐치 동작을 확실하게 마무리하기" },
          { label: "강하게 밀어내기", text: "팔로 물을 강하게 밀어내는 타이밍에 맞춰 출수킥 팍! 차기" }
        ]
      }
    ],
    cond: [
      {
        title: "수영 후 꼭 풀어줘야 할 근육 3곳",
        source: "헬스조선",
        summary: "수영 후 느끼는 뻐근함·근육 피로는 대부분 시간이 지나면 회복됨. 다만 특정 부위가 찌르듯 아프거나 움직일 때 통증이 심해진다면, 스트레칭을 반복하기보다 운동 전문가 상담을 받는 게 좋음.",
        steps: [
          { label: "① 가슴·어깨 열기", text: "벽 옆에 서서 한쪽 팔을 옆으로 들어 벽에 대고, 팔은 그대로 둔 채 몸통을 천천히 반대 방향으로 돌려 가슴·어깨 앞쪽을 부드럽게 늘이기 — 좌우 15~20초씩 3세트" },
          { label: "② 캣카우(Cat-Cow)", text: "바닥에 양손·무릎을 댄 네발 자세에서, 숨을 내쉬며 등을 둥글게 말아 올리고(캣) 숨을 들이쉬며 허리·가슴을 부드럽게 펴기(카우) — 8~10회, 척추 움직임을 하나하나 느끼며 부드럽게" },
          { label: "③ 다운독 변형", text: "양손을 바닥·벽·벤치에 짚고 엉덩이를 뒤로 빼며 등과 팔을 길게 편 상태에서 뒤꿈치를 천천히 바닥 쪽으로 — 20~30초씩 3세트, 뒤꿈치가 바닥에 안 닿아도 무방" }
        ],
        note: "특히 어깨를 움직일 때 통증이 계속되거나 목에서 팔까지 저린 증상이 있으면 운동을 쉬고 원인을 확인할 것"
      }
    ]
  };

  // ---------------------------------------------------------------------
  // 초기 샘플 데이터 — 처음 실행 시 빈 화면 방지용 (실제 연습 기록 일부 포함)
  // ---------------------------------------------------------------------
  var SEED_ENTRIES = [
    { date: "2026-06-14", category: "common", text: "입수 전 심호흡 크게 한 번, 몸에 힘부터 빼고 시작" },
    { date: "2026-07-02", category: "common", text: "귀에 물 들어가는 느낌 무서워하지 않기 — 편하게 옆으로 눕는 느낌" },
    { date: "2026-07-30", category: "common", text: "벽 밀고 나가는 글라이드 연습 — 손끝부터 발끝까지 곧게" },
    { date: "2026-08-20", category: "common", text: "호흡 리듬 잡기 — 코로 천천히 뱉고 입으로 짧게 마시기" },
    { date: "2026-09-03", category: "common", text: "물에 뜨는 느낌 익히기 — 몸에 힘 빼고 유선형 자세로 5초 버티기" },

    { date: "2025-11-29", category: "free", text: "오른팔 돌릴 때 너무 뒤쪽으로 가지 않게 — 몸이 뒤집어짐. 허벅지를 스치듯이" },
    { date: "2026-01-10", category: "free", text: "키판 잡고 사이드킥 연습 — 골반이 안 돌아감. 그래서 발차기가 사이드킥이 아니라 위아래 발차기가 되어 가라앉음" },
    { date: "2026-03-21", category: "free", text: "팔꺾기 — 사이드킥 자세에서 어깨 힘을 빼 어깨가 올라가지 않게, 팔을 가슴 앞쪽으로, 엄지가 몸쪽을 향하게 어깨까지 올린 후 롤링하며 팔을 물속으로" },
    { date: "2026-04-05", category: "free", text: "고개 돌릴 때 왼팔에 귀를 붙일 것! 고개를 드는 게 아니라 옆으로 돌리기" },
    { date: "2026-04-11", category: "free", text: "오른손 돌릴 때 고개 들지 않기!!" },
    { date: "2026-06-25", category: "free", text: "사이드킥 — 몸 앞에서 차고 물을 뒤로 밀어준다는 느낌으로 발차기" },
    { date: "2026-07-10", category: "free", text: "오른팔 돌릴 때 팔이 뒤쪽으로 넘어감 — 허벅지 스치듯이 앞쪽으로 뻗기" },

    { date: "2025-11-29", category: "back", text: "몸에 힘을 빼야 함 — 자유형처럼 팔 돌릴 때 롤링해야 함" },
    { date: "2026-01-10", category: "back", text: "유아풀에서 힘 빼는 연습 계속 하기" },
    { date: "2026-02-14", category: "back", text: "오리발 배영 — 발등을 펴고 오리발이 물을 가르는 느낌으로 발목을 위아래로 움직임" },
    { date: "2026-02-28", category: "back", text: "오리발 배영 — 액셀을 밟듯이 발등을 펴고 오리발 끝으로 물을 누르는 느낌, 무릎은 펴고" },
    { date: "2026-04-11", category: "back", text: "발목 힘을 뺀 후 발등으로 물을 차는데, 흐느적거리는 느낌이 들 정도로 힘을 빼야 함 — 다운킥은 물을 누르듯이" },
    { date: "2026-07-25", category: "back", text: "팔돌리기 빠르게 — 너무 늦게 하니까 안 나감" },

    { date: "2026-01-10", category: "breast", text: "팔은 숨쉬러 나오는 용도 — 가슴 앞쪽으로 모았다가 빨리 뻗는 게 좋음. 팔을 뻗으면서 들어가야 함. 목에 힘 빼고" },
    { date: "2026-04-11", category: "breast", text: "머리는 맨 마지막에 넣기 — 명치 → 가슴 → 목 → 머리 순서. 다리는 루트 자세" },
    { date: "2026-04-29", category: "breast", text: "팔 모을 때 겨드랑이로 물을 누르면서 고개가 나올 것 — 겨드랑이 사이 풍선을 터트리듯 힘주기" },
    { date: "2026-07-03", category: "breast", text: "물속으로 들어갈 때 고개를 숙이고 등을 약간 굽혀 유선형 자세를 만들어야 함(등이 수평으로 수면에 떠 있게)" },
    { date: "2026-07-25", category: "breast", text: "발차기 빠르게 — 너무 늦게 차니까 안 나감" },

    { date: "2026-08-08", category: "fly", text: "웨이브 발차기 때 다리를 접지 말라는 얘기(유튜브) — 나는 아직 다리를 접어서 물을 눌러야 함" },
    { date: "2026-08-29", category: "fly", text: "한팔 접영: 손끝이 수면 근처에 왔을 때 팔 돌리기 — 몸이 앞으로 나가는 느낌으로" },
    { date: "2026-09-05", category: "fly", text: "키판 잡고 입수 후에 바로 키판을 들고 가슴 웨이브를 해서 몸이 뜨게" },
    { date: "2026-09-12", category: "fly", text: "한팔 접영 시 팔을 옆으로 돌리기(양팔 접영 하듯이). 출수킥은 수면이 보일 때 — 오늘도 너무 깊은 데서 참" },
    { date: "2026-09-16", category: "fly", text: "키판 잡고 들어갈 때 키판 세워서 올라와야 함 — 키판 끝부분 누르기. 스노클 없이 양팔 접영만으로 25m 완주" },

    { date: "2026-06-28", category: "cond", text: "밴드로 어깨 외회전 운동 — 접영 팔 돌리기 부담 줄이기" },
    { date: "2026-07-19", category: "cond", text: "고관절 유연성 — 개구리 스트레칭으로 평영 다리 각도 개선" },
    { date: "2026-08-11", category: "cond", text: "코어 강화 — 플랭크 40초 x 3세트, 웨이브 동작에 도움 되는 느낌" },
    { date: "2026-09-02", category: "cond", text: "연습 전 어깨 회전 스트레칭 — 접영 후 어깨 통증 예방에 도움" }
  ];

  // ---------------------------------------------------------------------
  // 저장소 (localStorage 래퍼) — 나중에 Drive 동기화로 바꿀 때 이 부분만 교체
  // ---------------------------------------------------------------------
  function loadEntries() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn("[swim-notes] localStorage 읽기 실패", e);
    }
    return [];
  }

  function saveEntries(entries) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      return true;
    } catch (e) {
      console.warn("[swim-notes] localStorage 저장 실패", e);
      window.alert("저장에 실패했습니다. 브라우저 저장 공간을 확인해주세요.");
      return false;
    }
  }

  function genId() {
    return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function ensureSeed() {
    try {
      if (window.localStorage.getItem(SEEDED_KEY)) return;
      var existing = loadEntries();
      if (existing.length === 0) {
        var seeded = SEED_ENTRIES.map(function (s) {
          return {
            id: genId(),
            date: s.date,
            category: s.category,
            text: s.text,
            createdAt: new Date(s.date + "T12:00:00").toISOString()
          };
        });
        saveEntries(seeded);
      }
      window.localStorage.setItem(SEEDED_KEY, "1");
    } catch (e) {
      console.warn("[swim-notes] 시드 데이터 준비 실패", e);
    }
  }

  function addEntry(date, categoryId, text, noteType) {
    var entries = loadEntries();
    var now = new Date().toISOString();
    var entry = {
      id: genId(),
      date: date,
      category: categoryId,
      text: text,
      noteType: noteType || DEFAULT_NOTE_TYPE,
      createdAt: now,
      updatedAt: now
    };
    entries.push(entry);
    saveEntries(entries);
    return entry;
  }

  function updateEntry(id, patch) {
    var entries = loadEntries();
    var idx = -1;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return null;
    entries[idx] = Object.assign({}, entries[idx], patch, { updatedAt: new Date().toISOString() });
    saveEntries(entries);
    return entries[idx];
  }

  function deleteEntry(id) {
    var entries = loadEntries().filter(function (e) { return e.id !== id; });
    saveEntries(entries);
    addTombstone(id);
  }

  // ---------------------------------------------------------------------
  // 삭제 흔적(tombstone) — 동기화 시 다른 기기에서 삭제한 기록이 되살아나지 않도록
  // ---------------------------------------------------------------------
  function loadTombstones() {
    try {
      var raw = window.localStorage.getItem(TOMBSTONES_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn("[swim-notes] tombstone 읽기 실패", e);
    }
    return [];
  }

  function saveTombstones(tombstones) {
    try {
      window.localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones));
      return true;
    } catch (e) {
      console.warn("[swim-notes] tombstone 저장 실패", e);
      return false;
    }
  }

  function addTombstone(id) {
    var tombstones = loadTombstones();
    tombstones = tombstones.filter(function (t) { return t.id !== id; });
    tombstones.push({ id: id, deletedAt: new Date().toISOString() });
    saveTombstones(tombstones);
  }

  // 동기화(sync.js)가 병합된 결과를 로컬에 통째로 반영할 때 사용
  function replaceAllData(entries, tombstones) {
    saveEntries(entries || []);
    saveTombstones(tombstones || []);
  }

  // 기록을 추가·수정·삭제한 직후 호출 — 동기화가 설정되어 있으면 자동으로 동기화를 걸어준다.
  // (signedIn만 보고 판단하면, 로그인 토큰이 시간이 지나 만료된 뒤로는 계속 조용히
  //  아무 것도 안 하게 되어 "다른 기기에 반영이 안 된다"는 버그로 이어짐. 대신
  //  configured 여부만 보고 syncNow()를 호출하면, syncNow() 내부에서 토큰이
  //  만료된 경우 조용히 재로그인을 시도한 뒤 이어서 동기화하므로 스스로 복구된다.)
  function syncSoon() {
    try {
      if (window.SwimSync && window.SwimSync.getStatus().configured) {
        window.SwimSync.syncNow();
      }
    } catch (e) { /* no-op */ }
  }

  function getEntry(id) {
    var entries = loadEntries();
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) return entries[i];
    }
    return null;
  }

  function sortByDateDesc(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.createdAt || "") < (b.createdAt || "") ? 1 : -1;
    });
  }

  function entriesByCategory(categoryId) {
    return sortByDateDesc(loadEntries().filter(function (e) { return e.category === categoryId; }));
  }

  function categoryCounts() {
    var entries = loadEntries();
    var counts = {};
    CATEGORIES.forEach(function (c) { counts[c.id] = 0; });
    entries.forEach(function (e) {
      if (counts.hasOwnProperty(e.category)) counts[e.category]++;
    });
    return counts;
  }

  function catById(id) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === id) return CATEGORIES[i];
    }
    return CATEGORIES[0];
  }

  function noteTypeById(id) {
    for (var i = 0; i < NOTE_TYPES.length; i++) {
      if (NOTE_TYPES[i].id === id) return NOTE_TYPES[i];
    }
    return NOTE_TYPES[0];
  }

  // ---------------------------------------------------------------------
  // 통계 집계 — 월별 연습 횟수(영법별), 고칠점·개선된 점의 영법별 분포
  // ---------------------------------------------------------------------
  function monthKey(dateStr) { return (dateStr || "").slice(0, 7); } // "YYYY-MM"

  function monthLabel(key) {
    var parts = (key || "").split("-");
    if (parts.length !== 2) return key || "";
    return parts[0] + "." + parts[1];
  }

  // 최근 monthsBack개월(이번 달 포함)을 기준으로 월별 x 영법별 기록 수를 집계
  function monthlyCategoryStats(entries, monthsBack) {
    var n = monthsBack || 6;
    var now = new Date();
    var months = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    }
    var byMonth = {};
    months.forEach(function (m) {
      var row = { total: 0 };
      CATEGORIES.forEach(function (c) { row[c.id] = 0; });
      byMonth[m] = row;
    });
    (entries || []).forEach(function (e) {
      var mk = monthKey(e.date);
      var row = byMonth[mk];
      if (row && row.hasOwnProperty(e.category)) {
        row[e.category]++;
        row.total++;
      }
    });
    var max = 0;
    months.forEach(function (m) { if (byMonth[m].total > max) max = byMonth[m].total; });
    return { months: months, byMonth: byMonth, max: max };
  }

  // 특정 신호(고칠점/개선된 점)를 본문에서 감지해 영법별 개수 + 최근순 목록으로 집계.
  // 저장된 값이 아니라 매번 텍스트를 스캔하므로, 한 기록이 고칠점·개선된 점 둘 다에
  // 동시에 잡힐 수도 있다(둘 다 적었다면 둘 다에 반영되는 게 맞음).
  function noteTypeCategoryStats(entries, noteTypeId) {
    var counts = {};
    CATEGORIES.forEach(function (c) { counts[c.id] = 0; });
    var list = [];
    (entries || []).forEach(function (e) {
      var sig = detectSignals(e.text);
      if (sig[noteTypeId]) {
        if (counts.hasOwnProperty(e.category)) counts[e.category]++;
        list.push(e);
      }
    });
    return { counts: counts, list: sortByDateDesc(list) };
  }

  // ---------------------------------------------------------------------
  // 자동 카테고리 추천 (키워드 매칭 — 필요하면 나중에 더 똑똑한 규칙으로 교체)
  // ---------------------------------------------------------------------
  function suggestCategory(text) {
    text = text || "";
    var bestId = null;
    var bestScore = 0;
    CATEGORIES.forEach(function (cat) {
      var score = cat.keywords.reduce(function (n, kw) {
        return n + (text.indexOf(kw) >= 0 ? 1 : 0);
      }, 0);
      if (score > bestScore) {
        bestScore = score;
        bestId = cat.id;
      }
    });
    return bestId || DEFAULT_CATEGORY_ID;
  }

  // ---------------------------------------------------------------------
  // 작은 DOM 헬퍼 (innerHTML 대신 써서 기록 본문에 특수문자가 있어도 안전)
  // ---------------------------------------------------------------------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      var val = attrs[key];
      if (val === null || val === undefined || val === false) return;
      if (key === "class") node.className = val;
      else if (key.indexOf("on") === 0 && typeof val === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else {
        node.setAttribute(key, val);
      }
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    });
    return node;
  }

  function fmtDate(isoDate) {
    var parts = (isoDate || "").split("-");
    if (parts.length !== 3) return isoDate || "";
    return parts[0] + "." + parts[1] + "." + parts[2];
  }

  function monthsBetween(a, b) {
    var months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    return Math.max(0, months);
  }

  function practiceSpanLabel(entries) {
    if (entries.length === 0) return "기록 없음";
    var dates = entries.map(function (e) { return e.date; }).sort();
    var first = new Date(dates[0] + "T00:00:00");
    var now = new Date();
    var months = monthsBetween(first, now);
    if (months < 1) return "1개월 미만";
    if (months < 12) return months + "개월";
    var years = Math.floor(months / 12);
    var rem = months % 12;
    return years + "년" + (rem > 0 ? " " + rem + "개월" : "");
  }

  // ---------------------------------------------------------------------
  // 라우팅
  // ---------------------------------------------------------------------
  function parseHash() {
    var h = window.location.hash.replace(/^#\/?/, "");
    var qIndex = h.indexOf("?");
    var path = qIndex >= 0 ? h.slice(0, qIndex) : h;
    var parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return { view: "home" };
    if (parts[0] === "category" && parts[1]) return { view: "category", id: parts[1] };
    if (parts[0] === "entry" && parts[1]) return { view: "detail", id: parts[1] };
    if (parts[0] === "new") return { view: "new" };
    if (parts[0] === "edit" && parts[1]) return { view: "edit", id: parts[1] };
    if (parts[0] === "sync") return { view: "sync" };
    if (parts[0] === "stats") return { view: "stats" };
    return { view: "home" };
  }

  function navigate(hash) {
    window.location.hash = hash;
  }

  // ---------------------------------------------------------------------
  // 렌더링
  // ---------------------------------------------------------------------
  function render() {
    var route = parseHash();
    renderSidebar(route);
    renderMobileNav(route);
    var main = document.getElementById("main");
    main.innerHTML = "";
    if (route.view === "category") renderCategoryView(main, route.id);
    else if (route.view === "detail") renderDetailView(main, route.id);
    else if (route.view === "new") renderFormView(main, null);
    else if (route.view === "edit") renderFormView(main, route.id);
    else if (route.view === "sync" && window.SwimSync) window.SwimSync.renderView(main);
    else if (route.view === "stats") renderStatsView(main);
    else renderHomeView(main);
  }

  function renderSidebar(route) {
    var nav = document.getElementById("sidebar-nav");
    nav.innerHTML = "";
    var counts = categoryCounts();

    var homeActive = route.view === "home";
    nav.appendChild(el("a", {
      href: "#/home",
      class: "nav-item" + (homeActive ? " active" : "")
    }, [
      el("span", { class: "nav-dot nav-dot-home" }),
      el("span", { class: "nav-label" }, ["홈"])
    ]));

    CATEGORIES.forEach(function (cat) {
      var active = route.view === "category" && route.id === cat.id;
      var item = el("a", {
        href: "#/category/" + cat.id,
        class: "nav-item" + (active ? " active" : "")
      }, [
        el("span", { class: "nav-dot", style: "background:" + cat.color }),
        el("span", { class: "nav-label" }, [cat.name]),
        el("span", { class: "nav-count" }, [String(counts[cat.id] || 0)])
      ]);
      nav.appendChild(item);
    });

    var statsActive = route.view === "stats";
    nav.appendChild(el("a", {
      href: "#/stats",
      class: "nav-item" + (statsActive ? " active" : "")
    }, [
      el("span", { class: "nav-dot nav-dot-stats" }),
      el("span", { class: "nav-label" }, ["통계"])
    ]));

    if (window.SwimSync) {
      window.SwimSync.renderStatusBadge(document.getElementById("sync-status"));
    }
  }

  // 폰 화면 전용 하단 내비게이션 — 사이드바와 같은 데이터(홈 · 카테고리)를 공유하되
  // 좁은 화면에 맞게 별도 요소(#mobile-bottomnav)에 렌더링 (CSS 미디어쿼리로 표시 전환)
  function renderMobileNav(route) {
    var nav = document.getElementById("mobile-bottomnav");
    if (!nav) return;
    nav.innerHTML = "";
    var counts = categoryCounts();

    var homeActive = route.view === "home";
    nav.appendChild(el("a", {
      href: "#/home",
      class: "mobile-nav-item" + (homeActive ? " active" : "")
    }, [
      el("span", { class: "mobile-nav-dot mobile-nav-dot-home" }),
      el("span", { class: "mobile-nav-label" }, ["홈"])
    ]));

    CATEGORIES.forEach(function (cat) {
      var active = route.view === "category" && route.id === cat.id;
      nav.appendChild(el("a", {
        href: "#/category/" + cat.id,
        class: "mobile-nav-item" + (active ? " active" : "")
      }, [
        el("span", { class: "mobile-nav-dot", style: "background:" + cat.color }),
        el("span", { class: "mobile-nav-label" }, [cat.name]),
        el("span", { class: "mobile-nav-count" }, [String(counts[cat.id] || 0)])
      ]));
    });

    var statsActiveMobile = route.view === "stats";
    nav.appendChild(el("a", {
      href: "#/stats",
      class: "mobile-nav-item" + (statsActiveMobile ? " active" : "")
    }, [
      el("span", { class: "mobile-nav-dot mobile-nav-dot-stats" }),
      el("span", { class: "mobile-nav-label" }, ["통계"])
    ]));

    if (window.SwimSync) {
      window.SwimSync.renderStatusBadge(document.getElementById("mobile-sync-status"));
    }
  }

  function summaryCard(entries) {
    var recent = sortByDateDesc(entries)[0];
    var card = el("div", { class: "summary-card" }, [
      el("div", { class: "summary-title" }, ["오늘의 요약"]),
      el("div", { class: "summary-stats" }, [
        el("div", { class: "stat" }, [
          el("div", { class: "stat-value" }, [String(entries.length)]),
          el("div", { class: "stat-label" }, ["전체 기록"])
        ]),
        el("div", { class: "stat" }, [
          el("div", { class: "stat-value" }, [practiceSpanLabel(entries)]),
          el("div", { class: "stat-label" }, ["연습 기간"])
        ])
      ])
    ]);
    if (recent) {
      var cat = catById(recent.category);
      card.appendChild(el("div", { class: "summary-recent" }, [
        el("div", { class: "summary-recent-meta" }, ["최근 기록 · " + cat.name + " · " + fmtDate(recent.date)]),
        el("div", { class: "summary-recent-text" }, ["“" + recent.text + "”"])
      ]));
    }
    return card;
  }

  function renderHomeView(main) {
    var entries = loadEntries();
    main.appendChild(el("div", { class: "view-header" }, [
      el("h1", {}, ["홈"]),
      el("a", { href: "#/new", class: "btn btn-primary" }, ["+ 새 기록"])
    ]));

    main.appendChild(summaryCard(entries));

    main.appendChild(el("div", { class: "section-title" }, ["카테고리"]));
    var counts = categoryCounts();
    var grid = el("div", { class: "category-grid" });
    CATEGORIES.forEach(function (cat) {
      grid.appendChild(el("a", {
        href: "#/category/" + cat.id,
        class: "category-card",
        style: "background:" + cat.tint + ";border-color:" + cat.border
      }, [
        el("span", { class: "category-dot", style: "background:" + cat.color }),
        el("span", { class: "category-name" }, [cat.name]),
        el("span", { class: "category-count" }, [(counts[cat.id] || 0) + "건"])
      ]));
    });
    main.appendChild(grid);

    main.appendChild(el("div", { class: "section-title" }, ["최근 기록"]));
    var recentList = sortByDateDesc(entries).slice(0, 8);
    if (recentList.length === 0) {
      main.appendChild(el("div", { class: "empty" }, ["아직 기록이 없습니다. 첫 기록을 남겨보세요."]));
    } else {
      var list = el("div", { class: "entry-list" });
      recentList.forEach(function (entry) {
        list.appendChild(entryCard(entry));
      });
      main.appendChild(list);
    }
  }

  // 본문에서 감지된 신호에 따라 배지를 0~2개 만들어 반환(둘 다 적었으면 둘 다 표시)
  function noteTypeBadges(entry) {
    var sig = detectSignals(entry.text);
    var badges = [];
    if (sig.fix) {
      var fixType = noteTypeById("fix");
      badges.push(el("span", { class: "entry-tag note-type-tag", style: "background:" + fixType.tint + ";color:" + fixType.color }, [fixType.name]));
    }
    if (sig.improved) {
      var impType = noteTypeById("improved");
      badges.push(el("span", { class: "entry-tag note-type-tag", style: "background:" + impType.tint + ";color:" + impType.color }, [impType.name]));
    }
    return badges;
  }

  function entryCard(entry) {
    var cat = catById(entry.category);
    var meta = [
      el("span", { class: "entry-tag", style: "background:" + cat.tint + ";color:" + cat.color }, [cat.name]),
      el("span", { class: "entry-date" }, [fmtDate(entry.date)])
    ];
    var badges = noteTypeBadges(entry);
    if (badges.length) { var args = [1, 0].concat(badges); Array.prototype.splice.apply(meta, args); }
    return el("a", {
      href: "#/entry/" + entry.id,
      class: "entry-card",
      style: "border-left-color:" + cat.color
    }, [
      el("div", { class: "entry-card-meta" }, meta),
      el("div", { class: "entry-text" }, [entry.text])
    ]);
  }

  // 전문가 팁 카드 — 개인 연습 기록과 헷갈리지 않도록 배지 · 출처 · 다른 색 톤으로 구분
  function expertTipCard(tip) {
    var card = el("div", { class: "tip-card" }, [
      el("div", { class: "tip-card-head" }, [
        el("span", { class: "tip-badge" }, ["전문가 팁"]),
        el("span", { class: "tip-source" }, ["출처 · " + tip.source])
      ]),
      el("div", { class: "tip-title" }, [tip.title]),
      el("div", { class: "tip-summary" }, [tip.summary])
    ]);

    var stepList = el("ol", { class: "tip-steps" });
    tip.steps.forEach(function (step) {
      stepList.appendChild(el("li", {}, [
        el("span", { class: "tip-step-label" }, [step.label]),
        el("span", { class: "tip-step-text" }, [" " + step.text])
      ]));
    });
    card.appendChild(stepList);

    if (tip.note) {
      card.appendChild(el("div", { class: "tip-note" }, ["⚠ " + tip.note]));
    }
    return card;
  }

  function renderCategoryView(main, catId) {
    var cat = catById(catId);
    var entries = entriesByCategory(cat.id);

    main.appendChild(el("div", { class: "view-header" }, [
      el("h1", { style: "color:" + cat.color }, [cat.name]),
      el("a", { href: "#/new?cat=" + cat.id, class: "btn btn-primary", style: "background:" + cat.color }, ["+ 새 기록"])
    ]));
    main.appendChild(el("div", { class: "view-subtitle" }, [entries.length + "건의 기록"]));

    main.appendChild(el("div", { class: "section-title" }, ["핵심 포인트"]));
    var points = el("div", { class: "point-row" });
    cat.points.forEach(function (pt) {
      points.appendChild(el("span", { class: "point-chip", style: "background:" + cat.tint + ";color:" + cat.color + ";border-color:" + cat.border }, [pt]));
    });
    main.appendChild(points);

    var tips = EXPERT_TIPS[cat.id];
    if (tips && tips.length > 0) {
      main.appendChild(el("div", { class: "section-title" }, ["전문가 팁"]));
      var tipList = el("div", { class: "tip-list" });
      tips.forEach(function (tip) { tipList.appendChild(expertTipCard(tip)); });
      main.appendChild(tipList);
    }

    main.appendChild(el("div", { class: "section-title" }, ["연습 기록"]));
    if (entries.length === 0) {
      main.appendChild(el("div", { class: "empty" }, ["아직 이 카테고리에 기록이 없습니다."]));
    } else {
      var list = el("div", { class: "entry-list" });
      entries.forEach(function (entry) { list.appendChild(entryCard(entry)); });
      main.appendChild(list);
    }
  }

  function renderDetailView(main, entryId) {
    var entry = getEntry(entryId);
    if (!entry) {
      main.appendChild(el("div", { class: "empty" }, ["기록을 찾을 수 없습니다.", el("br"), el("a", { href: "#/home" }, ["홈으로 돌아가기"])]));
      return;
    }
    var cat = catById(entry.category);

    main.appendChild(el("div", { class: "view-header" }, [
      el("a", { href: "#/category/" + cat.id, class: "back-link" }, ["← " + cat.name + " 목록으로"])
    ]));

    var detailMeta = [
      el("span", { class: "entry-tag", style: "background:" + cat.tint + ";color:" + cat.color }, [cat.name]),
      el("span", { class: "entry-date" }, [fmtDate(entry.date)])
    ];
    var detailBadges = noteTypeBadges(entry);
    if (detailBadges.length) { var dargs = [1, 0].concat(detailBadges); Array.prototype.splice.apply(detailMeta, dargs); }
    main.appendChild(el("div", { class: "detail-meta" }, detailMeta));

    var body = el("div", { class: "detail-card", style: "border-left-color:" + cat.color });
    entry.text.split("\n").forEach(function (line) {
      if (line.trim() === "") return;
      body.appendChild(el("p", {}, [line]));
    });
    main.appendChild(body);

    main.appendChild(el("div", { class: "detail-actions" }, [
      el("a", { href: "#/edit/" + entry.id, class: "btn btn-outline" }, ["수정"]),
      el("button", {
        class: "btn btn-danger-outline",
        onclick: function () {
          if (window.confirm("이 기록을 삭제할까요? 되돌릴 수 없습니다.")) {
            deleteEntry(entry.id);
            syncSoon();
            navigate("#/category/" + cat.id);
          }
        }
      }, ["삭제"])
    ]));
  }

  // ---------------------------------------------------------------------
  // 통계 화면 — 월별 연습 횟수(영법별) 스택 막대 그래프 + 고칠점·개선된 점 집계
  // ---------------------------------------------------------------------
  function svgEl(tag, attrs, children) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    });
    return node;
  }

  // 최근 N개월치를 영법별로 쌓아 올린 막대 그래프 (외부 차트 라이브러리 없이 인라인 SVG로 직접 그림 —
  // 오프라인에서도 항상 동작해야 하기 때문)
  function monthlyStackedChart(stats) {
    var W = 640, H = 200, padTop = 16, padBottom = 26, padSide = 6;
    var innerH = H - padTop - padBottom;
    var months = stats.months;
    var n = months.length;
    var gap = 14;
    var barW = (W - padSide * 2 - gap * (n - 1)) / n;
    var maxTotal = Math.max(stats.max, 1);

    var svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + H,
      class: "stats-chart",
      role: "img",
      "aria-label": "월별 연습 횟수를 영법별로 쌓아 표시한 막대 그래프"
    });

    svg.appendChild(svgEl("line", {
      x1: padSide, y1: H - padBottom, x2: W - padSide, y2: H - padBottom,
      class: "chart-baseline"
    }));

    months.forEach(function (m, i) {
      var x = padSide + i * (barW + gap);
      var row = stats.byMonth[m];
      var yCursor = H - padBottom;
      CATEGORIES.forEach(function (cat) {
        var count = row[cat.id] || 0;
        if (count <= 0) return;
        var segH = (count / maxTotal) * innerH;
        var y = yCursor - segH;
        svg.appendChild(svgEl("rect", {
          x: String(x), y: String(y), width: String(barW), height: String(Math.max(segH, 1)),
          fill: cat.color, rx: "2"
        }));
        yCursor = y;
      });
      if (row.total > 0) {
        svg.appendChild(svgEl("text", {
          x: String(x + barW / 2), y: String(yCursor - 6), "text-anchor": "middle",
          class: "chart-total-label"
        }, [String(row.total)]));
      }
      svg.appendChild(svgEl("text", {
        x: String(x + barW / 2), y: String(H - padBottom + 17), "text-anchor": "middle",
        class: "chart-month-label"
      }, [monthLabel(m)]));
    });

    return svg;
  }

  function categoryLegend() {
    var row = el("div", { class: "chart-legend" });
    CATEGORIES.forEach(function (cat) {
      row.appendChild(el("span", { class: "chart-legend-item" }, [
        el("span", { class: "chart-legend-dot", style: "background:" + cat.color }),
        el("span", {}, [cat.name])
      ]));
    });
    return row;
  }

  function noteTypeBreakdown(entries, noteTypeId) {
    var stats = noteTypeCategoryStats(entries, noteTypeId);
    var nt = noteTypeById(noteTypeId);
    var wrap = el("div", {});
    wrap.appendChild(el("div", { class: "section-title" }, [nt.name + " · 영법별"]));

    if (stats.list.length === 0) {
      var hint = noteTypeId === "fix"
        ? "예: “아직 팔 돌릴 때 뒤로 넘어감”, “사이드킥이 잘 안 됨”처럼 안 된 점을 적으면 자동으로 여기 반영돼요."
        : "예: “발차기가 편해졌다”, “이제 잘됨”처럼 잘된 점을 적으면 자동으로 여기 반영돼요.";
      wrap.appendChild(el("div", { class: "empty" }, [
        "아직 “" + nt.name + "”으로 감지된 기록이 없습니다. 따로 선택할 필요 없이, 새 기록 본문에 " + hint
      ]));
      return wrap;
    }

    var maxCount = 1;
    CATEGORIES.forEach(function (cat) {
      if ((stats.counts[cat.id] || 0) > maxCount) maxCount = stats.counts[cat.id];
    });

    var barList = el("div", { class: "stat-bar-list" });
    CATEGORIES.forEach(function (cat) {
      var count = stats.counts[cat.id] || 0;
      var pct = count > 0 ? Math.max(4, Math.round((count / maxCount) * 100)) : 0;
      barList.appendChild(el("div", { class: "stat-bar-row" }, [
        el("div", { class: "stat-bar-label" }, [
          el("span", { class: "chart-legend-dot", style: "background:" + cat.color }),
          el("span", {}, [cat.name])
        ]),
        el("div", { class: "stat-bar-track" }, [
          el("div", { class: "stat-bar-fill", style: "width:" + pct + "%;background:" + cat.color })
        ]),
        el("div", { class: "stat-bar-count" }, [String(count)])
      ]));
    });
    wrap.appendChild(barList);

    wrap.appendChild(el("div", { class: "section-title" }, ["최근 " + nt.name]));
    var list = el("div", { class: "entry-list" });
    stats.list.slice(0, 5).forEach(function (entry) { list.appendChild(entryCard(entry)); });
    wrap.appendChild(list);

    return wrap;
  }

  function renderStatsView(main) {
    var entries = loadEntries();

    main.appendChild(el("div", { class: "view-header" }, [
      el("h1", {}, ["통계"])
    ]));
    main.appendChild(el("div", { class: "view-subtitle" }, ["기록을 남길수록 자동으로 쌓여요"]));

    main.appendChild(el("div", { class: "section-title" }, ["월별 연습 횟수 (영법별)"]));
    if (entries.length === 0) {
      main.appendChild(el("div", { class: "empty" }, ["아직 기록이 없습니다."]));
    } else {
      var monthly = monthlyCategoryStats(entries, 6);
      main.appendChild(el("div", { class: "stats-chart-wrap" }, [monthlyStackedChart(monthly)]));
      main.appendChild(categoryLegend());
    }

    main.appendChild(noteTypeBreakdown(entries, "fix"));
    main.appendChild(noteTypeBreakdown(entries, "improved"));
  }

  function todayStr() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function renderFormView(main, editId) {
    var editing = null;
    if (editId) {
      editing = getEntry(editId);
      if (!editing) {
        main.appendChild(el("div", { class: "empty" }, ["수정할 기록을 찾을 수 없습니다."]));
        return;
      }
    }

    var params = {};
    window.location.hash.replace(/^#\/?[^?]*\??/, "").split("&").forEach(function (kv) {
      var pair = kv.split("=");
      if (pair[0]) params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
    });

    var manualId = editing ? editing.category : (params.cat || null);
    var isManual = !!manualId;

    main.appendChild(el("div", { class: "view-header" }, [
      el("h1", {}, [editing ? "기록 수정" : "새 기록"]),
      el("a", { href: editing ? "#/entry/" + editing.id : "#/home", class: "btn btn-text" }, ["취소"])
    ]));

    var dateInput = el("input", {
      type: "date",
      class: "date-input",
      value: editing ? editing.date : todayStr()
    });

    var textarea = el("textarea", {
      class: "text-input",
      placeholder: "예: 한팔 접영 팔 돌리기가 조금 편해졌다. 근데 사이드킥은 아직 잘 안 됨..."
    }, [editing ? editing.text : ""]);
    textarea.value = editing ? editing.text : "";

    var chipRow = el("div", { class: "chip-row" });
    var statusLine = el("div", { class: "status-line" });

    function currentActiveId() {
      if (isManual && manualId) return manualId;
      return suggestCategory(textarea.value);
    }

    function renderChips() {
      chipRow.innerHTML = "";
      var activeId = currentActiveId();
      CATEGORIES.forEach(function (cat) {
        var active = cat.id === activeId;
        var chip = el("button", {
          type: "button",
          class: "chip" + (active ? " chip-active" : ""),
          style: active ? ("background:" + cat.color + ";border-color:" + cat.color) : "",
          onclick: function () {
            manualId = cat.id;
            isManual = true;
            renderChips();
          }
        }, [cat.name]);
        chipRow.appendChild(chip);
      });
      var activeCat = catById(activeId);
      if (isManual) {
        statusLine.innerHTML = "";
        statusLine.appendChild(document.createTextNode("“" + activeCat.name + "”으로 직접 선택함 · "));
        statusLine.appendChild(el("button", {
          type: "button",
          class: "link-btn",
          onclick: function () { isManual = false; manualId = null; renderChips(); }
        }, ["자동 추천으로 되돌리기"]));
      } else {
        statusLine.textContent = "“" + activeCat.name + "”으로 자동 분류됨";
      }
    }

    textarea.addEventListener("input", renderChips);
    renderChips();

    var form = el("div", { class: "entry-form" }, [
      el("label", { class: "field-label" }, ["날짜"]),
      dateInput,
      el("label", { class: "field-label" }, ["오늘 배운 내용 (잘된 점 · 안된 점을 함께 적으면 통계에 자동으로 반영돼요)"]),
      textarea,
      el("label", { class: "field-label" }, ["카테고리 (자동 추천 · 직접 선택 가능)"]),
      chipRow,
      statusLine,
      el("div", { class: "form-actions" }, [
        el("button", {
          class: "btn btn-primary btn-large",
          onclick: function () {
            var text = textarea.value.trim();
            if (!text) {
              window.alert("내용을 입력해주세요.");
              textarea.focus();
              return;
            }
            var catId = currentActiveId();
            var date = dateInput.value || todayStr();
            if (editing) {
              updateEntry(editing.id, { date: date, category: catId, text: text });
              syncSoon();
              navigate("#/entry/" + editing.id);
            } else {
              var entry = addEntry(date, catId, text);
              syncSoon();
              navigate("#/entry/" + entry.id);
            }
          }
        }, [editing ? "저장" : "적용"])
      ])
    ]);
    main.appendChild(form);

    textarea.focus();
  }

  // ---------------------------------------------------------------------
  // 시작
  // ---------------------------------------------------------------------
  window.addEventListener("hashchange", render);
  document.addEventListener("DOMContentLoaded", function () {
    ensureSeed();
    render();
  });

  // 테스트 · 향후 확장을 위해 외부에 노출
  window.SwimNotesApp = {
    CATEGORIES: CATEGORIES,
    NOTE_TYPES: NOTE_TYPES,
    DEFAULT_NOTE_TYPE: DEFAULT_NOTE_TYPE,
    EXPERT_TIPS: EXPERT_TIPS,
    STORAGE_KEY: STORAGE_KEY,
    SEEDED_KEY: SEEDED_KEY,
    TOMBSTONES_KEY: TOMBSTONES_KEY,
    loadEntries: loadEntries,
    saveEntries: saveEntries,
    addEntry: addEntry,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,
    getEntry: getEntry,
    entriesByCategory: entriesByCategory,
    categoryCounts: categoryCounts,
    suggestCategory: suggestCategory,
    ensureSeed: ensureSeed,
    render: render,
    parseHash: parseHash,
    catById: catById,
    noteTypeById: noteTypeById,
    detectSignals: detectSignals,
    monthKey: monthKey,
    monthLabel: monthLabel,
    monthlyCategoryStats: monthlyCategoryStats,
    noteTypeCategoryStats: noteTypeCategoryStats,
    renderMobileNav: renderMobileNav,
    renderStatsView: renderStatsView,
    loadTombstones: loadTombstones,
    saveTombstones: saveTombstones,
    addTombstone: addTombstone,
    replaceAllData: replaceAllData
  };
})();
