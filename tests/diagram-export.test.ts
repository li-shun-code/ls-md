import { describe, expect, it, vi } from 'vitest'
import {
  downloadDiagram,
  downloadImage,
  extractSvgDimensions,
  svgToHighResImage,
  triggerDownload,
} from '../src/renderer/src/utils/diagram-export'
import { WELCOME_DOCUMENT_MARKDOWN } from '../src/renderer/src/utils/welcome-document'

describe('diagram-export utils', () => {
  it('extracts dimensions correctly from SVG with viewBox', () => {
    const svg = '<svg viewBox="0 0 1200 800"><path d="M0 0h100v100H0z"/></svg>'
    const dims = extractSvgDimensions(svg)
    expect(dims).toEqual({ width: 1200, height: 800 })
  })

  it('extracts dimensions correctly from SVG with width and height attributes', () => {
    const svg = '<svg width="640" height="480"><circle r="10"/></svg>'
    const dims = extractSvgDimensions(svg)
    expect(dims).toEqual({ width: 640, height: 480 })
  })

  it('falls back to default dimensions for invalid SVG', () => {
    const dims = extractSvgDimensions('invalid-svg-content')
    expect(dims).toEqual({ width: 800, height: 600 })
  })

  it('converts SVG markup to high-res data URL or fallback data URL', async () => {
    const svg = '<svg viewBox="0 0 400 300"><text>Hello</text></svg>'
    const result = await svgToHighResImage(svg, 2)
    expect(result.width).toBe(400)
    expect(result.height).toBe(300)
    expect(result.dataUrl).toContain('data:image/svg+xml')
  })

  it('triggers download when document is available', () => {
    const clickSpy = vi.fn()
    const mockAnchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: clickSpy,
    }
    const mockDocument = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    }

    vi.stubGlobal('document', mockDocument)
    triggerDownload('data:image/png;base64,sample', 'test.png')

    expect(mockDocument.createElement).toHaveBeenCalledWith('a')
    expect(mockAnchor.download).toBe('test.png')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('downloads SVG format directly as Blob when document is available', async () => {
    const clickSpy = vi.fn()
    const mockAnchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: clickSpy,
    }
    const mockDocument = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    }

    vi.stubGlobal('document', mockDocument)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
      revokeObjectURL: vi.fn(),
    })

    await downloadDiagram('<svg viewBox="0 0 100 100"></svg>', 'svg', '架构图')
    expect(mockDocument.createElement).toHaveBeenCalledWith('a')
    expect(mockAnchor.download).toContain('架构图')
    expect(mockAnchor.download).toContain('.svg')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('handles image download for data url', async () => {
    const clickSpy = vi.fn()
    const mockAnchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: clickSpy,
    }
    const mockDocument = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    }

    vi.stubGlobal('document', mockDocument)
    await downloadImage('data:image/png;base64,mock', 'png', '示意图')
    expect(mockDocument.createElement).toHaveBeenCalledWith('a')
    expect(mockAnchor.download).toContain('示意图')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe('welcome document', () => {
  it('contains comprehensive feature demonstrations', () => {
    expect(WELCOME_DOCUMENT_MARKDOWN).toContain('欢迎使用 Mojian')
    expect(WELCOME_DOCUMENT_MARKDOWN).toContain('```mermaid')
    expect(WELCOME_DOCUMENT_MARKDOWN).toContain('sequenceDiagram')
    expect(WELCOME_DOCUMENT_MARKDOWN).toContain('$E = mc^2$')
    expect(WELCOME_DOCUMENT_MARKDOWN).toContain('AI 智能创作')
    expect(WELCOME_DOCUMENT_MARKDOWN).toContain('快捷键')
  })
})
