#!/usr/bin/env node
/**
 * 把本仓库的构建产物同步进 DSH profile，并维护「profile 内包 + node_modules 联接」的最终布局。
 *
 * 为什么不能直接 `file:D:/...` 装成软链？
 *   DSH 只对「位于 profile 目录树内」的模块提供 @deepseek-ai/* 运行包解析。
 *   若 node_modules/<包名> 指向仓库外，Node 会 realpath 到仓库真实路径，
 *   插件里 `import ... from '@deepseek-ai/dsh-llm'` 就会 ERR_MODULE_NOT_FOUND，
 *   Host 插件行加载失败（表现为模型 provider 不注册、设置面板不出现）。
 *
 * 因此最终布局是：
 *   <profileDir>/packages/dsh-tool-antigravity-expansion   真实副本（由本脚本镜像）
 *   <profileDir>/node_modules/dsh-tool-antigravity-expansion -> 上面这个目录（junction）
 *   <profileDir>/package.json 依赖写 file:packages/dsh-tool-antigravity-expansion
 *
 * 这样即使之后在 profile 里跑 pnpm 安装，pnpm 重新生成的链接也只指向 profile 内部，
 * 插件的运行包解析保持可用。
 *
 * 用法:
 *   node scripts/sync-to-profile.mjs                  # 同步产物并维护链接
 *   node scripts/sync-to-profile.mjs --fix-manifest   # 顺便把 profile 依赖改为内部路径
 *   node scripts/sync-to-profile.mjs --profile web
 *   node scripts/sync-to-profile.mjs --home <dir>
 *   node scripts/sync-to-profile.mjs --dry-run
 *
 * 每次同步后请重启 DeepSeek Harness，让 Host 重新加载插件。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'dsh-tool-antigravity-expansion'
const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** profile 依赖里期望的 specifier（相对 profile 根）。 */
const MANIFEST_SPECIFIER = `file:packages/${PACKAGE_NAME}`

/** 参与同步的条目：构建产物、清单、开发期依赖。 */
const INCLUDE = ['lib', 'node_modules', 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE']

function parseArgs(argv) {
  const options = {
    dryRun: false,
    fixManifest: false,
    profile: process.env.DSH_PROFILE || 'desktop',
    home: process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--fix-manifest') options.fixManifest = true
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--home') options.home = argv[++index]
    else throw new Error(`未知参数: ${arg}`)
  }
  const profileDir = path.resolve(options.home, 'profiles', options.profile)
  options.profileDir = profileDir
  options.packageDir = path.join(profileDir, 'packages', PACKAGE_NAME)
  options.linkPath = path.join(profileDir, 'node_modules', PACKAGE_NAME)
  options.manifest = path.join(profileDir, 'package.json')
  return options
}

/** 拒绝在可疑路径上做删除/链接操作。 */
function assertSafeTargets(options) {
  const slash = (value) => value.replaceAll('\\', '/')
  const insideProfile = (value) => slash(value).includes(`/profiles/${options.profile}/`)
  const okPackage = slash(options.packageDir).endsWith(`/packages/${PACKAGE_NAME}`)
  const okLink = slash(options.linkPath).endsWith(`/node_modules/${PACKAGE_NAME}`)
  if (!insideProfile(options.packageDir) || !okPackage) {
    throw new Error(`拒绝操作可疑包目录: ${options.packageDir}`)
  }
  if (!insideProfile(options.linkPath) || !okLink) {
    throw new Error(`拒绝操作可疑链接: ${options.linkPath}`)
  }
  if ([options.packageDir, options.linkPath].includes(SOURCE_DIR)) {
    throw new Error('目标目录不能是仓库自身。')
  }
}

function copyEntry(name, options) {
  const from = path.join(SOURCE_DIR, name)
  const to = path.join(options.packageDir, name)
  if (!fs.existsSync(from)) {
    console.log(`- 跳过缺失条目: ${name}`)
    return
  }
  console.log(`- 同步 ${name} -> ${to}`)
  if (options.dryRun) return
  fs.rmSync(to, { recursive: true, force: true })
  fs.cpSync(from, to, { recursive: true, dereference: true })
}

function readLinkTarget(linkPath) {
  try {
    return path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath))
  } catch {
    return undefined
  }
}

/**
 * 让 node_modules/<包名> 成为指向 profile 内包目录的联接。
 * Windows 的目录联接（junction）在 lstat 下同样报告为 symbolic link。
 */
function ensureLink(options) {
  let stats
  try {
    stats = fs.lstatSync(options.linkPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    stats = undefined
  }

  if (stats?.isSymbolicLink()) {
    const target = readLinkTarget(options.linkPath)
    if (target && path.resolve(target) === path.resolve(options.packageDir)) {
      console.log(`- 链接已就绪: ${options.linkPath}`)
      return
    }
    console.log(`- 移除指向错误目标的链接: ${options.linkPath} -> ${target ?? '?'}`)
    if (!options.dryRun) fs.rmdirSync(options.linkPath)
  } else if (stats) {
    // 旧形态：node_modules 里是真实目录副本。改名保留，绝不直接删除。
    const backup = `${options.linkPath}.bak-${timestamp()}`
    console.log(`- 旧的真实目录副本改名保留: ${options.linkPath} -> ${backup}`)
    if (!options.dryRun) fs.renameSync(options.linkPath, backup)
  }

  if (options.dryRun) {
    console.log(`- 将创建联接: ${options.linkPath} -> ${options.packageDir}`)
    return
  }
  fs.symlinkSync(options.packageDir, options.linkPath, 'junction')
  console.log(`- 已创建联接: ${options.linkPath} -> ${options.packageDir}`)
}

function timestamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 把 profile 清单里的本包依赖改为 profile 内部路径。 */
function fixManifest(options) {
  if (!fs.existsSync(options.manifest)) {
    console.log(`! 未找到 profile 清单: ${options.manifest}`)
    return
  }
  const text = fs.readFileSync(options.manifest, 'utf8')
  const manifest = JSON.parse(text)
  const current = manifest.dependencies?.[PACKAGE_NAME]
  if (current === MANIFEST_SPECIFIER) {
    console.log(`- 依赖已是内部路径: ${PACKAGE_NAME}@${MANIFEST_SPECIFIER}`)
    return
  }
  if (!current) {
    console.log(`! 清单里没有 ${PACKAGE_NAME} 依赖，未改动。`)
    return
  }
  if (!options.fixManifest) {
    console.log(`! 清单依赖仍是外部路径: ${current}`)
    console.log(`  加 --fix-manifest 可改为 ${MANIFEST_SPECIFIER}`)
    return
  }
  if (!manifest.dependencies) manifest.dependencies = {}
  manifest.dependencies[PACKAGE_NAME] = MANIFEST_SPECIFIER
  console.log(`- 清单依赖: ${current} -> ${MANIFEST_SPECIFIER}`)
  if (options.dryRun) return
  const backup = `${options.manifest}.bak-agy-${timestamp()}`
  fs.copyFileSync(options.manifest, backup)
  console.log(`- 清单已备份: ${backup}`)
  fs.writeFileSync(options.manifest, `${JSON.stringify(manifest, null, 2)}\n`)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  assertSafeTargets(options)
  console.log(`源目录: ${SOURCE_DIR}`)
  console.log(`profile: ${options.profileDir}${options.dryRun ? ' (dry-run)' : ''}`)

  if (!fs.existsSync(path.join(SOURCE_DIR, 'package.json'))) {
    throw new Error(`源目录不是有效的包: ${SOURCE_DIR}`)
  }
  if (!fs.existsSync(options.profileDir)) {
    throw new Error(`profile 目录不存在: ${options.profileDir}`)
  }

  if (!options.dryRun) fs.mkdirSync(options.packageDir, { recursive: true })
  for (const entry of INCLUDE) copyEntry(entry, options)
  ensureLink(options)
  fixManifest(options)

  console.log('\n完成。请重启 DeepSeek Harness，让 Host 重新加载插件。')
}

main()
