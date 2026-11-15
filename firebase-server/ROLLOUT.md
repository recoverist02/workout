# 운동기록 Firebase 원본 전환 — 아직 미배포

Firebase는 조회/저장 원본, 운동기록01_웹앱은 서버 자동 백업이다. GA·자산관리에는 적용하지 않는다.

## 준비된 코드

- `cloud-core.js`: 입력 검증, 시트와 같은 점수 계산, ID 기반 3방향 병합. 배열을 JSON 문자열로 저장해 Firebase의 sparse-array 객체 변환 방지.
- `cloud-client.js`: 인증된 Firebase REST + ETag 조건부 저장. 네트워크 실패와 저장 완료를 구분. 재시도 중 다른 기록 보존.
- `index.html`, `auth.js`: Google 소유자 로그인, 기존 화면·입력 복구 유지, Firebase 전용 요청, 백업 상태 표시.
- `CloudPrimary.gs`, `SheetAdapter.gs`, `CloudCore.gs`, `appsscript.json`: **운동기록01_웹앱에 바인딩된** 프로젝트에 설치. 서버 1분 주기 백업과 시트 메뉴. 기존 독립형 웹앱 프로젝트에 onOpen을 설치하지 않는다.
- `LegacyCutover.gs`: 기존 운동기록 웹앱 연결에 추가할 차단 함수. bridge/doPost 진입부에 이 함수를 호출하는 가드 추가 필요.
- `database-primary.rules.json`: 전체 규칙이 아닌 추가할 경로 조각. 기존 다른 앱 경로 규칙을 유지한다.
- `firebase-config.json`: enabled=false, 실제 웹 앱 설정 입력 및 서버 검증 전 활성화 금지.

## 남은 적용 순서

1. Firebase Google 로그인 제공자 활성화, 프로젝트 지원 이메일 지정. 웹 앱 등록 후 공개 SDK 설정을 firebase-config.json에 입력. authorized domains에 recoverist02.github.io 추가.
2. 기존 DB 규칙을 다시 읽고 workout_primary_v1에 소유자 Google 로그인만 허용하는 규칙을 추가. 루트/다른 앱 규칙 보존.
3. 운동기록01_웹앱의 연결된 Apps Script 프로젝트를 열어 기존 코드를 보존하면서 서버 파일 추가. 기존 onOpen이 있으면 메뉴 코드를 합친다. 기존 manifest의 종속성과 scope를 보존하면서 필요한 범위만 추가.
4. Firebase 읽기/쓰기 및 이메일 범위 승인 후 checkWorkoutCloudAccess 실행. OAuth 사용자 토큰으로 RTDB 접근이 실제로 허용되는지 먼저 검증. 실패하면 키를 임의 생성하거나 DB를 공개하지 않는다.
5. 기존 웹앱 서버에 LegacyCutover.gs 함수를 추가하고 workoutBridgeRequest/doPost에 workoutPrimaryBlocks_(body) 가드를 연결한 뒤 새 버전 배포. activateWorkoutPrimaryCutover 실행으로 이전 저장 경로를 일시 정지한다. 이 단계 이후 초기화 중에는 기존 앱 저장을 시도하지 않는다.
6. 바인딩 서버 installWorkoutCloudPrimary 실행: 시트 사본 생성, 최신 자료 최초 이전, 검증, 1분 트리거 설치. 카운트/ID/입력값과 점수 일치 확인. 초기화 함수 재실행이 원본을 덮어쓰지 않는지 확인.
7. firebase-config enabled=true 후 변경 브랜치를 배포. 소유자 로그인, 무권한 거부, 조회 및 명시적으로 구분되는 테스트 기록의 추가/수정/삭제 확인. 테스트 기록 삭제는 disposable 테스트로 한정.
8. 앱을 닫아도 시트 백업되는지, 실패 후 재시도·충돌 중단·수동 메뉴·기존 브리핑/캘린더 처리 확인. 정상 데이터에 영향을 주는 Telegram 테스트 알림은 보내지 않는다.
9. 모든 검사 후 완료 보고. 실패 시 원본 상태 확인 없이 기존 시트 저장을 다시 켜지 않는다. Firebase에만 있는 최신 변경을 먼저 시트에 반영/검증한 다음 필요 시 rollbackWorkoutPrimaryCutover를 사용한다.

## 동작과 한계

- 저장 성공은 Firebase 서버 응답으로 확인한다. 0.1초/1초 보장 없음. 시트 처리를 기다리지 않는다.
- 시트 백업은 약 1분 간격으로 실행하나 Apps Script 스케줄/할당량에 따라 더 지연될 수 있다. 앱은 백업 대기와 오류 상태를 표시한다.
- 백업에 실패하면 원본과 작업 기록을 Firebase에 남기고 다음 실행에서 재시도한다. 백업 도중 새 앱 저장이 발생해도 해당 백업 버전만 완료 처리한다.
- 시트의 직접 편집을 감지하면 자동 덮어쓰기를 멈춘다. 메뉴에서 마지막 백업/시트/Firebase를 비교하여 충돌 없는 변경을 반영한다. 같은 기록 양쪽 수정은 중단한다.
- Apps Script Lock은 사람이 시트 셀을 편집하는 것을 잠그지 못한다. 백업 실행 중 직접 시트 편집은 피한다. 미완료 백업 중 제3의 셀 변경이 감지되면 수동 복구가 필요하다.
- 현재 규모에 맞춘 JSON 스냅샷 CAS 방식이다. 저장마다 전체 편집 자료와 백업 기준을 전송하므로 데이터가 크게 늘면 행 단위 트랜잭션/별도 outbox 구조로 확장해야 한다.
- 보조 건강/브리핑/계산 시트는 백업 작업에서 갱신되어 Firebase 조회에 제공된다. 메인 기록을 시트에서 자동 가져오지는 않는다.

## 검증

`node --test test.cjs`: 점수/ID/배열, 동시 저장, 충돌·삭제, 실패, 서버 백업/복구, 수동 병합의 모의 테스트.
배포 전 실제 Firebase 인증·규칙·Apps Script 권한·모바일 로그인·메뉴 및 종단 간 백업 검증이 남아 있다.

저장소에는 연결 식별정보를 포함하지 않는다. SET_WORKOUT_SPREADSHEET_ID, SET_OWNER_EMAIL, YOUR_DATABASE를 비공개 Apps Script 설정에 실제 값으로 적용해야 한다. 공개 웹 설정은 Firebase에 등록된 웹 앱 설정을 확인한 후 별도 적용한다.
