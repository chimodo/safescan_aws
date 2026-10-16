// converts googles duration strings (like "300s") into a plain number of seconds
// then turn the string into an actual number with parseFloat
export function parseDuration(duration?: string, fallback = 300): number {
  // if duration is missing/undefined (happens a lot since these fields are optional) we just return the fallback instead
  if (!duration) return fallback; 
  return Math.floor(parseFloat(duration.replace('s', '')));
}

// google always adds "s" at the end for seconds, so we strip that off first
// using parseFloat not parseInt cuz duration can sometimes be a decimal like "86400.5s"
// Math.floor at the end just rounds it down to a whole number, we dont need fractional seconds for a ttl
//
// note: parseFloat already stops reading at the first non-number character on its own,
// so claude said technically parseFloat("300s") would give us 300 without the .replace() even being there.
// not breaking anything rn but worth knowing its kinda redundant