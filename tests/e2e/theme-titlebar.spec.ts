import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function launchTestApp(extraArgs: string[] = []) {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'markdown-desk-theme-'))
  const app = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`, path.resolve('.'), ...extraArgs],
  })
  return { app, userDataPath }
}

test('toggling the app theme also switches the OS-level (native) title bar theme', async () => {
  const { app, userDataPath } = await launchTestApp()
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.app-shell')).toHaveClass(/theme-light/)

    // 与应用菜单「主题 → 切换浅色/深色」完全相同的路径
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu-command', 'theme.toggle')
    })
    await expect(page.locator('.app-shell')).toHaveClass(/theme-dark/)

    // 顶部系统标题栏由 nativeTheme.themeSource 驱动；应用切到深色，native 侧必须同步
    // （setTheme 为异步 IPC，轮询等待主进程生效）
    const themeSource = () => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)
    await expect.poll(themeSource, { message: 'nativeTheme 未跟随应用主题切换，系统标题栏仍停留在浅色' }).toBe('dark')

    // 切回浅色后 native 侧也应还原
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu-command', 'theme.toggle')
    })
    await expect(page.locator('.app-shell')).toHaveClass(/theme-light/)
    await expect.poll(themeSource, { message: 'nativeTheme 未跟随切回浅色' }).toBe('light')
  } finally {
    await app.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})