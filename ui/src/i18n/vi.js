export default {
  "lang.name": "Tiếng Việt",

  "app.title": "Kiểm tra tốc độ",
  "app.subtitle": "Đo tốc độ kết nối mạng của bạn",

  "action.start": "Bắt đầu",
  "action.cancel": "Huỷ",
  "action.retry": "Thử lại",
  "action.testAgain": "Đo lại",
  "action.history": "Lịch sử",
  "action.back": "Quay lại",
  "action.skipSelection": "Bỏ qua, dùng máy chủ mặc định",
  "action.chooseServer": "Chọn máy chủ khác",
  "action.showDetails": "Chi tiết lỗi",
  "action.hideDetails": "Ẩn chi tiết",
  "action.exportCsv": "Xuất CSV",
  "action.clearHistory": "Xoá lịch sử",
  "action.change": "Đổi",
  "action.logout": "Đăng xuất",

  "stage.ping": "Độ trễ",
  "stage.download": "Tải xuống",
  "stage.upload": "Tải lên",

  "status.idle": "Sẵn sàng",
  "status.findingServers": "Đang tìm máy chủ gần nhất",
  "status.serversChecked": "Đã kiểm tra {done}/{total}",
  "status.measuringPing": "Đang đo độ trễ",
  "status.measuringDownload": "Đang đo tốc độ tải xuống",
  "status.measuringUpload": "Đang đo tốc độ tải lên",
  "status.elapsed": "{elapsed}s / {total}s",
  "status.fastest": "nhanh nhất",
  "status.done": "Đã đo xong",

  "metric.download": "Tải xuống",
  "metric.upload": "Tải lên",
  "metric.ping": "Độ trễ",
  "metric.jitter": "Độ dao động",
  "metric.loss": "Mất gói",
  "metric.pingIdle": "khi rảnh",
  "metric.pingLoaded": "khi tải",

  "unit.mbps": "Mbps",
  "unit.ms": "ms",
  "unit.percent": "%",

  "server.label": "Máy chủ",
  "server.unknown": "Chưa chọn",

  "net.connection": "Kết nối",
  "net.unknown": "Không rõ",

  "result.testId": "Mã kết quả",
  "result.testIdHint": "Đưa mã này cho bộ phận vận hành mạng để tra đúng lần đo này",

  "loaded.title": "Độ trễ khi có tải",
  "loaded.explain": "Mức độ trễ mà đường truyền cộng thêm khi đang bận. Tăng nhiều thì gọi thoại và họp video sẽ vỡ tiếng dù tốc độ nhìn vẫn đẹp.",
  "loaded.download": "Khi tải xuống",
  "loaded.upload": "Khi tải lên",
  "loaded.idle": "Lúc rảnh",
  "loaded.worst": "cao nhất {value} ms",
  "loaded.increase": "+{value} ms",
  "loaded.loss": "Thăm dò thất bại",
  "loaded.lossSamples": "{count} lần thăm dò",
  "loaded.lossCaveat": "Tỷ lệ gói thăm dò thất bại hoặc quá hạn. TCP che được mất gói nhẹ, nên số cao là dấu hiệu có vấn đề thật, còn số 0 không chứng minh đường truyền sạch.",

  "result.summary":
    "Tải xuống {download} Mbps, tải lên {upload} Mbps, độ trễ {ping} mili giây",

  "error.title": "Không kết nối được máy chủ đo",
  "error.body":
    "Không hoàn tất được phép đo. Nguyên nhân thường nằm ở đường mạng, không phải ở thiết bị của bạn.",
  "error.hintNetwork": "Kiểm tra xem thiết bị còn kết nối internet không",
  "error.hintVpn": "Tắt VPN hoặc proxy nếu đang bật, vì chúng làm lệch đường đo",
  "error.hintRetry": "Thử lại sau giây lát — máy chủ có thể đang bận",
  "error.noServerTitle": "Không máy chủ đo nào phản hồi",
  "error.noServerBody":
    "Toàn bộ máy chủ trong danh sách đều không trả lời. Máy bạn vẫn online, nên vấn đề nằm ở phía máy chủ hoặc trên đường truyền tới đó.",

  "history.title": "Lịch sử",
  "history.empty": "Chưa có kết quả nào. Các lần đo sẽ hiện ở đây.",
  "history.today": "Hôm nay",
  "history.yesterday": "Hôm qua",
  "history.confirmClear": "Xoá toàn bộ kết quả đã lưu?",
  "history.slow": "chậm",

  "logout.confirm":
    "Đăng xuất? Các kết quả đã lưu trên thiết bị này sẽ bị xoá.",

  "a11y.gauge": "Tốc độ hiện tại: {value} megabit mỗi giây",
  "a11y.progress": "Tiến trình đo",
  "a11y.home": "Màn hình chính",
  "a11y.langSwitch": "Ngôn ngữ",

  // Sync queue (sync/outbox.js)
  "sync.storedLocally": "Đã lưu {count} kết quả trên máy",
  "sync.pending": "{count} kết quả đang chờ gửi lên",
  "sync.allSent": "Đã gửi lên toàn bộ kết quả",
  "sync.notSent": "Chưa gửi",
  "sync.kept": "Giữ lại {count} kết quả - chưa gửi lên"
};
