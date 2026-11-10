# 1.1 프리미엄 상품 등록 안내 (Owner 작업)

앱 코드는 준비되어 있습니다. 스토어에 **상품을 한 번 등록**해야 실제 결제가 됩니다.
상품 ID는 두 스토어 모두 같습니다: `com.jellydock.privatevault.premium`

> 비용: 스토어 수수료(보통 15~30%) 외에 추가 비용은 없습니다. 실제 출시(심사 제출)는 Owner 승인 후에만 합니다.

## 1. App Store Connect (iPhone·iPad)
1. 먼저 **Agreements, Tax, and Banking**에서 *Paid Apps* 계약·세금·계좌 등록 (유료 상품 판매에 필수)
2. **Apps → Private Vision Vault → Monetization → In-App Purchases → (+)**
3. Type: **Non-Consumable** (한 번 사면 영구)
4. Reference Name: `Lifetime Premium` · Product ID: `com.jellydock.privatevault.premium`
5. **Availability**: 모든 국가 · **Price Schedule**: USD **9.99** (한국 등 다른 나라 가격은 Apple이 자동 환산, 약 ₩14,000)
6. **Family Sharing**: 켜기 (Turn On)
7. **App Store Localization**: 표시 이름 `Lifetime Premium` / 설명 `Unlimited photos and videos. Pay once, yours for good.` (한국어: `평생 프리미엄` / `사진·동영상 무제한. 한 번 결제로 영구 사용.`)
8. **Review Information**: 스크린샷 1장 = 앱의 프리미엄 화면 (설정 › Free plan 누르면 나옴)
9. 1.1 앱 버전 화면의 **In-App Purchases** 칸에 이 상품을 추가 → 앱과 함께 심사 제출
10. 테스트: **Users and Access → Sandbox Testers**에 테스트 계정을 만들고, TestFlight 빌드에서 구매 → 실제 돈은 나가지 않음

## 2. Google Play Console (Android)
1. **설정 → 결제 프로필** 만들기 (판매자 계정, 처음 1회)
2. 앱에 Billing 라이브러리가 들어간 빌드(1.1)를 **내부 테스트** 트랙에 먼저 한 번 올려야 상품 메뉴가 열립니다
3. **수익 창출 → 제품 → 일회성 제품 → 제품 만들기**
4. 제품 ID: `com.jellydock.privatevault.premium` · 이름 `Lifetime Premium` · 설명 위와 같음
5. 가격: USD **9.99** → 다른 국가 자동 환산 → **활성화**
6. 테스트: **설정 → 라이선스 테스트**에 내 Google 계정 추가 → 테스트 카드로 결제 (실제 청구 없음)

## 3. 개인정보 라벨
- 앱은 서버가 없고 결제 정보를 보지 않습니다. App Store **App Privacy = Data Not Collected** 그대로 유지
- Google Play **데이터 보안**: "데이터를 수집하거나 공유하지 않음" 그대로 유지

## 4. 확인할 것 (실기기)
| 확인 | 기대 결과 |
|---|---|
| 사진·동영상 100개 넣기 | 101번째 가져오기·촬영 때 프리미엄 화면 |
| 구매 (샌드박스/테스트 카드) | "Unlimited storage is on", 바로 추가 가능 |
| 앱 삭제 후 재설치 → 설정 › Restore purchases | 프리미엄 복원 |
| 비행기 모드에서 앱 열기 | 이미 산 프리미엄 유지 |
| 결제 창에서 취소 | 아무 변화 없음, 금고 잠기지 않음 |
