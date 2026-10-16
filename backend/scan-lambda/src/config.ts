// Values the design doc says the team sets. These are starting placeholders;
// tune them once there is real report data.

const DAY = 24 * 60 * 60 * 1000;

export const CONFIG = {
  /** Seconds a clean Safe Browsing result is reused */
  negativeTtlSeconds: Number(process.env.NEGATIVE_TTL_SECONDS ?? 300),

  /** N: distinct reporters needed to verify a URL by votes */
  verifyReporters: 3,
  /** W: window those reporters must fall within */
  verifyWindowMs: 7 * DAY,
  /** T: heuristic score the URL must also reach; votes alone never verify */
  verifyHeuristicScore: 40,

  /** How long a community-verified verdict stays in UrlVerdicts */
  communityVerdictMs: 90 * DAY,
  /** How long a feed entry stays if the next nightly run doesn't refresh it */
  feedVerdictMs: 2 * DAY,
  /** Cap on feed URLs written per night, to stay inside UrlVerdicts write capacity */
  maxFeedUrls: 3000,

  /** Requests allowed per install (or per IP when no install ID is sent) per hour */
  scansPerHour: 120,
  reportsPerHour: 10,

  /** Reports older than this don't count toward hotspots */
  hotspotWindowMs: 90 * DAY,
  /** Reports a cell needs before it appears on the public map */
  minHotspotReports: 3,
  /** Distinct cells one verified URL must appear in to be flagged as a campaign */
  campaignMinCells: 3,
};
