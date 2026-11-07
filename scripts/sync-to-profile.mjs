#!/usr/bin/env node
/**
 * 把本仓库的构建产物同步进 DSH profile 的 node_modules。
 *
 * 为什么不能只用 `file:` 软链？
 *   DSH 只对「位于 profile 目录树内」的模块提供 @deepseek-ai/* 运行包解析。
 *   当 node_modules/<包名> 是指向仓库外的软链/联接时，Node 会 realpath 到仓库真实路径，
 *   插件里 `import ... from '@deepseek-ai/dsh-llm'` 就会 ERR_MODULE_NOT_FOUND，
 *   整个 Host 插件行加载失败（表现为模型 provider 不注册、设置面板不出现）。
 *
 * 因此本脚本把包「复制」进 profile，而不是链接。
 *
 * 用法:
 *   node scripts/sync-to-profile.mjs                # 使用默认 profile
 *   node scripts/sync-to-profile.mjs --profile web
 *   node scripts/sync-to-profile.mjs --dest <dir>   # 直接指定目标目录
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

/** 参与同步的条目：构建产物、清单、开发期依赖。 */
const INCLUDE = ['lib', 'node_modules', 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE']

function parseArgs(argv) {
  const options = { dryRun: false, dest: undefined, profile: process.env.DSH_PROFILE || 'desktop' }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--dest') options.dest = argv[++index]
    else throw new Error(`未知参数: ${arg}`)
  }
  if (!options.dest) {
    options.profile ??= 'desktop'
    const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
    options.dest = path.join(home, 'profiles', options.profile, 'node_modules', PACKAGE_NAME)
  }
  options.dest = path.resolve(options.dest)
  return options
}

/** 目标只能是某个 profile 的 node_modules 下、本包名的位置，避免误删。 */
function assertSafeDestination(dest) {
  const normalized = dest.replaceAll('\\', '/')
  if (!normalized.endsWith(`/node_modules/${PACKAGE_NAME}`) || !normalized.includes('/profiles/')) {
    throw new Error(`拒绝操作可疑目标目录: ${dest}`)
  }
  if (dest === SOURCE_DIR) throw new Error('目标目录不能是仓库自身。')
}

/** 目标若是软链/联接，只移除链接本身，绝不动仓库真实目录。 */
function removeLinkIfAny(dest, { dryRun }) {
  let stats
  try {
    stats = fs.lstatSync(dest)
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
  // Windows 的目录联接（junction）在 lstat 下同样报告为 symbolic link。
  if (!stats.isSymbolicLink()) return false
  console.log(`- 移除链接（不动源目录）: ${dest}`)
  if (!dryRun) fs.rmdirSync(dest)
  return true
}

function copyEntry(name, dest, dryRun) {
  const from = path.join(SOURCE_DIR, name)
  const to = path.join(dest, name)
  if (!fs.existsSync(from)) {
    console.log(`- 跳过缺失条目: ${name}`)
    return
  }
  console.log(`- 同步 ${name} -> ${to}`)
  if (dryRun) return
  fs.rmSync(to, { recursive: true, force: true })
  fs.cpSync(from, to, { recursive: true, dereference: true })
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  assertSafeDestination(options.dest)
  console.log(`源目录: ${SOURCE_DIR}`)
  console.log(`目标: ${options.dest}${options.dryRun ? ' (dry-run)' : ''}`)

  if (!fs.existsSync(SOURCE_DIR) || !fs.existsSync(path.join(SOURCE_DIR, 'package.json'))) {
    throw new Error(`源目录不是有效的包: ${SOURCE_DIR}`)
  }

  removeLinkIfAny(options.dest, options)
  if (!options.dryRun) fs.mkdirSync(options.dest, { recursive: true })
  for (const entry of INCLUDE) copyEntry(entry, options.dest, options.dryRun)

  console.log('\n完成。请重启 DeepSeek Harness，让 Host 重新加载插件。')
  const manifest = path.join(path.dirname(path.dirname(options.dest)), 'package.json')
  if (fs.existsSync(manifest)) {
    const text = fs.readFileSync(manifest, 'utf8')
    if (/"dsh-tool-antigravity-expansion"\s*:\s*"file:/.test(text)) {
      console.log(
        '注意: profile 的 package.json 仍把本包声明为 file: 依赖；\n' +
          '下次在该 profile 里执行 pnpm 安装时可能重新生成本包软链，届时再跑一次本脚本即可。',
      )
    }
  }
}

main()
