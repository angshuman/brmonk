import type { Skill, SkillContext } from '../types.js';
import * as fs from 'node:fs/promises';
import type { UserProfile, WorkExperience, Education } from '../../memory/types.js';

export const resumeAnalyzerSkill: Skill = {
  name: 'resume-analyzer',
  description: 'Parse, import, and analyze resumes against job descriptions',
  version: '1.0.0',
  systemPrompt: `You can parse resumes, import them into the user profile, compare profiles against job descriptions, suggest improvements, and generate cover letters. Use parseResume to extract structured data from resume text, importResume to load a resume from a file, compareToJob for matching, suggestImprovements for career advice, and generateCoverLetter for tailored applications.`,
  tools: [
    {
      name: 'parseResume',
      description: 'Parse resume text into a structured user profile with skills, experience, and education',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The raw resume text to parse' },
        },
        required: ['text'],
      },
    },
    {
      name: 'importResume',
      description: 'Read a resume file from disk and parse it into a user profile',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the resume text file' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'compareToJob',
      description: 'Compare the stored user profile against a job description text',
      parameters: {
        type: 'object',
        properties: {
          jobDescription: { type: 'string', description: 'The job description text to compare against' },
        },
        required: ['jobDescription'],
      },
    },
    {
      name: 'suggestImprovements',
      description: 'Suggest resume improvements for a target role',
      parameters: {
        type: 'object',
        properties: {
          targetRole: { type: 'string', description: 'The target role to optimize the resume for' },
        },
        required: ['targetRole'],
      },
    },
    {
      name: 'generateCoverLetter',
      description: 'Generate a tailored cover letter based on stored profile and a job URL',
      parameters: {
        type: 'object',
        properties: {
          jobUrl: { type: 'string', description: 'URL of the job listing' },
        },
        required: ['jobUrl'],
      },
    },
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string> {
    switch (toolName) {
      case 'parseResume':
        return await parseResume(args, context);
      case 'importResume':
        return await importResume(args, context);
      case 'compareToJob':
        return await compareToJob(args, context);
      case 'suggestImprovements':
        return await suggestImprovements(args, context);
      case 'generateCoverLetter':
        return await generateCoverLetter(args, context);
      default:
        return `Unknown tool: ${toolName}`;
    }
  },
};

async function parseResumeText(text: string, context: SkillContext): Promise<UserProfile> {
  const response = await context.llm.chat([
    {
      role: 'system',
      content: `Extract structured profile data from this resume. Return ONLY valid JSON matching this schema:
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "phone number or null",
  "location": "City, State or null",
  "summary": "Professional summary",
  "skills": ["skill1", "skill2"],
  "experience": [{"title": "Job Title", "company": "Company", "startDate": "YYYY", "endDate": "YYYY or null", "description": "Brief description", "skills": ["skill1"]}],
  "education": [{"institution": "School", "degree": "Degree", "field": "Field", "year": "YYYY"}]
}`,
    },
    { role: 'user', content: text },
  ], { temperature: 0.1, maxTokens: 2048 });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(response.content ?? '{}') as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  return {
    name: (parsed['name'] as string) ?? '',
    email: (parsed['email'] as string) ?? '',
    phone: parsed['phone'] as string | undefined,
    location: parsed['location'] as string | undefined,
    summary: parsed['summary'] as string | undefined,
    skills: (parsed['skills'] as string[]) ?? [],
    experience: ((parsed['experience'] as WorkExperience[]) ?? []).map(e => ({
      title: String(e.title ?? ''),
      company: String(e.company ?? ''),
      startDate: String(e.startDate ?? ''),
      endDate: e.endDate ? String(e.endDate) : undefined,
      description: String(e.description ?? ''),
      skills: Array.isArray(e.skills) ? e.skills.map(String) : [],
    })),
    education: ((parsed['education'] as Education[]) ?? []).map(e => ({
      institution: String(e.institution ?? ''),
      degree: String(e.degree ?? ''),
      field: String(e.field ?? ''),
      year: String(e.year ?? ''),
    })),
    preferences: {},
    customFields: {},
  };
}

async function parseResume(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const text = args['text'] as string;
  if (!text) return 'Error: text is required';

  const profile = await parseResumeText(text, context);
  await context.memory.saveResume(text, profile);

  return `Resume parsed and saved:\n` +
    `Name: ${profile.name}\n` +
    `Email: ${profile.email}\n` +
    `Location: ${profile.location ?? 'Not specified'}\n` +
    `Skills (${profile.skills.length}): ${profile.skills.join(', ')}\n` +
    `Experience: ${profile.experience.length} positions\n` +
    `Education: ${profile.education.length} entries`;
}

async function importResume(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const filePath = args['filePath'] as string;
  if (!filePath) return 'Error: filePath is required';

  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!text.trim()) {
    return 'Error: resume file is empty';
  }

  return await parseResume({ text }, context);
}

async function compareToJob(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const jobDescription = args['jobDescription'] as string;
  if (!jobDescription) return 'Error: jobDescription is required';

  const profile = await context.memory.getProfile();
  if (!profile) {
    return 'No profile found. Please import your resume first.';
  }

  const response = await context.llm.chat([
    {
      role: 'system',
      content: `Compare this user's profile against the job description. Provide:
1. Match score (0-100)
2. Matched qualifications
3. Missing qualifications
4. Overall assessment
Be specific and actionable.`,
    },
    {
      role: 'user',
      content: `PROFILE:\nName: ${profile.name}\nSkills: ${profile.skills.join(', ')}\nExperience: ${profile.experience.map(e => `${e.title} at ${e.company}`).join('; ')}\nEducation: ${profile.education.map(e => `${e.degree} in ${e.field} from ${e.institution}`).join('; ')}\n\nJOB DESCRIPTION:\n${jobDescription}`,
    },
  ], { temperature: 0.3, maxTokens: 1024 });

  return response.content ?? 'Could not generate comparison.';
}

async function suggestImprovements(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const targetRole = args['targetRole'] as string;
  if (!targetRole) return 'Error: targetRole is required';

  const profile = await context.memory.getProfile();
  if (!profile) {
    return 'No profile found. Please import your resume first.';
  }

  const resume = await context.memory.getResume();

  const response = await context.llm.chat([
    {
      role: 'system',
      content: `Suggest specific, actionable improvements to this resume for the target role. Include:
1. Skills to highlight or add
2. Experience descriptions to improve
3. Keywords to include
4. Formatting suggestions
5. Overall strategy`,
    },
    {
      role: 'user',
      content: `TARGET ROLE: ${targetRole}\n\nCURRENT PROFILE:\nName: ${profile.name}\nSkills: ${profile.skills.join(', ')}\nExperience:\n${profile.experience.map(e => `- ${e.title} at ${e.company}: ${e.description}`).join('\n')}\n\n${resume ? `RAW RESUME:\n${resume.text.slice(0, 3000)}` : ''}`,
    },
  ], { temperature: 0.4, maxTokens: 1500 });

  return response.content ?? 'Could not generate improvement suggestions.';
}

async function generateCoverLetter(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const jobUrl = args['jobUrl'] as string;
  if (!jobUrl) return 'Error: jobUrl is required';

  const profile = await context.memory.getProfile();
  if (!profile) {
    return 'No profile found. Please import your resume first.';
  }

  // Navigate to job page to get description
  const page = context.browser.currentPage();
  await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);

  const jobContent = await page.evaluate(() => {
    return document.body.innerText.slice(0, 5000);
  });

  const response = await context.llm.chat([
    {
      role: 'system',
      content: `Write a professional, tailored cover letter for this job based on the candidate's profile. The letter should:
1. Be addressed appropriately
2. Highlight relevant skills and experience
3. Show enthusiasm for the specific role and company
4. Be concise (3-4 paragraphs)
5. Sound natural, not formulaic`,
    },
    {
      role: 'user',
      content: `CANDIDATE:\nName: ${profile.name}\nSkills: ${profile.skills.join(', ')}\nExperience:\n${profile.experience.map(e => `- ${e.title} at ${e.company}: ${e.description}`).join('\n')}\n\nJOB LISTING:\n${jobContent}`,
    },
  ], { temperature: 0.5, maxTokens: 1500 });

  return response.content ?? 'Could not generate cover letter.';
}
