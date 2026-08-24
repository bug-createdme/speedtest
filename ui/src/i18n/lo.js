/*
  ⚠ UNREVIEWED DRAFT — DO NOT SHIP TO USERS AS-IS.

  Lao is the primary market language for this product, and these strings were
  drafted without a Lao speaker reviewing them. Short labels (Start, Download,
  History) are standard terminology and low risk; the full sentences in the
  error and history sections are the ones most likely to read awkwardly or
  wrongly to a native speaker.

  Before release: have the Unitel team review this file. Until they do, the
  language picker still offers Lao - hiding it would be worse, since it hides
  the gap - but this header is the record that it is provisional.
*/
export default {
  "lang.name": "ລາວ",

  "app.title": "ທົດສອບຄວາມໄວ",
  "app.subtitle": "ກວດສອບຄວາມໄວການເຊື່ອມຕໍ່ຂອງທ່ານ",

  "action.start": "ເລີ່ມ",
  "action.cancel": "ຍົກເລີກ",
  "action.retry": "ລອງໃໝ່",
  "action.testAgain": "ທົດສອບອີກຄັ້ງ",
  "action.history": "ປະຫວັດ",
  "action.back": "ກັບຄືນ",
  "action.skipSelection": "ຂ້າມ, ໃຊ້ເຊີບເວີເລີ່ມຕົ້ນ",
  "action.chooseServer": "ເລືອກເຊີບເວີອື່ນ",
  "action.showDetails": "ລາຍລະອຽດຂໍ້ຜິດພາດ",
  "action.hideDetails": "ເຊື່ອງລາຍລະອຽດ",
  "action.exportCsv": "ສົ່ງອອກ CSV",
  "action.clearHistory": "ລຶບປະຫວັດ",
  "action.change": "ປ່ຽນ",

  "stage.ping": "ຄວາມຫນ່ວງ",
  "stage.download": "ດາວໂຫລດ",
  "stage.upload": "ອັບໂຫລດ",

  "status.idle": "ພ້ອມ",
  "status.findingServers": "ກຳລັງຄົ້ນຫາເຊີບເວີທີ່ໃກ້ທີ່ສຸດ",
  "status.serversChecked": "ກວດແລ້ວ {done}/{total}",
  "status.measuringPing": "ກຳລັງວັດຄວາມຫນ່ວງ",
  "status.measuringDownload": "ກຳລັງວັດຄວາມໄວດາວໂຫລດ",
  "status.measuringUpload": "ກຳລັງວັດຄວາມໄວອັບໂຫລດ",
  "status.elapsed": "{elapsed}s / {total}s",
  "status.fastest": "ໄວທີ່ສຸດ",
  "status.done": "ທົດສອບສຳເລັດ",

  "metric.download": "ດາວໂຫລດ",
  "metric.upload": "ອັບໂຫລດ",
  "metric.ping": "ຄວາມຫນ່ວງ",
  "metric.jitter": "ການແກວ່ງ",
  "metric.loss": "ການສູນເສຍແພັກເກັດ",
  "metric.pingIdle": "ຕອນຫວ່າງ",
  "metric.pingLoaded": "ຕອນມີການໃຊ້ງານ",

  "unit.mbps": "Mbps",
  "unit.ms": "ms",
  "unit.percent": "%",

  "server.label": "ເຊີບເວີ",
  "server.unknown": "ຍັງບໍ່ໄດ້ເລືອກ",

  "net.connection": "ການເຊື່ອມຕໍ່",
  "net.unknown": "ບໍ່ຮູ້",

  "result.summary":
    "ດາວໂຫລດ {download} Mbps, ອັບໂຫລດ {upload} Mbps, ຄວາມຫນ່ວງ {ping} ມິນລິວິນາທີ",

  "error.title": "ບໍ່ສາມາດຕິດຕໍ່ເຊີບເວີທົດສອບໄດ້",
  "error.body":
    "ບໍ່ສາມາດທົດສອບໃຫ້ສຳເລັດໄດ້. ໂດຍປົກກະຕິແມ່ນບັນຫາຈາກເຄືອຂ່າຍ, ບໍ່ແມ່ນຈາກອຸປະກອນຂອງທ່ານ.",
  "error.hintNetwork": "ກວດເບິ່ງວ່າທ່ານຍັງເຊື່ອມຕໍ່ອິນເຕີເນັດຢູ່ບໍ່",
  "error.hintVpn": "ປິດ VPN ຫຼື proxy ຖ້າເປີດຢູ່, ເພາະມັນປ່ຽນເສັ້ນທາງການທົດສອບ",
  "error.hintRetry": "ລອງໃໝ່ໃນອີກບໍ່ດົນ — ເຊີບເວີອາດກຳລັງຫຍຸ້ງ",
  "error.noServerTitle": "ບໍ່ມີເຊີບເວີທົດສອບໃດຕອບກັບ",
  "error.noServerBody":
    "ເຊີບເວີທຸກໜ່ວຍໃນລາຍການບໍ່ຕອບກັບ. ອຸປະກອນຂອງທ່ານຍັງອອນລາຍຢູ່, ສະນັ້ນບັນຫາຢູ່ຝ່າຍເຊີບເວີ ຫຼື ເສັ້ນທາງໄປຫາມັນ.",

  "history.title": "ປະຫວັດ",
  "history.empty": "ຍັງບໍ່ມີຜົນການທົດສອບ. ຜົນທີ່ທ່ານວັດຈະປາກົດຢູ່ນີ້.",
  "history.today": "ມື້ນີ້",
  "history.yesterday": "ມື້ວານ",
  "history.confirmClear": "ລຶບຜົນທີ່ບັນທຶກໄວ້ທັງໝົດບໍ່?",
  "history.slow": "ຊ້າ",

  "a11y.gauge": "ຄວາມໄວປັດຈຸບັນ: {value} ເມກາບິດຕໍ່ວິນາທີ",
  "a11y.progress": "ຄວາມຄືບໜ້າການທົດສອບ",
  "a11y.langSwitch": "ພາສາ",
  "a11y.themeSwitch": "ປ່ຽນຮູບແບບສີ"
};
