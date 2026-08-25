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

## Lấy ISDN — contract đã có, nguồn là reference chứ không phải docs

**Cập nhật 2026-08-24: đã implement** tại [ui/src/bridge/windvane.js](../ui/src/bridge/windvane.js).

`wv.getAuthCode` **vẫn không có trong tài liệu JSAPI công khai** của WindVane — namespace `wv` viết thường, không có tiền tố `WV`. Nhiều khả năng đây là API mở rộng riêng do đội tích hợp superapp Unitel cấp thêm. Điều đã thay đổi so với bản trước của tài liệu này: giờ có **hình dạng response quan sát được từ một mini-app Unitel chạy thật**, do chủ dự án cung cấp. Đó là bằng chứng mạnh hơn suy đoán, nhưng **yếu hơn một đặc tả** — nếu đội superapp đổi định dạng, không có gì trong code sẽ cảnh báo. Vì vậy mọi truy cập field đều là optional và việc đọc không ra không bị coi là lỗi.

### Gọi

```js
window.WindVane.call("wv", "getAuthCode", { scopes: ["USER_ID", "USER_NAME"] }, onSuccess, onError);
```

### Hình dạng response

`result.authSuccessScopes` là một **mảng**, mỗi phần tử **có thể là object, cũng có thể là chuỗi JSON chưa parse** — reference xử lý cả hai trường hợp, nên code ở đây cũng vậy. Mỗi phần tử khoá theo tên scope:

```js
[ '{"USER_ID":{"isdn":"20XXXXXXXX", ...}}', { "USER_NAME": { "name": "..." } } ]
```

Lấy ISDN: tìm phần tử có khoá `USER_ID`, rồi đọc `.USER_ID.isdn`.

### Khác biệt có chủ đích so với reference

| Reference làm | Project này làm | Lý do |
|---|---|---|
| Chặn việc mount app cho tới khi auth xong, rồi poll `localStorage` tới 4 giây | **Không chờ gì cả**, bridge chạy nền | Chặn UI chờ một lời gọi mạng người dùng không yêu cầu chính là lỗi §13 #15 mà dự án này sinh ra để sửa. Đánh đổi: một lần đo bấm ngay khi vừa mở app có thể gửi telemetry trước khi ISDN về, và bản ghi đó không có số thuê bao. Chấp nhận được so với việc bắt mọi người dùng chờ |
| Lưu `wv_isdn`, `wv_fullname` vào `localStorage` | Giữ **trong bộ nhớ**, không ghi xuống thiết bị | Reference cần persist vì bootstrap của họ đọc qua nhiều module. Ở đây một `ref` là đủ, và không ghi số thuê bao xuống thiết bị là mặc định an toàn hơn |
| Đọc cả `USER_NAME` để hiển thị tên | **Chỉ lấy ISDN** | App này không có chỗ nào hiển thị tên, và phòng vận hành đối chiếu kết quả với thuê bao bằng **số**, không bằng tên. Mang thêm tên là thêm dữ liệu cá nhân vào DB kết quả mà không đổi lấy giá trị vận hành nào |
| Nhúng thẳng thẻ `<script>` alicdn vào `index.html` | URL SDK là **cấu hình** (`windvane_sdk_url` trong `settings.json`), mặc định rỗng | Nhúng cứng khiến bản web thường phải tải một script bên thứ ba từ CDN ở **mỗi lần mở trang** — trên đúng cái trang mà công việc của nó là đo xem mạng người dùng chậm thế nào, và ở thị trường mà CDN đó không chắc nhanh hay truy cập được. Rỗng = bản web không gửi request nào; bản mini-app điền URL vào |

### Hệ quả bảo mật — chưa xử lý

Khi ISDN đi vào telemetry, **bản ghi kết quả trở thành dữ liệu định danh thuê bao**. Hai việc bắt buộc phải làm trước khi có người dùng thật, và **chưa làm**:

1. Endpoint telemetry phải chạy **HTTPS**. Hiện dev đang HTTP.
2. Trang `/stats.php` đang bảo vệ bằng **một mật khẩu dùng chung duy nhất** — không phân quyền, không nhật ký truy cập, không xoay vòng. Đủ cho pilot nội bộ, không đủ cho một kho dữ liệu chứa số thuê bao.

Đây là lý do mục "Phase 9 phải lên sớm hơn" ở đầu [architecture.md](architecture.md).

## Ràng buộc kỹ thuật đã xác nhận: không dùng vue-router

Reference project đã **gỡ bỏ vue-router**, thay bằng điều hướng dựa trên state (`v-if` theo 1 store điều khiển "trang hiện tại", API tương thích `this.$router.push()` để code cũ không phải viết lại). Lý do ghi nhận trong tài liệu nội bộ của reference: host mini-app (Ali) không tương thích tốt với URL-based routing của SPA. Đây là ràng buộc kỹ thuật thật, áp dụng chung cho mô hình WebView-mini-app, không riêng WindVane hay LaoApp — **cần tuân theo khi implement UI Vue cho project này** (Phase 5), dù dùng thư viện điều hướng nào.

## Việc cần xác nhận trước khi implement bridge thật (Phase 5/6)

1. **Cách lấy ISDN đúng chuẩn** — `wv.getAuthCode` không có trong docs công khai (xem "Điểm lệch" #2). Hỏi trực tiếp đội superapp Unitel.
2. Xác nhận version WindVane thực tế mà superapp Unitel nhúng (reference dùng `3.1.3` qua CDN `alicdn.com`) — version khác có thể có API khác đôi chút, đặc biệt với API đóng mini-app đã lệch ở trên.
