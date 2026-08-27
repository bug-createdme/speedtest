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
 * Normalise the ISP string into one of the three report carriers.
 *
 * getIP.php hands the AS name over with a tail attached: ", <country>" from the
 * offline-database path (ip.' - '.as_name.', '.country_name) and " (<distance>)"
 * from the API path. The carrier name is the part before that tail, so it is cut
 * at the first comma or opening parenthesis, then matched case- and
 * whitespace-insensitively against the table.
 *
 * @param {string} isp the ISP/AS-name string, e.g. "Unitel Mobile LA, Laos"
 * @returns {null|string} an OPERATOR value, or null for an unknown or absent name
 */
export function normaliseOperator(isp) {
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
