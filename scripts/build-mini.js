/**
 * build-mini.js
 * Script tự động build Vue app và tạo file .zip
 * để upload lên Ali Cloud / SuperApp Console
 *
 * Cách dùng: npm run build:mini
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

// ──────────────────────────────────────────
// Config
// ──────────────────────────────────────────
const DIST_DIR = path.join(ROOT, 'dist')
const OUTPUT_DIR = path.join(ROOT, 'mini-build')
const APP_NAME = getAppName()
const VERSION = getVersion()

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────
function log(msg, color = '\x1b[36m') {
  console.log(`${color}[build-mini]\x1b[0m ${msg}`)
}

function logSuccess(msg) { log('✅ ' + msg, '\x1b[32m') }
function logError(msg)   { log('❌ ' + msg, '\x1b[31m') }
function logInfo(msg)    { log('ℹ️  ' + msg, '\x1b[34m') }

function getAppName() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
    return pkg.name === 'librespeed-speedtest' ? 'speedtest' : (pkg.name || 'speedtest')
  } catch {
    return 'speedtest'
  }
}

function getVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
    return pkg.version || '1.0.0'
  } catch {
    return '1.0.0'
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

function getDirSize(dirPath) {
  let total = 0
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      total += getDirSize(full)
    } else {
      total += fs.statSync(full).size
    }
  }
  return total
}

// ──────────────────────────────────────────
// Zip utility (Hỗ trợ đa nền tảng Windows/macOS/Linux)
// ──────────────────────────────────────────
/*
  Đọc danh sách tên file trong .zip (central directory), không cần thư viện.
  Dùng để KIỂM TRA gói trước khi giao, xem phần verifyZip bên dưới.
*/
function readZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath)
  // End of Central Directory: quét ngược vì cuối file có thể có comment.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Không đọc được cấu trúc zip (thiếu EOCD)')

  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const names = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Central directory hỏng')
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
  }
  return names
}

/*
  Gói hỏng thì phải chết ở đây, không phải trên console của SuperApp.

  Chuẩn ZIP (APPNOTE 4.4.17) bắt buộc dùng "/" ngăn thư mục. Compress-Archive
  của Windows PowerShell 5.1 ghi "\", nên "assets\index-abc.js" bị nhiều trình
  giải nén hiểu là TÊN FILE chứ không phải thư mục - gói vẫn tải lên được, vẫn
  giải nén được, nhưng index.html trỏ "./assets/index-abc.js" thì không còn gì
  ở đó và mini app trắng trang.

  Đã xảy ra thật: bản 2026-09-04 đầu tiên bị lỗi này mà không ai biết.
*/
function verifyZip(zipPath) {
  let names
  try {
    names = readZipEntries(zipPath)
  } catch (err) {
    logError('Không kiểm tra được file zip: ' + err.message)
    return false
  }

  const backslashed = names.filter((n) => n.includes('\\'))
  if (backslashed.length > 0) {
    logError('File zip dùng "\\" thay vì "/" để ngăn thư mục - gói này sẽ trắng trang.')
    backslashed.slice(0, 5).forEach((n) => logError('   ' + n))
    logError('Nén lại bằng bsdtar của Windows (System32\\tar.exe), không dùng Compress-Archive.')
    return false
  }

  const hasIndex = names.some((n) => n === 'index.html' || n === './index.html')
  if (!hasIndex) {
    logError('Không thấy index.html ở gốc file zip. SuperApp Console cần nó nằm ngay gốc.')
    logError('   Đang có: ' + names.slice(0, 5).join(', '))
    return false
  }

  logSuccess(`Kiểm tra gói: ${names.length} mục, đường dẫn hợp lệ, có index.html ở gốc`)
  return true
}

/*
  Nén thư mục thành .zip.

  Trên Windows gọi bsdtar theo ĐƯỜNG DẪN TUYỆT ĐỐI. Gọi trống "tar" thì tuỳ
  shell: chạy từ Git Bash sẽ trúng GNU tar của Git, vốn không có "-a", lệnh
  hỏng và trước đây script lặng lẽ rơi xuống Compress-Archive - xem verifyZip.
*/
async function zipDirectory(sourceDir, outputZip) {
  const attempts = []

  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
    const bsdtar = path.join(systemRoot, 'System32', 'tar.exe')
    if (fs.existsSync(bsdtar)) {
      attempts.push(['bsdtar', `"${bsdtar}" -a -c -f "${outputZip}" -C "${sourceDir}" .`])
    }
  } else {
    attempts.push(['zip', `zip -r "${outputZip}" .`, sourceDir])
    attempts.push(['bsdtar', `tar -a -c -f "${outputZip}" -C "${sourceDir}" .`])
  }

  for (const [name, cmd, cwd] of attempts) {
    try {
      if (fs.existsSync(outputZip)) fs.rmSync(outputZip)
      execSync(cmd, { stdio: 'pipe', cwd })
      if (fs.existsSync(outputZip)) {
        logInfo(`Nén bằng ${name}`)
        return true
      }
    } catch (err) {
      logInfo(`${name} không dùng được: ${String(err.message).split('\n')[0]}`)
    }
  }

  logError('Không nén được thư mục thành .zip.')
  if (process.platform === 'win32') {
    logError('Cần bsdtar tại %SystemRoot%\\System32\\tar.exe (Windows 10 1803 trở lên).')
    logError('Compress-Archive KHÔNG dùng được: nó ghi "\\" thay vì "/" và làm hỏng gói.')
  }
  return false
}

// ──────────────────────────────────────────
// Step 1: Vite Build
// ──────────────────────────────────────────
function runViteBuild() {
  log('Đang build với Vite...')
  try {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })
    logSuccess('Vite build thành công!')
  } catch (err) {
    logError('Vite build thất bại!')
    process.exit(1)
  }
}

// ──────────────────────────────────────────
// Step 2: Dọn dẹp & chuẩn bị output folder
// ──────────────────────────────────────────
function prepareOutputDir() {
  log('Chuẩn bị thư mục output...')
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  logSuccess(`Output dir: ${path.relative(ROOT, OUTPUT_DIR)}`)
}

// ──────────────────────────────────────────
// Step 3: Copy dist vào output
// ──────────────────────────────────────────
function copyDist() {
  log('Copy dist → mini-build/...')
  if (!fs.existsSync(DIST_DIR)) {
    logError(`Không tìm thấy thư mục dist! Build lại trước.`)
    process.exit(1)
  }

  const copyDir = (src, dest) => {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  copyDir(DIST_DIR, OUTPUT_DIR)
  logSuccess('Copy hoàn tất!')
}

// ──────────────────────────────────────────
// Step 4: Tạo file .zip
// ──────────────────────────────────────────
async function createZip() {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const zipName = `${APP_NAME}_v${VERSION}_${timestamp}.zip`
  const zipPath = path.join(ROOT, zipName)

  log(`Tạo file zip: ${zipName}`)
  const success = await zipDirectory(OUTPUT_DIR, zipPath)

  if (!success || !fs.existsSync(zipPath)) {
    logError('Không tạo được file zip.')
    process.exit(1)
  }

  /* Gói hỏng phải dừng ở đây chứ không phải lúc deploy - xem verifyZip. */
  if (!verifyZip(zipPath)) {
    logError('Gói không đạt kiểm tra, đã xoá để không ai lỡ tải lên.')
    fs.rmSync(zipPath, { force: true })
    process.exit(1)
  }

  const size = fs.statSync(zipPath).size
  logSuccess(`Zip tạo thành công: ${zipName} (${formatBytes(size)})`)
  return zipPath
}

// ──────────────────────────────────────────
// Step 5: In thông tin tổng kết
// ──────────────────────────────────────────
function printSummary(zipPath) {
  const distSize = getDirSize(OUTPUT_DIR)

  console.log('\n' + '─'.repeat(50))
  log('📦 BUILD SUMMARY', '\x1b[33m')
  console.log('─'.repeat(50))
  logInfo(`App Name  : ${APP_NAME}`)
  logInfo(`Version   : v${VERSION}`)
  logInfo(`Dist Size : ${formatBytes(distSize)}`)
  if (zipPath) {
    const zipSize = fs.statSync(zipPath).size
    logInfo(`Zip File  : ${path.basename(zipPath)} (${formatBytes(zipSize)})`)
    logInfo(`Zip Path  : ${zipPath}`)
  }
  console.log('─'.repeat(50))
  console.log()
  log('🚀 Upload file .zip lên Ali Cloud Console:', '\x1b[33m')
  log('   1. Đăng nhập Ali Cloud → SuperApp Console', '\x1b[37m')
  log('   2. Chọn mini app → Phiên bản → Tải lên', '\x1b[37m')
  log('   3. Chọn file .zip vừa tạo và deploy', '\x1b[37m')
  console.log('─'.repeat(50) + '\n')
}

// ──────────────────────────────────────────
// Main
// ──────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(50))
  log(`🎯 Bắt đầu build Mini App: ${APP_NAME} v${VERSION}`, '\x1b[33m')
  console.log('═'.repeat(50) + '\n')

  runViteBuild()
  prepareOutputDir()
  copyDist()
  const zipPath = await createZip()
  printSummary(zipPath)
}

main().catch((err) => {
  logError('Lỗi không xử lý được: ' + err.message)
  process.exit(1)
})
