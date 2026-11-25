import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// 生成长文，保证内容足够滚动
function longDocument(): string {
  const blocks: string[] = []
  for (let index = 0; index < 200; index += 1) {
    blocks.push(`## 第 ${index} 节标题`, `这是第 ${index} 节的第一段正文，用于填充文档内容。`, `这是第 ${index} 节的第二段正文，用于填充文档内容。`, '')
  }
  return blocks.join('\n')
}

test('reopening a document restores the previous reading position (scroll)', async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-scroll-ud-'))
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-scroll-ws-'))
  const filePath = path.join(workspacePath, 'long-reading.md')
  await writeFile(filePath, longDocument(), 'utf8')

  const launch = () =>
    electron.launch({
      args: [`--user-data-dir=${userDataPath}`, path.resolve('.'), filePath],
    })

  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.tiptap-editor')).toBeVisible()

    // 读者把文档滚到约 70% 的位置
    const ratio = await page.locator('.editor-scroll').evaluate((el) => {
      el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.7
      el.dispatchEvent(new Event('scroll'))
      return (el.scrollHeight - el.clientHeight) > 0 ? 0.7 : 0
    })
    expect(ratio).toBeGreaterThan(0)
    // 等待滚动位置持久化（rAF 节流）
    await page.waitForTimeout(500)
    await app.close()
    app = null as unknown as Awaited<ReturnType<typeof launch>>

    // 再次以相同数据目录与文件启动
    app = await launch()
    page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.tiptap-editor')).toBeVisible()
    // 等待内容渲染 + 恢复逻辑执行（含内容测量的多次延时应用）
    await page.waitForTimeout(2800)

    const restored = await page.locator('.editor-scroll').evaluate((el) => {
      const max = el.scrollHeight - el.clientHeight
      return max > 0 ? el.scrollTop / max : 0
    })
    // content-visibility 惰性测量使比例存在合理误差，但必须明显远离顶部（0）
    expect(restored, `重新打开后阅读位置未恢复（scrollTop 比例 = ${restored}，期望接近 0.7）`).toBeGreaterThan(0.4)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataPath, { recursive: true, force: true })
    await rm(workspacePath, { recursive: true, force: true })
  }
})