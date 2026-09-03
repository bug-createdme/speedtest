/*
  Which of the three carriers a run belongs to, worked out from the ISP name the
  test server reports - never typed in.

  The report the whole project feeds into is grouped by carrier: Unitel vs
  LaoTel vs ETL, per province. That grouping key has to come from somewhere the
  surveyor cannot get wrong, so it is derived from the AS name getIP.php returns
  (as_name out of country_asn.mmdb) rather than from a picker on screen - the
  manual carrier screen and the phone-number field were removed once the partner
  confirmed the three-machine setup needs neither (CHANGE-012).

  Two things make this more than a string compare:

  - Four AS names map to three carriers. Unitel operates under two legal
    entities - "Unitel Mobile LA" and the "Star Telecom LA" joint venture - and
    their AS names share no common substring, so a table is the only thing that
    files both under Unitel.
  - "Contains 'Unitel'" is not safe. A substring test would misfile any AS whose
    name happened to include a carrier's word, and quietly invent a row in the
    breakdown the report is grouped by. So the match is against known names, and
    anything not on the list is null - unclassified, not guessed.
*/

/** The three carriers the report compares. */
export const OPERATOR = {
  UNITEL: "Unitel",
  LAOTEL: "LaoTel",
  ETL: "ETL"
};

/**
 * Known CIDR IP ranges for telecommunications providers in Laos.
 * Sourced from the reference speedtestt infrastructure.
 */
export const IP_RANGES = {
  UNITEL: ["183.182.96.0/19", "103.1.28.0/22", "154.222.4.0/22"],
  LAOTEL: [
    "103.43.76.0/22",
    "115.84.103.0/24",
    "115.84.64.0/18",
    "202.137.128.0/19",
    "202.144.187.0/24"
  ],
  ETL: [
    "101.78.8.0/21",
    "103.13.88.0/22",
    "114.129.24.0/21",
    "202.62.96.0/20",
    "43.252.244.0/22"
  ],
  BEST_TELECOM: ["141.164.101.0/24", "141.164.102.0/24"],
  VIETTEL: ["171.241.8.0/21", "171.241.0.0/16", "171.224.0.0/11"]
};

/*
  AS name (lower-cased, whitespace-collapsed) -> carrier. Extend this table when
  a new AS name shows up in the data, never the matching logic below.
*/
const AS_NAME_TO_OPERATOR = {
  "unitel mobile la": OPERATOR.UNITEL,
  "star telecom la": OPERATOR.UNITEL,
  "lao telecom communication": OPERATOR.LAOTEL,
  "ltc la": OPERATOR.LAOTEL,
  "etl company la": OPERATOR.ETL
};

/**
 * Convert an IPv4 string into a 32-bit unsigned integer.
 * Returns null if the string is not a valid IPv4 address.
 *
 * @param {string} ip
 * @returns {number|null}
 */
export function ipToInt(ip) {
  if (typeof ip !== "string") return null;
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let res = 0;
  for (let i = 0; i < 4; i++) {
    const raw = parts[i];
    if (!/^\d+$/.test(raw)) return null;
    const octet = Number(raw);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    res = (res << 8) + octet;
  }
  return res >>> 0;
}

/**
 * Check if an IPv4 address is within a CIDR block (e.g. "183.182.96.0/19").
 *
 * @param {string} ip
 * @param {string} cidr
 * @returns {boolean}
 */
export function ipMatchesCidr(ip, cidr) {
  if (typeof ip !== "string" || typeof cidr !== "string") return false;
  const ipInt = ipToInt(ip);
  if (ipInt === null) return false;

  const [rangeIp, prefixStr] = cidr.trim().split("/");
  const rangeInt = ipToInt(rangeIp);
  if (rangeInt === null) return false;

  const prefix = prefixStr !== undefined ? parseInt(prefixStr, 10) : 32;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Check if an IPv4 address is within any of the provided CIDR blocks.
 *
 * @param {string} ip
 * @param {string[]} ranges
 * @returns {boolean}
 */
export function isIpInRanges(ip, ranges) {
  if (typeof ip !== "string" || !Array.isArray(ranges)) return false;
  return ranges.some((cidr) => ipMatchesCidr(ip, cidr));
}

/**
 * Detect the ISP / Operator directly from a client IP address.
 *
 * @param {string} ip
 * @returns {string|null} Operator name or null if not in known IP ranges
 */
export function getOperatorFromIp(ip) {
  if (typeof ip !== "string" || !ip.trim()) return null;
  if (isIpInRanges(ip, IP_RANGES.UNITEL)) return OPERATOR.UNITEL;
  if (isIpInRanges(ip, IP_RANGES.LAOTEL)) return OPERATOR.LAOTEL;
  if (isIpInRanges(ip, IP_RANGES.ETL)) return OPERATOR.ETL;
  if (isIpInRanges(ip, IP_RANGES.BEST_TELECOM)) return "Best Telecom";
  if (isIpInRanges(ip, IP_RANGES.VIETTEL)) return "Viettel";
  return null;
}

/**
 * Detect operator from Laos ISDN / subscriber phone number prefix.
 *
 * Unitel: 209xxxxxxx, 208xxxxxxx, 206xxxxxxx, 0209..., 856209...
 * LaoTel: 205xxxxxxx, 0205..., 856205...
 * ETL: 202xxxxxxx, 0202..., 856202...
 * Best Telecom / Tplus: 207xxxxxxx, 203xxxxxxx, 0207..., 856207...
 *
 * @param {string} isdn
 * @returns {string|null}
 */
export function getOperatorFromIsdn(isdn) {
  if (!isdn || typeof isdn !== "string") return null;
  const clean = isdn.replace(/[^0-9]/g, "");
  if (!clean) return null;

  let num = clean;
  if (num.startsWith("856")) num = num.slice(3);
  if (num.startsWith("0")) num = num.slice(1);

  // Unitel prefixes: 209, 208, 206, 9, 8, 6 (7 or 8 digits after 20)
  if (/^(20)?(9|8|6)\d{6,8}$/.test(num)) {
    return OPERATOR.UNITEL;
  }
  // LaoTel prefixes: 205, 5
  if (/^(20)?5\d{6,8}$/.test(num)) {
    return OPERATOR.LAOTEL;
  }
  // ETL prefixes: 202, 2
  if (/^(20)?2\d{6,8}$/.test(num)) {
    return OPERATOR.ETL;
  }
  // Best Telecom / Tplus: 207, 203, 7, 3
  if (/^(20)?(7|3)\d{6,8}$/.test(num)) {
    return "Best Telecom";
  }

  return null;
}

/**
 * Parse raw IP response (which can be a JSON string like {"processedString":"172.19.0.1"}
 * or an object or a plain string "ip - isp") into clean { ip, isp } values.
 *
 * @param {string|object} raw
 * @param {string} [isdn] optional subscriber isdn for carrier fallback
 * @returns {{ ip: string, isp: string }}
 */
export function parseIpResponse(raw, isdn) {
  if (!raw) return { ip: "", isp: "" };
  let processed = "";
  if (typeof raw === "object") {
    processed = raw.processedString || raw.ip || "";
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        processed = parsed.processedString || parsed.ip || trimmed;
      } catch (e) {
        processed = trimmed;
      }
    } else {
      processed = trimmed;
    }
  }

  const [ipPart, ...rest] = String(processed).split(" - ");
  const ip = ipPart ? ipPart.trim() : "";
  const rawIsp = rest.join(" - ").trim();
  const fromIp = getOperatorFromIp(ip);
  const fromIsdn = isdn ? getOperatorFromIsdn(isdn) : null;
  const isPrivateText = rawIsp && rawIsp.toLowerCase().includes("private");
  const isp = fromIp || fromIsdn || (!isPrivateText && rawIsp && !rawIsp.startsWith("{") ? rawIsp : "");

  return { ip, isp };
}

/**
 * Normalise the ISP/IP into one of the report carriers.
 *
 * Checks the client IP against known CIDR blocks first. If that does not
 * match (or no IP is provided), falls back to subscriber ISDN prefix, then
 * to matching the AS name string.
 *
 * getIP.php hands the AS name over with a tail attached: ", <country>" from the
 * offline-database path (ip.' - '.as_name.', '.country_name) and " (<distance>)"
 * from the API path. The carrier name is the part before that tail, so it is cut
 * at the first comma or opening parenthesis, then matched case- and
 * whitespace-insensitively against the table.
 *
 * @param {string} isp the ISP/AS-name string, e.g. "Unitel Mobile LA, Laos"
 * @param {string} [ip] optional client IP address, e.g. "183.182.100.201"
 * @param {string} [isdn] optional subscriber phone number, e.g. "2095868688"
 * @returns {null|string} an OPERATOR value, or null for an unknown or absent name
 */
export function normaliseOperator(isp, ip, isdn) {
  if (typeof ip === "string" && ip.trim()) {
    const fromIp = getOperatorFromIp(ip);
    if (fromIp) return fromIp;
  }
  if (typeof isdn === "string" && isdn.trim()) {
    const fromIsdn = getOperatorFromIsdn(isdn);
    if (fromIsdn) return fromIsdn;
  }
  if (typeof isp !== "string") return null;
  const name = isp
    .split(",")[0]
    .split("(")[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!name) return null;
  return AS_NAME_TO_OPERATOR[name] || null;
}
