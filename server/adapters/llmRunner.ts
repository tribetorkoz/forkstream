/**
 * Real Multi-Provider LLM Agent Runner (Vercel AI SDK v5)
 *
 * Uses official `ai` (`streamText`, `generateText`, `tool`, `stepCountIs`) with:
 *  - `@ai-sdk/anthropic` (Claude)
 *  - `@ai-sdk/openai` (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, any OpenAI-compatible baseURL)
 *  - `@ai-sdk/google` (Gemini)
 *
 * Implements Claude Agent SDK's PostToolUse checkpointing pattern + ForkStream's
 * mid-execution Context Sync Queue so Builder Agent automatically receives merged
 * fork notifications without stopping or restarting its run.
 */
import { streamText, generateText, tool, stepCountIs, type LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import type { ProviderConfig, SelectedDomElement } from '../../shared/types.js'
import type { SessionWorktreeManager } from '../vcs/worktreeManager.js'

export function createLanguageModel(config: ProviderConfig, useFast = false): LanguageModel {
  const modelId = (useFast && config.fastModel ? config.fastModel : config.model).trim()
  const apiKey = config.apiKey?.trim()

  switch (config.provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })
      return anthropic(modelId || 'claude-sonnet-4-5')
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: apiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })
      return google(modelId || 'gemini-2.5-pro')
    }
    case 'openrouter': {
      const openrouter = createOpenAI({
        apiKey: apiKey || process.env.OPENROUTER_API_KEY,
        baseURL: config.baseUrl || 'https://openrouter.ai/api/v1',
      })
      return openrouter.chat(modelId || 'anthropic/claude-sonnet-4.5')
    }
    case 'compatible': {
      const compat = createOpenAI({
        apiKey: apiKey || 'ollama',
        baseURL: config.baseUrl || 'http://127.0.0.1:11434/v1',
      })
      return compat.chat(modelId || 'qwen2.5-coder:14b')
    }
    case 'openai':
    default: {
      const openai = createOpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })
      return openai(modelId || 'gpt-4.1')
    }
  }
}

export interface BuilderCallbacks {
  abortSignal: AbortSignal
  drainSyncNotices: () => string[]
  onToolExecuted: (info: {
    toolName: string
    filePath: string
    summary: string
    content: string
  }) => Promise<void>
  onTextDelta: (delta: string) => void
  onStepChange: (stepIndex: number, description: string) => void
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => Promise<void> | void
}

export async function runRealBuilderAgent(params: {
  config: ProviderConfig
  prompt: string
  skillBlock: string
  vcs: SessionWorktreeManager
  callbacks: BuilderCallbacks
}): Promise<void> {
  const { config, prompt, skillBlock, vcs, callbacks } = params
  const model = createLanguageModel(config, false)
  let stepCounter = 0

  const appendSyncNotice = (baseResult: string): string => {
    const notices = callbacks.drainSyncNotices()
    if (notices.length === 0) return baseResult
    return `${baseResult}\n\n[LIVE FORK MERGE SYNC NOTICE — DO NOT OVERWRITE THESE USER CHANGES]:\n${notices.join('\n')}`
  }

  const tools = {
    write_file: tool({
      description:
        'Create or overwrite a file in the project workspace. Build modular files (styles/tokens.css, styles/components.css, index.html, js/data.js, js/logic.js, js/app.js) one file per call so the live observer streams each step clearly.',
      inputSchema: z.object({
        path: z.string().describe('Relative file path, e.g. styles/tokens.css or index.html'),
        content: z.string().describe('Complete file content'),
        summary: z.string().describe('Short 1-line summary of what this file implements'),
      }),
      execute: async ({ path: relPath, content, summary }) => {
        stepCounter += 1
        callbacks.onStepChange(stepCounter, summary || `Writing ${relPath}`)
        await vcs.applyBuilderStepAndCommit(async (mainDir) => {
          await vcs.writeFileInWorktree(mainDir, relPath, content)
        }, `feat: ${summary || relPath}`)
        await callbacks.onToolExecuted({
          toolName: 'write_file',
          filePath: relPath,
          summary: summary || `Created ${relPath}`,
          content,
        })
        return appendSyncNotice(`Wrote and checkpointed ${relPath} (${content.length} bytes).`)
      },
    }),
    edit_file: tool({
      description: 'Replace an exact text snippet inside an existing file in the workspace.',
      inputSchema: z.object({
        path: z.string().describe('Relative file path'),
        old_text: z.string().describe('Exact existing substring to replace'),
        new_text: z.string().describe('Replacement substring'),
        summary: z.string().describe('Short summary of this edit'),
      }),
      execute: async ({ path: relPath, old_text, new_text, summary }) => {
        let current: string | null
        try { current = await vcs.readFileForAgent(vcs.mainDir, relPath) }
        catch { return appendSyncNotice(`Blocked by workspace security policy: ${relPath}`) }
        if (current === null) {
          return appendSyncNotice(`Error: file ${relPath} does not exist.`)
        }
        if (!current.includes(old_text)) {
          return appendSyncNotice(
            `Error: old_text not found in ${relPath}. Call read_file first to get latest contents (a parallel fork may have updated it).`,
          )
        }
        const updated = current.replace(old_text, new_text)
        stepCounter += 1
        callbacks.onStepChange(stepCounter, summary || `Editing ${relPath}`)
        await vcs.applyBuilderStepAndCommit(async (mainDir) => {
          await vcs.writeFileInWorktree(mainDir, relPath, updated)
        }, `refactor: ${summary || relPath}`)
        await callbacks.onToolExecuted({
          toolName: 'edit_file',
          filePath: relPath,
          summary: summary || `Updated ${relPath}`,
          content: updated,
        })
        return appendSyncNotice(`Updated and checkpointed ${relPath}.`)
      },
    }),
    read_file: tool({
      description: 'Read the latest content of a file in the workspace.',
      inputSchema: z.object({
        path: z.string().describe('Relative file path'),
      }),
      execute: async ({ path: relPath }) => {
        let data: string | null
        try { data = await vcs.readFileForAgent(vcs.mainDir, relPath) }
        catch { return appendSyncNotice(`Blocked by workspace security policy: ${relPath}`) }
        if (data === null) return appendSyncNotice(`File not found or not readable: ${relPath}`)
        return appendSyncNotice(data)
      },
    }),
    list_files: tool({
      description: 'List all files currently in the workspace.',
      inputSchema: z.object({}),
      execute: async () => {
        const files = await vcs.listFilesInWorktree(vcs.mainDir)
        return appendSyncNotice(files.length ? files.join('\n') : '(empty workspace)')
      },
    }),
  }

  const systemPrompt = `You are ForkStream's primary Builder Agent building a complete, self-contained, immediately runnable web application rendered live as you code.
Architecture rules:
1. Split your implementation cleanly across 5 to 7 modular files (e.g., styles/tokens.css, index.html, styles/components.css, js/data.js, js/features.js, js/app.js) with no build step required so index.html renders live immediately after every step!
2. Write index.html early (step 1 or 2) referencing the CSS and JS files, with semantic data-section="..." attributes on major sections so the live Observer Agent can stream and focus the live preview incrementally.
3. Make the UI visually polished, modern, responsive, and genuinely interactive with rich sample data.
4. CRITICAL PARALLEL FORK RULE: While you work, a parallel Fork Agent may merge user-requested fixes into your workspace. If a tool result includes a [LIVE FORK MERGE SYNC NOTICE], always call read_file before editing any file mentioned in that notice and strictly preserve the user's changes.${skillBlock}`

  const result = streamText({
    model,
    system: systemPrompt,
    prompt,
    tools,
    stopWhen: stepCountIs(16),
    abortSignal: callbacks.abortSignal,
    onFinish: async ({ totalUsage }) => {
      await callbacks.onUsage?.({
        inputTokens: Number(totalUsage.inputTokens ?? 0),
        outputTokens: Number(totalUsage.outputTokens ?? 0),
      })
    },
  })

  for await (const delta of result.textStream) {
    if (delta) callbacks.onTextDelta(delta)
  }
}

export async function runRealForkAgent(params: {
  config: ProviderConfig
  forkId: string
  forkDir: string
  userPrompt: string
  targetFiles: string[]
  observerDigest: string
  selectedElement?: SelectedDomElement
  vcs: SessionWorktreeManager
  onForkFileEdited: (filePath: string, content: string, summary: string) => void
  onForkStatus: (action: string) => void
}): Promise<{ filesModified: string[] }> {
  const {
    config,
    forkDir,
    userPrompt,
    targetFiles,
    observerDigest,
    selectedElement,
    vcs,
    onForkFileEdited,
    onForkStatus,
  } = params

  const model = createLanguageModel(config, true)
  const modified = new Set<string>()

  const tools = {
    list_files: tool({
      description: 'List all files in this isolated fork worktree.',
      inputSchema: z.object({}),
      execute: async () => (await vcs.listFilesInWorktree(forkDir)).join('\n'),
    }),
    read_file: tool({
      description: 'Read a file from this isolated fork worktree.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path: relPath }) => {
        try { return await vcs.readFileForAgent(forkDir, relPath) ?? `File not found: ${relPath}` }
        catch { return `Blocked by workspace security policy: ${relPath}` }
      },
    }),
    edit_file: tool({
      description: 'Make a surgical targeted replacement in an existing file to minimize merge conflicts.',
      inputSchema: z.object({
        path: z.string(),
        old_text: z.string(),
        new_text: z.string(),
        summary: z.string(),
      }),
      execute: async ({ path: relPath, old_text, new_text, summary }) => {
        let cur: string | null
        try { cur = await vcs.readFileForAgent(forkDir, relPath) }
        catch { return `Blocked by workspace security policy: ${relPath}` }
        if (cur === null) return `File not found: ${relPath}`
        if (!cur.includes(old_text)) return `old_text did not match in ${relPath}. Read the file first.`
        const next = cur.replace(old_text, new_text)
        await vcs.writeFileInWorktree(forkDir, relPath, next)
        modified.add(relPath)
        onForkStatus(summary || `Patched ${relPath}`)
        onForkFileEdited(relPath, next, summary)
        return `Patched ${relPath} cleanly.`
      },
    }),
    write_file: tool({
      description: 'Write or overwrite a file in this isolated fork worktree.',
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        summary: z.string(),
      }),
      execute: async ({ path: relPath, content, summary }) => {
        await vcs.writeFileInWorktree(forkDir, relPath, content)
        modified.add(relPath)
        onForkStatus(summary || `Wrote ${relPath}`)
        onForkFileEdited(relPath, content, summary)
        return `Wrote ${relPath}.`
      },
    }),
  }

  const allFiles = await vcs.listFilesInWorktree(forkDir)
  const elemCtx = selectedElement
    ? `\nSelected Live Preview DOM Element: <${selectedElement.tagName}> selector="${selectedElement.selector}" section="${selectedElement.sectionId ?? 'n/a'}" text="${selectedElement.textSnippet}"`
    : ''

  const result = streamText({
    model,
    system: `You are ForkStream's parallel Fork Fixer Agent operating in an isolated Git worktree while the primary Builder Agent keeps running on main.
Your job: Execute ONLY the user's requested mid-run fix or addition cleanly and surgically so Mergiraf AST merge can merge your branch back into main with zero conflicts.
Prefer edit_file over rewriting untouched parts of files. Inspect the suggested target files first, apply the exact fix/feature, and finish promptly.`,
    prompt: `User mid-run intervention command: "${userPrompt}"
Available files in worktree: ${allFiles.join(', ')}
Observer-suggested target files: ${targetFiles.join(', ')}${elemCtx}
Recent Observer activity digest:
${observerDigest}`,
    tools,
    stopWhen: stepCountIs(10),
  })

  await result.text
  return { filesModified: Array.from(modified) }
}

export async function resolveConflictWithLLM(params: {
  config: ProviderConfig
  filePath: string
  conflictedContent: string
  forkPrompt: string
}): Promise<string | null> {
  if (params.config.mode !== 'llm' || !params.config.apiKey) return null
  const model = createLanguageModel(params.config, true)
  const { text } = await generateText({
    model,
    system:
      'You are a precision 3-way Git diff3 conflict resolver. Combine BOTH the Builder Agent ongoing additions (HEAD) AND the human-requested Fork fix (fork/*). When they directly contradict, ALWAYS honor the human Fork request. Return ONLY the raw resolved file content with NO markdown fences and NO conflict markers.',
    prompt: `File: ${params.filePath}\nHuman Fork directive: ${params.forkPrompt}\n\nConflicted file:\n${params.conflictedContent}`,
  })
  const cleaned = text.replace(/^```[\w-]*\n/, '').replace(/\n```$/, '')
  return cleaned.includes('<<<<<<<') ? null : cleaned
}
