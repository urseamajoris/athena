"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { EmptyState, Section, StepActions, StepFrame, useSession } from "../workspace";
import { Loading, cx } from "../ui";
import { QueryPanel, useSearchData } from "../panels/QueryPanel";
import { TopicPanel } from "../panels/IdeaPanel";

/** Stage 3, the search plan. Hosts panels/QueryPanel (one topic's searches) and the topic editor, one topic at a time. */
export function SearchStep() {
  const { actionFor } = useSession();
  const { data, isLoading } = useSearchData();
  const [picked, setPicked] = useState<string | null>(null);
  const topics = data?.topics ?? [];
  const withSearches = topics.filter((t) => t.queries.length);
  const topic = topics.find((t) => t.id === picked) ?? withSearches[0] ?? topics[0];
  return (
    <StepFrame step="search" width="wide">
      {isLoading ? (
        <Loading />
      ) : !withSearches.length || !topic ? (
        <>
          <EmptyState icon={<Search className="h-6 w-6" strokeWidth={2} />} title="No search plan yet">
            Athena writes 4 to 8 search topics from your research question, and one search per database for each. You check and edit them before anything runs.
          </EmptyState>
          <StepActions action={actionFor("search")} />
        </>
      ) : (
        <>
          <Section title="Search topics" description="Choose a topic to see and edit its searches.">
            <ul className="flex flex-wrap gap-2">
              {topics.map((t) => (
                <li key={t.id}>
                  <button type="button" aria-pressed={t.id === topic.id} onClick={() => setPicked(t.id)} className={cx("btn-secondary", t.id === topic.id && "bg-bg-3")}>{t.name}</button>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={`Topic: ${topic.name}`}>
            <TopicPanel topicId={topic.id} />
          </Section>
          <Section title="Searches for this topic">
            <QueryPanel key={topic.id} topicId={topic.id} />
          </Section>
        </>
      )}
    </StepFrame>
  );
}
