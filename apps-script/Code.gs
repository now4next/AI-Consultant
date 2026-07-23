/**
 * 서울대 EPM AI4PM 니즈 조사 — 응답 자동 수집 Apps Script
 *
 * [설치 방법]
 * 1) 응답을 저장할 Google 스프레드시트를 새로 하나 만듭니다.
 * 2) 상단 메뉴 [확장 프로그램] > [Apps Script] 를 엽니다.
 * 3) 기본 코드(Code.gs)를 모두 지우고 이 파일 내용을 전부 붙여넣은 뒤 저장합니다.
 * 4) [배포] > [새 배포] > 톱니바퀴에서 유형 '웹 앱' 선택
 *      - 설명: 아무 값
 *      - 실행 계정(Execute as): 나(Me)
 *      - 액세스 권한(Who has access): 모든 사용자(Anyone)
 *    로 배포합니다. (최초 배포 시 Google 계정 권한 승인 필요)
 * 5) 생성된 '웹 앱 URL'( https://script.google.com/macros/s/…/exec )을 복사합니다.
 * 6) index.html 상단의 ENDPOINT_URL 값에 그 URL을 붙여넣고 저장/배포합니다.
 *
 * ※ 설문 항목을 추가/변경해도 코드 수정이 필요 없습니다.
 *   새로운 항목은 자동으로 새 열로 추가됩니다.
 */

var SHEET_NAME = '설문응답';

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(30000);
  try {
    var data = JSON.parse(e.postData.contents);

    // 선택: 특정 탭으로 기록 (예: 현장견학 신청). 없으면 기본 시트 사용.
    var sheetName = data['__sheet__'] || SHEET_NAME;
    delete data['__sheet__'];

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

    // 첫 행(헤더) 준비 — 1열은 서버 수신 시각
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['서버 수신 시각']);
    }
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    // 처음 등장하는 항목은 헤더에 새 열로 추가
    var newKeys = Object.keys(data).filter(function (k) {
      return headers.indexOf(k) === -1;
    });
    if (newKeys.length > 0) {
      sheet.getRange(1, headers.length + 1, 1, newKeys.length).setValues([newKeys]);
      headers = headers.concat(newKeys);
    }

    // 헤더 순서대로 한 행 구성 (복수 응답 배열은 쉼표로 연결)
    var row = headers.map(function (h) {
      if (h === '서버 수신 시각') return new Date();
      var v = data[h];
      if (Array.isArray(v)) return v.join(', ');
      return (v === undefined || v === null) ? '' : v;
    });
    sheet.appendRow(row);

    return jsonOutput({ result: 'success' });
  } catch (err) {
    return jsonOutput({ result: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 배포 URL을 브라우저로 직접 열었을 때 동작 확인용
function doGet() {
  return jsonOutput({
    result: 'ok',
    message: 'AI4PM 니즈 조사 수집 엔드포인트가 정상 동작 중입니다.'
  });
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
