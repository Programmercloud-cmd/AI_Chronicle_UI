# Chronicle orientation study

Status: **not yet run with human participants**. Automated browser checks are not a substitute for this release gate.

## Participants

Recruit at least five technical project owners or senior developers who have not seen the fixture or Chronicle implementation. Record role and relevant experience, but no personal or confidential project data.

## Setup

Use the packed application from `npm run release:check`. Give each participant the canonical fixture first and the difficult fixture second. Do not explain the topology, current state, or roadmap before timing begins.

## Ten-second History check

Open History and allow ten seconds without opening detail pages. Ask the participant to identify:

1. the original development path;
2. where development branched;
3. which branch became current;
4. the current milestone/state;
5. which nodes are future work;
6. the approximate event months.

Pass threshold: at least four of five participants answer all six correctly.

## Three-minute project-orientation check

Allow navigation through Current, History, Roadmap, milestone detail, and evidence for three minutes. Ask the participant to explain:

1. where the project is now and when that status was updated;
2. why the accepted direction changed;
3. one rejected or abandoned approach;
4. the evidence supporting the current conclusion;
5. the active blocker;
6. the next action;
7. how the difficult fixture preserves a later-disproved conclusion and its correction.

Pass threshold: at least four of five participants answer all seven correctly and distinguish operational status freshness from milestone chronology.

## Keyboard-only check

For at least one participant, repeat the core flow without a pointing device: skip to content, navigate views, focus a History node, reveal its compact details, open evidence, return, and jump to current state.

Pass threshold: the participant completes the flow without assistance or inaccessible hover-only information.

## Results template

| Participant | History 6/6 within 10s | Orientation 7/7 within 3m | Keyboard flow | Observed defects |
| --- | --- | --- | --- | --- |
| P1 |  |  |  |  |
| P2 |  |  |  |  |
| P3 |  |  |  |  |
| P4 |  |  |  |  |
| P5 |  |  |  |  |

Record exact task times and concrete misunderstandings. Do not adjust the threshold after seeing results. Any repeated misunderstanding becomes a product defect for the next gauntlet; screenshot baselines must not be updated to conceal it.
