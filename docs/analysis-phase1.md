# Phân tích Phase 1 — Speedtest Unitel

> Tài liệu phân tích kiến trúc do Phase 1 sinh ra (roadmap §22, spec UI §13, accuracy §10, WebView compat §11).
> Trước đây chỉ tồn tại trong transcript hội thoại; đưa vào repo ngày 2026-08-24 để Phase 3–10 tham chiếu được.
> Nội dung giữ nguyên, chỉ chỉnh đường dẫn link tương đối cho phù hợp vị trí file.

---

Đã đọc xong toàn bộ source. Dưới đây là phân tích dựa trên code thực tế, không suy đoán.

---

# 1. EXECUTIVE SUMMARY

**Phát hiện quan trọng đầu tiên:** Folder `C:\Project Unitel\speedtest` **là một bản clone nguyên vẹn của upstream LibreSpeed v6.2.1**, chưa có bất kỳ tuỳ biến nào cho Unitel.

- `git remote -v` → `https://github.com/librespeed/speedtest.git`
- Commit HEAD `04cdce6` trùng upstream master, working tree sạch
- `grep -ri unitel` chỉ trúng **1 file nhị phân**: `backend/country_asn.mmdb` (tên ASN trong DB GeoIP), không phải code

⇒ Mọi kết luận dưới đây là về **LibreSpeed thuần**, và mọi việc branding/tuỳ biến cho Unitel vẫn còn nguyên phía trước.

**Trả lời câu hỏi trung tâm của bạn:**

> "Project hiện tại có đủ tốt để đưa lên WebView chưa?"

**Chưa — nhưng rất gần.** Engine đo (`speedtest_worker.js`) là nền tảng tốt, đã production-proven nhiều năm. Tuy nhiên có **4 blocker thực sự** cho WebView + **3 lỗi làm sai lệch số đo** đang tồn tại trong chính config mà repo này ship:

| # | Vấn đề | File | Mức |
|---|---|---|---|
| 1 | Web Worker **không khởi tạo được** từ `file://` trong Chromium/WebView → phải serve qua http(s) hoặc `WebViewAssetLoader` | [speedtest.js:322](../speedtest.js:322) | 🔴 Critical |
| 2 | `settings.json` đặt `time_dlGraceTime: 0` và `time_ulGraceTime: 0` → **bỏ warm-up TCP** ⇒ DL bị đo thiếu, UL bị đo thừa | [settings.json](../settings.json) | 🔴 Critical |
| 3 | `test_order: "ID_U_P"` → **Ping đo SAU cùng**, khi link vừa bão hoà ⇒ đo phải bufferbloat, không so sánh được với speedtest.net | [settings.json](../settings.json) | 🔴 Critical |
| 4 | Ping dùng `performance.getEntries()` lấy **entry cuối cùng** — buffer Resource Timing mặc định chỉ 250 entry, download/upload đã làm tràn ⇒ ping đọc nhầm entry rác | [speedtest_worker.js:625](../speedtest_worker.js:625) | 🔴 Critical |
| 5 | Cross-origin upload: mỗi POST bị **preflight OPTIONS riêng** (URL random + không có `Access-Control-Max-Age`) | [backend/empty.php:5](../backend/empty.php:5) | 🟠 High |
| 6 | `responseType="arraybuffer"` + `ckSize=100` ⇒ đỉnh RAM tới ~500 MB trên link nhanh → OOM trên mobile WebView | [speedtest_worker.js:374](../speedtest_worker.js:374) | 🟠 High |
| 7 | `Worker` **không bao giờ được `terminate()`** → rò thread mỗi lần test lại | [speedtest.js:322](../speedtest.js:322) | 🟠 High |

**Khuyến nghị chiến lược:** giữ nguyên `speedtest_worker.js` làm engine (đã kiểm chứng), **thay thế hoàn toàn tầng UI**, thay backend PHP bằng Go/Rust khi scale > 1.000 concurrent, và tuyệt đối **không dùng `file://`** cho WebView.

---

# 2. PROJECT ARCHITECTURE

Kiến trúc thực tế trong source — không có Node backend, không có WebSocket, không có DB bắt buộc:

```
┌──────────────── BROWSER / WEBVIEW ────────────────┐
│                                                    │
│  index.html  (chỉ là redirector)                   │
│      │ sync XHR config.json  ← BLOCKING            │
│      ├──► index-classic.html   (mặc định)          │
│      └──► index-modern.html    (khi useNewDesign)  │
│                    │                               │
│              speedtest.js  (main thread)           │
│              • FSM 5 state (0→1→2→3→4)             │
│              • Server selection (ping 3 lần/server)│
│              • Poll worker mỗi 200ms               │
│                    │ postMessage                   │
│              ┌─────▼──────────────────┐            │
│              │ speedtest_worker.js    │ Web Worker │
│              │ XHR-only engine        │            │
│              │ I → P → D → U          │            │
│              └─────┬──────────────────┘            │
└────────────────────┼───────────────────────────────┘
                     │ HTTP/1.1 hoặc HTTP/2, không WS
       ┌─────────────┼──────────────┬───────────────┐
       ▼             ▼              ▼               ▼
  garbage.php    empty.php      getIP.php     telemetry.php
  (download)   (upload+ping)   (IP/ISP)        (optional)
       │                            │               │
       │                       ipinfo.io       PDO → SQLite/
       │                    hoặc mmdb offline   MySQL/PgSQL/MSSQL
```

**Điểm cốt lõi cần nhớ:** đây là kiến trúc **stateless, không API, không session**. Không có "API layer" nào cả — frontend gọi thẳng 4 endpoint PHP. Đây vừa là điểm mạnh (đơn giản, scale ngang dễ) vừa là điểm yếu (không rate-limit được, không có server discovery động).

---

# 3. FOLDER STRUCTURE

```
speedtest/
├── index.html                    # Redirector (sync XHR + window.location)
├── design-switch.js              # Logic chọn design, XHR ĐỒNG BỘ (blocking)
├── config.json                   # { "useNewDesign": false }
├── settings.json                 # Override worker settings (CHỈ modern UI đọc)
├── server-list.json              # 37 server cộng đồng LibreSpeed toàn cầu
│
├── speedtest.js          (17KB)  # ★ API chính, FSM, server selection
├── speedtest_worker.js   (29KB)  # ★ ENGINE ĐO — trái tim của project
├── stability_worker.js   (7KB)   # Engine đo ổn định kết nối (ping liên tục)
│
├── index-classic.html    (18KB)  # UI cũ: canvas gauge, JS inline, mặc định
├── index-modern.html     (5KB)   # UI mới: DOM/CSS gauge
├── stability.html        (32KB)  # Trang stability test + chart + CSV export
│
├── frontend/                     # Asset của UI modern
│   ├── index.html                # ⚠ BẢN SAO CŨ, BỊ HỎNG (xem §16)
│   ├── javascript/index.js (473L)# Bootstrap UI modern, render loop rAF
│   ├── styling/*.css     (1320L) # 7 file, dùng CSS NESTING (⚠ WebView cũ)
│   ├── fonts/*.woff2     (123KB) # Inter
│   └── images/                   # background.jpeg 172KB + background-original 1.2MB (rác)
│
├── backend/                      # ★ Test endpoints (PHP)
│   ├── garbage.php               # Sinh dữ liệu random cho DL
│   ├── empty.php                 # 200 OK rỗng — dùng cho cả UL và PING
│   ├── getIP.php                 # IP + ISP + khoảng cách
│   ├── getIP_util.php            # Parse XFF/CF-Connecting-IP
│   ├── getIP_ipInfo_apikey.php   # ⚠ Nơi chứa API key (plaintext)
│   ├── country_asn.mmdb          # GeoIP offline (MaxMind format)
│   └── geoip2.phar               # Reader, chỉ dùng khi PHP ≥ 8.1
│
├── results/                      # Telemetry (TÙY CHỌN, mặc định TẮT)
│   ├── telemetry.php             # Nhận POST kết quả → DB
│   ├── telemetry_db.php          # PDO layer, 4 loại DB
│   ├── telemetry_settings.php    # ⚠ Credentials plaintext
│   ├── index.php                 # Sinh ảnh PNG chia sẻ kết quả (GD)
│   ├── json.php / stats.php      # API JSON + trang thống kê (password plaintext)
│   ├── idObfuscation.php         # Che ID để không đoán được test khác
│   └── telemetry_*.sql           # Schema cho MySQL/PgSQL/MSSQL
│
├── docker/
│   ├── entrypoint.sh     (237L)  # ★ Toàn bộ config bằng sed vào file tĩnh
│   ├── librespeed-php.ini        # post_max_size = 32M (BẮT BUỘC cho upload)
│   └── servers.json              # Template server list
│
├── examples/                     # 8 ví dụ tích hợp — tài liệu sống tốt nhất
├── tests/e2e/                    # 7 spec Playwright — CHỈ smoke test UI
├── Dockerfile / Dockerfile.alpine
└── doc.md (48KB) / doc_docker.md / DESIGN_SWITCH.md
```

**Nhận xét chức năng:**

- **`speedtest_worker.js` là tài sản giá trị nhất.** Toàn bộ logic đo nằm gọn trong 734 dòng, không dependency, chạy trong Worker riêng ⇒ có thể tái sử dụng nguyên vẹn cho WebView.
- **`results/` hoàn toàn tùy chọn** — `settings.json` mặc định `telemetry_level: "off"`. Nếu Unitel không cần lưu lịch sử, có thể bỏ cả thư mục này ⇒ không cần DB.
- **`docker/entrypoint.sh` config bằng `sed`** — đây là anti-pattern nghiêm trọng: mọi thay đổi cấu hình đều là *string replacement* trên HTML/PHP. Rất dễ vỡ khi bạn sửa HTML (xem §16).

---

# 4. TECHNOLOGY STACK

| Lớp | Công nghệ thực tế | Dùng để làm gì trong project |
|---|---|---|
| **Frontend language** | Vanilla JavaScript ES2015 (`.eslintrc.json` → `ecmaVersion: 2015`) | Không framework, không transpile, không bundler |
| **Frontend framework** | **KHÔNG CÓ** | UI viết tay bằng DOM API thuần |
| **Build tool** | **KHÔNG CÓ** | File tĩnh serve trực tiếp. Không webpack/vite/rollup |
| **Package manager** | npm — nhưng **chỉ cho devDependencies** | `DEVELOPMENT.md`: "core library has no runtime dependencies" |
| **Backend language** | PHP ≥ 5.4 (Docker dùng `php:8-apache`) | 4 script độc lập, không framework |
| **Backend framework** | **KHÔNG CÓ** (không Laravel/Symfony/Slim) | Mỗi endpoint là 1 file `.php` chạy độc lập |
| **Web server** | Apache 2 (Docker), nginx/IIS được support | `Dockerfile:1` → `php:8-apache` |
| **API technology** | **Không REST, không GraphQL.** HTTP thuần: `GET garbage.php`, `POST empty.php` | Endpoint là *kênh truyền tải*, không phải API dữ liệu |
| **WebSocket** | **KHÔNG CÓ** — và đây là chủ đích thiết kế | Tagline: *"No Flash, No Java, No Websockets"* |
| **Concurrency (client)** | Web Worker (1 dedicated worker) + XMLHttpRequest song song | Worker tách khỏi main thread để UI không chặn phép đo |
| **Concurrency (server)** | Apache prefork/mpm-event, PHP-FPM | Mỗi stream = 1 PHP process/thread |
| **Database** | PDO → SQLite (mặc định) / MySQL / PostgreSQL / MSSQL — **tùy chọn** | Chỉ để lưu telemetry. Không cần cho việc đo |
| **Runtime** | Trình duyệt + PHP-CLI/FPM. Node.js **chỉ dùng cho dev tooling** | `engines: node >= 14` chỉ để chạy eslint/prettier/playwright |
| **Docker** | Có — 2 image (Debian + Alpine), 4 mode: `standalone`/`backend`/`frontend`/`dual` | `docker/entrypoint.sh` |
| **CI** | GitHub Actions: `docker-publish.yml`, `playwright.yml`, `stale.yml` | Build weekly để cập nhật GeoIP DB |

**Third-party libraries — giải thích cụ thể từng cái:**

| Package | Version | Vai trò THỰC TẾ |
|---|---|---|
| `@playwright/test` | ^1.55.0 | E2E smoke test, chạy trên Chromium duy nhất. **Không test độ chính xác đo**, chỉ kiểm tra UI hiện ra và endpoint trả 200 |
| `eslint` | ^8.57.0 | Lint 3 file worker. Config `.eslintrc.json` là format eslint 8 (⚠ `npx eslint` sẽ kéo v10 và fail — phải `npm ci` trước) |
| `prettier` | ^3.1.1 | Format `*.js`. `DEVELOPMENT.md` ghi rõ: tuỳ chọn, không áp dụng lên code cũ |
| `geoip2.phar` | bundled | MaxMind DB Reader, **chỉ load khi `PHP_VERSION_ID >= 80100`** ([getIP.php:137](../backend/getIP.php:137)) |
| `country_asn.mmdb` | bundled | GeoIP offline — fallback khi không có ipinfo.io API key |
| Inter font | bundled woff2 | Font cho UI modern, 2 subset latin/latin-ext |

**Runtime dependencies của engine: 0.** Đây là điểm mạnh lớn nhất khi đưa lên WebView.

---

# 5. SPEEDTEST FLOW — TRACE TỪ "START"

Flow thực tế, dựng từ code:

```
[1] User mở https://speedtest.unitel.la/
     │
     ▼
[2] index.html tải design-switch.js
     │  ⚠ XHR ĐỒNG BỘ: xhr.open('GET','config.json', FALSE)   design-switch.js:40
     │  → chặn main thread cho tới khi có response
     ▼
[3] window.location.href = 'index-classic.html'  (hoặc modern)
     │  ⚠ ĐÂY LÀ NAVIGATION THỨ 2 — toàn bộ page load lại
     ▼
[4] Modern UI: DOMContentLoaded  →  frontend/javascript/index.js:26
     ├── createSpeedtest()        → new Speedtest()
     ├── hookUpButtons()
     ├── startRenderingLoop()     → requestAnimationFrame vòng lặp vô hạn
     ├── applySettingsJSON()      → fetch('settings.json') → setParameter() từng key
     └── applyServerListJSON()    → fetch('server-list.json') → 37 server
     │
     ▼
[5] SERVER SELECTION  (speedtest.js:selectServer, dòng 419)
     │  • Chia 37 server thành 6 nhóm (CONCURRENCY = 6)      speedtest.js:284
     │  • Mỗi nhóm duyệt TUẦN TỰ, mỗi server ping tối đa 3 lần  speedtest.js:236
     │  • Bỏ qua ngay nếu ping > 500ms (SLOW_THRESHOLD)      speedtest.js:237
     │  • Timeout 2000ms/ping                                speedtest.js:190
     │  • Lấy min(ping) làm pingT; chọn server pingT nhỏ nhất
     │  • Server khác protocol (http vs https) bị SKIP hoàn toàn  speedtest.js:242
     ▼
[6] state = READY  → nút hiện "Let's start"
     │
     ▼
[7] User bấm START  →  startButtonClickHandler()  →  speedtest.start()
     │
     ├── new Worker("speedtest_worker.js?r=<random>")        speedtest.js:322
     ├── setInterval(() => worker.postMessage("status"), 200) speedtest.js:342
     └── worker.postMessage("start " + JSON.stringify(settings)) speedtest.js:370
     │
     ▼
[8] WORKER: parse settings → áp browser quirks → runNextTest()  speedtest_worker.js:179
     │
     │  test_order từ settings.json = "ID_U_P"
     │  ┌──────────────────────────────────────────┐
     │  │ 'I' → getIp()      → GET  getIP.php      │  testState = 0
     │  │ 'D' → dlTest()     → GET  garbage.php ×5 │  testState = 1
     │  │ '_' → setTimeout(1000)                   │
     │  │ 'U' → ulTest()     → POST empty.php   ×3 │  testState = 3
     │  │ '_' → setTimeout(1000)                   │
     │  │ 'P' → pingTest()   → GET  empty.php  ×10 │  testState = 2
     │  └──────────────────────────────────────────┘
     ▼
[9] Main thread poll mỗi 200ms → worker trả JSON status
     │  { testState, dlStatus, ulStatus, pingStatus, jitterStatus,
     │    dlProgress, ulProgress, pingProgress, clientIp, testId }
     ▼
[10] onupdate(data) → testState.testDataDirty = true
     │  → rAF loop đọc cờ dirty → cập nhật DOM  frontend/javascript/index.js:373
     ▼
[11] testState >= 4 → clearInterval(updater) → onend(aborted)
     │  ⚠ Worker KHÔNG được terminate()
     ▼
[12] Nếu telemetry ON: POST results/telemetry.php → nhận "id <N>"
     │  → hiện nút Share → ảnh PNG tại results/?id=N
     ▼
[13] state = FINISHED → nút đổi thành "Restart"
```

**Điểm cần chú ý ngay:** flow chuẩn của LibreSpeed (`IP_D_U` = IP → **Ping** → Download → Upload) đã bị `settings.json` **đổi thành `ID_U_P`** — ping bị đẩy xuống cuối. Đây là thay đổi ảnh hưởng trực tiếp tới độ chính xác (xem §6, §10).

---

# 6. LATENCY ANALYSIS

**File:** [speedtest_worker.js:598-690](../speedtest_worker.js:598) — `pingTest()`

| Câu hỏi của bạn | Trả lời từ code |
|---|---|
| **Đo bằng cách nào?** | `XMLHttpRequest GET` tới `backend/empty.php` — HTTP RTT, **không phải ICMP** |
| **Ping bao nhiêu lần?** | `count_ping: 10` ([speedtest_worker.js:47](../speedtest_worker.js:47)). `settings.json` **không override** ⇒ 10 lần |
| **Có warm-up không?** | **CÓ nhưng ẩn.** Ping đầu tiên (`i === 0`) chỉ dùng để reset `prevT`, **không được ghi nhận** ([speedtest_worker.js:621](../speedtest_worker.js:621)) ⇒ thực tế chỉ 9 mẫu có giá trị |
| **Min/Avg/Max?** | **CHỈ CÓ MIN.** `if (instspd < ping) ping = instspd` ([speedtest_worker.js:640](../speedtest_worker.js:640)). Không hề tính avg, không tính max, không tính p95 |
| **Jitter?** | **CÓ**, nhưng là EWMA **bất đối xứng**, không phải chuẩn RFC 3550 |
| **Protocol?** | HTTP/1.1 keep-alive (empty.php gửi `Connection: keep-alive`) hoặc HTTP/2 tuỳ server |

**Công thức jitter thực tế** ([speedtest_worker.js:644](../speedtest_worker.js:644)):

```js
jitter = instjitter > jitter
       ? jitter * 0.3 + instjitter * 0.7   // spike → nhận 70% trọng số
       : jitter * 0.8 + instjitter * 0.2;  // giảm → chỉ 20%
```

**Vấn đề:** đây là bộ lọc *nghiêng về phía tăng* — jitter báo cáo sẽ **luôn cao hơn** giá trị RFC 3550 thật, và không bao giờ hội tụ về mean deviation. Không sai về mặt "cảnh báo người dùng", nhưng **không so sánh được với bất kỳ công cụ nào khác**, kể cả speedtest.net.

---

### 🔴 LỖI NGHIÊM TRỌNG #1 — Performance API đọc nhầm entry

**File:** [speedtest_worker.js:623-631](../speedtest_worker.js:623)

```js
let p = performance.getEntries();
p = p[p.length - 1];              // ← giả định entry cuối LÀ ping request
let d = p.responseStart - p.requestStart;
if (d <= 0) d = p.duration;
if (d > 0 && d < instspd) instspd = d;   // ← chỉ nhận khi NHỎ HƠN
```

**Logic hiện tại:** lấy phần tử cuối của mảng Resource Timing, giả định đó là request ping vừa xong.

**Vấn đề — 3 tầng:**

1. **Buffer Resource Timing mặc định chỉ 250 entry.** Với `test_order = "ID_U_P"`, download đã chạy 12s × 5 stream, mỗi stream restart liên tục ⇒ **buffer đầy trước khi ping bắt đầu**. Khi đầy, entry mới **bị vứt bỏ**, `p[p.length-1]` mãi mãi trả về một entry `garbage.php` cũ.
2. Code **không bao giờ gọi** `performance.clearResourceTimings()` hay `setResourceTimingBufferSize()` — grep xác nhận 0 kết quả.
3. Điều kiện `if (d > 0 && d < instspd)` khiến giá trị rác **chỉ được nhận khi nó NHỎ HƠN** ⇒ sai lệch **luôn theo hướng ping thấp giả tạo**.

**Tác động:** với config mà repo này đang ship, **ping báo cáo có thể thấp hơn thực tế một cách hệ thống**. Trên Chrome (nơi `ping_allowPerformanceApi` được bật) — tức đa số WebView Android — đây là kịch bản mặc định.

**Cách khắc phục:**
```js
// Thay vì lấy entry cuối, lọc đúng URL:
const entries = performance.getEntriesByName(url);
const p = entries[entries.length - 1];
// và gọi performance.clearResourceTimings() sau mỗi test phase
```
**Ưu tiên: 🔴 Critical**

---

### 🔴 LỖI NGHIÊM TRỌNG #2 — Ping đo sau khi bão hoà link

**File:** [settings.json](../settings.json) → `"test_order": "ID_U_P"`

**Logic hiện tại:** Ping chạy sau Download → 1s delay → Upload → 1s delay → **Ping**.

**Vấn đề:** 1 giây sau khi 3 stream upload 20 MB dừng đột ngột, các buffer (socket, CPE, DSLAM/OLT, carrier) **vẫn đang xả**. Đây là điều kiện kinh điển gây bufferbloat.

**Tác động:** ping đo được là **loaded latency**, không phải idle latency. Trên đường ADSL/4G có bufferbloat, con số này có thể cao gấp **5–20 lần** ping thật. Người dùng Unitel sẽ so với speedtest.net (đo idle ping trước) và thấy Unitel "ping tệ hơn" — dù mạng y hệt.

**Cách khắc phục:** đổi về `"IP_D_U"` (chuẩn upstream), **hoặc** giữ cả hai và hiển thị riêng: *Idle Ping* + *Loaded Ping* — cách này thực ra **tốt hơn speedtest.net** (xem §15).

**Ưu tiên: 🔴 Critical**

---

### 🟡 Vấn đề #3 — Sàn 1ms nhân tạo

[speedtest_worker.js:636-637](../speedtest_worker.js:636):
```js
if (instspd < 1) instspd = prevInstspd;
if (instspd < 1) instspd = 1;
```
Trên mạng nội bộ / LAN Unitel (ping thật < 1ms), kết quả **luôn hiển thị 1.00 ms**. Không dùng được để đo hạ tầng nội bộ. Khắc phục: dùng `performance.now()` (độ phân giải sub-ms) thay cho `Date.now()`.

---

# 7. DOWNLOAD ANALYSIS

**File:** [speedtest_worker.js:321-427](../speedtest_worker.js:321) — `dlTest()`

| Câu hỏi | Trả lời từ code |
|---|---|
| **Cơ chế** | N × `XMLHttpRequest GET` tới `garbage.php`, đếm byte qua `onprogress` |
| **Multi-connection?** | **CÓ.** `xhr_dlMultistream: 6` mặc định ([:54](../speedtest_worker.js:54)) |
| **Parallel thật?** | **CÓ**, nhưng lệch nhau `xhr_multistreamDelay: 300ms × i` ([:56](../speedtest_worker.js:56)) để không kết thúc cùng lúc |
| **Chunk size** | `garbagePhp_chunkSize: 100` ⇒ **100 MiB mỗi request** ([:60](../speedtest_worker.js:60)). Server echo 1 MiB × 100 lần ([garbage.php:60](../backend/garbage.php:60)) |
| **Công thức Mbps** | `(totLoaded / (t/1000)) × 8 × 1.06 / 1_000_000` ([:411](../speedtest_worker.js:411)) |
| **Ramp-up?** | **CÓ trong code, NHƯNG BỊ TẮT bởi settings.json** (xem lỗi #4) |
| **Thời gian** | `time_dl_max: 12` giây (settings.json). Upstream mặc định 15s |
| **Giới hạn tốc độ?** | Không có throttle. `time_auto: false` ⇒ luôn chạy đủ 12s |

**Browser quirks tự động** ([speedtest_worker.js:139-153](../speedtest_worker.js:139)):
- Chrome (có `fetch`) → `xhr_dlMultistream = 5`
- Edge cũ → `3`
- Firefox → tắt `ping_allowPerformanceApi`

⇒ **Trên WebView Android (Chromium), số stream thực tế là 5, không phải 6.**

---

### 🔴 LỖI NGHIÊM TRỌNG #4 — Grace time = 0 làm mất warm-up TCP

**File:** [settings.json](../settings.json) → `"time_dlGraceTime": 0`

**Logic hiện tại** ([speedtest_worker.js:394-402](../speedtest_worker.js:394)):
```js
if (t < 200) return;                          // tick đầu tiên ở t ≈ 200ms
if (!graceTimeDone) {
    if (t > 1000 * settings.time_dlGraceTime) {   // 0 → true ngay
        if (totLoaded > 0) { startT = now; totLoaded = 0; }
        graceTimeDone = true;
    }
}
```
Với `time_dlGraceTime = 0`, grace period thực tế **chỉ ~200ms** (một tick), thay vì 1.5s mặc định của upstream.

**Vấn đề:** TCP slow-start trên link tốc độ cao cần thời gian dài hơn nhiều. Trên link 1 Gbps với RTT 30ms, cwnd cần **~8-10 RTT ≈ 300ms** mới đạt line rate — và đó là *mỗi stream*, cộng thêm `300ms × i` delay khởi động. Với 5 stream, stream cuối cùng chỉ bắt đầu ở t=1.2s.

**Tác động định lượng:** trên link ≥ 500 Mbps, **1.0–1.5s đầu (8–12% thời gian đo) là giai đoạn ramp-up bị tính vào trung bình** ⇒ **download bị báo thiếu 5–15%**. Đây chính xác là lý do người dùng sẽ nói "LibreSpeed báo thấp hơn speedtest.net".

**Cách khắc phục:** đặt lại `time_dlGraceTime: 1.5` (hoặc 2.0 cho link gigabit).
**Ưu tiên: 🔴 Critical** — đây là lỗi làm sai số đo lớn nhất trong repo.

---

### 🟠 Vấn đề #5 — Rủi ro OOM trên mobile WebView

**File:** [speedtest_worker.js:373-374](../speedtest_worker.js:373)
```js
if (settings.xhr_dlUseBlob) xhr[i].responseType = "blob";
else xhr[i].responseType = "arraybuffer";     // ← mặc định
```

**Logic hiện tại:** XHR `arraybuffer` **giữ toàn bộ response trong RAM** cho tới khi `onload`. Với `ckSize=100`, mỗi stream tích luỹ tới **100 MiB**.

**Tác động:** 5 stream × 100 MiB = **đỉnh ~500 MB RAM**. Trên WebView Android tầm trung (heap limit 256–512 MB), điều này gây **OOM kill hoặc renderer crash** trên link ≥ 300 Mbps.

**Cách khắc phục — 2 lựa chọn:**
- **Nhanh:** `garbagePhp_chunkSize: 20` cho mobile → đỉnh giảm còn ~100 MB
- **Đúng:** thay XHR bằng `fetch()` + `ReadableStream`, đọc và **vứt** từng chunk:
  ```js
  const reader = (await fetch(url)).body.getReader();
  while (true) { const {done, value} = await reader.read();
                 if (done) break; totLoaded += value.length; }  // value bị GC ngay
  ```
  → RAM gần như bằng 0, và **độ phân giải đo tốt hơn** `onprogress`.

**Ưu tiên: 🟠 High** (🔴 Critical nếu target là WebView mobile)

---

# 8. UPLOAD ANALYSIS

**File:** [speedtest_worker.js:428-596](../speedtest_worker.js:428) — `ulTest()`

| Câu hỏi | Trả lời từ code |
|---|---|
| **Cơ chế** | `POST` blob dữ liệu random tới `empty.php`, đếm byte qua `xhr.upload.onprogress` |
| **Chuẩn bị dữ liệu** | `new ArrayBuffer(1MiB)` fill `Math.random()` **1 lần**, rồi `req.push(r)` × 20 → `new Blob(req)` ([:433-442](../speedtest_worker.js:433)) |
| **Chunk size** | `xhr_ul_blob_megabytes: 20` ⇒ **20 MB/request**. Chrome mobile bị ép xuống **4 MB** ([:154-157](../speedtest_worker.js:154)) |
| **Parallel** | `xhr_ulMultistream: 3` ([:55](../speedtest_worker.js:55)) |
| **Thời gian** | `time_ul_max: 12` giây |
| **Công thức** | Giống download: `× 8 × 1.06 / 1e6` ([:569](../speedtest_worker.js:569)) |
| **Error handling** | 3 chế độ `xhr_ignoreErrors`: `0`=fail, **`1`=restart stream (mặc định)**, `2`=bỏ qua |
| **IE11 workaround** | Gửi 256 KB nhỏ lẻ, dùng `onload` làm progress — kém chính xác ([:476-487](../speedtest_worker.js:476)) |

**Điểm tốt gần đây:** [:513-527](../speedtest_worker.js:513) đã sửa để kiểm tra HTTP status trên `x` (biến capture) thay vì `xhr[i]` — xử lý đúng trường hợp server trả 413/500 mà trước đây bị đếm nhầm là thành công.

---

### 🔴 LỖI NGHIÊM TRỌNG #6 — Upload grace = 0 → đo phồng số

**File:** [settings.json](../settings.json) → `"time_ulGraceTime": 0` (upstream mặc định **3.0**)

**Vấn đề — đây là lỗi nguy hiểm hơn cả download:** `xhr.upload.onprogress` báo **byte đã ghi vào socket buffer của OS**, KHÔNG phải byte đã được server ACK. Khi test bắt đầu, socket send buffer (thường 64 KB–4 MB với autotuning) rỗng ⇒ trình duyệt **đổ đầy buffer trong vài mili giây** và `onprogress` báo hàng megabyte "đã gửi" ngay lập tức.

`time_ulGraceTime: 3` tồn tại **chính xác để chờ buffer đầy** trước khi bắt đầu đếm. Đặt về 0 ⇒ grace thực tế ~200ms ⇒ **toàn bộ lượng dữ liệu lấp buffer bị tính là throughput**.

**Tác động định lượng:** với 3 stream × socket buffer 2 MB = 6 MB "ảo" chia cho 12s ≈ **+4 Mbps giả tạo**. Trên link upload chậm (ADSL 5 Mbps, 4G yếu) sai số này có thể **vượt 50%**. Kết hợp với lỗi #4 (download báo thiếu), bạn có một hệ đo **lệch hai chiều ngược nhau** — cực khó debug khi khách hàng khiếu nại.

**Cách khắc phục:** trả về `time_ulGraceTime: 3`. Nếu muốn test ngắn, tăng `time_ul_max` lên 15 và giữ grace = 3.
**Ưu tiên: 🔴 Critical**

---

### 🟠 Vấn đề #7 — Preflight OPTIONS trên mọi POST cross-origin

**Files:** [speedtest_worker.js:529-531](../speedtest_worker.js:529) + [backend/empty.php:5-9](../backend/empty.php:5)

**Logic hiện tại:**
```js
xhr[i].open("POST", url + "...&r=" + Math.random(), true);   // URL RANDOM MỖI LẦN
xhr[i].setRequestHeader("Content-Encoding", "identity");     // → header KHÔNG simple
```
```php
header('Access-Control-Allow-Headers: Content-Encoding, Content-Type');
// ⚠ KHÔNG có Access-Control-Max-Age
```

**Vấn đề:** `Content-Encoding` không nằm trong CORS-safelisted headers ⇒ **mọi POST cross-origin đều bị preflight OPTIONS**. Preflight cache của Chromium **có key theo URL đầy đủ** — mà URL chứa `r=Math.random()` ⇒ **không bao giờ trúng cache**. Thêm nữa `empty.php` không set `Access-Control-Max-Age`.

**Tác động:** mỗi request upload tốn thêm **1 RTT** trước khi truyền byte đầu tiên. Với 3 stream:
- Link 10 Mbps, RTT 50ms: 20MB mất 16s → preflight không đáng kể
- Link 500 Mbps, RTT 50ms: 20MB mất 0.32s → **preflight chiếm 13% thời gian** ⇒ upload báo thiếu ~13%
- Link 4G, RTT 200ms: **mất tới 38%**

Đây là lỗi **chỉ xảy ra trong kiến trúc MPOT / WebView trỏ backend khác domain** — tức chính xác là kiến trúc bạn định dùng.

**Cách khắc phục — 3 tầng:**
1. Thêm `header('Access-Control-Max-Age: 86400');` vào `empty.php`
2. Bỏ `r=Math.random()` khỏi URL upload (POST vốn không bị cache) — dùng header custom hoặc body
3. Bỏ luôn `setRequestHeader("Content-Encoding", "identity")` → request trở thành simple → **không preflight nữa**. Dữ liệu random vốn không nén được, header này gần như vô dụng.

**Ưu tiên: 🟠 High** (🔴 Critical nếu backend khác domain với frontend)

---

# 9. SERVER SELECTION

**File:** [speedtest.js:180-310](../speedtest.js:180) — `selectServer()`

| Câu hỏi | Trả lời từ code |
|---|---|
| **Có server list không?** | **Có** — `server-list.json`, 37 server cộng đồng toàn cầu |
| **Auto-select?** | **Có** — chọn theo **min ping**, KHÔNG dùng geolocation |
| **Dựa vào latency hay location?** | **100% latency.** `getIP.php` có tính khoảng cách nhưng **chỉ để hiển thị**, không tham gia chọn server |
| **Fallback server?** | **KHÔNG CÓ.** Nếu `bestServer == null` → `alert()` và bế tắc ([index.js:180](../frontend/javascript/index.js:180)) |

**Thuật toán chi tiết:**

```
37 server → chia round-robin vào 6 nhóm (CONCURRENCY = 6)   speedtest.js:284
    │
    ├─ Nhóm chạy SONG SONG, nhưng server TRONG nhóm chạy TUẦN TỰ
    │
    └─ checkServer(server):                                  speedtest.js:239
         if (server.server.indexOf(location.protocol) == -1) → SKIP HOÀN TOÀN
         ping tối đa 3 lần (PINGS = 3)
           • pingT = min của các lần ping
           • nếu 1 lần > 500ms (SLOW_THRESHOLD) → dừng sớm
           • timeout 2000ms
         → server chết: pingT = -1
    │
    ▼
bestServer = server có pingT nhỏ nhất và != -1
```

### Các vấn đề phát hiện

**🟠 #8 — Bottleneck tuần tự.** 37 server / 6 nhóm ≈ 6 server/nhóm × tối đa 3 ping × 2s timeout = **tới 36 giây** trước khi UI sẵn sàng, nếu nhiều server chết. Trên 4G yếu đây là kịch bản rất thực. Người dùng nhìn "searching nearest server…" cả nửa phút.
→ *Khắc phục:* tăng `CONCURRENCY` lên 12–16, giảm `PING_TIMEOUT` xuống 1000ms, và **hiển thị progress** thay vì text tĩnh.

**🟠 #9 — Loại server theo protocol quá thô.** [speedtest.js:242](../speedtest.js:242): `if (server.server.indexOf(location.protocol) == -1) done();` — server `https://` bị loại sạch khi page chạy trên `http://`. Trong WebView dùng `WebViewAssetLoader` (origin `https://appassets.androidplatform.net`), điều này *có lợi*; nhưng nếu dev test qua `http://localhost` thì **toàn bộ server https bị loại** và UI báo "no servers available" — rất dễ mất thời gian debug.

**🟠 #10 — Không có fallback.** Nếu tất cả server không tới được, người dùng chỉ nhận `alert()`:
```js
alert("Can't reach any of the speedtest servers! But you're on this page. Something weird is going on with your network.");
```
([frontend/javascript/index.js:180](../frontend/javascript/index.js:180)). Trong WebView, `alert()` **có thể bị chặn hoàn toàn** nếu app không implement `WebChromeClient.onJsAlert()` ⇒ **màn hình treo im lặng, không thông báo gì**. 🔴 Critical cho WebView.

**🟡 #11 — Ping selection dùng `getEntriesByName`, tốt hơn worker.** [speedtest.js:214](../speedtest.js:214) dùng `performance.getEntriesByName(url)` — đúng cách. Trớ trêu là **code chọn server chính xác hơn code đo ping chính thức**. Nên port cách này sang worker.

**🔴 #12 — `server-list.json` trỏ ra 37 server công cộng ngoài Unitel.** [index-modern.html:16](../index-modern.html:16) đặt `SPEEDTEST_SERVERS = "server-list.json"`. Nếu deploy nguyên trạng, người dùng Unitel sẽ đo tốc độ tới Clouvider Amsterdam / Sharktech LA — **kết quả phản ánh peering quốc tế, không phải mạng Unitel**, và bạn đang gửi lưu lượng khách hàng ra hạ tầng bên thứ ba. **Bắt buộc phải thay** trước khi lên production.

---

# 10. ACCURACY ANALYSIS — KẾT QUẢ CÓ ĐÁNG TIN KHÔNG?

**Kết luận thẳng:** engine có nền tảng đúng, nhưng **config đang ship trong repo này làm sai lệch cả 3 chỉ số chính**. Nếu deploy nguyên trạng, kết quả **không đáng tin** để dùng cho SLA hay đối soát với khách hàng.

### Bảng đánh giá theo từng yếu tố

| Yếu tố | Đánh giá | Bằng chứng trong code |
|---|---|---|
| **Latency accuracy** | 🔴 **Kém** | Ping chạy cuối (`ID_U_P`) → đo loaded latency; `performance.getEntries()` đọc entry sai; sàn cứng 1ms |
| **Download accuracy** | 🟠 **Thiếu 5–15%** | `time_dlGraceTime: 0` → không loại ramp-up TCP |
| **Upload accuracy** | 🔴 **Thừa, có thể >50% trên link chậm** | `time_ulGraceTime: 0` + `onprogress` đếm socket buffer |
| **Jitter** | 🟠 **Không chuẩn** | EWMA bất đối xứng, không phải RFC 3550 |
| **Packet loss** | 🟡 **Chỉ có ở stability test** | `stability_worker.js` đếm XHR fail (≈ TCP timeout, không phải packet loss L3) |
| **TCP/HTTP behavior** | 🟢 **Hợp lý** | Multi-stream 5 DL / 3 UL là chuẩn ngành, giúp vượt giới hạn single-flow |
| **Parallel connections** | 🟢 **Đúng thiết kế** | Stagger 300ms tránh đồng bộ hoá, nhưng cũng làm chậm đạt line rate |
| **Browser limitations** | 🟠 | Giới hạn 6 kết nối/origin của HTTP/1.1 — với 5 DL stream đã dùng gần hết quota |
| **WebView limitations** | 🔴 | Xem §11 |
| **Network congestion** | 🟠 | Không phát hiện, không cảnh báo. Chỉ đo một lần rồi kết luận |
| **Server limitation** | 🔴 **Nghiêm trọng** | `garbage.php` sinh dữ liệu qua PHP — CPU server thành trần tốc độ (xem §12) |
| **CPU limitation** | 🟠 | `openssl_random_pseudo_bytes(1MiB)` mỗi request phía server; phía client rAF loop 60fps |
| **Memory limitation** | 🟠 | `arraybuffer` giữ tới 100 MiB/stream |
| **Connection warm-up** | 🔴 | **Bị tắt** bởi settings.json — lỗi lớn nhất |
| **Caching** | 🟢 **Xử lý đúng** | `r=Math.random()` + `Cache-Control: no-store` ở cả 3 endpoint |
| **Browser cache** | 🟢 | Như trên |
| **CDN** | 🔴 **Không được đặt sau CDN** | doc.md:927 cảnh báo Cloudflare làm giảm tốc độ. Endpoint test **phải bypass CDN** |
| **TLS overhead** | 🟡 | `overheadCompensationFactor: 1.06` chỉ bù overhead L2/L3/L4, **không bù TLS record overhead (~0.5-1%)** |
| **Measurement overhead** | 🟡 | Poll `postMessage` mỗi 200ms + rAF 60fps; đáng kể trên thiết bị yếu |

### Về `overheadCompensationFactor: 1.06`

[speedtest_worker.js:63](../speedtest_worker.js:63) — hệ số này **nhân thẳng vào kết quả**, làm mọi con số cao hơn 6%. doc.md:495-503 liệt kê các giá trị thay thế:
- `1.0369` cho IPv4+TCP+ETH đo thực nghiệm
- `1.0513` cho IPv6
- `1` = không bù (đo throughput file thật)

⇒ Với mạng Unitel, cần **đo hiệu chuẩn thực tế** rồi chọn hệ số, không dùng mù giá trị 1.06. Nếu MTU khác (PPPoE 1492, tunnel 1400) thì 1.06 sai đáng kể.

### 🟡 Vấn đề #13 — `time_auto` bị tắt

[settings.json](../settings.json) đặt `"time_auto": false`, vô hiệu hoá logic rút ngắn test trên link nhanh ([speedtest_worker.js:406-408](../speedtest_worker.js:406)):
```js
const bonus = (5.0 * speed) / 100000;
bonusT += bonus > 400 ? 400 : bonus;
```
Không sai về accuracy (thậm chí *tốt hơn*: test dài = số liệu ổn định hơn), nhưng **tốn băng thông**: 12s × 1 Gbps × 2 chiều = **~3 GB/lượt test**. Với 10.000 lượt/ngày = **30 TB/ngày**. Cần cân nhắc kỹ (xem §12).

---

# 11. WEBVIEW COMPATIBILITY

Phân loại theo đúng yêu cầu của bạn:

## A. CÓ THỂ GIỮ NGUYÊN ✅

| Thành phần | Lý do |
|---|---|
| `speedtest_worker.js` — engine đo | XHR + Worker là API cực kỳ ổn định, hỗ trợ từ WebView 4.4+ |
| `backend/garbage.php`, `empty.php` | HTTP thuần, không phụ thuộc client |
| `backend/getIP.php` + GeoIP | Server-side hoàn toàn |
| Cơ chế `postMessage` main↔worker | Chuẩn, ổn định |
| Cache-busting `r=Math.random()` | Cần thiết, hoạt động tốt |
| `results/telemetry.php` | Nếu bạn cần lịch sử |

## B. CẦN CHỈNH SỬA NHỎ 🟡

| Thành phần | Vấn đề | Sửa gì |
|---|---|---|
| [settings.json](../settings.json) | 3 tham số làm sai số đo | `time_dlGraceTime: 1.5`, `time_ulGraceTime: 3`, `test_order: "IP_D_U"` |
| [speedtest_worker.js:625](../speedtest_worker.js:625) | Performance API đọc sai entry | `getEntriesByName(url)` + `clearResourceTimings()` |
| [speedtest_worker.js:60](../speedtest_worker.js:60) | `ckSize=100` gây OOM mobile | Giảm còn 20–25 trên mobile |
| [backend/empty.php](../backend/empty.php) | Thiếu `Access-Control-Max-Age` | Thêm 1 dòng header |
| [speedtest.js:322](../speedtest.js:322) | Worker không terminate | Thêm `this.worker.terminate()` trong `onend` |
| `server-list.json` | Trỏ ra 37 server công cộng | Thay bằng server Unitel |

## C. CẦN REFACTOR 🟠

| Thành phần | Vấn đề trong WebView |
|---|---|
| [design-switch.js](../design-switch.js) | **XHR đồng bộ** (`xhr.open(..., false)`) chặn main thread + **redirect toàn trang**. Trong WebView đây là 2 navigation + 1 blocking I/O trước khi thấy pixel đầu tiên. **Nên xoá hoàn toàn**, WebView chỉ cần 1 UI |
| [frontend/javascript/index.js:373](../frontend/javascript/index.js:373) | `requestAnimationFrame` chạy vô hạn kể cả khi idle, ghi DOM mỗi frame. Đốt pin, tăng nhiệt, ảnh hưởng số đo trên thiết bị yếu |
| `index-classic.html` | 618 dòng HTML với **JS inline + `onclick=` attribute** → không thể áp CSP, khó bảo trì |
| `frontend/styling/*.css` | Dùng **CSS Nesting native** (`& > p`, `@media` lồng trong rule). Chỉ hỗ trợ từ **Chrome 112+ (04/2023)**. Trên Android System WebView cũ hơn → **toàn bộ CSS lồng bị bỏ qua ⇒ layout vỡ hoàn toàn**. 🔴 Nếu phải support WebView cũ, bắt buộc build lại CSS phẳng |
| [frontend/javascript/index.js:96](../frontend/javascript/index.js:96) | `navigator.clipboard` yêu cầu **secure context**. Code đã có guard (`copyLink.classList.toggle("hidden", !navigator.clipboard)`) — chấp nhận được, nhưng nên dùng JS bridge tới native clipboard |
| `stability.html:973-977` | Xuất CSV bằng `Blob` + `<a download>`. Trong Android WebView, `download` attribute **không hoạt động** nếu app không implement `setDownloadListener()`; blob URL còn khó hơn. Cần chuyển sang JS bridge |

## D. KHÔNG PHÙ HỢP VỚI WEBVIEW — PHẢI THAY 🔴

| Thành phần | Vì sao không dùng được |
|---|---|
| **`file://` deployment** | 🔴 **`new Worker()` từ trang `file://` bị Chromium chặn** (opaque origin → SecurityError). Toàn bộ engine chết. **Không có cách vòng nào sạch** ngoài `setAllowFileAccessFromFileURLs(true)` (không khuyến nghị, gây lỗ hổng đọc file cục bộ) |
| **`alert()` xử lý lỗi** | Bị nuốt im lặng nếu native không implement `WebChromeClient.onJsAlert()`. Người dùng thấy màn hình đơ |
| **`<dialog>` + `showModal()`** | WebView < 37 không có. Modal privacy/share sẽ không mở |
| **Redirect chain của `index.html`** | Trong WebView, redirect làm hỏng back-stack và gây flash trắng |
| **`background-original.jpeg` 1.2 MB** | File rác không dùng nhưng Docker `cp -a frontend/` vẫn copy. Phải loại khỏi bundle |

## Kiểm tra từng API bạn hỏi

| API | Tình trạng trong project | Rủi ro WebView |
|---|---|---|
| **HTTP request** | XHR duy nhất | ✅ An toàn |
| **HTTPS** | Bắt buộc nếu page là https (mixed content) | 🟠 Cert tự ký → `onReceivedSslError` phải xử lý |
| **CORS** | Chỉ bật khi `mpot=true` ([worker:376](../speedtest_worker.js:376)) | 🔴 Standalone mode **không gửi `cors=true`** ⇒ cross-origin fail |
| **WebSocket** | **Không dùng** | ✅ Không rủi ro |
| **SharedWorker** | **Không dùng** | ✅ (may mắn — SharedWorker **không được hỗ trợ trong Android WebView**) |
| **WebWorker** | ✅ Dùng, là core | 🔴 Chết trên `file://` |
| **Service Worker** | **Không dùng** (dù có `manifest.webmanifest`) | 🟡 PWA manifest vô nghĩa trong WebView |
| **WebAssembly** | **Không dùng** | ✅ |
| **localStorage** | **Không dùng ở đâu cả** (grep = 0) | 🟡 Nghĩa là **không có test history** |
| **IndexedDB** | **Không dùng** | 🟡 Như trên |
| **File access** | Chỉ `<a download>` CSV ở stability.html | 🔴 Cần bridge |
| **Native API** | **Không có bridge nào** | — Phải tự xây |
| **System network API** | **Không truy cập** — không biết WiFi/4G/5G | 🟡 Đây là **cơ hội lớn** (xem §15) |
| **localhost** | Chỉ dùng trong test Playwright | ✅ |
| **Custom protocol** | Không dùng | 🟢 Nên dùng `WebViewAssetLoader` |
| **Certificate** | Chưa xử lý pinning | 🟠 Cần cân nhắc |
| **Proxy** | Không phát hiện, không cảnh báo | 🟠 VPN/proxy làm sai số đo mà không ai biết |
| **Firewall** | Không xử lý | 🟡 |
| **Permissions** | Không xin quyền nào | ✅ Sạch — nhưng cần `INTERNET` phía native |

---

# 12. WEBVIEW ARCHITECTURE PROPOSAL

Kiến trúc đề xuất, dựa trên đúng những gì source code cho phép:

```
┌───────────────────── NATIVE APP (Android/iOS) ────────────────────┐
│                                                                    │
│  ┌── Native Layer ──────────────────────────────────────────┐     │
│  │ • WebViewAssetLoader → https://appassets.androidplatform.net│    │
│  │   (BẮT BUỘC: Worker không chạy được trên file://)         │     │
│  │ • NetworkInfoBridge   → loại mạng, WiFi SSID, cell/LTE/5G │     │
│  │   RSRP/RSRQ, carrier, SIM operator                        │     │
│  │ • StorageBridge       → lưu lịch sử test (SQLite native)  │     │
│  │ • ShareBridge         → chia sẻ/xuất kết quả              │     │
│  │ • WebChromeClient     → onJsAlert/onConsoleMessage        │     │
│  │ • DownloadListener    → export CSV/PDF                    │     │
│  └────────────────────────┬─────────────────────────────────┘     │
│                           │ @JavascriptInterface (allowlist)       │
│  ┌────────────────────────▼─────────────────────────────────┐     │
│  │              WEBVIEW  (asset loader origin)               │     │
│  │                                                            │     │
│  │  ┌── UI Layer (VIẾT MỚI) ─────────────────────────────┐  │     │
│  │  │ Screen: Idle → Selecting → Testing → Result → Error │  │     │
│  │  │ Gauge (SVG/Canvas) · Result cards · History         │  │     │
│  │  │ i18n: Lao / English / Vietnamese                    │  │     │
│  │  └─────────────────┬──────────────────────────────────┘  │     │
│  │                    │ event bus (không poll)              │     │
│  │  ┌─────────────────▼──────────────────────────────────┐  │     │
│  │  │ Controller  (speedtest.js — refactor nhẹ)          │  │     │
│  │  │ • FSM · server selection · terminate() worker      │  │     │
│  │  └─────────────────┬──────────────────────────────────┘  │     │
│  │                    │ postMessage (giữ nguyên protocol)   │     │
│  │  ┌─────────────────▼──────────────────────────────────┐  │     │
│  │  │ ★ ENGINE: speedtest_worker.js (GIỮ NGUYÊN + fix)   │  │     │
│  │  │   I → P → D → U  ·  5 DL / 3 UL streams            │  │     │
│  │  └─────────────────┬──────────────────────────────────┘  │     │
│  └────────────────────┼──────────────────────────────────────┘     │
└───────────────────────┼────────────────────────────────────────────┘
                        │ HTTPS (bypass CDN, bypass proxy)
        ┌───────────────┼────────────────┬──────────────────┐
        ▼               ▼                ▼                  ▼
┌──────────────┐ ┌─────────────┐ ┌──────────────┐ ┌────────────────┐
│ CONTROL API  │ │ TEST POINT  │ │ TEST POINT   │ │  TELEMETRY     │
│ (MỚI, nhẹ)   │ │ Vientiane   │ │ Pakse / …    │ │  (tùy chọn)    │
│ • /servers   │ │ • /garbage  │ │              │ │ • POST result  │
│ • /config    │ │ • /empty    │ │  Go / Rust   │ │ • GET history  │
│ • /session   │ │ • /getIP    │ │  KHÔNG PHP   │ │  PostgreSQL    │
│  Go, sau LB  │ │ Bare metal  │ │              │ │                │
└──────────────┘ └─────────────┘ └──────────────┘ └────────────────┘
```

### Phân bổ component

| Component | Nằm ở đâu | Lý do dựa trên code |
|---|---|---|
| **Engine đo** | **WebView** | Phải đo từ chính network stack mà app dùng. `speedtest_worker.js` chạy tốt trong WebView |
| **UI/Gauge/Animation** | **WebView** | Iterate nhanh, cross-platform, không cần release app |
| **Server selection** | **WebView** (logic) + **Control API** (danh sách) | `speedtest.js:selectServer` cần chạy client vì nó đo latency thật từ thiết bị |
| **Network info (4G/5G/WiFi)** | **NATIVE** | JS **không có cách nào** lấy được. `navigator.connection` chỉ cho `effectiveType` thô và không có trên iOS |
| **Test history** | **NATIVE** (SQLite) | Project hiện **không có localStorage/IndexedDB** — native storage tin cậy hơn và không bị clear khi xoá cache WebView |
| **Chia sẻ kết quả** | **NATIVE** | `navigator.clipboard` cần secure context; native share sheet UX tốt hơn |
| **Sinh dữ liệu test** | **BACKEND** | `garbage.php`/`empty.php` |
| **GeoIP/ISP** | **BACKEND** | `getIP.php` — cần API key, không lộ ra client |
| **Telemetry/Lưu trữ** | **BACKEND** | `results/telemetry.php` |

### API cần expose (thiết kế mới — hiện project KHÔNG có)

```
GET  /api/v1/servers          → danh sách test point, có ưu tiên theo vùng
                                (thay cho server-list.json tĩnh)
GET  /api/v1/config           → settings.json động, per-platform
                                (mobile: ckSize nhỏ hơn; desktop: lớn hơn)
POST /api/v1/session          → cấp nonce/token 1 lần dùng, chống lạm dụng
POST /api/v1/results          → thay telemetry.php, có auth
GET  /api/v1/results/{id}     → lấy kết quả để chia sẻ
GET  /api/v1/history?device   → lịch sử theo device (nếu có tài khoản)
```

### Giao tiếp WebView ↔ Native

```javascript
// WebView → Native (allowlist chặt, KHÔNG expose object tuỳ ý)
window.UnitelBridge = {
  getNetworkInfo()      // → {type:"CELLULAR", subtype:"NR", carrier, rsrp, ...}
  saveResult(json)      // → lưu vào SQLite native
  getHistory(limit)     // → mảng kết quả
  shareResult(id)       // → mở native share sheet
  exportCsv(data)       // → thay <a download>
}

// Native → WebView
webView.evaluateJavascript("window.__onNetworkChange({...})", null)
```

**Ranh giới bảo mật:** bridge **chỉ nhận và trả JSON đã validate**. Không bao giờ expose method nhận đường dẫn file, URL tuỳ ý, hoặc thực thi shell (xem §18).

### Error handling — thiết kế mới thay cho `alert()`

| Trạng thái | Hiện tại | Nên có |
|---|---|---|
| Không server nào tới được | `alert()` (bị nuốt trong WebView) | Màn hình lỗi có nút Retry + gợi ý kiểm tra mạng |
| 1 stream chết | Restart im lặng (`xhr_ignoreErrors: 1`) | Đếm số lần restart, cảnh báo nếu > ngưỡng |
| Upload trả 413 | `"Fail"` | Thông báo cụ thể: "Server từ chối kích thước upload" |
| Mất mạng giữa chừng | Test đứng im | Detect qua `navigator.onLine` + native, hủy sạch, báo rõ |
| Đang dùng VPN/proxy | **Không phát hiện** | So sánh IP từ `getIP.php` với IP mà native thấy → cảnh báo |

---

# 13. UI/UX ANALYSIS

## Đánh giá UI hiện có

Project có **2 UI song song** — đây tự nó đã là vấn đề kiến trúc.

### `index-classic.html` (MẶC ĐỊNH — `config.json: useNewDesign: false`)

| Tiêu chí | Đánh giá |
|---|---|
| Kỹ thuật | Canvas gauge vẽ tay, ~380 dòng CSS + JS inline trong HTML |
| Responsive | Có media query cơ bản |
| Hiện đại | ❌ Trông như 2016. Màu `#6060AA`/`#616161` nhạt nhoà |
| WebView | 🟡 Hoạt động, nhưng `onclick=` inline chặn CSP |
| Accessibility | 🟡 Có `aria-label` trên nút start, còn lại thiếu |

### `index-modern.html` + `frontend/`

| Tiêu chí | Đánh giá |
|---|---|
| Kỹ thuật | Gauge bằng CSS `transform: rotate()` + pseudo-element, khá thông minh |
| Thẩm mỹ | ✅ Tốt — dark purple `#0e0720`, accent cyan `#5cf9fd` + magenta `#d63bc6` |
| Typography | ✅ Inter variable font, `font-size: 10px` gốc + đơn vị `rem` |
| Responsive | ✅ 3 breakpoint (1100px, 800px, 500px), grid reflow |
| Animation | ✅ Gauge có oscillation khi đang đo ([index.js:445](../frontend/javascript/index.js:445)) |
| **WebView** | 🔴 **CSS Nesting native → vỡ trên WebView < 112** |
| **Performance** | 🟠 rAF loop 60fps ghi DOM vô điều kiện |
| Accessibility | 🔴 Kém — gauge không có `role`/`aria-live`, screen reader không đọc được kết quả |

### Vấn đề UX cụ thể tìm thấy trong code

**🟠 #14 — Không có phản hồi trong lúc chọn server.** [index-modern.html:37](../index-modern.html:37) hiện chuỗi tĩnh `"searching nearest server..."` trong khi §9 cho thấy quá trình này **có thể mất tới 36 giây**. Không progress bar, không đếm server, không huỷ được.

**🟠 #15 — Nút Start bị disable trong toàn bộ thời gian đó.** [index.js:322](../frontend/javascript/index.js:322): `startButton.classList.toggle("disabled", testState.state === INITIALIZING)`. Người dùng chỉ muốn test nhanh phải chờ vô nghĩa.

**🟡 #16 — Không có test history.** Grep `localStorage`/`IndexedDB` = 0 kết quả. Mỗi lần test là một lần mất dữ liệu.

**🟡 #17 — Không hiển thị loại mạng.** Người dùng không biết mình đang đo trên WiFi hay 4G — thông tin quan trọng nhất khi diễn giải kết quả.

**🟡 #18 — Ping/Jitter bị ẩn cho tới khi có dữ liệu.** [index-modern.html:50](../index-modern.html:50) `class="ping hidden"` → layout **nhảy** khi số xuất hiện giữa lúc đang test.

## Screen flow đề xuất

```
┌─ 1. INITIAL ────────────────────────────────────────────┐
│  Logo Unitel  ·  "Kiểm tra tốc độ mạng"                 │
│  ┌───────────────────────────────────────┐              │
│  │  📍 Vientiane · Unitel Lao   [Đổi ▾]  │ ← có thể     │
│  └───────────────────────────────────────┘   bấm ngay   │
│         ╭───────────────────╮                            │
│         │   ▶  BẮT ĐẦU     │  ← ACTIVE ngay lập tức     │
│         ╰───────────────────╯     (không chờ selection)  │
│  📶 4G · Unitel · 192.0.2.x                              │
└──────────────────────────────────────────────────────────┘
      │ (server selection chạy NGẦM, không chặn)
      ▼
┌─ 2. SERVER SELECTION (không chặn) ──────────────────────┐
│  Đang tìm máy chủ gần nhất  ▓▓▓▓▓▓▓░░░  7/12            │
│  Vientiane      12 ms  ✓ nhanh nhất                     │
│  Savannakhet    28 ms                                    │
│  [Bỏ qua, dùng máy chủ mặc định]                        │
└──────────────────────────────────────────────────────────┘
      ▼
┌─ 3. TESTING · PING ─────────────────────────────────────┐
│  ● Ping   ○ Download   ○ Upload      [Huỷ]              │
│              ⟳  đang đo độ trễ...                        │
│              PING     12 ms                              │
│              JITTER    3 ms                              │
└──────────────────────────────────────────────────────────┘
      ▼
┌─ 4. TESTING · DOWNLOAD ─────────────────────────────────┐
│  ✓ Ping   ● Download   ○ Upload      [Huỷ]              │
│         ╭─────────────────────╮                          │
│         │      125.4          │  ← số lớn, đang chạy    │
│         │       Mbps          │                          │
│         │   ▁▃▅▇█▇▅▃▁▃▅▇     │  ← sparkline realtime   │
│         ╰─────────────────────╯                          │
│         ▓▓▓▓▓▓▓▓░░░░  8.2s / 12s                        │
└──────────────────────────────────────────────────────────┘
      ▼
┌─ 5. TESTING · UPLOAD ───────────────────────────────────┐
│  ✓ Ping  ✓ Download 125.4  ● Upload    [Huỷ]           │
│         (cùng layout, màu accent khác)                   │
└──────────────────────────────────────────────────────────┘
      ▼
┌─ 6. RESULT ─────────────────────────────────────────────┐
│  ┌─ DOWNLOAD ──────┐  ┌─ UPLOAD ────────┐               │
│  │  125.4 Mbps     │  │   42.8 Mbps     │               │
│  │  ▁▃▅▇█▇▅▃▁      │  │   ▁▃▅▇▇▇▅▃      │               │
│  └─────────────────┘  └─────────────────┘               │
│  ┌─ PING ──┐ ┌─ JITTER ┐ ┌─ LOSS ──┐                    │
│  │  12 ms  │ │   3 ms  │ │  0.0 %  │                    │
│  │  idle   │ │         │ │         │                    │
│  │  38 ms  │ │         │ │         │  ← loaded ping     │
│  │  tải    │ │         │ │         │     ★ hơn ST.net   │
│  └─────────┘ └─────────┘ └─────────┘                    │
│  Máy chủ: Vientiane · 12 ms · Unitel Lao                │
│  Mạng: 4G (LTE) · RSRP -85 dBm · 192.0.2.x              │
│  [Đo lại]  [Chia sẻ]  [Lịch sử]                         │
└──────────────────────────────────────────────────────────┘
      ▼
┌─ 7. ERROR ──────────────────────────────────────────────┐
│              ⚠                                           │
│   Không kết nối được máy chủ đo                          │
│   • Kiểm tra kết nối mạng                                │
│   • Tắt VPN nếu đang bật                                 │
│   [Thử lại]   [Chọn máy chủ khác]   [Chi tiết lỗi ▾]    │
└──────────────────────────────────────────────────────────┘
      ▼
┌─ 8. HISTORY ────────────────────────────────────────────┐
│  Hôm nay 14:32  4G   125.4 ↓  42.8 ↑  12ms             │
│  Hôm nay 09:15  WiFi 245.1 ↓  98.3 ↑   8ms             │
│  Hôm qua  20:44  4G    38.2 ↓  12.1 ↑  45ms  ⚠ chậm    │
│  ▁▃▅▇█▅▃▁▃▅▇  xu hướng 30 ngày                          │
│  [Xuất CSV]  [Xoá lịch sử]                              │
└──────────────────────────────────────────────────────────┘
```

**Nguyên tắc UX chủ đạo:** nút START **không bao giờ bị disable**. Server selection chạy ngầm; nếu người dùng bấm trước khi xong, dùng server mặc định theo vùng và hoán đổi ngầm.

---

# 14. COMPARISON WITH SPEEDTEST.NET

| Tiêu chí | Project hiện tại | Speedtest.net | Đánh giá |
|---|---|---|---|
| **UI** | 2 UI song song; classic lỗi thời, modern đẹp nhưng vỡ trên WebView cũ | Thiết kế thống nhất, design system chín, brand mạnh | 🔴 ST.net hơn — nhưng khoảng cách này **thuần công sức thiết kế**, không phải kỹ thuật |
| **UX** | Chặn người dùng ~36s khi chọn server; không history; lỗi = `alert()` | Vào là test được ngay; history; thông báo lỗi có ngữ cảnh | 🔴 ST.net hơn rõ rệt |
| **Speed test flow** | 3 bước, tuần tự, không bỏ qua được | 3 bước + auto-scale thời gian theo tốc độ | 🟠 ST.net hơn |
| **Latency** | Chỉ **min**, 9 mẫu, đo **sau** khi bão hoà (config hiện tại) | Idle + **loaded latency (download/upload riêng)**, nhiều mẫu | 🔴 ST.net hơn hẳn |
| **Download** | 5 stream, 12s, thiếu warm-up ⇒ **báo thiếu 5–15%** | Multi-stream thích ứng, loại ramp-up, chọn thời lượng động | 🔴 ST.net hơn |
| **Upload** | 3 stream, 12s, đếm socket buffer ⇒ **báo thừa** | Đo dựa trên ACK, chính xác hơn nhiều | 🔴 ST.net hơn |
| **Server selection** | 37 server công cộng, chọn theo min ping, tuần tự chậm | 16.000+ server, chọn theo geo + latency, tức thì | 🔴 ST.net hơn về quy mô — **nhưng với Unitel bạn chỉ cần 3-5 server nội địa, quy mô không quan trọng** |
| **Result display** | 4 số + ảnh PNG chia sẻ | Result page đầy đủ, so sánh, grade, chia sẻ đa kênh | 🟠 ST.net hơn |
| **Accuracy** | 🔴 Sai lệch có hệ thống ở cả 3 chỉ số (config hiện tại) | Đã hiệu chuẩn nhiều năm, là chuẩn tham chiếu thị trường | 🔴 ST.net hơn — **nhưng sửa 3 dòng settings.json là thu hẹp phần lớn khoảng cách** |
| **Performance** | Trang nhẹ (~250 KB), nhưng 2 navigation + sync XHR + rAF 60fps | Nặng hơn (vài MB, có quảng cáo), nhưng tối ưu tốt | 🟢 **Project bạn có thể thắng** nếu bỏ redirect chain |
| **Mobile** | Responsive OK, nhưng rủi ro OOM ở link nhanh | App native riêng, tối ưu sâu | 🟠 ST.net hơn |
| **WebView** | 🔴 Chết trên `file://`; CSS vỡ trên WebView cũ | App native, không dùng WebView | 🟢 **Project bạn có lợi thế** — self-host, kiểm soát toàn bộ |
| **Error handling** | 🔴 `alert()`, restart stream im lặng, không phát hiện mất mạng | Thông báo có ngữ cảnh, tự phục hồi | 🔴 ST.net hơn nhiều |
| **Security** | Không auth, không rate-limit, password plaintext | Có bảo vệ chống lạm dụng | 🔴 ST.net hơn |
| **Scalability** | 🔴 Backend PHP là nút cổ chai lớn (§20) | Hạ tầng toàn cầu, hàng nghìn điểm | 🔴 ST.net hơn — **nhưng bạn chỉ cần scale cho tập khách Unitel** |

## Trả lời cụ thể 4 câu hỏi của bạn

### ❓ Vì sao Speedtest.net tốt hơn?

1. **Hiệu chuẩn 15+ năm** trên hàng tỷ lượt đo. Họ biết chính xác cần bù bao nhiêu overhead cho từng loại transport — project bạn chỉ có một hằng số cứng `1.06`.
2. **Đo loaded latency đúng cách** — riêng biệt cho download và upload, đúng lúc đang tải. Project bạn đo ping sau khi tải xong 1 giây, tức đo *đuôi bufferbloat*, không phải bufferbloat.
3. **Không bao giờ để người dùng chờ.** Server selection của họ dùng geo-hint từ IP nên gần như tức thì.
4. **Thuật toán thích ứng** — tự điều chỉnh số stream và thời lượng theo tốc độ phát hiện được.
5. **Kiểm soát cả hai đầu** — server của họ được tinh chỉnh cho việc đo, không phải PHP+Apache đa dụng.

### ❓ Project của bạn đang thiếu gì?

1. Warm-up TCP đúng (`time_dlGraceTime`/`time_ulGraceTime` = 0)
2. Idle latency riêng biệt (ping đang chạy cuối)
3. Test history / lưu trữ
4. Thông tin loại mạng (WiFi/4G/5G)
5. Phát hiện VPN/proxy
6. Rate limiting / chống lạm dụng
7. Error handling thực thụ (thay `alert()`)
8. Thuật toán thích ứng theo tốc độ
9. Accessibility (screen reader, keyboard)
10. Backend chịu tải cao (PHP là trần)

### ❓ Có thể học gì từ Speedtest.net?

- ✅ **Đo loaded latency trong lúc tải** — chỉ số này giá trị hơn download speed với người dùng thực (game, video call)
- ✅ **Không bao giờ chặn nút Start**
- ✅ **Thời lượng test thích ứng** — link nhanh cần ít thời gian hơn để đạt độ tin cậy
- ✅ **Kết quả có ngữ cảnh** — "tốc độ này đủ cho 4K streaming" thay vì chỉ một con số trần trụi
- ✅ **Server info minh bạch** — hiển thị rõ đang đo tới đâu

### ❌ Những gì KHÔNG nên copy

- ❌ **Quảng cáo** — làm nặng trang, và trên WebView của nhà mạng thì hoàn toàn phản tác dụng
- ❌ **Giao diện gauge kim đồng hồ đầy chi tiết** — đẹp trên desktop, khó đọc trên màn hình nhỏ và tốn CPU (project bạn đang copy đúng cái này ở cả hai UI)
- ❌ **Bắt tạo tài khoản** để xem lịch sử — với app nhà mạng, đã có SIM là đã định danh
- ❌ **Thu thập dữ liệu rộng** — Unitel nên đi hướng privacy-first, đây là lợi thế cạnh tranh
- ❌ **Sao chép bảng màu/layout của họ** — rủi ro pháp lý và không tạo được nhận diện Unitel

### ✅ Nơi project của bạn CÓ THỂ vượt Speedtest.net

Xem chi tiết ở §15 — đây là phần bạn quan tâm nhất.

---

# 15. ADVANTAGES (Ưu điểm project hiện tại)

1. **Engine không dependency, 734 dòng, đọc hết trong 1 giờ.** Bạn *sở hữu* toàn bộ logic đo. Với speedtest.net bạn là khách hàng của một hộp đen.

2. **Self-host hoàn toàn → dữ liệu khách hàng không rời mạng Unitel.** Không có bên thứ ba nào biết khách hàng Unitel đo được bao nhiêu. Đây là lợi thế tuân thủ + thương mại thực sự.

3. **Không quảng cáo, không tracker, không tài khoản.** `grep` xác nhận: 0 script bên thứ ba trong toàn bộ HTML. Trang tải trong ~250 KB.

4. **Kiến trúc stateless → scale ngang tầm thường.** Không session, không sticky, không shared state. Thêm test point = thêm 1 dòng JSON.

5. **Đã có Stability Test** — [stability.html](../stability.html) + [stability_worker.js](../stability_worker.js) đo ping liên tục 60s, có **packet loss**, min/avg/max, jitter, biểu đồ, ngưỡng cảnh báo, và xuất CSV. **Speedtest.net không có tính năng này trên web.** Đây là tài sản bị đánh giá thấp — với nhà mạng, đo *ổn định* quan trọng hơn đo *đỉnh*.

6. **Đa backend đã tồn tại** — Go ([speedtest-go](https://github.com/librespeed/speedtest-go)) và Rust ([speedtest-rust](https://github.com/librespeed/speedtest-rust)) đều tương thích protocol. Đường nâng cấp scale đã sẵn sàng, không cần viết lại client.

7. **Docker 4 mode (`standalone`/`backend`/`frontend`/`dual`)** — đã hỗ trợ đúng mô hình bạn cần: frontend tập trung + nhiều test point phân tán.

8. **License LGPL-3.0** — được phép dùng thương mại, chỉ cần công khai thay đổi trong chính thư viện.

9. **Có E2E test sẵn** — 7 spec Playwright + docker-compose cho cả 4 mode. Nền tảng CI có sẵn.

10. **Test point tự chọn được** — người dùng có thể chỉ định đo tới Vientiane hay Pakse; speedtest.net không cho kiểm soát ở mức này.

---

# 16. DISADVANTAGES (Nhược điểm project hiện tại)

1. **🔴 Config đang ship làm sai cả 3 phép đo.** `settings.json` với `time_dlGraceTime: 0`, `time_ulGraceTime: 0`, `test_order: "ID_U_P"` — chi tiết ở §6, §7, §8.

2. **🔴 Không chạy được từ `file://` trong WebView.** `new Worker()` bị chặn bởi opaque origin. Buộc phải dùng `WebViewAssetLoader` hoặc local server.

3. **🔴 Backend PHP là trần tốc độ.** [garbage.php:56-62](../backend/garbage.php:56) sinh 1 MiB CSPRNG rồi `echo` × N qua PHP output buffer. Ở gigabit, CPU server hết trước băng thông.

4. **🔴 Không có bất kỳ cơ chế chống lạm dụng nào.** Không auth, không rate limit, không CAPTCHA, không token. Bất kỳ ai cũng có thể script `curl garbage.php?ckSize=1024` vô hạn → **DoS bằng chính băng thông của bạn** (§18).

5. **🟠 Hai UI song song + một file thứ ba đã hỏng.** [frontend/index.html](../frontend/index.html) tham chiếu `speedtest.js` và `javascript/index.js` **tương đối với `frontend/`** — nhưng `speedtest.js` nằm ở root ⇒ **file này 404 nếu serve trực tiếp**. Docker vẫn `cp -a frontend/` nên nó *có* được deploy. Code chết + footgun.

6. **🟠 Cấu hình bằng `sed` trên file tĩnh.** [docker/entrypoint.sh:102-129](../docker/entrypoint.sh:102) thay chuỗi trong HTML. Sửa một dấu cách trong `index-modern.html` là `SERVER_LIST_URL`/`TITLE`/`TAGLINE` **âm thầm không áp dụng nữa**, không lỗi, không cảnh báo.

7. **🟠 Rò Worker.** [speedtest.js:322](../speedtest.js:322) tạo Worker mới mỗi lần `start()` nhưng **không bao giờ `terminate()`**. Trớ trêu là `stability.html:646` *có* gọi terminate — engine chính thì không.

8. **🟠 Bug: `runNextTest = null` không có tác dụng.** [speedtest_worker.js:252](../speedtest_worker.js:252) gán vào biến `const` khai báo trong block khác ⇒ ở sloppy mode tạo ra một **biến global mới**, không hủy chuỗi test như ý định. Không gây hại vì `clearRequests()` đã dọn, nhưng là code sai.

9. **🟠 Không có test độ chính xác.** 7 spec Playwright chỉ kiểm tra "UI hiện ra" và "endpoint trả 200". **Không có một dòng nào kiểm tra con số đo có đúng không.**

10. **🟠 Bug trong stability test.** [stability_worker.js:181](../stability_worker.js:181) dùng `performance.getEntries()` lấy entry cuối, chạy 60s × 5 ping/s = **300 mẫu > buffer 250 entry** ⇒ sau ~250 mẫu, giá trị ping **đóng băng ở một entry cũ**. Nửa sau của bài test stability cho số liệu vô nghĩa. 🔴 với chính tính năng khác biệt nhất của project.

11. **🟡 Credentials plaintext.** [results/telemetry_settings.php](../results/telemetry_settings.php) và [backend/getIP_ipInfo_apikey.php](../backend/getIP_ipInfo_apikey.php) chứa mật khẩu/API key trong file PHP, ghi đè bằng `sed`. Lộ ra nếu PHP không được parse.

12. **🟡 CSS Nesting native** → vỡ layout trên Android WebView < 112.

13. **🟡 Không có i18n.** Toàn bộ chuỗi hardcode tiếng Anh. Với Unitel Lào cần ít nhất Lao + English.

14. **🟡 Không có accessibility.** Gauge không `aria-live`, kết quả screen reader không đọc được.

15. **🟡 File rác trong bundle.** `background-original.jpeg` 1.2 MB không được tham chiếu ở đâu nhưng vẫn được Docker copy.

---

## 🎯 Project của bạn có thể VƯỢT Speedtest.net ở đâu?

Đây là phần bạn nói đặc biệt quan tâm. Chỉ liệt kê những gì **khả thi với source thực tế**:

### Nhóm 1 — Có thể làm ngay, giá trị cao

| # | Cơ hội | Vì sao khả thi | Vì sao ST.net không có |
|---|---|---|---|
| 1 | **Idle ping + Loaded ping hiển thị SONG SONG** | `test_order` hỗ trợ cả `"IP_D_U_P"` — ping 2 lần, đầu và cuối. Chỉ đổi 1 chuỗi config | ST.net có loaded latency nhưng chôn trong UI phụ. Đưa lên hàng đầu = khác biệt rõ |
| 2 | **Không quảng cáo, mở tức thì** | Trang hiện ~250 KB. Bỏ redirect chain + inline CSS critical → **first paint < 300ms** | ST.net web nặng vài MB vì ads |
| 3 | **Stability Test là first-class feature** | `stability.html` **đã tồn tại và hoạt động**, chỉ cần sửa bug §16.10 và làm lại UI | **ST.net không có trên web.** Đây là khác biệt lớn nhất |
| 4 | **Packet loss thật** | `stability_worker.js` đã đếm. Nâng cấp thành chỉ số chính | ST.net web không hiển thị packet loss |
| 5 | **Test history offline** | Native SQLite qua bridge. Không cần tài khoản | ST.net bắt đăng nhập để xem lịch sử |

### Nhóm 2 — Cần bridge native, giá trị rất cao cho nhà mạng

| # | Cơ hội | Cách làm |
|---|---|---|
| 6 | **Hiển thị loại mạng + chất lượng tín hiệu**: `4G LTE · Band 3 · RSRP -85 dBm` | `TelephonyManager` / `CoreTelephony` qua bridge. **JS không thể lấy được** |
| 7 | **Tương quan tốc độ ↔ chất lượng sóng** | Lưu RSRP/RSRQ cùng mỗi kết quả → biểu đồ "tốc độ theo cường độ sóng". **Cực kỳ giá trị cho đội tối ưu mạng Unitel** |
| 8 | **Phát hiện VPN/proxy** | So IP từ `getIP.php` với IP native thấy → cảnh báo "kết quả có thể không chính xác do VPN" |
| 9 | **Đo tự động nền + heatmap** | Đo định kỳ khi có WiFi + sạc → dữ liệu vùng phủ thực tế. **Không đối thủ nào có** |

### Nhóm 3 — Chẩn đoán mạng chuyên sâu

| # | Cơ hội | Ghi chú |
|---|---|---|
| 10 | **DNS latency** | Đo `performance.getEntriesByName(url)[0].domainLookupEnd - domainLookupStart`. **API đã có sẵn trong code**, chỉ chưa dùng |
| 11 | **TCP connect + TLS handshake time** | Cùng Resource Timing API: `connectEnd - connectStart`, `connectEnd - secureConnectionStart` |
| 12 | **TTFB riêng biệt** | `responseStart - requestStart` — đang bị dùng sai cho ping, dùng đúng thì là chỉ số riêng |
| 13 | **Bufferbloat grade (A–F)** | Có idle + loaded ping là tính được ngay. Rất dễ hiểu với người dùng |
| 14 | **Xuất kết quả CSV/PDF** | Cơ chế CSV đã có ở `stability.html:965-977` |
| 15 | **Public API cho doanh nghiệp** | `results/json.php` đã là mầm mống. Khách hàng doanh nghiệp Unitel có thể tích hợp giám sát |

### Nhóm 4 — Lợi thế nhà mạng độc quyền

| # | Cơ hội |
|---|---|
| 16 | **Test point NGAY TRONG mạng Unitel** → đo được tốc độ *nội mạng* thật, tách khỏi chất lượng peering quốc tế. Speedtest.net **không bao giờ làm được điều này cho Unitel** |
| 17 | **So sánh nội mạng vs quốc tế** trong cùng một bài test → chứng minh minh bạch "mạng chúng tôi tốt, nghẽn nằm ở tuyến quốc tế" |
| 18 | **Liên kết kết quả với gói cước** → "Bạn đang dùng gói 100 Mbps, đo được 94 Mbps ✓ đạt cam kết" |
| 19 | **Ticket hỗ trợ tự động** → tốc độ dưới ngưỡng SLA nhiều lần → tự tạo ticket kèm dữ liệu đo |

**Kết luận §15/16:** bạn **không nên** cố thắng speedtest.net ở việc *đo tốc độ đỉnh*. Bạn thắng ở **chẩn đoán, minh bạch, và tích hợp với hạ tầng Unitel** — những thứ mà một nhà cung cấp trung lập về mặt cấu trúc không thể làm.

---

# 17. PERFORMANCE

## Bottleneck phát hiện được

### Unnecessary requests
| Vấn đề | File | Chi phí |
|---|---|---|
| Redirect chain: `index.html` → sync XHR `config.json` → `index-classic.html` | [design-switch.js:38-54](../design-switch.js:38) | +1 RTT chặn + 1 navigation đầy đủ |
| `new Worker("speedtest_worker.js?r=" + Math.random())` | [speedtest.js:322](../speedtest.js:322) | Worker 29 KB **tải lại mỗi lần test** |
| Server selection: 37 server × tối đa 3 ping | [speedtest.js:236](../speedtest.js:236) | Tới 111 request trước khi test bắt đầu |
| Preflight OPTIONS mỗi POST upload | [empty.php](../backend/empty.php) | +1 RTT/request (§8) |

### Unnecessary rendering
```js
// frontend/javascript/index.js:373 — chạy 60 lần/giây, VÔ ĐIỀU KIỆN:
startButton.textContent = buttonTexts[testState.state];   // ghi DOM
startButton.classList.toggle("disabled", ...);            // ghi DOM
serverSelector.classList.toggle("disabled", ...);         // ghi DOM
gauges.forEach(e => e.classList.toggle("enabled", ...));  // ghi DOM
pingAndJitter.forEach(e => e.classList.toggle(...));      // ghi DOM
shareResults.classList.toggle("hidden", ...);             // ghi DOM
requestAnimationFrame(renderUI);                          // lặp vô hạn
```
6 thao tác DOM × 60fps = **360 lần/giây, kể cả khi màn hình đứng yên**. Chỉ khối bên trong `if (testDataDirty)` là có kiểm tra dirty. Trên thiết bị yếu: nóng máy, hao pin, và **cạnh tranh CPU với chính phép đo**.

### Memory leaks
| Leak | File | Tác động |
|---|---|---|
| Worker không terminate | [speedtest.js:322](../speedtest.js:322) | Rò 1 thread + heap mỗi lần test |
| `performance` entries không bao giờ clear | [speedtest_worker.js:625](../speedtest_worker.js:625) | Buffer tràn → sai số đo (§6) |
| `arraybuffer` giữ 100 MiB/stream | [speedtest_worker.js:374](../speedtest_worker.js:374) | Đỉnh ~500 MB → OOM mobile |
| `stability.html` `allPingData` không giới hạn | [stability.html:387](../stability.html:387) | Test dài → mảng tăng không kiểm soát |

### CPU intensive
| Vấn đề | Vị trí |
|---|---|
| `openssl_random_pseudo_bytes(1MiB)` mỗi request | [garbage.php:56](../backend/garbage.php:56) — server-side |
| Sinh 1 MiB `Math.random()` × 262144 vòng lặp | [speedtest_worker.js:436](../speedtest_worker.js:436) — chặn worker lúc khởi động upload |
| `performance.getEntries()` copy toàn mảng mỗi ping | [speedtest_worker.js:625](../speedtest_worker.js:625) — O(n) mỗi lần |

### Blocking operations
| Vấn đề | Vị trí |
|---|---|
| **XHR đồng bộ** | [design-switch.js:40](../design-switch.js:40) — `xhr.open('GET','config.json', false)` chặn main thread |
| Vòng lặp sinh dữ liệu upload | [speedtest_worker.js:436](../speedtest_worker.js:436) — worker đơ vài chục ms |

---

## Quick Wins (< 1 ngày, tác động ngay)

| # | Việc | File | Kết quả kỳ vọng |
|---|---|---|---|
| 1 | Sửa `time_dlGraceTime: 1.5`, `time_ulGraceTime: 3`, `test_order: "IP_D_U"` | [settings.json](../settings.json) | **Sửa được lỗi accuracy lớn nhất** |
| 2 | Thêm `this.worker.terminate()` trong `onend` | [speedtest.js:337](../speedtest.js:337) | Hết rò thread |
| 3 | Thêm cờ dirty cho phần render không phụ thuộc data | [index.js:373](../frontend/javascript/index.js:373) | Giảm ~90% thao tác DOM |
| 4 | `performance.clearResourceTimings()` trước mỗi phase | [speedtest_worker.js](../speedtest_worker.js) | Sửa lỗi ping |
| 5 | Thêm `Access-Control-Max-Age: 86400` | [empty.php](../backend/empty.php) | Bỏ hầu hết preflight |
| 6 | Bỏ `Content-Encoding: identity` | [speedtest_worker.js:531](../speedtest_worker.js:531) | Bỏ **toàn bộ** preflight |
| 7 | Xoá `background-original.jpeg` (1.2 MB) | `frontend/images/` | Bundle nhẹ hơn |
| 8 | Xoá `frontend/index.html` (file hỏng) | `frontend/` | Bớt footgun |
| 9 | `garbagePhp_chunkSize: 25` cho mobile | [settings.json](../settings.json) | Giảm 75% đỉnh RAM |
| 10 | Sửa `stability_worker.js:181` dùng URL cụ thể | [stability_worker.js:181](../stability_worker.js:181) | Stability test đúng ở nửa sau |

## Medium-term (1–3 tuần, cần refactor)

1. **Bỏ hoàn toàn `design-switch.js` + redirect chain** — WebView chỉ cần 1 UI. Tiết kiệm 1 navigation + 1 blocking XHR.
2. **Chuyển download từ XHR sang `fetch()` + `ReadableStream`** — RAM gần 0, độ phân giải đo tốt hơn `onprogress`.
3. **Thay poll 200ms bằng worker chủ động `postMessage`** — bỏ `setInterval` ở [speedtest.js:342](../speedtest.js:342), worker tự đẩy khi có dữ liệu mới.
4. **Song song hoá server selection** — `CONCURRENCY` 6 → 16, timeout 2000 → 1000ms, thêm progress UI.
5. **Build CSS phẳng** (bỏ nesting native) hoặc thêm PostCSS — bảo đảm chạy trên WebView cũ.
6. **Thêm Resource Timing metrics** (DNS, TCP, TLS) — API đã có, chỉ chưa khai thác (§15 mục 10-12).

## Long-term (1–3 tháng, redesign)

1. **Thay backend PHP bằng Go hoặc Rust** — [speedtest-go](https://github.com/librespeed/speedtest-go) / [speedtest-rust](https://github.com/librespeed/speedtest-rust) tương thích protocol sẵn. **Đây là thay đổi có tác động lớn nhất tới khả năng scale.**
2. **Serve dữ liệu download từ file tĩnh qua `sendfile()`/`X-Accel-Redirect`** — bỏ hẳn PHP khỏi data path. Zero-copy kernel → CPU giảm 10–50×.
3. **Thuật toán đo thích ứng** — tự điều chỉnh số stream và thời lượng theo tốc độ phát hiện được trong 2s đầu.
4. **Tách UI thành component có state machine tường minh** — hiện tại state nằm rải rác trong biến global + CSS class.
5. **Config động từ Control API** thay `settings.json` tĩnh — cho phép tinh chỉnh tham số đo mà không cần release app.

---

# 18. SECURITY

## Review theo từng hạng mục bạn yêu cầu

### CORS
**File:** [garbage.php:35-38](../backend/garbage.php:35), [empty.php:5-9](../backend/empty.php:5), [getIP.php:168-171](../backend/getIP.php:168)

```php
if (isset($_GET['cors'])) {
    header('Access-Control-Allow-Origin: *');    // ← BẤT KỲ origin nào
    header('Access-Control-Allow-Methods: GET, POST');
}
```

**Vấn đề:** `Access-Control-Allow-Origin: *` được bật **chỉ bằng cách thêm `?cors` vào URL**. Bất kỳ website nào trên Internet cũng có thể nhúng script gọi test point của Unitel và tiêu thụ băng thông.

**Tác động:** một trang web độc hại có thể biến mọi khách truy cập thành nguồn tải băng thông từ server Unitel. Không cần exploit gì cả — đây là thiết kế.

**Khắc phục:** allowlist origin cụ thể:
```php
$allowed = ['https://speedtest.unitel.la', 'https://appassets.androidplatform.net'];
if (in_array($_SERVER['HTTP_ORIGIN'] ?? '', $allowed, true)) {
    header('Access-Control-Allow-Origin: ' . $_SERVER['HTTP_ORIGIN']);
    header('Vary: Origin');
}
```
**Ưu tiên: 🔴 Critical**

### HTTPS
- Không có redirect HTTP→HTTPS ở tầng ứng dụng
- [speedtest.js:242](../speedtest.js:242) loại server khác protocol → tránh mixed content, nhưng cách xử lý thô
- **Khuyến nghị:** ép HTTPS + HSTS ở tầng LB/reverse proxy

### WebSocket security
Không dùng WebSocket ⇒ không có bề mặt tấn công này. ✅

### API authentication
**🔴 KHÔNG CÓ AUTHENTICATION Ở BẤT KỲ ĐÂU.** Grep xác nhận: không token, không API key, không session cho các endpoint test. `telemetry.php` nhận POST từ bất kỳ ai.

### Input validation
| Endpoint | Validation | Đánh giá |
|---|---|---|
| `garbage.php` | ✅ Tốt — `ctype_digit` + clamp 1..1024 ([:13-25](../backend/garbage.php:13)) | 🟢 |
| `empty.php` | Không nhận input | 🟢 |
| `getIP.php` | ✅ `filter_var(FILTER_VALIDATE_IP)` ([getIP_util.php:25](../backend/getIP_util.php:25)) | 🟢 |
| `telemetry.php` | 🔴 **Không validate gì cả** — `$_POST['dl']`, `$_POST['log']`… đưa thẳng vào DB ([:15-19](../results/telemetry.php:15)) | 🔴 |

`telemetry.php` dùng prepared statement nên **không SQL injection**, nhưng:
- Không giới hạn độ dài `log` → có thể ghi hàng MB vào DB mỗi request
- Không validate `dl`/`ul`/`ping` là số → có thể lưu chuỗi tuỳ ý
- Không rate limit → **DB fill attack**

### Rate limiting
**🔴 KHÔNG CÓ.** Không ở PHP, không ở Apache config, không ở Docker. Đây là lỗ hổng nghiêm trọng nhất.

### Server abuse / DoS risk / Request flooding

**Kịch bản tấn công cụ thể:**
```bash
# Mỗi request tiêu 1 GiB băng thông ra của Unitel:
for i in $(seq 1 1000); do
  curl "https://speedtest.unitel.la/backend/garbage.php?ckSize=1024" > /dev/null &
done
```
1.000 request song song × 1 GiB = **1 TB băng thông** từ một máy tấn công, **không cần auth**. Server còn phải sinh CSPRNG cho từng cái.

**Khắc phục nhiều tầng:**
1. Token 1 lần dùng từ Control API (`POST /api/v1/session` → nonce có TTL)
2. Rate limit theo IP ở tầng LB: N test/giờ
3. Giới hạn `ckSize` theo token (mobile: 25, desktop: 100)
4. Cap tổng băng thông per-IP per-day
5. Giám sát + cảnh báo khi vượt ngưỡng

**Ưu tiên: 🔴 Critical — phải làm TRƯỚC khi production**

### Origin validation
Không có kiểm tra `Origin`/`Referer` ở bất kỳ endpoint nào.

### WebView bridge security
Hiện chưa có bridge. **Khi xây, phải tuân thủ:**

| Nguyên tắc | Chi tiết |
|---|---|
| `@JavascriptInterface` allowlist | Chỉ annotate method thực sự cần. Trên API < 17 `addJavascriptInterface` cho phép reflection → RCE |
| Không nhận đường dẫn file | Bridge không được có method kiểu `readFile(path)` |
| Validate mọi input | Coi JS như untrusted, kể cả khi HTML là của bạn |
| Giới hạn origin | `WebViewAssetLoader` + kiểm tra `getUrl()` trước khi xử lý bridge call |
| Tắt những gì không cần | `setAllowFileAccess(false)`, `setAllowFileAccessFromFileURLs(false)`, `setAllowUniversalAccessFromFileURLs(false)` |
| `setJavaScriptEnabled(true)` | Bắt buộc, nhưng chỉ trên WebView chỉ load asset nội bộ |

### JavaScript injection
| Vị trí | Đánh giá |
|---|---|
| [index.js:264](../frontend/javascript/index.js:264): `link.innerHTML = server.name + ...` | 🟠 **XSS nếu `server-list.json` bị kiểm soát bởi kẻ tấn công**. Với danh sách tự quản thì rủi ro thấp, nhưng nếu dùng `SERVER_LIST_URL` từ nguồn ngoài thì nghiêm trọng |
| [index.js:334](../frontend/javascript/index.js:334): `sponsor.innerHTML = ...${server.sponsorURL}...` | 🟠 Tương tự — chèn URL vào `href` không qua sanitize |
| [index.js:399-410](../frontend/javascript/index.js:399) | 🟢 Tốt — dùng `createTextNode` cho `clientIp` |
| `index-classic.html` | 🟠 `onclick=` inline → không áp được CSP nghiêm ngặt |

**Khắc phục:** thay `innerHTML` bằng `textContent` + `createElement`, và thêm CSP header.

### Sensitive information exposure
| Vấn đề | File |
|---|---|
| API key ipinfo.io plaintext trong PHP | [getIP_ipInfo_apikey.php:4](../backend/getIP_ipInfo_apikey.php:4) |
| DB credentials plaintext | [telemetry_settings.php:25-35](../results/telemetry_settings.php:25) |
| Stats password so sánh plaintext, **không hash, không rate limit, không CSRF** | `results/stats.php:155` → `$_POST['password'] === $stats_password` |
| `error_reporting(0)` che lỗi | [getIP.php:9](../backend/getIP.php:9), `results/index.php`, `results/json.php` — che cả lỗi cấu hình lẫn dấu hiệu tấn công |

### Environment variables / Secrets
`docker/entrypoint.sh` inject secret bằng `sed` vào file PHP:
```bash
sed -i s/\$MySql_password\ =\ \'.*\'/\$MySql_password\ =\ \'$DB_PASSWORD\''/g ...
```
**Vấn đề:** (a) secret nằm trong process env → đọc được qua `/proc`; (b) ghi vào file trong webroot → nếu PHP handler hỏng, secret lộ dưới dạng text; (c) `sed` không escape → password chứa `/` hoặc `&` làm hỏng file.

**Khắc phục:** đọc secret bằng `getenv()` trực tiếp trong PHP, hoặc dùng Docker secrets / Vault.

## Bảng tổng hợp security

| Rủi ro | Mức | File |
|---|---|---|
| Không rate limit → DoS bằng băng thông | 🔴 Critical | Toàn bộ `backend/` |
| `Access-Control-Allow-Origin: *` | 🔴 Critical | `garbage.php`, `empty.php`, `getIP.php` |
| Không authentication | 🔴 Critical | Toàn bộ |
| `telemetry.php` không validate/giới hạn | 🟠 High | [results/telemetry.php](../results/telemetry.php) |
| Stats password plaintext + không CSRF | 🟠 High | `results/stats.php` |
| Secrets qua `sed` vào webroot | 🟠 High | [docker/entrypoint.sh](../docker/entrypoint.sh) |
| XSS qua `innerHTML` server name | 🟠 High | [index.js:264](../frontend/javascript/index.js:264) |
| `error_reporting(0)` | 🟡 Medium | Nhiều file PHP |
| Không có CSP/HSTS/X-Frame-Options | 🟡 Medium | Toàn bộ HTML |

---

# 19. DEPLOYMENT

## Kiến trúc đề xuất

### Development
```
Máy dev
└── docker compose up
    └── librespeed  MODE=standalone  WEBPORT=8080  TELEMETRY=false
        → http://localhost:8080
        (Không cần DB, không cần LB, không cần CDN)

WebView dev: Android Emulator → http://10.0.2.2:8080
             ⚠ KHÔNG dùng file:// — Worker sẽ chết
```

### Staging
```
                  ┌─ stg-speedtest.unitel.la (HTTPS, Let's Encrypt)
                  │
         ┌────────▼────────┐
         │  nginx (1 VM)   │  reverse proxy + TLS termination
         └───┬─────────┬───┘
             │         │
     ┌───────▼──┐  ┌───▼──────────┐
     │ Frontend │  │ Test point   │  MODE=backend
     │ MODE=    │  │ (1 instance) │
     │ frontend │  └──────────────┘
     └──────────┘
             │
     ┌───────▼────────┐
     │ PostgreSQL     │  telemetry (giống prod, dữ liệu giả)
     └────────────────┘
```

### Production
```
        WebView App (Android/iOS)
                 │ HTTPS + cert pinning
        ┌────────▼─────────────────────────────────┐
        │  DNS: speedtest.unitel.la                │
        │  (GeoDNS nếu có nhiều vùng)              │
        └────────┬─────────────────────────────────┘
                 │
     ┌───────────┼──────────────────┐
     ▼           ▼                  ▼
┌─────────┐ ┌──────────┐  ┌──────────────────────────┐
│  CDN    │ │ Control  │  │  TEST POINTS             │
│ (CHỈ    │ │   API    │  │  ⚠ TUYỆT ĐỐI KHÔNG CDN   │
│ static  │ │  Go, 2+  │  │                          │
│ assets) │ │ instance │  │  ┌─ Vientiane  10 Gbps   │
│         │ │ sau LB   │  │  ├─ Luang Prabang        │
│ HTML/JS │ │          │  │  ├─ Pakse                │
│ CSS/font│ │ /servers │  │  └─ Savannakhet          │
│ /image  │ │ /config  │  │                          │
└─────────┘ │ /session │  │  Go/Rust backend         │
            │ /results │  │  Bare metal, NIC 10G+    │
            └────┬─────┘  │  Peering trực tiếp       │
                 │        └──────────────────────────┘
        ┌────────▼─────────┐
        │  PostgreSQL      │  telemetry (primary + replica)
        │  + Redis         │  rate limit counter, session token
        └──────────────────┘
```

## Trả lời từng câu hỏi của bạn

| Câu hỏi | Trả lời | Lý do từ source |
|---|---|---|
| **Frontend deploy ở đâu?** | CDN / object storage + edge cache | Toàn bộ là file tĩnh, không SSR. `Dockerfile` chỉ `COPY` file |
| **Backend deploy ở đâu?** | Control API: cloud VM/container. **Test point: bare metal gần biên mạng** | Test point cần băng thông thật, không phải VM chia sẻ |
| **Speedtest server deploy ở đâu?** | **Trong mạng Unitel, sát điểm peering.** 3–5 điểm phủ Lào | Mục đích là đo mạng Unitel, không phải đo Internet chung |
| **Có cần CDN không?** | ✅ **CÓ cho static assets** ❌ **TUYỆT ĐỐI KHÔNG cho test endpoint** | [doc.md:927](../doc.md) cảnh báo rõ: Cloudflare làm giảm tốc độ đo |
| **Có cần load balancer không?** | ✅ Cho Control API. 🟡 Cho test point: dùng **DNS round-robin thay vì LB** | LB thành nút cổ chai băng thông. Client tự chọn server theo ping ([speedtest.js:180](../speedtest.js:180)) |
| **Có cần Redis không?** | ✅ **CÓ** — nhưng cho **rate limiting và session token**, không phải cache | Project hiện không có gì cần cache. Nhưng §18 cho thấy rate limit là bắt buộc |
| **Có cần database không?** | 🟡 **Chỉ khi cần lịch sử/telemetry.** `settings.json` mặc định `telemetry_level: "off"` | Nếu lịch sử lưu native trên thiết bị thì **không cần DB** cho MVP |
| **Docker có nên dùng không?** | ✅ Cho Control API + Frontend. 🟠 **Cân nhắc cho test point** | Overhead network namespace của Docker đáng kể ở 10 Gbps. Cân nhắc `--network host` hoặc chạy trực tiếp |
| **Có cần HTTPS không?** | ✅ **BẮT BUỘC** | Mixed content chặn tất cả nếu app dùng HTTPS. Cần TLS 1.3 + session resumption để giảm overhead |
| **WebView kết nối domain nào?** | UI: `https://appassets.androidplatform.net` (asset loader, đóng gói trong app)<br>API: `https://api-speedtest.unitel.la`<br>Test: `https://tp-vte.speedtest.unitel.la` | Đóng gói UI trong app = mở tức thì, không phụ thuộc mạng để hiển thị |

## Docker mode nào dùng cho gì

| Mode | Dùng khi nào |
|---|---|
| `standalone` | Dev, staging đơn giản, POC |
| `backend` | **Test point production** — chỉ endpoint, không UI |
| `frontend` | Không cần — asset đã đóng gói trong app |
| `dual` | Test point chính (Vientiane) nếu muốn có cả web version |

## Cấu hình server bắt buộc (nếu không dùng Docker)

```ini
; PHP - BẮT BUỘC, nếu không upload sẽ fail 413
post_max_size = 32M       ; mặc định 8M < 20MB blob → HỎNG
upload_max_filesize = 32M
max_execution_time = 60
zlib.output_compression = Off   ; garbage.php đã tắt runtime, nhưng nên tắt global
output_buffering = Off
```
Nguồn: [docker/librespeed-php.ini](../docker/librespeed-php.ini) — chỉ áp cho Docker. **Deploy thủ công rất dễ quên và upload sẽ hỏng im lặng.**

---

# 20. SCALABILITY

## Phân tích theo mức tải

Giả định mỗi lượt test: 12s DL + 12s UL. Băng thông tiêu thụ phụ thuộc tốc độ người dùng — đây là điểm mấu chốt: **hệ thống này tiêu thụ băng thông bằng đúng tốc độ mạng của người dùng, không giới hạn.**

### 100 concurrent users

| Tài nguyên | Ước tính | Bottleneck? |
|---|---|---|
| Băng thông | 100 × 50 Mbps TB = **5 Gbps** | 🟡 Cần NIC 10G |
| Kết nối đồng thời | 100 × 8 stream = **800** | 🟢 OK |
| PHP process | 800 (mỗi stream = 1 process với mpm-prefork) | 🔴 **VƯỢT `MaxRequestWorkers` mặc định (256) của Apache** |
| CPU | `openssl_random_pseudo_bytes` × 800 | 🟠 Đáng kể |
| RAM server | 800 × ~30 MB PHP process = **24 GB** | 🔴 **Nút cổ chai đầu tiên** |

**⇒ Bottleneck ở 100 users: mô hình process của Apache+PHP.** Với `mpm-prefork` mặc định, hệ thống sập ở khoảng **~30 concurrent test**.

**Khắc phục:** chuyển sang `mpm-event` + PHP-FPM, tăng `MaxRequestWorkers`, hoặc — tốt hơn — **bỏ PHP khỏi data path**.

### 1.000 concurrent users

| Tài nguyên | Ước tính | Bottleneck? |
|---|---|---|
| Băng thông | **~50 Gbps** | 🔴 Cần nhiều NIC 25G hoặc phân tán |
| Kết nối | **8.000** | 🟠 Cần tuning `somaxconn`, `nf_conntrack` |
| CPU (PHP) | Không khả thi | 🔴 **PHP không thể** |

**⇒ Ở mức này PHP đã không còn khả thi.** Bắt buộc chuyển Go/Rust + `sendfile()`.

### 10.000 concurrent users

| Tài nguyên | Ước tính |
|---|---|
| Băng thông | **~500 Gbps** — vượt xa một site đơn |
| Kiến trúc bắt buộc | 5–10 test point phân tán, mỗi cái NIC 100G |
| Backend | Go/Rust, zero-copy, `SO_REUSEPORT` |
| Kernel tuning | `net.core.somaxconn`, `tcp_max_syn_backlog`, tắt `nf_conntrack` trên data path |

### 100.000 concurrent users

| Thực tế |
|---|
| **~5 Tbps** — vượt tổng dung lượng peering của nhiều nhà mạng cỡ vừa |
| **Đây không còn là bài toán phần mềm, mà là bài toán hạ tầng mạng.** |
| Bắt buộc: nhiều test point/tỉnh, giới hạn tốc độ mỗi test, hàng đợi, và **giảm `time_dl_max` xuống 5-7s** |
| **Câu hỏi thực sự:** Unitel có bao nhiêu thuê bao? Nếu 100k concurrent test là kịch bản thật, cần thiết kế **admission control** (hàng đợi + từ chối lịch sự), không phải scale vô hạn |

## Chiến lược scale từng lớp

| Lớp | Cách scale | Ghi chú từ source |
|---|---|---|
| **Frontend** | CDN + đóng gói trong app | File tĩnh, scale gần như vô hạn, chi phí ~0 |
| **API (Control)** | Stateless → scale ngang sau LB | Cần viết mới; hiện chưa có |
| **Speedtest server** | **Scale ngang bằng nhiều test point + DNS**, KHÔNG bằng LB | [speedtest.js:selectServer](../speedtest.js:180) — client tự phân tải theo ping. LB sẽ thành nút cổ chai băng thông |
| **Bandwidth** | Đây là ràng buộc cứng. Cân nhắc: giảm `time_dl_max`, bật lại `time_auto: true`, giới hạn `ckSize` | `time_auto` hiện **bị tắt** → tốn băng thông tối đa mọi lượt test |
| **CPU** | Bỏ PHP khỏi data path — `sendfile()` file tĩnh hoặc Go/Rust | [garbage.php:56](../backend/garbage.php:56) là điểm nóng |
| **RAM** | PHP-FPM thay prefork; hoặc Go/Rust (goroutine ~2 KB vs process ~30 MB) | Giảm ~1000× |
| **Connections** | `SO_REUSEPORT`, tuning kernel, HTTP/2 (nhưng cẩn thận — HTTP/2 multiplex trên 1 TCP có thể **làm sai phép đo multi-stream**) | ⚠ Điểm này quan trọng: engine dựa vào **nhiều TCP connection độc lập**. HTTP/2 gộp về 1 connection → mất lợi ích multi-stream. **Test point nên dùng HTTP/1.1** |
| **Load balancing** | DNS round-robin / GeoDNS cho test point; L7 LB chỉ cho Control API | |
| **CDN** | Chỉ static. Test point **phải bypass** | [doc.md:927](../doc.md) |
| **Geographic servers** | 3–5 điểm: Vientiane, Luang Prabang, Savannakhet, Pakse | `server-list.json` đã hỗ trợ cấu trúc này |

### ⚠ Cảnh báo quan trọng về HTTP/2

Engine mở 5 kết nối download song song để vượt giới hạn single-flow TCP. **Nếu test point dùng HTTP/2, cả 5 stream sẽ multiplex trên MỘT TCP connection** ⇒ mất hoàn toàn lợi ích multi-stream, và bị head-of-line blocking. **Test point nên ép HTTP/1.1** hoặc chuyển sang thiết kế đo khác.

Đây là điều **không được ghi trong doc.md** nhưng suy ra trực tiếp từ [speedtest_worker.js:369-379](../speedtest_worker.js:369).

---

# 21. RECOMMENDED ARCHITECTURE

Tổng hợp — kiến trúc cuối cùng đề xuất:

```
════════════════════════ CLIENT ════════════════════════

  ┌─ NATIVE SHELL (Android / iOS) ────────────────────┐
  │  • WebViewAssetLoader (BẮT BUỘC, không file://)   │
  │  • Bridge: network info · storage · share · export│
  │  • Cert pinning · WebChromeClient · DownloadListener│
  │                                                     │
  │  ┌─ WEBVIEW ────────────────────────────────────┐ │
  │  │  UI Layer (VIẾT MỚI)                          │ │
  │  │    · 8 screen (§13) · i18n Lao/EN/VI          │ │
  │  │    · Gauge SVG · dirty-flag render (không rAF │ │
  │  │      vô điều kiện)                            │ │
  │  │  ─────────────────────────────────────────────│ │
  │  │  Controller (speedtest.js — refactor)         │ │
  │  │    · FSM · selectServer song song 16          │ │
  │  │    · terminate() worker                       │ │
  │  │  ─────────────────────────────────────────────│ │
  │  │  Engine (speedtest_worker.js — GIỮ + FIX)     │ │
  │  │    · test_order "IP_D_U_P" (idle + loaded)    │ │
  │  │    · grace 1.5s / 3s                          │ │
  │  │    · fetch+ReadableStream cho DL              │ │
  │  │    · getEntriesByName + clearResourceTimings  │ │
  │  └──────────────────────────────────────────────┘ │
  └────────────────────────────────────────────────────┘
            │ HTTPS                    │ HTTPS
            │ (control plane)          │ (data plane, bypass CDN)
════════════▼══════════════════════════▼════════════════
  ┌──────────────────────┐   ┌──────────────────────────┐
  │  CONTROL API (Go)    │   │  TEST POINTS (Go/Rust)   │
  │  · GET  /servers     │   │  · GET  /garbage         │
  │  · GET  /config      │   │  · POST /empty           │
  │  · POST /session ─────────►· GET  /getIP            │
  │  · POST /results     │   │  (validate token)        │
  │  · GET  /results/:id │   │                          │
  │  2+ instance sau LB  │   │  Bare metal · NIC 10-100G│
  └──────┬───────────────┘   │  HTTP/1.1 · sendfile()   │
         │                   │  3-5 vùng, DNS-based     │
  ┌──────▼────────┐          └──────────────────────────┘
  │ PostgreSQL    │  telemetry
  │ Redis         │  rate limit + session token
  └───────────────┘
```

## Ranh giới bảo mật (Security boundaries)

```
┌─ Untrusted ────────────────────────────────────────┐
│  Nội dung WebView, JS, mọi input từ client         │
└────────────────┬───────────────────────────────────┘
                 │ ← Bridge: allowlist method, validate JSON
┌────────────────▼───────────────────────────────────┐
│  Native app — có quyền hệ thống                    │
└────────────────┬───────────────────────────────────┘
                 │ ← HTTPS + cert pinning
┌────────────────▼───────────────────────────────────┐
│  Control API — auth, rate limit, cấp token          │
└────────────────┬───────────────────────────────────┘
                 │ ← Token 1 lần dùng, TTL ngắn
┌────────────────▼───────────────────────────────────┐
│  Test points — validate token, giới hạn ckSize      │
│  Origin allowlist (KHÔNG dùng *)                    │
└─────────────────────────────────────────────────────┘
```

---

# 22. DEVELOPMENT ROADMAP

## Phase 1 — Analysis ✅ (đang hoàn thành)

| | |
|---|---|
| **Mục tiêu** | Hiểu toàn bộ kiến trúc, xác định gap |
| **Task** | Đọc source · trace flow · đánh giá accuracy · đánh giá WebView compat |
| **File liên quan** | Toàn bộ repo |
| **Dependency** | Không |
| **Kết quả** | ✅ Tài liệu này |
| **Risk** | 🟢 Thấp — đã hoàn thành |

## Phase 2 — Architecture (1–2 tuần)

| | |
|---|---|
| **Mục tiêu** | Chốt kiến trúc, API contract, bridge contract, design system |
| **Task** | ① Chốt WebViewAssetLoader vs local server ② Thiết kế OpenAPI cho Control API ③ Định nghĩa bridge interface ④ Design system Unitel (màu, typo, spacing) ⑤ Chốt danh sách test point ⑥ Chọn Go hay Rust |
| **File liên quan** | Tạo mới: `docs/architecture.md`, `docs/api.openapi.yaml`, `docs/bridge.md` |
| **Dependency** | Phase 1 |
| **Kết quả** | Tài liệu kiến trúc được duyệt, không còn câu hỏi mở |
| **Risk** | 🟠 Quyết định sai ở đây tốn rất nhiều thời gian sau. **Đặc biệt: quyết định `file://` sẽ làm hỏng cả dự án** |

## Phase 3 — Backend (3–4 tuần)

| | |
|---|---|
| **Mục tiêu** | Test point chịu tải + Control API |
| **Task** | ① Deploy [speedtest-go](https://github.com/librespeed/speedtest-go) hoặc [speedtest-rust](https://github.com/librespeed/speedtest-rust), verify tương thích protocol ② Serve dữ liệu DL qua `sendfile()` ③ Viết Control API (`/servers`, `/config`, `/session`, `/results`) ④ Redis rate limiting ⑤ CORS allowlist ⑥ Ép HTTP/1.1 ⑦ Load test |
| **File liên quan** | Thay thế `backend/*.php`; tham chiếu contract từ [speedtest_worker.js:48-51](../speedtest_worker.js:48) |
| **Dependency** | Phase 2 |
| **Kết quả** | Test point đạt line rate NIC với CPU < 30%; API có auth + rate limit |
| **Risk** | 🔴 **Cao** — backend Go/Rust phải tương thích *chính xác* protocol client. Sai lệch nhỏ ở `ckSize` handling hoặc chunked encoding sẽ làm sai số đo. **Phải verify bằng so sánh A/B với PHP backend** |

## Phase 4 — Speedtest Engine (2–3 tuần)

| | |
|---|---|
| **Mục tiêu** | Engine chính xác, không rò, an toàn cho mobile |
| **Task** | ① `settings.json`: grace 1.5/3, `test_order: "IP_D_U_P"` ② Sửa Performance API (§6 lỗi #1) ③ `clearResourceTimings()` ④ `terminate()` worker ⑤ `fetch`+`ReadableStream` cho DL ⑥ Bỏ `Content-Encoding` header ⑦ Bổ sung DNS/TCP/TLS timing ⑧ Sửa `stability_worker.js:181` ⑨ Hiệu chuẩn `overheadCompensationFactor` cho mạng Unitel |
| **File liên quan** | [speedtest_worker.js](../speedtest_worker.js), [speedtest.js](../speedtest.js), [stability_worker.js](../stability_worker.js), [settings.json](../settings.json) |
| **Dependency** | Phase 3 (cần backend để verify) |
| **Kết quả** | Sai số < 3% so với `iperf3` trên link tham chiếu |
| **Risk** | 🔴 **Cao nhất trong toàn bộ dự án.** Chuyển XHR→fetch thay đổi cách đếm byte. **Bắt buộc A/B test song song với engine cũ trước khi bỏ engine cũ** |

## Phase 5 — WebView UI (4–5 tuần)

| | |
|---|---|
| **Mục tiêu** | UI mới, WebView-safe, đa ngôn ngữ |
| **Task** | ① 8 screen theo §13 ② Bỏ `design-switch.js` + redirect ③ CSS phẳng (bỏ nesting) ④ Gauge SVG ⑤ Render dirty-flag ⑥ i18n Lao/EN/VI ⑦ Accessibility ⑧ Inline critical CSS ⑨ Thay `alert()` bằng error screen |
| **File liên quan** | Thay thế `index*.html`, `frontend/`; xoá `design-switch.js`, `config.json`, `frontend/index.html` |
| **Dependency** | Phase 2 (design system), Phase 4 (engine API) |
| **Kết quả** | First paint < 300ms; chạy đúng trên WebView 90+ |
| **Risk** | 🟠 Nguy cơ scope creep. Cần chốt design trước khi code |

## Phase 6 — Integration (2–3 tuần)

| | |
|---|---|
| **Mục tiêu** | Native ↔ WebView ↔ Backend hoạt động end-to-end |
| **Task** | ① Setup `WebViewAssetLoader` ② Bridge: network info, storage, share, export ③ Cert pinning ④ `WebChromeClient` + `DownloadListener` ⑤ Lịch sử qua SQLite native ⑥ Xử lý mất mạng/background ⑦ Phát hiện VPN |
| **File liên quan** | Code native mới + JS bridge client |
| **Dependency** | Phase 4, 5 |
| **Kết quả** | App chạy trọn vẹn trên thiết bị thật |
| **Risk** | 🔴 **Bridge security.** `@JavascriptInterface` sai cách = RCE. Phải security review riêng |

## Phase 7 — Testing (2–3 tuần, chồng lấn Phase 6)

| | |
|---|---|
| **Mục tiêu** | Xác minh chính xác, không chỉ "chạy được" |
| **Task** | Xem §23 chi tiết |
| **File liên quan** | Mở rộng `tests/e2e/`; thêm `tests/accuracy/` |
| **Dependency** | Phase 4, 5, 6 |
| **Kết quả** | Accuracy test tự động trong CI |
| **Risk** | 🟠 Accuracy test cần môi trường lab có kiểm soát (traffic shaping) |

## Phase 8 — Performance optimization (2 tuần)

| | |
|---|---|
| **Mục tiêu** | Nhẹ, mát, ít pin trên thiết bị tầm thấp |
| **Task** | ① Profile trên thiết bị low-end ② Tối ưu render ③ Tối ưu bundle ④ Kernel tuning phía server ⑤ Load test 100/1k/10k |
| **File liên quan** | Toàn bộ frontend + config server |
| **Dependency** | Phase 5, 6 |
| **Kết quả** | Không tăng nhiệt bất thường; CPU < 20% khi test |
| **Risk** | 🟡 |

## Phase 9 — Security (2 tuần)

| | |
|---|---|
| **Mục tiêu** | Đóng toàn bộ lỗ hổng ở §18 |
| **Task** | ① Rate limiting production ② CORS allowlist ③ Session token ④ Bridge security audit ⑤ Secrets ra khỏi file ⑥ CSP/HSTS ⑦ Pen test |
| **File liên quan** | Backend, entrypoint, native bridge |
| **Dependency** | Phase 3, 6 |
| **Kết quả** | Pen test pass; không critical finding |
| **Risk** | 🔴 **Nếu bỏ qua phase này, test point sẽ bị lạm dụng trong vòng vài ngày sau khi public** |

## Phase 10 — Production (2–3 tuần)

| | |
|---|---|
| **Mục tiêu** | Rollout an toàn, có thể rollback |
| **Task** | ① Deploy test point từng vùng ② Monitoring + alerting ③ Canary 5% người dùng ④ So sánh với baseline ⑤ Rollout dần ⑥ Runbook |
| **File liên quan** | Deployment config, monitoring |
| **Dependency** | Tất cả |
| **Kết quả** | Production ổn định, có dashboard |
| **Risk** | 🟠 Cần feature flag để rollback nhanh |

**Tổng thời gian ước tính: 20–28 tuần** (5–7 tháng) với team 3–5 người. Có thể rút ngắn nếu bỏ Phase 3 (giữ PHP) — nhưng khi đó **chấp nhận trần scale ~30 concurrent test**.

---

# 23. TEST PLAN

## Functional testing

| Test case | Tiêu chí pass |
|---|---|
| Test hoàn tất đủ 4 phase (I/P/D/U) | Tất cả 4 chỉ số có giá trị hợp lệ |
| Hủy giữa chừng ở từng phase | Test dừng sạch, không rò worker, UI về Ready |
| Chạy lại nhiều lần liên tiếp (× 20) | Không tăng RAM tuyến tính, không rò thread |
| Đổi server thủ công | Test dùng đúng server đã chọn |
| Không server nào tới được | **Hiện error screen, KHÔNG `alert()`** |
| Server chết giữa test | `xhr_ignoreErrors: 1` restart, kết quả vẫn hợp lệ |
| Upload bị 413 | Thông báo lỗi cụ thể, không báo "Fail" mơ hồ |
| Telemetry off | Không có request nào tới `/results` |

## Network testing

| Môi trường | Kỳ vọng | Ghi chú |
|---|---|---|
| **WiFi 802.11ac/ax** | Sai số < 5% vs iperf3 | Baseline chính |
| **Ethernet 1 Gbps** | Sai số < 3%; **kiểm tra RAM không vượt 300 MB** | Điểm dễ lộ lỗi OOM (§7) |
| **Ethernet 10 Gbps** | Kiểm tra engine có đạt được không | Có thể cần > 5 stream |
| **4G LTE** | Sai số < 10%; ping ổn định | Kiểm tra `xhr_ul_blob_megabytes` bị ép 4MB |
| **5G NR** | Kiểm tra không bị trần bởi client | Latency thấp → lộ bug sàn 1ms |
| **Slow network (1 Mbps)** | Test không timeout; grace time không reset sai | [worker:397](../speedtest_worker.js:397): `if (totLoaded > 0)` bảo vệ trường hợp này |
| **Unstable network** | Restart stream hoạt động, không treo | |
| **High latency (500ms+, vệ tinh)** | Ping không timeout; **preflight overhead lộ rõ** (§8) | Quan trọng để verify fix CORS |
| **Packet loss 1–5%** | Số liệu vẫn hợp lý, không NaN | |
| **VPN** | **Phát hiện và cảnh báo** | Tính năng mới |
| **Proxy (HTTP/SOCKS)** | Phát hiện hoặc ít nhất không cho kết quả sai im lặng | |

## Performance testing

- Profile CPU/RAM trên thiết bị low-end (2 GB RAM, Android 9)
- Đo mức tiêu thụ pin cho 10 lần test liên tiếp
- Kiểm tra nhiệt độ thiết bị
- Frame rate UI trong lúc test (mục tiêu: không drop dưới 30fps)
- Thời gian từ mở app tới nút START active (mục tiêu < 500ms)

## Accuracy testing ⭐ (quan trọng nhất, hiện đang thiếu hoàn toàn)

| Phương pháp | Cách làm |
|---|---|
| **Baseline iperf3** | Chạy iperf3 và speedtest song song trên cùng link, so sánh. **Đây là test quan trọng nhất và project hiện KHÔNG có** |
| **Traffic shaping** | `tc netem` giới hạn chính xác 10/50/100/500/1000 Mbps → verify engine báo đúng |
| **Latency injection** | `tc netem delay 100ms` → verify ping báo ~100ms |
| **Jitter injection** | `tc netem delay 100ms 20ms` → verify jitter |
| **Packet loss injection** | `tc netem loss 2%` → verify stability test |
| **Regression accuracy** | Chạy sau mỗi commit vào engine, fail CI nếu lệch > 3% |
| **A/B engine cũ vs mới** | Bắt buộc khi chuyển XHR→fetch |

## WebView testing

| Test | Lý do |
|---|---|
| Android System WebView 90 / 100 / 112 / latest | **112 là mốc CSS nesting** |
| iOS WKWebView 14 / 15 / 16 / latest | |
| **Verify Worker khởi tạo được** | Blocker #1 |
| Verify CSS render đúng (screenshot diff) | Bắt lỗi nesting |
| Verify bridge call 2 chiều | |
| App bị background giữa test | Worker có bị suspend không? |
| Xoay màn hình giữa test | WebView có bị recreate không? |
| Đổi mạng giữa test (WiFi→4G) | |
| Chế độ tiết kiệm pin | Throttle timer ảnh hưởng gì |

## Mobile testing
- Android 9 / 11 / 13 / 14+ trên thiết bị low/mid/high-end
- iOS 14 / 15 / 16 / 17+
- Màn hình nhỏ (< 5"), tablet, notch/dynamic island
- Chế độ tối / sáng, cỡ chữ hệ thống lớn
- TalkBack / VoiceOver

## Desktop testing
- Chrome / Firefox / Safari / Edge (2 phiên bản gần nhất)
- Zoom 50% → 200%
- Multi-monitor với DPI khác nhau

## Stress testing

| Kịch bản | Mục tiêu |
|---|---|
| 100 concurrent test | Xác định breaking point thực tế |
| 1.000 concurrent | Verify Go/Rust backend |
| Test point bị flood (mô phỏng tấn công §18) | Rate limit có hoạt động không |
| Chạy test liên tục 24h | Rò bộ nhớ dài hạn |
| Ngắt kết nối đột ngột × 100 lần | Cleanup có đúng không |

## Security testing
- Pen test toàn bộ endpoint (không auth, rate limit, CORS)
- Bridge fuzzing (gửi JSON dị dạng qua bridge)
- XSS qua `server-list.json` độc hại
- MITM với cert giả (verify pinning)
- Kiểm tra secrets không lộ trong bundle app

## Regression testing
- Mở rộng 7 spec Playwright hiện có
- **Thêm accuracy regression suite** (hiện hoàn toàn không có)
- Visual regression cho UI (screenshot diff)
- Chạy toàn bộ trên CI mỗi PR

---

# 24. FILES REQUIRING CHANGES

| File | Hiện trạng | Cần sửa? | Mức độ | Lý do |
|---|---|---|---|---|
| [settings.json](../settings.json) | `time_dlGraceTime:0`, `time_ulGraceTime:0`, `test_order:"ID_U_P"` | ✅ **CÓ** | 🔴 Critical | Làm sai lệch **cả 3 chỉ số**. Sửa 3 giá trị là thu hẹp phần lớn khoảng cách accuracy với speedtest.net |
| [speedtest_worker.js:623-631](../speedtest_worker.js:623) | `performance.getEntries()` lấy entry cuối | ✅ **CÓ** | 🔴 Critical | Buffer 250 entry tràn sau DL/UL → ping đọc entry rác, luôn lệch về phía thấp |
| [server-list.json](../server-list.json) | 37 server cộng đồng quốc tế | ✅ **CÓ** | 🔴 Critical | Đo tới Amsterdam/LA thay vì mạng Unitel; gửi traffic khách hàng ra bên thứ ba |
| [backend/garbage.php](../backend/garbage.php) | PHP sinh + echo dữ liệu | ✅ **CÓ** (thay thế) | 🔴 Critical | Trần scale ~30 concurrent. Cần Go/Rust + `sendfile()` |
| [backend/empty.php](../backend/empty.php) | `ACAO: *`, thiếu `Max-Age` | ✅ **CÓ** | 🔴 Critical | CORS wildcard = ai cũng dùng được; thiếu Max-Age = preflight mỗi request |
| [backend/getIP.php](../backend/getIP.php) | `ACAO: *`, `error_reporting(0)` | ✅ **CÓ** | 🟠 High | Như trên |
| [design-switch.js](../design-switch.js) | XHR đồng bộ + redirect toàn trang | ✅ **XOÁ** | 🔴 Critical | Chặn main thread + 2 navigation. WebView chỉ cần 1 UI |
| [index.html](../index.html) | Chỉ là redirector | ✅ **THAY** | 🔴 Critical | Phải là trang thật, không redirect |
| [speedtest.js:322](../speedtest.js:322) | Worker không `terminate()` | ✅ **CÓ** | 🟠 High | Rò thread mỗi lần test |
| [speedtest.js:284](../speedtest.js:284) | `CONCURRENCY = 6`, timeout 2000ms | ✅ **CÓ** | 🟠 High | Chờ tới 36s trước khi test được |
| [speedtest_worker.js:374](../speedtest_worker.js:374) | `responseType = "arraybuffer"` | ✅ **CÓ** | 🟠 High | OOM mobile ở link nhanh |
| [speedtest_worker.js:531](../speedtest_worker.js:531) | `Content-Encoding: identity` | ✅ **XOÁ** | 🟠 High | Gây preflight trên mọi POST cross-origin |
| [stability_worker.js:181](../stability_worker.js:181) | Cùng bug Performance API | ✅ **CÓ** | 🟠 High | Nửa sau bài test 60s cho số liệu vô nghĩa |
| [frontend/javascript/index.js:373](../frontend/javascript/index.js:373) | rAF ghi DOM vô điều kiện | ✅ **CÓ** | 🟠 High | 360 thao tác DOM/giây khi idle |
| [frontend/javascript/index.js:264](../frontend/javascript/index.js:264) | `innerHTML` với `server.name` | ✅ **CÓ** | 🟠 High | XSS nếu server list từ nguồn ngoài |
| [frontend/javascript/index.js:180](../frontend/javascript/index.js:180) | `alert()` khi lỗi | ✅ **THAY** | 🔴 Critical | Bị nuốt trong WebView → màn hình đơ im lặng |
| [frontend/styling/*.css](../frontend/styling/index.css) | CSS Nesting native | ✅ **CÓ** | 🟠 High | Vỡ layout trên WebView < 112 |
| [frontend/index.html](../frontend/index.html) | Tham chiếu `speedtest.js` sai đường dẫn → 404 | ✅ **XOÁ** | 🟡 Medium | File chết, vẫn được Docker deploy |
| `frontend/images/background-original.jpeg` | 1.2 MB, không dùng | ✅ **XOÁ** | 🟡 Medium | Rác trong bundle |
| [index-classic.html](../index-classic.html) | UI cũ, JS inline, `onclick=` | ✅ **XOÁ** hoặc giữ cho web | 🟡 Medium | Không dùng cho WebView; chặn CSP |
| [index-modern.html](../index-modern.html) | UI mới | ✅ **THAY** | 🟠 High | Làm nền cho UI Unitel |
| [config.json](../config.json) | Cờ chọn design | ✅ **XOÁ** | 🟡 Medium | Không cần khi chỉ có 1 UI |
| [docker/entrypoint.sh](../docker/entrypoint.sh) | Config bằng `sed`, secrets vào webroot | ✅ **CÓ** | 🟠 High | Dễ vỡ; secrets lộ nếu PHP handler hỏng |
| [results/telemetry.php](../results/telemetry.php) | Không validate, không giới hạn | ✅ **CÓ** | 🟠 High | DB fill attack |
| `results/stats.php` | Password plaintext, không CSRF/rate limit | ✅ **CÓ** | 🟠 High | Brute force được |
| [results/telemetry_settings.php](../results/telemetry_settings.php) | Credentials plaintext | ✅ **CÓ** | 🟠 High | Dùng env/secret manager |
| [backend/getIP_ipInfo_apikey.php](../backend/getIP_ipInfo_apikey.php) | API key plaintext | ✅ **CÓ** | 🟡 Medium | Như trên |
| [speedtest_worker.js:252](../speedtest_worker.js:252) | `runNextTest = null` tạo global | ✅ **CÓ** | 🟢 Low | Code sai nhưng vô hại |
| [speedtest_worker.js:636](../speedtest_worker.js:636) | Sàn cứng 1ms | 🟡 Cân nhắc | 🟢 Low | Chặn đo mạng nội bộ |
| [speedtest_worker.js:63](../speedtest_worker.js:63) | `overheadCompensationFactor: 1.06` | 🟡 Hiệu chuẩn | 🟡 Medium | Cần đo thực tế trên mạng Unitel |
| `tests/e2e/*` | Chỉ smoke test | ✅ **MỞ RỘNG** | 🟠 High | **Không có accuracy test nào** |
| [manifest.webmanifest](../manifest.webmanifest) | PWA manifest | 🟡 Giữ cho web | 🟢 Low | Vô nghĩa trong WebView |
| [package.json](../package.json) | `"test"` = echo, eslint 8 config | ✅ **CÓ** | 🟢 Low | Script test giả |

**Tổng: 🔴 8 Critical · 🟠 14 High · 🟡 7 Medium · 🟢 4 Low**

---

# 25. RISKS

| # | Rủi ro | Xác suất | Tác động | Giảm thiểu |
|---|---|---|---|---|
| 1 | **Quyết định dùng `file://` cho WebView** → Worker chết, phát hiện muộn | Trung bình | 🔴 Nghiêm trọng — phải làm lại toàn bộ tầng shell | Verify Worker khởi tạo được **ngay trong tuần đầu Phase 2**, trước mọi việc khác |
| 2 | **Backend Go/Rust không tương thích chính xác protocol** → số đo lệch mà không ai phát hiện | Trung bình | 🔴 Nghiêm trọng — sai số vào production | A/B test song song PHP vs Go trên cùng link; accuracy regression trong CI |
| 3 | **Chuyển XHR→fetch làm đổi cách đếm byte** → số đo lệch | Cao | 🟠 Cao | Chạy song song 2 engine, so sánh trên nhiều loại link trước khi bỏ engine cũ |
| 4 | **Test point bị lạm dụng** ngay sau khi public (§18) | **Rất cao nếu không có rate limit** | 🔴 Nghiêm trọng — mất băng thông, chi phí | **Phase 9 KHÔNG được bỏ qua.** Rate limit phải có từ ngày public đầu tiên |
| 5 | **Sửa `settings.json` làm kết quả "thay đổi"** → khách hàng thắc mắc | Cao | 🟠 Cao — vấn đề truyền thông | Truyền thông rõ: "cải thiện độ chính xác". Giữ dữ liệu cũ để so sánh. Rollout canary |
| 6 | **HTTP/2 làm hỏng multi-stream** mà không ai nhận ra | Trung bình | 🟠 Cao — download báo thiếu | Ép HTTP/1.1 trên test point; verify bằng `curl --http1.1` vs `--http2` |
| 7 | **CSS nesting vỡ trên WebView cũ** phát hiện sau khi release | Trung bình | 🟠 Cao — UI vỡ hoàn toàn | Test trên WebView 90-100 trong Phase 5; hoặc build CSS phẳng ngay |
| 8 | **OOM trên thiết bị tầm thấp** ở link gigabit | Trung bình | 🟠 Cao — app crash | Giảm `ckSize` + chuyển sang streaming trong Phase 4 |
| 9 | **Bridge security hole** → RCE | Thấp nhưng nghiêm trọng | 🔴 Nghiêm trọng | Security review riêng cho bridge; allowlist chặt |
| 10 | **Băng thông vượt dự toán** ở scale | Cao | 🟠 Cao — chi phí | Bật `time_auto: true`, giảm `time_dl_max`, admission control |
| 11 | **Scope creep ở Phase 5 (UI)** | Cao | 🟡 Trung bình — chậm tiến độ | Chốt design trước khi code; MVP trước, tính năng sau |
| 12 | **Upstream LibreSpeed thay đổi**, fork phân kỳ | Trung bình | 🟡 Trung bình | Giữ engine gần upstream nhất có thể; tách phần tuỳ biến ra file riêng |
| 13 | **PHP `post_max_size` mặc định 8M** làm upload hỏng im lặng khi deploy thủ công | Cao | 🟠 Cao | Health check kiểm tra POST 20MB; document rõ; dùng Docker |
| 14 | **INSUFFICIENT EVIDENCE: tải thực tế của Unitel** | — | — | Chưa có dữ liệu về số thuê bao, tỉ lệ dùng, peak concurrent. **Cần con số này để chốt sizing ở Phase 2** — mọi ước tính scale ở §20 là giả định |
| 15 | **INSUFFICIENT EVIDENCE: platform target** | — | — | Chưa rõ Android/iOS/cả hai, WebView version tối thiểu, có app sẵn hay build mới. Ảnh hưởng trực tiếp Phase 5-6 |

---

# 26. FINAL RECOMMENDATION

## Trả lời câu hỏi trung tâm

> **"Project Speedtest hiện tại có đủ tốt để đưa lên WebView hay chưa, cần thay đổi những gì, và kiến trúc cuối cùng nên được xây dựng như thế nào?"**

### ① Đủ tốt chưa? — **CHƯA, nhưng nền tảng đúng và khoảng cách nhỏ hơn bạn nghĩ.**

LibreSpeed là lựa chọn **đúng** làm nền. Engine 734 dòng, không dependency, đã production nhiều năm. Vấn đề **không nằm ở kiến trúc engine** — mà ở:
- **3 giá trị sai trong `settings.json`** (sửa trong 5 phút, tác động lớn nhất)
- **1 bug Performance API** (sửa trong 1 giờ)
- **1 ràng buộc WebView cứng** (`file://` không chạy Worker — quyết định kiến trúc, không phải code)
- **Backend PHP không scale** (thay bằng Go/Rust đã có sẵn)

### ② Cần thay đổi gì? — Theo thứ tự ưu tiên

**Tuần 1 — làm ngay, chi phí gần bằng 0, tác động lớn nhất:**
1. `settings.json`: `time_dlGraceTime: 1.5`, `time_ulGraceTime: 3`, `test_order: "IP_D_U"`
2. Sửa `performance.getEntries()` → `getEntriesByName(url)` + `clearResourceTimings()`
3. Thêm `worker.terminate()`
4. Thay `server-list.json` bằng test point Unitel
5. **Verify `new Worker()` chạy được trong WebView target của bạn** ← làm trước mọi thứ khác

**Tháng 1-2 — kiến trúc:**
6. `WebViewAssetLoader`, bỏ `design-switch.js` và redirect chain
7. Control API + rate limiting (Redis)
8. CORS allowlist thay `*`

**Tháng 2-4 — engine + UI:**
9. Backend Go/Rust cho test point
10. `fetch`+`ReadableStream` cho download
11. UI mới theo §13, CSS phẳng, i18n

**Tháng 4-6 — hoàn thiện:**
12. Native bridge (network info là tính năng khác biệt lớn nhất)
13. Accuracy test suite
14. Security hardening + pen test

### ③ Kiến trúc cuối cùng

Xem §21. Ba nguyên tắc chi phối:

1. **Engine ở lại WebView, không đưa xuống native.** Phải đo từ đúng network stack mà người dùng dùng, và cần iterate nhanh không qua app store.
2. **Data plane tách hoàn toàn khỏi control plane.** Test point không đi qua CDN, không qua LB, dùng HTTP/1.1, có token. Control API đi qua LB bình thường.
3. **Native chỉ làm những gì JS không làm được:** thông tin mạng, lưu trữ bền, chia sẻ, xuất file, cert pinning.

## Ba quyết định cần chốt trước khi bắt đầu

1. **Platform target và WebView version tối thiểu** — quyết định có phải viết lại CSS không (mốc: WebView 112)
2. **Số liệu tải thực tế của Unitel** (thuê bao, peak concurrent dự kiến) — quyết định có cần bỏ PHP ngay hay để sau
3. **Go hay Rust cho test point** — cả hai đều có implementation LibreSpeed tương thích sẵn

## Điều quan trọng nhất tôi muốn bạn nhớ

**Đừng cố thắng speedtest.net ở việc đo tốc độ đỉnh.** Họ có 15 năm hiệu chuẩn và 16.000 server — bạn không thắng ở đó, và cũng không cần.

**Bạn thắng ở chỗ họ không thể chạm tới:** test point *bên trong* mạng Unitel, thông tin sóng 4G/5G thời gian thực, stability test dài hạn có packet loss, tách bạch tốc độ nội mạng và quốc tế, không quảng cáo, dữ liệu không rời khỏi Lào, và tích hợp thẳng vào quy trình hỗ trợ khách hàng.

`stability.html` đang nằm im trong repo này — **đó mới là tính năng khác biệt lớn nhất của bạn**, và speedtest.net không có nó trên web.

---

**Tôi chưa sửa bất kỳ file nào. Working tree vẫn sạch (`git status` = clean).**

---

**Bạn có muốn tôi chuyển sang Phase 2 — thiết kế kiến trúc WebView và kế hoạch implementation không?**

Nếu có, tôi đề nghị bắt đầu bằng 3 việc theo thứ tự:
1. **Verify `new Worker()` trong WebView target** — đây là blocker có thể làm đổi toàn bộ kiến trúc, phải biết trước
2. **Thiết kế API contract** (OpenAPI cho Control API + bridge interface)
3. **Sửa 4 lỗi accuracy** ở §24 để có baseline đo tin cậy trước khi xây tiếp

Bạn cũng có thể cho tôi biết 3 thông tin còn thiếu ở §25 (platform target, WebView version tối thiểu, quy mô tải dự kiến) để tôi làm chính xác hơn ngay từ đầu.