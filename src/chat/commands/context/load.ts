import { homedir } from 'os'
import { sep } from 'path'
import { CompleterResult } from 'readline'
import chalk from 'chalk'
import { expandFilePatterns, expandPrefixes } from '../../../util/fs/glob'
import { filterIgnoredPaths } from '../../../util/fs/ignore'
import { ChatContext } from '../../context'
import { CommandDescription } from '../command'

export const loadCommand: CommandDescription = {
    prefix: ':load',
    description: 'Load file contents into the chat context (supports wildcards)',
    expectsArgs: true,
    handler: handleLoad,
    complete: completeLoad,
}

async function handleLoad(context: ChatContext, args: string): Promise<void> {
    return handleLoadPatterns(
        context,
        args.split(' ').filter(p => p.trim() !== ''),
    )
}

export async function handleLoadPatterns(context: ChatContext, patterns: string[]): Promise<void> {
    if (patterns.length === 0) {
        console.log(chalk.red.bold('No patterns supplied to :load.'))
        console.log()
        return
    }

    const filePaths = filterIgnoredPaths(expandFilePatterns(patterns)).sort()

    if (filePaths.length === 0) {
        console.log(chalk.red.bold('No files matched the provided patterns.'))
        console.log('')
        return
    }

    for (const path of filePaths) {
        context.contextState.addFile(path, { type: 'explicit' })
    }

    const message = filePaths.map(path => `${chalk.dim('ℹ')} Added file "${chalk.red(path)}" into context.`).join('\n')
    console.log(message)
    console.log('')

    context.provider.conversationManager.pushUser({
        type: 'text',
        content: JSON.stringify({ ok: true, response: filePaths.map(path => ({ path })) }),
        replayContent: message,
    })
}

// Expand files for loading that expand the last entry of the current list of files
// the user has provided. If a user has added a space to the previous file, we consider
// that "done" and won't suggest further expansion.
function completeLoad(context: ChatContext, args: string): CompleterResult {
    const last = args.split(' ').pop()!
    const prefix = canonicalizePathPrefix(last)

    if (prefix.includes('*')) {
        const entries = expandFilePatterns([prefix])
        if (entries.length === 0) {
            return [[], last]
        }

        // If there are any matches, return a SINGLE result as a string with a trailing space.
        // This will replace the entry with the expanded paths, rather than simply suggesting
        // all of them for individual selection.
        return [[entries.join(' ') + ' '], last]
    }

    return [expandPrefixes([prefix]), last]
}

function canonicalizePathPrefix(prefix: string): string {
    // Support home directory
    if (prefix.startsWith('~')) {
        prefix = homedir() + prefix.slice(1)
    }

    // Canonicalize relative paths
    if (!prefix.startsWith(`${sep}`) && !prefix.startsWith(`.${sep}`) && !prefix.startsWith(`..${sep}`)) {
        prefix = `.${sep}${prefix}`
    }

    return prefix
}
