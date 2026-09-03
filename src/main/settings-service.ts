import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AiSettings, AppSettings, RunnerDefinition } from '../shared/types'

export const DEFAULT_RUNNERS: Record<string, RunnerDefinition> = {
  python: {
    id: 'python',
    name: 'Python',
    language: 'python',
    extension: '.py',
    commandTemplate: 'python -u "{file}"',
    enabled: true,
  },
  javascript: {
    id: 'javascript',
    name: 'JavaScript (Node.js)',
    language: 'javascript',
    extension: '.js',
    commandTemplate: 'node "{file}"',
    enabled: true,
  },
  typescript: {
    id: 'typescript',
    name: 'TypeScript',
    language: 'typescript',
    extension: '.ts',
    commandTemplate: 'npx tsx "{file}"',
    enabled: true,
  },
  powershell: {
    id: 'powershell',
    name: 'PowerShell',
    language: 'powershell',
    extension: '.ps1',
    commandTemplate: 'powershell -ExecutionPolicy Bypass -File "{file}"',
    enabled: true,
  },
  bash: {
    id: 'bash',
    name: 'Bash / Shell',
    language: 'bash',
    extension: '.sh',
    commandTemplate: 'bash "{file}"',
    enabled: true,
  },
  go: {
    id: 'go',
    name: 'Go',
    language: 'go',
    extension: '.go',
    commandTemplate: 'go run "{file}"',
    enabled: true,
  },
  rust: {
    id: 'rust',
    name: 'Rust',
    language: 'rust',
    extension: '.rs',
    commandTemplate: 'rustc "{file}" -o "{bin}" && "{bin}"',
    enabled: true,
  },
  java: {
    id: 'java',
    name: 'Java',
    language: 'java',
    extension: '.java',
    commandTemplate: 'java "{file}"',
    enabled: true,
  },
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKeyConfigured: false,
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  runners: DEFAULT_RUNNERS,
  ai: DEFAULT_AI_SETTINGS,
}

export class SettingsService {
  private readonly directory: string
  private readonly filePath: string

  public constructor(userDataDirectory: string) {
    this.directory = userDataDirectory
    this.filePath = path.join(userDataDirectory, 'settings.json')
  }

  public async getSettings(): Promise<AppSettings> {
    try {
      const content = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(content) as unknown
      if (!parsed || typeof parsed !== 'object') {
        return this.cloneDefaults()
      }

      const parsedSettings = parsed as Partial<AppSettings>
      const defaultSettings = this.cloneDefaults()

      const runners: Record<string, RunnerDefinition> = { ...defaultSettings.runners }
      if (parsedSettings.runners && typeof parsedSettings.runners === 'object') {
        for (const [key, val] of Object.entries(parsedSettings.runners)) {
          if (val && typeof val === 'object') {
            runners[key] = {
              ...(runners[key] ?? {
                id: key,
                name: key,
                language: key,
                extension: '',
                commandTemplate: '',
                enabled: true,
              }),
              ...val,
            }
          }
        }
      }

      const ai: AiSettings = { ...defaultSettings.ai }
      if (parsedSettings.ai && typeof parsedSettings.ai === 'object') {
        if (typeof parsedSettings.ai.baseUrl === 'string' && parsedSettings.ai.baseUrl.trim()) {
          ai.baseUrl = parsedSettings.ai.baseUrl.trim()
        }
        if (typeof parsedSettings.ai.model === 'string') {
          ai.model = parsedSettings.ai.model.trim()
        }
        if (typeof parsedSettings.ai.apiKeyConfigured === 'boolean') {
          ai.apiKeyConfigured = parsedSettings.ai.apiKeyConfigured
        }
      }

      return { runners, ai }
    } catch {
      return this.cloneDefaults()
    }
  }

  public async updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings()

    const nextRunners: Record<string, RunnerDefinition> = { ...current.runners }
    if (partial.runners && typeof partial.runners === 'object') {
      for (const [key, runner] of Object.entries(partial.runners)) {
        if (runner && typeof runner === 'object') {
          nextRunners[key] = {
            ...(nextRunners[key] ?? {
              id: key,
              name: key,
              language: key,
              extension: '',
              commandTemplate: '',
              enabled: true,
            }),
            ...runner,
          }
        }
      }
    }

    const nextAi: AiSettings = { ...current.ai }
    if (partial.ai && typeof partial.ai === 'object') {
      if (typeof partial.ai.baseUrl === 'string') {
        nextAi.baseUrl = partial.ai.baseUrl.trim()
      }
      if (typeof partial.ai.model === 'string') {
        nextAi.model = partial.ai.model.trim()
      }
      if (typeof partial.ai.apiKeyConfigured === 'boolean') {
        nextAi.apiKeyConfigured = partial.ai.apiKeyConfigured
      }
    }

    const nextSettings: AppSettings = {
      runners: nextRunners,
      ai: nextAi,
    }

    await this.save(nextSettings)
    return nextSettings
  }

  public async resetDefaults(): Promise<AppSettings> {
    const defaults = this.cloneDefaults()
    await this.save(defaults)
    return defaults
  }

  private async save(settings: AppSettings): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    await writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf8')
  }

  private cloneDefaults(): AppSettings {
    return JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS))
  }
}
