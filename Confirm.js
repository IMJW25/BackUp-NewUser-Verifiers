// Confirm.js
const XLSX = require("xlsx");
const path = require("path");

// 파일 경로
const CONFIRM_SCORE_PATH = path.join(__dirname, 'db', "ConfirmScoreDB.xlsx");
const { loadNameDBMap } = require('./name');  // 닉네임→지갑주소 맵 로드 함수

function selectVerifiers() {
  console.log("🔍 [Confirm] selectVerifiers 호출 시작");

  // 1. 점수 데이터 로드
  let wb;
  try {
    wb = XLSX.readFile(CONFIRM_SCORE_PATH);
    console.log("✅ [Confirm] ConfirmScoreDB.xlsx 로드 성공");
  } catch (err) {
    console.error("❌ [Confirm] 엑셀 파일 로드 오류:", err);
    return [];
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const rows = data.slice(1);

  // 2. 닉네임 → 지갑주소 맵 로드
  const nameDBMap = loadNameDBMap();
  
  // 3. 멤버 배열 생성: 닉네임, 점수, 지갑주소 매핑
  const members = rows.map(row => {
    const nickname = row[0]?.toString().trim();
    const score = parseFloat(row[1]);
    const wallet = nameDBMap.get(nickname);

    if (!wallet) {
      console.warn(`[Confirm] 닉네임 ${nickname}에 해당하는 지갑주소가 없습니다.`);
    }

    return {
      id: wallet || "",   // 지갑주소 없는 경우 빈문자열 처리
      nickname,
      score
    };
  }).filter(m => m.id);    // 지갑주소 없는 멤버는 후보에서 제외

  console.log(`📊 [Confirm] 멤버 로드 완료: ${members.length}명`);

  // 4. 점수 내림차순, 닉네임 오름차순 정렬
  members.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });

  // 5. 검증자 수 결정 규칙
  const n = members.length;
  let verifierCount;
  if (n < 4) verifierCount = n;
  else if (n <= 10) verifierCount = 3;
  else if (n <= 99) verifierCount = 5;
  else verifierCount = 10;

  console.log(`🔢 [Confirm] 검증자 수 결정: ${verifierCount}`);

  // 6. 점수 기준 필터링 및 상위 verifierCount 추출
  const candidates = members.filter(m => m.score >= 0.5);
  console.log(`👥 [Confirm] 후보자 수 (score>=0.5): ${candidates.length}`);

  const verifiers = candidates.slice(0, verifierCount);

  if (verifiers.length === 0) {
    console.warn("⚠️ [Confirm] 조건(0.5 이상)에 맞는 검증자가 없습니다.");
  } else {
    console.log("=== [Confirm] 검증자 선정 결과 ===");
    verifiers.forEach((v, idx) => {
      console.log(`  ${idx + 1}. ${v.nickname} (${v.id}) (점수: ${v.score})`);
    });
  }

  console.log("✅ [Confirm] selectVerifiers 반환:", verifiers);
  return verifiers;
}

if (require.main === module) {
  console.log("🛠️ [Confirm] standalone 실행 모드");
  selectVerifiers();
}

module.exports = { selectVerifiers };