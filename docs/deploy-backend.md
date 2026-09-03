# Triển khai test server

Runbook dựng backend đo tốc độ cho miniapp. Mọi lệnh và mọi con số kiểm chứng ở
đây đều đã chạy thật trên stack này, không phải suy luận.

Trước khi bắt đầu, đọc [architecture.md §3](architecture.md) về **vì sao** test
server phải công khai và trung lập — đặt sai chỗ thì số đo vẫn ra, chỉ là vô
nghĩa cho việc so ba nhà mạng.

---

## 0 · Chuẩn bị

| Hạng mục | Yêu cầu |
|---|---|
| Máy | Linux, Docker + Docker Compose |
| Băng thông | **≥ 1 Gbps uplink** — đây là trần của phép đo. Server 100 Mbps thì không bao giờ đo được quá 100 Mbps |
| Mạng | IP công khai, mở port **80** và **443** |
| Tên miền | A record trỏ về IP đó |
| Vị trí | **Trung lập** — không nằm trong mạng Unitel, nếu số liệu dùng để so 3 nhà mạng |

Ước tính lưu lượng: ~90 MB mỗi lần đo (giả định 50 Mbps xuống / 10 Mbps lên, 12
giây mỗi chiều) ⇒ 100 lượt/ngày ≈ 9 GB/ngày.

## 1 · Lấy mã nguồn

```bash
git clone https://github.com/bug-createdme/speedtest.git
cd speedtest
git submodule update --init backend-go
```

`backend-go` là **submodule**. Bỏ qua dòng thứ ba thì build fail ngay.

## 2 · Tạo hai tệp mẫu cho bài đo Web và Video

```bash
node scripts/make-test-assets.js
```

Máy chủ không có Node cũng được — chạy ở máy khác rồi copy thư mục `test-assets/`
lên. Tệp video cần `ffmpeg`; script in sẵn lệnh, kèm `-movflags +faststart`
(thiếu cờ đó thì video không phát được cho tới khi tải xong cả tệp, và **mọi
phép đo sẽ đọc thành một lần buffer dài**).

Không có hai tệp này thì bài Web và Video báo `Skip` — mất **2 trong 5 chỉ tiêu**.
Chi tiết: [test-assets.md](test-assets.md).

## 3 · Chứng chỉ TLS

```bash
sudo certbot certonly --standalone -d speedtest.example.la
```

Chứng chỉ nằm ở `/etc/letsencrypt/live/speedtest.example.la/`. Mount **thư mục
live**, đừng copy — certbot gia hạn tại chỗ, bản copy sẽ tiếp tục phục vụ chứng
chỉ hết hạn cho tới khi có người phát hiện.

## 4 · Cấu hình

```bash
export SPEEDTEST_STATISTICS_PASSWORD='<mat khau that>'
export SPEEDTEST_SERVER_NAME='speedtest.example.la'
export SPEEDTEST_CERT_DIR='/etc/letsencrypt/live/speedtest.example.la'
export SPEEDTEST_ALLOWED_ORIGIN_REGEX='^https://[0-9]+[.]app[.]mini[.]windvane[.]suite[.]emas[.]alibaba[.]com$'
```

> ⚠ **Viết dấu chấm là `[.]`, đừng `\.`** Git Bash trên Windows đổi `\` thành `/`
> trên đường vào docker; regex thành vô nghĩa và **chặn mọi origin, kể cả origin
> đúng**. Fail-closed nên không hở bảo mật, nhưng đủ mất một buổi chiều.

Còn một chỗ phải sửa tay: trong `docker/nginx-speedtest-endpoints.conf`, đổi
`allow 10.0.0.0/8` thành **dải mạng thật của phòng vận hành**. Dải mặc định
không khớp ai trên máy công khai, nên trang thống kê sẽ đóng — an toàn, nhưng
cũng không ai vào được.

## 5 · Khởi động

```bash
docker compose -f docker-compose.backend-go.yml --profile tls up -d --build
```

Không chọn profile thì chỉ `backend-go` chạy, và nó **không publish cổng nào** —
bất tiện, nhưng đó là chiều an toàn. Bản `--profile dev` chạy HTTP trần trên
:8087, chỉ dùng để kiểm chứng cục bộ.

## 6 · Kiểm chứng

Sáu lệnh dưới đây là bộ đã dùng để nghiệm thu stack này.

```bash
H=https://speedtest.example.la
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$H/garbage.php?ckSize=1&cors=true"
```

Phải ra **`200 1048576`**.

> Chạy ngay sau `up -d` có thể ra `200 0` hoặc một con số ngắn hơn: request đầu
> tiên bị cắt trong lúc container còn khởi động (thấy rõ trên Docker Desktop /
> Windows). Đợi vài giây rồi chạy lại — từ request thứ hai trở đi luôn đủ byte.
> Ra ngắn **liên tục** thì mới là lỗi thật.

Rồi:

| Lệnh | Kết quả đúng |
|---|---|
| `curl -sD- -o/dev/null -H "Origin: https://1512092451476390944768.app.mini.windvane.suite.emas.alibaba.com" "$H/empty.php?cors=true" \| grep -ci '^access-control-allow-origin'` | **`1`** |
| `curl -sD- -o/dev/null -H "Origin: https://evil.example" "$H/empty.php?cors=true" \| grep -ci '^access-control-allow-origin'` | **`0`** |
| `curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS -H "Origin: https://1512092451476390944768.app.mini.windvane.suite.emas.alibaba.com" "$H/empty.php"` | **`204`** |
| `curl -s -o /dev/null -w '%{http_code}\n' "$H/stats.php"` | **`403`** |
| `curl -s -o /dev/null -w '%{http_code}\n' "$H/"` | **`404`** |
| `curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$H/browse-sample.html"` | **`200 1048576`** |

**Số header `Access-Control-Allow-Origin` phải đúng bằng 1.** Ra `2` là trình
duyệt từ chối *mọi* phản hồi và mọi phép đo hỏng — backend-go tự gửi `*`, nginx
gỡ đi rồi phát lại theo allowlist; hỏng bước đó là hai header.

Cuối cùng, xác nhận backend không lọt ra ngoài:

```bash
docker compose -f docker-compose.backend-go.yml --profile tls ps
```

`backend-go` phải hiện `8087/tcp, 8989/tcp` — **không** có `0.0.0.0:`. 8989 là `EXPOSE`
mặc định của image upstream, chỉ là metadata; cổng backend thực sự lắng nghe do
`docker/backend-go.settings.toml` quyết định. Thứ phải kiểm là không có `0.0.0.0:`
— không cổng nào của backend lọt ra host.

## 7 · Nối miniapp vào server

```bash
cp server-list.prod.example.json server-list.prod.json
```

Sửa `server` thành `https://speedtest.example.la/`, rồi điền vào `settings.json`:

```json
"url_browse": "https://speedtest.example.la/browse-sample.html",
"video_url":  "https://speedtest.example.la/video-sample.mp4"
```

Đóng gói:

```bash
SPEEDTEST_SERVER_LIST=server-list.prod.json npm run build:mini
```

**Đừng dùng `SPEEDTEST_ALLOW_INSECURE_SERVERS=1`** cho bản lên super-app. Cờ đó
chỉ để smoke-test biên dịch; nó tạo ra đúng bản không chạy được mà guard đang
chặn.

---

## 8 · Xuất file trên Android (`backend/export.php`)

Trên Android **không có cách nào lấy file ra từ phía client**, và đây không phải
lỗi code:

- Android WebView không có Web Share API (đó là tính năng của Chrome, không phải
  của WebView) — nên `navigator.share` không tồn tại. iOS chạy được chỉ vì
  WKWebView **có** nó.
- Container chặn tải `blob:`.
- `WVFile.write` trả `{msg: "Please apply for JSAPI authorization"}` — API có
  thật, nhưng appId của miniapp chưa nằm trong allowlist của container. Chỉ đội
  super-app cấp được.

Nên bản xuất được **upload lên `backend/export.php`**, rồi miniapp chia sẻ link
qua `CustomServiceJs.shareContent` — API này đã được cấp quyền sẵn.
`Content-Disposition` làm mọi trình duyệt lưu thành file, đúng định dạng, cả
`.csv` lẫn `.xlsx`.

Điền vào `settings.json`:

```json
"export_endpoint": "https://speedtest.example.la/export.php"
```

**Để rỗng là tắt hẳn tính năng** — và Android lại không xuất file được. Rỗng là
mặc định có chủ ý: một deployment chưa dựng endpoint này thì không nên POST dữ
liệu thuê bao đi đâu cả.

### Vì sao có container PHP đứng cạnh container Go

`backend-go` là **git submodule** của `librespeed/speedtest-go`, account này
không push được (403). Commit `d2f68f4` đã gỡ hai bản vá cục bộ đúng vì lý do
đó — gitlink trỏ vào commit chỉ tồn tại trên một máy thì không clone nào fetch
được — và `architecture.md` ghi thành luật: **không patch vào submodule**.

Nên endpoint nằm ở `backend/export.php`, chạy bằng một service `php:8.3-fpm-alpine`
stock trong `docker-compose.backend-go.yml`. Tốn một container, không fork gì cả.
nginx route `/export.php` sang đó bằng `fastcgi_pass` (xem
`docker/nginx-speedtest-endpoints.conf`).

### `SPEEDTEST_EXPORT_BASE_URL` — bắt buộc trên host thật

Để trống thì `export.php` dựng link từ chính request nó nhận được (host +
`SCRIPT_NAME`). Chỉ đúng khi path máy khách gọi trùng path container nhìn thấy.
**Ở đây không trùng**: test point công bố ở `https://be-unitel.laoone.la/speedtest/`,
trong khi mọi `location` trong nginx đều neo ở `/garbage.php`, `/getIP.php`…
không có tiền tố `/speedtest` — tức có thứ ở trên đã cắt nó đi. Link trả về sẽ
thiếu đúng đoạn đó.

Hỏng **im lặng**: endpoint vẫn trả 201, chỉ là link không ai mở được.

```bash
SPEEDTEST_EXPORT_BASE_URL=https://be-unitel.laoone.la/speedtest/export.php
```

Phải khớp `export_endpoint` trong `settings.json`.

### CORS

`export.php` dùng chung `cors_util.php`, nên **origin của miniapp phải nằm trong
`ALLOWED_ORIGINS`**, giống các endpoint đo. Thiếu là preflight `OPTIONS` bị 403
và upload hỏng im lặng.

Trong stack docker thì nginx mới là nơi phát header CORS, còn `export.php` cũng
tự phát khi client gửi `?cors=true`. Hai bộ header `Access-Control-Allow-Origin`
trên một response **không phải là "thoáng hơn"** — trình duyệt từ chối thẳng.
Vì vậy location `/export.php` có 4 dòng `fastcgi_hide_header`; `proxy_hide_header`
ở đầu file **không** áp cho fastcgi. Đã verify: đúng 1 header ACAO.

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `SPEEDTEST_EXPORT_ENABLED` | bật | `0` để tắt hẳn (trả 503) |
| `SPEEDTEST_EXPORT_DIR` | `backend/exports` | nơi chứa file. Compose đặt `/var/exports` |
| `SPEEDTEST_EXPORT_TTL` | `1800` | giây trước khi xoá |
| `SPEEDTEST_EXPORT_MAX_BYTES` | `5242880` | trên mức này trả 413 |
| `SPEEDTEST_EXPORT_BASE_URL` | tự suy từ request | **bắt buộc ở đây** — xem trên |

Hai chi tiết của php-fpm đã xử lý sẵn trong compose, ghi lại vì cả hai hỏng im
lặng và trông giống hệt nhau (`{"error":"export storage unavailable"}`):

- **`clear_env`** — php-fpm xoá sạch biến môi trường trước khi chạy script trừ
  khi pool nói khác. `docker/php-export-fpm.conf` đặt `clear_env = no`. Thiếu
  nó thì mọi `getenv()` trả `false` và mặc định được áp trong im lặng, dù
  `docker compose config` hiển thị biến rõ ràng.
- **Quyền trên volume** — volume mới tạo thuộc `root`, còn worker php-fpm chạy
  bằng `www-data`. Service `php-export` có `command` chown `/var/exports` lúc
  khởi động; master process là root nên một dòng là đủ.

### ⚠ Nhiều node sau load balancer

**Tính năng này giả định upload và download rơi vào cùng một máy.** File nằm
trong volume local của node nhận POST; node khác không thấy nó.

Nếu A10 (`10.120.162.105`) có **từ hai node trở lên** trong pool cho
`/speedtest/`, thì:

- POST → A10 đưa vào node A → file nằm ở node A
- Người dùng mở link → A10 có thể đưa vào node B → `expired or unknown`

Hỏng kiểu **ngắt quãng**, và trông y hệt link hết hạn — nên rất dễ bị đổ oan cho
TTL rồi tăng `SPEEDTEST_EXPORT_TTL` mà không đỡ gì.

**Cách phân biệt trong một lần nhìn:** cả hai đầu đều trả header `X-Export-Node`
(hash ngắn của hostname, không lộ tên máy). Response POST còn có thêm trường
`node` trong JSON.

```bash
curl -s -X POST --data-binary $'a,b\n1,2' -H 'Content-Type: text/csv' \
  "$H/export.php?cors=true&name=t.csv"          # -> "node":"ab542091"
curl -sD- -o/dev/null "$H/export.php?id=<id>" | grep -i x-export-node
```

Hai giá trị **giống nhau** → id đúng là đã hết hạn. **Khác nhau** → pool đang
tách đôi cặp upload/download.

### `SPEEDTEST_EXPORT_NODE` — cách đã chọn cho deployment này

Mọi node **forward `/export.php` về cùng một node**, và chỉ node đó chạy
endpoint. Đặt **cùng một giá trị trên tất cả các node**:

```bash
SPEEDTEST_EXPORT_NODE=10.120.162.18:8087
```

Cơ chế: `location /export.php` proxy sang `http://$SPEEDTEST_EXPORT_NODE/__export_local`,
còn `location = /__export_local` mới là chỗ `fastcgi_pass` vào php-fpm. Cùng một
file config cho mọi node — **không có cấu hình lệch giữa các máy**.

Link tải vẫn dùng URL qua VIP như bình thường: node nào nhận GET cũng forward về
đúng node đó.

> ⚠ **Trỏ mỗi node vào chính nó là tái tạo đúng cái lỗi này.** Giá trị phải giống
> nhau trên mọi máy.

Mặc định `127.0.0.1:8080` là listener của chính nginx trong container — đúng cho
deployment **một node**, không cần cấu hình gì.

Đánh đổi: node được chỉ định chết thì **export** chết trên cả pool. Các endpoint
đo không bị ảnh hưởng, vẫn chạy trên mọi node.

`/__export_local` không đặt thêm lớp bảo vệ nào ngoài rate limit, có chủ ý: nó là
đúng cái endpoint mà `/export.php` đang mở công khai ngay cạnh, cùng quyền hạn —
thêm secret vào đó là bảo mật hình thức.

### Hai cách khác, nếu muốn bỏ điểm chết đơn

1. **Storage dùng chung** — trỏ `SPEEDTEST_EXPORT_DIR` vào NFS mount mà mọi node
   cùng thấy, thay named volume, và bỏ `SPEEDTEST_EXPORT_NODE` về mặc định.
2. **Nhân bản chéo** — node nhận POST tự đẩy file sang node kia. Chưa làm.

Session persistence trên A10 **không** đủ tin cậy: link được mở từ một trình
duyệt khác, sau vài phút, có thể đã đổi IP.

> Cùng lý do đó cũng đáng kiểm tra `speedtest-results`: nó cũng là volume local,
> nên nhiều node active nghĩa là kết quả đo bị chia vào nhiều bolt database, và
> `stats.php` chỉ thấy phần của node trả lời lần đó.

### Kiểm chứng

```bash
H=https://speedtest.example.la
curl -s -X POST --data-binary $'a,b\n1,2' -H 'Content-Type: text/csv' \
  "$H/export.php?cors=true&name=speedtest-history.csv"
```

Phải trả `{"url":"https://.../speedtest/export.php?id=<32 hex>","expires_in":1800,...}`
— **kiểm đúng cái URL đó có `/speedtest/`**; thiếu là `SPEEDTEST_EXPORT_BASE_URL`
chưa đặt.

| Lệnh | Kết quả đúng |
|---|---|
| `curl -sD- -o/dev/null -H "Origin: https://1512092451476390944768.app.mini.windvane.suite.emas.alibaba.com" "$H/export.php?cors=true&id=<id>" \| grep -ci '^access-control-allow-origin'` | **`1`** |
| `curl -sD- -o/dev/null "$H/export.php?id=<id>" \| grep -i content-disposition` | `attachment; filename="speedtest-history.csv"` |
| `curl -s "$H/export.php?id=00000000000000000000000000000000"` | `{"error":"expired or unknown"}` |
| `curl -s "$H/export.php?cors=true&name=x.php" -X POST --data-binary a` | `{"error":"unsupported file type"}` |
| `curl -s "$H/export.php?id=*"` | `{"error":"bad id"}` |

### Dữ liệu thuê bao — đọc kỹ

File xuất **chứa ISDN**. Ba thứ giữ cho phạm vi hẹp lại, và **không cái nào là
mật khẩu**:

- id là 16 byte ngẫu nhiên → không đoán/quét được URL;
- file bị xoá sau `SPEEDTEST_EXPORT_TTL`, dọn ngay trong mỗi request;
- không log nội dung; bản tải về gắn `no-store` và `X-Robots-Tag: noindex`.

**Ai cầm link đều tải được** cho tới khi hết hạn — đó cũng đúng là tính chất của
link sau khi nó vào share sheet, và là lý do TTL để ngắn. Cần chặt hơn thì đặt
`SPEEDTEST_EXPORT_TTL` thấp xuống.

Thư mục `exports/` chỉ được đọc qua `export.php`, không cần lộ ra HTTP. Script tự
ghi `.htaccess` chặn (Apache). **Với nginx phải tự thêm**:

```nginx
location ~ /backend/exports/ { deny all; }
```

Đặt rate limit trước ứng dụng như với `garbage.php` —
`docker/nginx-speedtest.conf` đã có sẵn cấu hình.

---

## Những chỗ dễ hỏng, theo thứ tự hay gặp

| Triệu chứng | Nguyên nhân |
|---|---|
| Chọn server xong rồi đứng im, báo "Can't reach the test server" | Server chạy `http://` — WebView chặn mixed content. Hoặc CORS hỏng (xem số header ACAO ở trên) |
| Mọi origin bị chặn kể cả origin đúng | `\.` trong regex bị Windows đổi thành `/.` — dùng `[.]` |
| `MOBILE_OPERATOR` null trên mọi bản ghi | `geoip_database_file` không nạp được → không suy ra được nhà mạng. Kiểm `docker logs` của backend-go |
| Bài Web/Video báo `Error` | Chưa chạy `make-test-assets.js`, hoặc `assets_path` không trỏ đúng thư mục đã mount |
| Tốc độ đo thấp bất thường, không có lỗi nào | Ai đó bật HTTP/2, hoặc thêm `limit_rate` vào endpoint đo. Cả hai đều làm sai số đo trong im lặng |
| Mọi bản ghi gán cùng một nhà mạng | Thiếu `X-Forwarded-For` → backend thấy IP của proxy thay vì của máy đo |
| iOS xuất file được, Android thì không | `export_endpoint` còn rỗng — xem mục 8. Android không có route client-side nào cả |
| Bấm xuất file trên Android báo lỗi upload | Origin miniapp chưa có trong `ALLOWED_ORIGINS` → preflight `OPTIONS` bị 403 |
| Upload trả 201 nhưng link mở ra không được | `SPEEDTEST_EXPORT_BASE_URL` chưa đặt — link thiếu đoạn `/speedtest` |
| `{"error":"export storage unavailable"}` | `clear_env` hoặc quyền volume — xem mục 8 |
| Mọi phép đo hỏng ngay sau khi thêm export | Thiếu `fastcgi_hide_header` → hai header ACAO → trình duyệt từ chối toàn bộ |
| Link tải lúc được lúc không, kiểu ngắt quãng | Nhiều node sau A10 — so `X-Export-Node` giữa POST và GET, xem mục 8 |
| Link tải mở ra báo "expired or unknown" | Quá `SPEEDTEST_EXPORT_TTL` (mặc định 30 phút), hoặc mỗi lần deploy lại vào một container khác không chung `SPEEDTEST_EXPORT_DIR` |
