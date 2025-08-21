const XLSX = require('xlsx');
const path = require('path');

// 경로 정의
const CLICK_DB_PATH = path.join(__dirname, 'db', 'dhodksehoDB.xlsx');
const REL_SCORE_DB_PATH = path.join(__dirname, 'db', 'RelScoreDB.xlsx');

/**
 * 참여자 목록 추출 함수
 * @returns {string[]} 참여자명 리스트
 */
function getParticipants() {
    try {
        const wb = XLSX.readFile(CLICK_DB_PATH);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const ids = new Set();
        data.forEach(row => {
            if (row) ids.add(row[0]);
            if (row[1]) ids.add(row[1]);
        });
        return Array.from(ids);
    } catch {
        return [];
    }
}

/**
 * 각 참여자의 관계점수 계산 후 RelScoreDB.xlsx에 저장
 * @returns {Array} [id, 점수] 목록
 */
function calcRelScores() {
    const wb = XLSX.readFile(CLICK_DB_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

    const participants = getParticipants();
    const scores = [];

    participants.forEach(me => {
        let score = 0;
        participants.forEach(other => {
            if (me === other) return;
            const meClickedOther = data.some(row => row[0] === me && row[1] === other);
            const otherClickedMe = data.some(row => row[0] === other && row[1] === me);

            if (meClickedOther && otherClickedMe) score += 1.0;
            else if (meClickedOther || otherClickedMe) score += 0.5;
            else score += 0.0;
        });
        scores.push([me, score]);
    });

    // 계산 후 바로 엑셀에 저장
    const wsScores = XLSX.utils.aoa_to_sheet(scores);
    const wbScores = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbScores, wsScores, 'Sheet1');
    XLSX.writeFile(wbScores, REL_SCORE_DB_PATH);
    console.log(`✅ 관계 점수 저장 완료: ${REL_SCORE_DB_PATH}`);

    return scores;
}

module.exports = { calcRelScores };