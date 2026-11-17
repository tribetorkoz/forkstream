/**
 * Online Trace-to-Skill Distiller
 *
 * Implements the 3-part skill structure from VibeTrace (arXiv:2611.04466 Section IV-C:
 * Context / Decision / Strategy + Reusability/Informativeness/Safety estimation)
 * serialized into the open Agent Skills `SKILL.md` standard (agentskills.io)
 * under `.agents/skills/<slug>/SKILL.md` so future agent sessions automatically inherit human preferences.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AgentFork, DistilledSkill } from '../../shared/types.js'

function slugify(input: string): string {
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 36)
  if (ascii.length >= 4) return ascii
  return `skill-${Date.now().toString(36)}`
}

export class SkillDistiller {
  private readonly skillsRoot: string
  private readonly indexFile: string
  private skills: DistilledSkill[] = []

  constructor(baseDir: string) {
    this.skillsRoot = path.join(baseDir, '.agents', 'skills')
    this.indexFile = path.join(this.skillsRoot, 'index.json')
    fs.mkdirSync(this.skillsRoot, { recursive: true })
    this.load()
  }

  private load(): void {
    try {
      if (fs.existsSync(this.indexFile)) {
        this.skills = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) as DistilledSkill[]
      }
    } catch {
      this.skills = []
    }
  }

  private save(): void {
    fs.writeFileSync(this.indexFile, JSON.stringify(this.skills, null, 2), 'utf8')
  }

  listSkills(): DistilledSkill[] {
    return [...this.skills]
  }

  toggleSkill(skillId: string, enabled: boolean): DistilledSkill | null {
    const found = this.skills.find((s) => s.id === skillId)
    if (!found) return null
    found.enabled = enabled
    this.save()
    return found
  }

  /**
   * Formats enabled skills for automatic injection into future Builder Agent system prompts.
   */
  buildSkillPromptBlock(): string {
    const active = this.skills.filter((s) => s.enabled)
    if (active.length === 0) return ''
    const blocks = active.map(
      (s) =>
        `- **${s.name}**\n  - When (Context): ${s.context}\n  - What (Decision): ${s.decision}\n  - How (Strategy): ${s.strategy}`,
    )
    return `\n\n## Learned Collaboration Skills (from prior human mid-run interventions)\n${blocks.join('\n')}\n`
  }

  distillFromMergedFork(params: {
    sessionId: string
    fork: AgentFork
    llmExtracted?: {
      slug?: string
      name: string
      nameAr: string
      context: string
      decision: string
      strategy: string
      scores: { reusability: number; informativeness: number; safety: number }
    }
  }): DistilledSkill {
    const { sessionId, fork, llmExtracted } = params
    const extracted = llmExtracted ?? this.heuristicExtract(fork)

    const id = `sk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
    const slug = `${slugify(extracted.slug || extracted.name)}-${id.slice(-4)}`
    const skillDir = path.join(this.skillsRoot, slug)
    fs.mkdirSync(skillDir, { recursive: true })
    const skillMdPath = path.join(skillDir, 'SKILL.md')

    const skillMdContent = [
      '---',
      `name: ${slug}`,
      `description: "${extracted.decision.replace(/"/g, "'")}"`,
      `origin_session: ${sessionId}`,
      `origin_fork: ${fork.id}`,
      `origin_commit: ${fork.mergeCommitHash ?? fork.baseCommitHash}`,
      `scores:`,
      `  reusability: ${extracted.scores.reusability.toFixed(2)}`,
      `  informativeness: ${extracted.scores.informativeness.toFixed(2)}`,
      `  safety: ${extracted.scores.safety.toFixed(2)}`,
      '---',
      '',
      `# ${extracted.name}`,
      '',
      '## Context (When to activate)',
      extracted.context,
      '',
      '## Decision (Behavioral rule)',
      extracted.decision,
      '',
      '## Strategy (How to execute)',
      extracted.strategy,
      '',
      '## Provenance',
      `- User mid-run directive: \`${fork.userPrompt}\``,
      `- Files refined: ${fork.filesModified.map((f) => `\`${f}\``).join(', ') || 'workspace'}`,
      `- Merge strategy: \`${fork.mergeStrategy ?? 'git-ort-clean'}\``,
      '',
    ].join('\n')

    fs.writeFileSync(skillMdPath, skillMdContent, 'utf8')

    const skill: DistilledSkill = {
      id,
      slug,
      name: extracted.name,
      nameAr: extracted.nameAr,
      context: extracted.context,
      decision: extracted.decision,
      strategy: extracted.strategy,
      scores: extracted.scores,
      sourceSessionId: sessionId,
      sourceForkId: fork.id,
      sourceUserPrompt: fork.userPrompt,
      sourceCommitHash: fork.mergeCommitHash ?? fork.baseCommitHash,
      skillMdPath: `.agents/skills/${slug}/SKILL.md`,
      skillMdContent,
      enabled: true,
      createdAt: Date.now(),
    }

    this.skills = [skill, ...this.skills].slice(0, 30)
    this.save()
    return skill
  }

  private heuristicExtract(fork: AgentFork) {
    const p = fork.userPrompt
    const files = fork.filesModified.join(', ') || fork.targetFiles.join(', ')

    if (/خصم|حساب|معادلة|خطأ|خطا|أصلح|اصلح|discount|formula|calc|bug|fix|conversion/i.test(p)) {
      return {
        slug: 'verify-arithmetic-formulas',
        name: 'Verify Financial & Metric Formulas Before Commit',
        nameAr: 'التحقق من المعادلات الحسابية ونسب الخصم والتحويل',
        context: `When implementing pricing, discount coupons, cart totals, or KPI percentage formulas (${files}).`,
        decision:
          'Validate sign direction (subtraction for discounts, ratio bounded 0–100% for conversion rates) and log sanity assertions.',
        strategy: `Write explicit boundary checks (e.g. discountedTotal <= subtotal, 0 <= rate <= 100) and verify numeric output against sample inputs before finishing the file.`,
        scores: { reusability: 0.94, informativeness: 0.91, safety: 0.98 },
      }
    }

    if (/لون|ألوان|الوان|ثيم|داكن|فاتح|أخضر|اخضر|ذهبي|وردي|colou?r|theme|emerald|gold|rose|light|dark/i.test(p)) {
      return {
        slug: 'design-token-palette-preference',
        name: 'Apply User Design Token & Palette Preference',
        nameAr: 'تطبيق تفضيلات المستخدم لنظام الألوان والهوية البصرية',
        context: `When authoring CSS design tokens and surface hierarchy (${files}).`,
        decision: `Honor user's preferred visual palette and high-contrast surface styling: "${p.slice(0, 90)}".`,
        strategy:
          'Centralize primary/accent/surface colors in CSS custom properties (:root) so palette adjustments propagate cleanly across all components without conflicts.',
        scores: { reusability: 0.86, informativeness: 0.84, safety: 0.99 },
      }
    }

    if (/بحث|فلتر|تصفية|search|filter/i.test(p)) {
      return {
        slug: 'include-instant-search-filter',
        name: 'Include Instant Live Search & Filtering on Lists',
        nameAr: 'تضمين شريط بحث وتصفية فورية للقوائم والمنتجات',
        context: `When building data grids, product catalogs, or dashboard tables (${files}).`,
        decision:
          'Provide an accessible real-time search/filter input with instant feedback and empty-state handling.',
        strategy:
          'Wire an input event handler filtering items by title, category, and tags with clear result count indicators.',
        scores: { reusability: 0.9, informativeness: 0.88, safety: 0.97 },
      }
    }

    return {
      slug: 'human-midrun-refinement',
      name: `Mid-Run Preference: ${p.slice(0, 42)}`,
      nameAr: `مهارة مكتسبة من تعديلك: ${p.slice(0, 42)}`,
      context: `When modifying components similar to ${files}.`,
      decision: `Apply the user's mid-execution requirement proactively: "${p.slice(0, 120)}".`,
      strategy: `Incorporate this pattern directly during initial scaffolding and keep modular separation across ${files} to minimize merge friction.`,
      scores: { reusability: 0.82, informativeness: 0.85, safety: 0.96 },
    }
  }
}
