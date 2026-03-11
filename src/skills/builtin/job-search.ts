import type { Skill, SkillContext } from '../types.js';
import * as crypto from 'node:crypto';
import { extractDOM } from '../../browser/dom.js';
import type { JobListing } from '../../memory/types.js';

export const jobSearchSkill: Skill = {
  name: 'job-search',
  description: 'Search for jobs, analyze listings, and match against your resume',
  version: '1.0.0',
  systemPrompt: `When searching for jobs:
1. First check if user profile/resume is in memory. If not, ask the user to provide it.
2. Navigate to job sites, handle popups and login prompts.
3. For each interesting listing, extract full details and save to job tracker.
4. Compare each job against user's skills and experience.
5. Present results with match scores and reasoning.`,
  tools: [
    {
      name: 'searchJobs',
      description: 'Search for jobs on a job site via browser. Navigates to Google and searches for job listings matching the query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Job search query (e.g., "Senior React Developer")' },
          location: { type: 'string', description: 'Job location (e.g., "San Francisco, CA")' },
          site: { type: 'string', description: 'Specific job site to search (e.g., "linkedin.com", "indeed.com")' },
        },
        required: ['query'],
      },
    },
    {
      name: 'analyzeJobListing',
      description: 'Navigate to a job listing URL, extract full details, and save to job tracker',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the job listing to analyze' },
        },
        required: ['url'],
      },
    },
    {
      name: 'matchJobToResume',
      description: 'Compare a job listing against stored resume/profile and return match analysis',
      parameters: {
        type: 'object',
        properties: {
          jobUrl: { type: 'string', description: 'URL of the job listing to match' },
        },
        required: ['jobUrl'],
      },
    },
    {
      name: 'batchSearchJobs',
      description: 'Search multiple job queries across multiple sites',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            description: 'List of search queries',
          },
          sites: {
            type: 'array',
            description: 'List of job sites to search on',
          },
        },
        required: ['queries'],
      },
    },
    {
      name: 'getJobRecommendations',
      description: 'Based on stored profile, suggest search queries and sites to find matching jobs',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string> {
    switch (toolName) {
      case 'searchJobs':
        return await searchJobs(args, context);
      case 'analyzeJobListing':
        return await analyzeJobListing(args, context);
      case 'matchJobToResume':
        return await matchJobToResume(args, context);
      case 'batchSearchJobs':
        return await batchSearchJobs(args, context);
      case 'getJobRecommendations':
        return await getJobRecommendations(context);
      default:
        return `Unknown tool: ${toolName}`;
    }
  },
};

async function searchJobs(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const query = args['query'] as string;
  if (!query) return 'Error: query is required';
  const location = args['location'] as string | undefined;
  const site = args['site'] as string | undefined;

  let searchQuery = `${query} jobs`;
  if (location) searchQuery += ` ${location}`;
  if (site) searchQuery += ` site:${site}`;

  const page = context.browser.currentPage();
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);

  const results = await page.evaluate(() => {
    const items: Array<{ title: string; url: string; snippet: string }> = [];
    const searchResults = document.querySelectorAll('div.g');
    searchResults.forEach((result) => {
      const titleEl = result.querySelector('h3');
      const linkEl = result.querySelector('a');
      const snippetEl = result.querySelector('div[data-sncf]') ?? result.querySelector('.VwiC3b');
      if (titleEl && linkEl) {
        items.push({
          title: titleEl.textContent ?? '',
          url: linkEl.getAttribute('href') ?? '',
          snippet: snippetEl?.textContent ?? '',
        });
      }
    });
    return items.slice(0, 10);
  });

  if (results.length === 0) {
    const dom = await extractDOM(page);
    return `Search completed but no structured results found. Page content:\n${dom.textSummary}`;
  }

  return `Found ${results.length} job results:\n\n` + results.map((r, i) =>
    `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
  ).join('\n\n');
}

async function analyzeJobListing(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const url = args['url'] as string;
  if (!url) return 'Error: url is required';

  const page = context.browser.currentPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);

  const content = await page.evaluate(() => {
    const body = document.body.innerText;
    return body.slice(0, 8000);
  });

  const dom = await extractDOM(page);
  const title = dom.title;

  // Use LLM to extract structured job info
  const response = await context.llm.chat([
    {
      role: 'system',
      content: `Extract structured job listing information from the following page content. Return ONLY valid JSON with these fields:
{
  "title": "Job Title",
  "company": "Company Name",
  "location": "Location",
  "description": "Brief description",
  "requirements": ["requirement1", "requirement2"],
  "salary": "Salary if mentioned",
  "postedDate": "Date if found"
}`,
    },
    { role: 'user', content: `Page title: ${title}\n\nContent:\n${content}` },
  ], { temperature: 0.1, maxTokens: 1024 });

  let jobData: Record<string, unknown>;
  try {
    jobData = JSON.parse(response.content ?? '{}') as Record<string, unknown>;
  } catch {
    jobData = { title, company: 'Unknown', location: 'Unknown', description: content.slice(0, 200), requirements: [] };
  }

  const job: JobListing = {
    id: crypto.randomUUID().slice(0, 8),
    title: (jobData['title'] as string) ?? title,
    company: (jobData['company'] as string) ?? 'Unknown',
    location: (jobData['location'] as string) ?? 'Unknown',
    url,
    description: (jobData['description'] as string) ?? '',
    requirements: (jobData['requirements'] as string[]) ?? [],
    salary: jobData['salary'] as string | undefined,
    postedDate: jobData['postedDate'] as string | undefined,
    status: 'new',
  };

  await context.memory.saveJob(job);

  return `Job analyzed and saved:\n` +
    `Title: ${job.title}\n` +
    `Company: ${job.company}\n` +
    `Location: ${job.location}\n` +
    `Requirements: ${job.requirements.join(', ')}\n` +
    `Salary: ${job.salary ?? 'Not specified'}\n` +
    `ID: ${job.id}`;
}

async function matchJobToResume(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const jobUrl = args['jobUrl'] as string;
  if (!jobUrl) return 'Error: jobUrl is required';

  const profile = await context.memory.getProfile();
  if (!profile) {
    return 'No profile/resume found in memory. Please import your resume first using the resume-analyzer skill.';
  }

  // First analyze the job
  const analysisResult = await analyzeJobListing({ url: jobUrl }, context);

  // Get all saved jobs and find the one we just saved
  const jobs = await context.memory.getJobs();
  const latestJob = jobs[0];
  if (!latestJob) {
    return `Job analysis result:\n${analysisResult}\n\nCould not retrieve saved job for matching.`;
  }

  const profileSkills = new Set(profile.skills.map(s => s.toLowerCase()));
  const reqSkills = latestJob.requirements.map(r => r.toLowerCase());
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];

  for (const req of reqSkills) {
    const found = [...profileSkills].some(ps => req.includes(ps) || ps.includes(req));
    if (found) {
      matchedSkills.push(req);
    } else {
      missingSkills.push(req);
    }
  }

  const score = reqSkills.length > 0
    ? Math.round((matchedSkills.length / reqSkills.length) * 100)
    : 50;

  latestJob.matchScore = score;
  await context.memory.saveJob(latestJob);

  return `Match Analysis for "${latestJob.title}" at ${latestJob.company}:\n\n` +
    `Match Score: ${score}%\n\n` +
    `Matched Skills (${matchedSkills.length}):\n${matchedSkills.map(s => `  + ${s}`).join('\n') || '  (none)'}\n\n` +
    `Missing Skills (${missingSkills.length}):\n${missingSkills.map(s => `  - ${s}`).join('\n') || '  (none)'}\n\n` +
    `Your Skills: ${profile.skills.join(', ')}`;
}

async function batchSearchJobs(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const queries = args['queries'] as string[] | undefined;
  if (!queries || queries.length === 0) return 'Error: queries array is required';
  const sites = (args['sites'] as string[] | undefined) ?? [''];

  const allResults: string[] = [];
  for (const query of queries) {
    for (const site of sites) {
      const result = await searchJobs({ query, site: site || undefined }, context);
      allResults.push(`=== "${query}"${site ? ` on ${site}` : ''} ===\n${result}`);
    }
  }

  return allResults.join('\n\n');
}

async function getJobRecommendations(context: SkillContext): Promise<string> {
  const profile = await context.memory.getProfile();
  if (!profile) {
    return 'No profile found. Please import your resume first to get job recommendations.';
  }

  const lines: string[] = ['Based on your profile, here are recommended searches:\n'];

  if (profile.skills.length > 0) {
    const topSkills = profile.skills.slice(0, 5);
    lines.push('Suggested queries:');
    for (const skill of topSkills) {
      lines.push(`  - "${skill} developer jobs"`);
    }
    if (profile.experience.length > 0) {
      const latest = profile.experience[0];
      if (latest) {
        lines.push(`  - "${latest.title} jobs"`);
      }
    }
  }

  lines.push('\nSuggested sites:');
  lines.push('  - linkedin.com/jobs');
  lines.push('  - indeed.com');
  lines.push('  - glassdoor.com');

  if (profile.location) {
    lines.push(`\nSuggested location: ${profile.location}`);
  }

  return lines.join('\n');
}
