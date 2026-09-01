/**
 * 流程图与图片的高清渲染及多格式下载工具
 */

export type ExportFormat = 'png' | 'svg' | 'jpeg'

/**
 * 将 SVG 源码解析并提取其真实宽度和高度（支持 Node 与浏览器环境）
 */
export function extractSvgDimensions(svgMarkup: string): { width: number; height: number } {
  try {
    const viewBoxMatch = svgMarkup.match(/viewBox=["']\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)["']/i)
    if (viewBoxMatch) {
      const width = parseFloat(viewBoxMatch[3])
      const height = parseFloat(viewBoxMatch[4])
      if (width > 0 && height > 0) {
        return { width, height }
      }
    }

    const widthMatch = svgMarkup.match(/\bwidth=["']([\d.]+)(?:px)?["']/i)
    const heightMatch = svgMarkup.match(/\bheight=["']([\d.]+)(?:px)?["']/i)
    if (widthMatch && heightMatch) {
      const width = parseFloat(widthMatch[1])
      const height = parseFloat(heightMatch[1])
      if (width > 0 && height > 0) {
        return { width, height }
      }
    }
  } catch {
    // fallback
  }

  return { width: 800, height: 600 }
}

/**
 * 将 SVG 源码转换为高分辨率位图 DataURL（支持 2~3 倍超采样）
 */
export async function svgToHighResImage(
  svgMarkup: string,
  scale = 2.5
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { width, height } = extractSvgDimensions(svgMarkup)
  const targetWidth = Math.round(width * scale)
  const targetHeight = Math.round(height * scale)

  return new Promise((resolve) => {
    // 确保 SVG 具备正确的命名空间
    let cleanMarkup = svgMarkup
    if (!cleanMarkup.includes('xmlns="http://www.w3.org/2000/svg"')) {
      cleanMarkup = cleanMarkup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    }

    if (typeof Image === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
      const fallbackUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanMarkup)}`
      resolve({ dataUrl: fallbackUrl, width, height })
      return
    }

    try {
      const blob = new Blob([cleanMarkup], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const img = new Image()

      img.onload = () => {
        URL.revokeObjectURL(url)
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')

        if (ctx) {
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
          const dataUrl = canvas.toDataURL('image/png')
          resolve({ dataUrl, width, height })
        } else {
          resolve({ dataUrl: url, width, height })
        }
      }

      img.onerror = () => {
        URL.revokeObjectURL(url)
        const fallbackUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanMarkup)}`
        resolve({ dataUrl: fallbackUrl, width, height })
      }

      img.src = url
    } catch {
      const fallbackUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanMarkup)}`
      resolve({ dataUrl: fallbackUrl, width, height })
    }
  })
}

/**
 * 触发客户端文件下载
 */
export function triggerDownload(blobOrUrl: Blob | string, filename: string): void {
  if (typeof document === 'undefined') return

  const isBlob = typeof Blob !== 'undefined' && blobOrUrl instanceof Blob
  const url = isBlob ? URL.createObjectURL(blobOrUrl) : blobOrUrl
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)

  if (isBlob && typeof URL !== 'undefined' && URL.revokeObjectURL) {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/**
 * 导出并下载流程图为指定格式（PNG / SVG / JPEG）
 */
export async function downloadDiagram(
  svgMarkup: string,
  format: ExportFormat,
  title = '流程图'
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const safeTitle = (title.trim() || '流程图').replace(/[\\/:*?"<>|]/g, '_')
  const filename = `${safeTitle}_${timestamp}.${format === 'jpeg' ? 'jpg' : format}`

  if (format === 'svg') {
    let cleanMarkup = svgMarkup
    if (!cleanMarkup.includes('xmlns="http://www.w3.org/2000/svg"')) {
      cleanMarkup = cleanMarkup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    }
    const blob = new Blob([cleanMarkup], { type: 'image/svg+xml;charset=utf-8' })
    triggerDownload(blob, filename)
    return
  }

  const { width, height } = extractSvgDimensions(svgMarkup)
  const scale = 3 // 3x 超采样高清导出
  const targetWidth = Math.round(width * scale)
  const targetHeight = Math.round(height * scale)

  return new Promise((resolve, reject) => {
    let cleanMarkup = svgMarkup
    if (!cleanMarkup.includes('xmlns="http://www.w3.org/2000/svg"')) {
      cleanMarkup = cleanMarkup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    }

    const blob = new Blob([cleanMarkup], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        reject(new Error('无法创建 Canvas 上下文'))
        return
      }

      if (format === 'jpeg') {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, targetWidth, targetHeight)
      }

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

      canvas.toBlob(
        (outputBlob) => {
          if (outputBlob) {
            triggerDownload(outputBlob, filename)
            resolve()
          } else {
            reject(new Error('导出图片失败'))
          }
        },
        format === 'jpeg' ? 'image/jpeg' : 'image/png',
        format === 'jpeg' ? 0.95 : 1
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('加载 SVG 图片失败'))
    }

    img.src = url
  })
}

/**
 * 导出并下载普通图片为指定格式
 */
export async function downloadImage(
  imageSrc: string,
  format: 'png' | 'jpeg' | 'original',
  alt = '图片'
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const safeTitle = (alt.trim() || '图片').replace(/[\\/:*?"<>|]/g, '_')

  if (format === 'original' || imageSrc.startsWith('data:')) {
    const ext = format === 'jpeg' ? 'jpg' : format === 'png' ? 'png' : 'png'
    const filename = `${safeTitle}_${timestamp}.${ext}`
    triggerDownload(imageSrc, filename)
    return
  }

  const filename = `${safeTitle}_${timestamp}.${format === 'jpeg' ? 'jpg' : 'png'}`
  const img = new Image()
  img.crossOrigin = 'anonymous'

  return new Promise((resolve) => {
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        triggerDownload(imageSrc, filename)
        resolve()
        return
      }

      if (format === 'jpeg') {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }

      ctx.drawImage(img, 0, 0)
      canvas.toBlob(
        (blob) => {
          if (blob) triggerDownload(blob, filename)
          else triggerDownload(imageSrc, filename)
          resolve()
        },
        format === 'jpeg' ? 'image/jpeg' : 'image/png',
        0.95
      )
    }

    img.onerror = () => {
      triggerDownload(imageSrc, filename)
      resolve()
    }

    img.src = imageSrc
  })
}
