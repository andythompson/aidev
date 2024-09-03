import EventEmitter from 'events'
import { Dirent, readdirSync, readFileSync } from 'fs'
import chokidar from 'chokidar'

export interface ContextState {
    events: EventEmitter
    dispose: () => void
    files: Map<string, ContextFile>
    directories: Map<string, ContextDirectory>
    addFile: (path: string, reason: InclusionReason) => void
    addDirectory: (path: string, reason: InclusionReason) => void
}

export type ContextFile = {
    path: string
    inclusionReasons: InclusionReason[]
    content: string | { error: string }
}

export type ContextDirectory = {
    path: string
    inclusionReasons: InclusionReason[]
    entries: DirectoryEntry[] | { error: string }
}

export type DirectoryEntry = {
    name: string
    isFile: boolean
    isDirectory: boolean
}

export type InclusionReason =
    | { type: 'explicit' }
    | { type: 'tool_use'; toolUseId: string }
    | { type: 'editor'; currentlyOpen: boolean }

export function createContextState(): ContextState {
    const events = new EventEmitter()
    const watcher = chokidar.watch([], { persistent: true, ignoreInitial: false })
    const dispose = () => watcher.close()

    const readFileContent = (path: string): string | { error: string } => {
        try {
            return readFileSync(path, 'utf-8').toString()
        } catch (error: any) {
            return { error: `Error reading file: ${error.message}` }
        }
    }

    const readDirectoryEntries = (path: string): DirectoryEntry[] | { error: string } => {
        try {
            return readdirSync(path, { withFileTypes: true }).map((entry: Dirent) => ({
                name: entry.name,
                isFile: entry.isFile(),
                isDirectory: entry.isDirectory(),
            }))
        } catch (error: any) {
            return { error: `Error reading directory: ${error.message}` }
        }
    }

    const updateFile = (path: string) => {
        const file = files.get(path)
        if (file) {
            file.content = readFileContent(path)
            events.emit('change', path)
        }
    }

    const updateDirectory = (path: string) => {
        const directory = directories.get(path)
        if (directory) {
            directory.entries = readDirectoryEntries(path)
            events.emit('change', path)
        }
    }

    watcher.on('change', updateFile)
    watcher.on('change', updateDirectory)
    watcher.on('unlink', updateFile)
    watcher.on('unlinkDir', updateDirectory)

    const files = new Map<string, ContextFile>()
    const directories = new Map<string, ContextDirectory>()

    const getOrCreateFile = (path: string) => {
        const file = files.get(path)
        if (file) {
            return file
        }

        const newFile: ContextFile = { path, inclusionReasons: [], content: readFileContent(path) }
        files.set(path, newFile)
        watcher.add(path)
        return newFile
    }

    const getOrCreateDirectory = (path: string) => {
        const directory = directories.get(path)
        if (directory) {
            return directory
        }

        const newDirectory: ContextDirectory = { path, inclusionReasons: [], entries: readDirectoryEntries(path) }
        directories.set(path, newDirectory)
        watcher.add(path)
        return newDirectory
    }

    const addFile = (path: string, reason: InclusionReason) => {
        const { inclusionReasons } = getOrCreateFile(path)
        updateInclusionReasons(inclusionReasons, reason)
    }

    const addDirectory = (path: string, reason: InclusionReason) => {
        const { inclusionReasons } = getOrCreateDirectory(path)
        updateInclusionReasons(inclusionReasons, reason)
    }

    const updateInclusionReasons = (reasons: InclusionReason[], reason: InclusionReason) => {
        if (
            (reason.type === 'explicit' && reasons.some(r => r.type === 'explicit')) ||
            (reason.type === 'tool_use' && reasons.some(r => r.type === 'tool_use' && r.toolUseId === reason.toolUseId))
        ) {
            // Already exists
            return
        }

        if (reason.type === 'editor') {
            const matching = reasons.find(r => r.type === 'editor')
            if (matching) {
                // Update in-place
                matching.currentlyOpen = reason.currentlyOpen
                return
            }
        }

        // No matching reasons exist
        reasons.push(reason)
    }

    return { events, dispose, files, directories, addFile, addDirectory }
}

export function shouldIncludeFile(file: ContextFile, visibleToolUses: string[]): boolean {
    return shouldInclude(file.inclusionReasons, visibleToolUses)
}

export function shouldIncludeDirectory(directory: ContextDirectory, visibleToolUses: string[]): boolean {
    return shouldInclude(directory.inclusionReasons, visibleToolUses)
}

function shouldInclude(reasons: InclusionReason[], visibleToolUses: string[]): boolean {
    for (const reason of reasons) {
        switch (reason.type) {
            case 'explicit':
                return true

            case 'tool_use':
                if (visibleToolUses.includes(reason.toolUseId)) {
                    return true
                }

                break

            case 'editor':
                if (reason.currentlyOpen) {
                    return true
                }

                break
        }
    }

    return false
}
