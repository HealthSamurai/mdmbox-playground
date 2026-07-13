import React, { useCallback, useState, useEffect } from 'react';
import { useDebounce } from './hooks';
import TickSlider from './tick-slider';
import {Select, SelectTrigger, SelectContent, SelectItem, Switch} from "@health-samurai/react-components";
import { DebouncedInput } from './debounce-input';
import { SearchIcon } from './icons';

export type MatchingModel = {
  id: string;
  relatedResources?: Array<string>;
  blocks: { sql?: string; var?: string };
  features: { bf?: number; else?: number; expr?: string };
  'bulk-table'?: Record<string, unknown>;
  resource: string;
  thresholds?: { certain?: number; probable?: number };
  vars?: Record<string, unknown>;
};

interface MatchParamsProps {
  linkageModels: MatchingModel[];
  selectedModel: MatchingModel;
  threshold: number;
  showNonDuplicates: boolean;
  episodeNumber: string;
  onModelChange: (model: MatchingModel) => void;
  onThresholdChange: (threshold: number) => void;
  onShowNonDuplicatesChange: (show: boolean) => void;
  onEpisodeNumberChange: (episodeNumber: string) => void;
  withEncountersSearch?: boolean
  withThresholdSlider?: boolean
  withNonDuplicatesSwithch?: boolean
}

const MatchParams: React.FC<MatchParamsProps> = ({
  linkageModels,
  selectedModel,
  threshold,
  showNonDuplicates,
  episodeNumber,
  onModelChange,
  onThresholdChange,
  onShowNonDuplicatesChange,
  onEpisodeNumberChange,
  withEncountersSearch,
  withThresholdSlider,
  withNonDuplicatesSwithch,
}) => {

  const [localThreshold, setLocalThreshold] = useState(threshold);
  const debouncedThreshold = useDebounce(localThreshold, 500);

  // Update local threshold when prop changes (e.g., from URL)
  useEffect(() => {
    setLocalThreshold(threshold);
  }, [threshold]);

  // Call the parent callback when debounced value changes
  useEffect(() => {
    if (debouncedThreshold !== threshold) {
      onThresholdChange(debouncedThreshold);
    }
  }, [debouncedThreshold]);

  const handleSelect = useCallback(
    (id: string) => {
      const item = linkageModels.find(m => m.id === id);
      if (item) {
        onModelChange(item);
      }
    },
    [linkageModels, onModelChange]
  );

  return (
    // <div className="flex justify-between items-start gap-4 rounded-md mb-4">
      <div className='flex-1 flex items-start gap-6 rounded-md' >
        <div className="flex w-1/6 flex-col">
          <label className="text-sm font-medium h-5 mb-1">Select model:</label>
          <div className="h-10 flex items-center">
            <Select value={selectedModel?.id || ""} onValueChange={handleSelect}>
              <SelectTrigger className="w-full">
                {selectedModel?.id ?? "Select Linkage Model"}
              </SelectTrigger>
              <SelectContent>
                {linkageModels.map(item => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {withThresholdSlider && <div className="w-128 flex flex-col">
          <label className="text-sm font-medium h-5 mb-1">Matching threshold:</label>
          <div className="h-10 flex items-center w-full">
            <TickSlider
              value={[localThreshold]}
              onValueChange={(val) => setLocalThreshold(val[0] as number)}
              min={-10}
              max={36}
            />
          </div>
        </div>}
        <div className="flex items-start gap-6">
          {withNonDuplicatesSwithch && <div className="flex flex-col">
            <div className="h-5 mb-1"></div>
            <div className="h-10 flex items-center space-x-2">
              <Switch checked={showNonDuplicates} onCheckedChange={onShowNonDuplicatesChange} />
              <span className="text-sm">Show non-duplicates</span>
            </div>
          </div>}
          {withEncountersSearch && <div className="flex flex-col">
            <label className="text-sm font-medium h-5 mb-1">Search encounters:</label>
            <div className="h-10 flex items-center relative border border-gray-300 rounded-md px-2">
              <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none z-10">
                <SearchIcon />
              </div>
              <DebouncedInput
                  type="text"
                  placeholder="Enter episode number"
                  value={episodeNumber}
                  onChange={onEpisodeNumberChange}
                  className="h-full w-full text-sm border-0 bg-transparent focus-visible:ring-0 placeholder:text-gray-400 pl-8 pr-2 focus:outline-none"
                  debounceMs={300}
              />
            </div>
          </div>}
        </div>
      </div>
  );
};

export default MatchParams;
