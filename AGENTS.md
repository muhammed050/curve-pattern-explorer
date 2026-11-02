<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- Lab logic lives in `src/lib/lab/*` (crypto, projections, formula parser, stats, experiments) as pure TS modules; UI in `src/components/lab`. Why: keeps math testable and separate from rendering.
- Private scalars are discarded after ranking in `generateSample`; never store, display, or export them. Why: scientific-integrity requirement.
- Custom formulas go through the hand-written parser in `formula.ts`, never eval. Why: safe expression execution.
