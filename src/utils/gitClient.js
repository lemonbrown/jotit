export const LOCAL_AGENT_ORIGIN = 'http://127.0.0.1:3210'

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${String(token ?? '').trim()}`,
  }
}

async function readAgentJson(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `Local agent returned ${response.status}`)
  }
  return data
}

export async function connectGitRepo(repoPath, token) {
  const response = await fetch(`${LOCAL_AGENT_ORIGIN}/git/connect`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ path: repoPath }),
  })
  return readAgentJson(response)
}

export async function listGitRepos(token) {
  const response = await fetch(`${LOCAL_AGENT_ORIGIN}/git/repos`, {
    headers: authHeaders(token),
  })
  return readAgentJson(response)
}

export async function useGitRepo(repoId, { setDefault = false } = {}, token) {
  const response = await fetch(`${LOCAL_AGENT_ORIGIN}/git/use`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ repoId, setDefault }),
  })
  return readAgentJson(response)
}

export async function getGitStatus(repoId, token) {
  const response = await fetch(`${LOCAL_AGENT_ORIGIN}/git/status?repoId=${encodeURIComponent(repoId)}`, {
    headers: authHeaders(token),
  })
  return readAgentJson(response)
}

export async function getGitDiff(repoId, token) {
  const response = await fetch(`${LOCAL_AGENT_ORIGIN}/git/diff?repoId=${encodeURIComponent(repoId)}`, {
    headers: authHeaders(token),
  })
  return readAgentJson(response)
}
