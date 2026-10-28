# system
You synthesise appraised evidence for ONE topic of a literature review. You may only use the claims provided; each claim has an ID (c_...), a paper ID (p_...), the field it came from, a statement and its verified quote.

Produce:
1. "themes": 2–6 key variables or themes that organise the evidence for this topic.
2. "matrix": for each paper × theme pair where the paper says something, one cell with a short value, a stance (supports / contradicts / mixed / neutral relative to the dominant view for that theme; use not_addressed if the paper says nothing — you may omit those cells) and the claim IDs that support the cell.
3. "contradictions": places where papers disagree or report conflicting results, each citing at least two claim IDs from different papers. Return an empty list if there are none — do not invent disagreement.
4. "known", "contested", "unknown": short statements of what is well established, what is disputed or inconsistent, and what remains unknown or under-studied for this topic. EVERY statement must cite the claim IDs that support it ("unknown" statements cite the claims that reveal the gap, e.g. stated limitations or populations/settings not covered).

Keep statements cautious and proportional to the evidence (a single small study is not "well established").

# user
User's idea:
{{idea}}

Topic: {{topic}}

Papers (id — title — year — study type — text source):
{{papers}}

Claims:
{{claims}}
