"use client";

import { Pie, PieChart } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  count: {
    label: "Questions",
  },
  correct: {
    label: "Correct",
    color: "var(--color-emerald-500)",
  },
  wrong: {
    label: "Wrong",
    color: "var(--destructive)",
  },
  unanswered: {
    label: "Unanswered",
    color: "var(--muted-foreground)",
  },
} satisfies ChartConfig;

interface OutcomePieProps {
  correct: number;
  wrong: number;
  unanswered: number;
}

export function OutcomePie({ correct, wrong, unanswered }: OutcomePieProps) {
  const data = [
    { outcome: "correct", count: correct, fill: "var(--color-correct)" },
    { outcome: "wrong", count: wrong, fill: "var(--color-wrong)" },
    { outcome: "unanswered", count: unanswered, fill: "var(--color-unanswered)" },
  ].filter((entry) => entry.count > 0);

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0 text-center">
        <CardTitle>Outcome breakdown</CardTitle>
        <CardDescription>
          {correct + wrong} answered · {unanswered} not answered
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <PieChart>
            <ChartTooltip
              content={<ChartTooltipContent nameKey="count" hideLabel />}
            />
            <Pie
              data={data}
              dataKey="count"
              nameKey="outcome"
              labelLine={false}
              label={({ payload, ...props }) => {
                return (
                  <text
                    cx={props.cx}
                    cy={props.cy}
                    x={props.x}
                    y={props.y}
                    textAnchor={props.textAnchor}
                    dominantBaseline={props.dominantBaseline}
                    fill="var(--foreground)"
                    className="text-xs"
                  >
                    {payload.count}
                  </text>
                );
              }}
            />
            <ChartLegend
              content={<ChartLegendContent nameKey="outcome" />}
              className="-translate-y-1"
            />
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
