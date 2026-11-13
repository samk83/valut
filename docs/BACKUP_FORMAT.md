# 암호화 백업 형식 (Backup format v1)

앱 삭제·재설치·폰 분실 대비. 사용자가 고른 폴더(iCloud Drive, 파일 앱, Android 폴더)에 저장하고, 복구 키로만 열립니다. 서버·계정은 없습니다. 요구사항: SPEC AC-90~99. 코드: `core/src/main/kotlin/.../Backup.kt`, `app/modules/vault-core/ios/Core/Backup.swift` (두 구현은 같은 형식이며 상호 복원 테스트로 확인).

## 복구 키
- 32바이트 난수. 화면에는 Crockford base32 52자를 4자씩 `-`로 묶어 보여 줌.
- 입력은 대소문자·공백·`-` 무시, O→0, I/L→1 로 읽음.
- 기기에는 마스터 키로 봉인해 `recovery.key`, `recovery.key.bak` 두 벌로 저장 (aad `PrivateVault recovery key v1`). 앱이 기기 밖으로 보내지 않음.
- 사용자가 끝 4자를 확인하면(또는 복구 키로 복원하면) `recovery.confirmed` 표시 파일을 둠. 금고 파기·새 금고 생성 때 함께 지움.
- 백업 키 = HKDF-SHA256(복구 키, salt 없음, info `PrivateVault backup v1`).

## 폴더
고른 폴더에 `backup.pvbi`가 있으면 그 폴더를, 없으면 하위 폴더 `Private Vision Vault Backup`을 씁니다(없으면 만듦).

| 파일 | 내용 |
|---|---|
| `backup.pvbi` | `"PVBI"` · 버전 1 · u16 길이 · seal(백업 키, `"PrivateVault backup check v1"`, aad `PrivateVault backup info v1`) — 키 확인용 |
| `<id>.pvb` | `"PVB1"` · 버전 1 · id(16) · u16 길이 + seal(백업 키, 파일 키, aad `PrivateVault backup key v1`+id) · u32 길이 + 금고의 봉인된 메타 · u32 길이 + 봉인된 썸네일(0=없음) · 금고 데이터 파일(ChunkedCipher) 원본 그대로 |

- 사진·동영상 암호문은 다시 암호화하지 않고 그대로 복사합니다. 파일 키만 백업 키로 다시 봉인합니다. 평문·파일명은 폴더에 없습니다.
- 쓰기는 `이름.part` → 이름 바꾸기. 남은 `.part`는 다음 백업 때 정리합니다. 이름을 못 바꾸는 저장소(일부 Android 제공자)는 복사하고, 복사가 실패하면 대상 파일을 지웁니다.
- 이미 있는 사본은 크기(머리글 + 데이터 길이)가 맞을 때만 완료로 봅니다. 크기를 모르면(iCloud 미다운로드) 그대로 둡니다.
- 썸네일이 열리지 않으면 썸네일 없이 백업하고, 복원 때도 열리지 않는 썸네일은 버립니다.
- 기기의 `backup.deletes`에 사용자가 지운 id만 기록하고, 그 id만 백업에서 지웁니다. 손상·알 수 없는 파일은 지우지 않습니다.
- 백업 폴더에서 지우지 못한 항목(예: iCloud에서 아직 안 내려받은 파일 삭제 실패)은 기록에 남겨 다음 백업 때 다시 지웁니다. iCloud 자리표시 파일도 함께 지웁니다.
- `backup.pvbi`가 우리 백업 키로 열리지 않으면 다른 금고의 백업이므로 쓰지 않습니다(`BackupKeyMismatch`).
- iOS: iCloud 자리표시 파일(`.이름.icloud`)은 원래 이름으로 보고, 읽을 때 내려받기를 시작해 기다립니다.

## 복원
1. 새 PIN/패턴으로 금고 생성 → 폴더 + 복구 키 입력.
2. `backup.pvbi` 확인(틀린 키는 거부, 아무것도 바꾸지 않음).
3. 항목마다 staging에 쓰고 메타·썸네일·모든 청크 복호화 검증 → 통과한 것만 원래 id로 금고에 등록. 이미 있는 id는 건너뜀. 손상 파일은 개수만 보고.
4. 중간에 끊겨도 다시 하면 남은 것만 이어서 합니다.

## 테스트
- Kotlin: `./gradlew :core:test --tests '*BackupTest*'`
- Swift(Linux 가능): `cd app/modules/vault-core/ios && swift test --filter BackupTests`
- 상호 복원 고정 자료: `core/src/test/resources/backup-fixtures/{kotlin,swift}`. 다시 만들 때 `PV_WRITE_FIXTURE=1`.
