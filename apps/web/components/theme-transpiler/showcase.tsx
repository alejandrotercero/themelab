"use client";

// The preview content — a spread of real shadcn components plus a swatch grid,
// all reading the CSS variables the preview pane scopes onto them. Kept to
// inline (non-portal) components so everything is themed by the preview.

import {
  TrendUpIcon,
  TrendDownIcon,
  UsersIcon,
  CurrencyDollarIcon,
  PulseIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { THEME_TOKENS } from "@/lib/theme-engine";

const STATS = [
  { label: "Revenue", value: "$48,120", delta: "+12.4%", up: true, icon: CurrencyDollarIcon },
  { label: "Active users", value: "2,318", delta: "+4.1%", up: true, icon: UsersIcon },
  { label: "Churn", value: "1.8%", delta: "-0.6%", up: false, icon: PulseIcon },
];

const ROWS = [
  { name: "Ablaze", levels: 8, verdict: "Pass", mode: "Dark" },
  { name: "Apollo", levels: 7, verdict: "Pass", mode: "Dark" },
  { name: "Marble", levels: 6, verdict: "Pass", mode: "Light" },
  { name: "Aeriform", levels: 4, verdict: "Partial", mode: "Dark" },
];

export function Showcase() {
  return (
    <div className="flex flex-col gap-6 text-foreground">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Theme preview</h2>
        <p className="text-sm text-muted-foreground">
          Every component below is styled only by the generated tokens.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STATS.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-2xl">{s.value}</CardTitle>
              <CardAction>
                <s.icon className="size-5 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <Badge variant={s.up ? "default" : "destructive"}>
                {s.up ? <TrendUpIcon weight="bold" /> : <TrendDownIcon weight="bold" />}
                {s.delta}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
        <Button size="sm">Small</Button>
        <Button disabled>Disabled</Button>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="destructive">Destructive</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle>Create project</CardTitle>
            <CardDescription>Deploy a new theme in one click.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pv-name">Name</Label>
              <Input id="pv-name" placeholder="Ablaze" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="pv-switch">Auto dark mode</Label>
              <Switch id="pv-switch" defaultChecked />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="pv-check" defaultChecked />
              <Label htmlFor="pv-check">Include charts</Label>
            </div>
            <RadioGroup defaultValue="oklch" className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="oklch" id="pv-oklch" />
                <Label htmlFor="pv-oklch">OKLCH</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="hex" id="pv-hex" />
                <Label htmlFor="pv-hex">Hex</Label>
              </div>
            </RadioGroup>
            <div className="flex flex-col gap-1.5">
              <Label>Chroma</Label>
              <Slider defaultValue={[60]} max={100} step={1} />
            </div>
          </CardContent>
        </Card>

        {/* Details: tabs + accordion */}
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Tabs, accordion & muted text.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="pt-3 text-sm text-muted-foreground">
                Primary, secondary and accent surfaces are derived from the nine Hundred Rabbits colors.
              </TabsContent>
              <TabsContent value="activity" className="pt-3 text-sm text-muted-foreground">
                Mid-tones are interpolated in OKLCH; the ends may be synthetic.
              </TabsContent>
            </Tabs>
            <Separator className="my-3" />
            <Accordion multiple={false}>
              <AccordionItem value="a">
                <AccordionTrigger>What is a token?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  A named CSS variable like <code>--primary</code> that components read.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="b">
                <AccordionTrigger>Where do charts come from?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  Five hues fanned out from the accent color.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </div>

      {/* Team + progress + alert */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
            <CardDescription>Seats & usage.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <AvatarGroup>
              {["AL", "RB", "JS", "MK"].map((i) => (
                <Avatar key={i}>
                  <AvatarFallback>{i}</AvatarFallback>
                </Avatar>
              ))}
            </AvatarGroup>
            <Progress value={62}>
              <ProgressLabel>Storage</ProgressLabel>
              <ProgressValue />
            </Progress>
            <Progress value={28}>
              <ProgressLabel>Bandwidth</ProgressLabel>
              <ProgressValue />
            </Progress>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Alerts & loading states.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Alert>
              <WarningIcon weight="bold" />
              <AlertTitle>Sparse theme</AlertTitle>
              <AlertDescription>
                This theme maps one mode cleanly; the other is synthesized.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Themes</CardTitle>
          <CardDescription>Graded by luminance spread.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Levels</TableHead>
                <TableHead>Native</TableHead>
                <TableHead className="text-right">Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.levels}</TableCell>
                  <TableCell>{r.mode}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={r.verdict === "Pass" ? "default" : "secondary"}>{r.verdict}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Token grid */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">All 31 tokens</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {THEME_TOKENS.map((token) => (
            <div key={token} className="flex items-center gap-2 rounded-md border border-border p-2">
              <span
                className="size-6 shrink-0 rounded border border-border"
                style={{ backgroundColor: `var(--${token})` }}
              />
              <span className="truncate text-xs text-muted-foreground">{token}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
