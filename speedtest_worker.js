/*
	LibreSpeed - Worker
	by Federico Dossena
	https://github.com/librespeed/speedtest/
	GNU LGPLv3 License
*/

// data reported to main thread
let testState = -1; // -1=not started, 0=starting, 1=download test, 2=ping+jitter test, 3=upload test, 4=finished, 5=abort
let dlStatus = ""; // download speed in megabit/s with 2 decimal digits
let ulStatus = ""; // upload speed in megabit/s with 2 decimal digits
let pingStatus = ""; // ping in milliseconds with 2 decimal digits
let jitterStatus = ""; // jitter in milliseconds with 2 decimal digits
let clientIp = ""; // client's IP address as reported by getIP.php
let dnsTime = 0; // DNS lookup time in ms for the connection to the test server, 0 if unavailable
let tcpTime = 0; // TCP connect time in ms for the connection to the test server, 0 if unavailable
let tlsTime = 0; // TLS handshake time in ms, 0 if unavailable or the connection isn't HTTPS
let ttfbTime = 0; // time to first byte in ms for the getIp request, 0 if unavailable
let idlePingAvgStatus = ""; // average idle ping in ms. pingStatus reports the MINIMUM, which answers "how good can this link get" but is not comparable with the loaded figures below - those have to be averages to mean anything
let dlPingStatus = ""; // average ping in ms measured while the download test was running
let dlPingMaxStatus = ""; // worst ping in ms seen during the download test
let ulPingStatus = ""; // average ping in ms measured while the upload test was running
let ulPingMaxStatus = ""; // worst ping in ms seen during the upload test
let probeLossStatus = ""; // percentage of latency PROBES that failed or timed out. NOT an IP packet loss counter - see the long note above sendProbe() before this number is put in front of anyone
let probeCountStatus = 0; // how many probes the figure above is based on

/*
	Everything below was already being measured and then thrown away.

	The transfer loops track total bytes and elapsed time in order to compute an
	average; the grace period is timed in order to know when to start counting;
	the ping test counts its own samples. None of it left the worker, so the
	stored result could only ever say "23.4 Mbps" - not how long the run took,
	how much data it cost the subscriber, or whether that average came out of a
	steady line or a spiky one.

	The field names mirror the nPerf export the partner's report is built from
	(BÁO CÁO TỔNG HỢP ĐO KIỂM.xlsb, sheet "1_DL nPert (thô)"), so the mapping in
	ui/src/measurement/record.js stays a rename rather than a calculation.

	Reporting units, fixed here so nothing downstream has to guess:
	  - speeds in Mbit/s, same convention and overhead compensation as dlStatus
	  - durations in milliseconds
	  - byte counts raw
*/
let dlPeakStatus = ""; // best 200ms window seen during the download, Mbit/s
let ulPeakStatus = ""; // same for the upload
let dlBytesStatus = 0; // bytes pulled, INCLUDING the grace period - this is what the run cost the subscriber's data allowance, not what the average was computed from
let ulBytesStatus = 0;
let dlDurationStatus = 0; // ms of measured transfer, excluding grace
let ulDurationStatus = 0;
let dlSlowstartStatus = 0; // ms actually spent in grace before measurement began. Not the same as the configured time_dlGraceTime: on a link too slow to deliver a single chunk the reset is skipped and this runs longer
let ulSlowstartStatus = 0;
let dlAvgIncSlowstartStatus = ""; // average over the WHOLE transfer including grace, Mbit/s. Always <= dlStatus; the gap between them is what the warm-up cost
let ulAvgIncSlowstartStatus = "";
let dlJitterStatus = ""; // variation of the latency probes taken during the download, ms
let ulJitterStatus = "";
let pingSamplesStatus = 0; // how many idle ping samples pingStatus/jitterStatus are drawn from

/*
	Bytes per second to the same Mbit/s figure dlStatus reports, so a peak and an
	average sitting next to each other are the same kind of number. Returns ""
	rather than "0.00" when there is nothing to report - a missing measurement
	and a measured zero must not look alike downstream.
*/
function toSpeedStatus(bytesPerSecond) {
	if (!(bytesPerSecond > 0) || !isFinite(bytesPerSecond)) return "";
	return ((bytesPerSecond * 8 * settings.overheadCompensationFactor) / (settings.useMebibits ? 1048576 : 1000000)).toFixed(2);
}
let dlProgress = 0; //progress of download test 0-1
let ulProgress = 0; //progress of upload test 0-1
let pingProgress = 0; //progress of ping+jitter test 0-1
let testId = null; //test ID (sent back by telemetry if used, null otherwise)

let log = ""; //telemetry log
function tlog(s) {
	if (settings.telemetry_level >= 2) {
		log += Date.now() + ": " + s + "\n";
	}
}
function tverb(s) {
	if (settings.telemetry_level >= 3) {
		log += Date.now() + ": " + s + "\n";
	}
}
function twarn(s) {
	if (settings.telemetry_level >= 2) {
		log += Date.now() + " WARN: " + s + "\n";
	}
	console.warn(s);
}

// test settings. can be overridden by sending specific values with the start command
let settings = {
	mpot: false, //set to true when in MPOT mode
	test_order: "IP_D_U", //order in which tests will be performed as a string. D=Download, U=Upload, P=Ping+Jitter, I=IP, _=1 second delay
	time_ul_max: 15, // max duration of upload test in seconds
	time_dl_max: 15, // max duration of download test in seconds
	time_auto: true, // if set to true, tests will take less time on faster connections
	time_ulGraceTime: 3, //time to wait in seconds before actually measuring ul speed (wait for buffers to fill)
	time_dlGraceTime: 1.5, //time to wait in seconds before actually measuring dl speed (wait for TCP window to increase)
	count_ping: 10, // number of pings to perform in ping test
	url_dl: "backend/garbage.php", // path to a large file or garbage.php, used for download test. must be relative to this js file
	url_ul: "backend/empty.php", // path to an empty file, used for upload test. must be relative to this js file
	url_ping: "backend/empty.php", // path to an empty file, used for ping test. must be relative to this js file
	url_getIp: "backend/getIP.php", // path to getIP.php relative to this js file, or a similar thing that outputs the client's ip
	getIp_ispInfo: true, //if set to true, the server will include ISP info with the IP address
	getIp_ispInfo_distance: "km", //km or mi=estimate distance from server in km/mi; set to false to disable distance estimation. getIp_ispInfo must be enabled in order for this to work
	xhr_dlMultistream: 6, // number of download streams to use (can be different if enable_quirks is active)
	xhr_ulMultistream: 3, // number of upload streams to use (can be different if enable_quirks is active)
	xhr_multistreamDelay: 300, //how much concurrent requests should be delayed
	loaded_latency: true, //also sample latency WHILE the transfers run, not only on an idle link. A line reporting 100 Mbps but 800ms of latency during a download is unusable for anything interactive, and the idle ping never shows it
	loaded_latency_interval: 250, //ms between latency probes while a transfer is running
	loaded_latency_timeout: 2000, //ms after which a probe counts as lost rather than merely slow
	xhr_ignoreErrors: 1, // 0=fail on errors, 1=attempt to restart a stream if it fails, 2=ignore all errors
	xhr_dlUseBlob: false, // if set to true, it reduces ram usage but uses the hard drive (useful with large garbagePhp_chunkSize and/or high xhr_dlMultistream)
	xhr_dlUseFetch: true, // if true and the browser supports it, download uses fetch()+ReadableStream instead of XHR responseType arraybuffer/blob. Each chunk is counted and discarded as it arrives instead of being held in memory until the whole response completes, which matters at high garbagePhp_chunkSize * xhr_dlMultistream. Falls back to XHR automatically where fetch/ReadableStream/AbortController aren't available (e.g. IE11). xhr_dlUseBlob is ignored when this is active.
	xhr_ul_blob_megabytes: 20, //size in megabytes of the upload blobs sent in the upload test (forced to 4 on chrome mobile)
	garbagePhp_chunkSize: 100, // size of chunks sent by garbage.php (can be different if enable_quirks is active)
	enable_quirks: true, // enable quirks for specific browsers. currently it overrides settings to optimize for specific browsers, unless they are already being overridden with the start command
	ping_allowPerformanceApi: true, // if enabled, the ping test will attempt to calculate the ping more precisely using the Performance API. Currently works perfectly in Chrome, badly in Edge, and not at all in Firefox. If Performance API is not supported or the result is obviously wrong, a fallback is provided.
	overheadCompensationFactor: 1.06, //can be changed to compensate for transport overhead. (see doc.md for some other values)
	useMebibits: false, //if set to true, speed will be reported in mebibits/s instead of megabits/s
	telemetry_level: 0, // 0=disabled, 1=basic (results only), 2=full (results and timing) 3=debug (results+log)
	url_telemetry: "results/telemetry.php", // path to the script that adds telemetry data to the database
	telemetry_extra: "", //extra data that can be passed to the telemetry through the settings
    forceIE11Workaround: false //when set to true, it will force the IE11 upload test on all browsers. Debug only
};

let xhr = null; // array of currently active xhr requests
let interval = null; // timer used in tests
let test_pointer = 0; //pointer to the next test to run inside settings.test_order

/*
  this function is used on URLs passed in the settings to determine whether we need a ? or an & as a separator
*/
function url_sep(url) {
	return url.match(/\?/) ? "&" : "?";
}

/*
	Builds the URL for one upload request. Deliberately has no cache-busting
	"r=" parameter, unlike the GET endpoints (download, ping): browsers never
	cache POST responses, and empty.php/its equivalents already send explicit
	no-cache headers, so "r=" bought nothing there. What it did do is defeat
	CORS-preflight caching: a cross-origin upload preflights on every single
	chunk regardless of headers, because attaching xhr.upload.onprogress alone
	makes the request non-simple (Chromium/WebKit's guard against leaking
	cross-origin upload timing). With a stable URL, the server's
	Access-Control-Max-Age lets the browser reuse that preflight instead of
	repeating it before every chunk.
*/
function uploadUrl(baseUrl) {
	return settings.mpot ? baseUrl + url_sep(baseUrl) + "cors=true" : baseUrl;
}

/*
	Resource Timing helpers, used by the ping test.

	The ping test needs the timing of one specific request. Reading the last entry
	of performance.getEntries() cannot give us that: the buffer holds every request
	the worker has made, it is capped (250 entries by default) and nothing ever
	clears it, so once the download and upload streams have filled it the "last
	entry" is a stale garbage.php entry rather than the ping that just completed.
	Worse, the caller only accepts the value when it is *lower* than the wall clock
	estimate, so a stale entry always drags the reported ping down.

	We therefore look the request up by its absolute URL, and keep the buffer clear
	so that ping entries always fit in it.
*/
function absoluteUrl(url) {
	try {
		return new URL(url, self.location.href).href;
	} catch (e) {
		return url; // no URL constructor (old browsers): the lookup will simply miss
	}
}
function resetResourceTimings() {
	try {
		if (typeof performance === "undefined") return;
		if (performance.setResourceTimingBufferSize) performance.setResourceTimingBufferSize(300);
		if (performance.clearResourceTimings) performance.clearResourceTimings();
	} catch (e) {}
}
/*
	Round trip for one absolute URL as measured by the Performance API, or null when
	it is unavailable, restricted or implausible. Cross origin responses only expose
	responseStart/requestStart when the server sends Timing-Allow-Origin; without it
	both read 0 and we fall back to the entry duration.
*/
function timingForUrl(url) {
	try {
		if (typeof performance === "undefined" || !performance.getEntriesByName) return null;
		const entries = performance.getEntriesByName(url);
		if (!entries || entries.length === 0) return null;
		const p = entries[entries.length - 1];
		let d = p.responseStart - p.requestStart;
		if (d <= 0) d = p.duration;
		return d > 0 ? d : null;
	} catch (e) {
		return null;
	}
}
/*
	DNS/TCP/TLS/TTFB breakdown for one absolute URL, from the same Resource
	Timing entry as timingForUrl(). Only meaningful for the request that
	*actually* opens the connection: once it's reused (HTTP keep-alive), later
	requests correctly report ~0 for domainLookup/connect/secureConnection,
	because no new lookup or handshake happened for them.

	Call this right after getIp(). That is the worker's own first request, but
	it is frequently NOT the first request to that origin overall: the normal
	multi-point-of-test flow (addTestPoint + selectServer) already pinged the
	same server from the main thread before the worker even starts, and a
	same-origin standalone deployment may have already warmed the connection
	just loading the page's own assets. In both cases dns/tcp/tls will
	legitimately read 0 here — that's an accurate "no new connection setup was
	needed" signal, not a bug, but it means a real positive reading is the
	exception rather than the rule for MPOT setups, which is exactly the
	setup this project's production deployment (WebView -> Unitel backend)
	is expected to use. ttfbTime doesn't have this caveat: it reflects this
	specific request regardless of whether the connection was already open.

	Cross origin responses only populate these fields at all if the server
	sends Timing-Allow-Origin for our origin; without it every value below
	reads 0, same restriction timingForUrl() already documents for
	responseStart/requestStart.
*/
function connectionTimingForUrl(url) {
	try {
		if (typeof performance === "undefined" || !performance.getEntriesByName) return null;
		const entries = performance.getEntriesByName(url);
		if (!entries || entries.length === 0) return null;
		const p = entries[entries.length - 1];
		const dns = p.domainLookupEnd - p.domainLookupStart;
		const tcp = p.connectEnd - p.connectStart;
		const tls = p.secureConnectionStart > 0 ? p.connectEnd - p.secureConnectionStart : 0;
		const ttfb = p.responseStart - p.requestStart;
		return {
			dns: dns > 0 ? dns : 0,
			tcp: tcp > 0 ? tcp : 0,
			tls: tls > 0 ? tls : 0,
			ttfb: ttfb > 0 ? ttfb : 0
		};
	} catch (e) {
		return null;
	}
}

/*
	listener for commands from main thread to this worker.
	commands:
	-status: returns the current status as a JSON string containing testState, dlStatus, ulStatus, pingStatus, clientIp, jitterStatus, dlProgress, ulProgress, pingProgress
	-abort: aborts the current test
	-start: starts the test. optionally, settings can be passed as JSON.
		example: start {"time_ul_max":"10", "time_dl_max":"10", "count_ping":"50"}
*/
this.addEventListener("message", function(e) {
	const params = e.data.split(" ");
	if (params[0] === "status") {
		// return status
		postMessage(
			JSON.stringify({
				testState: testState,
				dlStatus: dlStatus,
				ulStatus: ulStatus,
				pingStatus: pingStatus,
				clientIp: clientIp,
				jitterStatus: jitterStatus,
				dlProgress: dlProgress,
				ulProgress: ulProgress,
				pingProgress: pingProgress,
				testId: testId,
				dnsTime: dnsTime,
				tcpTime: tcpTime,
				tlsTime: tlsTime,
				ttfbTime: ttfbTime,
				idlePingAvgStatus: idlePingAvgStatus,
				dlPingStatus: dlPingStatus,
				dlPingMaxStatus: dlPingMaxStatus,
				ulPingStatus: ulPingStatus,
				ulPingMaxStatus: ulPingMaxStatus,
				probeLossStatus: probeLossStatus,
				probeCountStatus: probeCountStatus,
				dlPeakStatus: dlPeakStatus,
				ulPeakStatus: ulPeakStatus,
				dlBytesStatus: dlBytesStatus,
				ulBytesStatus: ulBytesStatus,
				dlDurationStatus: dlDurationStatus,
				ulDurationStatus: ulDurationStatus,
				dlSlowstartStatus: dlSlowstartStatus,
				ulSlowstartStatus: ulSlowstartStatus,
				dlAvgIncSlowstartStatus: dlAvgIncSlowstartStatus,
				ulAvgIncSlowstartStatus: ulAvgIncSlowstartStatus,
				dlJitterStatus: dlJitterStatus,
				ulJitterStatus: ulJitterStatus,
				pingSamplesStatus: pingSamplesStatus,
				dlStreams: settings.xhr_dlMultistream,
				ulStreams: settings.xhr_ulMultistream
			})
		);
	}
	if (params[0] === "start" && testState === -1) {
		// start new test
		testState = 0;
		try {
			// parse settings, if present
			let s = {};
			try {
				const ss = e.data.substring(5);
				if (ss) s = JSON.parse(ss);
			} catch (e) {
				twarn("Error parsing custom settings JSON. Please check your syntax");
			}
			//copy custom settings
			for (let key in s) {
				if (typeof settings[key] !== "undefined") settings[key] = s[key];
				else twarn("Unknown setting ignored: " + key);
			}
			const ua = navigator.userAgent;
			// quirks for specific browsers. apply only if not overridden. more may be added in future releases
			if (settings.enable_quirks || (typeof s.enable_quirks !== "undefined" && s.enable_quirks)) {
				if (/Firefox.(\d+\.\d+)/i.test(ua)) {
					if (typeof s.ping_allowPerformanceApi === "undefined") {
						// ff performance API sucks
						settings.ping_allowPerformanceApi = false;
					}
				}
				if (/Edge.(\d+\.\d+)/i.test(ua)) {
					if (typeof s.xhr_dlMultistream === "undefined") {
						// edge more precise with 3 download streams
						settings.xhr_dlMultistream = 3;
					}
				}
				if (/Chrome.(\d+)/i.test(ua) && !!self.fetch) {
					if (typeof s.xhr_dlMultistream === "undefined") {
						// chrome more precise with 5 streams
						settings.xhr_dlMultistream = 5;
					}
				}
			}
			if (/Edge.(\d+\.\d+)/i.test(ua)) {
				//Edge 15 introduced a bug that causes onprogress events to not get fired, we have to use the "small chunks" workaround that reduces accuracy
				settings.forceIE11Workaround = true;
			}
			if (/PlayStation 4.(\d+\.\d+)/i.test(ua)) {
				//PS4 browser has the same bug as IE11/Edge
				settings.forceIE11Workaround = true;
			}
			if (/Chrome.(\d+)/i.test(ua) && /Android|iPhone|iPad|iPod|Windows Phone/i.test(ua)) {
				//cheap af
				//Chrome mobile introduced a limitation somewhere around version 65, we have to limit XHR upload size to 4 megabytes
				settings.xhr_ul_blob_megabytes = 4;
			}
			if (/^((?!chrome|android|crios|fxios).)*safari/i.test(ua)) {
				//Safari also needs the IE11 workaround but only for the MPOT version
				settings.forceIE11Workaround = true;
			}
			//telemetry_level has to be parsed and not just copied
			if (typeof s.telemetry_level !== "undefined") settings.telemetry_level = s.telemetry_level === "basic" ? 1 : s.telemetry_level === "full" ? 2 : s.telemetry_level === "debug" ? 3 : 0; // telemetry level
			//transform test_order to uppercase, just in case
			settings.test_order = settings.test_order.toUpperCase();
			/*
				Reserve one connection slot for the latency probe.
			
				Browsers cap concurrent connections per host at 6 - Chrome, Firefox and
				Safari alike. The download test opens xhr_dlMultistream of them, so at the
				default 6 there is no slot left: the probe would sit in the browser's own
				queue waiting for a stream to finish. It would still produce a number, and
				that number would be queueing delay inside the browser rather than latency
				on the network - the one thing the measurement exists to find. Chrome
				already gets 5 from the quirks above, so on the most common browser this
				changes nothing at all.
			*/
			if (settings.loaded_latency && settings.xhr_dlMultistream > 5) {
				settings.xhr_dlMultistream = 5;
			}
		} catch (e) {
			twarn("Possible error in custom test settings. Some settings might not have been applied. Exception: " + e);
		}
		// run the tests
		tverb(JSON.stringify(settings));
		test_pointer = 0;
		let iRun = false,
			dRun = false,
			uRun = false,
			pRun = false;
		const runNextTest = function() {
			if (testState == 5) return;
			if (test_pointer >= settings.test_order.length) {
				//test is finished
				if (settings.telemetry_level > 0)
					sendTelemetry(function(id) {
						testState = 4;
						if (id != null) testId = id;
					});
				else testState = 4;
				return;
			}
			switch (settings.test_order.charAt(test_pointer)) {
				case "I":
					{
						test_pointer++;
						if (iRun) {
							runNextTest();
							return;
						} else iRun = true;
						getIp(runNextTest);
					}
					break;
				case "D":
					{
						test_pointer++;
						if (dRun) {
							runNextTest();
							return;
						} else dRun = true;
						testState = 1;
						dlTest(runNextTest);
					}
					break;
				case "U":
					{
						test_pointer++;
						if (uRun) {
							runNextTest();
							return;
						} else uRun = true;
						testState = 3;
						ulTest(runNextTest);
					}
					break;
				case "P":
					{
						test_pointer++;
						if (pRun) {
							runNextTest();
							return;
						} else pRun = true;
						testState = 2;
						pingTest(runNextTest);
					}
					break;
				case "_":
					{
						test_pointer++;
						setTimeout(runNextTest, 1000);
					}
					break;
				default:
					test_pointer++;
			}
		};
		runNextTest();
	}
	if (params[0] === "abort") {
		// abort command
        if (testState >= 4) return;
		tlog("manually aborted");
		clearRequests(); // stop all xhr activity
		//runNextTest is block scoped to the start handler, so assigning it here only
		//ever created an implicit global. The testState check at the top of the chain
		//and clearRequests() above are what actually stop the run.
		if (interval) clearInterval(interval); // clear timer if present
		if (settings.telemetry_level > 1) sendTelemetry(function() {});
		testState = 5; //set test as aborted
		dlStatus = "";
		ulStatus = "";
		pingStatus = "";
		jitterStatus = "";
        clientIp = "";
		dlProgress = 0;
		ulProgress = 0;
		pingProgress = 0;
		dnsTime = 0;
		tcpTime = 0;
		tlsTime = 0;
		ttfbTime = 0;
		idlePingAvgStatus = "";
		dlPingStatus = "";
		dlPingMaxStatus = "";
		ulPingStatus = "";
		ulPingMaxStatus = "";
		probeLossStatus = "";
		probeCountStatus = 0;
		dlPeakStatus = "";
		ulPeakStatus = "";
		dlBytesStatus = 0;
		ulBytesStatus = 0;
		dlDurationStatus = 0;
		ulDurationStatus = 0;
		dlSlowstartStatus = 0;
		ulSlowstartStatus = 0;
		dlAvgIncSlowstartStatus = "";
		ulAvgIncSlowstartStatus = "";
		dlJitterStatus = "";
		ulJitterStatus = "";
		pingSamplesStatus = 0;
		loadedLatency = { dl: { sent: 0, lost: 0, samples: [] }, ul: { sent: 0, lost: 0, samples: [] } };
	}
});
// stops all XHR activity, aggressively
function clearRequests() {
	tverb("stopping pending XHRs");
	/*
		The latency probe is not in the xhr array - it has its own slot so that a
		transfer stream restarting cannot clobber it. That means the loop below
		would not touch it, and an aborted test would leave it firing at the server
		until the worker itself was torn down. Stopping it here covers every path
		that ends a test, including the manual abort.
	*/
	stopLatencyProbe();
	if (xhr) {
		for (let i = 0; i < xhr.length; i++) {
			try {
				xhr[i].onprogress = null;
				xhr[i].onload = null;
				xhr[i].onerror = null;
			} catch (e) {}
			try {
				xhr[i].upload.onprogress = null;
				xhr[i].upload.onload = null;
				xhr[i].upload.onerror = null;
			} catch (e) {}
			try {
				xhr[i].abort();
			} catch (e) {}
			try {
				delete xhr[i];
			} catch (e) {}
		}
		xhr = null;
	}
}
// gets client's IP using url_getIp, then calls the done function
let ipCalled = false; // used to prevent multiple accidental calls to getIp
let ispInfo = ""; //used for telemetry
function getIp(done) {
	tverb("getIp");
	if (ipCalled) return;
	else ipCalled = true; // getIp already called?
	let startT = new Date().getTime();
	const ipUrl = settings.url_getIp + url_sep(settings.url_getIp) + (settings.mpot ? "cors=true&" : "") + (settings.getIp_ispInfo ? "isp=true" + (settings.getIp_ispInfo_distance ? "&distance=" + settings.getIp_ispInfo_distance + "&" : "&") : "&") + "r=" + Math.random();
	const ipUrlAbs = absoluteUrl(ipUrl);
	xhr = new XMLHttpRequest();
	xhr.onload = function() {
		tlog("IP: " + xhr.responseText + ", took " + (new Date().getTime() - startT) + "ms");
		try {
			const data = JSON.parse(xhr.responseText);
			clientIp = data.processedString;
			ispInfo = data.rawIspInfo;
		} catch (e) {
			clientIp = xhr.responseText;
			ispInfo = "";
		}
		// getIp is always the first request to the test server (ping now runs
		// before download/upload), so this is the one point in the whole test
		// where DNS lookup / TCP connect / TLS handshake timing is meaningful.
		const t = connectionTimingForUrl(ipUrlAbs);
		if (t) {
			dnsTime = t.dns;
			tcpTime = t.tcp;
			tlsTime = t.tls;
			ttfbTime = t.ttfb;
		}
		done();
	};
	xhr.onerror = function() {
		tlog("getIp failed, took " + (new Date().getTime() - startT) + "ms");
		done();
	};
	xhr.open("GET", ipUrl, true);
	xhr.send();
}
/*
	Latency under load, and probe loss.
	
	The idle ping answers "how far away is the server". It says nothing about the
	question network operations actually has, which is whether the link stays
	usable while it is carrying traffic. A line that reports 100 Mbps down and 20ms
	idle, but 800ms of latency the moment a download starts, is a broken line for
	anything interactive - calls, games, video conferencing - and the idle figure
	alone reports it as healthy. That gap is bufferbloat, and measuring it means
	probing WHILE the transfer runs.
	
	One probe at a time, spaced by loaded_latency_interval, against the same
	url_ping endpoint the idle test uses. Deliberately sequential: a burst of
	parallel probes would compete with the transfer streams for the browser's
	connection pool and measure that contention instead of the network.
	
	ON THE LOSS FIGURE - read this before trusting it.
	
	What is counted is the share of probes that failed or exceeded
	loaded_latency_timeout. That is a REQUEST loss rate, not an IP packet loss
	counter. TCP retransmits below us, so a link genuinely dropping a few percent
	of packets will usually still complete every probe, just more slowly, and this
	figure will read 0.00%. It moves when loss is bad enough, or latency long
	enough, that a whole request cannot complete inside the timeout.
	
	So: a high number here is strong evidence of a problem. A zero is NOT evidence
	of a clean link. probeCountStatus is reported alongside it so nobody reads a
	"0.00%" drawn from 40 samples as a link-level guarantee.
*/
let loadedLatency = {
	dl: { sent: 0, lost: 0, samples: [] },
	ul: { sent: 0, lost: 0, samples: [] }
};
let probe = null; // in-flight probe machinery, null when nothing is being probed

function startLatencyProbe(phase) {
	if (!settings.loaded_latency) return;
	stopLatencyProbe();
	probe = { phase: phase, xhr: null, timer: null, stopped: false };
	sendProbe();
}

/*
	Discard what was collected during the grace period. The transfer ignores those
	first seconds too, because the buffers are still filling and the throughput
	figure would be wrong; the latency figure is wrong for the same reason and for
	the same window, so both measure the same steady state.
*/
function resetLoadedLatencyPhase(phase) {
	loadedLatency[phase] = { sent: 0, lost: 0, samples: [] };
	publishLoadedLatency();
}

function stopLatencyProbe() {
	if (!probe) return;
	const dying = probe;
	probe = null;
	dying.stopped = true;
	if (dying.timer) {
		try {
			clearTimeout(dying.timer);
		} catch (e) {}
	}
	if (dying.xhr) {
		try {
			dying.xhr.onload = null;
			dying.xhr.onerror = null;
			dying.xhr.ontimeout = null;
			dying.xhr.abort();
		} catch (e) {}
	}
}

function sendProbe() {
	if (!probe || probe.stopped) return;
	const current = probe;
	const stats = loadedLatency[current.phase];
	const url = settings.url_ping + url_sep(settings.url_ping) + (settings.mpot ? "cors=true&" : "") + "r=" + Math.random();
	const sentAt = new Date().getTime();
	const x = new XMLHttpRequest();
	current.xhr = x;
	stats.sent++;
	const finish = function(lost) {
		if (current.stopped || current !== probe) return; // phase ended while this was in flight
		current.xhr = null;
		if (lost) {
			stats.lost++;
		} else {
			let rtt = new Date().getTime() - sentAt;
			if (rtt < 1) rtt = 1; // some browsers report a flat 0 on a fast local link
			stats.samples.push(rtt);
		}
		publishLoadedLatency();
		current.timer = setTimeout(sendProbe, settings.loaded_latency_interval);
	};
	x.onload = function() {
		// url_ping answers with an empty body; anything else means we did not reach it
		finish(x.responseText.length !== 0);
	};
	x.onerror = function() {
		finish(true);
	};
	x.ontimeout = function() {
		finish(true);
	};
	try {
		x.timeout = settings.loaded_latency_timeout;
	} catch (e) {} // IE11 has no XHR timeout; probes there can only be counted as lost on error
	x.open("GET", url, true);
	x.send();
}

/*
	Averages, not minimums.
	
	The idle test reports the lowest ping it saw, which is the right way to ask
	"how good can this link get". Under load it is the wrong question and an
	actively misleading answer: a single probe slipping through between buffer
	drains would report an unloaded-looking figure for a badly bloated link. The
	average is what a user experiences, and the maximum is what makes a call drop.
*/
function publishLoadedLatency() {
	const dl = loadedLatency.dl;
	const ul = loadedLatency.ul;

	const totalSent = dl.sent + ul.sent;
	const totalLost = dl.lost + ul.lost;
	probeCountStatus = totalSent;
	probeLossStatus = totalSent > 0 ? ((totalLost / totalSent) * 100).toFixed(2) : "";

	/*
		Average, worst, and spread.

		The spread is what the nPerf export calls SPEED_*_LOADED_JITTER, and it
		is the figure that separates a link which is uniformly slow under load
		from one that is mostly fine and occasionally stalls for a second. Two
		links can report the same 120ms average and be completely different to
		use; only the spread says which is which.

		Computed as the standard deviation of the probe round trips, over the
		same samples the average is drawn from - no extra requests, no change to
		how anything is measured.

		⚠ The nPerf documentation does not state which spread statistic it uses.
		Standard deviation is the defensible default and it is calculated in
		exactly one place, here, so it is a one-line change if a comparison
		against nPerf's own numbers shows it means mean-absolute-deviation or
		consecutive-difference jitter instead. Do that comparison before these
		two figures are put side by side with theirs in a report.
	*/
	const summarize = function(samples) {
		if (samples.length === 0) return null;
		let sum = 0;
		let max = 0;
		for (let i = 0; i < samples.length; i++) {
			sum += samples[i];
			if (samples[i] > max) max = samples[i];
		}
		const mean = sum / samples.length;
		// One sample has no spread to speak of; reporting 0.00 there would read
		// as "perfectly steady" rather than "not enough data".
		let jitter = "";
		if (samples.length > 1) {
			let sqSum = 0;
			for (let i = 0; i < samples.length; i++) {
				const d = samples[i] - mean;
				sqSum += d * d;
			}
			jitter = Math.sqrt(sqSum / samples.length).toFixed(2);
		}
		return { avg: mean.toFixed(2), max: max.toFixed(2), jitter: jitter };
	};

	const d = summarize(dl.samples);
	if (d) {
		dlPingStatus = d.avg;
		dlPingMaxStatus = d.max;
		dlJitterStatus = d.jitter;
	}
	const u = summarize(ul.samples);
	if (u) {
		ulPingStatus = u.avg;
		ulPingMaxStatus = u.max;
		ulJitterStatus = u.jitter;
	}
}
// download test, calls done function when it's over
let dlCalled = false; // used to prevent multiple accidental calls to dlTest
function dlTest(done) {
	tverb("dlTest");
	if (dlCalled) return;
	else dlCalled = true; // dlTest already called?
	let totLoaded = 0.0, // total number of loaded bytes
		startT = new Date().getTime(), // timestamp when test was started
		bonusT = 0, //how many milliseconds the test has been shortened by (higher on faster connections)
		graceTimeDone = false, //set to true after the grace time is past
		failed = false; // set to true if a stream fails
	/*
		A second, parallel accounting that the grace-time reset never touches.

		totLoaded/startT above are deliberately reset when the grace period ends,
		so the reported average covers steady state only. That is right for the
		headline number and wrong for two other questions: how much data the run
		actually cost the subscriber (every byte counts, warm-up included), and
		how much the warm-up dragged the throughput down. grossT0/grossLoaded
		answer those.
	*/
	const grossT0 = startT;
	let grossLoaded = 0.0;
	/* Start of the 200ms window peak tracking compares against. */
	let windowLoaded = 0.0,
		windowT = 0;
	let peakBps = 0;
	xhr = [];
	// function to create a download stream using XHR. streams are slightly delayed so that they will not end at the same time
	const testStreamXhr = function(i, delay) {
		setTimeout(
			function() {
				if (testState !== 1) return; // delayed stream ended up starting after the end of the download test
				tverb("dl test stream started " + i + " " + delay);
				let prevLoaded = 0; // number of bytes loaded last time onprogress was called
				let x = new XMLHttpRequest();
				xhr[i] = x;
				xhr[i].onprogress = function(event) {
					tverb("dl stream progress event " + i + " " + event.loaded);
					if (testState !== 1) {
						try {
							x.abort();
						} catch (e) {}
					} // just in case this XHR is still running after the download test
					// progress event, add number of new loaded bytes to totLoaded
					const loadDiff = event.loaded <= 0 ? 0 : event.loaded - prevLoaded;
					if (isNaN(loadDiff) || !isFinite(loadDiff) || loadDiff < 0) return; // just in case
					totLoaded += loadDiff;
					grossLoaded += loadDiff;
					prevLoaded = event.loaded;
				}.bind(this);
				xhr[i].onload = function() {
					// the large file has been loaded entirely, start again
					tverb("dl stream finished " + i);
					try {
						xhr[i].abort();
					} catch (e) {} // reset the stream data to empty ram
					testStream(i, 0);
				}.bind(this);
				xhr[i].onerror = function() {
					// error
					tverb("dl stream failed " + i);
					if (settings.xhr_ignoreErrors === 0) failed = true; //abort
					try {
						xhr[i].abort();
					} catch (e) {}
					delete xhr[i];
					if (settings.xhr_ignoreErrors === 1) testStream(i, 0); //restart stream
				}.bind(this);
				// send xhr
				try {
					if (settings.xhr_dlUseBlob) xhr[i].responseType = "blob";
					else xhr[i].responseType = "arraybuffer";
				} catch (e) {}
				xhr[i].open("GET", settings.url_dl + url_sep(settings.url_dl) + (settings.mpot ? "cors=true&" : "") + "r=" + Math.random() + "&ckSize=" + settings.garbagePhp_chunkSize, true); // random string to prevent caching
				xhr[i].send();
			}.bind(this),
			1 + delay
		);
	}.bind(this);
	/*
		Download stream using fetch()+ReadableStream instead of XHR. Each chunk
		is added to totLoaded and dropped immediately (no reference kept), so
		RAM use stays flat regardless of garbagePhp_chunkSize, unlike XHR's
		arraybuffer/blob responseType which holds the *entire* response in
		memory until onload fires. Exposes the same abort()/onprogress/onload/
		onerror surface on the xhr[i] slot as the XHR path so clearRequests()
		(shared with upload and ping) doesn't need to know which one is active.
	*/
	const testStreamFetch = function(i, delay) {
		setTimeout(
			function() {
				if (testState !== 1) return;
				tverb("dl test stream (fetch) started " + i + " " + delay);
				const controller = new AbortController();
				const slot = { onprogress: null, onload: null, onerror: null, upload: {} };
				slot.abort = function() {
					try {
						controller.abort();
					} catch (e) {}
				};
				xhr[i] = slot;
				const url = settings.url_dl + url_sep(settings.url_dl) + (settings.mpot ? "cors=true&" : "") + "r=" + Math.random() + "&ckSize=" + settings.garbagePhp_chunkSize;
				fetch(url, { signal: controller.signal, cache: "no-store", credentials: "same-origin" })
					.then(function(response) {
						if (!response.ok || !response.body) throw new Error("HTTP " + response.status);
						const reader = response.body.getReader();
						const pump = function() {
							return reader.read().then(function(result) {
								if (testState !== 1) {
									try {
										controller.abort();
									} catch (e) {}
									return;
								}
								if (result.done) {
									tverb("dl stream (fetch) finished " + i);
									testStream(i, 0);
									return;
								}
								const len = result.value ? result.value.length : 0;
								if (len > 0 && isFinite(len)) {
									totLoaded += len;
									grossLoaded += len;
								}
								return pump();
							});
						};
						return pump();
					})
					.catch(function(err) {
						if (controller.signal.aborted) return; // expected: end of test or a stale stream, not a real failure
						tverb("dl stream (fetch) failed " + i + " " + err);
						if (settings.xhr_ignoreErrors === 0) failed = true;
						delete xhr[i];
						if (settings.xhr_ignoreErrors === 1) testStream(i, 0);
					});
			}.bind(this),
			1 + delay
		);
	}.bind(this);
	const useFetchDl = settings.xhr_dlUseFetch && typeof fetch === "function" && typeof AbortController === "function" && typeof ReadableStream !== "undefined";
	const testStream = useFetchDl ? testStreamFetch : testStreamXhr;
	// open streams
	for (let i = 0; i < settings.xhr_dlMultistream; i++) {
		testStream(i, settings.xhr_multistreamDelay * i);
	}
	startLatencyProbe("dl");
	// every 200ms, update dlStatus
	interval = setInterval(
		function() {
			tverb("DL: " + dlStatus + (graceTimeDone ? "" : " (in grace time)"));
			const t = new Date().getTime() - startT;
			if (graceTimeDone) dlProgress = (t + bonusT) / (settings.time_dl_max * 1000);
			if (t < 200) return;
			dlBytesStatus = grossLoaded;
			if (!graceTimeDone) {
				if (t > 1000 * settings.time_dlGraceTime) {
					if (totLoaded > 0) {
						// if the connection is so slow that we didn't get a single chunk yet, do not reset
						startT = new Date().getTime();
						bonusT = 0;
						totLoaded = 0.0;
					}
					// Measured from the true start, so a link too slow to deliver
					// a chunk inside the configured grace reports the longer
					// warm-up it actually had rather than the configured one.
					dlSlowstartStatus = new Date().getTime() - grossT0;
					windowLoaded = totLoaded;
					windowT = 0;
					resetLoadedLatencyPhase("dl");
					graceTimeDone = true;
				}
			} else {
				const speed = totLoaded / (t / 1000.0);
				/*
					Peak: the best single 200ms window, not the best running
					average. The running average can only ever converge on the
					mean, so a link that bursts to 60 Mbps and collapses to 5
					looks identical to a steady 20 - which is precisely the
					distinction operations is looking for at a congested cell.
				*/
				const windowMs = t - windowT;
				const windowBytes = totLoaded - windowLoaded;
				if (windowMs > 0 && windowBytes > 0) {
					const inst = windowBytes / (windowMs / 1000.0);
					if (inst > peakBps) peakBps = inst;
					windowLoaded = totLoaded;
					windowT = t;
				}
				dlPeakStatus = toSpeedStatus(peakBps);
				dlDurationStatus = t;
				const grossMs = new Date().getTime() - grossT0;
				if (grossMs > 0) dlAvgIncSlowstartStatus = toSpeedStatus(grossLoaded / (grossMs / 1000.0));
				if (settings.time_auto) {
					//decide how much to shorten the test. Every 200ms, the test is shortened by the bonusT calculated here
					const bonus = (5.0 * speed) / 100000;
					bonusT += bonus > 400 ? 400 : bonus;
				}
				//update status
				dlStatus = ((speed * 8 * settings.overheadCompensationFactor) / (settings.useMebibits ? 1048576 : 1000000)).toFixed(2); // speed is multiplied by 8 to go from bytes to bits, overhead compensation is applied, then everything is divided by 1048576 or 1000000 to go to megabits/mebibits
				if ((t + bonusT) / 1000.0 > settings.time_dl_max || failed) {
					// test is over, stop streams and timer
					if (failed || isNaN(dlStatus)) dlStatus = "Fail";
					stopLatencyProbe();
					clearRequests();
					clearInterval(interval);
					dlProgress = 1;
					tlog("dlTest: " + dlStatus + ", took " + (new Date().getTime() - startT) + "ms");
					done();
				}
			}
		}.bind(this),
		200
	);
}
// upload test, calls done function when it's over
let ulCalled = false; // used to prevent multiple accidental calls to ulTest
function ulTest(done) {
	tverb("ulTest");
	if (ulCalled) return;
	else ulCalled = true; // ulTest already called?
	// garbage data for upload test
	let r = new ArrayBuffer(1048576);
	const maxInt = Math.pow(2, 32) - 1;
	try {
		r = new Uint32Array(r);
		for (let i = 0; i < r.length; i++) r[i] = Math.random() * maxInt;
	} catch (e) {}
	let req = [];
	let reqsmall = [];
	for (let i = 0; i < settings.xhr_ul_blob_megabytes; i++) req.push(r);
	req = new Blob(req);
	r = new ArrayBuffer(262144);
	try {
		r = new Uint32Array(r);
		for (let i = 0; i < r.length; i++) r[i] = Math.random() * maxInt;
	} catch (e) {}
	reqsmall.push(r);
	reqsmall = new Blob(reqsmall);
	const testFunction = function() {
		let totLoaded = 0.0, // total number of transmitted bytes
			startT = new Date().getTime(), // timestamp when test was started
			bonusT = 0, //how many milliseconds the test has been shortened by (higher on faster connections)
			graceTimeDone = false, //set to true after the grace time is past
			failed = false; // set to true if a stream fails
		/* Accounting the grace-time reset does not touch - see dlTest(). */
		const grossT0 = startT;
		let grossLoaded = 0.0;
		let windowLoaded = 0.0,
			windowT = 0;
		let peakBps = 0;
		xhr = [];
		// function to create an upload stream. streams are slightly delayed so that they will not end at the same time
		const testStream = function(i, delay) {
			setTimeout(
				function() {
					if (testState !== 3) return; // delayed stream ended up starting after the end of the upload test
					tverb("ul test stream started " + i + " " + delay);
					let prevLoaded = 0; // number of bytes transmitted last time onprogress was called
					let x = new XMLHttpRequest();
					xhr[i] = x;
					let ie11workaround;
					if (settings.forceIE11Workaround) ie11workaround = true;
					else {
						try {
							xhr[i].upload.onprogress;
							ie11workaround = false;
						} catch (e) {
							ie11workaround = true;
						}
					}
					if (ie11workaround) {
						// IE11 workaround: xhr.upload does not work properly, therefore we send a bunch of small 256k requests and use the onload event as progress. This is not precise, especially on fast connections
						xhr[i].onload = xhr[i].onerror = function() {
							tverb("ul stream progress event (ie11wa)");
							totLoaded += reqsmall.size;
							grossLoaded += reqsmall.size;
							testStream(i, 0);
						};
						xhr[i].open("POST", uploadUrl(settings.url_ul), true);
						//No Content-Type header in MPOT branch because it triggers bugs in some browsers.
						//No Content-Encoding header either: browsers never compress a request body, so
						//"identity" bought us nothing while making the request non-simple.
						xhr[i].send(reqsmall);
					} else {
						// REGULAR version, no workaround
						xhr[i].upload.onprogress = function(event) {
							tverb("ul stream progress event " + i + " " + event.loaded);
							if (testState !== 3) {
								try {
									x.abort();
								} catch (e) {}
							} // just in case this XHR is still running after the upload test
							// progress event, add number of new loaded bytes to totLoaded
							const loadDiff = event.loaded <= 0 ? 0 : event.loaded - prevLoaded;
							if (isNaN(loadDiff) || !isFinite(loadDiff) || loadDiff < 0) return; // just in case
							totLoaded += loadDiff;
							grossLoaded += loadDiff;
							prevLoaded = event.loaded;
						}.bind(this);
						xhr[i].upload.onload = function() {
							// body uploaded, but response not yet available.
							// xhr.onload below handles the full lifecycle.
						}.bind(this);
						xhr[i].upload.onerror = function() {
							tverb("ul stream failed " + i);
							if (settings.xhr_ignoreErrors === 0) failed = true;
							try { x.abort(); } catch (e) {}
							delete xhr[i];
							if (settings.xhr_ignoreErrors === 1) testStream(i, 0);
						}.bind(this);
						xhr[i].onload = function() {
							// response complete — check status on captured x, not xhr[i]
							if (x.status >= 200 && x.status < 300) {
								tverb("ul stream finished " + i);
								testStream(i, 0);
							} else {
								tverb("ul stream failed with HTTP " + x.status + " " + i);
								if (settings.xhr_ignoreErrors === 0) failed = true;
								try { x.abort(); } catch (e) {}
								delete xhr[i];
								if (settings.xhr_ignoreErrors === 1) testStream(i, 0);
							}
						}.bind(this);
						// send xhr
						xhr[i].open("POST", uploadUrl(settings.url_ul), true);
						//No Content-Type header in MPOT branch because it triggers bugs in some browsers.
						//No Content-Encoding header either: browsers never compress a request body, so
						//"identity" bought us nothing while making the request non-simple.
						xhr[i].send(req);
					}
				}.bind(this),
				delay
			);
		}.bind(this);
		// open streams
		for (let i = 0; i < settings.xhr_ulMultistream; i++) {
			testStream(i, settings.xhr_multistreamDelay * i);
		}
		startLatencyProbe("ul");
		// every 200ms, update ulStatus
		interval = setInterval(
			function() {
				tverb("UL: " + ulStatus + (graceTimeDone ? "" : " (in grace time)"));
				const t = new Date().getTime() - startT;
				if (graceTimeDone) ulProgress = (t + bonusT) / (settings.time_ul_max * 1000);
				if (t < 200) return;
				ulBytesStatus = grossLoaded;
				if (!graceTimeDone) {
					if (t > 1000 * settings.time_ulGraceTime) {
						if (totLoaded > 0) {
							// if the connection is so slow that we didn't get a single chunk yet, do not reset
							startT = new Date().getTime();
							bonusT = 0;
							totLoaded = 0.0;
						}
						ulSlowstartStatus = new Date().getTime() - grossT0;
						windowLoaded = totLoaded;
						windowT = 0;
						resetLoadedLatencyPhase("ul");
						graceTimeDone = true;
					}
				} else {
					const speed = totLoaded / (t / 1000.0);
					const windowMs = t - windowT;
					const windowBytes = totLoaded - windowLoaded;
					if (windowMs > 0 && windowBytes > 0) {
						const inst = windowBytes / (windowMs / 1000.0);
						if (inst > peakBps) peakBps = inst;
						windowLoaded = totLoaded;
						windowT = t;
					}
					ulPeakStatus = toSpeedStatus(peakBps);
					ulDurationStatus = t;
					const grossMs = new Date().getTime() - grossT0;
					if (grossMs > 0) ulAvgIncSlowstartStatus = toSpeedStatus(grossLoaded / (grossMs / 1000.0));
					if (settings.time_auto) {
						//decide how much to shorten the test. Every 200ms, the test is shortened by the bonusT calculated here
						const bonus = (5.0 * speed) / 100000;
						bonusT += bonus > 400 ? 400 : bonus;
					}
					//update status
					ulStatus = ((speed * 8 * settings.overheadCompensationFactor) / (settings.useMebibits ? 1048576 : 1000000)).toFixed(2); // speed is multiplied by 8 to go from bytes to bits, overhead compensation is applied, then everything is divided by 1048576 or 1000000 to go to megabits/mebibits
					if ((t + bonusT) / 1000.0 > settings.time_ul_max || failed) {
						// test is over, stop streams and timer
						if (failed || isNaN(ulStatus)) ulStatus = "Fail";
						stopLatencyProbe();
						clearRequests();
						clearInterval(interval);
						ulProgress = 1;
						tlog("ulTest: " + ulStatus + ", took " + (new Date().getTime() - startT) + "ms");
						done();
					}
				}
			}.bind(this),
			200
		);
	}.bind(this);
	if (settings.mpot) {
		tverb("Sending POST request before performing upload test");
		xhr = [];
		xhr[0] = new XMLHttpRequest();
		xhr[0].onload = xhr[0].onerror = function() {
			tverb("POST request sent, starting upload test");
			testFunction();
		}.bind(this);
		xhr[0].open("POST", settings.url_ul);
		xhr[0].send();
	} else testFunction();
}
// ping+jitter test, function done is called when it's over
let ptCalled = false; // used to prevent multiple accidental calls to pingTest
function pingTest(done) {
	tverb("pingTest");
	if (ptCalled) return;
	else ptCalled = true; // pingTest already called?
	//the download and upload streams have filled the Resource Timing buffer by now
	resetResourceTimings();
	const startT = new Date().getTime(); //when the test was started
	let prevT = null; // last time a pong was received
	let ping = 0.0; // current ping value
	let jitter = 0.0; // current jitter value
	let i = 0; // counter of pongs received
	let prevInstspd = 0; // last ping time, used for jitter calculation
	let idlePingSum = 0; // running total of idle ping samples, for the average
	let idlePingCount = 0; // how many idle samples went into that total
	xhr = [];
	// ping function
	const doPing = function() {
		tverb("ping");
		pingProgress = i / settings.count_ping;
		const pingUrl = settings.url_ping + url_sep(settings.url_ping) + (settings.mpot ? "cors=true&" : "") + "r=" + Math.random(); // random string to prevent caching
		const pingUrlAbs = absoluteUrl(pingUrl);
		prevT = new Date().getTime();
		xhr[0] = new XMLHttpRequest();
		xhr[0].onload = function() {
			// pong
			tverb("pong");
			if (i === 0) {
				prevT = new Date().getTime(); // first pong
			} else {
				let instspd = new Date().getTime() - prevT;
				if (settings.ping_allowPerformanceApi) {
					//refine the estimate with the timing of THIS request, looked up by URL
					const d = timingForUrl(pingUrlAbs);
					if (d === null) tverb("No Performance API entry for this ping, using estimate");
					else if (d < instspd) instspd = d;
					//drop the entries we just read so the buffer cannot fill up mid test
					resetResourceTimings();
				}
				//noticed that some browsers randomly have 0ms ping
				if (instspd < 1) instspd = prevInstspd;
				if (instspd < 1) instspd = 1;
				const instjitter = Math.abs(instspd - prevInstspd);
				if (i === 1) ping = instspd;
				/* first ping, can't tell jitter yet*/ else {
					if (instspd < ping) ping = instspd; // update ping, if the instant ping is lower
					if (i === 2) jitter = instjitter;
					//discard the first jitter measurement because it might be much higher than it should be
					else jitter = instjitter > jitter ? jitter * 0.3 + instjitter * 0.7 : jitter * 0.8 + instjitter * 0.2; // update jitter, weighted average. spikes in ping values are given more weight.
				}
				prevInstspd = instspd;
				/*
					Average alongside the minimum. pingStatus keeps reporting the minimum,
					unchanged, but the loaded figures are averages, and comparing an average
					against a minimum would show a latency increase that is partly just the
					change of statistic. This gives the UI a like-for-like baseline.
				*/
				idlePingSum += instspd;
				idlePingCount++;
				idlePingAvgStatus = (idlePingSum / idlePingCount).toFixed(2);
				/*
					How many samples the ping and jitter figures rest on
					(SPEED_LATENCY_SAMPLES in the nPerf export). Reported because
					count_ping is configurable and because a run that lost pings
					to xhr_ignoreErrors=2 ends with fewer than it asked for -
					which is exactly when the reported minimum is least reliable.
				*/
				pingSamplesStatus = idlePingCount;
			}
			pingStatus = ping.toFixed(2);
			jitterStatus = jitter.toFixed(2);
			i++;
			tverb("ping: " + pingStatus + " jitter: " + jitterStatus);
			if (i < settings.count_ping) doPing();
			else {
				// more pings to do?
				pingProgress = 1;
				tlog("ping: " + pingStatus + " jitter: " + jitterStatus + ", took " + (new Date().getTime() - startT) + "ms");
				done();
			}
		}.bind(this);
		xhr[0].onerror = function() {
			// a ping failed, cancel test
			tverb("ping failed");
			if (settings.xhr_ignoreErrors === 0) {
				//abort
				pingStatus = "Fail";
				jitterStatus = "Fail";
				clearRequests();
				tlog("ping test failed, took " + (new Date().getTime() - startT) + "ms");
				pingProgress = 1;
				done();
			}
			if (settings.xhr_ignoreErrors === 1) doPing(); //retry ping
			if (settings.xhr_ignoreErrors === 2) {
				//ignore failed ping
				i++;
				if (i < settings.count_ping) doPing();
				else {
					// more pings to do?
					pingProgress = 1;
					tlog("ping: " + pingStatus + " jitter: " + jitterStatus + ", took " + (new Date().getTime() - startT) + "ms");
					done();
				}
			}
		}.bind(this);
		// send xhr
		xhr[0].open("GET", pingUrl, true);
		xhr[0].send();
	}.bind(this);
	doPing(); // start first ping
}
// telemetry
function sendTelemetry(done) {
	if (settings.telemetry_level < 1) return;
	/*
		Hold a local reference and read the response through it.
		
		The module level `xhr` is shared with every other request the worker makes,
		and clearRequests() sets it to null. If anything touches it between send and
		response - an abort, a stage teardown racing the last status poll - the
		handlers below would read `null.responseText`, throw into their own catch,
		and report no id. The result is already stored on the server at that point,
		so the failure is invisible except as a result the user cannot quote to
		operations. Observed once in a handful of runs before this change.
		
		The module level assignment stays so an abort can still cancel a pending
		post.
	*/
	const telemetryXhr = new XMLHttpRequest();
	xhr = telemetryXhr;
	telemetryXhr.onload = function() {
		try {
			const parts = telemetryXhr.responseText.split(" ");
			if (parts[0] == "id") {
				try {
					let id = parts[1];
					done(id);
				} catch (e) {
					done(null);
				}
			} else done(null);
		} catch (e) {
			done(null);
		}
	};
	telemetryXhr.onerror = function() {
		console.log("TELEMETRY ERROR " + telemetryXhr.status);
		done(null);
	};
	telemetryXhr.open("POST", settings.url_telemetry + url_sep(settings.url_telemetry) + (settings.mpot ? "cors=true&" : "") + "r=" + Math.random(), true);
	const telemetryIspInfo = {
		processedString: clientIp,
		rawIspInfo: typeof ispInfo === "object" ? ispInfo : ""
	};
	try {
		const fd = new FormData();
		fd.append("ispinfo", JSON.stringify(telemetryIspInfo));
		fd.append("dl", dlStatus);
		fd.append("ul", ulStatus);
		fd.append("ping", pingStatus);
		fd.append("jitter", jitterStatus);
		fd.append("log", settings.telemetry_level > 1 ? log : "");
		fd.append("extra", settings.telemetry_extra);
		telemetryXhr.send(fd);
	} catch (ex) {
		const postData = "extra=" + encodeURIComponent(settings.telemetry_extra) + "&ispinfo=" + encodeURIComponent(JSON.stringify(telemetryIspInfo)) + "&dl=" + encodeURIComponent(dlStatus) + "&ul=" + encodeURIComponent(ulStatus) + "&ping=" + encodeURIComponent(pingStatus) + "&jitter=" + encodeURIComponent(jitterStatus) + "&log=" + encodeURIComponent(settings.telemetry_level > 1 ? log : "");
		telemetryXhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
		telemetryXhr.send(postData);
	}
}
