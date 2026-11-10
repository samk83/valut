# 새 핸드폰으로 옮기기 — 전송 형식 (1.1)

SPEC AC-70~79의 기술 문서입니다. 구현: `core/src/main/kotlin/.../Transfer.kt` (Android),
`app/modules/vault-core/ios/Core/Transfer.swift` (iPhone). 두 구현은 바이트 단위로 같아야 하며
`core/src/test/.../TransferInteropTest.kt`가 실제 소켓으로 서로 보내고 받아 확인합니다.

## 쉬운 설명
1. 새 폰이 QR 코드를 보여 줍니다. 안에는 새 폰의 Wi-Fi 주소와 이번 한 번만 쓰는 비밀 열쇠가 있습니다.
2. 기존 폰이 QR을 찍어 그 주소로 직접 연결합니다. 인터넷·서버를 거치지 않습니다.
3. 두 폰은 비밀 열쇠로 대화 전용 암호를 만듭니다. QR을 못 본 기기는 한 글자도 읽거나 끼워 넣을 수 없습니다.
4. 사진 하나씩: 기존 폰이 메모리에서만 풀어 암호 상태로 보내고 → 새 폰이 자기 열쇠로 다시 잠그고 확인한 뒤 → 다음 사진.
5. 기존 폰은 아무것도 지우지 않습니다.

## QR 코드
```
PVT1:<IPv4>:<port>:<base64url(secret, 32 bytes, padding 없음)>
```
보내는 쪽은 주소가 10/8, 172.16/12, 192.168/16, 169.254/16(테스트용 127/8)이 아니면 거부하고,
자기 Wi-Fi(또는 핫스팟)와 같은 서브넷이 아니면 `E_OTHER_NETWORK`로 거부합니다(모바일 데이터로 나가지 않음).
받는 쪽은 Wi-Fi/핫스팟 주소에만 열고, 비밀값을 증명(HELLO)한 첫 연결 1개만 쓰며 10분 뒤 닫습니다.
엉뚱한 연결(같은 Wi-Fi의 다른 기기)은 끊고 계속 기다립니다. 읽기 제한시간 180초.

## 연결 (handshake)
양쪽이 평문으로 한 번씩 보냅니다: `"PVT1"` · version `0x01` · 32바이트 난수.
```
prk  = HMAC-SHA256(key = nonce_client ‖ nonce_server, data = secret)
k_c2s = HMAC-SHA256(prk, "PrivateVault transfer c2s" ‖ 0x01)
k_s2c = HMAC-SHA256(prk, "PrivateVault transfer s2c" ‖ 0x01)
```
(HKDF-SHA256 extract + 한 블록 expand와 같음.) 매 연결 새 난수라 지난 녹음을 다시 틀 수 없습니다.

## 프레임
```
u32 길이(BE) ‖ AES-256-GCM(key, nonce = 0x00000000 ‖ u64 순번(BE), 메시지, aad = "PVT1 frame")
```
방향마다 키와 순번(0부터)이 따로라, 재전송·순서 바꾸기·되돌려 보내기가 모두 인증 실패가 됩니다.
메시지 최대 1 MiB + 4 KiB. 인증 실패 = `WRONG_PEER`로 즉시 중단.

## 메시지 (첫 바이트 = 종류, 숫자는 모두 big-endian)
| 종류 | 방향 | 내용 |
|---|---|---|
| 1 HELLO | 양쪽 | version(1). 연결 직후 서로 비밀값을 안다는 증명 |
| 2 OFFER | 기존→새 | last(1) · count(u32) · count × [id 16 · kind(0 사진/1 동영상) · size(i64)]. 2만 개씩 나눔 |
| 3 WANT | 새→기존 | total(u32) · 비트맵(OFFER 순서, 1 = 보내 줘). 이미 받은 항목은 0 |
| 4 BEGIN | 기존→새 | id 16 · kind 1 · mime(u16 길이 + ASCII ≤128) · createdAt(i64) · size(i64) · thumbLen(u32 ≤1 MiB) · thumb |
| 5 DATA | 기존→새 | 원본 바이트 ≤256 KiB |
| 6 END | 기존→새 | 보낸 원본 전체의 SHA-256 (32) |
| 7 ITEM_OK | 새→기존 | 새 폰이 자기 키로 저장하고 디스크에서 다시 풀어 검증 완료 |
| 11 ITEM_ABORT | 기존→새 | 기존 폰에서 이 항목이 손상됨. 새 폰은 이 항목을 버리고 계속 |
| 9 DONE / 10 DONE_OK | | 끝 |
| 8 FAIL | 양쪽 | 이유 코드(1): 0 잘못된 코드 · 1 저장공간 부족 · 2 잠김 · 3 무결성 · 4 취소 · 5 기타 · 6 다른 기기 · 7 연결 끊김 |

## 중복 방지 (이어 받기)
새 폰은 받은 항목마다 원래 id를 그 항목 폴더 안 `source` 파일에 봉인해 둡니다
(파일 키로 AES-GCM, aad = 항목 id). 항목과 같은 순간에 함께 생기고 함께 지워지므로,
새 폰에서 사진을 지우면 다음 전송 때 그 사진만 다시 오고, 금고 초기화 때 기록도 사라집니다.
기록이 깨져도 결과는 "한 번 더 보냄"뿐, 자료 손실은 없습니다.

## 앱 이벤트 (JS `onTransfer`)
`{ phase: waiting | connected | progress | done | error, itemsDone, itemsTotal, bytesDone, bytesTotal, skipped, alreadyThere, error? }`.
앱이 화면을 떠나면(자동 잠금) 전송도 멈춥니다. 다시 시작하면 빠진 것만 옵니다.
