import readline from 'readline'
import { program } from 'commander'
import { completer } from './chat/completer'
import { ChatContext } from './chat/context'
import { createEditorEventSource, registerEditorListeners } from './chat/editor'
import { handler } from './chat/handler'
import { loadHistory } from './chat/history'
import { ContextState, createContextState } from './context/state'
import { Provider } from './providers/provider'
import { createProvider, modelNames } from './providers/providers'
import { createInterruptHandler, InterruptHandlerOptions } from './util/interrupts/interrupts'
import { createPrompter } from './util/prompter/prompter'

async function main() {
    program
        .name('ai')
        .description('Personalized AI in the terminal.')
        .showHelpAfterError(true)
        .allowExcessArguments(false)
        .storeOptionsAsProperties()

    const modelFlags = '-m, --model <string>'
    const modelDescription = `Model to use. Valid options are ${modelNames.join(', ')}.`
    const modelDefault = 'sonnet'

    const historyFlags = '-h, --history <string>'
    const historyDescription = 'File to load chat history from.'

    const portFlags = '-p, --port <number>'
    const portDescription = 'Port number of the vscode extension server providing editor information.'

    program
        .option(modelFlags, modelDescription, modelDefault)
        .option(historyFlags, historyDescription)
        .option(portFlags, portDescription)
        .action(options => chat(options.model, options.history, options.port))

    program.parse(process.argv)
}

const system = `You are an assistant!`

async function chat(model: string, historyFilename?: string, port?: number) {
    if (!process.stdin.setRawMode) {
        throw new Error('chat command is not supported in this environment.')
    }

    const contextState = createContextState()
    await chatWithProvider(contextState, createProvider(contextState, model, system), model, historyFilename, port)
}

async function chatWithProvider(
    contextState: ContextState,
    provider: Provider,
    model: string,
    historyFilename?: string,
    port?: number,
) {
    let context: ChatContext

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        completer: (line: string) => (context ? completer(context, line) : undefined),
    })

    const editorEventSource = createEditorEventSource(port)

    try {
        const interruptHandler = createInterruptHandler(rl)
        const prompter = createPrompter(rl, interruptHandler)
        const interruptInputOptions = rootInterruptHandlerOptions(rl)

        context = {
            model,
            interruptHandler,
            prompter,
            provider,
            contextState,
        }

        registerEditorListeners(context, editorEventSource)

        await interruptHandler.withInterruptHandler(
            () => chatWithReadline(context, historyFilename),
            interruptInputOptions,
        )
    } finally {
        rl.close()
        editorEventSource?.close()
    }
}

function rootInterruptHandlerOptions(rl: readline.Interface): InterruptHandlerOptions {
    let last: Date
    const threshold = 1000

    const onAbort = () => {
        const now = new Date()
        if (last && now.getTime() - last.getTime() <= threshold) {
            console.log()
            console.log('Goodbye!\n')
            rl.close()
            process.exit(0)
        }

        rl.pause()
        process.stdout.write('^C')
        rl.resume()
        last = now
    }

    return {
        permanent: true,
        throwOnCancel: false,
        onAbort,
    }
}

async function chatWithReadline(context: ChatContext, historyFilename?: string) {
    if (historyFilename) {
        loadHistory(context, historyFilename)
    }

    console.log(`${historyFilename ? 'Resuming' : 'Beginning'} session with ${context.model}...\n`)
    await handler(context)
}

await main()
