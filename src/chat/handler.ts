import chalk from 'chalk'
import { Response } from '../messages/messages'
import { ProgressFunction } from '../providers/provider'
import { prefixFormatter, ProgressResult, withProgress } from '../util/progress/progress'
import { handleCommand } from './commands/commands'
import { handleLoadPatterns } from './commands/context/load'
import { ExitError } from './commands/control/exit'
import { ChatContext } from './context'
import { formatMessage } from './output'
import { runToolsInMessages } from './tools'

export async function handler(context: ChatContext) {
    const loaded = new Set()
    const loadEditorFiles = async () => {
        const newFiles = context.editorState.openFiles.filter(file => !loaded.has(file))
        if (newFiles.length === 0) {
            return
        }

        newFiles.forEach(file => loaded.add(file))
        await handleLoadPatterns(context, newFiles)
    }

    let restoreState = false

    while (true) {
        await loadEditorFiles()

        const oldRestoreState = restoreState
        restoreState = false

        const controller = new AbortController()
        context.editorState.events.addListener('open-files-changed', () => {
            controller.abort()
            restoreState = true
        })

        try {
            const currentBranch = context.provider.conversationManager.currentBranch()
            const prompt = `[${currentBranch}] $ `
            const message = await context.prompter.question(prompt, controller.signal, oldRestoreState)
            await handle(context, message.trim())
        } catch (error: any) {
            if (error instanceof ExitError) {
                return
            }

            throw error
        } finally {
            context.editorState.events.removeAllListeners('open-files-changed')
        }
    }
}

async function handle(context: ChatContext, message: string): Promise<void> {
    if (message === '') {
        return
    }

    if (message.startsWith(':')) {
        await handleCommand(context, message)
        return
    }

    const prunedBranches = context.provider.conversationManager.pushUser({ type: 'text', content: message })
    if (prunedBranches.length > 0) {
        console.log(chalk.yellow(`${chalk.dim('𐌖')} Pruned branches: ${prunedBranches.join(', ')}`))
        console.log()
    }

    await prompt(context)
}

async function prompt(context: ChatContext): Promise<void> {
    while (true) {
        const result = await promptWithProgress(context)
        if (!result.ok) {
            console.log(chalk.red(result.error))
            console.log()
            break
        }

        try {
            const { ranTools, reprompt } = await runToolsInMessages(context, result.response.messages)
            if (!ranTools) {
                break
            }

            if (!reprompt) {
                const choice = await context.prompter.choice('Continue current prompt', [
                    { name: 'y', description: 'Re-prompt model' },
                    { name: 'n', description: 'Supply a new prompt', isDefault: true },
                ])

                if (choice === 'n') {
                    console.log(chalk.dim('ℹ') + ' Ending prompt.')
                    console.log()
                    break
                }
            }
        } catch (error: any) {
            console.log(chalk.red(`Failed to run tools: ${error.message}`))
            console.log()
            break
        }
    }
}

async function promptWithProgress(context: ChatContext): Promise<ProgressResult<Response>> {
    const formatResponse = (r?: Response): string =>
        (r?.messages || [])
            .map(formatMessage)
            .filter(message => message !== '')
            .join('\n\n')

    let cancel = () => {}
    const prompt = (progress?: ProgressFunction): Promise<Response> => {
        return context.provider.prompt(progress, abort => {
            cancel = abort
        })
    }

    return await context.interruptHandler.withInterruptHandler(
        () =>
            withProgress<Response>(prompt, {
                progress: prefixFormatter('Generating response...', formatResponse),
                success: prefixFormatter('Generated response.', formatResponse),
                failure: prefixFormatter('Failed to generate response.', formatResponse),
            }),
        {
            throwOnCancel: false,
            onAbort: () => cancel(),
        },
    )
}
