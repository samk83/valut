# App Store 입력 시트 (자동 생성)

`docs/aso/listing.json`에서 `python3 docs/aso/build.py`로 만든 파일입니다. 직접 고치지 말고 listing.json을 고친 뒤 다시 만드세요.
두 겹 잠금 문장 포함: **예** (PR #14가 출시 빌드에 없으면 `TWO_STEP=0`으로 다시 만들기)
암호화 백업 문장 포함: **예** (백업 기능이 출시 빌드에 없으면 `BACKUP=0`으로 다시 만들기)

## en-US

**Name**: `Private Vision Vault`  
**Subtitle**: `Hide & Lock Photos and Videos`  
**Keywords**: `secret,album,hidden,safe,locker,encrypt,secure,gallery,picture,privacy,password,offline,pin,keep`

**Promotional Text**:
```
Hide photos and videos in a vault encrypted on your iPhone or iPad. No account, no cloud, no ads. 100 items free, unlimited with one lifetime payment.
```
**Description**:
```
Private Vision Vault keeps the photos and videos you choose in an encrypted vault on your iPhone or iPad. No account, no cloud, no ads.

REAL ENCRYPTION, NOT JUST A LOCK SCREEN
• Every photo and video is encrypted on this device with AES-256-GCM.
• The vault key is protected by your PIN or pattern together with a key in the device's Secure Enclave, and that key never leaves this device.
• Two locks: the app first asks for your device's own lock (Face ID, Touch ID or passcode), then your PIN or pattern.
• No account and no servers. The app does not send your photos, videos or PIN anywhere.

EVERYDAY USE
• Import from your photo library. The app copies each item into the vault and never touches your originals.
• Take photos and videos with the in-app camera. They go straight into the vault, never into your photo library.
• Locks the moment you leave the app and blurs its preview in the app switcher.
• Made for iPhone and iPad.

NEW PHONE? BRING YOUR VAULT, FREE
• Move to a new phone sends the vault directly from your old phone to your new one over your own Wi-Fi. It stays encrypted the whole way and never goes through the internet.
• Optional encrypted backup to a folder you choose, such as iCloud Drive. If you delete the app or lose the phone, restore it with your 52-character recovery key. Free.

PRICE
• Free: up to 100 photos and videos, with every security feature.
• Lifetime Premium: unlimited, for a single payment. No subscription. Family Sharing supported.

PLEASE READ BEFORE YOU START
• Nobody, including the developer, can reset your PIN or read your vault. Keep your recovery key somewhere safe: it is the only way to restore a backup.
• After 3 wrong tries, you wait 1 minute before the next try, then 5 minutes, 15 minutes and 1 hour.
• The vault is not part of iCloud or computer backups. Turn on the app's encrypted backup and keep your recovery key, or deleting the app or resetting the device erases the vault.
• Keep separate copies of anything you cannot afford to lose.
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `Unlimited photos and videos. Pay once.`

**스크린샷 문구** (순서대로):

1. Hide photos & videos — In a vault only you can open
2. Two locks, not one — Face ID or passcode, then your PIN
3. Easy import — Copied in. Originals stay untouched.
4. No account, no servers — Nothing is sent to us. No tracking.
5. New phone? Bring your vault — Phone to phone over your Wi-Fi. Free.
6. 100 items free — Unlimited with one payment. No subscription.
7. No back door — Not even we can open your vault

## ko

**Name**: `Private Vision Vault: 사진 금고`  
**Subtitle**: `사진·동영상 숨기기, 비밀 앨범 잠금`  
**Keywords**: `사진잠금,갤러리,숨김,암호화,개인,보안,비밀번호,잠금앱,사진보관,오프라인,보관함,프라이버시,자물쇠,동영상보관,사생활,동영상잠금,시크릿,사진숨김,비공개,안전,pin`

**Promotional Text**:
```
사진과 동영상을 iPhone·iPad 안에서 암호화된 금고에 숨기세요. 계정·클라우드·광고 없음. 100개까지 무료, 한 번 결제로 평생 무제한.
```
**Description**:
```
Private Vision Vault는 고른 사진과 동영상을 iPhone·iPad 안의 암호화된 금고에 보관합니다. 계정도, 클라우드도, 광고도 없습니다.

잠금 화면이 아니라 진짜 암호화
• 모든 사진·동영상을 이 기기 안에서 AES-256-GCM으로 암호화합니다.
• 금고 열쇠는 PIN 또는 패턴과 기기의 Secure Enclave 키를 함께 써서 보호하며, 이 키는 기기 밖으로 나가지 않습니다.
• 잠금 두 겹: 먼저 기기 자체 잠금(Face ID, Touch ID 또는 암호), 그다음 앱의 PIN 또는 패턴을 묻습니다.
• 계정과 서버가 없습니다. 앱은 사진·동영상·PIN을 어디로도 보내지 않습니다.

매일 쓰기
• 사진 앱에서 가져오면 금고로 복사만 하고 원본은 건드리지 않습니다.
• 앱 안 카메라로 찍은 사진·동영상은 사진 앱에 저장되지 않고 바로 금고에 들어갑니다.
• 앱을 벗어나는 순간 잠기고, 앱 전환 화면에서는 흐리게 가려집니다.
• iPhone과 iPad 모두 지원합니다.

새 폰으로 그대로, 무료
• 새 휴대폰으로 옮기기: 내 Wi-Fi로 기존 폰에서 새 폰으로 직접 보냅니다. 옮기는 동안에도 암호화된 상태이고 인터넷을 거치지 않습니다.
• 내가 고른 폴더(iCloud Drive 등)에 암호화 백업을 켤 수 있습니다. 앱을 지우거나 폰을 잃어버려도 52자리 복구 키로 되살릴 수 있습니다. 무료입니다.

가격
• 무료: 사진·동영상 100개까지, 모든 보안 기능 포함.
• Lifetime Premium: 한 번 결제로 개수 제한 없음. 구독 아님. 가족 공유 지원.

시작하기 전에 꼭 읽어 주세요
• 개발자를 포함해 누구도 PIN을 재설정하거나 금고를 볼 수 없습니다. 복구 키는 백업을 되살리는 유일한 방법이니 안전한 곳에 보관하세요.
• 3번 틀린 뒤에는 다음 시도까지 1분, 그다음 5분, 15분, 1시간을 기다려야 합니다.
• 금고는 iCloud·컴퓨터 백업에 포함되지 않습니다. 앱의 암호화 백업을 켜고 복구 키를 보관하지 않으면, 앱을 지우거나 기기를 초기화할 때 금고도 지워집니다.
• 잃으면 안 되는 자료는 따로 사본을 보관하세요.
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `사진·동영상 무제한. 한 번만 결제.`

**스크린샷 문구** (순서대로):

1. 사진·동영상 숨기기 — 나만 열 수 있는 금고에
2. 잠금은 두 겹 — Face ID 또는 암호, 그다음 내 PIN
3. 간편한 가져오기 — 금고로 복사, 원본은 그대로
4. 계정도 서버도 없어요 — 저희에게 아무것도 보내지 않아요. 추적 없음
5. 새 폰으로 그대로 — 내 Wi-Fi로 폰끼리 직접. 무료
6. 100개까지 무료 — 한 번 결제로 무제한. 구독 없음
7. 뒷문은 없습니다 — 개발자도 금고를 열 수 없어요

## ja

**Name**: `Private Vision Vault: 写真金庫`  
**Subtitle**: `写真・動画を隠す秘密のアルバム`  
**Keywords**: `シークレット,非表示,ロック,鍵,パスワード,プライベート,暗号化,ギャラリー,保護,画像,隠し,セキュリティ,オフライン,保管,写真ロック,動画ロック,カギ,プライバシー,アプリロック,pin`

**Promotional Text**:
```
写真と動画をiPhone・iPadの中で暗号化された金庫に隠せます。アカウント、クラウド、広告なし。100件まで無料、1回の購入でずっと無制限。
```
**Description**:
```
Private Vision Vaultは、選んだ写真と動画をiPhone・iPadの中の暗号化された金庫に保管します。アカウントもクラウドも広告もありません。

画面ロックではなく、本物の暗号化
• すべての写真と動画をこの端末内でAES-256-GCMで暗号化します。
• 金庫の鍵はPINまたはパターンと端末のSecure Enclaveの鍵を組み合わせて守られ、その鍵は端末の外に出ません。
• 2つのロック：まず端末のロック（Face ID、Touch IDまたはパスコード）、次にアプリのPINまたはパターンを求めます。
• アカウントもサーバーもありません。写真・動画・PINをどこにも送信しません。

毎日の使い方
• 写真アプリから取り込むと金庫にコピーするだけで、元の写真には一切触れません。
• アプリ内カメラで撮った写真・動画は写真アプリに保存されず、そのまま金庫に入ります。
• アプリを離れた瞬間にロックし、アプリ切り替え画面ではぼかして隠します。
• iPhoneとiPadに対応。

新しいスマホへそのまま、無料
• 「新しいスマートフォンに移行」で、お使いのWi-Fiを使って古い端末から新しい端末へ直接送ります。移行中も暗号化されたままで、インターネットを経由しません。
• iCloud Driveなど、選んだフォルダに暗号化バックアップを作成できます（任意）。アプリを削除したり端末をなくしたりしても、52文字の復元キーで元に戻せます。無料です。

料金
• 無料：写真・動画100件まで、すべてのセキュリティ機能つき。
• Lifetime Premium：1回の購入で無制限。サブスクリプションではありません。ファミリー共有対応。

はじめる前に必ずお読みください
• 開発者を含め、誰もPINをリセットしたり金庫の中身を見たりできません。復元キーはバックアップを戻す唯一の手段なので、安全な場所に保管してください。
• 3回間違えると、次に試せるまで1分、その後5分、15分、1時間待つ必要があります。
• 金庫はiCloudやコンピュータのバックアップに含まれません。アプリの暗号化バックアップを有効にして復元キーを保管しない場合、アプリの削除や端末の初期化で金庫も消去されます。
• 失いたくないデータは別にコピーを保管してください。
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `写真・動画が無制限。支払いは1回だけ。`

**스크린샷 문구** (순서대로):

1. 写真と動画を隠す — あなただけが開ける金庫に
2. ロックは2つ — Face IDかパスコード、次にPIN
3. かんたん取り込み — 金庫にコピー、元の写真はそのまま
4. アカウントもサーバーもなし — 私たちには何も送信されません。追跡なし
5. 機種変更もそのまま — Wi-Fiで端末から端末へ直接。無料
6. 100件まで無料 — 1回の購入で無制限。サブスクなし
7. 裏口はありません — 開発者でも金庫は開けられません

## zh-Hans

**Name**: `Private Vision Vault: 私密相册`  
**Subtitle**: `隐藏照片视频，加密锁定，无需账户`  
**Keywords**: `隐私,保险箱,相册锁,加锁,私密空间,密码,照片锁,视频锁,保密,离线,安全,图片,保护,秘密,图库,加密相册,隐私相册,私人,应用锁,保险柜,密码锁,pin`

**Promotional Text**:
```
把照片和视频藏进 iPhone、iPad 本机加密的保险箱。无账户、无云端、无广告。免费存 100 项，一次付费终身无限。
```
**Description**:
```
Private Vision Vault 将你选择的照片和视频保存在 iPhone、iPad 本机的加密保险箱中。无账户、无云端、无广告。

真正的加密，而不只是一个锁屏
• 每张照片和每段视频都在本机使用 AES-256-GCM 加密。
• 保险箱密钥由你的 PIN 或图案与设备 Secure Enclave 中的密钥共同保护，该密钥永远不会离开这台设备。
• 双重锁定：先验证设备自身的锁（面容 ID、触控 ID 或设备密码），再输入 App 的 PIN 或图案。
• 没有账户，也没有服务器。App 不会把你的照片、视频或 PIN 发送到任何地方。

日常使用
• 从照片图库导入时只会复制到保险箱，绝不改动原件。
• 用 App 内相机拍摄的照片和视频直接进入保险箱，不会存入照片图库。
• 离开 App 的瞬间自动锁定，并在多任务界面中模糊显示。
• 支持 iPhone 和 iPad。

换新手机，免费带走保险箱
• “迁移到新手机”通过你自己的 Wi-Fi，把保险箱从旧手机直接发送到新手机。全程保持加密，不经过互联网。
• 可选：加密备份到你选择的文件夹，例如 iCloud 云盘。即使删除 App 或丢失手机，也能用 52 位恢复密钥还原。免费。

价格
• 免费：最多 100 张照片和视频，包含全部安全功能。
• Lifetime Premium：一次付费，数量不限。非订阅。支持家人共享。

开始前请务必阅读
• 包括开发者在内，任何人都无法重置你的 PIN 或查看你的保险箱。恢复密钥是还原备份的唯一方式，请妥善保管。
• 输错 3 次后，每次重试前需等待 1 分钟，之后依次为 5 分钟、15 分钟和 1 小时。
• 保险箱不包含在 iCloud 或电脑备份中。若未开启 App 的加密备份并保管好恢复密钥，删除 App 或抹掉设备会一并清除保险箱。
• 不能丢失的资料请另外保留副本。
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `照片和视频不限数量，只需付费一次。`

**스크린샷 문구** (순서대로):

1. 隐藏照片和视频 — 放进只有你能打开的保险箱
2. 双重锁定 — 先用面容 ID 或密码，再输入 PIN
3. 轻松导入 — 复制进保险箱，原件不动
4. 无账户，无服务器 — 不会向我们发送任何内容，无追踪
5. 换新手机，一起带走 — 通过你的 Wi-Fi 手机直传，免费
6. 免费存 100 项 — 一次付费，无限存储，非订阅
7. 没有后门 — 连开发者也打不开你的保险箱

## hi

**Name**: `Private Vision Vault: तिजोरी`  
**Subtitle**: `फ़ोटो-वीडियो छिपाएँ, लॉक करें`  
**Keywords**: `गुप्त,एल्बम,गैलरी,सुरक्षित,पासवर्ड,निजी,छुपाना,locker,hide,photo,lock,gallery,secret,pin`

**Promotional Text**:
```
अपनी फ़ोटो और वीडियो को iPhone या iPad पर एन्क्रिप्टेड तिजोरी में छिपाएँ। न अकाउंट, न क्लाउड, न विज्ञापन। 100 आइटम मुफ़्त, एक बार भुगतान पर असीमित।
```
**Description**:
```
Private Vision Vault आपकी चुनी हुई फ़ोटो और वीडियो को आपके iPhone या iPad पर एक एन्क्रिप्टेड तिजोरी में रखता है। न अकाउंट, न क्लाउड, न विज्ञापन।

सिर्फ़ लॉक स्क्रीन नहीं, असली एन्क्रिप्शन
• हर फ़ोटो और वीडियो इसी डिवाइस पर AES-256-GCM से एन्क्रिप्ट होता है।
• तिजोरी की चाबी आपके PIN या पैटर्न और डिवाइस के Secure Enclave की चाबी, दोनों से सुरक्षित रहती है, और वह चाबी कभी इस डिवाइस से बाहर नहीं जाती।
• दो ताले: ऐप पहले डिवाइस का अपना लॉक (Face ID, Touch ID या पासकोड) माँगता है, फिर आपका PIN या पैटर्न।
• न अकाउंट, न सर्वर। ऐप आपकी फ़ोटो, वीडियो या PIN कहीं नहीं भेजता।

रोज़ का इस्तेमाल
• फ़ोटो लाइब्रेरी से इम्पोर्ट करने पर ऐप हर आइटम की कॉपी तिजोरी में रखता है और मूल फ़ाइलों को नहीं छूता।
• ऐप के कैमरे से ली गई फ़ोटो और वीडियो सीधे तिजोरी में जाते हैं, फ़ोटो लाइब्रेरी में नहीं।
• ऐप छोड़ते ही लॉक हो जाता है और ऐप स्विचर में धुंधला दिखता है।
• iPhone और iPad दोनों के लिए।

नया फ़ोन? तिजोरी साथ ले जाएँ, मुफ़्त
• "नए फ़ोन पर ले जाएँ" आपके अपने Wi-Fi से पुराने फ़ोन से नए फ़ोन तक तिजोरी सीधे भेजता है। पूरे रास्ते यह एन्क्रिप्टेड रहती है और इंटरनेट से नहीं गुज़रती।
• अपनी चुनी हुई फ़ोल्डर (जैसे iCloud Drive) में वैकल्पिक एन्क्रिप्टेड बैकअप। ऐप हटाने या फ़ोन खोने पर 52 अक्षरों की रिकवरी की से वापस पाएँ। मुफ़्त।

कीमत
• मुफ़्त: 100 फ़ोटो और वीडियो तक, सभी सुरक्षा सुविधाओं के साथ।
• Lifetime Premium: एक बार भुगतान, असीमित। कोई सब्सक्रिप्शन नहीं। फ़ैमिली शेयरिंग समर्थित।

शुरू करने से पहले ज़रूर पढ़ें
• डेवलपर समेत कोई भी आपका PIN रीसेट नहीं कर सकता या तिजोरी नहीं देख सकता। रिकवरी की संभालकर रखें: बैकअप वापस पाने का यही एकमात्र तरीका है।
• 3 गलत कोशिशों के बाद अगली कोशिश से पहले 1 मिनट, फिर 5 मिनट, 15 मिनट और 1 घंटा इंतज़ार करना होता है।
• तिजोरी iCloud या कंप्यूटर बैकअप में शामिल नहीं होती। ऐप का एन्क्रिप्टेड बैकअप चालू करें और रिकवरी की रखें, वरना ऐप हटाने या डिवाइस रीसेट करने पर तिजोरी मिट जाती है।
• जो चीज़ें आप खो नहीं सकते, उनकी अलग कॉपी रखें।
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `असीमित फ़ोटो और वीडियो। एक बार भुगतान।`

**스크린샷 문구** (순서대로):

1. फ़ोटो और वीडियो छिपाएँ — ऐसी तिजोरी में जिसे सिर्फ़ आप खोलें
2. एक नहीं, दो ताले — Face ID या पासकोड, फिर आपका PIN
3. आसान इम्पोर्ट — तिजोरी में कॉपी, मूल फ़ाइलें वैसी ही
4. न अकाउंट, न सर्वर — हमें कुछ नहीं भेजा जाता। कोई ट्रैकिंग नहीं
5. नया फ़ोन? तिजोरी साथ ले जाएँ — अपने Wi-Fi से फ़ोन से फ़ोन तक। मुफ़्त
6. 100 आइटम मुफ़्त — एक बार भुगतान, असीमित। सब्सक्रिप्शन नहीं
7. कोई बैक डोर नहीं — हम भी आपकी तिजोरी नहीं खोल सकते

## id

**Name**: `Private Vision Vault: Brankas`  
**Subtitle**: `Sembunyikan & Kunci Foto Video`  
**Keywords**: `rahasia,album,galeri,privat,aman,sandi,gembok,enkripsi,simpan,tersembunyi,privasi,gambar,pin`

**Promotional Text**:
```
Sembunyikan foto dan video di brankas terenkripsi di iPhone atau iPad. Tanpa akun, tanpa cloud, tanpa iklan. Gratis 100 item, tanpa batas dengan sekali bayar.
```
**Description**:
```
Private Vision Vault menyimpan foto dan video pilihanmu di brankas terenkripsi di iPhone atau iPad. Tanpa akun, tanpa cloud, tanpa iklan.

ENKRIPSI SUNGGUHAN, BUKAN SEKADAR LAYAR KUNCI
• Setiap foto dan video dienkripsi di perangkat ini dengan AES-256-GCM.
• Kunci brankas dilindungi oleh PIN atau pola bersama kunci di Secure Enclave perangkat, dan kunci itu tidak pernah keluar dari perangkat ini.
• Dua kunci: aplikasi meminta kunci perangkat (Face ID, Touch ID, atau kode sandi) lebih dulu, lalu PIN atau polamu.
• Tanpa akun dan tanpa server. Aplikasi tidak mengirim foto, video, atau PIN-mu ke mana pun.

PENGGUNAAN SEHARI-HARI
• Impor dari perpustakaan foto. Aplikasi hanya menyalin setiap item ke brankas dan tidak pernah menyentuh foto asli.
• Foto dan video dari kamera di dalam aplikasi langsung masuk ke brankas, tidak pernah ke perpustakaan foto.
• Terkunci saat kamu meninggalkan aplikasi dan pratinjaunya diburamkan di pengalih aplikasi.
• Untuk iPhone dan iPad.

HP BARU? BAWA BRANKASMU, GRATIS
• Pindah ke ponsel baru mengirim brankas langsung dari HP lama ke HP baru lewat Wi-Fi milikmu. Tetap terenkripsi sepanjang jalan dan tidak melewati internet.
• Cadangan terenkripsi opsional ke folder pilihanmu, seperti iCloud Drive. Jika aplikasi dihapus atau ponsel hilang, pulihkan dengan kunci pemulihan 52 karakter. Gratis.

HARGA
• Gratis: hingga 100 foto dan video, dengan semua fitur keamanan.
• Lifetime Premium: tanpa batas dengan sekali bayar. Bukan langganan. Mendukung Berbagi Keluarga.

BACA SEBELUM MULAI
• Tidak ada siapa pun, termasuk pengembang, yang bisa mengatur ulang PIN atau melihat brankasmu. Simpan kunci pemulihan dengan aman: hanya itu cara memulihkan cadangan.
• Setelah 3 kali salah, kamu menunggu 1 menit sebelum mencoba lagi, lalu 5 menit, 15 menit, dan 1 jam.
• Brankas tidak termasuk dalam cadangan iCloud atau komputer. Aktifkan cadangan terenkripsi aplikasi dan simpan kunci pemulihan; jika tidak, menghapus aplikasi atau mereset perangkat akan menghapus brankas.
• Simpan salinan terpisah untuk apa pun yang tidak boleh hilang.
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `Foto dan video tanpa batas. Sekali bayar.`

**스크린샷 문구** (순서대로):

1. Sembunyikan foto & video — Di brankas yang hanya bisa kamu buka
2. Dua kunci, bukan satu — Face ID atau kode sandi, lalu PIN-mu
3. Impor dengan mudah — Disalin ke brankas, asli tetap utuh
4. Tanpa akun, tanpa server — Tidak ada yang dikirim ke kami. Tanpa pelacakan.
5. HP baru? Bawa brankasmu — Langsung antar-HP lewat Wi-Fi-mu. Gratis.
6. Gratis 100 item — Tanpa batas dengan sekali bayar. Bukan langganan.
7. Tanpa pintu belakang — Kami pun tidak bisa membuka brankasmu

## pt-BR

**Name**: `Private Vision Vault: Cofre`  
**Subtitle**: `Esconda fotos e vídeos`  
**Keywords**: `secreto,álbum,oculto,privado,galeria,seguro,trancar,senha,cadeado,guardar,proteger,bloqueio,pin`

**Promotional Text**:
```
Esconda fotos e vídeos num cofre criptografado no seu iPhone ou iPad. Sem conta, sem nuvem, sem anúncios. 100 itens grátis, ilimitado com um único pagamento vitalício.
```
**Description**:
```
O Private Vision Vault guarda as fotos e os vídeos que você escolher num cofre criptografado no seu iPhone ou iPad. Sem conta, sem nuvem, sem anúncios.

CRIPTOGRAFIA DE VERDADE, NÃO SÓ UMA TELA DE BLOQUEIO
• Cada foto e vídeo é criptografado neste aparelho com AES-256-GCM.
• A chave do cofre é protegida pelo seu PIN ou padrão junto com uma chave no Secure Enclave do aparelho, e essa chave nunca sai deste aparelho.
• Duas trancas: o app pede primeiro o bloqueio do próprio aparelho (Face ID, Touch ID ou código) e depois o seu PIN ou padrão.
• Sem conta e sem servidores. O app não envia suas fotos, vídeos ou PIN para lugar nenhum.

NO DIA A DIA
• Importe da sua fototeca. O app copia cada item para o cofre e nunca mexe nos originais.
• Fotos e vídeos feitos com a câmera do app vão direto para o cofre, nunca para a fototeca.
• Bloqueia assim que você sai do app e desfoca a prévia no seletor de apps.
• Feito para iPhone e iPad.

CELULAR NOVO? LEVE O COFRE, GRÁTIS
• Mudar para um celular novo envia o cofre direto do celular antigo para o novo pelo seu próprio Wi-Fi. Ele continua criptografado o caminho todo e não passa pela internet.
• Backup criptografado opcional numa pasta que você escolher, como o iCloud Drive. Se apagar o app ou perder o celular, restaure com sua chave de recuperação de 52 caracteres. Grátis.

PREÇO
• Grátis: até 100 fotos e vídeos, com todos os recursos de segurança.
• Lifetime Premium: ilimitado, com um único pagamento. Não é assinatura. Compatível com o Compartilhamento Familiar.

LEIA ANTES DE COMEÇAR
• Ninguém, nem o desenvolvedor, pode redefinir seu PIN ou ver seu cofre. Guarde a chave de recuperação em lugar seguro: é a única forma de restaurar um backup.
• Depois de 3 tentativas erradas, você espera 1 minuto até a próxima, depois 5 minutos, 15 minutos e 1 hora.
• O cofre não entra em backups do iCloud ou do computador. Ative o backup criptografado do app e guarde a chave de recuperação; sem isso, apagar o app ou redefinir o aparelho apaga o cofre.
• Guarde cópias separadas de tudo o que você não pode perder.
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `Fotos e vídeos ilimitados. Pague uma vez.`

**스크린샷 문구** (순서대로):

1. Esconda fotos e vídeos — Num cofre que só você abre
2. Duas trancas, não uma — Face ID ou código, depois seu PIN
3. Importação fácil — Copiado para o cofre, originais intactos
4. Sem conta, sem servidores — Nada é enviado para nós. Sem rastreamento.
5. Celular novo? Leve o cofre — De celular para celular pelo seu Wi-Fi. Grátis.
6. 100 itens grátis — Ilimitado com um só pagamento. Sem assinatura.
7. Sem porta dos fundos — Nem nós conseguimos abrir seu cofre

## ru

**Name**: `Private Vision Vault: Сейф`  
**Subtitle**: `Скрыть фото и видео под замком`  
**Keywords**: `секретный,альбом,скрытые,галерея,приватный,пароль,защита,шифрование,хранилище,блокировка,pin`

**Promotional Text**:
```
Прячьте фото и видео в зашифрованный сейф прямо на iPhone или iPad. Без аккаунта, облака и рекламы. 100 файлов бесплатно, безлимит за один пожизненный платёж.
```
**Description**:
```
Private Vision Vault хранит выбранные вами фото и видео в зашифрованном сейфе на iPhone или iPad. Без аккаунта, без облака, без рекламы.

НАСТОЯЩЕЕ ШИФРОВАНИЕ, А НЕ ПРОСТО ЭКРАН БЛОКИРОВКИ
• Каждое фото и видео шифруется на этом устройстве с помощью AES-256-GCM.
• Ключ сейфа защищён вашим PIN-кодом или графическим ключом вместе с ключом в Secure Enclave устройства, и этот ключ никогда не покидает устройство.
• Два замка: сначала приложение запрашивает блокировку самого устройства (Face ID, Touch ID или код-пароль), затем ваш PIN-код или графический ключ.
• Нет аккаунта и серверов. Приложение никуда не отправляет ваши фото, видео и PIN-код.

КАЖДЫЙ ДЕНЬ
• Импорт из медиатеки: приложение копирует файлы в сейф и не трогает оригиналы.
• Фото и видео со встроенной камеры сразу попадают в сейф и никогда в медиатеку.
• Блокируется, как только вы выходите из приложения, и размывает превью в переключателе приложений.
• Для iPhone и iPad.

НОВЫЙ ТЕЛЕФОН? СЕЙФ С ВАМИ, БЕСПЛАТНО
• «Перенос на новый телефон» отправляет сейф напрямую со старого телефона на новый через ваш Wi-Fi. Всё время остаётся зашифрованным и не проходит через интернет.
• Необязательная зашифрованная резервная копия в выбранную вами папку, например iCloud Drive. Если удалите приложение или потеряете телефон, восстановите её 52-символьным ключом восстановления. Бесплатно.

ЦЕНА
• Бесплатно: до 100 фото и видео со всеми функциями безопасности.
• Lifetime Premium: безлимит за один платёж. Не подписка. Поддерживается Семейный доступ.

ПРОЧИТАЙТЕ ПЕРЕД НАЧАЛОМ
• Никто, включая разработчика, не может сбросить ваш PIN-код или увидеть содержимое сейфа. Храните ключ восстановления надёжно: это единственный способ восстановить копию.
• После 3 неверных попыток перед следующей нужно подождать 1 минуту, затем 5 минут, 15 минут и 1 час.
• Сейф не входит в резервные копии iCloud и компьютера. Включите зашифрованную копию в приложении и сохраните ключ восстановления, иначе удаление приложения или сброс устройства сотрут сейф.
• Храните отдельные копии всего, что нельзя потерять.
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `Безлимит фото и видео. Оплата один раз.`

**스크린샷 문구** (순서대로):

1. Скрывайте фото и видео — В сейфе, который откроете только вы
2. Два замка вместо одного — Face ID или код-пароль, затем PIN
3. Простой импорт — Копия в сейфе, оригиналы на месте
4. Без аккаунта и серверов — Нам ничего не отправляется. Без отслеживания.
5. Новый телефон? Сейф с вами — Напрямую по вашему Wi-Fi. Бесплатно.
6. 100 файлов бесплатно — Безлимит за один платёж. Без подписки.
7. Никаких лазеек — Даже мы не можем открыть ваш сейф

## es-MX

**Name**: `Private Vision Vault: Bóveda`  
**Subtitle**: `Oculta y bloquea fotos, videos`  
**Keywords**: `secreto,álbum,oculto,privado,galería,seguro,cifrado,candado,contraseña,esconder,guardar,proteger,pin`

**Promotional Text**:
```
Oculta fotos y videos en una bóveda cifrada en tu iPhone o iPad. Sin cuenta, sin nube, sin anuncios. 100 elementos gratis, ilimitado con un solo pago de por vida.
```
**Description**:
```
Private Vision Vault guarda las fotos y los videos que elijas en una bóveda cifrada en tu iPhone o iPad. Sin cuenta, sin nube, sin anuncios.

CIFRADO REAL, NO SOLO UNA PANTALLA DE BLOQUEO
• Cada foto y video se cifra en este dispositivo con AES-256-GCM.
• La llave de la bóveda está protegida por tu PIN o patrón junto con una llave en el Secure Enclave del dispositivo, y esa llave nunca sale de este dispositivo.
• Dos candados: la app pide primero el bloqueo del propio dispositivo (Face ID, Touch ID o código) y luego tu PIN o patrón.
• Sin cuenta y sin servidores. La app no envía tus fotos, videos ni tu PIN a ningún lado.

DÍA A DÍA
• Importa desde tu fototeca. La app copia cada elemento a la bóveda y nunca toca tus originales.
• Las fotos y videos de la cámara de la app van directo a la bóveda, nunca a tu fototeca.
• Se bloquea en cuanto sales de la app y difumina la vista previa en el selector de apps.
• Hecha para iPhone y iPad.

¿CELULAR NUEVO? LLEVA TU BÓVEDA, GRATIS
• Mover a un teléfono nuevo envía la bóveda directo del teléfono anterior al nuevo por tu propio Wi-Fi. Sigue cifrada todo el camino y nunca pasa por internet.
• Respaldo cifrado opcional en una carpeta que elijas, como iCloud Drive. Si borras la app o pierdes el teléfono, restáuralo con tu clave de recuperación de 52 caracteres. Gratis.

PRECIO
• Gratis: hasta 100 fotos y videos, con todas las funciones de seguridad.
• Lifetime Premium: ilimitado con un solo pago. No es suscripción. Compatible con En Familia.

LEE ANTES DE EMPEZAR
• Nadie, ni siquiera el desarrollador, puede restablecer tu PIN ni ver tu bóveda. Guarda tu clave de recuperación en un lugar seguro: es la única forma de restaurar un respaldo.
• Después de 3 intentos fallidos, esperas 1 minuto antes del siguiente, luego 5 minutos, 15 minutos y 1 hora.
• La bóveda no se incluye en respaldos de iCloud ni de la computadora. Activa el respaldo cifrado de la app y guarda tu clave de recuperación; si no, borrar la app o restablecer el dispositivo borra la bóveda.
• Guarda copias aparte de todo lo que no puedas perder.
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `Fotos y videos ilimitados. Paga una vez.`

**스크린샷 문구** (순서대로):

1. Oculta fotos y videos — En una bóveda que solo tú abres
2. Dos candados, no uno — Face ID o código, y luego tu PIN
3. Importación fácil — Se copia a la bóveda, tus originales no cambian
4. Sin cuenta, sin servidores — No se nos envía nada. Sin rastreo.
5. ¿Celular nuevo? Lleva tu bóveda — De teléfono a teléfono por tu Wi-Fi. Gratis.
6. 100 elementos gratis — Ilimitado con un solo pago. Sin suscripción.
7. Sin puerta trasera — Ni nosotros podemos abrir tu bóveda

## de-DE

**Name**: `Private Vision Vault: Tresor`  
**Subtitle**: `Fotos und Videos verstecken`  
**Keywords**: `geheim,album,privat,safe,versteckt,sperren,sicher,galerie,bilder,passwort,schützen,offline,pin`

**Promotional Text**:
```
Verstecke Fotos und Videos in einem verschlüsselten Tresor auf iPhone oder iPad. Kein Konto, keine Cloud, keine Werbung. 100 Dateien gratis, unbegrenzt mit einer Zahlung.
```
**Description**:
```
Private Vision Vault bewahrt die Fotos und Videos, die du auswählst, in einem verschlüsselten Tresor auf deinem iPhone oder iPad auf. Kein Konto, keine Cloud, keine Werbung.

ECHTE VERSCHLÜSSELUNG, NICHT NUR EIN SPERRBILDSCHIRM
• Jedes Foto und Video wird auf diesem Gerät mit AES-256-GCM verschlüsselt.
• Der Tresorschlüssel wird durch deine PIN oder dein Muster zusammen mit einem Schlüssel in der Secure Enclave des Geräts geschützt. Dieser Schlüssel verlässt das Gerät nie.
• Zwei Schlösser: Die App fragt zuerst die Gerätesperre ab (Face ID, Touch ID oder Code), danach deine PIN oder dein Muster.
• Kein Konto und keine Server. Die App sendet deine Fotos, Videos oder PIN nirgendwohin.

IM ALLTAG
• Importiere aus deiner Fotomediathek. Die App kopiert jedes Objekt in den Tresor und rührt deine Originale nie an.
• Fotos und Videos aus der App-Kamera landen direkt im Tresor, nie in deiner Mediathek.
• Sperrt sofort, wenn du die App verlässt, und verschleiert die Vorschau im App-Umschalter.
• Für iPhone und iPad.

NEUES HANDY? TRESOR MITNEHMEN, GRATIS
• „Auf neues Telefon umziehen“ sendet den Tresor direkt vom alten auf das neue Handy über dein eigenes WLAN. Er bleibt den ganzen Weg verschlüsselt und geht nie über das Internet.
• Optionales verschlüsseltes Backup in einen Ordner deiner Wahl, etwa iCloud Drive. Wenn du die App löschst oder das Handy verlierst, stellst du es mit deinem 52-stelligen Wiederherstellungsschlüssel wieder her. Gratis.

PREIS
• Gratis: bis zu 100 Fotos und Videos, mit allen Sicherheitsfunktionen.
• Lifetime Premium: unbegrenzt mit einer einzigen Zahlung. Kein Abo. Familienfreigabe wird unterstützt.

BITTE VOR DEM START LESEN
• Niemand, auch nicht der Entwickler, kann deine PIN zurücksetzen oder deinen Tresor einsehen. Bewahre den Wiederherstellungsschlüssel sicher auf: Nur damit lässt sich ein Backup wiederherstellen.
• Nach 3 Fehlversuchen wartest du vor dem nächsten Versuch 1 Minute, dann 5 Minuten, 15 Minuten und 1 Stunde.
• Der Tresor ist nicht in iCloud- oder Computer-Backups enthalten. Schalte das verschlüsselte Backup der App ein und bewahre den Schlüssel auf, sonst löscht das Entfernen der App oder Zurücksetzen des Geräts den Tresor.
• Bewahre Kopien von allem auf, was du nicht verlieren darfst.
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `Unbegrenzt Fotos und Videos. Einmal zahlen.`

**스크린샷 문구** (순서대로):

1. Fotos & Videos verstecken — In einem Tresor, den nur du öffnest
2. Zwei Schlösser statt einem — Face ID oder Code, dann deine PIN
3. Einfach importieren — Kopie in den Tresor, Originale bleiben
4. Kein Konto, keine Server — Nichts wird an uns gesendet. Kein Tracking.
5. Neues Handy? Tresor mitnehmen — Direkt von Handy zu Handy per WLAN. Gratis.
6. 100 Dateien gratis — Unbegrenzt mit einer Zahlung. Kein Abo.
7. Keine Hintertür — Nicht einmal wir können deinen Tresor öffnen

## tr

**Name**: `Private Vision Vault: Kasa`  
**Subtitle**: `Fotoğraf ve video gizle`  
**Keywords**: `gizli,albüm,özel,şifre,güvenli,galeri,resim,saklama,koruma,şifreleme,kilitle,gizlilik,pin`

**Promotional Text**:
```
Fotoğraf ve videolarını iPhone veya iPad'inde şifreli bir kasada gizle. Hesap yok, bulut yok, reklam yok. 100 öğe ücretsiz, tek seferlik ödemeyle ömür boyu sınırsız.
```
**Description**:
```
Private Vision Vault, seçtiğin fotoğraf ve videoları iPhone veya iPad'indeki şifreli bir kasada saklar. Hesap yok, bulut yok, reklam yok.

SADECE KİLİT EKRANI DEĞİL, GERÇEK ŞİFRELEME
• Her fotoğraf ve video bu cihazda AES-256-GCM ile şifrelenir.
• Kasa anahtarı, PIN'in veya desenin ile cihazın Secure Enclave'indeki bir anahtarla birlikte korunur; ve o anahtar bu cihazdan hiç çıkmaz.
• İki kilit: Uygulama önce cihazın kendi kilidini (Face ID, Touch ID veya parola), sonra PIN'ini veya desenini ister.
• Hesap ve sunucu yok. Uygulama fotoğraflarını, videolarını veya PIN'ini hiçbir yere göndermez.

GÜNLÜK KULLANIM
• Fotoğraf arşivinden içe aktar. Uygulama her öğeyi kasaya kopyalar ve orijinallere asla dokunmaz.
• Uygulama içi kamerayla çekilen fotoğraf ve videolar doğrudan kasaya gider, fotoğraf arşivine asla.
• Uygulamadan çıktığın anda kilitlenir ve uygulama değiştiricide önizlemeyi bulanıklaştırır.
• iPhone ve iPad için.

YENİ TELEFON MU? KASANI TAŞI, ÜCRETSİZ
• Yeni telefona taşı, kasayı kendi Wi-Fi'ın üzerinden eski telefondan yenisine doğrudan gönderir. Yol boyunca şifreli kalır ve internetten geçmez.
• Seçtiğin bir klasöre (ör. iCloud Drive) isteğe bağlı şifreli yedek. Uygulamayı silsen ya da telefonu kaybetsen de 52 karakterlik kurtarma anahtarınla geri yükle. Ücretsiz.

FİYAT
• Ücretsiz: tüm güvenlik özellikleriyle 100 fotoğraf ve videoya kadar.
• Lifetime Premium: tek ödemeyle sınırsız. Abonelik değil. Aile Paylaşımı desteklenir.

BAŞLAMADAN ÖNCE OKU
• Geliştirici dahil hiç kimse PIN'ini sıfırlayamaz veya kasanı göremez. Kurtarma anahtarını güvenli bir yerde sakla: yedeği geri yüklemenin tek yolu odur.
• 3 yanlış denemeden sonra bir sonraki deneme için 1 dakika, ardından 5 dakika, 15 dakika ve 1 saat beklersin.
• Kasa iCloud veya bilgisayar yedeklerine dahil değildir. Uygulamanın şifreli yedeğini aç ve kurtarma anahtarını sakla; aksi halde uygulamayı silmek veya cihazı sıfırlamak kasayı siler.
• Kaybetmeyi göze alamayacağın her şeyin ayrı bir kopyasını sakla.
```
**In-App Purchase** (Lifetime Premium 현지화): Display Name `Lifetime Premium` / Description `Sınırsız fotoğraf ve video. Tek ödeme.`

**스크린샷 문구** (순서대로):

1. Fotoğraf ve videoları gizle — Sadece senin açabildiğin bir kasada
2. Bir değil, iki kilit — Face ID veya parola, sonra PIN'in
3. Kolay içe aktarma — Kasaya kopyalanır, orijinaller yerinde kalır
4. Hesap yok, sunucu yok — Bize hiçbir şey gönderilmez. Takip yok.
5. Yeni telefon mu? Kasanı taşı — Kendi Wi-Fi'ınla telefondan telefona. Ücretsiz.
6. 100 öğe ücretsiz — Tek ödemeyle sınırsız. Abonelik yok.
7. Arka kapı yok — Kasanı biz bile açamayız
