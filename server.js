// server.js
const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const path = require('path');
const xlsx = require('xlsx');

const { calcConfirmScores } = require('./ConfirmScore');     // 인증점수 계산 및 저장
const { selectVerifiers } = require('./Confirm');            // 인증점수 기반 검증자 선정
//const { processClick, recordClick } = require('./Click');    // 클릭 기록 처리
const { calcPersonalRelScores } = require('./PRelScore');    // 개인 관계 점수 계산
const { userExists, saveNewUser } = require('./name');
const { calcRelScores  } = require('./RelScore');            // 클릭 DB 저장


const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.json());

// 신규 사용자 등록 API 예시 (기존)
// 필요한 경우 클라이언트에서 호출하여 파일에 저장함
app.post('/api/registerUser', (req, res) => {
  const { nickname, wallet } = req.body;
  console.log('userExists 결과:', userExists({ nickname, wallet }), '입력값:', nickname, wallet)
  if (!nickname || !wallet) {
    return res.status(400).json({ error: '닉네임과 지갑주소가 필요합니다.' });
  }
  // 1. 이미 등록된 경우 → 기존 유저 신호!
  // 🔥😎 항상 userExists로만 체크!
  if (userExists({ nickname, wallet })) {
    return res.json({
      status: 'existing',
      message: '이미 등록된 계정입니다.',
      nickname,
      wallet
    });
  }

  // 신규 저장 시도
  const saved = saveNewUser({ nickname, wallet });
  if (saved) {
    return res.json({
      status: 'success',
      message: '신규 사용자 저장 완료',
      nickname,
      wallet
    });
  } else {
    return res.status(500).json({
      status: 'fail',
      message: '저장 실패'
    });
  }
});



app.use(express.static(path.join(__dirname, 'public')));

const userSockets = new Map();      // 지갑주소 → socket.id
const validatorSockets = new Map(); // 검증자 지갑주소 → socket.id

const NAME_DB_PATH = path.join(__dirname, 'db', 'nameDB.xlsx');
const CHAT_LOGS_PATH = path.join(__dirname, 'db', 'chatLogsDB.xlsx');

const nameDB = new Map();
const pendingVerifications = {};
let validators = [];

// nameDB 로드 함수 (서버 시작 시 호출)
function loadNameDB() {
  try {
    const wb = xlsx.readFile(NAME_DB_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 }).slice(1);

    nameDB.clear();
    for (const row of data) {
      // 기존 잘못된 row.toString() 사용 → 닉네임, 지갑 주소를 각각 분리해서 추출하세요
      const nickname = row[0]?.toString().trim();
      const wallet = row[1]?.toString().trim();
      if (nickname && wallet) nameDB.set(wallet, nickname);
    }

    console.log('✅ nameDB 로드 완료:', nameDB.size);
  } catch (err) {
    console.error('❌ nameDB 로드 오류:', err);
  }
}
loadNameDB();

/* 📌 2. 유틸: 채팅 로그 읽기/쓰기 */
function loadChatLogs() {
  try {
    const wb = xlsx.readFile(CHAT_LOGS_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 }).slice(1);
    return data.map(row => ({
      fromUser: row[0],
      toUser: row[1],
      message: row[2]
    }));
  } catch (err) {
    console.error('❌ 채팅 로그 로드 오류:', err);
    return [];
  }
}

function saveChatLog({ fromUser, message }) {
  try {
    const wb = xlsx.readFile(CHAT_LOGS_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const arr = xlsx.utils.sheet_to_json(ws, { header: 1 });
    arr.push([fromUser, '', message]);
    const newWs = xlsx.utils.aoa_to_sheet(arr);
    wb.Sheets[wb.SheetNames[0]] = newWs;
    xlsx.writeFile(wb, CHAT_LOGS_PATH);
  } catch (err) {
    console.error('❌ 채팅 로그 저장 오류:', err);
  }
}
////////////////// 확인학기 
io.on('connection', (socket) => {
    socket.on('requestPendingVerifications', () => {
      socket.emit('pendingVerificationsList', Object.values(pendingVerifications));
    });
  console.log(`클라이언트 연결됨: ${socket.id}`);

  // registerUser: 클라이언트가 접속 시 호출
  socket.on('registerUser', async ({ wallet, nickname }) => {
    const isExistingUser = nameDB.has(wallet);

    userSockets.set(wallet, { socketId: socket.id, nickname });

    if (isExistingUser) {
      console.log(`기존 사용자 등록: ${wallet} (${nickname})`);
      // 기존 사용자는 pendingVerifications에 없으면 emit
      if (!pendingVerifications[wallet]) {
       socket.emit('verificationCompleted', { approved: true });
      }
    } else {
      console.log(`신규 사용자 등록 시도: ${wallet} (${nickname})`);
      // 신규 사용자는 requestEntry 이벤트에서 처리
    }
  });
/////////////////////

  socket.on('registerValidator', ({ wallet, nickname }) => {
    if (!wallet) {
      console.log('⚠️ registerValidator 호출 시 wallet 없음');
      return;
    }
    validatorSockets.set(wallet, socket.id);
    console.log(`🔔 사용자 등록됨: ${wallet} (${nickname})`);
  });



  // 기존 채팅 로그 전송
  const logs = loadChatLogs();
  socket.emit('chatLogs', logs);



// sendMessage 이벤트 핸들러
socket.on('sendMessage', ({ nickname, message }) => {
  saveChatLog({ nickname, message });
  const toSocketInfo = userSockets.get(nickname);
  if (toSocketInfo) io.to(toSocketInfo.socketId).emit('receiveMessage', { nickname, message });
  socket.emit('receiveMessage', { nickname, message });
});

// ==== 4-3. 링크 업로드 ====
socket.on('newLink', async ({ message, nickname }) => { //반환
  if (!nickname) return console.log(`❌ 닉네임 없음: ${nickname}`);

  const prel = calcPersonalRelScores();
  const userScore = prel[nickname] || 0;

  if (userScore >= 0.5) {
    // 1) 메시지 브로드캐스트
    io.emit('newLink', { message, nickname });
    console.log(`✅ 메시지 브로드캐스트: ${nickname}`);

    // 2) chatLogsDB.xlsx에 기록
    saveChatLog({ nickname, message });
    console.log(`💾 chatLogsDB 저장: ${nickname} -> ${message}`);
  } else {
    console.log(`❌ 점수 부족으로 메시지 차단: ${nickname}`);
  }
});


  // ==== 4-4. 링크 클릭 ====
socket.on('linkClicked', async ({ fromUser, toUser, link }) => {
  console.log(`링크 클릭: ${fromUser} -> ${toUser} | ${link}`);
  const prel = calcPersonalRelScores();
  const rel = calcRelScores();

  const score = prel[fromUser] || 0;
  const toSocketInfo = userSockets.get(toUser);

  if (score >= 0.5) {
    console.log(`✅ 접근 허용: ${toUser} -> ${fromUser}`);
    if (toSocketInfo) io.to(toSocketInfo.socketId).emit('linkAccessGranted', { fromUser, link });

    // dhodksehoDB.xlsx에 기록
    try {
      let wb, ws, arr;

      wb = xlsx.readFile(CLICK_DB_PATH); // 기존 파일 읽기
      ws = wb.Sheets[wb.SheetNames[0]];
      arr = xlsx.utils.sheet_to_json(ws, { header: 1 });
  
      // 이후 기존 행 추가 및 저장 로직
     arr.push([fromUser, toUser]);
      wb.Sheets[wb.SheetNames[0]] = xlsx.utils.aoa_to_sheet(arr);
      xlsx.writeFile(wb, CLICK_DB_PATH);

      console.log(`💾 dhodksehoDB에 기록됨: ${fromUser} -> ${toUser}`);
    } catch (err) {
      console.error('❌ dhodksehoDB 저장 오류:', err);
    }

  } else {
    console.log(`❌ 접근 거부: ${toUser} -> ${fromUser}`);
    if (toSocketInfo) io.to(toSocketInfo.socketId).emit('linkAccessDenied', { fromUser, link, reason: '점수 미달' });
  }
});

  // 신규 사용자 입장 요청 시 검증 절차 시작
socket.on('requestEntry', async ({ wallet, nickname, link }) => {
  const candidate = wallet;
  if (pendingVerifications[candidate]) return;
  const isExistingUser = Array.from(nameDB.entries()).some(([w, n]) => w === wallet && n === nickname);

  if (isExistingUser) {
    // 기존 사용자는 즉시 승인 처리
    const socketInfo = userSockets.get(candidate);
    if (socketInfo) {
      io.to(socketInfo.socketId).emit('verificationCompleted', { candidate, approved: true });
      console.log(`기존 사용자 ${candidate} - 즉시 승인 완료 이벤트 전송`);
    }
    return;
  }

  await calcConfirmScores();
  validators = selectVerifiers();

  // 링크를 pendingVerifications에 기록
  pendingVerifications[candidate] = {
    validators: validators.map(v => v.id),
    votes: {},
    nickname,
    link // 링크 추가!
  };

  // 검증자에게 승인 요청 보낼 때 link 포함
  for (const vAddr of pendingVerifications[candidate].validators) {
    const vSocketId = validatorSockets.get(vAddr);
    if (vSocketId) {
      io.to(vSocketId).emit('verificationRequested', {
        candidate,
        nickname,
        link, // 링크 추가!
        validators: pendingVerifications[candidate].validators
      });
    }
  }
  // 후보자에게 대기 메시지 등은 그대로
});




  //vote : 소켓 이벤트 이름(event name), socket.on('vote', handler) 형태로 이벤트 리스너를 등록하는 코드
  socket.on('vote', ({ candidate, verifier, approve }) => {
    const data = pendingVerifications[candidate];
    if (!data || data.votes[verifier] !== undefined) return;

    data.votes[verifier] = !!approve;

    if (Object.keys(data.votes).length === data.validators.length) {
      // 투표 완료 시 승인 여부 결정
      finalizeVerification(candidate);
    }
  });

  socket.on('linkClicked', async ({ fromUser, toUser, link }) => {
    // 기존 링크 클릭 처리 로직...
  });

  socket.on('disconnect', () => {
    for (const [wallet, info] of userSockets.entries()) {
      if (info.socketId === socket.id) userSockets.delete(wallet);
    }
    for (const [v, id] of validatorSockets.entries()) {
      if (id === socket.id) validatorSockets.delete(v);
    }
    console.log(`클라이언트 해제: ${socket.id}`);
  });
});

function finalizeVerification(candidate) {
  const data = pendingVerifications[candidate];
  if (!data) return;

  const approvals = Object.values(data.votes).filter(v => v).length;
  const total = data.validators.length;
  const approved = approvals * 3 >= total * 2; // 2/3 이상 승인 조건

  console.log(`🔍 [finalizeVerification] 후보자: ${candidate}, 찬성: ${approvals}/${total}, 승인여부: ${approved}`);

  if (approved) {
    // 신규 사용자 DB에 저장
    const saved = saveNewUser({ nickname: data.nickname, wallet: candidate });
    console.log(`💾 신규 사용자 저장 결과: ${saved ? '성공' : '실패'}`);
  }

  // 후보자에게 승인 결과 알림
  const socketInfo = userSockets.get(candidate);
  if (socketInfo) {
    io.to(socketInfo.socketId).emit('verificationCompleted', { candidate, approved });
  }

  // 검증자들에게 결과 알림
  data.validators.forEach(v => {
    const vId = validatorSockets.get(v);
    if (vId) {
      io.to(vId).emit('verificationResult', { candidate, approved });
    }
  });

  // 대기 목록에서 제거
  delete pendingVerifications[candidate];
}


const PORT = 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
