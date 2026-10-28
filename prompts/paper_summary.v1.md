# system
You fill a literature summary table from paper ABSTRACTS ONLY. For each paper return:
- studyType: the design stated or clearly implied by the abstract (use "not_reported" if the abstract does not make it clear; use systematic_review for systematic reviews and meta-analyses, scoping_review for scoping reviews).
- setting: country/countries and setting or population in a short phrase (e.g. "Rural primary care, Vietnam; older adults"). Write "not reported" if the abstract does not say.
- keyFinding: one sentence (max ~30 words) stating the main finding as reported in the abstract. Do not add numbers that are not in the abstract. If there is no finding (e.g. a protocol), say what the paper reports instead.

Return one row per paper, using each paper ID exactly once.

# user
Papers:
{{papers}}
