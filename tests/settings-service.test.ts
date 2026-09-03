import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsService } from '../src/main/settings-service'

describe('SettingsService', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'md-settings-test-'))
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('initializes defaults when settings.json does not exist', async () => {
    const service = new SettingsService(tempDir)
    const settings = await service.getSettings()

    // Default runners check
    const expectedRunners = [
      'python',
      'javascript',
      'typescript',
      'powershell',
      'bash',
      'go',
      'rust',
      'java',
    ]
    for (const runnerId of expectedRunners) {
      expect(settings.runners[runnerId], `Runner ${runnerId} should exist`).toBeDefined()
      expect(settings.runners[runnerId].id).toBe(runnerId)
      expect(settings.runners[runnerId].enabled).toBe(true)
      expect(settings.runners[runnerId].commandTemplate).toBeTruthy()
      expect(settings.runners[runnerId].extension).toBeTruthy()
      expect(settings.runners[runnerId].language).toBeTruthy()
      expect(settings.runners[runnerId].name).toBeTruthy()
    }

    // Default ai check
    expect(settings.ai).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKeyConfigured: false,
    })
  })

  it('persists changes when updateSettings is called', async () => {
    const service = new SettingsService(tempDir)
    const initial = await service.getSettings()

    const updated = await service.updateSettings({
      runners: {
        ...initial.runners,
        python: {
          ...initial.runners.python,
          commandTemplate: 'python3 -u "{file}"',
        },
      },
    })

    expect(updated.runners.python.commandTemplate).toBe('python3 -u "{file}"')

    // Verify it persists to disk by creating a new service instance
    const secondService = new SettingsService(tempDir)
    const persisted = await secondService.getSettings()
    expect(persisted.runners.python.commandTemplate).toBe('python3 -u "{file}"')

    // Verify file content on disk
    const rawFileContent = await readFile(path.join(tempDir, 'settings.json'), 'utf8')
    const parsed = JSON.parse(rawFileContent)
    expect(parsed.runners.python.commandTemplate).toBe('python3 -u "{file}"')
  })

  it('properly merges partial updates without wiping other fields', async () => {
    const service = new SettingsService(tempDir)

    // Partial update to AI only
    await service.updateSettings({
      ai: {
        baseUrl: 'https://custom-api.example.com/v1',
        model: 'custom-model',
        apiKeyConfigured: true,
      },
    })

    let settings = await service.getSettings()
    // AI should be updated
    expect(settings.ai.baseUrl).toBe('https://custom-api.example.com/v1')
    expect(settings.ai.model).toBe('custom-model')
    expect(settings.ai.apiKeyConfigured).toBe(true)
    // Runners should NOT be wiped out
    expect(settings.runners.python).toBeDefined()
    expect(settings.runners.javascript).toBeDefined()
    expect(settings.runners.typescript).toBeDefined()

    // Partial update to runners only without re-specifying all runners
    await service.updateSettings({
      runners: {
        python: {
          ...settings.runners.python,
          enabled: false,
        },
      },
    })

    settings = await service.getSettings()
    // Python runner was updated
    expect(settings.runners.python.enabled).toBe(false)
    // Other runners are intact
    expect(settings.runners.javascript.enabled).toBe(true)
    expect(settings.runners.rust.enabled).toBe(true)
    // AI is intact
    expect(settings.ai.model).toBe('custom-model')
  })

  it('handles corrupted or empty settings.json by falling back to defaults', async () => {
    const settingsPath = path.join(tempDir, 'settings.json')
    const service = new SettingsService(tempDir)

    // Test with empty string
    await writeFile(settingsPath, '', 'utf8')
    let settings = await service.getSettings()
    expect(settings.runners.python).toBeDefined()
    expect(settings.ai.model).toBe('gpt-4o-mini')

    // Test with malformed JSON
    await writeFile(settingsPath, '{ invalid json content !!!', 'utf8')
    settings = await service.getSettings()
    expect(settings.runners.python).toBeDefined()
    expect(settings.ai.model).toBe('gpt-4o-mini')

    // Test with empty JSON object {}
    await writeFile(settingsPath, '{}', 'utf8')
    settings = await service.getSettings()
    expect(settings.runners.python).toBeDefined()
    expect(settings.ai.model).toBe('gpt-4o-mini')
  })

  it('resets settings to defaults when resetDefaults is called', async () => {
    const service = new SettingsService(tempDir)

    await service.updateSettings({
      ai: {
        baseUrl: 'https://modified.example.com/v1',
        model: 'modified-model',
        apiKeyConfigured: true,
      },
      runners: {
        python: {
          id: 'python',
          name: 'Python Custom',
          language: 'python',
          extension: '.py',
          commandTemplate: 'custom-python "{file}"',
          enabled: false,
        },
      },
    })

    const modified = await service.getSettings()
    expect(modified.ai.model).toBe('modified-model')
    expect(modified.runners.python.commandTemplate).toBe('custom-python "{file}"')

    const reset = await service.resetDefaults()
    expect(reset.ai.model).toBe('gpt-4o-mini')
    expect(reset.ai.baseUrl).toBe('https://api.openai.com/v1')
    expect(reset.runners.python.commandTemplate).toBe('python -u "{file}"')
    expect(reset.runners.python.enabled).toBe(true)

    // Verify persisted on disk
    const secondService = new SettingsService(tempDir)
    const persisted = await secondService.getSettings()
    expect(persisted.ai.model).toBe('gpt-4o-mini')
    expect(persisted.runners.python.commandTemplate).toBe('python -u "{file}"')
  })
})
