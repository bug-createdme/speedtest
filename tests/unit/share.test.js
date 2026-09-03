import { describe, expect, it, vi } from "vitest";

import { parseShareResult } from "../../ui/src/bridge/windvane.js";
import { copyToClipboard, downloadFile, summaryText } from "../../ui/src/report/share.js";

/*
  The share path has one job that matters: never claim a result left the device
  when it did not. parseShareResult decides whether the bridge actually opened a
  sheet, and getting that wrong in the optimistic direction means the caller
  stops trying and the surveyor believes they sent something.
*/

describe("parseShareResult", () => {
  it("accepts the documented reply", () => {
    expect(
      parseShareResult({ code: 200, message: "Share sheet presented successfully", success: true })
    ).toBe(true);
  });

  /* The same super-app wraps other replies this way - getUserLocation does -
     so both shapes have to be understood here too. */
  it("accepts the envelope form, with data as an object or a JSON string", () => {
    expect(parseShareResult({ ret: "HY_SUCCESS", status: "SUCCESS", data: { success: true } })).toBe(true);
    expect(parseShareResult({ data: '{"code":200,"success":true}' })).toBe(true);
  });

  it("accepts success signalled by code alone", () => {
    expect(parseShareResult({ code: 200 })).toBe(true);
  });

  /*
    The direction that matters. A reply that arrived but says nothing useful is
    "did not share" - claiming otherwise would stop the caller falling back to
    the clipboard, and the user would be told it was shared when it was not.
  */
  it("refuses anything that does not actually say it worked", () => {
    expect(parseShareResult(null)).toBe(false);
    expect(parseShareResult(undefined)).toBe(false);
    expect(parseShareResult({})).toBe(false);
    expect(parseShareResult({ success: false })).toBe(false);
    expect(parseShareResult({ code: 500 })).toBe(false);
    expect(parseShareResult({ message: "ok" })).toBe(false);
    expect(parseShareResult({ data: "not json" })).toBe(false);
  });
});

describe("summaryText", () => {
  const run = {
    testId: "abc123",
    download: 23.42,
    upload: 5.118,
    ping: 28.4,
    server: "Vientiane",
    operator: "Unitel",
    place: "Vientiane Capital",
    at: "2026-08-27T09:00:00.000Z"
  };

  it("leads with the speeds and ends with the id operations quotes", () => {
    const lines = summaryText(run).split("\n");
    expect(lines[0]).toBe("Speed test result");
    expect(lines[1]).toBe("Download: 23.4 Mbps");
    expect(lines[2]).toBe("Upload: 5.1 Mbps");
    expect(lines[3]).toBe("Ping: 28 ms");
    expect(lines[lines.length - 1]).toBe("Result ID: abc123");
  });

  /*
    Absent is left out, not printed empty. "Province: -" reads as a value the
    app failed to fill in; the line simply not being there says nothing, which
    is what is true when no boundary table is loaded.
  */
  it("omits the lines it has no value for", () => {
    const text = summaryText({ download: 10, upload: 2, ping: 30 });
    expect(text).not.toContain("Province");
    expect(text).not.toContain("Operator");
    expect(text).not.toContain("Result ID");
    expect(text).not.toContain("undefined");
  });

  it("prints a dash for a missing figure rather than a wrong zero", () => {
    const text = summaryText({ testId: "x" });
    expect(text).toContain("Download: - Mbps");
    expect(text).not.toContain("0.0 Mbps");
  });

  it("survives being handed nothing", () => {
    expect(summaryText(undefined).split("\n")[0]).toBe("Speed test result");
  });
});

describe("copyToClipboard", () => {
  it("returns false for empty input", async () => {
    expect(await copyToClipboard("")).toBe(false);
    expect(await copyToClipboard(null)).toBe(false);
  });

  it("writes text via navigator.clipboard when available", async () => {
    const originalClipboard = navigator.clipboard;
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true
    });

    const res = await copyToClipboard("hello speedtest");
    expect(res).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("hello speedtest");

    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true
    });
  });
});

describe("downloadFile", () => {
  it("returns false in node / non-browser environment or empty input", () => {
    expect(downloadFile(null, "test.csv")).toBe(false);
  });
});

/*
  The Android export bug, as a test.

  What shipped: a .xlsx was base64-encoded and pushed through WVFile.write,
  which stores the string it is handed. The container answered with something
  non-null, the old parser read that as success, and the surveyor was told a
  spreadsheet had been saved over a text file full of base64.

  So the rule saveFile enforces is: a format with no faithful text form has no
  route through the bridge, and says so.
*/
describe("saveFile", () => {
  const superAppUa =
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 WindVane/8.5.0 Unitel/3.2";

  function inSuperApp(fn) {
    const original = Object.getOwnPropertyDescriptor(navigator, "userAgent");
    Object.defineProperty(navigator, "userAgent", {
      value: superAppUa,
      configurable: true
    });
    return Promise.resolve(fn()).finally(() => {
      if (original) Object.defineProperty(navigator, "userAgent", original);
    });
  }

  /*
    The Android container as it actually behaves, standing in for a device.

    A bridge object has to exist or whenBridgeReady() polls for its full four
    seconds before every call and the tests time out rather than fail. What it
    answers is the refusal the real container gives - the mini-app has no
    WVFile authorization - so these exercise the fallback ladder for the
    reason it exists.
  */
  function onAndroid(fn, bridge) {
    const hadWindow = "window" in globalThis;
    const originalWindow = globalThis.window;
    const originalWv = globalThis.WindVane;
    const originalShare = navigator.share;
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

    if (!hadWindow) globalThis.window = globalThis;
    globalThis.WindVane = {
      call:
        bridge ||
        ((ns, method, params, onSuccess, onError) =>
          onError({ msg: "Please apply for JSAPI authorization" }))
    };
    delete navigator.share; // Android WebView has no Web Share API at all
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.resolve() },
      configurable: true
    });

    return inSuperApp(fn).finally(() => {
      if (hadWindow) globalThis.window = originalWindow;
      else delete globalThis.window;
      if (originalWv === undefined) delete globalThis.WindVane;
      else globalThis.WindVane = originalWv;
      if (originalShare) navigator.share = originalShare;
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else delete navigator.clipboard;
    });
  }

  it("refuses an empty request", async () => {
    const { saveFile } = await import("../../ui/src/report/share.js");
    expect(await saveFile({})).toMatchObject({ ok: false, route: "none" });
  });

  it("will not push binary through the bridge", async () => {
    const { saveFile } = await import("../../ui/src/report/share.js");
    const share = navigator.share;
    delete navigator.share; // Android WebView has no Web Share API at all

    const res = await inSuperApp(() =>
      saveFile({
        blob: new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]),
        filename: "speedtest-history.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        /* no bridgeText - a ZIP has no faithful text form */
      })
    );

    if (share) navigator.share = share;
    expect(res).toMatchObject({ ok: false, reason: "binary-no-bridge-route" });
  });

  it("takes the share sheet when the WebView has one, as iOS does", async () => {
    const { saveFile } = await import("../../ui/src/report/share.js");
    const shared = [];
    const originalShare = navigator.share;
    const originalCanShare = navigator.canShare;
    navigator.share = payload => {
      shared.push(payload);
      return Promise.resolve();
    };
    navigator.canShare = () => true;

    const res = await saveFile({
      blob: new Blob(["a,b\n1,2"], { type: "text/csv" }),
      filename: "speedtest-history.csv",
      mime: "text/csv",
      bridgeText: "a,b\n1,2"
    });

    navigator.share = originalShare;
    navigator.canShare = originalCanShare;

    expect(res).toMatchObject({ ok: true, route: "share" });
    expect(shared[0].files[0].name).toBe("speedtest-history.csv");
  });

  /*
    The link route: what Android is left with once the Web Share API is absent
    and the container has refused WVFile. It has to run AFTER both local
    routes, because it is the only one that sends subscriber data to a server.
  */
  it("uploads and shares a link when no local route carries the file", async () => {
    const share = await import("../../ui/src/report/share.js");
    const originalFetch = globalThis.fetch;

    const posted = [];
    globalThis.fetch = (url, init) => {
      posted.push({ url, init });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ url: "https://be.example/export.php?id=abc", expires_in: 1800 })
      });
    };
    share.setExportEndpoint("https://be.example/backend/export.php");

    const res = await onAndroid(() =>
      share.saveFile({
        blob: new Blob([new Uint8Array([0x50, 0x4b])]),
        filename: "speedtest-history.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      })
    );

    globalThis.fetch = originalFetch;
    share.setExportEndpoint("");

    /* Even the binary format gets out this way, which is the point of it. */
    expect(res).toMatchObject({ ok: true, route: "link" });
    expect(posted[0].url).toContain("name=speedtest-history.xlsx");
    expect(posted[0].url).toContain("cors=true");
    expect(posted[0].init.method).toBe("POST");
  });

  it("says the upload failed rather than blaming the container", async () => {
    const share = await import("../../ui/src/report/share.js");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve({ ok: false, status: 413 });
    share.setExportEndpoint("https://be.example/backend/export.php");

    const res = await onAndroid(() =>
      share.saveFile({
        blob: new Blob(["a,b"], { type: "text/csv" }),
        filename: "speedtest-history.csv",
        bridgeText: "a,b"
      })
    );

    globalThis.fetch = originalFetch;
    share.setExportEndpoint("");
    expect(res).toMatchObject({ ok: false, reason: "http-413" });
  });

  /* The local route still wins when the container does grant it: nothing is
     uploaded that did not have to be. */
  it("does not upload when the bridge accepted the write", async () => {
    const share = await import("../../ui/src/report/share.js");
    const originalFetch = globalThis.fetch;
    let uploaded = false;
    globalThis.fetch = () => {
      uploaded = true;
      return Promise.reject(new Error("should not be reached"));
    };
    share.setExportEndpoint("https://be.example/backend/export.php");

    const res = await onAndroid(
      () =>
        share.saveFile({
          blob: new Blob(["a,b"], { type: "text/csv" }),
          filename: "speedtest-history.csv",
          bridgeText: "a,b"
        }),
      (ns, method, params, onSuccess) => onSuccess({ ret: ["HY_SUCCESS"] })
    );

    globalThis.fetch = originalFetch;
    share.setExportEndpoint("");
    expect(res).toMatchObject({ ok: true, route: "bridge" });
    expect(uploaded).toBe(false);
  });

  it("does not upload when no endpoint is configured", async () => {
    const share = await import("../../ui/src/report/share.js");
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = () => {
      called = true;
      return Promise.reject(new Error("should not be reached"));
    };
    share.setExportEndpoint("");

    const res = await share.uploadExport(new Blob(["a"]), "a.csv");

    globalThis.fetch = originalFetch;
    expect(called).toBe(false);
    expect(res).toMatchObject({ ok: false, reason: "no-endpoint" });
  });

  /* Closing the sheet is the user's decision, not a failure to fall back from:
     a second attempt would put a download they declined on their device. */
  it("treats a dismissed share sheet as handled", async () => {
    const { saveFile } = await import("../../ui/src/report/share.js");
    const originalShare = navigator.share;
    const originalCanShare = navigator.canShare;
    navigator.share = () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" }));
    navigator.canShare = () => true;

    const res = await saveFile({
      blob: new Blob(["a"], { type: "text/csv" }),
      filename: "speedtest-history.csv",
      bridgeText: "a"
    });

    navigator.share = originalShare;
    navigator.canShare = originalCanShare;
    expect(res).toMatchObject({ ok: true, route: "share" });
  });
});

