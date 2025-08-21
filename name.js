// name.js
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const NAME_DB_PATH = path.join(__dirname, 'db', 'nameDB.xlsx');

function userExists({ nickname, wallet }) {
  if (!fs.existsSync(NAME_DB_PATH)) return false;
  const wb = XLSX.readFile(NAME_DB_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];  // ok
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  for (let i = 1; i < data.length; i++) {
    if (
      data[i][0] === nickname &&
      data[i][1] === wallet
    ) {
      return true;
    }
  }
}

function saveNewUser({ nickname, wallet }) {
  try {
    let wb, ws, data;

    if (fs.existsSync(NAME_DB_PATH)) {
      wb = XLSX.readFile(NAME_DB_PATH);
      ws = wb.Sheets[wb.SheetNames[0]];
      data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    } else {
      wb = XLSX.utils.book_new();
      data = [['nickname', 'wallet']];
      ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    }

    if (data.slice(1).some(row => row[0] === nickname && row[1] === wallet)) {
      console.log(`[name.js] 이미 등록된 사용자: ${nickname} (${wallet})`);
      return false;
    }

    if (data.slice(1).some(row => row[1] === wallet)) {
      console.log(`[name.js] 이미 등록된 지갑: ${wallet} (닉네임 불일치)`);
      return false;
    }

    data.push([nickname, wallet]);

    const newWs = XLSX.utils.aoa_to_sheet(data);
    wb.Sheets[wb.SheetNames[0]] = newWs;
    XLSX.writeFile(wb, NAME_DB_PATH);

    console.log(`✅ [name.js] 신규 사용자 저장: ${nickname} (${wallet})`);
    return true;
  } catch (err) {
    console.error('❌ [name.js] 신규 사용자 저장 오류:', err);
    return false;
  }
}

function loadNameDBMap() {
  if (!fs.existsSync(NAME_DB_PATH)) return new Map();
  const wb = XLSX.readFile(NAME_DB_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);

  const map = new Map();
  for (const row of data) {
    const nickname = row[0]?.toString().trim();
    const wallet = row[1]?.toString().trim();
    if (nickname && wallet) map.set(nickname, wallet);
  }
  return map;
}

module.exports = { userExists, saveNewUser, loadNameDBMap };
