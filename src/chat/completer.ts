import { CompleterResult } from 'readline'
import { commands, completeCommand } from './commands/commands'
import { ChatContext } from './context'

const commandPrefixes = commands.map(({ prefix, expectsArgs }) => prefix + (expectsArgs ? ' ' : ''))

export async function completer(context: ChatContext, line: string): Promise<CompleterResult> {
    if (line === '') {
        // Show all meta commands
        return [commandPrefixes, line]
    }

    // Complete a specific command (with a fully provided prefix)
    const commandResult = await completeCommand(context, line)
    if (commandResult) {
        return commandResult
    }

    // Complete all partially provided commands
    const hits = commandPrefixes.filter(completion => completion.startsWith(line))
    if (hits.length > 0) {
        return [hits, line]
    }

    // No completion suggestions
    return [[], line]
}
