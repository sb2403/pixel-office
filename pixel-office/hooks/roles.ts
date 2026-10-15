// What the office calls each kind of agent, and one line that explains the job to someone who has never seen an
// agent before. The engine's type names (`Explore`, `general-purpose`) are written for Claude; these are for people.

export type Role = { title: string; blurb: string }

export const COORDINATOR: Role = {
  title: 'Coordinator',
  blurb: 'Talks with you, splits the work into jobs, hires helpers and puts their reports together',
}

const ROLES: Readonly<Record<string, Role>> = {
  Explore: { title: 'Researcher', blurb: 'Reads and searches, then reports what it found. Changes nothing' },
  Plan: { title: 'Planner', blurb: 'Works out a step-by-step plan for a job. Changes nothing' },
  'general-purpose': { title: 'Assistant', blurb: 'Can read, edit and run commands to finish one job' },
  claude: { title: 'Assistant', blurb: 'Can read, edit and run commands to finish one job' },
  fork: { title: 'Clone', blurb: 'A copy of its boss that knows everything its boss knew, sent off to do a side job' },
  'claude-code-guide': { title: 'Guide', blurb: 'Looks up how Claude Code itself works' },
  'web-fetch': { title: 'Web reader', blurb: 'Reads web pages and reports what they say' },
  contractor: { title: 'Contractor', blurb: 'A helper the office did not see being hired, so its job is unknown' },
}

// `code-reviewer`, `my-plugin:code-reviewer` and `codeReviewer` all read as "Code reviewer".
export function humanize(type: string): string {
  const words = (type.split(':').pop() ?? type)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase()
  return words === '' ? 'Helper' : `${words[0]?.toUpperCase() ?? ''}${words.slice(1)}`
}

export function roleFor(type: string): Role {
  if (type === 'main') return COORDINATOR
  return ROLES[type] ?? { title: humanize(type), blurb: 'A specialist helper set up for one kind of job' }
}

// A name the engine gave an agent reads as a name: `scout` is shown as Scout. Messages still go to `scout`.
export const asName = (name: string): string => `${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`
