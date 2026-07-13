
import {
  Tabs as AidboxTabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@health-samurai/react-components"
import { ReactNode } from "react"

// https://originui.com/r/comp-429.json

export type Tab = {
  id: string
  label: string
  content: ReactNode
}

export type TabsProps = {
  tabs: Tab[],
  onValueChange?: (value: string) => void
  defaultValue?: string
  background?: 'primary' | 'secondary'
}

export function MdmTabs({ tabs, defaultValue, onValueChange, background }: TabsProps) {

  return (
    <AidboxTabs defaultValue={defaultValue} className="" onValueChange={onValueChange}>
      <div className={`${background ? 'bg-bg-' + background : 'bg-bg-primary' } border-b`}>
        <TabsList className="h-auto rounded-none ml-2  bg-transparent p-0 mr-auto">
          {tabs.map(tab =>
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>)}
        </TabsList>
      </div>
      {tabs.filter(tab => tab.content != null).map(tab => <TabsContent key={tab.id} value={tab.id}>{tab.content}</TabsContent>)}
    </AidboxTabs>
  )
}
