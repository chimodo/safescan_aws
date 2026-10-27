// Values the team sets. These are starting placeholders; tune them once there is real data.
import { DEFAULT_COMMUNITY_RULE, type CommunityRule } from '../../../shared/verdict';

const DAY = 24 * 60 * 60 * 1000;

/**
 * The community rule is one setting so it can change without code changes:
 * deploy with `-c communityRule='{"minSubmissions":1,"minVotes":10}'`.
 */
function readCommunityRule(): CommunityRule {
  try {
    const rule = JSON.parse(process.env.COMMUNITY_RULE ?? '');
    if (Number.isInteger(rule.minSubmissions) && rule.minSubmissions >= 1 && Number.isInteger(rule.minVotes) && rule.minVotes >= 0) {
      return { minSubmissions: rule.minSubmissions, minVotes: rule.minVotes };
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_COMMUNITY_RULE;
}

export const CONFIG = {
  /** Seconds a clean Safe Browsing result is reused */
  negativeTtlSeconds: Number(process.env.NEGATIVE_TTL_SECONDS ?? 300),

  /** Submissions and votes needed to raise a link to "Use caution" and "Very suspicious" */
  communityRule: readCommunityRule(),

  /** How long a maintainer-confirmed verdict stays in UrlVerdicts */
  communityVerdictMs: 90 * DAY,
  /** How long a feed entry stays if the next nightly run doesn't refresh it */
  feedVerdictMs: 2 * DAY,
  /** Cap on feed URLs written per night, to stay inside UrlVerdicts write capacity */
  maxFeedUrls: 3000,

  /** Requests allowed per install (or per IP when no install ID is sent) per hour; IP limits are 3x, since carriers and schools share IPs */
  scansPerHour: 120,
  reportsPerHour: 10,
  votesPerHour: 60,

  /** Most recent submissions the community home page can ask for */
  maxRecent: 50,

  /** Reports older than this don't count toward hotspots */
  hotspotWindowMs: 90 * DAY,
  /** Reports a cell needs before it appears on the public map */
  minHotspotReports: 3,
  /** Distinct cells one verified URL must appear in to be flagged as a campaign */
  campaignMinCells: 3,
};
