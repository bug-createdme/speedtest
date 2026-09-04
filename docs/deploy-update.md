# Cập nhật test server đang chạy

Runbook đưa một thay đổi lên test server **đã dựng rồi**. Dựng lần đầu thì xem
[deploy-backend.md](deploy-backend.md) — file này giả định stack đang chạy và
bạn chỉ muốn thay đồ bên trong nó.

Mọi lệnh ở đây đã chạy thật trên bundle sinh ra từ chính repo này, trừ những chỗ
ghi rõ **CHƯA KIỂM CHỨNG** — đó là các thứ chỉ tồn tại trên máy chủ thật (đường
dẫn, IP node) hoặc trên máy bạn (FileZilla).

---

## 0 · Hai đường, chọn một

| | Bundle đầy đủ | Chỉ file thay đổi |
|---|---|---|
| Upload | ~113 MB | vài MB |
| Gồm | image + config + assets | chỉ thứ bạn sửa |
| Khi nào dùng | đổi code backend-go, hoặc muốn cả hai node về đúng một trạng thái đã biết | chỉ sửa config nginx / thay assets |
| Rủi ro | phải giải nén đúng chỗ (xem §4) | thấp |

Mục §1–§7 mô tả đường **bundle**. Đường rút gọn nằm ở §8.

## 1 · Thay đổi lần này gồm những gì

Ba tier video (`video-360p/720p/1080p.mp4`) lần đầu được phục vụ từ chính test
server thay vì CDN bên thứ ba. Kèm theo:

- **`docker/nginx-speedtest-endpoints.conf`** — location cũ chỉ khớp đúng
  `browse-sample.html` và `video-sample.mp4`, nên copy ba file tier lên cũng vô
  ích: nginx 404 trước khi Go nhìn thấy request.
- **`test-assets/`** — bốn file mp4, đã encode lại theo bitrate thật của từng độ
  phân giải (~1 / ~3 / ~6 Mbps). Bản cũ là thanh màu `testsrc` nén xuống
  176–370 kbps, phát mượt trên mọi đường truyền nên không đo được gì. Chi tiết:
  [test-assets.md](test-assets.md).
- **`video-sample.mp4` bị thay**, 316 KB → 3.95 MB. Backup ở §3.

Phía miniapp có `settings.json` mới trỏ vào ladder nội bộ — xem §9. **Backend
trước, miniapp sau**: settings.json mới hỏi `video-360p.mp4` trên test server,
đẩy miniapp trước thì ba tier 404 rồi fallback sang CDN ngoài. Vẫn chạy, nhưng
đo nhầm nguồn.

## 2 · Đóng gói trên máy dev

```bash
node scripts/make-test-assets.js
```

Cần `ffmpeg` trên PATH. File nào đã có thì script để nguyên — muốn sinh lại bản
mới phải xoá file cũ trước.

```bash
npm run package:deploy
```

Ra `deploy/speedtest-deploy.tar`. Script **cảnh báo nếu thiếu bất kỳ mẫu video
nào** mà `settings.json` khai là tương đối. Đọc kỹ cảnh báo dạng này:

```
WARN test-assets/video-1080p.mp4 missing - the 1080p tier will fall back to test-videos.co.uk,
WARN   so it measures that host instead of this server.
```

Tier có `fallbackUrl` **không gãy** khi thiếu file — nó lặng lẽ phát clip của
host khác, app vẫn ra số, và số đó tả CDN của người ta. Gói im lặng hoàn toàn
mới là gói đúng.

Ghi lại checksum để đối chiếu sau khi upload:

```bash
sha256sum deploy/speedtest-deploy.tar
```

## 3 · Tìm thư mục deploy trên node, rồi backup

Đường dẫn khác nhau tuỳ máy, nên hỏi Docker thay vì đoán:

```bash
docker inspect speedtest-deploy-nginx-1 --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
```

Trả về thư mục chứa `docker-compose.yml`. Phần còn lại của runbook gọi nó là
`$DEPLOY`, và gọi thư mục cha của nó là `$PARENT`.

```bash
DEPLOY=$(docker inspect speedtest-deploy-nginx-1 --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}') && PARENT=$(dirname "$DEPLOY") && echo "DEPLOY=$DEPLOY" && echo "PARENT=$PARENT"
```

Backup file sắp bị ghi đè:

```bash
cp "$DEPLOY/test-assets/video-sample.mp4" ~/video-sample.mp4.bak && cp "$DEPLOY/docker/nginx-speedtest-endpoints.conf" ~/nginx-speedtest-endpoints.conf.bak
```

## 4 · Upload bằng FileZilla

**Upload vào `$PARENT`, không phải `$DEPLOY`.** Trong tar chỉ có đúng một thư
mục gốc tên `speedtest-deploy/`, nên giải nén ở `$PARENT` sẽ cập nhật đè lên
`$DEPLOY` đang có. Giải nén ở chỗ khác thì xem cảnh báo cuối mục này.

1. **Giao thức SFTP**, port 22 — cùng thông tin đăng nhập bạn vẫn ssh vào node.
   File → Site Manager → Protocol: *SFTP - SSH File Transfer Protocol*.
2. **Kiểu truyền Binary.** Transfer → Transfer type → *Binary*. Mặc định *Auto*
   cũng an toàn vì `.tar` không nằm trong danh sách ASCII, nhưng nếu ai đó từng
   ép ASCII toàn cục thì file 113 MB hỏng âm thầm — checksum ở bước 5 bắt được.
   *(CHƯA KIỂM CHỨNG: tôi không chạy được FileZilla ở đây.)*
3. Kéo `deploy\speedtest-deploy.tar` từ khung trái vào `$PARENT` ở khung phải.
4. Nếu FileZilla báo permission denied: user SFTP không ghi được vào `$PARENT`.
   Upload vào thư mục home rồi trên ssh chuyển sang:

   ```bash
   sudo mv ~/speedtest-deploy.tar "$PARENT/"
   ```

5. **Đối chiếu checksum** trên node với số ở §2:

   ```bash
   sha256sum "$PARENT/speedtest-deploy.tar"
   ```

   Lệch nghĩa là truyền hỏng hoặc dở dang — upload lại, đừng giải nén.

Trên Windows nếu không có `sha256sum`, dùng cmd:

```
certutil -hashfile deploy\speedtest-deploy.tar SHA256
```

> **Giải nén sai chỗ thì hỏng lặng lẽ.** Bung ra `/root/` chẳng hạn sẽ được
> `/root/speedtest-deploy/` — tên thư mục vẫn là `speedtest-deploy` nên Compose
> coi là **cùng một project**, và `up -d` sẽ recreate container trỏ sang vị trí
> mới. Deployment bị "di cư" mà không báo gì. Thường thì nó fail to trước vì
> `.env` không nằm trong tar (xem §5), nhưng đừng dựa vào đó.

## 5 · Giải nén, nạp image, khởi động

```bash
cd "$PARENT" && tar -xf speedtest-deploy.tar && cd speedtest-deploy && docker load -i images.tar && docker compose --profile dev up -d
```

Đường dẫn từng lệnh, nếu muốn chạy tách:

| Lệnh | Chạy tại |
|---|---|
| `tar -xf speedtest-deploy.tar` | `$PARENT` |
| `docker load -i images.tar` | `$DEPLOY` |
| `docker compose --profile dev up -d` | `$DEPLOY` |
| `docker exec ...` | bất kỳ đâu — tác động theo tên container |

`docker-compose.yml` dùng đường dẫn tương đối (`./test-assets`,
`./docker/...`) nên Compose **bắt buộc** chạy từ trong `$DEPLOY`.

Luôn kèm `--profile dev` ở mọi lệnh compose (`up`, `ps`, `down`). Thiếu profile
thì chỉ `backend-go` được tính, mà nó không publish cổng nào.

**`.env` của bạn an toàn.** Trong tar chỉ có `.env.example`, không có `.env` —
cố ý, để bung đè lên deployment đang chạy không xoá mất mật khẩu và
`SPEEDTEST_ALLOWED_ORIGIN_REGEX`. Ngược lại, bung ra thư mục mới thì không có
`.env` và compose từ chối khởi động vì `SPEEDTEST_STATISTICS_PASSWORD` rỗng.

## 6 · Reload nginx

`up -d` **không** chắc chắn recreate nginx: config là bind mount, nên nếu image
và định nghĩa service không đổi thì container giữ nguyên và vẫn chạy config cũ.

Kiểm tra container đã thấy file mới:

```bash
docker exec speedtest-deploy-nginx-1 grep -n 'video-\[0-9\]' /etc/nginx/speedtest-endpoints.conf
```

Không ra dòng nào → bind mount đứt inode, chạy
`docker compose --profile dev up -d --force-recreate nginx`.

Validate **trước** khi reload, rồi mới reload:

```bash
docker exec speedtest-deploy-nginx-1 nginx -t && docker exec speedtest-deploy-nginx-1 nginx -s reload
```

Reload chứ không restart: config lỗi thì reload từ chối và worker cũ vẫn phục
vụ, còn restart thì nginx nằm luôn. Đây không phải lo hão — một regex dùng
`{3,4}` đã làm nginx từ chối khởi động với
`pcre2_compile() failed: missing closing parenthesis`, vì nginx đọc `{` chưa
quote trong location regex là mở block.

Assets không cần restart gì cả: Go đọc từ thư mục mount theo từng request.

## 7 · Nghiệm thu

Năm dòng đầu phải là `200`, dòng cuối phải là `404`:

```bash
for f in browse-sample.html video-sample.mp4 video-360p.mp4 video-720p.mp4 video-1080p.mp4 nope-404.mp4; do printf "%-22s " "$f"; curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "http://127.0.0.1:8087/$f"; done
```

Kết quả đã chạy thật trên bundle này:

```
browse-sample.html     200 text/html; charset=utf-8
video-sample.mp4       200 video/mp4
video-360p.mp4         200 video/mp4
video-720p.mp4         200 video/mp4
video-1080p.mp4        200 video/mp4
nope-404.mp4           404 text/html
```

Output trên lấy qua chính nginx của bundle, ở cổng **8080 bên trong container**.
Trên node thì `8087:8080`, nên từ host của node dùng 8087 như lệnh phía trên.
Nếu 8087 không phản hồi mà bên trong vẫn 200 thì vấn đề ở phần publish cổng
hoặc firewall, không phải ở assets:

```bash
docker exec speedtest-deploy-nginx-1 wget -S --spider -q -O /dev/null http://127.0.0.1:8080/video-1080p.mp4
```

Byte range — `<video>` bắt buộc phải có, thiếu thì mọi phép đo đọc thành một
lần buffer dài:

```bash
curl -s -o /dev/null -D- -H 'Range: bytes=0-1023' "http://127.0.0.1:8087/video-1080p.mp4" | grep -iE '^HTTP/|content-range|accept-ranges'
```

Phải ra `206 Partial Content` kèm `Content-Range: bytes 0-1023/4713800` và
`Accept-Ranges: bytes` — đúng ba dòng này đã lấy được từ bundle. Response còn
kèm `Timing-Allow-Origin: *`, nghĩa là khi assets về self-host thì miniapp đọc
được số byte truyền thật qua Resource Timing, kể cả trên iOS WKWebView vốn
không có counter `webkitVideoDecodedByteCount`.

Cuối cùng qua tên miền công khai:

```bash
for f in video-360p video-720p video-1080p; do printf "%-14s " "$f"; curl -s -o /dev/null -w "%{http_code}\n" "https://be-unitel.laoone.la/speedtest/$f.mp4"; done
```

> **A10 cân bằng tải nên curl từ ngoài chỉ chạm một node.** Theo khảo sát
> 2026-09-03 có **hai node đều nhận traffic thật**: `10.120.162.18` và
> `10.120.162.19`. Làm toàn bộ runbook này trên cả hai, và nghiệm thu node còn
> lại bằng `curl http://127.0.0.1:8087/...` ngay trên máy đó.
> *(CHƯA KIỂM CHỨNG lại trong lần deploy này — xác nhận topology còn đúng trước
> khi bắt đầu.)*

## 8 · Đường rút gọn: chỉ config và assets

Khi không đổi code backend-go. Nhẹ hơn nhiều, không phải `docker load` 61 MB.

Qua FileZilla, upload đè lên đúng hai chỗ trong `$DEPLOY`:

| Từ máy dev | Lên node |
|---|---|
| `test-assets\*.mp4` | `$DEPLOY/test-assets/` |
| `docker\nginx-speedtest-endpoints.conf` | `$DEPLOY/docker/` |

Ghi **đè lên file cũ**, đừng xoá rồi tạo mới ở chỗ khác: bind mount một file
đơn lẻ gắn theo inode, thay file bằng cách tạo inode mới thì container vẫn thấy
nội dung cũ. FileZilla ghi đè tại chỗ nên giữ được inode, nhưng §6 vẫn có bước
kiểm tra để chắc.

Rồi làm tiếp từ §6.

## 9 · Miniapp

Sau khi backend xong:

```bash
npm run build:mini
```

Ra `speedtest_v<version>_<ngày>.zip` ở gốc repo, tự lấy `server-list.prod.json`
và tự kiểm tra gói. Upload zip đó lên SuperApp Console.

Nghiệm thu trên máy thật: chạy một lần đo, màn hình video phải hiện ba tier với
**nhãn khớp đúng độ phân giải** (360p→360p, 720p→720p, 1080p→1080p), "Dữ liệu
đã dùng" cỡ **668 kiB / 2.17 MiB / 4.25 MiB**, và trong khung player là cảnh
phim thật — thấy sọc màu nghĩa là asset trên server còn là bản dựng bằng mẫu
thử tổng hợp, xem [test-assets.md](test-assets.md).

Thấy 480p/540p ở cột độ phân giải nghĩa là **đang fallback** — asset chưa lên
tới server, quay lại §7.

## 10 · Rollback

```bash
cp ~/nginx-speedtest-endpoints.conf.bak "$DEPLOY/docker/nginx-speedtest-endpoints.conf" && docker exec speedtest-deploy-nginx-1 nginx -t && docker exec speedtest-deploy-nginx-1 nginx -s reload
```

```bash
cp ~/video-sample.mp4.bak "$DEPLOY/test-assets/video-sample.mp4"
```

Ba file tier thì cứ xoá đi — các tier tự fallback sang clip bên thứ ba và vẫn
đo được, chỉ là đo nhầm nguồn.

---

## Những chỗ dễ hỏng, theo thứ tự hay gặp

| Triệu chứng | Nguyên nhân |
|---|---|
| nginx không khởi động lại được sau khi sửa config | Regex location có `{` chưa quote — nginx cắt cụt pattern. Dùng `[0-9]+` thay `[0-9]{3,4}`. Đây là lý do §6 bắt `nginx -t` trước `reload` |
| Ba file tier vẫn 404 dù đã copy đúng chỗ | Config nginx cũ, location chưa khớp `video-<n>p.mp4`. Kiểm bằng lệnh `grep` ở §6 |
| Sửa config rồi mà container vẫn chạy bản cũ | Bind mount file đơn lẻ đứt inode — `up -d --force-recreate nginx` |
| `up -d` xong mà nginx vẫn config cũ | Compose không recreate vì image không đổi. Phải `nginx -s reload` |
| Compose báo thiếu `SPEEDTEST_STATISTICS_PASSWORD` | Đang chạy ở thư mục vừa bung mới, không có `.env`. Bung sai chỗ — xem §4 |
| Tự dưng có hai stack tranh cổng 8087 | Giải nén ra ngoài `$PARENT`, xem §4 |
| Chỉ `backend-go` chạy, không vào được từ ngoài | Thiếu `--profile dev` |
| Bundle giải nén lỗi / file cụt | Truyền hỏng. Đối chiếu `sha256sum` ở §4 |
| Cột độ phân giải hiện 480p/540p thay vì 360p/720p | Tier đang fallback sang CDN ngoài — asset chưa tới server |
| "Dữ liệu đã dùng" nhỏ bất thường (vài trăm kB cho 1080p) | Assets bản cũ, encode từ `testsrc` ở 176–370 kbps. Sinh lại theo §2 |
| Video 404 chỉ ở một số lần đo | Mới làm một node. Cả hai node đều nhận traffic — xem §7 |
