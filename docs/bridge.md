# Bridge WindVane — Speedtest Unitel

Trạng thái: **Draft — contract xác nhận qua tài liệu chính thức, chưa có dòng code nào tích hợp vào repo**
Ngày: 2026-08-24
Tách ra từ [architecture.md](architecture.md) mục 6.

Phạm vi: **chỉ WindVane**. Nền tảng LaoApp/`MiniappSDK` **ngoài phạm vi**, không tích hợp — theo chỉ đạo của bạn.

## Nguồn

1. Đọc trực tiếp source của 1 mini-app speedtest tham khảo cho Unitel (Vue 3 + Vite, hỗ trợ song song Ali/WindVane và LaoApp/MiniappSDK qua cờ `VITE_IS_MINIAPP_ALI`).
2. Tài liệu chính thức Alibaba Cloud: [WindVane miniapp JSAPI reference](https://www.alibabacloud.com/help/en/superapp/superapp-bap-public-intl/jsapi-1/) — đọc toàn bộ mục lục API, không chỉ trang "Base".

**Nguồn 2 (tài liệu chính thức) đáng tin hơn nguồn 1 (code reference)** khi hai bên lệch nhau — xem cảnh báo lệch bên dưới.

**Chưa có dòng code nào từ reference được đưa vào repo này** — đây thuần là ghi nhận contract để dùng khi thật sự implement (Phase 5/6).

## Cách nạp SDK

```html
<script src="https://g.alicdn.com/superapp-cloud/js-library-windvane/3.1.3/windvane.js"></script>
```

Script tải từ CDN của Alibaba (`alicdn.com`), không bundle qua Vite/npm. `window.WindVane` chỉ tồn tại sau khi script này chạy xong — mọi lời gọi phải kiểm tra `typeof window.WindVane !== 'undefined'` trước.

## Calling convention (xác nhận, đã thấy chạy thật)

```js
window.WindVane.call(namespace, method, params, onSuccess, onError)
```

## API WindVane liên quan tới speedtest (nguồn: tài liệu chính thức)

| Chức năng | `namespace.method` | Android | iOS | Ghi chú |
|---|---|---|---|---|
| **Loại mạng (WiFi/4G/5G)** | `WVNetwork.getNetworkType` | ✅ | ✅ | Xác nhận tồn tại. Đây là API cho tính năng khác biệt ở Phase 1 §15, KHÔNG cần dựa vào `MiniappSDK.getNetworkInfo` (nhánh LaoApp, ngoài phạm vi) |
| Vị trí (geolocation) | `WVLocation.getLocation` | ✅ | ✅ | Khớp đúng cách reference đang dùng |
| Tìm toạ độ theo địa chỉ | `WVLocation.searchLocation` | ❌ | ✅ | Chỉ iOS |
| Đóng cả mini-app | `WVMiniApp.close` | ✅ | ✅ | API đúng theo docs chính thức — xem cảnh báo lệch bên dưới |
| Đóng trang hiện tại (không thoát hẳn) | `WVNavigator.pop` | ✅ | ✅ | Khác `WVMiniApp.close`: dùng khi mini-app có nhiều trang và chỉ muốn back 1 bước |
| Mở trang mới trong mini-app | `WVNavigator.push` | ✅ | ✅ | |
| Chọn 1 contact (picker) | `WVContacts.choose` | ✅ | ✅ | Khớp đúng cách reference đang dùng — trả về tên + số điện thoại |
| Tìm contact theo tên/SĐT | `WVContacts.find` | ✅ | ✅ | |
| Lưu trữ key-value | `WVStorage.setItem` / `getItem` / `removeItem` / `clearStorage(Sync)` | ✅ | ✅ | Khớp đúng cách reference đang dùng (thiếu 2 hàm `clearStorage*` mà reference không dùng tới) |
| Thông tin hệ thống thiết bị | `WVSystem.getSystemInfo` / `getSystemInfoSync` | ✅ | ✅ | Xác nhận tồn tại |
| Mức pin | `WVBattery.getBatteryInfo` / `Sync` | ✅ | ✅ | Có thể dùng để ghi chú "pin yếu" ảnh hưởng độ chính xác đo, hoặc cảnh báo trước khi test dài |
| Gọi điện / mở bàn phím quay số | `WVCall.call` / `WVCall.dial` | ✅ | ✅ | Có thể dùng thay cho luồng "chọn contact rồi báo lỗi" nếu muốn gọi thẳng hotline hỗ trợ |
| Chụp màn hình kết quả | `WVScreenCapture.capture` | ✅ | ✅ | Thay thế cho cơ chế "share ảnh PNG qua backend" của LibreSpeed gốc (Phase 1 §21) |
| Toast / dialog theo UI hệ thống | `WVUIToast.toast`, `WVUIDialog.alert/confirm/prompt` | ✅ | ✅ | Có thể thay modal Vue tự vẽ bằng UI gốc của superapp cho nhất quán |
| Kiểm tra API có được hỗ trợ không | `WVBase.canIUse` | ✅ | ✅ | Nên dùng để defensive-check trước khi gọi API ít phổ biến, tránh crash trên phiên bản SDK cũ |

Danh sách đầy đủ ~90 API khác (Bluetooth, camera, cảm biến chuyển động, cookie...) không liệt kê ở đây vì không liên quan trực tiếp tới speedtest — xem link nguồn khi cần.

## ⚠ Điểm lệch giữa reference project và tài liệu chính thức

1. **Đóng mini-app:** reference dùng `window.WindVane.call('WVBase', 'closePage', ...)` — **namespace/method này không có trong tài liệu chính thức**. API đúng là `WVMiniApp.close`. Khả năng: reference dùng bản WindVane cũ hơn/có compat shim, hoặc chỉ đơn giản là dùng sai. **Khi implement, dùng `WVMiniApp.close` theo docs chính thức, không copy nguyên `WVBase.closePage` từ reference.**
2. **Lấy ISDN (số thuê bao):** reference dùng `window.WindVane.call('wv', 'getAuthCode', {scopes:['USER_ID','USER_NAME']}, ...)` — namespace `wv` (chữ thường, không tiền tố `WV`) **không xuất hiện trong tài liệu JSAPI công khai này**. Nhiều khả năng đây là **API mở rộng riêng do đội tích hợp superapp của Unitel cấp thêm**, không phải WindVane chuẩn của Alibaba. **Cần xác nhận trực tiếp với đội superapp Unitel** cách lấy ISDN đúng chuẩn, không giả định `wv.getAuthCode` chắc chắn hoạt động chỉ vì thấy trong reference.

## Ràng buộc kỹ thuật đã xác nhận: không dùng vue-router

Reference project đã **gỡ bỏ vue-router**, thay bằng điều hướng dựa trên state (`v-if` theo 1 store điều khiển "trang hiện tại", API tương thích `this.$router.push()` để code cũ không phải viết lại). Lý do ghi nhận trong tài liệu nội bộ của reference: host mini-app (Ali) không tương thích tốt với URL-based routing của SPA. Đây là ràng buộc kỹ thuật thật, áp dụng chung cho mô hình WebView-mini-app, không riêng WindVane hay LaoApp — **cần tuân theo khi implement UI Vue cho project này** (Phase 5), dù dùng thư viện điều hướng nào.

## Việc cần xác nhận trước khi implement bridge thật (Phase 5/6)

1. **Cách lấy ISDN đúng chuẩn** — `wv.getAuthCode` không có trong docs công khai (xem "Điểm lệch" #2). Hỏi trực tiếp đội superapp Unitel.
2. Xác nhận version WindVane thực tế mà superapp Unitel nhúng (reference dùng `3.1.3` qua CDN `alicdn.com`) — version khác có thể có API khác đôi chút, đặc biệt với API đóng mini-app đã lệch ở trên.
