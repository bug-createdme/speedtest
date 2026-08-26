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
async function zipDirectory(sourceDir, outputZip) {
  try {
    // Thử dùng tar trước (có sẵn trên Windows 10/11 và hầu hết Linux/macOS)
    if (process.platform === 'win32') {
      execSync(`tar -a -c -f "${outputZip}" -C "${sourceDir}" .`, { stdio: 'pipe' })
    } else {
      execSync(`zip -r "${outputZip}" .`, { cwd: sourceDir, stdio: 'pipe' })
    }
    return true
  } catch {
    // Fallback riêng cho Windows nếu tar gặp vấn đề
    if (process.platform === 'win32') {
      try {
        execSync(`powershell -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${outputZip}' -Force"`, { stdio: 'pipe' })
        return true
      } catch (psErr) {
        logError('Không thể tạo file zip bằng PowerShell: ' + psErr.message)
        return false
      }
    }
    logError('Không tìm thấy lệnh zip hoặc tar để nén thư mục.')
    return false
  }
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

  if (success && fs.existsSync(zipPath)) {
    const size = fs.statSync(zipPath).size
    logSuccess(`Zip tạo thành công: ${zipName} (${formatBytes(size)})`)
    return zipPath
  }
  return null
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
