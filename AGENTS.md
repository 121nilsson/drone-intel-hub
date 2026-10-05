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
- Feature-Sliced: features live in src/features/<slice>, shared contracts in src/shared/contracts, entities in src/entities — keeps slices decoupled.
- Features depend only on contracts (DroneRepository, IntelExtractor, BriefingSummarizer); concrete implementations are chosen solely in src/shared/infra/services.tsx — so storage/inference can be swapped without touching features.
- External AI calls go through the chatCompletion server function proxy — keeps provider calls off the browser.
