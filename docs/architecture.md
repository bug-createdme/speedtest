# Kiến trúc Speedtest Unitel — Phase 2

Trạng thái: **Draft — bridge WindVane đã xác nhận với tài liệu chính thức; còn 2 mục mở ở phần "Việc cần bạn xác nhận"**
Ngày: 2026-08-24

> ## ⚠ Đính chính mục đích dự án — 2026-08-24
>
> Tài liệu này ban đầu được viết với giả định **"thử nghiệm nội bộ vài chục–vài trăm user"**. Giả định đó **sai** và đã dẫn tới ít nhất một quyết định kiến trúc sai (mục 4, xem phần đính chính ở đó).
>
> **Mục đích thật:** miniapp chạy trong super-app Unitel, dùng để **phòng ban vận hành mạng** kiểm tra chất lượng mạng đang phục vụ khách hàng — vai trò tương đương speedtest.net nhưng cho riêng hạ tầng Unitel.
>
> Ba hệ quả, áp dụng cho toàn bộ tài liệu:
>
> 1. **Dữ liệu kết quả là sản phẩm chính**, không phải tính năng phụ tuỳ chọn. Kết quả phải được thu thập về server, không được chỉ nằm trên máy người dùng. (mục 4 — đã sửa)
> 2. **Loaded latency và packet loss là chỉ số bắt buộc**, không phải "nice to have". Với vận hành mạng, "ping bao nhiêu khi đang tải" trả lời câu hỏi *mạng có ổn không* tốt hơn con số băng thông. **Đã bổ sung 2026-08-24** — xem mục 4b.
> 3. **Bảo mật (Phase 9) phải lên sớm hơn**, vì sắp có dữ liệu định danh thuê bao chứ không chỉ số đo ẩn danh. Mục 7 dưới đây vẫn viết theo giả định cũ và cần đọc với lưu ý này.

## 0. Bối cảnh và giả định nền

Từ câu trả lời của bạn ở vòng câu hỏi Phase 2:

| Quyết định | Giá trị |
|---|---|
| Chiến lược triển khai | **2 giai đoạn**: (1) web thường trên trình duyệt trước, (2) sau đó nhúng vào super-app dạng mini-app (như miniapp đặt cơm, miniapp dự đoán bóng đá) |
| Nền tảng | Android + iOS (cho giai đoạn 2) |
| Backend | Go |
| Backend production host | **Chưa có** — xác nhận lại lần 2, chưa thể điền `server-list.json` (xem mục 5) |
| Quy mô hiện tại | ~~Thử nghiệm nội bộ (vài chục–vài trăm user)~~ — **sai, xem đính chính ở đầu tài liệu**: công cụ vận hành mạng, phát qua super-app |
| Frontend framework | **Vue 3 + Vite** — xác nhận, chưa triển khai |
| Mini-app bridge | **WindVane** — xác nhận. Nền tảng LaoApp/`MiniappSDK` **ngoài phạm vi**, không tích hợp |

Mô hình mini-app đã được xác nhận (không còn là giả định): super-app của Unitel host mini-app qua **WebView + JS bridge WindVane**, không phải mô hình WeChat (ngôn ngữ template riêng WXML/WXSS). Xác nhận bằng cách đọc trực tiếp 1 mini-app speedtest tham khảo do bạn cung cấp (Vue 3 + WindVane, hoạt động thật cho Unitel) — chi tiết ở [docs/bridge.md](bridge.md). **Chưa có bất kỳ dòng code nào từ project tham khảo được đưa vào repo này** — bridge.md chỉ ghi lại các fact đã xác nhận để dùng khi thật sự bắt tay implement (Phase 5/6).

## 1. Nguyên tắc thiết kế cho giai đoạn này

Vì quy mô là thử nghiệm nội bộ, kiến trúc dưới đây **cố tình tối giản hơn** so với đề xuất "production 100k user" ở Phase 1 (§21). Không dựng Redis, không dựng Control API động, không multi-region — những thứ đó chỉ đáng làm khi có audience thật. Mọi quyết định đều đánh dấu rõ "khi nào cần nâng cấp".

Điểm mấu chốt: **engine đo (`speedtest_worker.js`) và contract endpoint không đổi giữa 2 giai đoạn.** Việc làm bản web trước không phải là công sức bỏ đi — nó chạy thẳng vào giai đoạn mini-app sau này, chỉ cần thêm lớp bridge, không viết lại phần đo.

## 2. Kiến trúc 2 giai đoạn

### Giai đoạn 1 — Web (hiện tại)

```
Trình duyệt (Android/iOS/desktop) — HTTPS thật
        │
        ▼
  speedtest.js / speedtest_worker.js   ← ĐÃ vá xong (settings, ping timing, worker leak)
        │  XHR GET/POST
        ▼
  Backend Go (speedtest-go, xem mục 3)
        │
        ├─ /garbage.php  (download)
        ├─ /empty.php    (upload + ping)
        └─ /getIP.php    (IP/ISP)
```

Không cần WebViewAssetLoader, không cần JS bridge, không cần lo `file://` — vì đây là trang web thật chạy trong trình duyệt qua HTTPS bình thường. Toàn bộ rủi ro WebView ở Phase 1 (§11) **chưa áp dụng ở giai đoạn này**.

### Giai đoạn 2 — Mini-app trong super-app (sau)

```
Super-app Unitel (Android/iOS)
        │
        ▼
  Mini-app runtime (WebView do super-app cấp)
        │
        ├─ WindVane SDK (xác nhận — CDN alicdn.com, xem docs/bridge.md)
        │     window.WindVane.call(namespace, method, params, ok, err)
        │     → loại mạng (WVNetwork), vị trí (WVLocation), lưu trữ (WVStorage),
        │       chọn contact (WVContacts), đóng mini-app (WVMiniApp.close)
        │
        ▼
  Vue 3 UI (xác nhận framework, chưa code)
        │
        ▼
  CÙNG MỘT speedtest.js / speedtest_worker.js   ← không viết lại, load bằng <script> tag thường,
        │                                          không qua Vite bundle (đã xác nhận qua reference)
        ▼
  CÙNG MỘT backend Go   ← không đổi, chỉ scale lên nếu cần
```

Việc chuyển từ giai đoạn 1 sang 2 về lý thuyết chỉ là: thêm 1 lớp bridge mỏng gọi WindVane khi có (`window.WindVane` tồn tại), còn engine + backend giữ nguyên. Đây không còn là suy đoán — pattern này đã được xác nhận hoạt động thật trong reference project.

## 3. Backend — Go, dựa trên `speedtest-go`

Đã xác minh trực tiếp (không suy đoán) qua repo [librespeed/speedtest-go](https://github.com/librespeed/speedtest-go):

- Đang hoạt động (68 commit trên master), license LGPL-3.0 — tương thích với license hiện tại của project
- **Tương thích ngược với endpoint PHP hiện tại** (hỗ trợ suffix `.php`) — nghĩa là `speedtest_worker.js` không cần sửa gì để trỏ sang backend Go, chỉ đổi URL trong `server-list.json`
- Config bằng `settings.toml`, ví dụ thực tế (rút gọn từ repo):

```toml
bind_address=""
listen_port=8989
server_lat=1
server_lng=1
assets_path=""
database_type="memory"   # none/memory/bolt/mysql/postgresql/sqlite/mssql
enable_tls=false
enable_http2=false
```

> ⚠ Đây là ví dụ **của upstream**, không phải cấu hình deploy. `enable_tls=false` và `database_type="memory"` ở trên đều không dùng được cho test server thật — xem "Cấu hình đề xuất cho test server" ngay dưới.

- Docker sẵn có (`Dockerfile` ở root repo)

### ⚠ Một điểm bắt buộc phải giữ nguyên: `enable_http2=false`

`speedtest_worker.js` mở **5 kết nối download song song** để vượt giới hạn single-flow TCP (xem Phase 1 §20). Nếu bật HTTP/2, cả 5 stream sẽ bị multiplex vào **một** TCP connection — toàn bộ lợi ích multi-stream biến mất, kết quả đo sai mà không có lỗi nào hiện ra. `speedtest-go` mặc định tắt HTTP/2 — **không được bật** khi deploy, kể cả sau này.

### Cấu hình đề xuất cho test server

> **Đính chính 2026-08-28.** Bản trước của mục này khuyến nghị **1 instance đặt trong hạ tầng nội bộ Unitel**, `database_type="memory"` hoặc `"none"`, và ghi telemetry tắt mặc định. Cả ba đều không còn đúng:
>
> - **Vị trí** đổi vì quyết định "3 nhà mạng đo trên 3 máy khác nhau" (REQ-001, chốt 27/08). Máy đo nằm trên **mạng di động**, không nằm trong LAN Unitel — một server IP nội bộ hoặc sau VPN thì từ điện thoại **không tồn tại**.
> - **`database_type="none"`** mâu thuẫn với §4 bên dưới: giá trị đó tắt cả việc ghi lẫn trang thống kê. Hiện dùng `bolt`.
> - **Telemetry** hiện là `telemetry_level: "full"` trong `settings.json`, không còn `"off"`.

**Vị trí: công khai và trung lập.**

Test server là *đầu bên kia của phép đo* — con số trong báo cáo là tốc độ giữa điện thoại và **chính máy đó**. Hai ràng buộc, cả hai bắt buộc:

- **Truy cập được từ Internet công cộng.** Điện thoại đo bằng SIM Unitel / LTC / ETL, không nằm trong mạng nội bộ. IP `10.x` / `192.168.x` hoặc sau VPN là không dùng được.
- **Trung lập giữa ba nhà mạng.** Nếu server nằm trong mạng Unitel, máy Unitel đi **on-net** còn máy LTC/ETL phải qua **peering** ⇒ Unitel luôn thắng **vì cấu hình đo, không phải vì chất lượng mạng**, và phép so sánh mất ý nghĩa. Dữ liệu nPerf của đối tác xác nhận cách làm đúng: cả ba nhà mạng đều được đo tới cùng nhóm server trung lập (chủ yếu *LA LaoTelecom 10G — Vientiane*, cộng các pool tại Thái Lan) — **kể cả Unitel cũng được đo tới server của đối thủ**. Đó là chủ ý, không phải ngẫu nhiên.

Hệ quả: một DMZ công khai của Unitel vẫn còn thiên vị về tô-pô. Nó chỉ đủ cho báo cáo *riêng Unitel*, không đủ để so ba nhà mạng.

**HTTPS bắt buộc.** Trang miniapp do super-app phục vụ qua `https://`, và WebView chặn mọi tài nguyên `http://` (mixed content) — triệu chứng giống hệt "test server chết", nên rất dễ mất thời gian truy nhầm. Build cũng từ chối đóng gói khi `server-list.json` còn `http://` hoặc `localhost` (CHANGE-002).

**Băng thông của server là trần của phép đo.** Uplink 100 Mbps thì không bao giờ đo được quá 100 Mbps, và nhiều máy đo đồng thời còn chia nhau con số đó. Muốn đo 4G/5G có nghĩa thì cần **≥ 1 Gbps**. Ước tính lưu lượng (giả định 50 Mbps xuống / 10 Mbps lên, 12 giây mỗi chiều): khoảng **90 MB mỗi lần đo** ⇒ 100 lượt/ngày ≈ 9 GB/ngày. `garbage.php` có thể phục vụ tới 1 GiB mỗi request, nên rate limit của CHANGE-005 phải bật.

**Phần cấu hình còn lại:**

- `enable_http2=false` — xem cảnh báo ngay trên, không được bật kể cả sau này
- `database_type="bolt"` — xem §4, **không** dùng `"none"`
- `ALLOWED_ORIGINS` = origin của super-app; mặc định `*` chỉ hợp cho dev
- Hai tệp mẫu cho bài đo Web và Video (`docs/test-assets.md`) đặt cùng server, vì chúng phải đọc được cross-origin
- Vẫn 1 instance duy nhất: không cần load balancer, không cần multi-region ở quy mô này

### Chiến lược chuyển đổi (khuyến nghị cho Phase 3)

Chạy **song song** PHP (đang có) và Go (mới) trong cùng `docker-compose`, thêm 1 entry trong `server-list.json` trỏ sang Go, rồi so sánh kết quả đo giữa 2 backend trên cùng 1 link trước khi cắt hẳn sang Go. Đây là cách duy nhất để phát hiện sớm nếu Go re-implement sai lệch bất kỳ chi tiết nào của protocol (ví dụ cách đọc `ckSize`, cách trả `Cache-Control`).

**✅ Đã verify (không còn là khuyến nghị lý thuyết):** vendor thành submodule tại `backend-go/` (commit `59cff12`, tag `v1.1.6-2-g59cff12`), build local qua `docker-compose.backend-go.yml`. Chạy `speedtest.js`/`speedtest_worker.js` thật (bản đã vá) qua trình duyệt, chế độ cross-origin/MPOT thật (`addTestPoint` + `selectServer`), full test download/upload/ping hoàn tất sạch, `HTTP version: 1.1` xác nhận qua curl. **Chưa** thêm entry vào `server-list.json` chính (cần hostname thật, xem mục 5) — hiện chỉ dùng để dev/test local.

## 4. Thu thập kết quả — ĐÃ BẬT (sửa lại quyết định cũ)

> **Đính chính 2026-08-24.** Bản trước của mục này ghi "cố tình CHƯA xây" phần thu thập kết quả, dựa trên giả định dự án là *thử nghiệm nội bộ vài chục user*. Giả định đó **sai**. Mục đích thật: miniapp chạy trong super-app Unitel để **phòng ban vận hành mạng** kiểm tra chất lượng mạng đang phục vụ khách hàng. Với mục đích đó, dữ liệu kết quả **là sản phẩm chính**, không phải thứ phụ tuỳ chọn — nếu kết quả chỉ nằm trong `localStorage` của từng máy thì phòng vận hành không có gì để xem.

Đã bật, không phải xây mới — `speedtest-go` có sẵn:

| Endpoint | Dùng để |
|---|---|
| `POST /results/telemetry.php` | Client gửi kết quả sau mỗi lần đo |
| `GET /stats.php` | Trang tra cứu cho phòng vận hành (có đăng nhập) |
| `GET /results/json.php?id=<id>` | Đọc 1 kết quả dạng JSON |

Cấu hình nằm ở [docker/backend-go.settings.toml](../docker/backend-go.settings.toml) trong repo này (không patch vào submodule), mount vào container qua [docker-compose.backend-go.yml](../docker-compose.backend-go.yml).

### Ba điểm bắt buộc, đã xử lý

1. **`url_telemetry` phải là URL tuyệt đối trỏ vào test server.** Mặc định của engine là đường dẫn *tương đối* `results/telemetry.php` ([speedtest_worker.js:71](../speedtest_worker.js:71)), và `speedtest.js` viết lại `url_dl`/`url_ul`/`url_ping`/`url_getIp` theo server đã chọn nhưng **cố tình bỏ qua cái này**. Trong miniapp, trang do super-app phục vụ ⇒ kết quả sẽ POST vào super-app, nơi không có endpoint đó, và **không có lỗi nào người dùng thấy được**. `ui/src/state/test.js` set lại giá trị này theo server đã chọn.

2. **`statistics_password` không được để mặc định.** [backend-go/results/stats.go:54](../backend-go/results/stats.go:54): nếu giá trị vẫn là chuỗi `"PASSWORD"`, trang thống kê được phục vụ **không cần đăng nhập** — tức toàn bộ DB kết quả kèm IP và ISP ai cũng xem được. Compose file bắt buộc truyền qua biến môi trường `SPEEDTEST_STATISTICS_PASSWORD`, không nhận giá trị mặc định.

3. **`database_type` không được để `"none"`.** Giá trị đó tắt cả việc ghi lẫn trang thống kê. Hiện dùng `bolt` (embedded, thuần Go — image build với `CGO_ENABLED=0` nên `sqlite` không chạy được). Chuyển sang `postgresql`/`mysql` khi cần truy vấn ngoài trang stats, hoặc khi có nhiều hơn một test server cùng ghi.

### Hình dạng bản ghi

Đã verify thật (đọc trực tiếp từ bolt DB sau một lần đo): tốc độ down/up, ping, jitter, IP, ISP, thời điểm, cộng với `telemetry_extra` chứa loại mạng, ngôn ngữ giao diện, user agent và tên test server.

Lưu ý về hình dạng: engine bọc thêm một lớp, nên `extra` lưu xuống DB có dạng `{"server":"...","extra":"<chuỗi JSON của client>"}` — phải parse hai lần. Đây là hành vi của `speedtest.js`, không phải lỗi cấu hình.

### Còn thiếu: định danh thuê bao

**Chưa có ISDN/số thuê bao** — thứ phòng vận hành cần để nối một kết quả với một đường dây cụ thể. Chưa thêm vì cách lấy ISDN chưa xác nhận được (xem [bridge.md](bridge.md) — `wv.getAuthCode` không có trong tài liệu WindVane công khai). `telemetry_extra` là chỗ để cắm vào khi có câu trả lời từ đội super-app.

### Control API động — vẫn chưa xây

Phase 1 (§21) đề xuất thêm một Control API động (`/servers`, `/session`) cho kịch bản scale lớn. Phần đó **vẫn chưa cần**: `server-list.json` tĩnh đủ dùng khi số test point còn ít. Ngưỡng để quay lại: khi danh sách test point cần đổi thường xuyên hơn tốc độ deploy, hoặc khi cần rate-limit/token theo phiên (Phase 9).

## 4b. Độ trễ khi có tải và tỷ lệ thăm dò thất bại

Ping lúc rảnh trả lời "máy chủ ở xa bao nhiêu". Nó **không** trả lời câu hỏi phòng vận hành thật sự cần: đường truyền có còn dùng được khi đang tải hay không. Một đường báo 100 Mbps, ping 20ms lúc rảnh, nhưng vọt lên 800ms ngay khi bắt đầu tải, là đường **hỏng** với gọi thoại và họp video — mà con số lúc rảnh vẫn báo là khoẻ mạnh. Đây là bufferbloat, và muốn thấy nó thì phải đo *trong lúc* truyền.

Bật/tắt bằng `loaded_latency` trong `settings.json` (mặc định bật), cùng `loaded_latency_interval` (250ms) và `loaded_latency_timeout` (2000ms).

### Ba quyết định thiết kế, đều có lý do

**1. So sánh trung bình với trung bình.** `pingStatus` báo giá trị **nhỏ nhất** trong các mẫu lúc rảnh — đúng cho câu hỏi "đường này tốt nhất được bao nhiêu", nhưng lấy một giá trị nhỏ nhất trừ đi một trung bình sẽ thổi phồng mức tăng. Vì vậy engine bổ sung `idlePingAvgStatus` chỉ để làm mốc so sánh cùng loại thống kê. `pingStatus` giữ nguyên, không đổi hành vi cũ.

**2. Dành riêng một khe kết nối cho gói thăm dò.** Trình duyệt giới hạn 6 kết nối đồng thời trên mỗi host (Chrome, Firefox, Safari như nhau). Nếu download mở đủ 6 luồng thì gói thăm dò phải xếp hàng trong chính trình duyệt — nó vẫn ra một con số, nhưng đó là **độ trễ hàng đợi của trình duyệt**, không phải độ trễ của mạng, tức đúng thứ phép đo này sinh ra để tìm. Nên khi bật `loaded_latency`, `xhr_dlMultistream` bị chặn tối đa ở 5. Chrome vốn đã dùng 5 theo quirks, nên trên engine quan trọng nhất (WebView) điều này **không đổi gì cả**.

**3. Một gói thăm dò tại một thời điểm.** Gói kế tiếp chỉ được hẹn sau khi gói trước kết thúc. Bắn song song sẽ tranh kết nối với chính các luồng truyền và đo ra mức tranh chấp đó thay vì mạng.

### ⚠ Về con số "thăm dò thất bại"

Cái được đếm là **tỷ lệ request thất bại hoặc quá hạn**, không phải bộ đếm mất gói IP. TCP truyền lại ở tầng dưới, nên một đường thật sự rớt vài phần trăm gói vẫn thường hoàn tất mọi request, chỉ chậm hơn — và con số này sẽ đọc ra `0.00%`. Nó chỉ nhúc nhích khi mất gói đủ nặng, hoặc độ trễ đủ dài, để cả một request không kịp hoàn tất trong `loaded_latency_timeout`.

Nói cách khác: **số cao là bằng chứng mạnh có vấn đề; số 0 KHÔNG phải bằng chứng đường sạch.** Vì thế giao diện luôn hiện kèm số lượng mẫu — để không ai đọc "0.00%" rút từ 40 mẫu như một bảo đảm ở tầng liên kết.

Muốn đo mất gói đúng nghĩa thì cần đo ở tầng thấp hơn HTTP, việc mà JavaScript trong trình duyệt không làm được. Nếu phòng vận hành cần con số thật, đó phải là một phép đo phía hạ tầng (ICMP/UDP từ probe đặt trong mạng), không phải từ miniapp.

### Chưa xác minh được: ảnh hưởng lên số đo throughput

Việc thêm gói thăm dò về lý thuyết có thể làm giảm throughput đo được. Đã thử A/B trên backend Go chạy local (loopback): bật probe cho 8449/8767/9272/9418 Mbps, tắt probe cho 10566/9692/9039 Mbps. **Nhưng độ dao động giữa các lần chạy cùng cấu hình đã tới ~15%**, lớn hơn chênh lệch giữa hai nhóm — nên môi trường loopback ở ~10 Gbps **không đủ ổn định để phân giải câu hỏi này**.

Cái có thể khẳng định: trên Chrome số luồng download không đổi (quirks vốn đã đặt 5), và lưu lượng thêm vào là ~90 request rỗng trong 24 giây, không đáng kể so với hàng GB dữ liệu đo.

Cái chưa khẳng định được: ảnh hưởng trên một đường truyền thật, tốc độ vừa phải. Cần A/B trên hạ tầng Unitel thật — **cùng điều kiện tiên quyết với việc hiệu chuẩn `overheadCompensationFactor`** (xem [overhead-calibration.md](overhead-calibration.md)). Làm hai việc này trong cùng một đợt khi có server thật.

## 5. Danh sách test point

`server-list.json` hiện tại trỏ tới 37 server cộng đồng LibreSpeed quốc tế (Amsterdam, LA, Prague...) — **phải thay** trước khi dùng cho Unitel, kể cả ở giai đoạn thử nghiệm nội bộ, vì nếu không sẽ đo tốc độ tới hạ tầng nước ngoài chứ không phải mạng Unitel.

**Cần từ bạn:** hostname/IP nội bộ nơi sẽ đứng backend Go thử nghiệm. Chưa có thông tin này nên chưa thể điền vào `server-list.json`.

## 6. Bridge — WindVane

Contract đầy đủ (cách nạp SDK, calling convention, bảng API namespace/method đã xác nhận, điểm lệch với reference project, ràng buộc không dùng vue-router) đã tách sang **[docs/bridge.md](bridge.md)**.

Tóm tắt: bridge là **WindVane** (không phải MiniappSDK/LaoApp — ngoài phạm vi), gọi qua `window.WindVane.call(namespace, method, params, onSuccess, onError)`, script nạp từ CDN `alicdn.com`. Xác nhận có API loại mạng (`WVNetwork.getNetworkType`), vị trí, lưu trữ, contact picker, đóng mini-app (`WVMiniApp.close`, không phải `WVBase.closePage` như reference dùng sai). Còn 1 điểm chưa xác nhận: cách lấy ISDN đúng chuẩn (mục 9 dưới).

## 7. Bảo mật

> **Đính chính 2026-08-28.** Bản trước của mục này ghi *"chấp nhận tạm thời: giữ nguyên `Access-Control-Allow-Origin: *` — chưa cần allowlist origin vì chưa public"*, *"chưa cần rate-limiting"*, và khuyến nghị *"đặt sau VPN nội bộ Unitel"*. Cả ba đều không còn đúng: hai hạng mục đầu **đã được triển khai** (CHANGE-005, CHANGE-006), và VPN nội bộ mâu thuẫn với yêu cầu test server công khai ở §3. Nguy hiểm hơn §3: ai đọc bản cũ có thể **tắt allowlist đi** vì tin rằng "chưa cần".

### Đã có, đã chạy thử

| Hạng mục | Ở đâu | Thực tế |
|---|---|---|
| Allowlist origin | `backend/cors_util.php`, biến `ALLOWED_ORIGINS` | Origin ngoài danh sách nhận **403 và 19 byte** thay vì cả payload — chặn *trước khi* stream. Bỏ trống nghĩa là `*`, chỉ hợp cho dev |
| Rate limit | `docker/nginx-speedtest.conf` | `limit_conn 12`/IP, `limit_req 30r/s burst=120`, trả **429**. Đường ghi kết quả (`results/telemetry.php`) chặt hơn: `burst=5` |
| Trần dung lượng | `backend/garbage.php` | `ckSize` bị kẹp ở **1024 MiB** — tối đa 1 GiB mỗi request |
| Mật khẩu thống kê | `docker/entrypoint.sh` | Container **từ chối khởi động** nếu bật telemetry với mật khẩu rỗng hoặc phổ biến |
| Trang thống kê | `docker/nginx-speedtest.conf` | `stats.php` giới hạn theo IP — trang này liệt kê IP và ISP của từng khách |

**Cố ý KHÔNG làm:** không đặt `limit_rate` / `limit_rate_after` lên endpoint đo. Bóp băng thông ở proxy chính là bóp đại lượng đang đo — kết quả sai mà không có lỗi nào hiện ra. Cảnh báo này nằm ngay trong `nginx-speedtest.conf`.

### ⚠ Ba chỗ hở nếu deploy backend Go ra Internet

§3 khuyến nghị dùng backend Go, nhưng **mọi biện pháp ở bảng trên đều thuộc bản PHP + nginx**. `docker-compose.backend-go.yml` phơi thẳng cổng 8989, không có proxy nào phía trước:

1. **Không có rate limit nào trong `backend-go/`.** Phơi thẳng ra Internet là một máy khuếch đại băng thông mở, không xác thực.
2. **Allowlist origin không áp dụng được.** `backend-go/web/web.go` hard-code `AllowedOrigins: []string{"*"}`; `ALLOWED_ORIGINS` là biến của bản PHP, Go không đọc.
3. **`stats.php` của Go không bị giới hạn IP** — có mật khẩu (compose bắt buộc `SPEEDTEST_STATISTICS_PASSWORD`), nhưng trang liệt kê IP/ISP của từng phép đo vẫn phơi ra Internet.

**Đã xử lý (28/08).** `docker-compose.backend-go.yml` nay dựng nginx phía trước; cổng 8989 **không còn được publish**, backend-go chỉ `expose` trong mạng nội bộ của compose. Cấu hình ở `docker/nginx-backend-go.conf`, dùng chung phần giới hạn với bản host qua `docker/speedtest_limits.conf`.

Đã kiểm chứng bằng stack chạy thật, không phải suy luận:

| Kiểm tra | Kết quả |
|---|---|
| 3 endpoint đo qua proxy | 200; `garbage.php?ckSize=1` trả đúng 1 MiB |
| Header CORS | **đúng 1** `Access-Control-Allow-Origin` — Go gửi `*`, nginx gỡ đi rồi phát lại theo allowlist. Hai header thì trình duyệt chặn sạch |
| Preflight `OPTIONS` | 204 kèm CORS, nginx tự trả chứ không đẩy lên Go |
| Allowlist origin | Nhận origin đúng; chặn `evil.example` **và** `app.unitel.com.la.evil.example` |
| `stats.php`, `results/json.php` | 403 |
| `/`, trang ví dụ của Go | 404 |
| Rate limit | 250 request dồn dập → 16 nhận **429** |
| `X-Forwarded-For` | Go thấy IP client thật (172.20.0.1), không phải IP nginx (172.20.0.3) — sai chỗ này thì mọi bản ghi bị gán nhầm nhà mạng |
| Mẫu Web | `browse-sample.html` chạy suốt stack, 1.048.576 byte, không nén |

⚠ Khi đặt `SPEEDTEST_ALLOWED_ORIGIN_REGEX`, viết dấu chấm là `[.]` chứ đừng `\\.`: Git Bash trên Windows đổi `\` thành `/` trên đường vào docker, regex thành vô nghĩa và **chặn mọi origin, kể cả origin đúng**.

### Việc phải làm khi lên server công khai

- Đặt `ALLOWED_ORIGINS` = origin của super-app (bản PHP), hoặc lọc origin ở nginx (bản Go)
- Thay `allow 10.0.0.0/8` trong `nginx-speedtest.conf` bằng **dải mạng thật của phòng vận hành** — dải nội bộ đó sẽ không khớp ai trên server công khai
- Đặt mật khẩu thống kê thật; cả hai backend đều từ chối chạy với mật khẩu mặc định
- Toàn bộ qua HTTPS (§3)

## 8. Thay đổi cụ thể trong repo (đầu vào cho Phase 3)

- ✅ **Xong** — `backend-go/` là git submodule trỏ tới `librespeed/speedtest-go` (không tách repo riêng, không copy phẳng — dùng submodule để dễ theo dõi version upstream và không trộn lịch sử 2 project)
- ✅ **Xong** — `docker-compose.backend-go.yml` ở root (file compose dev riêng, chưa gộp vào `tests/docker-compose-playwright.yml` vì đây chưa phải một phần của bộ e2e test chính thức)
- ⬜ Cập nhật `server-list.json` khi có hostname thật từ bạn — vẫn chờ (mục 5, mục 9)
- ⬜ Chưa quyết định: có đưa `backend-go` vào `tests/docker-compose-playwright.yml` để chạy trong CI e2e không, hay giữ tách biệt như hiện tại

## 9. Việc cần bạn xác nhận trước khi sang Phase 3

1. **Hostname/IP nội bộ** cho backend Go thử nghiệm — xác nhận lại là **chưa có**. Phase 3 chưa thể deploy thật tới khi có thông tin này; `server-list.json` vẫn đang trỏ tới 37 server cộng đồng LibreSpeed (mục 5).
2. ~~Tên/tài liệu SDK của super-app Unitel~~ — **Đã xác nhận: WindVane**, có tài liệu chính thức ([docs/bridge.md](bridge.md)). ~~Network info~~ — **đã xác nhận có** (`WVNetwork.getNetworkType`). Câu hỏi con còn lại: **cách lấy ISDN đúng chuẩn** — reference dùng namespace `wv.getAuthCode` không có trong tài liệu công khai, nhiều khả năng là API riêng đội superapp Unitel cấp thêm, cần hỏi trực tiếp đội đó để xác nhận (không suy đoán từ reference — xem "Điểm lệch" trong bridge.md).
3. **Có giữ UI classic (`index-classic.html`, `design-switch.js`) không, hay chỉ dùng 1 UI duy nhất cho sản phẩm Unitel?** Giờ đã rõ hơn: frontend đích là Vue 3, khác hẳn cả 2 UI vanilla-JS hiện tại — nên câu hỏi thực chất là "khi nào retire UI vanilla-JS hiện tại, có cần chạy song song với UI Vue mới một thời gian không". Vẫn là quyết định sản phẩm, để bạn chốt khi bắt đầu Phase 5.

## 10. Không nằm trong tài liệu này

Theo roadmap gốc, Phase 2 có đề cập tạo thêm `docs/api.openapi.yaml` và `docs/bridge.md`.

- `docs/api.openapi.yaml`: **vẫn cố tình chưa viết** — Control API động chưa tồn tại (mục 4), viết trước sẽ là nội dung tưởng tượng.
- `docs/bridge.md`: **đã tách ra thành file riêng** — xem [docs/bridge.md](bridge.md).
