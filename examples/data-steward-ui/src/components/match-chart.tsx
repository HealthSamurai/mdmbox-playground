import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Cell,
  ResponsiveContainer,
  Customized,
  ReferenceLine,
} from "recharts";
import { useMemo } from "react";
import type { MatchDetails } from "@/api/types";

// Pretty labels for known feature keys; any other key is humanized from its
// raw name. Different matching models emit different keys, so this is just a
// lookup of nicer names — not an allowlist.
const chartDataNames: Record<string, string> = {
  fn: "Full name",
  dob: "Date of birth",
  ext: "Address & Telecom",
  sex: "Gender",
  given: "Given name",
  family: "Family name",
  birth_date: "Date of birth",
  postal_code: "Postal code",
  email: "Email",
  phone: "Phone",
  gender: "Gender",
};

// Turn an unknown key like "postal_code" into "Postal code".
const humanizeKey = (key: string) =>
  key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const labelFor = (key: string) => chartDataNames[key] ?? humanizeKey(key);

export const positivePalette = ["#5BB4D6", "#7BCDB8", "#F3C969", "#9D8BC9", "#E89B6B", "#A4C957"];
export const negativePalette = ["#E36F5C", "#D87B9A", "#C97A6B", "#E59A82"];

const formatWeight = (w: number) => (w >= 0 ? `+${w.toFixed(2)}` : w.toFixed(2));

const FeatureTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[payload.length - 1]; // 'uv' bar (visible value)
  const label: string = entry?.payload?.name || "";
  const value: number = entry?.payload?.uv ?? 0;
  return (
    <div className="bg-white border rounded-md shadow-md px-3 py-2 text-sm">
      <div className="font-semibold">
        {label}: {formatWeight(value)}
      </div>
    </div>
  );
};

export function MatchChart({ data }: { data: MatchDetails }) {
  // Memoize so the array identity is stable across re-renders of the same
  // breakdown (clicking table rows re-renders the parent). A fresh array each
  // render makes the Customized layer recompute against animating bars.
  const chartData = useMemo(() => {
    let cumulative = 0;
    // Keys are whatever the model returned, in their natural order.
    return Object.entries(data)
      .filter(([, value]) => value !== 0)
      .map(([key, value]) => {
        const pv = cumulative;
        cumulative += value;
        return { name: labelFor(key), uv: value, pv };
      });
  }, [data]);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart
        data={chartData}
        barCategoryGap="20%"
        margin={{ top: 20, right: 10, left: 0, bottom: 25 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis dataKey="name" axisLine={false} tickLine={false} />
        <YAxis width={60} label={{ value: "log-odds", angle: -90, position: "insideLeft" }} />
        <ReferenceLine y={0} stroke="#666" strokeWidth={1} />
        <RechartsTooltip content={<FeatureTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="pv" stackId="a" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="uv" stackId="a" fill="#5BB4D6" isAnimationActive={false}>
          {chartData.map((item, index) => {
            if (item.uv < 0)
              return <Cell key={index} fill={negativePalette[index % negativePalette.length]} />;
            return <Cell key={index} fill={positivePalette[index % positivePalette.length]} />;
          })}
        </Bar>
        <Customized
          component={(props: any) => {
            const { formattedGraphicalItems, yAxisMap } = props;
            const yAxis = Object.values(yAxisMap || {})[0] as any;
            const uvBarItem = formattedGraphicalItems?.find(
              (item: any) => item?.item?.props?.dataKey === "uv"
            );
            const bars = uvBarItem?.props?.data;
            if (!bars || !yAxis?.scale) return null;
            return (
              <g>
                {bars.slice(0, -1).map((bar: any, index: number) => {
                  const nextBar = bars[index + 1];
                  if (!nextBar) return null;
                  // y for the segment is the cumulative top of the current bar.
                  // For a (near) zero bar, that top is identical for the bar itself
                  // and the gap to the next, so draw a single line straight across
                  // (covering both the bar's empty area and the gap).
                  const item = chartData[index];
                  const isNearZero = Math.abs(item?.uv ?? 0) < 0.01;
                  const x1 = isNearZero ? bar.x : bar.x + bar.width;
                  const x2 = nextBar.x;
                  const y = bar.y;
                  return (
                    <line
                      key={`line-${index}`}
                      x1={x1}
                      y1={y}
                      x2={x2}
                      y2={y}
                      stroke="#999"
                      strokeDasharray="3 3"
                      strokeWidth={1.2}
                    />
                  );
                })}
                {bars.map((bar: any, index: number) => {
                  const item = chartData[index];
                  if (!item || item.uv === 0) return null;
                  const isNegative = item.uv < 0;
                  const sign = isNegative ? "↓" : "↑";
                  const value = item.uv.toFixed(2);
                  const label = `${sign} ${isNegative ? "" : "+"}${value}`;
                  const color = isNegative
                    ? negativePalette[index % negativePalette.length]
                    : positivePalette[index % positivePalette.length];
                  const cx = bar.x + bar.width / 2;
                  const cy = isNegative ? bar.y + bar.height + 18 : bar.y - 8;
                  return (
                    <text
                      key={`label-${index}`}
                      x={cx}
                      y={cy}
                      fill={color}
                      fontSize={13}
                      fontWeight="600"
                      textAnchor="middle"
                      dominantBaseline={isNegative ? "hanging" : "auto"}
                    >
                      {label}
                    </text>
                  );
                })}
              </g>
            );
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
