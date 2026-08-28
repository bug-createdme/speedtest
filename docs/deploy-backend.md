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
export SPEEDTEST_ALLOWED_ORIGIN_REGEX='^https://app[.]unitel[.]com[.]la$'
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
:8989, chỉ dùng để kiểm chứng cục bộ.

## 6 · Kiểm chứng

Sáu lệnh dưới đây là bộ đã dùng để nghiệm thu stack này.

```bash
H=https://speedtest.example.la
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$H/garbage.php?ckSize=1&cors=true"
```

Phải ra **`200 1048576`**. Rồi:

| Lệnh | Kết quả đúng |
|---|---|
| `curl -sD- -o/dev/null -H "Origin: https://app.unitel.com.la" "$H/empty.php?cors=true" \| grep -ci '^access-control-allow-origin'` | **`1`** |
| `curl -sD- -o/dev/null -H "Origin: https://evil.example" "$H/empty.php?cors=true" \| grep -ci '^access-control-allow-origin'` | **`0`** |
| `curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS -H "Origin: https://app.unitel.com.la" "$H/empty.php"` | **`204`** |
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

`backend-go` phải hiện `8989/tcp` — **không** có `0.0.0.0:`.

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

## Những chỗ dễ hỏng, theo thứ tự hay gặp

| Triệu chứng | Nguyên nhân |
|---|---|
| Chọn server xong rồi đứng im, báo "Can't reach the test server" | Server chạy `http://` — WebView chặn mixed content. Hoặc CORS hỏng (xem số header ACAO ở trên) |
| Mọi origin bị chặn kể cả origin đúng | `\.` trong regex bị Windows đổi thành `/.` — dùng `[.]` |
| `MOBILE_OPERATOR` null trên mọi bản ghi | `geoip_database_file` không nạp được → không suy ra được nhà mạng. Kiểm `docker logs` của backend-go |
| Bài Web/Video báo `Error` | Chưa chạy `make-test-assets.js`, hoặc `assets_path` không trỏ đúng thư mục đã mount |
| Tốc độ đo thấp bất thường, không có lỗi nào | Ai đó bật HTTP/2, hoặc thêm `limit_rate` vào endpoint đo. Cả hai đều làm sai số đo trong im lặng |
| Mọi bản ghi gán cùng một nhà mạng | Thiếu `X-Forwarded-For` → backend thấy IP của proxy thay vì của máy đo |
