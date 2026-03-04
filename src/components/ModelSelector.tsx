import { useState, useEffect, useMemo } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

interface ModelGroup {
    [provider: string]: Array<{ id: string; name: string }>
}

interface ModelSelectorProps {
    value: string
    onSelect: (modelId: string) => void
    sidecarUrl: string
    /** Only show models from this provider */
    provider?: string
    /** Compact mode for status bar */
    compact?: boolean
    disabled?: boolean
}

export function ModelSelector({ value, onSelect, sidecarUrl, provider, compact = false, disabled = false }: ModelSelectorProps) {
    const [open, setOpen] = useState(false)
    const [allModels, setAllModels] = useState<ModelGroup>({})
    const [loading, setLoading] = useState(false)

    async function fetchModels() {
        if (loading || Object.keys(allModels).length > 0) return
        setLoading(true)
        try {
            const res = await fetch(`${sidecarUrl}/models`)
            if (res.ok) {
                const data = await res.json()
                setAllModels(data.groups || {})
            }
        } catch { /* ignore */ }
        finally { setLoading(false) }
    }

    // Fetch on first open
    useEffect(() => {
        if (open) fetchModels()
    }, [open])

    // Filter to active provider only (if specified)
    const models = useMemo(() => {
        if (!provider) return allModels
        const filtered: ModelGroup = {}
        if (allModels[provider]) {
            filtered[provider] = allModels[provider]
        }
        return filtered
    }, [allModels, provider])

    // Find display name for current value
    const flatModels = Object.values(models).flat()
    const selectedModel = flatModels.find(m => m.id === value)
    const displayName = selectedModel?.name || value || "Select model..."

    if (compact) {
        return (
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        className="flex items-center gap-1.5 cursor-pointer hover:text-text-secondary transition-colors bg-transparent border-none text-[11px] text-text-tertiary font-sans p-0"
                        disabled={disabled}
                    >
                        <span>{displayName}</span>
                        <ChevronsUpDown className="h-3 w-3 opacity-50" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" side="top" align="start">
                    <ModelCommandList
                        models={models}
                        loading={loading}
                        value={value}
                        onSelect={(id) => { onSelect(id); setOpen(false); }}
                    />
                </PopoverContent>
            </Popover>
        )
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    className="w-full flex items-center justify-between bg-surface-card border border-border-subtle rounded-md px-2.5 py-1.5 text-xs text-text-primary outline-none cursor-pointer hover:border-border-focus transition-colors font-sans text-left"
                    disabled={disabled}
                >
                    <span className="truncate">{displayName}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <ModelCommandList
                    models={models}
                    loading={loading}
                    value={value}
                    onSelect={(id) => { onSelect(id); setOpen(false); }}
                />
            </PopoverContent>
        </Popover>
    )
}

function ModelCommandList({
    models,
    loading,
    value,
    onSelect,
}: {
    models: ModelGroup
    loading: boolean
    value: string
    onSelect: (id: string) => void
}) {
    return (
        <Command>
            <CommandInput placeholder="Search models..." className="h-8 text-xs" />
            <CommandList className="max-h-52">
                <CommandEmpty className="py-4 text-xs">
                    {loading ? "Loading models..." : "No models found."}
                </CommandEmpty>
                {Object.entries(models)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([provider, providerModels]) => (
                        <CommandGroup key={provider} heading={provider.charAt(0).toUpperCase() + provider.slice(1)}>
                            {providerModels.map(m => (
                                <CommandItem
                                    key={m.id}
                                    value={m.id}
                                    keywords={[m.name, m.id]}
                                    onSelect={() => onSelect(m.id)}
                                    className="text-xs cursor-pointer"
                                >
                                    <Check className={cn("mr-1 h-3 w-3", value === m.id ? "opacity-100 text-accent" : "opacity-0")} />
                                    <span className="truncate">{m.name || m.id.split('/').pop()}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    ))}
            </CommandList>
        </Command>
    )
}
