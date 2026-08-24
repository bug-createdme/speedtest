# Hiệu chuẩn `overheadCompensationFactor`

Trạng thái: **INSUFFICIENT EVIDENCE — chưa hiệu chuẩn, giữ nguyên default `1.06`**
Ngày: 2026-08-24

## Vì sao chưa làm được

Hiệu chuẩn đúng nghĩa đòi hỏi so sánh kết quả đo của engine này với một công cụ tham chiếu (iperf3) chạy trên **cùng một đường truyền vật lý thuộc hạ tầng Unitel thật**. Tại thời điểm viết tài liệu này, dự án **chưa có host production/hạ tầng Unitel nào để truy cập** (xác nhận nhiều lần trong `docs/architecture.md` §9). Do đó, con số hiện tại (`1.06`, giá trị mặc định gốc của LibreSpeed) **không phải là con số dành riêng cho mạng Unitel** — chỉ là ước lượng chung của tác giả gốc, không sai nhưng cũng không được kiểm chứng cho trường hợp cụ thể của bạn.

Việc "đoán" một con số khác mà không có dữ liệu thật có thể làm kết quả **sai lệch nhiều hơn** giữ nguyên default — nên tài liệu này chỉ ghi lại quy trình, không tự ý đổi giá trị.

## `overheadCompensationFactor` là gì

Xem [speedtest_worker.js](../speedtest_worker.js) — hệ số nhân trực tiếp vào tốc độ đo được, để bù phần overhead của giao thức (header TCP/IP/Ethernet, TLS record, v.v.) mà `totLoaded` (số byte payload thực nhận) không tính tới. Công thức: `speed × 8 × overheadCompensationFactor / 1e6`.

`doc.md` (gốc LibreSpeed) liệt kê vài giá trị thay thế đã đo thực nghiệm cho các điều kiện khác:
- `1.0369` — IPv4 + TCP + Ethernet, qua Internet
- `1.0513` — IPv6 + TCP + Ethernet, qua Internet
- `1.081` — một ước lượng khác qua Internet
- `1514/1460` — TCP+IPv4+ETH, bỏ qua overhead HTTP
- `1514/1440` — TCP+IPv6+ETH, bỏ qua overhead HTTP
- `1` — không bù gì cả (đo đúng tốc độ tải file thực tế)

Không có giá trị nào trong danh sách này được đo trên mạng di động Lào (4G/5G, có thể qua NAT/VPN nội bộ Unitel) — môi trường thực tế của dự án này khác đáng kể so với "qua Internet, kết nối cố định" mà các giá trị trên giả định.

## Quy trình hiệu chuẩn (khi có hạ tầng Unitel thật)

**Điều kiện tiên quyết:** 1 server Unitel thật (đã có backend Go hoặc PHP, xem `docs/architecture.md` §3) và 1 client trên cùng đường truyền muốn hiệu chuẩn (ví dụ: 1 điện thoại trên mạng 4G Unitel).

1. **Cài `iperf3` ở cả 2 đầu** (server: `iperf3 -s`; client: `iperf3 -c <server-ip>`). Chạy vài lần, lấy trung bình — đây là số tham chiếu "đúng" theo TCP throughput thật.

2. **Chạy speedtest engine với `overheadCompensationFactor: 1`** (tắt bù hoàn toàn — xem `settings.json` hoặc `setParameter()`), trên **cùng đường truyền, cùng thời điểm gần nhất có thể** với bước 1. Đây là số đo "thô" (raw payload throughput) của engine.

3. **Tính hệ số:**
   ```
   overheadCompensationFactor = (kết quả iperf3) / (kết quả speedtest với factor=1)
   ```

4. **Lặp lại ở nhiều điều kiện khác nhau** (WiFi, 4G, 5G nếu có, các khung giờ khác nhau để tránh nhiễu tải mạng) — lấy trung vị, không lấy 1 lần đo duy nhất.

5. Engine hiện tại **chỉ hỗ trợ 1 hệ số toàn cục**, không phân biệt theo loại kết nối. Nếu kết quả bước 4 khác biệt lớn giữa WiFi và 4G, cần cân nhắc: dùng 1 hệ số trung bình (đơn giản, kém chính xác hơn ở 1 số điều kiện), hoặc mở rộng engine để nhận hệ số theo loại mạng — đây là thay đổi code thật, không chỉ là con số, nên chỉ làm nếu chênh lệch đủ lớn để đáng công sức.

## Việc cần làm khi có input thật

Khi có hostname/quyền truy cập hạ tầng Unitel (mục #1 trong `docs/architecture.md` §9), thực hiện quy trình trên rồi cập nhật `settings.json` (`overheadCompensationFactor`) và tài liệu này với con số + điều kiện đo thật.
