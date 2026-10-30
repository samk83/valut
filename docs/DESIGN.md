# PrivateVault 디자인 시안 (최종 후보)

- 시안: https://claude.ai/artifact/Qotoxn4wAC6ZJrrbvyNQpf (비공개, Owner 계정에서 열람)
- 컨셉: **Obsidian & Brass** — 흑요석 바탕 #0B0D12, 연마 황동 포인트 #C9A66B, 아이보리 글자 #F2EEE6
- 글꼴: Fraunces (제목 세리프) + Inter (본문)
- 앱 아이콘: "The Dial" — 금고 다이얼 + 열쇠 구멍, 금속 광택
- UI 문구: 영어 (한국어 현지화는 후속)

## 화면 목록 (19)
| # | 화면 | 관련 SPEC |
|---|---|---|
| 0 | App Icon | - |
| 1 | Welcome (제품 원칙·복구 불가 안내, 글머리표 내어쓰기 정렬) | PRD 4.1 |
| 2 | Create PIN (PIN / 패턴 중 잠금 방식 선택, 입력 점 세로 가운데 정렬, 강도 표시·복구 불가 동의) | AC-01, AC-03a |
| 3 | Create Pattern (3×3 점, 4개 이상 연결, 재입력 확인) | AC-02 |
| 4 | Unlock — PIN (남은 시도, 키패드 숫자 가운데 정렬) | AC-05 |
| 5 | Unlock — Pattern (3×3, 궤적 숨김 옵션) | AC-02 |
| 6 | Final Attempt (마지막 기회) | AC-05 |
| 7 | Vault Home · 사진 탭 (사진/동영상 아이콘 탭으로 분리, 가져오기·카메라, 공유 없음) | AC-41 |
| 8 | Vault Home · 동영상 탭 (썸네일 + 재생 시간 표시) | AC-41 |
| 9 | Import Options (고르기 전에 "가져온 후 원본 삭제" 선택, 시스템 확인창·최근 삭제됨 30일 안내) | AC-30, AC-32 |
| 10 | Importing (항목마다 암호화→검증→원본 삭제 순서) | AC-30, AC-31 |
| 11 | Import Result ("N sealed · N originals deleted", 실패 항목은 원본 유지, 잔존 사본 안내) | AC-32 |
| 12 | Vault Camera (사진첩 저장 안 함, 위치 제거) | AC-34~39 |
| 13 | Photo Viewer (공유 없음, 메모리 전용) | AC-40 |
| 14 | Video Player (청크 스트리밍, 캐시 없음) | AC-44~46 |
| 15 | Delete Confirmation (PIN 재확인) | AC-42 |
| 16 | Security Settings (자동 잠금, 보안 점검 상태) | AC-07 |
| 17 | Vault Reset (DESTROY 입력 + PIN) | AC-43 |
| 18 | Vault Destroyed (3회 오류·초기화 후) | AC-04 |

시안에는 PREVIEW/TEST 경고 배너가 없음 (전체 화면 그대로).

상태: Owner 디자인 승인 대기.
