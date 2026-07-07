"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { apiFetch, DEFAULT_EXAM_ID } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Option {
  id?: string;
  text: string;
  isCorrect: boolean;
}
interface Question {
  id: string;
  type: "SCQ" | "MCQ";
  text: string;
  marks: number;
  options: Option[];
}
type Draft = {
  id?: string;
  type: "SCQ" | "MCQ";
  text: string;
  marks: number;
  options: Option[];
};

function blankDraft(): Draft {
  return {
    type: "SCQ",
    text: "",
    marks: 1,
    options: [
      { text: "", isCorrect: true },
      { text: "", isCorrect: false },
    ],
  };
}

export default function QuestionsPage() {
  const [examId, setExamId] = useState(DEFAULT_EXAM_ID);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<Question[]>(
        `/admin/questions?examId=${encodeURIComponent(examId)}`,
      );
      setQuestions(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load questions");
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function control(path: string, body?: unknown, label = "Done") {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      setNotice(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setError(null);
    try {
      await apiFetch("/admin/questions", {
        method: "POST",
        body: JSON.stringify({
          examId,
          questions: [
            {
              ...(draft.id ? { id: draft.id } : {}),
              type: draft.type,
              text: draft.text,
              marks: draft.marks,
              options: draft.options,
            },
          ],
        }),
      });
      setDraft(null);
      setNotice("Question saved");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function remove(id: string) {
    if (!confirm(`Delete question ${id}?`)) return;
    setError(null);
    try {
      await apiFetch(`/admin/questions/${encodeURIComponent(id)}`, { method: "DELETE" });
      setNotice("Question deleted");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Exam &amp; questions</h1>
          <p className="text-muted-foreground text-sm">Question bank and exam controls</p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Exam ID</span>
          <Input value={examId} onChange={(e) => setExamId(e.target.value)} className="w-44" />
        </label>
      </header>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {notice && <p className="text-emerald-600 text-sm dark:text-emerald-400">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Exam controls</CardTitle>
          <CardDescription>
            Availability window and result visibility for <code>{examId}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => control(`/admin/exams/${encodeURIComponent(examId)}/open`, undefined, "Exam opened")}>
            Open exam
          </Button>
          <Button variant="outline" size="sm" onClick={() => control(`/admin/exams/${encodeURIComponent(examId)}/close`, undefined, "Exam closed")}>
            Close exam
          </Button>
          <Button variant="outline" size="sm" onClick={() => control(`/admin/exams/${encodeURIComponent(examId)}/publish`, { published: true }, "Results published")}>
            Publish results
          </Button>
          <Button variant="outline" size="sm" onClick={() => control(`/admin/exams/${encodeURIComponent(examId)}/publish`, { published: false }, "Results hidden")}>
            Unpublish results
          </Button>
        </CardContent>
      </Card>

      <section className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          Question bank {loading ? "" : `(${questions.length})`}
        </h2>
        {!draft && (
          <Button size="sm" onClick={() => setDraft(blankDraft())}>
            <Plus /> New question
          </Button>
        )}
      </section>

      {draft && (
        <QuestionEditor
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}

      <div className="flex flex-col gap-3">
        {questions.map((q) => (
          <Card key={q.id} className="py-4">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-muted-foreground text-xs font-medium">
                  {q.id} · {q.type} · {q.marks} mark{q.marks === 1 ? "" : "s"}
                </p>
                <div className="flex gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setDraft({ id: q.id, type: q.type, text: q.text, marks: q.marks, options: q.options.map((o) => ({ ...o })) })}
                  >
                    Edit
                  </Button>
                  <Button size="xs" variant="destructive" onClick={() => remove(q.id)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <p className="text-sm font-medium">{q.text}</p>
              <ul className="flex flex-col gap-1">
                {q.options.map((o) => (
                  <li
                    key={o.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                      o.isCorrect && "border-emerald-500/40 bg-emerald-500/5",
                    )}
                  >
                    <span className="flex-1">{o.text}</span>
                    {o.isCorrect && (
                      <Badge className="shrink-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                        <Check /> Correct
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
        {!loading && questions.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">No questions for this exam yet.</p>
        )}
      </div>
    </main>
  );
}

function QuestionEditor({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  function setOption(i: number, patch: Partial<Option>) {
    const options = draft.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o));
    onChange({ ...draft, options });
  }
  // SCQ keeps a single correct option; MCQ allows many.
  function toggleCorrect(i: number) {
    if (draft.type === "SCQ") {
      onChange({ ...draft, options: draft.options.map((o, idx) => ({ ...o, isCorrect: idx === i })) });
    } else {
      setOption(i, { isCorrect: !draft.options[i].isCorrect });
    }
  }

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Type</span>
            <select
              value={draft.type}
              onChange={(e) => onChange({ ...draft, type: e.target.value as "SCQ" | "MCQ" })}
              className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              <option value="SCQ">SCQ (single)</option>
              <option value="MCQ">MCQ (multiple)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Marks</span>
            <Input
              type="number"
              min={1}
              value={draft.marks}
              onChange={(e) => onChange({ ...draft, marks: Math.max(1, Number(e.target.value) || 1) })}
              className="w-20"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Question text</span>
          <Textarea value={draft.text} onChange={(e) => onChange({ ...draft, text: e.target.value })} />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-sm">Options (tick the correct one{draft.type === "MCQ" ? "(s)" : ""})</span>
          {draft.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleCorrect(i)}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md border",
                  o.isCorrect
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "border-border text-transparent",
                )}
                aria-label="mark correct"
              >
                <Check className="size-3.5" />
              </button>
              <Input value={o.text} onChange={(e) => setOption(i, { text: e.target.value })} placeholder={`Option ${i + 1}`} />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => onChange({ ...draft, options: draft.options.filter((_, idx) => idx !== i) })}
                disabled={draft.options.length <= 1}
              >
                <X />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onChange({ ...draft, options: [...draft.options, { text: "", isCorrect: false }] })}
            >
              <Plus /> Add option
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onSave}>Save question</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
