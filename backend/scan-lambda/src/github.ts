// Commits a file through the GitHub contents API. Skips the commit when nothing changed,
// so the repo doesn't get an empty commit every night.

export async function putFile(opts: {
  token: string;
  repo: string; // owner/name
  branch: string;
  path: string;
  content: string;
  message: string;
}): Promise<'unchanged' | 'updated'> {
  const api = `https://api.github.com/repos/${opts.repo}/contents/${opts.path}`;
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'safescan-nightly',
  };

  let sha: string | undefined;
  const existing = await fetch(`${api}?ref=${encodeURIComponent(opts.branch)}`, { headers });
  if (existing.ok) {
    const file = (await existing.json()) as { sha: string; content: string };
    sha = file.sha;
    if (Buffer.from(file.content, 'base64').toString('utf8') === opts.content) return 'unchanged';
  } else if (existing.status !== 404) {
    throw new Error(`GitHub GET ${opts.path} returned ${existing.status}`);
  }

  const put = await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: opts.message,
      content: Buffer.from(opts.content, 'utf8').toString('base64'),
      branch: opts.branch,
      sha,
    }),
  });
  if (!put.ok) throw new Error(`GitHub PUT ${opts.path} returned ${put.status}: ${await put.text()}`);
  return 'updated';
}
