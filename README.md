# 🤖 AI News Daily Dashboard

매일 아침 8시(KST) 자동으로 국내/글로벌 AI 뉴스 각 10개를 수집하여 대시보드로 제공합니다.

## 아키텍처

```
GitHub Actions (Cron: 매일 KST 08:00)
  → fetch-news.js (Google News RSS 크롤링)
  → Claude API (뉴스 선별 & 요약 & 번역)
  → public/data.json (결과 저장)
  → Git Push → Netlify 자동 배포
```

## 빠른 시작 (Claude Code에서)

### 1. GitHub 레포 생성 & 푸시

```bash
# 레포 생성
gh repo create ai-news-daily --public --source=. --remote=origin --push

# 또는 기존 레포에 연결
git init
git remote add origin https://github.com/<YOUR_USERNAME>/ai-news-daily.git
git add .
git commit -m "Initial commit"
git branch -M main
git push -u origin main
```

### 2. GitHub Secrets 설정

```bash
# Anthropic API Key 등록
gh secret set ANTHROPIC_API_KEY --body "sk-ant-xxxxx"
```

### 3. Netlify 연결

1. [Netlify](https://app.netlify.com) 접속
2. "Add new site" → "Import an existing project"
3. GitHub 레포 선택
4. Build settings:
   - **Base directory**: (비워두기)
   - **Build command**: (비워두기)
   - **Publish directory**: `public`
5. Deploy!

### 4. 수동 테스트

```bash
# GitHub Actions 수동 실행
gh workflow run daily-news.yml

# 또는 로컬 테스트
export ANTHROPIC_API_KEY="sk-ant-xxxxx"
node src/fetch-news.js
```

## 파일 구조

```
├── .github/workflows/
│   └── daily-news.yml      # GitHub Actions 크론잡
├── src/
│   └── fetch-news.js       # 뉴스 수집 & AI 선별 스크립트
├── public/
│   ├── index.html           # 대시보드 UI
│   └── data.json            # 뉴스 데이터 (자동 생성)
├── package.json
└── README.md
```

## 커스터마이즈

- **수집 시간 변경**: `.github/workflows/daily-news.yml`의 cron 표현식 수정
- **뉴스 개수 변경**: `src/fetch-news.js`의 `TARGET_COUNT` 수정
- **선별 기준 변경**: `src/fetch-news.js`의 Claude 프롬프트 수정
