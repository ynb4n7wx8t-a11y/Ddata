"use client"

import { ChevronRight, Settings2 } from "lucide-react"
import {
  Collapsible,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

interface SettingsItem {
  title: string
  page: string
}

export function NavProjects({
  settingsItems,
  settingsOpen,
  onSettingsOpenChange,
  currentPage,
  onNavigate,
  searchQuery = "",
}: {
  settingsItems: SettingsItem[]
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  currentPage?: string
  onNavigate?: (page: string) => void
  searchQuery?: string
}) {
  const isSearching = searchQuery.trim().length > 0
  const q = searchQuery.toLowerCase()

  const filteredSettings = isSearching
    ? settingsItems.filter(i => i.title.toLowerCase().includes(q))
    : settingsItems

  const showSettings = !isSearching
    ? true
    : ("settings".includes(q) || filteredSettings.length > 0)
  const isSettingsOpen = isSearching ? true : settingsOpen

  // Hide entire section if nothing matches
  if (isSearching && !showSettings) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Settings</SidebarGroupLabel>
      <SidebarMenu>
        {/* Settings collapsible */}
        {showSettings && (
          <Collapsible
            asChild
            open={isSearching ? true : settingsOpen}
            onOpenChange={v => { if (!isSearching) onSettingsOpenChange(v) }}
          >
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Settings"
                className="font-medium transition-colors duration-150"
                onClick={() => { if (!isSearching) onSettingsOpenChange(!settingsOpen) }}
              >
                <Settings2 className="size-[14px] theme-accent-amber" />
                <span>Settings</span>
              </SidebarMenuButton>
              <CollapsibleTrigger asChild>
                <SidebarMenuAction className="transition-transform duration-300 data-[state=open]:rotate-90">
                  <ChevronRight />
                  <span className="sr-only">Toggle</span>
                </SidebarMenuAction>
              </CollapsibleTrigger>
              <div
                aria-hidden={!isSettingsOpen}
                style={{
                  display: "grid",
                  gridTemplateRows: isSettingsOpen ? "1fr" : "0fr",
                  transition:
                    "grid-template-rows 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
                }}
              >
                <div className="overflow-hidden">
                  <SidebarMenuSub className={!isSettingsOpen ? "pointer-events-none" : undefined}>

                    {/* ── Nav settings items ── */}
                    {filteredSettings.map(item => (
                      <SidebarMenuSubItem key={item.page}>
                        <SidebarMenuSubButton
                          asChild
                          className="font-medium transition-colors duration-150"
                          isActive={currentPage === item.page}
                        >
                          <a
                            href="#"
                            onClick={e => { e.preventDefault(); onNavigate?.(item.page) }}
                          >
                            <span>{item.title}</span>
                          </a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}

                  </SidebarMenuSub>
                </div>
              </div>
            </SidebarMenuItem>
          </Collapsible>
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
