import { XMLParser } from "fast-xml-parser";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

// ─── Config ───────────────────────────────────────────────────
const TARGET_COUNT = 10;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OUTPUT_PATH = "public/data.json";
const HISTORY_PATH = "public/history.json";
const MAX_REPEAT = 2; // 같은 기사 최대 등장 횟수

if (!ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
  process.exit(1);
}

// ─── Google News RSS 검색어 ────────────────────────────────────
const QUERIES = {
  domestic: [
    "인공지능 AI",
    "생성형AI",
    "AI 스타트업 한국",
    "챗GPT 한국",
    "LLM 한국",
    "AI 규제 한국",
    "AI 반도체",
  ],
  global: [
    "artificial intelligence",
    "generative AI",
    "OpenAI",
    "AI startup funding",
    "large language model",
    "AI regulation",
    "AI chip GPU",
  ],
};

// ─── 히스토리 관리 (중복 기사 제한) ──────────────────────────────
function loadHistory() {
  try {
    if (existsSync(HISTORY_PATH)) {
      return JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
    }
  } catch (e) {
    console.warn("⚠️  히스토리 로드 실패, 새로 시작합니다.");
  }
  return {}; // { "기사제목키": count }
}

function saveHistory(history) {
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
}

function getTitleKey(title) {
  return title.slice(0, 30).toLowerCase().replace(/\s+/g, "");
}

// ─── Google News RSS 가져오기 ──────────────────────────────────
async function fetchGoogleNewsRSS(query, lang = "ko", gl = "KR") {
  const encoded = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encoded}+when:1d&hl=${lang}&gl=${gl}&ceid=${gl}:${lang}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AI-News-Bot/1.0)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    const items = parsed?.rss?.channel?.item;
    if (!items) return [];

    const arr = Array.isArray(items) ? items : [items];
    return arr.map((item) => ({
      title: item.title || "",
      link: item.link || "",
      pubDate: item.pubDate || "",
      source: item.source?.["#text"] || item.source || "",
    }));
  } catch (err) {
    console.warn(`⚠️  RSS 실패 [${query}]: ${err.message}`);
    return [];
  }
}

// ─── 24시간 이내 필터 ──────────────────────────────────────────
function filterRecent(articles, hoursAgo = 26) {
  // 26시간으로 여유를 둠 (타임존 차이 보정)
  const cutoff = Date.now() - hoursAgo * 60 * 60 * 1000;
  return articles.filter((a) => {
    const d = new Date(a.pubDate).getTime();
    return d > cutoff;
  });
}

// ─── 중복 제거 ─────────────────────────────────────────────────
function deduplicate(articles) {
  const seen = new Set();
  return articles.filter((a) => {
    // 제목 기반 유사도 체크 (앞 30자)
    const key = a.title.slice(0, 30).toLowerCase().replace(/\s+/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Claude API로 뉴스 선별 & 요약 ─────────────────────────────
async function curateWithClaude(articles, category) {
  const categoryLabel = category === "domestic" ? "국내" : "글로벌";
  const articleList = articles
    .map(
      (a, i) =>
        `[${i}] 제목: ${a.title}\n    출처: ${a.source}\n    발행: ${a.pubDate}\n    링크: ${a.link}`
    )
    .join("\n\n");

  const prompt = `당신은 AI/테크 산업 전문 뉴스 에디터입니다.

아래는 오늘 수집된 ${categoryLabel} AI 관련 뉴스 목록입니다.

<articles>
${articleList}
</articles>

## 선별 기준
1. **업계 주목도 (가중치 80%)**: AI 업계에서 실제로 중요한 뉴스. 새로운 모델 출시, 대규모 투자/인수, 정책 변화, 기술 돌파구, 주요 기업 전략 변화 등.
2. **청년세대 관심도 (가중치 20%)**: 20~30대가 관심 가질 만한 뉴스. 취업/커리어 영향, 일상 생활 변화, 트렌디한 서비스, 스타트업 생태계 등.

## 작업
정확히 ${TARGET_COUNT}개의 뉴스를 선별하고 아래 JSON 형식으로만 응답하세요.
**중요도가 높은 순서대로 1위~${TARGET_COUNT}위로 정렬하세요.** 배열의 첫 번째가 가장 중요한 뉴스입니다.
중복되거나 유사한 내용은 제외하세요.
광고성 기사, 단순 리스티클, 품질 낮은 기사는 제외하세요.

\`\`\`json
[
  {
    "index": 0,
    "title_ko": "한국어 제목 (원문이 영어면 자연스럽게 번역)",
    "summary": "핵심 내용 2줄 요약 (한국어, 각 줄 40자 내외)",
    "relevance": "high|medium",
    "youth_appeal": true/false
  }
]
\`\`\`

JSON만 출력하세요. 다른 텍스트는 포함하지 마세요.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API 오류: ${res.status} - ${err}`);
  }

  const data = await res.json();
  const text = data.content
    .map((b) => b.text || "")
    .filter(Boolean)
    .join("");

  // JSON 추출
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Claude 응답에서 JSON을 찾을 수 없습니다.");

  return JSON.parse(jsonMatch[0]);
}

// ─── Google News 리다이렉트 URL 해결 ────────────────────────────
// Google News RSS는 리다이렉트 URL을 줌. 원문 링크를 직접 추출.
function extractOriginalUrl(googleUrl) {
  // Google News RSS 링크는 보통 직접 리다이렉트됨
  // 브라우저에서 클릭하면 원문으로 이동하므로 그대로 사용
  return googleUrl;
}

// ─── 메인 ──────────────────────────────────────────────────────
async function main() {
  console.log("🚀 AI 뉴스 수집 시작...\n");

  const history = loadHistory();
  const newHistory = {}; // 이번 회차 히스토리
  const results = { domestic: [], global: [], updatedAt: "" };

  for (const category of ["domestic", "global"]) {
    const label = category === "domestic" ? "🇰🇷 국내" : "🌍 글로벌";
    console.log(`\n${label} 뉴스 수집 중...`);

    // 모든 쿼리로 뉴스 수집
    let allArticles = [];
    for (const query of QUERIES[category]) {
      const articles = await fetchGoogleNewsRSS(
        query,
        category === "domestic" ? "ko" : "en",
        category === "domestic" ? "KR" : "US"
      );
      console.log(`  📡 "${query}" → ${articles.length}개`);
      allArticles.push(...articles);
    }

    // 필터링
    allArticles = filterRecent(allArticles);
    allArticles = deduplicate(allArticles);
    console.log(`  📋 필터 후: ${allArticles.length}개`);

    if (allArticles.length < TARGET_COUNT) {
      console.warn(`  ⚠️  기사 수 부족 (${allArticles.length}개). 가능한 만큼 선별합니다.`);
    }

    // Claude로 선별
    console.log(`  🤖 Claude로 선별 중...`);
    try {
      const curated = await curateWithClaude(allArticles, category);

      // 중복 횟수 초과 기사 필터링
      const filtered = curated.filter((item) => {
        const key = getTitleKey(item.title_ko);
        const prevCount = history[key] || 0;
        return prevCount < MAX_REPEAT;
      });

      results[category] = filtered.map((item) => {
        const key = getTitleKey(item.title_ko);
        newHistory[key] = (history[key] || 0) + 1;
        return {
          title: item.title_ko,
          summary: item.summary,
          link: extractOriginalUrl(allArticles[item.index]?.link || ""),
          source: allArticles[item.index]?.source || "",
          pubDate: allArticles[item.index]?.pubDate || "",
          relevance: item.relevance,
          youthAppeal: item.youth_appeal,
        };
      });

      console.log(`  ✅ ${results[category].length}개 선별 (중복 제거: ${curated.length - filtered.length}개)`);
    } catch (err) {
      console.error(`  ❌ 선별 실패: ${err.message}`);
    }
  }

  // 타임스탬프 (KST)
  results.updatedAt = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
  });

  // 히스토리 저장 (7일 넘은 항목 정리)
  const mergedHistory = { ...history, ...newHistory };
  saveHistory(mergedHistory);
  console.log(`📊 히스토리 항목 수: ${Object.keys(mergedHistory).length}`);

  // 저장
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\n💾 저장 완료: ${OUTPUT_PATH}`);
  console.log(`📅 업데이트: ${results.updatedAt}`);
}

main().catch((err) => {
  console.error("❌ 치명적 오류:", err);
  process.exit(1);
});
