/* Add guard to workoutBridgeRequest and authenticated doPost before mutations:
 if (workoutPrimaryBlocks_(body)) throw Error("Firebase 원본으로 전환했어. 앱을 새로고침해줘.");
 */
function workoutPrimaryBlocks_(body){return body && ["save","saveRecord","deleteRecord","migrate"].indexOf(body.action)!==-1 && PropertiesService.getScriptProperties().getProperty("WORKOUT_PRIMARY_ACTIVE")==="yes";}
function activateWorkoutPrimaryCutover(){PropertiesService.getScriptProperties().setProperty("WORKOUT_PRIMARY_ACTIVE","yes");console.log("이전 시트 저장 경로 정지 완료");}
function rollbackWorkoutPrimaryCutover(){PropertiesService.getScriptProperties().deleteProperty("WORKOUT_PRIMARY_ACTIVE");console.log("이전 시트 저장 경로 재개 완료");}
