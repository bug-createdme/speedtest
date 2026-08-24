# Kiến trúc Speedtest Unitel — Phase 2

Trạng thái: **Draft — bridge WindVane đã xác nhận với tài liệu chính thức; còn 2 mục mở ở phần "Việc cần bạn xác nhận"**
Ngày: 2026-08-24

## 0. Bối cảnh và giả định nền

Từ câu trả lời của bạn ở vòng câu hỏi Phase 2:

| Quyết định | Giá trị |
|---|---|
| Chiến lược triển khai | **2 giai đoạn**: (1) web thường trên trình duyệt trước, (2) sau đó nhúng vào super-app dạng mini-app (như miniapp đặt cơm, miniapp dự đoán bóng đá) |
| Nền tảng | Android + iOS (cho giai đoạn 2) |
| Backend | Go |
| Backend production host | **Chưa có** — xác nhận lại lần 2, chưa thể điền `server-list.json` (xem mục 5) |
| Quy mô hiện tại | Thử nghiệm nội bộ (vài chục–vài trăm user) |
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

- Docker sẵn có (`Dockerfile` ở root repo)

### ⚠ Một điểm bắt buộc phải giữ nguyên: `enable_http2=false`

`speedtest_worker.js` mở **5 kết nối download song song** để vượt giới hạn single-flow TCP (xem Phase 1 §20). Nếu bật HTTP/2, cả 5 stream sẽ bị multiplex vào **một** TCP connection — toàn bộ lợi ích multi-stream biến mất, kết quả đo sai mà không có lỗi nào hiện ra. `speedtest-go` mặc định tắt HTTP/2 — **không được bật** khi deploy, kể cả sau này.

### Cấu hình đề xuất cho giai đoạn thử nghiệm nội bộ

- `database_type="memory"` hoặc `"none"` — không cần Postgres/MySQL cho pilot, telemetry tắt mặc định (khớp `settings.json` hiện tại: `telemetry_level: "off"`)
- 1 instance duy nhất, đặt trong hạ tầng nội bộ Unitel
- Không cần load balancer, không cần multi-region ở quy mô này

### Chiến lược chuyển đổi (khuyến nghị cho Phase 3)

Chạy **song song** PHP (đang có) và Go (mới) trong cùng `docker-compose`, thêm 1 entry trong `server-list.json` trỏ sang Go, rồi so sánh kết quả đo giữa 2 backend trên cùng 1 link trước khi cắt hẳn sang Go. Đây là cách duy nhất để phát hiện sớm nếu Go re-implement sai lệch bất kỳ chi tiết nào của protocol (ví dụ cách đọc `ckSize`, cách trả `Cache-Control`).

**✅ Đã verify (không còn là khuyến nghị lý thuyết):** vendor thành submodule tại `backend-go/` (commit `59cff12`, tag `v1.1.6-2-g59cff12`), build local qua `docker-compose.backend-go.yml`. Chạy `speedtest.js`/`speedtest_worker.js` thật (bản đã vá) qua trình duyệt, chế độ cross-origin/MPOT thật (`addTestPoint` + `selectServer`), full test download/upload/ping hoàn tất sạch, `HTTP version: 1.1` xác nhận qua curl. **Chưa** thêm entry vào `server-list.json` chính (cần hostname thật, xem mục 5) — hiện chỉ dùng để dev/test local.

## 4. Control API — cố tình CHƯA xây

Phase 1 (§21) có đề xuất một "Control API" động (`/servers`, `/session`, `/results`) cho kịch bản scale lớn. **Ở quy mô thử nghiệm nội bộ hiện tại, không xây cái này** — mô hình JSON tĩnh sẵn có (`server-list.json`, `settings.json`) đã đủ dùng và đã chứng minh chạy đúng (verify bằng Docker + Playwright ở phiên làm việc trước).

Ngưỡng để quay lại xây Control API động: khi danh sách test-point cần thay đổi thường xuyên hơn tốc độ deploy lại, hoặc khi cần rate-limit/token theo từng phiên (Phase 9, quy mô public).

## 5. Danh sách test point

`server-list.json` hiện tại trỏ tới 37 server cộng đồng LibreSpeed quốc tế (Amsterdam, LA, Prague...) — **phải thay** trước khi dùng cho Unitel, kể cả ở giai đoạn thử nghiệm nội bộ, vì nếu không sẽ đo tốc độ tới hạ tầng nước ngoài chứ không phải mạng Unitel.

**Cần từ bạn:** hostname/IP nội bộ nơi sẽ đứng backend Go thử nghiệm. Chưa có thông tin này nên chưa thể điền vào `server-list.json`.

## 6. Bridge — WindVane

Contract đầy đủ (cách nạp SDK, calling convention, bảng API namespace/method đã xác nhận, điểm lệch với reference project, ràng buộc không dùng vue-router) đã tách sang **[docs/bridge.md](bridge.md)**.

Tóm tắt: bridge là **WindVane** (không phải MiniappSDK/LaoApp — ngoài phạm vi), gọi qua `window.WindVane.call(namespace, method, params, onSuccess, onError)`, script nạp từ CDN `alicdn.com`. Xác nhận có API loại mạng (`WVNetwork.getNetworkType`), vị trí, lưu trữ, contact picker, đóng mini-app (`WVMiniApp.close`, không phải `WVBase.closePage` như reference dùng sai). Còn 1 điểm chưa xác nhận: cách lấy ISDN đúng chuẩn (mục 9 dưới).

## 7. Bảo mật cho giai đoạn thử nghiệm nội bộ

Ở quy mô này, chấp nhận tạm thời:
- Giữ nguyên `Access-Control-Allow-Origin: *` — chưa cần allowlist origin vì chưa public
- Chưa cần rate-limiting

**Điều kiện bắt buộc trước khi sang giai đoạn 2 (nhúng vào super-app, có user thật):** phải chạy Phase 9 (Security) — allowlist CORS, rate limit cơ bản. Không được mang nguyên trạng bảo mật của giai đoạn thử nghiệm sang giai đoạn public.

Khuyến nghị thêm cho giai đoạn 1: đặt sau VPN nội bộ Unitel hoặc URL không công khai/không index, chưa gắn link từ trang chính thức.

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
