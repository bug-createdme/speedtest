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

  2026-08-27 (CHANGE-019): an orthographic-consistency pass was applied - not a
  native review, so the warning above still stands. The file mixed decomposed
  and ligature forms of the same characters; all were normalised to the modern
  ligature forms the file already used elsewhere, with no change to meaning or
  pronunciation:
    - ຄວາມຫນ່ວງ (ຫ+ນ) -> ຄວາມໜ່ວງ (ໜ), 6x  [latency]
    - ໂຫລດ (ຫ+ລ) -> ໂຫຼດ (ຫຼ), 10x          [download/upload]
    - ລົ້ມເຫລວ (ຫ+ລ) -> ລົ້ມເຫຼວ (ຫຼ), 2x     [failed]
  Still open for the native reviewer: term choices worth confirming - jitter
  (ການແກວ່ງ), probe (ສຳຫຼວດ), Unknown network (ບໍ່ຮູ້) - and the flow of the
  longer error/history sentences.
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
  "action.share": "ແບ່ງປັນຜົນ",
  "action.exportExcel": "ສົ່ງອອກ Excel",
  "action.exportCsv": "ສົ່ງອອກ CSV",
  "action.clearHistory": "ລຶບປະຫວັດ",
  "action.change": "ປ່ຽນ",
  "action.logout": "ອອກຈາກລະບົບ",
  "action.close": "ປິດ",
  "action.copyId": "ຄັດລອກລະຫັດ",
  "action.export": "ສົ່ງອອກ",

  "export.title": "ສົ່ງອອກຂໍ້ມູນປະຫວັດ",
  "export.tabExcel": "Excel / ຕາຕະລາງ",
  "export.tabCsv": "CSV",
  "export.count": "{count} ຜົນການວັດແທກ",
  "export.noticeApp": "ໃນແອັບມືຖື, ກະລຸນາສຳເນົາຂໍ້ມູນເພື່ອວາງໃສ່ Excel / Sheets ຫຼື ກົດແບ່ງປັນໄປຍັງແອັບອື່ນ.",
  "export.copyForExcel": "ສຳເນົາສຳລັບ Excel / Sheets",
  "export.copiedExcel": "ສຳເນົາແລ້ວ! ເປີດ Excel/Sheets ແລ້ວວາງ (Paste)",
  "export.copyCsv": "ສຳເນົາເນື້ອຫາ CSV",
  "export.copiedCsv": "ສຳເນົາເນື້ອຫາ CSV ທັງໝົດແລ້ວ",
  "export.share": "ແບ່ງປັນຂໍ້ມູນ",
  "export.shared": "ເປີດການແບ່ງປັນແລ້ວ",
  "export.downloadFile": "ດາວໂຫຼດໄຟລ໌",
  "export.downloadBlocked": "SuperApp ບໍ່ຮອງຮັບການດາວໂຫລດໂດຍກົງ. ກະລຸນາໃຊ້ ສຳເນົາ ຫຼື ແບ່ງປັນ.",
  "export.saveToDevice": "ບັນທຶກໄຟລ໌ລົງເຄື່ອງ",
  "export.savedSuccess": "ບັນທຶກ {filename} ລົງເຄື່ອງສຳເລັດແລ້ວ!",
  "export.saving": "ກຳລັງບັນທຶກ",
  "export.savedError": "ບໍ່ສາມາດບັນທຶກໄຟລ໌. ກະລຸນາເປີດ ການວິນິດໄສ ຂ້າງລຸ່ມ ແລ້ວສົ່ງຜົນໃຫ້ຝ່າຍເຕັກນິກ.",
  "export.savedErrorBinary": "ແອັບ Unitel ໃນ Android ຂຽນໄຟລ໌ .xlsx ບໍ່ໄດ້. ກະລຸນາປ່ຽນໄປແຖບ CSV ຫຼື ໃຊ້ ສຳເນົາ ແລ້ວວາງໃສ່ Excel.",
  "export.savedErrorUnauthorized": "ມິນິແອັບນີ້ຍັງບໍ່ໄດ້ຮັບສິດຂຽນໄຟລ໌ (JSAPI authorization) ໃນ Android. ກະລຸນາໃຊ້ ສຳເນົາ ຫຼື ສົ່ງແບບຂໍ້ຄວາມ ແລະ ແຈ້ງທີມ super-app Unitel ໃຫ້ອະນຸຍາດ WVFile.",
  "export.linkShared": "ສ້າງລິ້ງດາວໂຫຼດ ແລະ ເປີດການແບ່ງປັນແລ້ວ. ລິ້ງໝົດອາຍຸໃນ {minutes} ນາທີ.",
  "export.savedErrorUpload": "ອັບໂຫຼດຂໍ້ມູນຂຶ້ນເຊີບເວີບໍ່ໄດ້. ກະລຸນາກວດການເຊື່ອມຕໍ່ແລ້ວລອງໃໝ່ ຫຼື ໃຊ້ ສຳເນົາ.",
  "export.savedErrorUnsupported": "ແອັບ Unitel ໃນເຄື່ອງນີ້ບໍ່ອະນຸຍາດໃຫ້ຂຽນໄຟລ໌. ກະລຸນາໃຊ້ ສຳເນົາ ຫຼື ສົ່ງແບບຂໍ້ຄວາມ.",
  "export.savedErrorTruncated": "ໄຟລ໌ຖືກຂຽນບໍ່ຄົບຈຶ່ງຖືກຍົກເລີກ. ກະລຸນາລອງໃໝ່ ຫຼື ໃຊ້ ສຳເນົາ.",
  "export.shareText": "ສົ່ງແບບຂໍ້ຄວາມ (Text)",
  "export.preview": "ເບິ່ງຂໍ້ມູນຕົວຢ່າງ",
  "export.moreLines": "... (+{count} ແຖວອື່ນ)",
  "export.diagnose": "ການວິນິດໄສການສົ່ງອອກ",
  "export.diagRunning": "ກຳລັງກວດສອບວິທີສົ່ງອອກໄຟລ໌ໃນເຄື່ອງນີ້...",
  "export.copyDiag": "ສຳເນົາຜົນການວິນິດໄສ",
  "export.copiedDiag": "ສຳເນົາຜົນການວິນິດໄສແລ້ວ",


  "stage.ping": "ຄວາມໜ່ວງ",
  "stage.download": "ດາວໂຫຼດ",
  "stage.upload": "ອັບໂຫຼດ",

  "status.idle": "ພ້ອມ",
  "status.findingServers": "ກຳລັງຄົ້ນຫາເຊີບເວີທີ່ໃກ້ທີ່ສຸດ",
  "status.serversChecked": "ກວດແລ້ວ {done}/{total}",
  "status.measuringPing": "ກຳລັງວັດຄວາມໜ່ວງ",
  "status.measuringDownload": "ກຳລັງວັດຄວາມໄວດາວໂຫຼດ",
  "status.measuringUpload": "ກຳລັງວັດຄວາມໄວອັບໂຫຼດ",
  "status.elapsed": "{elapsed}s / {total}s",
  "status.fastest": "ໄວທີ່ສຸດ",
  "status.done": "ທົດສອບສຳເລັດ",

  "metric.download": "ດາວໂຫຼດ",
  "metric.upload": "ອັບໂຫຼດ",
  "metric.ping": "ຄວາມໜ່ວງ",
  "metric.jitter": "ການແກວ່ງ",
  "metric.pingIdle": "ຕອນຫວ່າງ",
  "metric.pingLoaded": "ຕອນມີການໃຊ້ງານ",

  "unit.mbps": "Mbps",
  "unit.ms": "ms",
  "unit.percent": "%",

  "server.label": "ເຊີບເວີ",
  "server.unknown": "ຍັງບໍ່ໄດ້ເລືອກ",

  "net.connection": "ການເຊື່ອມຕໍ່",
  "net.unknown": "ບໍ່ຮູ້",

  "result.testId": "ລະຫັດຜົນ",
  "result.testIdHint": "ແຈ້ງລະຫັດນີ້ໃຫ້ຝ່າຍປະຕິບັດການເຄືອຂ່າຍ ເພື່ອເອີ້ນເບິ່ງການທົດສອບຄັ້ງນີ້",

  "loaded.title": "ຄວາມໜ່ວງເມື່ອມີການໃຊ້ງານ",
  "loaded.explain": "ຄວາມໜ່ວງທີ່ການເຊື່ອມຕໍ່ເພີ່ມຂຶ້ນເມື່ອກຳລັງໃຊ້ງານ. ຖ້າເພີ່ມຫຼາຍ ການໂທ ແລະ ປະຊຸມທາງວິດີໂອຈະຂາດຕອນ ເຖິງວ່າຄວາມໄວຈະເບິ່ງຄືດີ.",
  "loaded.download": "ຕອນດາວໂຫຼດ",
  "loaded.upload": "ຕອນອັບໂຫຼດ",
  "loaded.idle": "ຕອນຫວ່າງ",
  "loaded.worst": "ສູງສຸດ {value} ms",
  "loaded.increase": "+{value} ms",
  "loaded.loss": "ການສຳຫຼວດລົ້ມເຫຼວ",
  "loaded.lossSamples": "ສຳຫຼວດ {count} ຄັ້ງ",
  "loaded.lossCaveat": "ອັດຕາການສຳຫຼວດທີ່ລົ້ມເຫຼວ ຫຼື ໝົດເວລາ. TCP ປົກປິດການສູນເສຍແພັກເກັດເລັກນ້ອຍໄດ້ ສະນັ້ນຄ່າສູງໝາຍເຖິງບັນຫາຈິງ ແຕ່ຄ່າ 0 ບໍ່ໄດ້ພິສູດວ່າສາຍສະອາດ.",

  "result.summary":
    "ດາວໂຫຼດ {download} Mbps, ອັບໂຫຼດ {upload} Mbps, ຄວາມໜ່ວງ {ping} ມິນລິວິນາທີ",

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
  "history.details": "ລາຍລະອຽດການວັດ",
  "history.filterAll": "ທັງໝົດ",
  "history.count": "{count} ຜົນ",
  "history.dayCount": "{count} ຄັ້ງ",
  "history.loadMore": "ເບິ່ງເພີ່ມເຕີມ (ຍັງເຫຼືອ {count})",
  "history.showAll": "ສະແດງທັງໝົດ",
  "history.collapse": "ຫຍໍ້ເຂົ້າ",

  "logout.confirm":
    "ອອກຈາກລະບົບບໍ່? ຜົນທີ່ບັນທຶກໄວ້ໃນເຄື່ອງນີ້ຈະຖືກລຶບ.",

  "a11y.gauge": "ຄວາມໄວປັດຈຸບັນ: {value} ເມກາບິດຕໍ່ວິນາທີ",
  "a11y.progress": "ຄວາມຄືບໜ້າການທົດສອບ",
  "a11y.home": "ໜ້າຫຼັກ",
  "a11y.langSwitch": "ພາສາ",

  // Sync queue (sync/outbox.js)
  "sync.storedLocally": "ບັນທຶກ {count} ຜົນລົງເຄື່ອງແລ້ວ",
  "sync.pending": "{count} ຜົນກຳລັງລໍຖ້າສົ່ງຂຶ້ນ",
  "sync.allSent": "ສົ່ງຜົນທັງໝົດຂຶ້ນແລ້ວ",
  "sync.sent": "ສົ່ງແລ້ວ",
  "share.copied": "ຄັດລອກແລ້ວ",
  "share.blocked": "ບໍ່ສາມາດແບ່ງປັນໄຟລ໌ໄດ້",
  "sync.notSent": "ຍັງບໍ່ໄດ້ສົ່ງ",
  "sync.kept": "ເກັບໄວ້ {count} ຜົນ - ຍັງບໍ່ໄດ້ສົ່ງ",

  // Interrupted / invalid runs (context/network.js)
  "error.offlineTitle": "ບໍ່ມີການເຊື່ອມຕໍ່ອິນເຕີເນັດ",
  "error.offlineBody": "ອຸປະກອນຍັງບໍ່ໄດ້ເຊື່ອມຕໍ່ເຄືອຂ່າຍ. ກະລຸນາເຊື່ອມຕໍ່ແລ້ວລອງໃໝ່ — ເຊີບເວີທົດສອບບໍ່ມີບັນຫາ.",
  "error.offlineDuringBody": "ການເຊື່ອມຕໍ່ຫຼຸດລະຫວ່າງການວັດ ຈຶ່ງໄດ້ຍົກເລີກຜົນ. ກະລຸນາຍ້າຍໄປບ່ອນທີ່ມີສັນຍານແລ້ວລອງໃໝ່.",
  "error.backgroundedTitle": "ການວັດຖືກລົບກວນ",
  "error.backgroundedBody": "ແອັບຖືກຍ້າຍໄປພື້ນຫຼັງລະຫວ່າງການວັດ. ສິ່ງນັ້ນເຮັດໃຫ້ການວັດຊ້າລົງໂດຍບໍ່ແຈ້ງເຕືອນ ຈຶ່ງຍົກເລີກຜົນແທນທີ່ຈະລາຍງານວ່າສາຍຊ້າ.",
  "error.hintCoverage": "ຍ້າຍໄປບ່ອນທີ່ມີສັນຍານດີກວ່າ",
  "error.hintStayOpen": "ເປີດໜ້ານີ້ໄວ້ຈົນກວ່າການທົດສອບຈະສຳເລັດ",
  "result.invalid.network-changed": "ເຄືອຂ່າຍປ່ຽນລະຫວ່າງການວັດ ຜົນນີ້ອາດເປັນຂອງການເຊື່ອມຕໍ່ອື່ນ.",
  "result.invalid.went-offline": "ການເຊື່ອມຕໍ່ຫຼຸດລະຫວ່າງການວັດ ຜົນນີ້ອາດບໍ່ຄົບຖ້ວນ.",

  // Web access and video stages (CHANGE-010)
  "stage.browse": "ເວັບ",
  "stage.video": "ວິດີໂອ",
  "status.measuringBrowse": "ກຳລັງກວດການເຂົ້າເວັບ",
  "status.measuringVideo": "ກຳລັງກວດການຫຼິ້ນວິດີໂອ",
  "metric.browse": "ການເຂົ້າເວັບ",
  "metric.video": "ວິດີໂອ",
  "browse.result": "{bytes} KB ໃນ {time} ms",
  "browse.skipped": "ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ",
  "browse.averageLoadTime": "ເວລາໂຫຼດສະເລ່ຍ",
  "browse.successRate": "ອັດຕາການໂຫຼດສຳເລັດ",
  "browse.viewDetails": "ລາຍລະອຽດເວັບໄຊທີ່ທົດສອບ ({count})",
  "video.timeToPlay": "ເວລາເລີ່ມຫຼິ້ນ",
  "video.startupTime": "ເວລາເລີ່ມຫຼິ້ນ",
  "video.rebuffering": "ການຢຸດພາບ",
  "video.bufferingCount": "ຈຳນວນຄັ້ງການລໍຖ້າ",
  "video.stalls": "ຄັ້ງ",
  "video.throughput": "ຄວາມໄວສົ່ງວິດີໂອ",
  "video.highestQuality": "ຄຸນນະພາບສູງສຸດທີ່ລ່ຽນໄຫຼ",
  "video.quality": "ຄຸນນະພາບ",

  "unit.s": "s",

  "status.calculatingQoE": "ກຳລັງຄິດໄລ່ຄະແນນຄຸນນະພາບປະສົບການ (QoE)",
  "status.calculating": "ກຳລັງປະເມີນ",

  "grade.excellent": "ດີຫຼາຍ",
  "grade.good": "ດີ",
  "grade.average": "ປານກາງ",
  "grade.poor": "ອ່ອນ",
  "grade.veryPoor": "ອ່ອນຫຼາຍ",

  "qoe.overallTitle": "ຄຸນນະພາບເຄືອຂ່າຍໂດຍລວມ (QoE)",
  "qoe.score": "ຄະແນນປະສົບການເຄືອຂ່າຍ",
  "qoe.gradeDesc.excellent": "ປະສົບການອິນເຕີເນັດລ່ຽນໄຫຼຫຼາຍ. ເໝາະສຳລັບການເບິ່ງວິດີໂອ 4K, ຫຼິ້ນເກມອອນລາຍ, ໂທວິດີໂອ HD ແລະ ທ່ອງເວັບໄດ້ທັນທີ.",
  "qoe.gradeDesc.good": "ປະສົບການເຄືອຂ່າຍດີ. ເບິ່ງວິດີໂອ HD ໄດ້ລ່ຽນໄຫຼ ແລະ ເຂົ້າເວັບໄຊໄດ້ໄວ.",
  "qoe.gradeDesc.average": "ຄຸນນະພາບປານກາງ. ເບິ່ງວິດີໂອ ແລະ ທ່ອງເວັບໄດ້ທົ່ວໄປ ແຕ່ເນື້ອຫາໃຫຍ່ອາດມີການລໍຖ້າເລັກນ້ອຍ.",
  "qoe.gradeDesc.poor": "ການເຊື່ອມຕໍ່ຊ້າ. ໜ້າເວັບໃຊ້ເວລາໂຫຼດດົນ ແລະ ວິດີໂອມັກຈະຢຸດເພື່ອໂຫຼດຂໍ້ມູນ.",
  "qoe.gradeDesc.veryPoor": "ການເຊື່ອມຕໍ່ອ່ອນຫຼາຍ. ເວລາຕອບສະໜອງຊ້າຫຼາຍ ແລະ ຂາດຕອນເລື້ອຍໆ."
};
